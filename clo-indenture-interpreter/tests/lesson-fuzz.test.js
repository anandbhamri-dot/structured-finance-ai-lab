// Random lessons, including hostile text, must never break the reader, the validator or the engine.
const fs = require('fs'); const path = require('path'); const L = require('./load.js');
const raw = fs.readFileSync(path.join(__dirname, '..', 'sample_inputs', 'example-clo-indenture.txt'), 'utf8');
const DOCS = { a: L.htmlToPages(raw, false), b: L.htmlToPages(raw.replace(/Senior Collateral Management Fee/g, 'Base Fee').replace(/Synthetic Securities/g, 'Linked Notes'), false) };
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; const pick = a => a[Math.floor(rnd() * a.length)];
const FIELDS = L.RR_FIELDS.map(f => f.key), TYPES = L.RR_CLAUSE_TYPES.map(t => t[0]), CATS = Object.keys(L.RR_CONC);
const HOSTILE = ['(((', '.*', '\\', '$^', '[a-', '"', '“”', 'a'.repeat(400), '?:)', '\u0000x', 'the', 'Notes', 'Class A', 'to the payment of'];
const phrase = d => { const T = pick(DOCS[d]); const i = Math.floor(rnd() * Math.max(1, T.length - 60)); return rnd() < 0.15 ? pick(HOSTILE) : T.slice(i, i + 8 + Math.floor(rnd() * 50)); };
const N = +process.env.FUZZ_N || 120; const crashes = new Map(); let runs = 0;
for (let n = 0; n < N; n++) {
  const L1 = { values: [], clauses: [], conc: [] };
  for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) { const r = rnd(), f = pick(FIELDS), d = pick(['a', 'b']);
    if (r < 0.25) L1.values.push({ field: f, term: phrase(d) }); else if (r < 0.45) L1.values.push({ field: f, phrase: phrase(d) });
    else if (r < 0.55) L1.values.push({ field: f, value: pick(['0.15%', '2,850', '$45m', '2031-10-15', '20% above 12%', '0.02% + $200,000', 'x', '-5', '1e9', '']), doc: pick(['any|1|1', L.readDealText(DOCS[d], d).docKey]) });
    else if (r < 0.8) L1.clauses.push({ phrase: phrase(d), type: pick(TYPES), k: pick(['any', 'interest', 'principal', 'liquidation']), override: rnd() < 0.5 });
    else L1.conc.push({ phrase: phrase(d), cat: pick(CATS), override: rnd() < 0.5 }); }
  for (const d of Object.keys(DOCS)) { runs++;
    try { const r = L.readDealText(DOCS[d], d, L1); L.fillDefaults(r.spec); if (!L.E.validateSpec(r.spec).errs.length) { const S = L.DATA.scenarios()[1]; const res = L.E.run(r.spec, S.tape, Object.assign({}, S.inputs, { lite: true }));
        if (['interest', 'principal'].some(k => (res.waterfalls[k] || []).some(x => !isFinite(x.paid) || x.paid < -0.005))) throw new Error('non-finite or negative payment'); } }
    catch (e) { const key = e.message.split('\n')[0].slice(0, 120); if (!crashes.has(key)) crashes.set(key, JSON.stringify(L1).slice(0, 300)); } }
}
for (const [k, v] of crashes) console.log(' -', k, '\n   ', v);
console.log(crashes.size + ' distinct failures; ' + runs + ' readings'); process.exit(crashes.size ? 1 : 0);
