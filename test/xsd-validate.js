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

process.chdir(SCHEMAS);
const xsd = libxml.parseXml(fs.readFileSync(SCHEMA, 'utf8'), { baseUrl: SCHEMA });

let failures = 0;
function check(label, xml) {
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

console.log(`\n==== ${failures === 0 ? 'ALL VALID' : failures + ' FAILURE(S)'} ====`);
process.exit(failures === 0 ? 0 : 1);
