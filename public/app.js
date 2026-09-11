// Everything rendered here comes from the registry's own files, and is inserted as text rather than
// markup: a registry entry is operator-supplied, and this page has no reason to let it become HTML.
const el = id => document.getElementById(id);
const text = (tag, s) => { const n = document.createElement(tag); n.textContent = s; return n; };

const QUERIES = [
  ['everything', ''],
  ['TargetCountry=CHE', '?TargetCountry=CHE'],
  ['TargetCountry=ITA', '?TargetCountry=ITA'],
  ['two countries', '?TargetCountry[]=CHE&TargetCountry[]=ITA'],
  ['regulator lists', '?regulatorListFlag=true'],
  ['DASH or DVB-T', '?Delivery[]=dash&Delivery[]=dvb-t'],
  ['an unknown parameter', '?Nonsense=1'],
];

async function run(suffix) {
  const out = el('out');
  out.textContent = 'Requesting…';
  try {
    const res = await fetch('/query' + suffix);
    const body = await res.text();
    out.textContent = `HTTP ${res.status}\n\n${body}`;
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

  const row = el('queries');
  for (const [label, suffix] of QUERIES) {
    const b = text('button', label);
    b.addEventListener('click', () => {
      for (const other of row.children) other.classList.remove('on');
      b.classList.add('on');
      run(suffix);
    });
    row.appendChild(b);
  }
})();
