// Your adjustments to the tests: loans left out of a numerator or a denominator, your own numerator, and tests of your own.
// Each adjusted figure is worked out again here from the loans, independently of the engine's code for it.
const E = require('../src/engine.js'); const Dt = require('../src/data.js'); const CALC = require('../src/calc.js');
const spec = Dt.EXAMPLE_CLO; const S = Dt.scenarios(); const apr = S[1], oct = S[2];
let n = 0, bad = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const runR = (sc, rules, calcs, inp) => CALC.runWith(E, spec, sc.tape, inp || sc.inputs, calcs || [], { tests: rules });
const plain = E.run(spec, apr.tape, apr.inputs); const rows = plain.pf.rows; const pcvGen = plain.pb.pcvGeneral; const cash = plain.principalProceeds;
const C = (r, id) => r.conc.find(c => c.id === id); const Q = (r, id) => r.quality.find(q => q.id === id);

// 1. no adjustments: the run is exactly the engine's own
{
  const o = runR(apr, { adj: { 'conc:(xi)': { numSkip: [''], denSkip: [] } }, custom: [] });
  ok(o.info === null, 'empty conditions are no adjustment: the plain run is used');
  const o2 = runR(apr, { adj: { 'conc:(xi)': { numSkip: ['defaulted'], on: false } } });
  ok(o2.info === null, 'an adjustment switched off is not applied');
  ok(JSON.stringify(E.run(spec, apr.tape, apr.inputs).conc) === JSON.stringify(plain.conc), 'the engine is unchanged without adjustments');
}

// 2. Portfolio Profile: loans left out of the numerator and the denominator
{
  const t = spec.concentrations.find(c => c.id === '(v)a');
  const o = runR(apr, { adj: { 'conc:(v)a': { numSkip: ['defaulted', 'is_ccc'], denSkip: ['defaulted'] } } }); const r = o.result; const c = C(r, '(v)a');
  const m = rows.filter(x => E.rowMatches(x, t.filter) && !x.defaulted && !x.ccc); const den = pcvGen - sum(rows.filter(x => x.defaulted), x => x.par);
  ok(near(c.value, sum(m, x => x.par) / den * 100), '(v)a: numerator without defaulted or CCC loans, denominator without defaulted loans: ' + c.value.toFixed(4) + '%');
  ok(c.adjusted && /numerator leaves out defaulted OR is_ccc/.test(c.adjText) && /denominator leaves out defaulted/.test(c.adjText), 'marked as adjusted, with what was changed: ' + c.adjText);
  const W = r.testCalc.conc['(v)a']; ok(near(W.num.value / W.den.value * 100, c.value), 'the working ties to the figure');
  ok(W.den.tables.some(T => /Left out of the denominator/.test(T.title) && T.rows.length === rows.filter(x => x.defaulted).length), 'the working lists the loans left out of the denominator');
  ok(W.den.lines.some(l => /^Loans you left out of the denominator/.test(l.label)), 'and says why');
  const others = r.conc.filter(x => x.id !== '(v)a'); ok(others.every(x => near(x.value, C(plain, x.id).value) && !x.adjusted), 'the other tests are as the indenture reads');
}

// 3. your own numerator in place of the clause's test, and Principal Proceeds out of the denominator
{
  const o = runR(apr, { adj: { 'conc:(xi)': { numOnly: ['asset_type = "2L" OR asset_type = "UNSEC"'], denCash: false } } }); const c = C(o.result, '(xi)');
  const exp = sum(rows.filter(x => x.assetType === '2L' || x.assetType === 'UNSEC'), x => x.par) / (pcvGen - cash) * 100;
  ok(near(c.value, exp), '(xi): your condition is the numerator, and Principal Proceeds leave the denominator: ' + c.value.toFixed(4) + '%');
  const o2 = runR(apr, { adj: { 'conc:(xi)': { numOnly: ['industry = "' + rows[0].mIndustry + '"'] } } }); const c2 = C(o2.result, '(xi)');
  ok(near(c2.value, sum(rows.filter(x => x.mIndustry === rows[0].mIndustry), x => x.par) / pcvGen * 100), 'a particular field and value as the numerator: industry = ' + rows[0].mIndustry);
  const lc = rows.filter(x => x.covLite); const o3 = runR(apr, { adj: { 'conc:(xi)': { numOnly: ['cov_lite', 'NOT defaulted'] } } });
  ok(near(C(o3.result, '(xi)').value, sum(lc.filter(x => !x.defaulted), x => x.par) / pcvGen * 100), 'two conditions for the numerator must both hold');
}

// 4. a "largest" test: the loans grouped can be narrowed and thinned too
{
  const o = runR(apr, { adj: { 'conc:(viii)': { numOnly: ['NOT defaulted'], numSkip: ['is_ccc'], denSkip: ['defaulted'] } } }); const c = C(o.result, '(viii)');
  const g = {}; rows.filter(x => !x.defaulted && !x.ccc).forEach(x => { g[x.obligor] = (g[x.obligor] || 0) + x.par; });
  const top = Math.max(...Object.values(g)); const den = pcvGen - sum(rows.filter(x => x.defaulted), x => x.par);
  ok(near(c.value, top / den * 100), '(viii) largest obligor among performing, non-CCC loans: ' + c.value.toFixed(4) + '%');
  ok(near(o.result.testCalc.conc['(viii)'].num.value, top, 0.005), 'the working shows the same obligor');
}

// 5. tests of your own
{
  const rules = { custom: [{ id: 'U1', label: 'Healthcare', kind: 'share', numOnly: ['CONTAINS(industry, "Health")'], numSkip: ['defaulted'], limit: 12, op: '<=' },
    { id: 'U2', label: 'Largest country', kind: 'largest', field: 'country', limit: 80, op: '<=' },
    { id: 'U3', label: 'Fixed rate at least', kind: 'share', numOnly: ['rate_type = "FIXED"'], limit: 50, op: '>=' }] };
  const r = runR(apr, rules).result; const u1 = C(r, 'U1'), u2 = C(r, 'U2'), u3 = C(r, 'U3');
  const hc = sum(rows.filter(x => /health/i.test(x.mIndustry) && !x.defaulted), x => x.par);
  ok(u1 && u1.custom && near(u1.value, hc / pcvGen * 100) && u1.pass === (u1.value <= 12 + 1e-9), 'your share test: healthcare, less defaults, ' + (u1 && u1.value.toFixed(4)) + '%');
  const byC = {}; rows.forEach(x => { byC[x.country] = (byC[x.country] || 0) + x.par; });
  ok(u2 && near(u2.value, Math.max(...Object.values(byC)) / pcvGen * 100) && /Largest: US/.test(u2.note), 'your largest test: the largest country, ' + (u2 && u2.value.toFixed(4)) + '%');
  ok(u3 && u3.op === '>=' && u3.pass === (u3.value >= 50 - 1e-9), 'a minimum: at least the limit');
  ok(r.testCalc.conc.U1 && r.testCalc.conc.U2 && r.testCalc.conc.U2.num.tables[0].title === 'By country', 'each has its working, grouped by the field you chose');
  const o = runR(apr, { custom: [{ id: 'U4', label: 'No loans', kind: 'share', numOnly: [], limit: 5 }, { id: 'U5', label: 'Bad field', kind: 'largest', field: 'nope', limit: 5 }, { id: 'U6', label: 'No limit', kind: 'share', numOnly: ['pik'], limit: '' }] });
  const E1 = o.info.tests.errs; ok(E1['custom:U4'] && E1['custom:U5'] && E1['custom:U6'] && !o.result.conc.some(c => c.custom), 'a test with no loans, an unknown field or no limit is reported, not shown: ' + Object.keys(E1).join(', '));
  ok(/nope is not a loan column/.test(E1['custom:U5'][0].err), 'the field error names the field');
}

// 6. Collateral Quality Tests: each measure worked out on its own loans
{
  const nd = rows.filter(x => !x.defaulted);
  const r = runR(apr, { adj: { 'quality:warf': { numSkip: ['is_ccc'], denSkip: ['is_ccc'] }, 'quality:wal': { denSkip: ['years_to_maturity > 7'] }, 'quality:div': { numSkip: ['par < 1500000'] }, 'quality:mwarr': { numOnly: ['asset_type = "SSL"'], denSkip: ['asset_type <> "SSL"'] } } }).result;
  const w = nd.filter(x => !x.ccc); ok(Q(r, 'warf').value === Math.ceil(sum(w, x => x.par * x.rf) / sum(w, x => x.par)) && Q(r, 'warf').adjusted, 'WARF without CCC loans: ' + Q(r, 'warf').value + ' (as the indenture reads ' + Q(plain, 'warf').value + ')');
  ok(near(Q(r, 'wal').value, sum(nd, x => x.par * x.yrs) / sum(nd.filter(x => x.yrs <= 7), x => x.par)), 'WAL with long loans out of the denominator only');
  ok(Q(r, 'div').value === E.diversityScore(nd.filter(x => x.par >= 1500000)), 'Diversity Score without the small positions: ' + Q(r, 'div').value);
  const s = nd.filter(x => x.assetType === 'SSL'); ok(near(Q(r, 'mwarr').value, Math.ceil(sum(s, x => x.par * x.mRR) / sum(s, x => x.par) * 10) / 10), "Moody's recovery rate of senior secured loans only");
  ok(['swas', 'wac', 'swarr'].every(id => JSON.stringify(Q(r, id).value) === JSON.stringify(Q(plain, id).value)), 'tests you did not adjust are unchanged');
  ok(Q(r, 'mwas').value > Q(plain, 'mwas').value && /recovery modifier/.test(Q(r, 'mwas').note), "where the indenture uses a measure you adjusted (the Moody's recovery rate in the spread's recovery modifier), yours is used");
  ok(r.qmPlain.warf === Q(plain, 'warf').value && r.qm.warf === Q(r, 'warf').value, 'the portfolio figures stay as the tape reads; the tests use yours');
  const W = r.testCalc.quality.warf; ok(W.num.tables.some(T => /Left out of the numerator/.test(T.title)) && W.den.tables.some(T => /Left out of the denominator/.test(T.title)), 'the working lists the loans left out of each');
}

// 7. Coverage tests: loans left out of one test's numerator, and the cash follows
{
  const t0 = spec.coverage.tests[0].id;
  const o = runR(apr, { adj: { ['coverage:' + t0]: { numSkip: ['asset_type = "2L"'] } } }); const r = o.result;
  const ded = Math.round(sum(rows.filter(x => x.assetType === '2L'), x => x.ocPB) * 100) / 100;
  const p0 = plain.preTests[0], a0 = r.preTests[0];
  ok(near(a0.oc.num, Math.round((plain.pcvStart - ded) * 100) / 100, 0.005) && near(a0.oc.ratio, a0.oc.num / p0.oc.den * 100), 'Class ' + t0 + ' OC: PCV less the second-lien loans, ' + a0.oc.ratio.toFixed(3) + '% (was ' + p0.oc.ratio.toFixed(3) + '%)');
  ok(r.preTests.slice(1).every((t, i) => near(t.oc.ratio, plain.preTests[i + 1].oc.ratio)), 'the other coverage tests keep the full numerator');
  const P = r.testCalc.coverage[t0].oc.num; ok(P.tables[0].title === "Left out of this test's numerator" && near(P.value, a0.oc.num, 0.005), 'its working starts from the PCV and takes the loans out');
  ok(r.testAdjust.coverage.includes(t0), 'the result says which tests you adjusted');
  // a harsh adjustment makes the test fail, and the waterfall cures it
  const o2 = runR(apr, { adj: { ['coverage:' + t0]: { numSkip: ['asset_type = "2L" OR is_ccc'] } } }); const r2 = o2.result;
  ok(!r2.preTests[0].ocPass && r2.postTests[0].oc.ratio > r2.preTests[0].oc.ratio, 'when your test fails, cash is diverted to cure it: ' + r2.preTests[0].oc.ratio.toFixed(2) + '% to ' + r2.postTests[0].oc.ratio.toFixed(2) + '%');
  const paid = (res, k) => (res.waterfalls[k] || []).filter(x => x.type === 'ocicCure' || x.type === 'cure').reduce((s, x) => s + x.paid, 0);
  ok(paid(r2, 'interest') + paid(r2, 'principal') > paid(plain, 'interest') + paid(plain, 'principal'), 'more is paid to cure than without your adjustment');
}

// 8. conditions with errors are reported and that test is left as the indenture reads
{
  const o = runR(apr, { adj: { 'conc:(xi)': { numSkip: ['Nope = 1'] }, 'conc:(v)a': { numSkip: ['defaulted'] }, 'quality:warf': { denSkip: ['par +'] } } });
  const er = o.info.tests.errs; ok(er['conc:(xi)'] && /Unknown name Nope/.test(er['conc:(xi)'][0].err) && er['quality:warf'], 'unknown names and broken formulas are reported');
  ok(!C(o.result, '(xi)').adjusted && C(o.result, '(v)a').adjusted && !Q(o.result, 'warf').adjusted, 'the broken ones are not applied; the good one is');
  const o2 = runR(apr, { adj: { 'conc:(xi)': { numSkip: ['SUM(par) > 0'] } } }); ok(o2.info.tests.counts['conc:(xi)'].numSkip === rows.length, 'a deal-level condition is the same for every loan');
  const o3 = runR(apr, { adj: { 'conc:(xi)': { numSkip: ['Principal_Proceeds > 0 AND par > 3000000'] } } }); ok(o3.info.tests.counts['conc:(xi)'].numSkip === rows.filter(x => x.par > 3000000).length, 'built-in deal figures can be used in a condition');
}

// 9. adjustments worked out for another tape are not applied
{
  const o = runR(apr, { adj: { 'conc:(v)a': { numSkip: ['defaulted'] } } }); const A = o.info.tests.adjust;
  const r = E.run(spec, oct.tape, Object.assign({}, oct.inputs, { testAdjust: A }));
  ok(!r.testAdjust.any && r.warnings.some(w => /different tape/.test(w)), 'flags for another tape are refused with a warning');
}

// 10. your calculations can be used in a condition, and a replaced figure is seen by it
{
  const calcs = [{ name: 'Weak', kind: 'loan', formula: 'rating_factor >= 3490 OR price < 85' }, { name: 'Haircut_Price', kind: 'loan', use: 'price', formula: 'IF(asset_type = "2L", price - 10, price)' }];
  const o = runR(apr, { adj: { 'conc:(xi)': { numSkip: ['Weak'] }, 'conc:(v)a': { numSkip: ['price < 85'] } } }, calcs); const R2 = o.result.pf.rows;
  const weak = rows.filter(x => x.rf >= 3490 || x.price < 85); ok(o.info.tests.counts['conc:(xi)'].numSkip === weak.length, 'your loan calculation as a condition, worked out as it is on the Calculations tab: ' + weak.length + ' loans');
  const cheap = R2.filter(x => x.price < 85); ok(R2.some((x, i) => x.price !== rows[i].price) && o.info.tests.counts['conc:(v)a'].numSkip === cheap.length && cheap.length > rows.filter(x => x.price < 85).length, 'a column in a condition is the figure your calculation put in its place: ' + cheap.length + ' loans below 85');
}

// 11. the projection applies coverage adjustments on every date, and nothing else
{
  ok(CALC.projectionEngine(E, [], { adj: { 'conc:(v)a': { numSkip: ['defaulted'] } } }) === E, 'a Portfolio Profile adjustment does not change the cash, so the projection runs as before');
  const PE = CALC.projectionEngine(E, [], { adj: { 'coverage:AB': { numSkip: ['par > 2000000'] } } }); ok(PE !== E, 'a coverage adjustment does');
  const r = PE.run(spec, apr.tape, apr.inputs); ok(r.testAdjust.coverage.includes('AB') && !r.preTests[0].ocPass, 'and is applied to each projected date');
}
// 12. random adjustments never break the run, and the working always ties (FUZZ_ADJ=n for more)
{
  const CONDS = ['defaulted', 'is_ccc', 'is_discount', 'cov_lite', 'NOT defaulted', 'par > 3000000', 'price < 90', 'asset_type = "2L"', 'country <> "US"', 'CONTAINS(industry, "Health")', 'years_to_maturity > 6', 'rating_factor >= 3490', 'ISBLANK(sp_rating)', 'par > 0', 'par < 0', 'oc_balance < par', 'Nope', 'par +', 'SUM(par) > 1'];
  const ids = [].concat(spec.concentrations.map(c => 'conc:' + c.id), spec.qualityTests.map(q => 'quality:' + q.id), spec.coverage.tests.map(t => 'coverage:' + t.id), ['coverage:irt', 'coverage:eod', 'conc:none', 'quality:none']);
  let seed = 7; const rnd = k => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; }; const pick = A => A[rnd(A.length)]; const some = () => Array.from({ length: rnd(3) }, () => pick(CONDS));
  const runs = +(process.env.FUZZ_ADJ || 60); let broke = 0, untied = 0;
  for (let k = 0; k < runs; k++) {
    const adj = {}; for (let j = 0; j < 1 + rnd(5); j++) adj[pick(ids)] = { numOnly: rnd(3) ? [] : some(), numSkip: some(), denSkip: some(), denCash: rnd(4) ? undefined : false, numMode: rnd(5) ? undefined : 'all' };
    const custom = rnd(2) ? [{ id: 'U1', label: 'x', kind: pick(['share', 'largest']), field: pick(['country', 'industry', 'obligor', 'nope', '']), numOnly: some(), numSkip: some(), denSkip: some(), limit: pick([5, '', 50, 'x']), op: pick(['<=', '>=']) }] : [];
    const sc = pick(S); const inp = rnd(4) ? sc.inputs : Object.assign({}, sc.inputs, { mode: 'liquidation', liquidationProceeds: 150e6 });
    try {
      const r = CALC.runWith(E, spec, sc.tape, inp, [], { tests: { adj, custom } }).result;
      if (!r.testCalc) { broke++; if (broke < 4) console.log('  no working', JSON.stringify(adj), r.warnings.slice(-1)); continue; }
      r.conc.forEach(c => { const x = r.testCalc.conc[c.id]; if (c.pass != null && !(Math.abs(x.num.value / x.den.value * 100 - c.value) < 1e-9)) { untied++; if (untied < 4) console.log('  untied', c.id, JSON.stringify(adj)); } });
    } catch (e) { broke++; if (broke < 4) console.log('  threw', e.message, JSON.stringify(adj)); }
  }
  ok(!broke && !untied, runs + ' random sets of adjustments: ' + broke + ' broke the run, ' + untied + ' did not tie');
}
console.log(bad ? bad + ' of ' + n + ' checks FAILED' : 'all ' + n + ' checks passed'); process.exit(bad ? 1 : 0);
