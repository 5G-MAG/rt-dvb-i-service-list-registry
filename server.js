/*
License: 5G-MAG Public License (v1.0)
Authors: Jordi J. Gimenez (5G-MAG)
Copyright: (C) 2026 5G-MAG Association

For full license terms please see the LICENSE file distributed with this
program. If this file is missing then the license can be retrieved from
https://www.5g-mag.com/license
*/
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
const https = require('https');
const path = require('path');
const tls = require('tls');

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

// TS 103 770 V1.2.1 clause 5.1.2: "A Service List shall be made available using HTTP according
// to clause 7.3 at a Service List URL, using the Media Type (MIME type)
// application/vnd.dvb.dvbisl+xml." ServiceListURI@contentType is "The MIME type of the object
// identified by the URI." (clause 5.5.9, table 22).
const SERVICE_LIST_MEDIA_TYPE = 'application/vnd.dvb.dvbisl+xml';

// mpeg7:mimeType (tva_mpeg7.xsd): type "/" subtype, each one or more characters from 0x21 to
// 0x7F other than ( ) < > @ , ; : \ " / [ ] ? =
const MIME_TOKEN = '[!#-\'*+\\-.0-9A-Z^-\\x7f]+';
const MIME_TYPE = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}$`);
// dvbi-types:NetworkIdType is unsignedShort; dvbi-types:LongitudeType is a double from -180.0 to
// 180.0 (dvbi_types_v1.0.xsd).
const isNetworkId = v => Number.isInteger(v) && v >= 0 && v <= 65535;
const isLongitude = v => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * The DeliveryType children an offering yields, in schema order, as { key, xml } with the key from
 * DELIVERY_ELEMENTS, plus a description of each declared delivery that could not be emitted.
 *
 * Three children have mandatory content (clause 5.3.6): DVBCDelivery@networkID (table 12f),
 * DVBSDelivery/OrbitalPosition, 1 .. ∞ (table 12g), and ApplicationDelivery/ApplicationType,
 * 1 .. ∞ (table 12h), whose @contentType is mandatory (table 12i). Their values come from the
 * offering's deliveryParameters in registry.json. A declared delivery without valid values is not
 * emitted, and so does not match a Delivery query for it either: table 12b names the DeliveryTypes
 * "required in query response Service List Offerings".
 */
function deliveryElements(o, p = '') {
  const declared = new Set((o.delivery || []).map(d => String(d).toLowerCase()));
  const params = o.deliveryParameters || {};
  const out = [];
  const dropped = [];
  for (const [key, el] of Object.entries(DELIVERY_ELEMENTS)) {
    if (!declared.has(key)) continue;
    if (key === 'dvb-c') {
      const entries = [].concat(params['dvb-c'] || []);
      for (const e of entries) {
        if (isNetworkId(e && e.networkID)) out.push({ key, xml: `${p}<dvbisd-t:${el} networkID="${e.networkID}"/>` });
        else dropped.push(`dvb-c entry without a valid networkID (0 to 65535): ${JSON.stringify(e)}`);
      }
      if (!entries.length) dropped.push('dvb-c declared without deliveryParameters["dvb-c"]');
    } else if (key === 'dvb-s') {
      const entries = [].concat(params['dvb-s'] || []);
      for (const e of entries) {
        const positions = [].concat((e && e.orbitalPositions) || []);
        if (positions.length && positions.every(isLongitude)) {
          out.push({ key, xml: [`${p}<dvbisd-t:${el}>`,
            ...positions.map(v => `${p}  <dvbisd-t:OrbitalPosition>${v}</dvbisd-t:OrbitalPosition>`),
            `${p}</dvbisd-t:${el}>`].join('\n') });
        } else dropped.push(`dvb-s entry without valid orbitalPositions (-180 to 180): ${JSON.stringify(e)}`);
      }
      if (!entries.length) dropped.push('dvb-s declared without deliveryParameters["dvb-s"]');
    } else if (key === 'application') {
      const entries = [].concat(params.application || []);
      const types = [];
      for (const e of entries) {
        const ct = e && e.contentType;
        const ait = e && e.xmlAitApplicationType;
        // Table 12h: "If @contentType="application/vnd.dvb.ait+xml", the @xmlAitApplicationType
        // attribute shall be included".
        const aitOk = ct !== 'application/vnd.dvb.ait+xml' ? (ait === undefined || MIME_TYPE.test(ait)) : MIME_TYPE.test(ait || '');
        if (typeof ct === 'string' && MIME_TYPE.test(ct) && aitOk) {
          types.push(`${p}  <dvbisd-t:ApplicationType contentType="${xe(ct)}"${ait !== undefined ? ` xmlAitApplicationType="${xe(ait)}"` : ''}/>`);
        } else dropped.push(`application entry without a valid contentType or xmlAitApplicationType: ${JSON.stringify(e)}`);
      }
      if (types.length) out.push({ key, xml: [`${p}<dvbisd-t:${el}>`, ...types, `${p}</dvbisd-t:${el}>`].join('\n') });
      else if (!entries.length) dropped.push('application declared without deliveryParameters.application');
    } else {
      out.push({ key, xml: `${p}<dvbisd-t:${el}/>` });
    }
  }
  return { elements: out, dropped };
}

// TS 103 770 clause 5.1.3.2: "The maximum length of a fully qualified web service URL including
// parameters shall not exceed 2 048 characters."
const MAX_URL = 2048;

const ISO_3166_LIST = /^[A-Z]{3}(,[A-Z]{3})*$/;
const LANGUAGE = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;

// The classification schemes a Genre value may take its term from. TS 103 770 V1.2.1 clause 5.3.5,
// table 12, row Genre: "Similar to ServiceGenre, possible values are taken from:" ContentCS and
// FormatCS "defined in ETSI TS 102 822-3-1 [7]" and "ContentSubject defined in clause D.5". The
// URIs are those of clause 6.11.5: "All values from the TV-Anytime ContentCS
// (urn:tva:metadata:cs:ContentCS:2011) or FormatCS (urn:tva:metadata:cs:FormatCS:2011)", and the
// uri attribute of the clause D.5 scheme, urn:dvb:metadata:cs:ContentSubject:2019. Each maps to
// the file that holds it: DVBContentSubjectCS-2019.xml is the name annex B gives the clause D.5
// attachment; ContentCS.xml and FormatCS.xml are the names in the TV-Anytime distribution.
const GENRE_SCHEMES = {
  'urn:tva:metadata:cs:ContentCS:2011': 'ContentCS.xml',
  'urn:tva:metadata:cs:FormatCS:2011': 'FormatCS.xml',
  'urn:dvb:metadata:cs:ContentSubject:2019': 'DVBContentSubjectCS-2019.xml',
};
// A Genre query value is read as a term reference: scheme URI, ":", termID, the form TS 103 770
// writes every classification scheme term in (for example Genre href=
// "urn:dvb:metadata:cs:ContentSubject:2019:2" in its examples). This is a reading: clause 5.1.3.2
// does not define the value form, and the formal rule for term references is in ISO/IEC 15938-5,
// which is not held here. termID is an NMTOKEN (tva_mpeg7.xsd, TermDefinitionBaseType); the
// pattern below approximates NMTOKEN with Unicode letters, marks and digits plus . - _ : and U+00B7.
const TERM_ID = /^[\p{L}\p{M}\p{N}._:·-]+$/u;
function parseGenre(v) {
  for (const uri of Object.keys(GENRE_SCHEMES)) {
    if (v.startsWith(`${uri}:`)) {
      const termID = v.slice(uri.length + 1);
      return TERM_ID.test(termID) ? { uri, termID } : null;
    }
  }
  return null;
}

/**
 * Load the terms of the Genre schemes from `dir`: a Map from scheme URI to its set of termIDs.
 * Throws when a file is missing or unreadable, when its ClassificationScheme@uri is not the scheme
 * it is named for, or when it defines no terms, so the registry never starts without them. The
 * scheme files are not part of this repository.
 */
function loadGenreSchemes(dir) {
  const terms = new Map();
  for (const [uri, file] of Object.entries(GENRE_SCHEMES)) {
    const p = path.join(dir, file);
    let xml;
    try { xml = fs.readFileSync(p, 'utf8'); }
    catch (e) { throw new Error(`Genre classification scheme ${uri} not loaded from ${p}: ${e.message}`); }
    xml = xml.replace(/<!--[\s\S]*?-->/g, '');
    const root = xml.match(/<(?:[\w.-]+:)?ClassificationScheme\b[^>]*?\suri\s*=\s*(["'])(.*?)\1/);
    if (!root || root[2] !== uri) {
      throw new Error(`${p} is not the classification scheme ${uri} (found ${root ? root[2] : 'no ClassificationScheme@uri'})`);
    }
    // termID is an NMTOKEN with whiteSpace collapse, so surrounding spaces are not part of it
    // (FormatCS.xml writes termID="2.1.1 ").
    const ids = new Set([...xml.matchAll(/<(?:[\w.-]+:)?Term\b[^>]*?\stermID\s*=\s*(["'])(.*?)\1/g)].map(m => m[2].trim()));
    if (!ids.size) throw new Error(`${p} defines no terms for ${uri}`);
    terms.set(uri, ids);
  }
  return terms;
}

// The loaded Genre terms. startServer loads them from GENRE_CS_DIR before listening; while none are
// loaded (app used without startServer) no value is a term of them, so every Genre value gets 400.
let genreTerms = null;

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
  for (const g of values(query, 'Genre')) {
    // Table 12, row Genre names the schemes; the term has to be one the loaded files define.
    const ref = parseGenre(g);
    if (!ref) {
      return { status: 400, message: `Invalid Genre "${g}": expected a term of ${Object.keys(GENRE_SCHEMES).join(', ')}, written as the scheme URI, ":", the termID.` };
    }
    if (!genreTerms || !genreTerms.get(ref.uri).has(ref.termID)) {
      return { status: 400, message: `Invalid Genre "${g}": ${ref.uri} has no term "${ref.termID}".` };
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
  const emittedDelivery = deliveryElements(offering).elements.map(e => e.key);
  if (delivery.length && !delivery.some(d => (DELIVERY_QUERY[d] || []).some(e => emittedDelivery.includes(e)))) return false;

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
  const uris = (o.uris || []).map(u => `${p}  <dvbisd-t:ServiceListURI contentType="${SERVICE_LIST_MEDIA_TYPE}">\n${p}    <dvbisd-t:URI>${xe(u)}</dvbisd-t:URI>\n${p}  </dvbisd-t:ServiceListURI>`).join('\n');
  // DeliveryType's children are a fixed sequence, so they are emitted in schema order rather than
  // in whatever order the registry file happens to list them.
  const { elements, dropped } = deliveryElements(o, `${p}    `);
  for (const reason of dropped) log('warn', 'delivery not emitted', { offering: o.id, reason });
  const delivery = elements.map(e => e.xml).join('\n');
  const languages = (o.languages || []).map(l => `${p}  <dvbisd-t:Language>${xe(l)}</dvbisd-t:Language>`).join('\n');
  const countries = (o.countries || []).map(c => `${p}  <dvbisd-t:TargetCountry>${xe(c)}</dvbisd-t:TargetCountry>`).join('\n');
  return [
    // Table 12, row @regulatorListFlag: "If not specified the default value is false", so a
    // regulator's list has to say true.
    `${p}<ServiceListOffering${o.regulator ? ' regulatorListFlag="true"' : ''}>`,
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

// TS 103 770 V1.2.1 clause 7.3: "DVB-I metadata endpoint servers shall support TLS version 1.2
// defined in IETF RFC 5246 [26] and should support TLS version 1.3 defined in IETF RFC 8446 [25]
// or later." The server sets no version range of its own; it uses Node's tls.DEFAULT_MIN_VERSION
// and tls.DEFAULT_MAX_VERSION (TLSv1.2 and TLSv1.3 unless changed with the --tls-min-* and
// --tls-max-* options), and refuses to start when they exclude TLS 1.2.
const TLS_VERSIONS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
function checkTlsVersions(min = tls.DEFAULT_MIN_VERSION, max = tls.DEFAULT_MAX_VERSION) {
  const lo = TLS_VERSIONS.indexOf(min), hi = TLS_VERSIONS.indexOf(max);
  const v12 = TLS_VERSIONS.indexOf('TLSv1.2'), v13 = TLS_VERSIONS.indexOf('TLSv1.3');
  if (lo > v12 || hi < v12) return { error: `TLS versions ${min} to ${max} exclude TLSv1.2, which TS 103 770 clause 7.3 requires a server to support.` };
  if (hi < v13) return { warning: `TLS versions ${min} to ${max} exclude TLSv1.3, which TS 103 770 clause 7.3 says a server should support.` };
  return {};
}

/**
 * Start the registry: over TLS when HTTPS_KEY_PATH and HTTPS_CERT_PATH name a PEM key and
 * certificate, over plain HTTP when neither is set. A TLS configuration that is incomplete or
 * cannot be loaded throws, so the registry never answers over HTTP when TLS was asked for. It also
 * throws when GENRE_CS_DIR is unset or does not hold the Genre classification schemes.
 *
 * TS 103 770 V1.2.1 clause 7.3 requires HTTP over TLS between a client and a Service List
 * Registry, with one exception: "For the specific case that a DVB-I client connects to a DVB-I
 * metadata endpoint located on the same private subnet (see clause 3 of IETF RFC 1918 [27]),
 * HTTP may be used without TLS." Plain HTTP is for that case only; the server does not check it.
 */
function startServer({ port = PORT, env = process.env } = {}) {
  // Genre terms are checked against scheme files the operator supplies, which this repository does
  // not carry. Without them the registry does not start, so Genre values are never left unchecked.
  if (!env.GENRE_CS_DIR) {
    throw new Error(`GENRE_CS_DIR is not set: it must name a directory holding ${Object.values(GENRE_SCHEMES).join(', ')}, the classification schemes Genre values are taken from (ETSI TS 103 770 V1.2.1 clause 5.3.5, table 12, row Genre)`);
  }
  genreTerms = loadGenreSchemes(env.GENRE_CS_DIR);
  log('info', 'Genre classification schemes loaded', { dir: env.GENRE_CS_DIR,
    terms: Object.fromEntries([...genreTerms].map(([uri, ids]) => [uri, ids.size])) });
  const keyPath = env.HTTPS_KEY_PATH, certPath = env.HTTPS_CERT_PATH;
  if (!keyPath && !certPath) {
    log('warn', 'serving plain HTTP: TS 103 770 clause 7.3 allows this only to clients on the same private subnet; set HTTPS_KEY_PATH and HTTPS_CERT_PATH for TLS');
    return app.listen(port, () => {
      log('info', 'Service List Registry listening', { port, tls: false });
      console.log(`DVB-I Service List Registry  ->  http://localhost:${port}/query`);
    });
  }
  if (!keyPath || !certPath) {
    throw new Error('HTTPS_KEY_PATH and HTTPS_CERT_PATH must be set together');
  }
  const versions = checkTlsVersions();
  if (versions.error) throw new Error(versions.error);
  if (versions.warning) log('warn', versions.warning);
  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
  return server.listen(port, () => {
    log('info', 'Service List Registry listening', { port, tls: true, minVersion: tls.DEFAULT_MIN_VERSION, maxVersion: tls.DEFAULT_MAX_VERSION });
    console.log(`DVB-I Service List Registry  ->  https://localhost:${port}/query`);
  });
}

if (require.main === module) {
  try { startServer(); }
  catch (e) {
    log('error', 'Service List Registry not started', { error: String(e.message || e) });
    process.exit(1);
  }
}

module.exports = { app, startServer, checkTlsVersions, buildEntryPoints, validate, matches, values, loadGenreSchemes, PARAMETERS, DELIVERY_ELEMENTS, DELIVERY_QUERY, GENRE_SCHEMES };
