// Prints the engine's key results for each built-in scenario; tests/regress.test.js compares them with tests/golden/regress.txt.
const E = require('../src/engine.js'); const Dt = require('../src/data.js'); const S = Dt.scenarios(); const spec = Dt.EXAMPLE_CLO;
for (const [lab, tape, inp] of [['jan08', S[0].tape, S[0].inputs], ['apr09', S[1].tape, S[1].inputs], ['oct16', S[2].tape, S[2].inputs], ['apr09 +4%', Dt.applyStress(S[1].tape, { extraDefaultPct: 4 }, S[1].inputs.paymentDate), S[1].inputs]]) {
  const r = E.run(spec, tape, inp);
  const ic = r.waterfalls.interest; const g = id => ic.find(x => x.id === id);
  console.log(lab.padEnd(10), 'IP', r.interestProceeds.toFixed(2), '| E-OC', r.preTests[3].oc.ratio.toFixed(4), '| M', g('M').paid.toFixed(2), '| P', g('P').paid.toFixed(2), '| equity', r.ctx.subPaidToday.toFixed(2), '| incentive', r.ctx.cmIncentive.toFixed(2), '| post E-OC', r.postTests[3].oc.ratio.toFixed(4));
}
