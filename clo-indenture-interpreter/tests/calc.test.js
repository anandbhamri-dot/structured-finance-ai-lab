// The formula language and the run with user calculations: values, errors, and that each replacement reaches the engine.
const E = require('../src/engine.js'); const Dt = require('../src/data.js'); const C = require('../src/calc.js');
const spec = Dt.EXAMPLE_CLO; const S = Dt.scenarios(); const apr = S[1];
let fails = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.011 : tol);
// a formula on its own, against no deal: constants and functions only
const val = f => { const M = C.compile([{ name: 'X', kind: 'deal', formula: f }], spec, apr.tape); const R = { count: 0, label: () => '', col: () => undefined }; const st = C.evaluate(M, null, R); return st.errs.get('x') || st.vals.get('x'); };

// ---- parsing and arithmetic
ok(val('1 + 2 * 3') === 7, 'precedence');
ok(val('(1 + 2) * 3') === 9, 'brackets');
ok(near(val('0.15% * 400000000'), 600000), 'percent literal');
ok(val('2 ^ 3 ^ 2') === 512, 'power is right-associative');
ok(val('-2 ^ 2') === -4, 'minus binds looser than power');
ok(val('10 / 4') === 2.5, 'division');
ok(val('IF(3 > 2, 10, 20)') === 10 && val('IF(3 < 2, 10, 20)') === 20, 'IF');
ok(val('MIN(4, 2, 9) + MAX(1, 7)') === 9, 'MIN and MAX');
ok(val('ROUND(2.345, 2)') === 2.35 && val('ROUND(1234.5)') === 1235, 'ROUND');
ok(val('ABS(-3)') === 3, 'ABS');
ok(val('1 = 1 AND NOT 0 OR 0') === 1 && val('1 = 2 OR 2 <> 2') === 0, 'logic');
ok(val('"SSL" = "ssl"') === 1, 'text comparison ignores case');
ok(val('CONTAINS("Example Holdings", "hold")') === 1, 'CONTAINS');
ok(val('IFBLANK(5, 1)') === 5, 'IFBLANK keeps a value');
ok(val('3 × 4 − 2 ÷ 2') === 11, 'pasted × − ÷ signs');
ok(val('TRUE + FALSE') === 1, 'TRUE and FALSE');
// ---- errors that explain themselves
ok(/Division by zero/.test(val('1 / (2 - 2)')), 'division by zero');
ok(/no function SUMX/.test(val('SUMX(1)')), 'unknown function');
ok(/Expected "\)"/.test(val('(1 + 2')), 'unclosed bracket');
ok(/ends too soon/.test(val('1 +')), 'formula ends early');
ok(/without "\$"/.test(val('$2,500,000')), 'dollar signs and commas');
ok(/operator missing/.test(val('2 par')), 'missing operator');
ok(/closing quote/.test(val('"SSL')), 'unclosed text');
ok(/IF takes 3/.test(val('IF(1, 2)')), 'wrong number of values');
ok(/text, not a number/.test(val('"abc" * 2')), 'text in arithmetic');

// ---- names: built-ins, columns, calculations
const run = (calcs, inputs, tape) => C.runWith(E, spec, tape || apr.tape, inputs || apr.inputs, calcs);
const base = E.run(spec, apr.tape, apr.inputs);
{
  const { result, info } = run([{ name: 'A1', formula: 'Aggregate_Principal_Balance' }, { name: 'A2', formula: 'SUM(par)' }, { name: 'A3', formula: 'COUNT(defaulted)' },
    { name: 'A4', formula: 'WAVG(spread, par, NOT defaulted AND rate_type = "FLOAT")' }, { name: 'A5', formula: 'a1 - A2' }, { name: 'A6', formula: 'MAXOF(par)' }, { name: 'A7', formula: 'AVG(price, asset_type = "SSL")' }]);
  const v = k => info.st.vals.get(k);
  ok(near(v('a1'), base.pb.parTotal), 'built-in Aggregate_Principal_Balance');
  ok(near(v('a2'), base.pb.parTotal), 'SUM(par) equals it');
  ok(v('a3') === base.pf.rows.filter(r => r.defaulted).length, 'COUNT with a condition');
  ok(near(v('a4'), base.qm.wasRaw, 1e-9) || near(v('a4'), base.qm.wasRaw, 0.01), 'WAVG(spread, par) is near the weighted average spread: ' + v('a4') + ' vs ' + base.qm.wasRaw);
  ok(v('a5') === 0, 'names ignore case');
  ok(v('a6') === Math.max(...base.pf.rows.map(r => r.par)), 'MAXOF');
  ok(near(result.waterfalls.interest.reduce((s, x) => s + x.paid, 0), base.waterfalls.interest.reduce((s, x) => s + x.paid, 0)), 'calculations that replace nothing change nothing');
  const W = C.working(info, 'a4'); ok(W && W.lines.some(l => l.t === 'table' && l.rows.length === info.st.aggs.get('a4').values().next().value.cnt), 'working lists the loans in a WAVG');
}
{
  const { info } = run([{ name: 'X', formula: 'par * 2' }, { name: 'Y', formula: 'Fee_Basis' }, { name: 'Z', formula: 'Y + 1' }, { name: 'P', formula: 'Q + 1' }, { name: 'Q', formula: 'P + 1' },
    { name: 'par', formula: '1' }, { name: 'Payment_Date', formula: '1' }, { name: '2x', formula: '1' }, { name: 'Sum', formula: '1' }, { name: 'W', kind: 'loan', formula: 'par / 0' }, { name: 'V', formula: 'SUM(W)' }]);
  const e = k => info.st.errs.get(k) || info.M.vars.find(x => x.name === k).err || '';
  ok(/loan column/.test(e('x')), 'a column outside SUM in a deal figure: ' + e('x'));
  ok(/Did you mean Fee_Basis_Amount/.test(e('y')), 'unknown name suggests the nearest: ' + e('y'));
  ok(/Uses Y, which has an error/.test(e('z')), 'an error passes to what uses it: ' + e('z'));
  ok(/Circular/.test(e('p')) && /Circular/.test(e('q')), 'circular calculations');
  ok(/column on the tape/.test(e('par')), 'a calculation cannot take a column\'s name');
  ok(/built-in/.test(e('Payment_Date')), 'nor a built-in figure\'s');
  ok(/letters, digits/.test(e('2x')), 'names start with a letter');
  ok(/function/.test(e('Sum')), 'nor a function\'s name');
  ok(/Division by zero/.test(e('w')) && /For .+\(L\d+\)/.test(e('w')), 'a loan-level error names the loan: ' + e('w'));
}

// ---- dates and deal terms
{
  const { info } = run([{ name: 'D1', formula: 'DAYS(Payment_Date, Stated_Maturity_Date)' }, { name: 'D2', formula: 'EDATE(First_Payment_Date, 3)' }, { name: 'D3', formula: 'YEAR(Reinvestment_Period_End_Date) * 100 + MONTH(Non_Call_Period_End_Date)' },
    { name: 'D4', formula: 'ROUND(Fee_Basis_Amount * Senior_Management_Fee_Rate% * Day_Count_Fraction, 2) - Senior_Management_Fee_Due' }, { name: 'D5', formula: 'Payment_Date + 1' }, { name: 'D6', formula: 'DATE(2011, 2, 29)' },
    { name: 'D7', kind: 'loan', formula: 'YEARS(Payment_Date, maturity)' }, { name: 'D8', formula: 'Payment_Date <= Reinvestment_Period_End_Date AND EDATE("2011-01-31", 1) = "2011-02-28"' },
    { name: 'D9', formula: 'Target_Par_Amount + OC_Trigger_E + IC_Trigger_AB + Reinvestment_Test_Trigger + Payments_Per_Year + Subordinated_Notes_Balance' }, { name: 'D10', kind: 'loan', formula: 'DAYS(default_date, Payment_Date)' }]);
  const v = k => info.st.vals.get(k), e = k => info.st.errs.get(k) || '';
  const M = spec.meta;
  ok(v('d1') === Math.round((Date.parse(M.statedMaturity) - Date.parse(apr.inputs.paymentDate)) / 864e5), 'days to Stated Maturity');
  ok(v('d2') === '2008-04-18', 'EDATE moves a date by months');
  ok(v('d3') === 201407, 'YEAR and MONTH of deal dates');
  ok(v('d4') === 0, 'the senior fee rate built-in reproduces the interpreter\'s fee');
  ok(/a date\. Use DAYS/.test(e('d5')), 'arithmetic on a date explains what to use: ' + e('d5'));
  ok(/not a date/.test(e('d6')), 'an impossible date is an error');
  ok(Math.abs(v('d7')[0] - base.pf.rows[0].yrs) < 0.01, 'YEARS per loan matches the interpreter\'s years to maturity');
  ok(v('d8') === 1, 'dates compare, and month ends are kept');
  ok(v('d9') === M.targetPar + 102 + 118 + 102.8 + 4 + spec.equity.balance, 'deal terms and triggers');
  ok(v('d10').filter(x => x != null).length === base.pf.rows.filter(r => r.defaulted).length, 'a blank date gives a blank result');
}

// ---- ratings
{
  const { info } = run([{ name: 'R1', formula: 'SP_TO_MOODYS("BB-") = "Ba3" AND MOODYS_TO_SP("Caa1") = "CCC+" AND NOTCH("B2", 2) = "Caa1" AND NOTCH("BB+", -1) = "BBB-" AND NOTCH("Caa3", 5) = "C"' },
    { name: 'R2', formula: 'RATING_RANK("Aaa") + RATING_RANK("CCC+") * 100 + RATING_FACTOR("B2") * 10000' }, { name: 'R3', formula: 'NOTCH("XYZ", 1)' }, { name: 'R4', formula: 'ISBLANK(SP_TO_MOODYS("NR"))' },
    { name: 'R5', kind: 'loan', formula: 'RATING_RANK(moodys_rating) >= RATING_RANK("Caa1")' }, { name: 'R6', formula: 'SUM(par, RATING_RANK(moodys_rating) >= 17 AND NOT defaulted AND NOT is_discount)' }]);
  const v = k => info.st.vals.get(k), e = k => info.st.errs.get(k) || '';
  ok(v('r1') === 1, 'rating scales map and notch: ' + e('r1'));
  ok(v('r2') === 1 + 1700 + spec.ratingFactors.B2 * 10000, 'rating rank and the deal\'s rating factor');
  ok(/not a Moody's or S&P rating/.test(e('r3')), 'an unknown rating is an error');
  ok(v('r4') === 1, 'NR gives a blank');
  ok(v('r5').filter(x => x).length === base.pf.rows.filter(r => r.moodysDPR && ['Caa1', 'Caa2', 'Caa3', 'Ca', 'C'].includes(r.moodysDPR)).length, 'ratings compare by rank per loan');
  ok(Math.abs(v('r6') - base.pb.cccAmtMoodys) < 1, 'par rated Caa1 or below matches the CCC bucket: ' + v('r6') + ' vs ' + base.pb.cccAmtMoodys);
  // a blank Moody's rating on the tape reads blank, and a column can supply one from S&P
  const tape = apr.tape.map((x, i) => i % 9 === 0 ? Object.assign({}, x, { moodysDPR: '', moodysFacility: '' }) : x);
  const blankN = tape.filter(x => x.moodysDPR === '').length;
  const g = run([{ name: 'SP_As_Moodys', kind: 'loan', formula: 'SP_TO_MOODYS(sp_rating)', group: 'Moody\'s rating' }, { name: 'Moodys_Final', kind: 'loan', use: 'moodysDPR', formula: 'IFBLANK(moodys_rating, NOTCH(SP_As_Moodys, 1))', group: 'Moody\'s rating' }], apr.inputs, tape);
  const A = g.info.loanApplied[0]; ok(A && A.changed === blankN && A.n === tape.length, 'loans with no Moody\'s rating take one from S&P: ' + (A && A.changed) + ' of ' + blankN);
  const k = tape.findIndex(x => x.moodysDPR === ''); const want = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'][Math.min(20, ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C'].indexOf(tape[k].spRating) + 1)];
  ok(g.result.pf.rows[k].moodysDPR === want, 'the engine uses the new rating: ' + g.result.pf.rows[k].moodysDPR + ' vs ' + want);
  const bad = run([{ name: 'X', kind: 'loan', use: 'spRating', formula: 'IF(par > 3000000, "junk", sp_rating)' }]).info.loanApplied[0]; ok(bad.bad > 0 && bad.changed === 0, 'a value that is not a rating keeps the tape\'s');
  // the group's working: each step side by side, loans the last step changes first
  const W = C.groupWorking(g.info, ['sp_as_moodys', 'moodys_final'], 'Moody\'s rating'); const T = W.lines.find(l => l.t === 'table');
  ok(T && T.head.join('|') === "ID|Obligor|Tape Moody's rating|SP_As_Moodys|Moodys_Final" && T.rows[0][2] === '' && T.rows[0][4] === want, 'group working: ' + (T && T.head.join('|')));
}

// ---- replacements reach the engine
{
  const fb = 300e6;
  const { result: r, info } = run([{ name: 'Fee_Basis_Amount_2', kind: 'deal', use: 'feeBasis', formula: '300000000' }]);
  ok(r.feeBasis === fb, 'Fee Basis Amount replaced');
  const bps = spec.fees.seniorMgmt.schedule.find(s => !s.through || s.through >= r.paymentDate).bps;
  ok(near(r.dues.seniorMgmt, Math.round(fb * bps / 1e4 * r.days / 360 * 100) / 100), 'senior fee worked out on the replacement');
  const step = Object.values(r.waterfalls).flat().find(x => x.calc && x.calc.due.some(l => /Fee Basis Amount/.test(l.label) && /calculation Fee_Basis_Amount_2/.test(l.expr)));
  ok(!!step, 'the fee working names the calculation');
  const D = info.dealApplied[0]; ok(D.applied && near(D.interp, base.feeBasis), 'the interpreter\'s figure is kept for comparison');
}
{
  const { result: r } = run([{ name: 'PCV_2', use: 'pcvOC', formula: 'Principal_Collateral_Value - 10000000' }]);
  ok(near(r.preTests[0].oc.num, base.preTests[0].oc.num - 10e6), 'Principal Collateral Value replaced in the OC tests');
  ok(near(r.pcvInterp, base.pcvInterp), 'and the interpreter\'s own figure is still reported');
}
{
  const { result: r } = run([{ name: 'S2', use: 'seniorMgmt', formula: '12345.67' }, { name: 'U2', use: 'subMgmtCurrent', formula: '23456.78' }]);
  ok(r.dues.seniorMgmt === 12345.67 + (+apr.inputs.unpaidSeniorFees || 0), 'senior fee due replaced');
  ok(r.dues.subMgmtCurrent <= 23456.78 + 0.001 && r.duesInterp.subMgmtCurrent > 0, 'subordinated fee due replaced');
  const paid = Object.values(r.waterfalls).flat().filter(x => x.type === 'subMgmtFee').reduce((s, x) => s + x.paid, 0);
  ok(paid <= 23456.78 + 0.01, 'and no more than it is paid');
}
{
  // Principal Balance in place of par: a column on the tape, blank for some loans
  const tape = apr.tape.map((x, i) => Object.assign({}, x, { principal_balance: i % 10 === 0 ? '' : String(Math.round(x.par * 0.95)) }));
  const { result: r, info } = run([{ name: 'Principal_Balance_2', kind: 'loan', use: 'par', formula: 'IFBLANK(principal_balance, par)' }], apr.inputs, tape);
  const want = tape.reduce((s, x, i) => s + (i % 10 === 0 ? x.par : Math.round(x.par * 0.95)), 0);
  ok(near(r.pb.parTotal, want, 1), 'par replaced loan by loan: ' + r.pb.parTotal + ' vs ' + want);
  ok(near(r.feeBasis, want + r.principalProceeds, 1), 'the Fee Basis Amount follows the new par');
  ok(r.preTests[0].oc.num < base.preTests[0].oc.num, 'and so do the OC tests');
    const bare = run([{ name: 'PB', kind: 'loan', use: 'par', formula: 'principal_balance' }], apr.inputs, tape); const A = bare.info.loanApplied[0];
  ok(A.blank === tape.filter((x, i) => i % 10 === 0).length && near(bare.result.pb.parTotal, want, 1), 'a blank value keeps the tape par');
  const W = C.working(info, 'principal_balance_2'); const TT = W.lines.find(l => l.t === 'table'); const pi = TT ? TT.head.indexOf('par') : -1;
  const row1 = TT && TT.rows.find(r => r[0] === tape[1].id);
  ok(pi > 0 && row1[pi] === C.fmtV(tape[1].par) && row1[TT.head.indexOf('Principal_Balance_2')] === C.fmtV(Math.round(tape[1].par * 0.95)), 'working shows each loan\'s tape par beside the new value');
  ok(TT.rows.slice(0, 5).every(r => r[pi] !== r[TT.head.indexOf('Principal_Balance_2')]), 'the loans that change come first');
  const W2 = C.working(bare.info, 'pb'); ok(W2.lines.some(l => l.t === 'table' && l.head.includes('Tape par')), 'and a tape column where the formula does not use it');
  ok(C.extraColumns(tape).some(c => c.key === 'principal_balance'), 'extra tape columns are found');
  const clash = run([{ name: 'Principal_Balance', kind: 'loan', use: 'par', formula: 'par' }], apr.inputs, tape).info; ok(/column on the tape/.test(clash.M.vars[0].err), 'a calculation cannot share a tape column\'s name');
}
{
  const { result: r } = run([{ name: 'Def2', kind: 'loan', use: 'defaulted', formula: 'defaulted OR price < 60' }]);
  ok(r.pf.rows.filter(x => x.defaulted).length === base.pf.rows.filter(x => x.defaulted || x.price < 60).length, 'a loan column can mark loans defaulted');
}
{
  // two calculations cannot replace the same figure; an error leaves the interpreter's figure in place
  const { result: r, info } = run([{ name: 'F1', use: 'feeBasis', formula: '1' }, { name: 'F2', use: 'feeBasis', formula: '2' }, { name: 'G', use: 'pcvOC', formula: 'oops' }]);
  ok(/already replaced by F1/.test(info.M.vars[1].err), 'one calculation per replaced figure');
  ok(near(r.preTests[0].oc.num, base.preTests[0].oc.num), 'a calculation with an error replaces nothing');
}
{
  // manual inputs with formulas
  const man = [{ name: 'Trustee fee', formula: '=ROUND(Aggregate_Principal_Balance * 0.01% * Day_Count_Fraction, 2)', wf: 'interest', step: 'B' }, { name: 'Bad', formula: '=Nope', wf: 'interest', step: 'B' }, { name: 'Plain', amount: 1000, wf: 'interest', step: 'B' }];
  const { result: r, info } = run([], Object.assign({}, apr.inputs, { manual: man }));
  const want = Math.round(base.pb.parTotal * 0.0001 * base.days / 360 * 100) / 100;
  ok(near(r.manual[0].amount, want), 'a manual amount from a formula: ' + r.manual[0].amount + ' vs ' + want);
  ok(info.manual[1].err && r.manual[1].amount === 0, 'a formula with an error counts as zero, with its message: ' + info.manual[1].err);
  ok(r.manual[2].amount === 1000, 'plain amounts are untouched');
  const lines = Object.values(r.waterfalls).flat().flatMap(x => x.calc ? x.calc.due : []); ok(lines.some(l => /formula =ROUND/.test(l.expr || '')), 'the working shows the formula');
}
{
  // no calculations: exactly the engine's own run
  const a = run([]).result, b = E.run(spec, apr.tape, apr.inputs);
  ok(JSON.stringify(a.waterfalls) === JSON.stringify(b.waterfalls) && JSON.stringify(a.preTests) === JSON.stringify(b.preTests), 'without calculations the run is unchanged');
  const off = run([{ name: 'F', use: 'feeBasis', formula: '1', on: false }]).result; ok(off.feeBasis === b.feeBasis, 'a calculation switched off does nothing');
}
{
  // the projection engine applies fee and collateral-value replacements on each projected date
  const PE = C.projectionEngine(E, [{ name: 'FB', use: 'feeBasis', formula: 'Aggregate_Principal_Balance * 0.5' }, { name: 'IP', use: 'interestProceeds', formula: '1' }]);
  const r = PE.run(spec, apr.tape, apr.inputs);
  ok(near(r.feeBasis, r.pb.parTotal * 0.5), 'projection: fee basis replaced');
  ok(r.interestProceeds !== 1, 'projection: collections are the projection\'s own');
  ok(C.projectionEngine(E, []) === E, 'projection without calculations uses the engine as is');
}
{
  // random formulas: every one either works or gives a message; none breaks the run
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pick = a => a[Math.floor(rnd() * a.length)];
  const V = ['par', 'price', 'spread', 'defaulted', 'asset_type', 'principal_balance', 'Days_In_Period', 'Payment_Date', 'Stated_Maturity_Date', 'maturity', 'DAYS(', 'EDATE(', 'NOTCH(', 'SP_TO_MOODYS(', 'RATING_RANK(', 'moodys_rating', 'sp_rating', '"B2"', 'Fee_Basis_Amount', 'Principal_Proceeds', 'A', 'B', 'nope', '1', '0', '2.5', '0.15%', '"SSL"', '"', '(', ')', ',', '+', '-', '*', '/', '^', '%', '=', '<>', '<', '>=', 'AND', 'OR', 'NOT', 'IF(', 'SUM(', 'COUNT(', 'WAVG(', 'MIN(', 'ROUND(', 'IFBLANK(', 'MAXOF(', 'TRUE', '$', '1e309'];
  let broke = 0, runs = 0;
  for (let k = 0, N = +process.env.FUZZ_CALC || 60; k < N; k++) {
    const f = () => Array.from({ length: 1 + Math.floor(rnd() * 9) }, () => pick(V)).join(' ');
    const calcs = [{ name: 'A', kind: pick(['deal', 'loan']), formula: f(), use: pick(['', 'feeBasis', 'pcvOC', 'par', 'price', 'defaulted', 'moodysDPR', 'spRating']) }, { name: 'B', kind: pick(['deal', 'loan']), formula: f(), use: pick(['', 'seniorMgmt', 'subMgmtCurrent', 'spread']) }];
    try { const o = run(calcs, Object.assign({}, apr.inputs, { manual: [{ name: 'm', formula: f(), wf: 'interest', step: 'B' }] })); runs++; if (!o.result || !isFinite(o.result.feeBasis) || !o.result.waterfalls.interest) { broke++; console.log('BAD RESULT', JSON.stringify(calcs)); } C.working(o.info, 'a'); C.working(o.info, 'b'); }
    catch (e) { broke++; if (broke < 4) console.log('BROKE', String(e && e.stack || e).slice(0, 300), JSON.stringify(calcs)); }
  }
  ok(!broke, 'random formulas never break the run (' + runs + ' runs)');
}
console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'); process.exit(fails ? 1 : 0);
