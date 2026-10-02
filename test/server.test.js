// The query interface is specified, so these cases follow TS 103 770 V1.2.1 clause 5.1.3.2 rather
// than this implementation's own choices: which parameters exist, how repeated values combine, and
// which status code an unacceptable query gets.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, buildEntryPoints, validate, values, PARAMETERS } = require('../server.js');

// Tests read a fixture, not the shipped registry.json: that file is operator data and is meant to
// be edited, so asserting on its contents makes every edit a test failure and lets coverage shrink
// whenever an entry is removed.
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-registry.json'), 'utf8'));
const count = xml => (xml.match(/<ServiceListOffering>/g) || []).length;

test('the accepted parameters are those the clause lists, in its order', () => {
  assert.deepEqual(PARAMETERS, ['TargetCountry', 'regulatorListFlag', 'Delivery', 'Language',
                                'Genre', 'ProviderName', 'inlineImages']);
});

test('an undefined query parameter is refused with 400', () => {
  const p = validate({ NotAParameter: 'x' });
  assert.equal(p && p.status, 400);
  assert.match(p.message, /Unknown query parameter/);
});

test('an invalid value for a parameter is refused with 400', () => {
  assert.equal(validate({ TargetCountry: 'Italy' }).status, 400, 'country must be a 3-letter code');
  assert.equal(validate({ Delivery: 'carrier-pigeon' }).status, 400);
  assert.equal(validate({ regulatorListFlag: 'yes' }).status, 400, 'expects true or false');
  assert.equal(validate({ inlineImages: '1' }).status, 400);
});

test('a valid query is accepted', () => {
  assert.equal(validate({}), null, 'no parameters at all is a valid query');
  assert.equal(validate({ TargetCountry: 'ITA', regulatorListFlag: 'true' }), null);
  assert.equal(validate({ 'Delivery[]': ['dvb-dash', 'dvb-t'] }), null);
});

// The Delivery query values are not the DeliveryType element names: TS 103 770 V1.2.1 clause
// 5.3.6.1, table 12b defines its own set, two rows of which cover more than one element. Querying
// with an element name (dash, rtsp, multicast-ts) is an invalid value and gets a 400.
test('Delivery queries use the table 12b values, not the DeliveryType element names', () => {
  assert.equal(validate({ Delivery: 'dash' }).status, 400, '"dash" is an element name, not a query value');
  assert.equal(validate({ Delivery: 'rtsp' }).status, 400);
  assert.equal(validate({ Delivery: 'multicast-ts' }).status, 400);
  assert.equal(validate({ Delivery: 'dvb-iptv' }), null);

  // dvb-dash matches the DASHDelivery both fixture offerings declare.
  assert.equal(count(buildEntryPoints(registry, { Delivery: 'dvb-dash' })), 2);
  // dvb-iptv is "MulticastTSDelivery and/or RTSPDelivery", and only List Two declares RTSPDelivery.
  const iptv = buildEntryPoints(registry, { Delivery: 'dvb-iptv' });
  assert.equal(count(iptv), 1);
  assert.match(iptv, /List Two/);
  // A delivery nothing declares matches nothing.
  assert.equal(count(buildEntryPoints(registry, { Delivery: 'dvb-s' })), 0);
});

test('repeated values arrive whether written with or without square brackets', () => {
  assert.deepEqual(values({ TargetCountry: 'ITA' }, 'TargetCountry'), ['ITA']);
  assert.deepEqual(values({ 'TargetCountry[]': ['AUT', 'DEU'] }, 'TargetCountry'), ['AUT', 'DEU']);
});

test('multiple values for one parameter are alternatives, not a conjunction', () => {
  // The clause: values for the same parameter are interpreted "using the OR logical operator".
  const both = buildEntryPoints(registry, { 'TargetCountry[]': ['ITA', 'CHE'] });
  assert.equal(count(both), 2, 'a list for either country is included');
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'ITA' })), 1);
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'CHE' })), 1);
});

test('different parameters narrow the result together', () => {
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'ITA', regulatorListFlag: 'true' })), 1);
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'ITA', regulatorListFlag: 'false' })), 0,
    'List Two is a regulator list, so asking for a non-regulator one excludes it');
});

test('a query matching nothing still returns a document, not an error', () => {
  const xml = buildEntryPoints(registry, { TargetCountry: 'ZWE' });
  assert.equal(count(xml), 0);
  assert.match(xml, /<ServiceListEntryPoints/, 'ProviderOffering is optional, so an empty answer is well-formed');
});

test('ProviderName selects one provider', () => {
  assert.equal(count(buildEntryPoints(registry, { ProviderName: 'Provider One' })), 1);
  assert.equal(count(buildEntryPoints(registry, { ProviderName: 'Nobody' })), 0);
});

test('the endpoint answers over HTTP with the specified status codes', async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/query?TargetCountry=ITA`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type') || '', /xml/);

    assert.equal((await fetch(`${base}/query?Nonsense=1`)).status, 400);
    assert.equal((await fetch(`${base}/query?TargetCountry=Italy`)).status, 400);
    assert.equal((await fetch(`${base}/query`)).status, 200, 'a query with no parameters is allowed here');
  } finally {
    server.close();
  }
});

test('an over-long request URL is refused', async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // The clause caps a fully qualified registry URL at 2048 characters.
    const many = Array.from({ length: 400 }, () => 'TargetCountry[]=ITA').join('&');
    const res = await fetch(`${base}/query?${many}`);
    assert.equal(res.status, 414);
  } finally {
    server.close();
  }
});

// Table 12b is a closed set with no value for 5G delivery, so a client asking for one gets the 400 any
// other undefined value gets, and no offering is marked as carried over 5G.
test('no Delivery query value for 5G delivery, and no 5G marker in responses', () => {
  assert.equal(validate({ Delivery: '5g-mbms' }).status, 400);
  assert.equal(validate({ Delivery: '5g' }).status, 400);
  assert.doesNotMatch(buildEntryPoints(registry, {}), /dvbi-5g|OtherDeliveryParameters/);
});
