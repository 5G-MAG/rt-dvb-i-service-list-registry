#!/usr/bin/env node
/**
 * XSD conformance check for the registry's responses (optional, bring-your-own schemas).
 *
 * The schema is dvbi_service_list_discovery_v1.6.xsd, which ships in the electronic attachment
 * archive accompanying ETSI TS 103 770 (annex B lists it). No schema file is carried in this
 * repository and none may be: point DVBI_SCHEMAS at a directory holding the closure, kept outside
 * this working tree.
 *
 *   DVBI_SCHEMAS=~/.local/share/dvb-i-schemas/etsi npm run test:xsd
 *
 * Without it the check skips and exits 0, so npm test stays green either way.
 *
 * An offering may declare the local 5G delivery extension, whose type lives in a 5G-MAG namespace
 * the DVB schemas know nothing about. Point DVBI_5G_EXT_SCHEMA at dvbi-5g-ext-1.0.xsd, which the
 * provider repository carries, to check those documents too:
 *
 *   DVBI_5G_EXT_SCHEMA=../rt-dvb-i-application-provider/schemas/dvbi-5g-ext-1.0.xsd
 *
 * Without it, documents carrying the extension are reported NOT CHECKED rather than counted as
 * failures: an unresolvable xsi:type is a missing schema, not a defect in the response.
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const fs = require('fs');
const path = require('path');

const SCHEMAS = process.env.DVBI_SCHEMAS
  ? path.resolve(process.env.DVBI_SCHEMAS.replace(/^~(?=$|\/)/, process.env.HOME || '~'))
  : path.join(__dirname, 'schemas');
const SCHEMA = path.join(SCHEMAS, 'dvbi_service_list_discovery_v1.6.xsd');

if (!fs.existsSync(SCHEMA)) {
  console.log(`Registry XSD check: SKIPPED (no ${path.basename(SCHEMA)} at ${SCHEMAS}).`);
  console.log('Schemas are not bundled with this project and are not redistributed from it.');
  console.log('See the header of this file.');
  process.exit(0);
}

let libxml;
try { libxml = require('libxmljs2'); }
catch { console.error('libxmljs2 not installed. Run: npm install'); process.exit(2); }

const { buildEntryPoints } = require('../server.js');
// Both are validated: the fixture exercises filtering across several providers, and the shipped
// file is what this registry actually serves, so a bad edit to it fails here rather than at a
// client.
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-registry.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf8'));

const EXT_SCHEMA = process.env.DVBI_5G_EXT_SCHEMA
  ? path.resolve(process.env.DVBI_5G_EXT_SCHEMA.replace(/^~(?=$|\/)/, process.env.HOME || '~'))
  : null;
const extAvailable = EXT_SCHEMA && fs.existsSync(EXT_SCHEMA);
const usesExt = xml => xml.includes('urn:5g-mag:metadata:dvbi-5g:2026');

process.chdir(SCHEMAS);
// With the extension schema available, validate through a driver that imports both, so the
// xsi:type in a 5G offering resolves. Otherwise the published schema alone, and extension-carrying
// documents are skipped below.
const xsd = extAvailable
  ? libxml.parseXml(
      `<?xml version="1.0"?><schema xmlns="http://www.w3.org/2001/XMLSchema">
<import namespace="urn:dvb:metadata:servicelistdiscovery:2024" schemaLocation="./${path.basename(SCHEMA)}"/>
<import namespace="urn:5g-mag:metadata:dvbi-5g:2026" schemaLocation="${EXT_SCHEMA}"/></schema>`,
      { baseUrl: path.join(SCHEMAS, 'driver.xsd') })
  : libxml.parseXml(fs.readFileSync(SCHEMA, 'utf8'), { baseUrl: SCHEMA });

let failures = 0;
let skipped = 0;
function check(label, xml) {
  if (usesExt(xml) && !extAvailable) {
    skipped++;
    console.log(`  ~ ${label}: NOT CHECKED — carries the LOCAL 5G delivery extension`);
    console.log('      (set DVBI_5G_EXT_SCHEMA to dvbi-5g-ext-1.0.xsd to check it)');
    return;
  }
  const doc = libxml.parseXml(xml);
  let ok;
  try { ok = doc.validate(xsd); }
  catch (e) { console.log(`  x ${label}: schema/parse error: ${e.message}`); failures++; return; }
  if (ok) console.log(`  + ${label}: VALID`);
  else {
    failures++;
    console.log(`  x ${label}: INVALID`);
    (doc.validationErrors || []).slice(0, 12).forEach(e => console.log(`      - ${String(e.message).trim()}`));
  }
}

console.log('DVB-I Service List Registry XSD conformance\n');
console.log(`Schema: ${SCHEMA}\n`);

// The empty query is the one every client can make, and a filtered query has to stay valid too:
// filtering removes whole offerings and providers, which is where a sequence can go wrong.
check('fixture, no query parameters', buildEntryPoints(fixture, {}));
check('fixture, TargetCountry=ITA', buildEntryPoints(fixture, { TargetCountry: 'ITA' }));
check('fixture, regulatorListFlag=true', buildEntryPoints(fixture, { regulatorListFlag: 'true' }));
check('fixture, Delivery[]=dvb-dash&Delivery[]=dvb-t', buildEntryPoints(fixture, { 'Delivery[]': ['dvb-dash', 'dvb-t'] }));
// A query matching nothing still has to produce a valid document: ProviderOffering is minOccurs=0.
check('fixture, no matches', buildEntryPoints(fixture, { TargetCountry: 'ZWE' }));
// And what this registry actually serves.
check('registry.json as shipped', buildEntryPoints(registry, {}));
// The local 5G extension is kept out of the fixture itself, so the cases above stay checkable
// against the published schema alone, and exercised here on a copy that declares it.
const with5g = JSON.parse(JSON.stringify(fixture));
with5g.providers[0].offerings[0].extensions = ['5g-mbms'];
check('fixture + LOCAL 5G delivery extension', buildEntryPoints(with5g, {}));

const tail = skipped ? ` (${skipped} not checked, see above)` : '';
console.log(`\n==== ${failures === 0 ? 'ALL VALID' + tail : failures + ' FAILURE(S)'} ====`);
process.exit(failures === 0 ? 0 : 1);
