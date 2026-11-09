// Re-evaluates every expression shown in the calculation panels and checks totals tie to the ledger.
const E = require('../src/engine.js'); const Dt = require('../src/data.js');
const spec = Dt.EXAMPLE_CLO;
const num = s => +String(s).replace(/,/g, '').replace('−', '-');
function evalExpr(expr) {
  if (!expr || /[a-zA-Z]/.test(expr.replace(/\^/g, ''))) return null; // has words: descriptive, not arithmetic
  let s = expr.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/\^/g, '**');
  s = s.replace(/(\d[\d,]*\.?\d*)%/g, (m, a) => '(' + a.replace(/,/g, '') + '/100)');
  s = s.replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d),(\d{3})/g, '$1$2');
  if (/[^0-9+\-*/(). ]/.test(s)) return null;
  try { return Function('return (' + s + ')')(); } catch (e) { return undefined; }
}
let checked = 0, problems = 0, ties = 0; let lastTableSum = null;
function audit(label, tape, inputs, runner) {
  const r = runner ? runner(spec, tape, inputs) : E.run(spec, tape, inputs);
  const lists = Object.entries(r.waterfalls);
  if (r.sourceCalc) Object.entries(r.sourceCalc).forEach(([k, lines]) => lines.forEach(l => chk(label + ' source ' + k, l)));
  for (const [k, rows] of lists) for (const row of rows) {
    const where = label + ' ' + k + ' ' + row.id;
    if (!row.calc || !row.calc.due.length || !row.calc.paid.length) { console.log('MISSING calc', where); problems++; continue; }
    [...row.calc.due, ...row.calc.paid].forEach(l => chk(where, l));
    // ties
    const dueT = row.calc.due.filter(l => l.t === 'total' && /^Due/.test(l.label)).pop();
    if (!row.skipped && dueT && Math.abs(dueT.value - row.due) > 0.01) { console.log('DUE TIE', where, dueT.value, row.due); problems++; } else ties++;
    const left = row.calc.paid.filter(l => l.label === 'Cash left for the next step').pop();
    if (!row.skipped && left && Math.abs(left.value - row.after) > 0.01) { console.log('CASH TIE', where, left.value, row.after); problems++; } else ties++;
    if (!row.skipped) { ties++; const used = row.before - row.after; if (Math.abs(used - row.paid) > 0.011) { console.log('CASH USED vs PAID', where, used, row.paid); problems++; } }
    ties++; const pay = row.payees.reduce((s, p) => s + p.amount, 0); if (!row.skipped && Math.abs(pay - row.paid) > 0.011 && row.type !== 'subMgmtFee') { console.log('PAYEES vs PAID', where, pay, row.paid); problems++; }
    const paidT = row.calc.paid.filter(l => l.t === 'total' && l.label === 'Paid').pop();
    if (paidT && Math.abs(paidT.value - row.paid) > 0.01) { console.log('PAID TIE', where, paidT.value, row.paid); problems++; } else ties++;
  }
  // tests tab: numerator and denominator working
  const T = r.testCalc; const parts = [];
  Object.entries(T.coverage).forEach(([id, x]) => ['oc', 'ic', 'ocAfter'].forEach(k => x[k] && ['num', 'den'].forEach(p => parts.push(['cov ' + id + ' ' + k + ' ' + p, x[k][p]]))));
  ['irt', 'eod', 'irtAfter', 'eodAfter'].forEach(k => T[k] && ['num', 'den'].forEach(p => parts.push([k + ' ' + p, T[k][p]])));
  Object.entries(T.quality).forEach(([id, x]) => ['num', 'den'].forEach(p => parts.push(['quality ' + id + ' ' + p, x[p]])));
  Object.entries(T.conc).forEach(([id, x]) => ['num', 'den'].forEach(p => parts.push(['conc ' + id + ' ' + p, x[p]])));
  for (const [w, P] of parts) {
    const where = label + ' ' + w;
    P.lines.forEach(l => chk(where, l));
    P.lines.forEach(l => {
      if (!/^sum of the (last|Par) column/.test(l.expr || '')) return;
      const cands = /second table/.test(l.expr) ? [P.tables[1]] : P.tables.filter(t => t.total && (/last/.test(l.expr) || t.cols.some(c => c.label === 'Par')));
      const vals = cands.map(tab => tab.total[/last/.test(l.expr) ? tab.cols.length - 1 : tab.cols.findIndex(c => c.label === 'Par')]);
      ties++; if (!vals.some(v => Math.abs(v - l.value) <= 0.011 + Math.abs(l.value) * 1e-12)) { console.log('TABLE TIE', where, l.label, vals, l.value); problems++; }
    });
    P.tables.forEach(t => t.rows.forEach(rw => { if (rw.length !== t.cols.length) { console.log('ROW WIDTH', where, t.title); problems++; } }));
  }
  r.preTests.forEach((t, i) => { const ln = T.coverage[t.id].oc.num.lines.find(l => /OC ratio$/.test(l.label)); ties++; if (ln.value !== (t.oc.ratio === Infinity ? 'n/m (no notes outstanding)' : t.oc.ratio.toFixed(4) + '%')) { console.log('OC RATIO TIE', label, t.id, ln.value, t.oc.ratio); problems++; } });
  // a coverage test whose numerator you adjusted shows the same value less the loans left out; the first one you did not adjust shows the PCV itself
  const adjCov = (r.testAdjust && r.testAdjust.coverage) || []; const t0 = r.preTests.find(t => !adjCov.includes(t.id));
  if (t0) {
    const pcvT = T.coverage[t0.id].oc.num; const all = pcvT.tables[pcvT.tables.length - 1]; const ci = all.cols.findIndex(c => c.label === 'Carried at');
    ties++; if (Math.abs(all.total[ci] + (inputs.principalCashInPCV === false ? 0 : r.principalProceeds) - r.pcvInterp) > 0.011) { console.log('PCV TABLE TIE', label, all.total[ci], r.pcvInterp); problems++; }
    ties++; if (Math.abs(r.pcvStart - pcvT.value) > 0.011) { console.log('PCV START TIE', label, r.pcvStart, pcvT.value); problems++; }
  }
  adjCov.forEach(id => { const P = id === 'irt' || id === 'eod' ? T[id] && T[id].num : T.coverage[id] && T.coverage[id].oc.num; if (!P) return; const left = P.tables[0]; const ln = P.lines.find(l => /^Loans you left out of the numerator/.test(l.label)); ties++; if (!ln || Math.abs(r.pcvStart - ln.value - P.value) > 0.011 || Math.abs(left.total[left.cols.length - 1] - ln.value) > 0.011) { console.log('ADJUSTED PCV TIE', label, id); problems++; } });
  r.conc.forEach(c => { const x = T.conc[c.id]; ties++; if (Math.abs(x.num.value / x.den.value * 100 - c.value) > 1e-9) { console.log('CONC TIE', label, c.id); problems++; } });
  return r;
}
function chk(where, l) {
  if (l.t === 'table' && l.head[0] === 'Date') { let s = 0; l.rows.slice(1).forEach(rw => { checked++; const v = num(rw[2]) * +rw[3]; if (Math.abs(v - num(rw[4])) > 0.011) { console.log('PV ROW', where, rw); problems++; } s += num(rw[4]); }); l._sum = s; lastTableSum = s; return; }
  if (l.label === 'Less: value at closing of distributions so far' && typeof lastTableSum === 'number') { checked++; if (Math.abs(-l.value - lastTableSum) > 0.05) { console.log('PV SUM', where, -l.value, lastTableSum); problems++; } }
  if (typeof l.value === 'string' && /^\d+\.\d{9}$/.test(l.value) && /\^/.test(l.expr || '')) { checked++; const m = l.expr.match(/([\d.]+)\^\((\d+) \/ (\d+)\)/); const v = Math.pow(+m[1], +m[2] / +m[3]); if (Math.abs(v - +l.value) > 6e-10) { console.log('GROWTH', where, l.expr, l.value, v); problems++; } return; }
  if ((l.t !== 'row' && l.t !== 'total') || !l.expr) return;
  const v = evalExpr(l.expr.replace(/^lesser of /, 'MIN '));
  if (/^lesser of /.test(l.expr)) { // "lesser of A due and B cash"
    const nums = (l.expr.match(/−?[\d,]+\.\d{2}/g) || []).map(num);
    if (nums.length >= 2 && typeof l.value === 'number') { checked++; const m = Math.min(...nums); if (Math.abs(m - l.value) > 0.011) { console.log('LESSER', where, l.label, l.expr, l.value); problems++; } }
    return;
  }
  if (v === null || v === undefined) return;
  checked++;
  const target = typeof l.value === 'number' ? l.value : num(String(l.value).replace('%', ''));
  const tol = 0.011 + Math.abs(target) * 1e-12;
  if (typeof l.value === 'string' && /%$/.test(l.value)) { if (Math.abs(v * 100 - target) > 6e-5) { console.log('RATIO', where, l.label, l.expr, l.value, v * 100); problems++; } return; }
  if (Math.abs(v - target) > tol) { console.log('EXPR', where, '|', l.label, '|', l.expr, '=', v, 'shown', l.value); problems++; }
}
const S = Dt.scenarios();
const variants = [];
S.forEach(sc => variants.push([sc.id, sc.tape, sc.inputs]));
const apr = S[1];
[2, 4, 7].forEach(d => variants.push(['apr09+def' + d, Dt.applyStress(apr.tape, { extraDefaultPct: d }, apr.inputs.paymentDate), apr.inputs]));
variants.push(['apr09 severe', Dt.applyStress(apr.tape, { extraDefaultPct: 2.5, notches: 1, priceShock: 3 }, apr.inputs.paymentDate), apr.inputs]);
variants.push(['apr09 IC fail', apr.tape, Object.assign({}, apr.inputs, { interestProceeds: 1650000 })]);
variants.push(['apr09 cash out of PCV', Dt.applyStress(apr.tape, { extraDefaultPct: 4 }, apr.inputs.paymentDate), Object.assign({}, apr.inputs, { principalCashInPCV: false })]);
variants.push(['apr09 fee deferral to principal', apr.tape, Object.assign({}, apr.inputs, { subFeeDeferElect: 200000, subFeeDeferTo: 'principal', cumDeferredFee: 500000, recoupCumDeferred: 100000, unpaidSubFee: 80000, unpaidSeniorFees: 20000, taxes: 15000, hedgePayment: 30000 })]);
variants.push(['apr09 deferred b/f', apr.tape, Object.assign({}, apr.inputs, { notes: { A: { bal: 300e6, def: 0 }, B: { bal: 32e6, def: 0 }, C: { bal: 24e6, def: 150000 }, D: { bal: 12.5e6, def: 140000 }, E: { bal: 13e6, def: 220000 } } })]);
variants.push(['apr09 rcf+special', apr.tape, Object.assign({}, apr.inputs, { rcf: true, rcfAmount: 500000, specialRedemption: 1000000 })]);
const oct = S[2];
variants.push(['oct16 reinvest elect', oct.tape, Object.assign({}, oct.inputs, { reinvestElect: 5000000 })]);
const pf = E.analysePortfolio(spec, oct.tape, { asOf: oct.inputs.paymentDate, libor: oct.inputs.libor });
variants.push(['oct16 liquidation', oct.tape, Object.assign({}, oct.inputs, { mode: 'liquidation', liquidationProceeds: pf.rows.reduce((s, x) => s + x.par * Math.min(100, x.price) / 100, 0) })]);
variants.push(['apr09 liquidation', apr.tape, Object.assign({}, apr.inputs, { mode: 'liquidation', liquidationProceeds: 250e6 })]);
const MAN = [
  { name: 'Trustee fee', amount: 15000, wf: 'interest', step: 'B' }, { name: 'Collateral administrator fee', amount: 12000, wf: 'interest', step: 'B' },
  { name: 'Rating agency surveillance', amount: 30000, wf: 'interest', step: 'B' }, { name: 'Registered office fee', amount: 4500, wf: 'interest', step: 'A', rank: 'after' },
  { name: 'Structuring true-up', amount: 20000, wf: 'interest', step: 'D', rank: 'prorata' }, { name: 'Class A adjustment', amount: 5000, wf: 'interest', step: 'E', rank: 'before' },
  { name: 'Senior swap termination', amount: 250000, wf: 'interest', step: 'E', rank: 'prorata' }, { name: 'Legal fees', amount: 25000, wf: 'interest', step: 'Q', rank: 'after' },
  { name: 'Principal-side fee', amount: 8000, wf: 'principal', step: 'H', rank: 'after' }, { name: 'Liquidation agent', amount: 60000, wf: 'liquidation', step: 'D', rank: 'prorata' },
  { name: 'Liquidation legal', amount: 40000, wf: 'liquidation', step: 'B' }, { name: 'Untagged', amount: 999, wf: 'interest', step: '' }];
const mv = [];
mv.push(['apr09 manual', apr.tape, Object.assign({}, apr.inputs, { manual: MAN })]);
mv.push(['apr09 manual, interest short', apr.tape, Object.assign({}, apr.inputs, { manual: MAN, interestProceeds: 900000 })]);
mv.push(['apr09 manual, pro rata short at E', apr.tape, Object.assign({}, apr.inputs, { manual: MAN.concat([{ name: 'Big senior item', amount: 3000000, wf: 'interest', step: 'E', rank: 'prorata' }]) })]);
mv.push(['oct16 manual, carried to principal', oct.tape, Object.assign({}, oct.inputs, { manual: MAN, interestProceeds: 150000, principalProceeds: 20000000 })]);
mv.push(['oct16 manual liquidation', oct.tape, Object.assign({}, oct.inputs, { manual: MAN, mode: 'liquidation', liquidationProceeds: 200e6 })]);
for (const [l, t, i] of variants.concat(mv)) audit(l, t, i);
// conservation: every manual amount is paid, short, or reported
for (const [l, t, i] of mv) { const r = E.run(spec, t, i); r.manual.forEach(m => { ties++; if (!m.status) { console.log('NO STATUS', l, m.name); problems++; } if (m.paid > m.amount + 0.005) { console.log('OVERPAID', l, m.name, m.paid, m.amount); problems++; } }); }
// user calculations replacing the interpreter's figures: the working must still re-evaluate and tie
const CALC = require('../src/calc.js');
const CALCS = [
  { name: 'Fee_Basis_Amount_2', kind: 'deal', use: 'feeBasis', formula: 'SUM(par, NOT defaulted) + SUM(oc_balance, defaulted) + Principal_Proceeds' },
  { name: 'PCV_2', kind: 'deal', use: 'pcvOC', formula: 'Principal_Collateral_Value - 2500000' },
  { name: 'Senior_Fee_2', kind: 'deal', use: 'seniorMgmt', formula: 'ROUND(Fee_Basis_Amount_2 * 0.12% * Day_Count_Fraction, 2)' },
  { name: 'Sub_Fee_2', kind: 'deal', use: 'subMgmtCurrent', formula: 'ROUND(Fee_Basis_Amount_2 * 0.25% * Day_Count_Fraction, 2)' },
  { name: 'Principal_Balance', kind: 'loan', use: 'par', formula: 'IF(asset_type = "2L", par * 0.98, par)' }];
const withCalcs = calcs => (s, t, i) => CALC.runWith(E, s, t, i, calcs).result;
const MANF = MAN.slice(0, 4).concat([{ name: 'Fee on the new basis', formula: 'Fee_Basis_Amount_2 * 0.01% * Day_Count_Fraction', wf: 'interest', step: 'B' }, { name: 'Broken formula', formula: 'Nope * 2', wf: 'interest', step: 'B' }]);
const cv = [['apr09 calculations', apr.tape, Object.assign({}, apr.inputs, { manual: MANF }), withCalcs(CALCS)],
  ['oct16 calculations', oct.tape, Object.assign({}, oct.inputs, { manual: MANF }), withCalcs(CALCS)],
  ['apr09 calculations, cash out of PCV', apr.tape, Object.assign({}, apr.inputs, { principalCashInPCV: false }), withCalcs(CALCS)],
  ['apr09 calculations, proceeds and admin', apr.tape, apr.inputs, withCalcs([{ name: 'IP_2', kind: 'deal', use: 'interestProceeds', formula: 'Estimated_Interest_Proceeds * 0.97' }, { name: 'PP_2', kind: 'deal', use: 'principalProceeds', formula: '1250000' }, { name: 'Admin_2', kind: 'deal', use: 'adminDue', formula: '180000' }])],
  ['oct16 calculations, liquidation', oct.tape, Object.assign({}, oct.inputs, { mode: 'liquidation', liquidationProceeds: 200e6 }), withCalcs(CALCS)]];
for (const [l, t, i, run] of cv) audit(l, t, i, run);
// your adjustments to the tests: loans left out of numerators and denominators, your own numerators, tests of your own
const RULES = { adj: {
  'conc:(v)a': { numSkip: ['defaulted', 'is_ccc'], denSkip: ['defaulted'] }, 'conc:(xi)': { numOnly: ['asset_type = "2L" OR asset_type = "UNSEC"'], denCash: false },
  'conc:(viii)': { numOnly: ['NOT defaulted'], numSkip: ['is_ccc'], denSkip: ['defaulted'] }, 'conc:(ix)': { numSkip: ['country <> "US"'] }, 'conc:(x)B4': { denSkip: ['par < 1000000'] }, 'conc:(x)A': { denCash: false },
  'quality:warf': { numSkip: ['is_ccc'], denSkip: ['is_ccc'] }, 'quality:mwas': { numSkip: ['cov_lite'] }, 'quality:wal': { denSkip: ['years_to_maturity > 7'] }, 'quality:div': { numSkip: ['par < 1500000'] },
  'quality:mwarr': { numOnly: ['asset_type = "SSL"'], denSkip: ['asset_type <> "SSL"'] }, 'quality:swarr': { numSkip: ['is_discount'] }, 'quality:wac': { numSkip: ['price < 90'] },
  'coverage:AB': { numSkip: ['asset_type = "2L"'] }, 'coverage:E': { numSkip: ['is_ccc', 'price < 80'] }, 'coverage:irt': { numSkip: ['defaulted'] }, 'coverage:eod': { numSkip: ['is_ccc'] } },
  custom: [{ id: 'U1', label: 'Healthcare', kind: 'share', numOnly: ['CONTAINS(industry, "Health")'], numSkip: ['defaulted'], limit: 12, op: '<=' },
    { id: 'U2', label: 'Largest country', kind: 'largest', field: 'country', numSkip: ['defaulted'], denSkip: ['defaulted'], limit: 80, op: '<=' },
    { id: 'U3', label: 'Second lien at least', kind: 'share', numOnly: ['asset_type = "2L"'], limit: 1, op: '>=', denCash: false }] };
const withRules = (calcs, rules) => (s, t, i) => { const o = CALC.runWith(E, s, t, i, calcs, { tests: rules }); if (o.info && o.info.tests && Object.keys(o.info.tests.errs).length) { console.log('RULE ERRORS', JSON.stringify(o.info.tests.errs)); problems++; } return o.result; };
const tr = [['apr09 adjusted tests', apr.tape, apr.inputs, withRules([], RULES)], ['oct16 adjusted tests', oct.tape, oct.inputs, withRules([], RULES)],
  ['jan08 adjusted tests', S[0].tape, S[0].inputs, withRules([], RULES)], ['apr09 adjusted tests and calculations', apr.tape, Object.assign({}, apr.inputs, { manual: MANF }), withRules(CALCS, RULES)],
  ['oct16 adjusted tests, liquidation', oct.tape, Object.assign({}, oct.inputs, { mode: 'liquidation', liquidationProceeds: 200e6 }), withRules([], RULES)],
  ['apr09 adjusted tests, cash out of PCV', apr.tape, Object.assign({}, apr.inputs, { principalCashInPCV: false }), withRules([], RULES)]];
for (const [l, t, i, run] of tr) { const r = audit(l, t, i, run); ties++; if (!r.testAdjust.any || r.conc.filter(c => c.custom).length !== 3 || r.quality.filter(q => q.adjusted).length !== 7) { console.log('ADJUSTMENTS NOT APPLIED', l, JSON.stringify(r.testAdjust)); problems++; } }
console.log('expressions re-evaluated:', checked, ' ties checked:', ties, ' problems:', problems);
process.exit(problems ? 1 : 0);
