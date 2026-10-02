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
const count = xml => (xml.match(/<ServiceListOffering[ >]/g) || []).length;

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

// TargetCountry is tva:ISO-3166-List, pattern [A-Z]{3}(,[A-Z]{3})*; Language is based on the XML
// Schema type language, pattern [a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*. A value outside the type is
// "an invalid value" and gets the 400 of clause 5.1.3.2.
test('TargetCountry and Language values outside their schema types are refused with 400', () => {
  for (const c of ['ita', 'Ita', 'IT', 'ITAL', 'ITA,', 'ITA;DEU', 'ITA, DEU']) {
    assert.equal(validate({ TargetCountry: c })?.status, 400, `TargetCountry "${c}"`);
    assert.equal(validate({ 'TargetCountry[]': ['DEU', c] })?.status, 400, `TargetCountry[] "${c}"`);
  }
  for (const c of ['ITA', 'ITA,DEU']) assert.equal(validate({ TargetCountry: c }), null, `TargetCountry "${c}"`);

  for (const l of ['english!', 'en_GB', 'toolongtag', 'en-', '-en', 'en--GB', 'en-toolongsub', '1']) {
    assert.equal(validate({ Language: l })?.status, 400, `Language "${l}"`);
    assert.equal(validate({ 'Language[]': ['de', l] })?.status, 400, `Language[] "${l}"`);
  }
  for (const l of ['en', 'DE', 'de-CH', 'zh-Hant-TW', 'i-klingon', 'x-a1b2c3d4']) {
    assert.equal(validate({ Language: l }), null, `Language "${l}"`);
  }
});

test('a TargetCountry value listing several codes matches an offering for any of them', () => {
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'DEU,ITA' })), 2);
  assert.equal(count(buildEntryPoints(registry, { TargetCountry: 'FRA,ITA' })), 1);
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

// Clause 5.1.3.2 includes offerings that "do not specify a TargetCountry"; table 12 does the same
// for an offering with no Language and one with no Genre.
test('an offering that specifies no TargetCountry, Language or Genre matches a query for it', () => {
  const open = {
    registry: { name: 'Test Registry' },
    providers: [{
      name: 'Provider',
      offerings: [
        { id: 'tag:example.com,2026:list:constrained', name: 'Constrained', uris: ['https://c.example.com/sl.xml'],
          delivery: ['dash'], languages: ['it'], genres: ['urn:dvb:metadata:cs:ContentSubject:2019:4'], countries: ['ITA'] },
        { id: 'tag:example.com,2026:list:open', name: 'Open', uris: ['https://o.example.com/sl.xml'],
          delivery: ['dash'], languages: [], genres: [], countries: [] },
        { id: 'tag:example.com,2026:list:absent', name: 'Absent', uris: ['https://a.example.com/sl.xml'],
          delivery: ['dash'] },
      ],
    }],
  };
  const names = xml => [...xml.matchAll(/<dvbisd-t:ServiceListName>([^<]*)</g)].map(m => m[1]);

  assert.deepEqual(names(buildEntryPoints(open, { TargetCountry: 'DEU' })), ['Open', 'Absent']);
  assert.deepEqual(names(buildEntryPoints(open, { TargetCountry: 'ITA' })), ['Constrained', 'Open', 'Absent']);
  assert.deepEqual(names(buildEntryPoints(open, { Language: 'fr' })), ['Open', 'Absent']);
  assert.deepEqual(names(buildEntryPoints(open, { Language: 'it' })), ['Constrained', 'Open', 'Absent']);
  assert.deepEqual(names(buildEntryPoints(open, { Genre: 'urn:dvb:metadata:cs:ContentSubject:2019:1' })), ['Open', 'Absent']);
  assert.deepEqual(names(buildEntryPoints(open, { Genre: 'urn:dvb:metadata:cs:ContentSubject:2019:4' })),
    ['Constrained', 'Open', 'Absent']);
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
    assert.equal((await fetch(`${base}/query?TargetCountry=ita`)).status, 400);
    assert.equal((await fetch(`${base}/query?Language=en_GB`)).status, 400);
    assert.equal((await fetch(`${base}/query?TargetCountry=ITA&Language=it`)).status, 200);
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

const deliveryFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-delivery.json'), 'utf8'));
const offeringBlock = (xml, name) => xml.split(/(?=<ServiceListOffering[ >])/)
  .find(b => b.includes(`<dvbisd-t:ServiceListName>${name}</dvbisd-t:ServiceListName>`));

// A Service List is served as application/vnd.dvb.dvbisl+xml (clause 5.1.2), and
// ServiceListURI@contentType is the MIME type of the object the URI identifies (table 22).
test('every ServiceListURI carries the service list media type', () => {
  const xml = buildEntryPoints(registry, {});
  const types = [...xml.matchAll(/<dvbisd-t:ServiceListURI contentType="([^"]*)">/g)].map(m => m[1]);
  assert.equal(types.length, 2);
  assert.deepEqual([...new Set(types)], ['application/vnd.dvb.dvbisl+xml']);
});

// Table 12: @regulatorListFlag defaults to false, so a regulator's list has to state true.
test('a regulator list carries regulatorListFlag="true" and any other list leaves the default', () => {
  const xml = buildEntryPoints(registry, {});
  assert.match(offeringBlock(xml, 'List Two'), /^<ServiceListOffering regulatorListFlag="true">/);
  assert.match(offeringBlock(xml, 'List One'), /^<ServiceListOffering>/);
  assert.match(offeringBlock(buildEntryPoints(registry, { regulatorListFlag: 'true' }), 'List Two'),
    /regulatorListFlag="true"/);
});

// DVBCDelivery@networkID (table 12f), DVBSDelivery/OrbitalPosition (table 12g) and
// ApplicationDelivery/ApplicationType with @contentType (tables 12h, 12i) are mandatory, so these
// elements are emitted with their values or not at all.
test('DVBCDelivery, DVBSDelivery and ApplicationDelivery are emitted complete or not at all', () => {
  const xml = buildEntryPoints(deliveryFixture, {});
  const complete = offeringBlock(xml, 'Complete');
  assert.match(complete, /<dvbisd-t:DVBCDelivery networkID="4369"\/>/);
  assert.match(complete, /<dvbisd-t:DVBCDelivery networkID="0"\/>/);
  assert.match(complete, /<dvbisd-t:DVBSDelivery>\s*<dvbisd-t:OrbitalPosition>19.2<\/dvbisd-t:OrbitalPosition>\s*<dvbisd-t:OrbitalPosition>-0.8<\/dvbisd-t:OrbitalPosition>\s*<\/dvbisd-t:DVBSDelivery>/);
  assert.match(complete, /<dvbisd-t:DVBSDelivery>\s*<dvbisd-t:OrbitalPosition>180<\/dvbisd-t:OrbitalPosition>\s*<\/dvbisd-t:DVBSDelivery>/);
  assert.match(complete, /<dvbisd-t:ApplicationDelivery>\s*<dvbisd-t:ApplicationType contentType="application\/vnd.dvb.ait\+xml" xmlAitApplicationType="application\/vnd.hbbtv.xhtml\+xml"\/>\s*<dvbisd-t:ApplicationType contentType="text\/html"\/>\s*<\/dvbisd-t:ApplicationDelivery>/);

  for (const name of ['Undeclared', 'Invalid']) {
    assert.doesNotMatch(offeringBlock(xml, name), /DVBCDelivery|DVBSDelivery|ApplicationDelivery|ApplicationType/, name);
  }
  assert.match(offeringBlock(xml, 'Invalid'), /<dvbisd-t:DASHDelivery\/>/, 'deliveries without mandatory content are still emitted');

  // Table 12b names the DeliveryTypes "required in query response Service List Offerings", so an
  // offering whose element could not be emitted does not match a query for it.
  const names = q => [...buildEntryPoints(deliveryFixture, q).matchAll(/<dvbisd-t:ServiceListName>([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(names({ Delivery: 'dvb-c' }), ['Complete']);
  assert.deepEqual(names({ Delivery: 'dvb-s' }), ['Complete']);
  assert.deepEqual(names({ Delivery: 'application' }), ['Complete']);
});

// Table 12b is a closed set with no value for 5G delivery, so a client asking for one gets the 400 any
// other undefined value gets, and no offering is marked as carried over 5G.
test('no Delivery query value for 5G delivery, and no 5G marker in responses', () => {
  assert.equal(validate({ Delivery: '5g-mbms' }).status, 400);
  assert.equal(validate({ Delivery: '5g' }).status, 400);
  assert.doesNotMatch(buildEntryPoints(registry, {}), /dvbi-5g|OtherDeliveryParameters/);
});

// TS 103 770 clause 7.3: a Service List Registry is reached over HTTP over TLS, and a metadata
// endpoint server "shall support TLS version 1.2" and "should support TLS version 1.3". The key and
// certificate are made for the test with openssl, for localhost and 127.0.0.1.
const os = require('node:os');
const tls = require('node:tls');
const https = require('node:https');
const { execFileSync, spawnSync } = require('node:child_process');
const { startServer, checkTlsVersions } = require('../server.js');

function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-tls-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { dir, key, cert };
}

test('with a key and certificate configured, the registry answers over TLS 1.2 and TLS 1.3', async () => {
  const pki = makeCertificate();
  const ca = fs.readFileSync(pki.cert);
  const server = startServer({ port: 0, env: { HTTPS_KEY_PATH: pki.key, HTTPS_CERT_PATH: pki.cert } });
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  try {
    for (const version of ['TLSv1.2', 'TLSv1.3']) {
      const negotiated = await new Promise((resolve, reject) => {
        const s = tls.connect({ host: '127.0.0.1', port, ca, servername: 'localhost',
          minVersion: version, maxVersion: version }, () => { resolve(s.getProtocol()); s.end(); });
        s.on('error', reject);
      });
      assert.equal(negotiated, version);
    }
    const res = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, path: '/query?TargetCountry=ITA', ca, servername: 'localhost' }, r => {
        let body = '';
        r.on('data', c => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body }));
      }).on('error', reject);
    });
    assert.equal(res.status, 200);
    assert.match(res.type || '', /xml/);
    assert.match(res.body, /<ServiceListEntryPoints/);

    // The TLS port does not also answer plain HTTP.
    await assert.rejects(fetch(`http://127.0.0.1:${port}/query`));
  } finally {
    server.close();
    fs.rmSync(pki.dir, { recursive: true, force: true });
  }
});

test('with neither key nor certificate configured, the registry serves plain HTTP', async () => {
  const server = startServer({ port: 0, env: {} });
  await new Promise(r => server.once('listening', r));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/query`)).status, 200);
  } finally {
    server.close();
  }
});

test('a TLS configuration that is incomplete or cannot be loaded stops the server, with no HTTP fallback', () => {
  const pki = makeCertificate();
  try {
    assert.throws(() => startServer({ port: 0, env: { HTTPS_KEY_PATH: pki.key } }), /set together/);
    assert.throws(() => startServer({ port: 0, env: { HTTPS_CERT_PATH: pki.cert } }), /set together/);
    assert.throws(() => startServer({ port: 0, env: { HTTPS_KEY_PATH: path.join(pki.dir, 'missing.pem'), HTTPS_CERT_PATH: pki.cert } }), /ENOENT/);
    const bad = path.join(pki.dir, 'bad.pem');
    fs.writeFileSync(bad, 'not a key');
    assert.throws(() => startServer({ port: 0, env: { HTTPS_KEY_PATH: bad, HTTPS_CERT_PATH: pki.cert } }));

    // Started as a program, it exits non-zero instead of listening.
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: '0', HTTPS_KEY_PATH: bad, HTTPS_CERT_PATH: pki.cert, LOG_LEVEL: 'error' },
      encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /not started/);
  } finally {
    fs.rmSync(pki.dir, { recursive: true, force: true });
  }
});

test('TLS versions that exclude 1.2 stop the server; excluding 1.3 is reported', () => {
  assert.deepEqual(checkTlsVersions('TLSv1.2', 'TLSv1.3'), {});
  assert.deepEqual(checkTlsVersions('TLSv1', 'TLSv1.3'), {});
  assert.match(checkTlsVersions('TLSv1.3', 'TLSv1.3').error, /TLSv1.2/);
  assert.match(checkTlsVersions('TLSv1', 'TLSv1.1').error, /TLSv1.2/);
  assert.match(checkTlsVersions('TLSv1.2', 'TLSv1.2').warning, /TLSv1.3/);

  // Node's own option for the minimum version reaches the check.
  const pki = makeCertificate();
  try {
    const run = spawnSync(process.execPath, ['--tls-min-v1.3', path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: '0', HTTPS_KEY_PATH: pki.key, HTTPS_CERT_PATH: pki.cert, LOG_LEVEL: 'error' },
      encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /exclude TLSv1.2/);
  } finally {
    fs.rmSync(pki.dir, { recursive: true, force: true });
  }
});
