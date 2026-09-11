// Everything rendered here comes from the registry's own files, and is inserted as text rather than
// markup: a registry entry is operator-supplied, and this page has no reason to let it become HTML.
const el = id => document.getElementById(id);
const text = (tag, s) => { const n = document.createElement(tag); n.textContent = s; return n; };

// The query is built from the form rather than offered as canned links, and the URL it produces is
// shown before it is sent: the point of this console is to make the interface of clause 5.1.3.2
// legible, including that repeated values are sent with square brackets.
function buildQuery() {
  const parts = [];
  const countries = el('f-country').value.split(/[,\s]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
  // One value is sent plainly; several use the square bracket form the clause requires.
  if (countries.length === 1) parts.push('TargetCountry=' + encodeURIComponent(countries[0]));
  else for (const c of countries) parts.push('TargetCountry[]=' + encodeURIComponent(c));

  const regulator = el('f-regulator').value;
  if (regulator) parts.push('regulatorListFlag=' + regulator);

  const delivery = el('f-delivery').value;
  if (delivery) parts.push('Delivery=' + encodeURIComponent(delivery));

  const provider = el('f-provider').value.trim();
  if (provider) parts.push('ProviderName=' + encodeURIComponent(provider));

  return parts.length ? '?' + parts.join('&') : '';
}

function showUrl() {
  el('q-url').textContent = '/query' + buildQuery();
}

async function run(suffix) {
  const out = el('out');
  out.textContent = 'Requesting…';
  try {
    const res = await fetch('/query' + suffix);
    const body = await res.text();
    const offerings = (body.match(/<ServiceListOffering>/g) || []).length;
    const summary = res.ok ? `HTTP ${res.status} — ${offerings} offering(s)` : `HTTP ${res.status}`;
    out.textContent = `${summary}\n\n${body}`;
  } catch (e) {
    out.textContent = String(e);
  }
}

(async () => {
  let data;
  try { data = await fetch('/api/offerings').then(r => r.json()); }
  catch (e) { el('sub').textContent = 'Could not read the registry: ' + e; return; }

  el('sub').textContent =
    `${data.registry?.name || 'This registry'} answers DVB-I clients asking which service lists exist. ` +
    `It is the Service List Registry of ETSI TS 103 770 clause 4.1; the query interface is clause 5.1.3.2. ` +
    `Registered entries are held in registry.json; there is no editing here, because how a registry ` +
    `collects and stores that is out of scope of the specification.`;
  el('params').textContent =
    'Parameters, in the order clause 5.1.3.2 presents them: ' + (data.parameters || []).join(', ') +
    '. Repeated values use square brackets and are read as alternatives.';

  const lists = (data.providers || []).reduce((n, p) => n + (p.offerings || []).length, 0);
  const countries = new Set();
  for (const p of data.providers || []) for (const o of p.offerings || []) (o.countries || []).forEach(c => countries.add(c));
  el('n-lists').textContent = lists;
  el('n-providers').textContent = (data.providers || []).length;
  el('n-countries').textContent = countries.size;

  const body = el('offerings');
  for (const provider of data.providers || []) {
    for (const o of provider.offerings || []) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.appendChild(text('div', o.name));
      if (o.regulator) name.appendChild(text('span', 'regulator list')).className = 'tag';
      tr.appendChild(name);
      tr.appendChild(text('td', provider.name));
      tr.appendChild(text('td', (o.countries || []).join(', ') || '—'));
      tr.appendChild(text('td', (o.delivery || []).join(', ') || '—'));
      const urls = document.createElement('td');
      for (const u of o.uris || []) urls.appendChild(text('div', u)).className = 'url';
      tr.appendChild(urls);
      body.appendChild(tr);
    }
  }
  if (!body.children.length) {
    const tr = document.createElement('tr');
    const td = text('td', 'Nothing registered.');
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  const sel = el('f-delivery');
  sel.appendChild(text('option', 'any')).value = '';
  for (const d of data.delivery || []) sel.appendChild(text('option', d)).value = d;

  for (const id of ['f-country', 'f-delivery', 'f-provider', 'f-regulator']) {
    el(id).addEventListener('input', showUrl);
    el(id).addEventListener('change', showUrl);
  }
  el('q').addEventListener('submit', e => { e.preventDefault(); run(buildQuery()); });
  showUrl();
})();
