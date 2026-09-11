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
const PORT = process.env.PORT || 6000;
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

// Delivery values map to the children of DeliveryType (dvbi_types_v1.0.xsd). A value outside this
// set is "an invalid value ... for a query parameter", so also a 400.
const DELIVERY = {
  'dash': 'DASHDelivery',
  'dvb-t': 'DVBTDelivery',
  'dvb-c': 'DVBCDelivery',
  'dvb-s': 'DVBSDelivery',
  'rtsp': 'RTSPDelivery',
  'multicast-ts': 'MulticastTSDelivery',
  'application': 'ApplicationDelivery',
};

// TS 103 770 clause 5.1.3.2: "The maximum length of a fully qualified web service URL including
// shall not exceed 2 048 characters."
const MAX_URL = 2048;

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
    // tva:ISO-3166-List is three-letter alpha codes.
    if (!/^[A-Za-z]{3}$/.test(c)) {
      return { status: 400, message: `Invalid TargetCountry "${c}": expected a three-letter ISO 3166 code.` };
    }
  }
  for (const d of values(query, 'Delivery')) {
    if (!DELIVERY[d.toLowerCase()]) {
      return { status: 400, message: `Invalid Delivery "${d}". Accepted: ${Object.keys(DELIVERY).join(', ')}.` };
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

/** Multiple values for one parameter are alternatives; different parameters all have to match. */
function matches(offering, query) {
  const countries = values(query, 'TargetCountry').map(s => s.toUpperCase());
  if (countries.length && !countries.some(c => (offering.countries || []).includes(c))) return false;

  const delivery = values(query, 'Delivery').map(s => s.toLowerCase());
  if (delivery.length && !delivery.some(d => (offering.delivery || []).includes(d))) return false;

  const languages = values(query, 'Language').map(s => s.toLowerCase());
  if (languages.length && !languages.some(l => (offering.languages || []).includes(l))) return false;

  const genres = values(query, 'Genre');
  if (genres.length && !genres.some(g => (offering.genres || []).includes(g))) return false;

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
  const delivery = Object.entries(DELIVERY)
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function startServer() {
  return app.listen(PORT, () => {
    log('info', 'Service List Registry listening', { port: PORT });
    console.log(`DVB-I Service List Registry  ->  http://localhost:${PORT}/query`);
  });
}

if (require.main === module) startServer();

module.exports = { app, startServer, buildEntryPoints, validate, matches, values, PARAMETERS, DELIVERY };
