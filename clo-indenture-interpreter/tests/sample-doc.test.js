// The reader on the fictional sample indenture must reproduce the built-in Example CLO I spec.
// Both are committed, so this runs anywhere and covers the reader end to end.
const fs = require('fs'); const path = require('path'); const L = require('./load.js');
const raw = fs.readFileSync(path.join(__dirname, '..', 'sample_inputs', 'example-clo-indenture.txt'), 'utf8');
const pages = L.htmlToPages(raw, false); const { spec, found } = L.readDealText(pages, 'example-clo-indenture.txt'); const X = L.DATA.EXAMPLE_CLO;
let n = 0, bad = 0; const eq = (lab, a, b) => { n++; const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { bad++; console.log('  FAIL', lab, '| read', JSON.stringify(a), '| expected', JSON.stringify(b)); } else if (process.env.V) console.log('  ok  ', lab, JSON.stringify(a)); };
console.log('sample indenture:', pages.length, 'pages');
for (const k of ['closingDate', 'firstPaymentDate', 'paymentDay', 'statedMaturity', 'reinvestmentPeriodEnd', 'nonCallEnd', 'effectiveDate', 'targetPar']) eq('meta.' + k, spec.meta[k], X.meta[k]);
eq('manager', spec.meta.manager, X.meta.manager);
eq('name', spec.meta.name, X.meta.name);
eq('classes', spec.classes.map(c => [c.id, c.balance, c.spread, c.deferrable]), X.classes.map(c => [c.id, c.balance, c.spread, c.deferrable]));
eq('equity', spec.equity.balance, X.equity.balance);
eq('senior fee', spec.fees.seniorMgmt.schedule, X.fees.seniorMgmt.schedule);
eq('structuring fee', spec.fees.structuring.schedule, X.fees.structuring.schedule);
eq('sub fee', spec.fees.subMgmt.bps, X.fees.subMgmt.bps);
eq('incentive', [spec.fees.incentive.hurdleIRR, spec.fees.incentive.managerShare], [X.fees.incentive.hurdleIRR, X.fees.incentive.managerShare]);
eq('admin cap', [spec.fees.adminCap.bpsOfPCV, spec.fees.adminCap.fixed, spec.fees.adminCap.priorPeriods], [X.fees.adminCap.bpsOfPCV, X.fees.adminCap.fixed, X.fees.adminCap.priorPeriods]);
eq('coverage tests', spec.coverage.tests.map(t => [t.oc.classes.join(''), t.oc.trigger, t.ic && t.ic.trigger, t.ic && t.ic.fromPeriod]), X.coverage.tests.map(t => [t.oc.classes.join(''), t.oc.trigger, t.ic && t.ic.trigger, t.ic && t.ic.fromPeriod]));
eq('IRT', [spec.coverage.reinvestmentTest.trigger, spec.coverage.reinvestmentTest.ocClasses, spec.coverage.reinvestmentTest.maxDiversionPct], [X.coverage.reinvestmentTest.trigger, X.coverage.reinvestmentTest.ocClasses, X.coverage.reinvestmentTest.maxDiversionPct]);
eq('EoD', [spec.coverage.eodTest.trigger, spec.coverage.eodTest.ocClasses], [X.coverage.eodTest.trigger, X.coverage.eodTest.ocClasses]);
eq('IC numerator deducts', spec.coverage.icNumeratorDeducts, X.coverage.icNumeratorDeducts);
eq('CCC', [spec.haircuts.ccc.limitPct, spec.haircuts.ccc.haircutPct], [X.haircuts.ccc.limitPct, X.haircuts.ccc.haircutPct]);
const sig = s => [s.type, s.items || (s.item ? [s.item] : undefined), s.classes, s.class, s.test, s.tests && s.tests.length, s.paydown, s.steps, s.when || undefined];
for (const k of ['interest', 'principal', 'liquidation']) X.waterfalls[k].forEach((st, i) => { const r = spec.waterfalls[k][i] || {}; eq(k + ' ' + st.id, sig(r), sig(st)); });
eq('clause counts', ['interest', 'principal', 'liquidation'].map(k => spec.waterfalls[k].length), ['interest', 'principal', 'liquidation'].map(k => X.waterfalls[k].length));
for (const id of ['was', 'wac', 'div', 'mwarr']) { const q = spec.qualityTests.find(x => x.id === id); n++; if (!q) { bad++; console.log('  FAIL quality', id, 'not read'); } }
eq('WAL', (spec.qualityTests.find(x => x.id === 'wal') || {}).limit, { type: 'declining', startYears: 9.5, from: 'closingDate' });
n++; if (spec.concentrations.length < 18) { bad++; console.log('  FAIL concentrations read:', spec.concentrations.length); }
const gaps = found.filter(f => !L.RR_DONE.includes(f.how)); console.log('  gaps listed for review:', gaps.map(f => f.field + ' (' + f.how + ')').join('; ') || 'none');
// and the read spec runs: same waterfall payments as the built-in deal on the April 2009 stress tape
L.fillDefaults(spec); const v = L.E.validateSpec(spec); n++; if (v.errs.length) { bad++; console.log('  FAIL validation', v.errs.slice(0, 3)); }
console.log(bad ? bad + ' of ' + n + ' checks FAILED' : 'all ' + n + ' checks passed'); process.exit(bad ? 1 : 0);
