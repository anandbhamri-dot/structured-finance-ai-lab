// The projection must conserve par and cash, move the right way under stress, and run from every scenario.
const L = require('./load.js'); const { projectDeal, projDefaults, PROJ_PRESETS } = require('../src/projection.js');
const E = L.E, spec = L.DATA.EXAMPLE_CLO;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
for (const sc of L.DATA.scenarios()) {
  console.log('## from ' + sc.inputs.paymentDate);
  const r0 = E.run(spec, sc.tape, sc.inputs); const A0 = projDefaults(spec, r0, sc.inputs); const out = {};
  for (const p of PROJ_PRESETS) out[p.id] = projectDeal(E, spec, sc.tape, sc.inputs, Object.assign({}, A0, p), r0);
  for (const [id, o] of Object.entries(out)) {
    const P = o.periods; let parOK = true, noteOK = true, numOK = true; let prev = null;
    P.forEach((p, i) => {
      const exp = p.poolStart - p.defaults - p.prepay - p.scheduled + p.boughtPar; if (p.mode !== 'liquidation' && Math.abs(exp - p.poolEnd) > 1) parOK = false;
      if (i > 0 && Math.abs(P[i - 1].poolEnd - p.poolStart) > 1) parOK = false;
      spec.classes.forEach(c => { const n = p.notes[c.id]; const before = prev ? prev.notes[c.id].bal : r0.notes[c.id].balEnd; if (!c.deferrable && Math.abs(before - n.prin - n.bal) > 1) noteOK = false; if (n.bal < -0.01) noteOK = false; });
      [p.interest, p.principal, p.equity, p.poolEnd].forEach(v => { if (!isFinite(v) || v < -0.01) numOK = false; }); prev = p;
    });
    ok(parOK, id + ': collateral par rolls forward period to period');
    ok(noteOK, id + ': note balances fall only by the principal paid');
    ok(numOK, id + ': no negative or missing figures (' + P.length + ' dates to ' + o.endDate + ')');
    ok(o.classes.every(c => c.prin <= c.start + 1), id + ': no class gets back more principal than it had');
  }
  const loss = id => out[id].classes.reduce((s, c) => s + c.loss, 0);
  ok(loss('base') <= loss('stress') + 1 && loss('stress') <= loss('severe') + 1, 'losses rise from Base to Stress to Severe: ' + ['base', 'stress', 'severe'].map(k => (loss(k) / 1e6).toFixed(1) + 'm').join(' / '));
  ok(out.base.equity.total >= out.severe.equity.total - 1, 'equity receives more in Base than in Severe');
  const A = out.base.classes.find(c => c.id === 'A'); ok(A.loss < 1, 'Class A is repaid in full in Base');
}
// a call: sold on the chosen date, nothing after it
{ const sc = L.DATA.scenarios()[0]; const r0 = E.run(spec, sc.tape, sc.inputs); const call = '2012-01-18';
  const o = projectDeal(E, spec, sc.tape, sc.inputs, Object.assign({}, projDefaults(spec, r0, sc.inputs), PROJ_PRESETS[0], { callDate: call, callPrice: 100 }), r0);
  ok(o.endDate === call && o.called, 'a call ends the projection on its date');
  ok(o.classes.every(c => c.loss < 1), 'at a par call every class is repaid'); }
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
