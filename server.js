// DVB-I Service List Registry.
//
// TS 103 770 V1.2.1 clause 5.1.3.2: "A Service List Registry (SLR) is an HTTP endpoint available at
// a known URL that, if queried, can return a list of Service List Entry Points." This implements
// that endpoint and the query interface the same clause specifies.
//
// It is the third component of the DVB-I architecture of TS 103 770 clause 4.1, alongside the
// Server and the Content Guide Server (both in rt-dvb-i-application-provider) and the DVB-I client
// (rt-dvb-i-application). Without it a client has nowhere to ask which service lists exist.
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
// Not 6000: that is on the WHATWG blocked-ports list (X11), so a browser refuses to fetch from it
// and Node's own fetch fails with "bad port". A registry nothing can reach is not a registry.
const PORT = process.env.PORT || 7000;
const REGISTRY_PATH = process.env.REGISTRY_PATH || path.join(__dirname, 'registry.json');

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] !== undefined ? process.env.LOG_LEVEL : 'info';
function log(level, msg, meta) {
  if (LOG_LEVELS[level] > LOG_LEVELS[LOG_LEVEL]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...(meta || {}) });
  (level === 'error' ? console.error : console.log)(line);
}

const NS = 'urn:dvb:metadata:servicelistdiscovery:2024';
const NS_TYPES = 'urn:dvb:metadata:servicediscovery-types:2023';
const NS_MPEG7 = 'urn:tva:mpeg7:2008';
const NS_TVA = 'urn:tva:metadata:2024';

// The query parameters of TS 103 770 clause 5.1.3.2, in the order that clause presents them. Any
// a 400: the clause requires that response "if an undefined query parameter is provided".
const PARAMETERS = ['TargetCountry', 'regulatorListFlag', 'Delivery', 'Language', 'Genre',
                    'ProviderName', 'inlineImages'];

// What an offering in registry.json may declare: the children of DeliveryType
// (dvbi_types_v1.0.xsd), in schema order, keyed by the short name the file uses. These are
// emission keys and are NOT the values a query carries; see DELIVERY_QUERY below.
const DELIVERY_ELEMENTS = {
  'dash': 'DASHDelivery',
  'dvb-t': 'DVBTDelivery',
  'dvb-c': 'DVBCDelivery',
  'dvb-s': 'DVBSDelivery',
  'rtsp': 'RTSPDelivery',
  'multicast-ts': 'MulticastTSDelivery',
  'application': 'ApplicationDelivery',
};

// The Delivery values a query may carry, each mapped to the DELIVERY_ELEMENTS an offering needs
// for the query to match it. This set is closed: anything else is "an invalid value ... for a
// query parameter" and gets a 400.
// ETSI TS 103 770 V1.2.1, clause 5.3.6.1, table 12b:
// "For Service List Registry queries, the Delivery values defined in table 12b shall be used, for
// each of the corresponding DeliveryTypes."
// Two rows cover more than one element: dvb-dash is "DASHDelivery optionally in combination with
// MulticastTSDelivery", so DASHDelivery is what decides the match; dvb-iptv is "MulticastTSDelivery
// and/or RTSPDelivery", so either one matches.
const DELIVERY_QUERY = {
  'dvb-dash': ['dash'],
  'dvb-t': ['dvb-t'],
  'dvb-c': ['dvb-c'],
  'dvb-s': ['dvb-s'],
  'dvb-iptv': ['multicast-ts', 'rtsp'],
  'application': ['application'],
};

// TS 103 770 clause 5.1.3.2: "The maximum length of a fully qualified web service URL including
// shall not exceed 2 048 characters."
const MAX_URL = 2048;

const ISO_3166_LIST = /^[A-Z]{3}(,[A-Z]{3})*$/;
const LANGUAGE = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;

const xe = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

/**
 * Read a query parameter that may be single or repeated.
 *
 * TS 103 770 clause 5.1.3.2 requires multiple values to be sent with square bracket notation,
 * "TargetCountry[]=AUT&TargetCountry[]=DEU", and to be interpreted "using the OR logical operator,
 * as alternatives". Express surfaces "x[]=a&x[]=b" as an array under the key "x[]", and a single
 * "x=a" under "x", so both spellings are read here.
 */
function values(query, name) {
  const out = [];
  for (const key of [name, `${name}[]`]) {
    const v = query[key];
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      const s = String(item).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Returns an error to answer with, or null when the query is acceptable. */
function validate(query) {
  for (const key of Object.keys(query)) {
    const base = key.endsWith('[]') ? key.slice(0, -2) : key;
    if (!PARAMETERS.includes(base)) {
      return { status: 400, message: `Unknown query parameter "${key}". Accepted, in this order: ${PARAMETERS.join(', ')}.` };
    }
  }
  for (const c of values(query, 'TargetCountry')) {
    // TargetCountry is of type tva:ISO-3166-List (clause 5.3.5), whose pattern in
    // tva_metadata_3-1.xsd is [A-Z]{3}(,[A-Z]{3})*: upper-case three-letter codes, comma separated.
    if (!ISO_3166_LIST.test(c)) {
      return { status: 400, message: `Invalid TargetCountry "${c}": expected upper-case three-letter ISO 3166 codes, comma separated.` };
    }
  }
  for (const l of values(query, 'Language')) {
    // Language is of type tva:AudioLanguageType (clause 5.3.5), an extension of
    // mpeg7:ExtendedLanguageType, whose base is the XML Schema type language. XML Schema Part 2
    // Second Edition clause 3.3.3: "The ·lexical space· of language is the set of all strings that
    // conform to the pattern [a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*".
    if (!LANGUAGE.test(l)) {
      return { status: 400, message: `Invalid Language "${l}": expected a language tag such as "en" or "de-CH".` };
    }
  }
  for (const d of values(query, 'Delivery')) {
    if (!DELIVERY_QUERY[d.toLowerCase()]) {
      return { status: 400, message: `Invalid Delivery "${d}". Accepted: ${Object.keys(DELIVERY_QUERY).join(', ')}.` };
    }
  }
  for (const name of ['regulatorListFlag', 'inlineImages']) {
    for (const v of values(query, name)) {
      if (!/^(true|false)$/i.test(v)) {
        return { status: 400, message: `Invalid ${name} "${v}": expected true or false.` };
      }
    }
  }
  return null;
}

/**
 * Multiple values for one parameter are alternatives; different parameters all have to match.
 *
 * An offering that specifies no value for TargetCountry, Language or Genre matches any query for
 * that parameter. TS 103 770 V1.2.1 clause 5.1.3.2 lists among the offerings to include those that
 * "do not specify a TargetCountry."; clause 5.3.5, table 12: "If no language is specified,
 * responses to Service List Registry queries shall include the service list offering." and "If no
 * genre are specified, responses to Service List Registry queries shall include the service list
 * offering."
 */
function matches(offering, query) {
  // A TargetCountry value may list several codes, comma separated; each is an alternative.
  const countries = values(query, 'TargetCountry').flatMap(s => s.split(','));
  const offeredCountries = (offering.countries || []).flatMap(s => String(s).split(','));
  if (countries.length && offeredCountries.length && !countries.some(c => offeredCountries.includes(c))) return false;

  const delivery = values(query, 'Delivery').map(s => s.toLowerCase());
  const declaredDelivery = (offering.delivery || []).map(s => s.toLowerCase());
  if (delivery.length && !delivery.some(d => (DELIVERY_QUERY[d] || []).some(e => declaredDelivery.includes(e)))) return false;

  const languages = values(query, 'Language').map(s => s.toLowerCase());
  const offeredLanguages = offering.languages || [];
  if (languages.length && offeredLanguages.length && !languages.some(l => offeredLanguages.includes(l))) return false;

  const genres = values(query, 'Genre');
  const offeredGenres = offering.genres || [];
  if (genres.length && offeredGenres.length && !genres.some(g => offeredGenres.includes(g))) return false;

  const flag = values(query, 'regulatorListFlag')[0];
  if (flag !== undefined && (/^true$/i.test(flag)) !== Boolean(offering.regulator)) return false;

  return true;
}

function organization(name, indent) {
  const p = ' '.repeat(indent);
  return `${p}<Name>${xe(name)}</Name>`;
}

function offeringXml(o, indent) {
  const p = ' '.repeat(indent);
  // ServiceListOffering is declared by the discovery schema but carries the type
  // dvbi-types:ServiceListOfferingType from dvbi_types_v1.0.xsd, so all of its children belong to
  // the servicediscovery-types namespace rather than the discovery one. Emitting them unprefixed
  // put them in the wrong namespace and the schema rejected them.
  const names = [].concat(o.name).map(n => `${p}  <dvbisd-t:ServiceListName>${xe(n)}</dvbisd-t:ServiceListName>`).join('\n');
  const uris = (o.uris || []).map(u => `${p}  <dvbisd-t:ServiceListURI contentType="application/xml">\n${p}    <dvbisd-t:URI>${xe(u)}</dvbisd-t:URI>\n${p}  </dvbisd-t:ServiceListURI>`).join('\n');
  // DeliveryType's children are a fixed sequence, so they are emitted in schema order rather than
  // in whatever order the registry file happens to list them.
  const declared = new Set((o.delivery || []).map(d => d.toLowerCase()));
  const delivery = Object.entries(DELIVERY_ELEMENTS)
    .filter(([k]) => declared.has(k))
    .map(([, el]) => `${p}    <dvbisd-t:${el}/>`)
    .join('\n');
  const languages = (o.languages || []).map(l => `${p}  <dvbisd-t:Language>${xe(l)}</dvbisd-t:Language>`).join('\n');
  const countries = (o.countries || []).map(c => `${p}  <dvbisd-t:TargetCountry>${xe(c)}</dvbisd-t:TargetCountry>`).join('\n');
  return [
    `${p}<ServiceListOffering>`,
    names,
    uris,
    `${p}  <dvbisd-t:Delivery>`,
    delivery,
    `${p}  </dvbisd-t:Delivery>`,
    languages,
    countries,
    `${p}  <dvbisd-t:ServiceListId>${xe(o.id)}</dvbisd-t:ServiceListId>`,
    `${p}</ServiceListOffering>`,
  ].filter(Boolean).join('\n');
}

/**
 * Build the ServiceListEntryPoints document.
 *
 * The root element and namespace come from dvbi_service_list_discovery_v1.6.xsd, which ships in the
 * electronic attachment archive of TS 103 770: element ServiceListEntryPoints of type
 * ServiceListEntryPointsType, in urn:dvb:metadata:servicelistdiscovery:2024, whose sequence is
 * ServiceListRegistryEntity then ProviderOffering*.
 */
function buildEntryPoints(registry, query) {
  const providers = [];
  for (const provider of registry.providers || []) {
    const wanted = values(query, 'ProviderName');
    if (wanted.length && !wanted.some(n => n.toLowerCase() === String(provider.name).toLowerCase())) continue;
    const offerings = (provider.offerings || []).filter(o => matches(o, query));
    if (!offerings.length) continue;
    providers.push(
      `  <ProviderOffering>\n` +
      `    <Provider>\n${organization(provider.name, 6)}\n    </Provider>\n` +
      offerings.map(o => offeringXml(o, 4)).join('\n') + '\n' +
      `  </ProviderOffering>`);
  }
  // xml:lang is required on ServiceListEntryPointsType: it states the language of the human-readable
  // names in the document, and the schema will not accept the element without it.
  return `<?xml version="1.0" encoding="UTF-8"?>
<ServiceListEntryPoints
  xml:lang="${xe(registry.registry.lang || 'en')}"
  xmlns="${NS}"
  xmlns:dvbisd-t="${NS_TYPES}"
  xmlns:mpeg7="${NS_MPEG7}"
  xmlns:tva="${NS_TVA}">
  <ServiceListRegistryEntity>
${organization(registry.registry.name, 4)}
  </ServiceListRegistryEntity>
${providers.join('\n')}
</ServiceListEntryPoints>`;
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => log('info', 'request', {
    method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start,
  }));
  next();
});

app.get('/query', (req, res) => {
  const fullUrl = `${req.protocol}://${req.get('host') || ''}${req.originalUrl}`;
  if (fullUrl.length > MAX_URL) {
    return res.status(414).type('text/plain')
      .send(`Request URL is ${fullUrl.length} characters; the limit is ${MAX_URL}.`);
  }
  const problem = validate(req.query);
  if (problem) return res.status(problem.status).type('text/plain').send(problem.message);

  let registry;
  try { registry = loadRegistry(); }
  catch (e) {
    log('error', 'registry read failed', { path: REGISTRY_PATH, error: String(e.message || e) });
    return res.status(500).type('text/plain').send('Registry unavailable');
  }
  res.type('application/xml').send(buildEntryPoints(registry, req.query));
});

// A read-only view of what this registry holds, for the page at /. There is deliberately no write
// side: TS 103 770 clause 5.1.3.2 puts how a registry collects and stores its information out of
// scope, so an editing UI would implement nothing specified while adding the one thing a discovery
// endpoint does not otherwise have, a way to change its contents over the network.
app.get('/api/offerings', (req, res) => {
  let registry;
  try { registry = loadRegistry(); }
  catch (e) {
    log('error', 'registry read failed', { path: REGISTRY_PATH, error: String(e.message || e) });
    return res.status(500).json({ error: 'Registry unavailable' });
  }
  res.json({
    registry: registry.registry,
    parameters: PARAMETERS,
    delivery: Object.keys(DELIVERY_QUERY),
    providers: (registry.providers || []).map(p => ({
      name: p.name,
      offerings: (p.offerings || []).map(o => ({
        id: o.id, name: o.name, uris: o.uris || [], delivery: o.delivery || [],
        languages: o.languages || [], countries: o.countries || [], regulator: Boolean(o.regulator),
      })),
    })),
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function startServer() {
  return app.listen(PORT, () => {
    log('info', 'Service List Registry listening', { port: PORT });
    console.log(`DVB-I Service List Registry  ->  http://localhost:${PORT}/query`);
  });
}

if (require.main === module) startServer();

module.exports = { app, startServer, buildEntryPoints, validate, matches, values, PARAMETERS, DELIVERY_ELEMENTS, DELIVERY_QUERY };
