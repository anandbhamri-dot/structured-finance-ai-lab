// Deletes every part of the example spec, one at a time, and runs what the validator accepts: the engine must never crash.
// FUZZ_STEP=n tries every n-th deletion (the default test run uses 4; CI's full run uses 1).
const STEP = +process.env.FUZZ_STEP || 1; let seen = 0;
const E = require('../src/engine.js'); const Dt = require('../src/data.js'); const S = Dt.scenarios(); const fill = require('./load.js').fillDefaults;
const clone = x => JSON.parse(JSON.stringify(x)); const base = Dt.EXAMPLE_CLO; const found = new Map(); let ran = 0, refused = 0;
function tryRun(spec, label) { if (seen++ % STEP) return; fill(spec); if (E.validateSpec(spec).errs.length) { refused++; return; } ran++;
  for (const sc of S) for (const mode of ['regular', 'liquidation']) { const inp = clone(sc.inputs); inp.mode = mode; inp.lite = true; inp.subHistory = [{ date: '2008-01-22', amount: 1e6 }];
    try { const r = E.run(spec, sc.tape, inp); if (!r.waterfalls) throw new Error('no waterfalls'); } catch (e) { const k = e.message + ' @ ' + (e.stack || '').split('\n')[1].trim(); if (!found.has(k)) found.set(k, label); } } }
function walk(o, pre, cb) { if (o == null || typeof o !== 'object') return; for (const k of Object.keys(o)) { cb(pre.concat(k)); walk(o[k], pre.concat(k), cb); } }
walk(base, [], p => { const s = clone(base); let o = s; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; if (Array.isArray(o)) o.splice(+p[p.length - 1], 1); else delete o[p[p.length - 1]]; tryRun(s, 'delete ' + p.join('.')); });
for (const [k, v] of found) console.log(k, '\n   <=', v); console.log(found.size, 'distinct; ran', ran, 'refused', refused);
process.exit(found.size ? 1 : 0);
