// ---- projection: the deal run Payment Date by Payment Date, to Stated Maturity or a call
// The collateral is projected loan by loan: annual default and prepayment rates (CDR, CPR) applied each period,
// defaulted par recovered after a lag, loans repaid at their maturity, and principal the waterfall sends to
// reinvestment bought as new loans. Each date's collections then run through the same engine as a single
// Payment Date, and its ending balances, unpaid fees and equity distributions carry into the next date.
const PROJ_PRESETS = [
  { id: 'base', label: 'Base', cdr: 2, cpr: 20, recovery: 70, lagMonths: 6 },
  { id: 'stress', label: 'Stress', cdr: 5, cpr: 15, recovery: 60, lagMonths: 12 },
  { id: 'severe', label: 'Severe', cdr: 10, cpr: 10, recovery: 45, lagMonths: 12 }
];
function projDefaults(spec, result, inputs) {
  const was = result && result.qm && isFinite(result.qm.wasRaw) ? Math.round(result.qm.wasRaw * 100) / 100 : 3;
  return { index: +inputs.libor || 0, reinvestSpread: was, reinvestPrice: 100, reinvestYears: 6, adminPerPeriod: +inputs.adminDue || 0, callDate: '', callPrice: 100 };
}
// A: { cdr, cpr, recovery, lagMonths, index, reinvestSpread, reinvestPrice, reinvestYears, adminPerPeriod, callDate, callPrice }
function projectDeal(E, spec, tape0, inputs0, A, first) {
  const sched = E.schedule(spec).map(x => x.date); const k0 = sched.indexOf(inputs0.paymentDate);
  if (k0 < 0) throw new Error('the current Payment Date ' + inputs0.paymentDate + ' is not on the deal\'s payment schedule');
  const num = (x, d) => (x === '' || x == null || !isFinite(+x) ? d : +x);
  const cdr = Math.min(100, Math.max(0, num(A.cdr, 0))) / 100, cpr = Math.min(100, Math.max(0, num(A.cpr, 0))) / 100, rr = Math.min(100, Math.max(0, num(A.recovery, 0))) / 100;
  const lag = Math.max(0, Math.round(num(A.lagMonths, 0))), index = num(A.index, 0), rSpread = num(A.reinvestSpread, 3), rPrice = Math.max(1, num(A.reinvestPrice, 100)), rYears = Math.max(0.25, num(A.reinvestYears, 6));
  const callPrice = Math.max(0, num(A.callPrice, 100)) / 100, admin = Math.max(0, num(A.adminPerPeriod, 0)); const callDate = A.callDate || '';
  const yrs = (a, b) => E.days(a, b) / 365.25; const maturity = spec.meta.statedMaturity;
  const isDef = x => String(x.defaulted).toUpperCase() === 'Y' || x.defaulted === true;
  // the pool: performing loans, and defaulted par waiting for its recovery
  let loans = tape0.filter(x => !isDef(x) && +x.par > 0.5).map(x => Object.assign({}, x, { par: +x.par }));
  let pipe = tape0.filter(x => isDef(x) && +x.par > 0.5).map(x => ({ due: E.addMonths(inputs0.paymentDate, lag, spec.meta.paymentDay), cash: +x.par * Math.min(1, Math.max(0, (+x.price || 0) / 100)), row: Object.assign({}, x, { par: +x.par }) }));
  const runInputs = (base, over) => Object.assign({}, base, { specialRedemption: 0, rcf: false, rcfAmount: 0, subFeeDeferElect: 0, recoupCumDeferred: 0, reinvestElect: 0, redemption: false, manual: [], lite: true, taxes: 0, hedgePayment: 0, hedgeTermSenior: 0, hedgeTermSub: 0 }, over);
  const wfPaid = (r, wf, type) => (r.waterfalls[wf] || []).filter(x => x.type === type).reduce((s, x) => s + (x.paid || 0), 0);
  const inRPOn = d => E.D(d) <= E.D(spec.meta.reinvestmentPeriodEnd);
  let nNew = 0;
  const buy = (amount, date) => { if (amount < 0.5) return 0; const par = amount * 100 / rPrice; nNew++;
    let mat = E.addMonths(date, Math.round(rYears * 12), 15); if (E.D(mat) >= E.D(maturity)) mat = E.addMonths(maturity, -6, 15);
    loans.push({ id: 'N' + String(nNew).padStart(3, '0'), obligor: 'Reinvestment ' + date, mIndustry: 'Reinvestment', spIndustry: 'Reinvestment', country: 'US', assetType: 'SSL', rateType: 'FLOAT', par, price: 100, purchasePrice: rPrice, spread: rSpread, coupon: 0, moodysDPR: 'B2', moodysFacility: 'B1', spRating: 'B', spRecRating: '3', maturity: mat, defaulted: 'N', defaultDate: '', covLite: 'N', facilitySize: 500000000, payFreq: 'Q' });
    return par; };
  // period 0 is the date on the left, already run: its reinvestment and carry-forward start the projection
  let r = first || E.run(spec, tape0, runInputs(inputs0, { lite: true, manual: inputs0.manual || [] }));
  const periods = []; const carry = (I, res) => {
    const N = {}; spec.classes.forEach(c => { N[c.id] = { bal: Math.max(0, Math.round(res.notes[c.id].balEnd * 100) / 100), def: Math.round(res.notes[c.id].defEnd * 100) / 100 }; });
    return Object.assign({}, I, { notes: N, adminPaidPrior: Math.round((+I.adminPaidPrior || 0) * 2 / 3 + (res.ctx.adminCapPaid || 0)), unpaidSeniorFees: Math.round(res.ctx.seniorFeesUnpaid || 0), unpaidSubFee: Math.round(res.ctx.subFeeUnpaid || 0), cumDeferredFee: Math.round(res.ctx.cumDeferredFeeEnd || 0),
      subHistory: (I.subHistory || []).filter(x => x.date !== res.paymentDate).concat(res.ctx.subPaidToday > 0.5 ? [{ date: res.paymentDate, amount: Math.round(res.ctx.subPaidToday * 100) / 100 }] : []) });
  };
  let I = carry(inputs0, r);
  let carryPrincipal = 0;
  buy(wfPaid(r, 'principal', 'reinvest') + (inRPOn(r.paymentDate) ? wfPaid(r, 'interest', 'reinvestmentDiversion') : 0), r.paymentDate);
  if (!inRPOn(r.paymentDate)) carryPrincipal = wfPaid(r, 'interest', 'reinvestmentDiversion');
  const startNotes = {}; spec.classes.forEach(c => { startNotes[c.id] = { bal: I.notes[c.id].bal, def: I.notes[c.id].def }; });
  for (let j = k0 + 1; j < sched.length; j++) {
    const date = sched[j], prev = sched[j - 1]; const t = yrs(prev, date); const dc = E.days(prev, date) / 360;
    const qD = 1 - Math.pow(1 - cdr, t), qP = 1 - Math.pow(1 - cpr, t);
    let final = j === sched.length - 1 || !!(callDate && E.D(date) >= E.D(callDate));
    const poolStart = loans.reduce((s, x) => s + x.par, 0);
    let def = 0, pre = 0, schd = 0, intc = 0; const next = [];
    for (const x of loans) {
      const d = x.par * qD, p = (x.par - d) * qP; let rem = x.par - d - p; const matured = E.D(x.maturity) <= E.D(date);
      const rate = x.rateType === 'FIXED' ? (+x.coupon || 0) : index + (+x.spread || 0);
      intc += (x.par - d) * rate / 100 * (x.rateType === 'FIXED' ? t : dc);
      if (d > 0.005) pipe.push({ due: E.addMonths(date, lag, spec.meta.paymentDay), cash: d * rr, row: Object.assign({}, x, { id: x.id + '-D' + j, par: d, defaulted: 'Y', defaultDate: date, price: rr * 100, moodysDPR: 'Ca', spRating: 'D' }) });
      def += d; pre += p; if (matured) { schd += rem; rem = 0; }
      if (rem > 0.5) next.push(Object.assign({}, x, { par: rem }));
    }
    loans = next;
    // nothing left to collect after this date: the deal is wound up now rather than left to accrue unpaid interest
    const exhausted = !final && loans.length === 0 && pipe.every(x => E.D(x.due) <= E.D(date)); const wound = exhausted;
    if (exhausted) final = true;
    const due = pipe.filter(x => E.D(x.due) <= E.D(date) && !final); const rec = due.reduce((s, x) => s + x.cash, 0); pipe = pipe.filter(x => !due.includes(x));
    let sale = 0; const tape = loans.map(x => Object.assign({}, x)).concat(pipe.map(x => x.row));
    if (final) { sale = loans.reduce((s, x) => s + x.par, 0) * callPrice + pipe.reduce((s, x) => s + x.cash, 0); }
    const prin = pre + schd + rec + carryPrincipal; carryPrincipal = 0;
    const inp = runInputs(I, { paymentDate: date, libor: index, interestProceeds: Math.round(intc * 100) / 100, principalProceeds: Math.round(prin * 100) / 100, adminDue: admin, mode: final ? 'liquidation' : 'regular', liquidationProceeds: final ? Math.round(sale * 100) / 100 : 0, redemption: !!(final && callDate && E.D(date) >= E.D(callDate)) });
    r = E.run(spec, tape.length ? tape : [{ id: 'X', obligor: 'None', par: 0.01, price: 100, spread: 0, rateType: 'FLOAT', moodysDPR: 'B2', spRating: 'B', maturity: maturity, defaulted: 'N' }], inp);
    const inRP = inRPOn(date);
    const reinv = final ? 0 : wfPaid(r, 'principal', 'reinvest') + (inRP ? wfPaid(r, 'interest', 'reinvestmentDiversion') : 0);
    if (!final && !inRP) carryPrincipal = wfPaid(r, 'interest', 'reinvestmentDiversion');
    const bought = final ? 0 : buy(reinv, date);
    if (final) { loans = []; pipe = []; }
    const fees = ['interest', 'principal', 'liquidation'].reduce((s, wf) => s + wfPaid(r, wf, 'fees'), 0), sub = ['interest', 'principal', 'liquidation'].reduce((s, wf) => s + wfPaid(r, wf, 'subMgmtFee'), 0);
    const N = {}; spec.classes.forEach(c => { const n = r.notes[c.id]; N[c.id] = { int: (n.intPaid || 0) + (n.defPaid || 0), prin: n.prinPaid || 0, bal: n.balEnd, def: n.defEnd || 0, short: n.intShort || 0 }; });
    const lastTest = r.preTests[r.preTests.length - 1];
    periods.push({ n: j + 1, date, mode: inp.mode, wound, inRP, poolStart, defaults: def, prepay: pre, scheduled: schd, recoveries: rec, interest: intc, principal: prin, sale, reinvested: reinv, boughtPar: bought, poolEnd: loans.reduce((s, x) => s + x.par, 0), pipeline: pipe.reduce((s, x) => s + x.row.par, 0),
      notes: N, equity: r.ctx.subPaidToday || 0, seniorFees: fees, subFee: sub, incentive: r.ctx.cmIncentive || 0, diverted: wfPaid(r, 'interest', 'reinvestmentDiversion'), juniorOC: lastTest && lastTest.oc ? lastTest.oc.ratio : null, juniorOCLabel: lastTest ? lastTest.label : '', failing: r.preTests.filter(x => !x.pass).map(x => x.label), equityIRR: r.equityIRR, warnings: r.warnings.length });
    I = carry(I, r);
    const outstanding = spec.classes.some(c => I.notes[c.id].bal > 0.5 || I.notes[c.id].def > 0.5);
    if (final || (!outstanding && loans.length === 0 && pipe.length === 0)) break;
  }
  // summary: by class, weighted average life from the start date, principal and interest received, and any loss
  const t0 = inputs0.paymentDate; const classes = spec.classes.map(c => {
    const prin = periods.reduce((s, p) => s + p.notes[c.id].prin, 0); const wal = prin > 0.5 ? periods.reduce((s, p) => s + p.notes[c.id].prin * yrs(t0, p.date), 0) / prin : null;
    const last = periods.length ? periods[periods.length - 1].notes[c.id] : { bal: startNotes[c.id].bal, def: startNotes[c.id].def };
    return { id: c.id, start: startNotes[c.id].bal, prin, int: periods.reduce((s, p) => s + p.notes[c.id].int, 0), wal, loss: Math.max(0, last.bal) + Math.max(0, last.def), paidOff: periods.find(p => p.notes[c.id].bal < 0.5 && p.notes[c.id].def < 0.5) || null };
  });
  const lastP = periods[periods.length - 1];
  return { periods, classes, equity: { total: periods.reduce((s, p) => s + p.equity, 0), irr: lastP ? lastP.equityIRR : null }, defaults: periods.reduce((s, p) => s + p.defaults, 0), recoveries: periods.reduce((s, p) => s + p.recoveries, 0), endDate: lastP ? lastP.date : t0, called: !!(lastP && callDate && E.D(lastP.date) >= E.D(callDate)), start: t0, assumptions: { cdr: cdr * 100, cpr: cpr * 100, recovery: rr * 100, lagMonths: lag, index, reinvestSpread: rSpread, reinvestPrice: rPrice, reinvestYears: rYears, adminPerPeriod: admin, callDate, callPrice: callPrice * 100 } };
}
if (typeof module !== 'undefined') module.exports = { projectDeal, projDefaults, PROJ_PRESETS };
