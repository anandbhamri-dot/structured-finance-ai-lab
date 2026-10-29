/* CLO indenture engine — deal-agnostic. Runs a deal spec (the interpreted indenture)
   against a loan tape and one Payment Date's inputs. No DOM access in this file. */
(function (root) {
'use strict';

const M_SCALE = ['Aaa','Aa1','Aa2','Aa3','A1','A2','A3','Baa1','Baa2','Baa3','Ba1','Ba2','Ba3','B1','B2','B3','Caa1','Caa2','Caa3','Ca','C'];
const S_SCALE = ['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB+','BB','BB-','B+','B','B-','CCC+','CCC','CCC-','CC','C','SD','D'];

function normM(r) {
  if (r == null) return 'NR';
  const s = String(r).trim();
  const m = s.match(/^(aaa|aa|a|baa|ba|b|caa|ca|c)([123])?$/i);
  if (!m) return s.toUpperCase() === 'NR' || s === '' ? 'NR' : s;
  const base = m[1].toLowerCase();
  return base[0].toUpperCase() + base.slice(1) + (m[2] || '');
}
function mIdx(r) { const i = M_SCALE.indexOf(normM(r)); return i < 0 ? 19 : i; }
function sIdx(r) { const i = S_SCALE.indexOf(String(r || '').trim().toUpperCase()); return i < 0 ? 20 : i; }

// ---------- dates (UTC, ISO yyyy-mm-dd)
function D(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); }
function iso(t) { return new Date(t).toISOString().slice(0, 10); }
function days(a, b) { return Math.round((D(b) - D(a)) / 86400000); }
function addMonths(s, n, day) {
  const t = new Date(D(s)); const y = t.getUTCFullYear(), m = t.getUTCMonth() + n;
  const dd = day || t.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(dd, last)));
}
function schedule(spec) {
  const out = []; const m = spec.meta; let d = m.firstPaymentDate; let k = 1;
  while (D(d) <= D(m.statedMaturity) && k < 200) { out.push({ n: k, date: d }); d = addMonths(d, m.paymentFrequencyMonths || 3, m.paymentDay); k++; }
  return out;
}
function bpsOn(schedule, date) {
  for (const s of schedule) { if (!s.through || D(date) <= D(s.through)) return s.bps; }
  return 0;
}

const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const r2 = x => Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; // money to the cent, as a trustee would
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const truthy = v => v === true || /^(y|yes|true|1)$/i.test(String(v == null ? '' : v).trim());

// ---------- tape normalisation
const ASSET_ALIASES = { SSL: 'SSL', 'SENIOR SECURED': 'SSL', 'FIRST LIEN': 'SSL', '1L': 'SSL', '2L': '2L', 'SECOND LIEN': '2L', UNSEC: 'UNSEC', 'SENIOR UNSECURED': 'UNSEC', UNSECURED: 'UNSEC', BOND: 'BOND', HY: 'BOND' };
function normAsset(a) { const k = String(a || 'SSL').trim().toUpperCase(); return ASSET_ALIASES[k] || 'SSL'; }
function num(v, dflt) { if (v === '' || v == null) return dflt; const n = Number(String(v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : dflt; }

function normaliseRow(r, i) {
  const o = {
    id: r.id || String(i + 1), obligor: r.obligor || ('Obligor ' + (i + 1)),
    mIndustry: r.mIndustry || r.industry || 'Unclassified', spIndustry: r.spIndustry || r.mIndustry || r.industry || 'Unclassified',
    country: String(r.country || 'US').trim().toUpperCase(), assetType: normAsset(r.assetType),
    rateType: /fix/i.test(r.rateType || '') ? 'FIXED' : 'FLOAT',
    par: num(r.par, 0), price: num(r.price, 100), purchasePrice: num(r.purchasePrice, num(r.price, 100)),
    spread: num(r.spread, 0), coupon: num(r.coupon, 0),
    moodysDPR: normM(r.moodysDPR || r.moodys || 'B2'), moodysFacility: normM(r.moodysFacility || r.moodysDPR || r.moodys || 'B2'),
    spRating: String(r.spRating || 'B').trim().toUpperCase(), spRecRating: r.spRecRating ? String(r.spRecRating).trim() : '',
    maturity: r.maturity || '', defaulted: truthy(r.defaulted), defaultDate: r.defaultDate || '',
    covLite: truthy(r.covLite), facilitySize: num(r.facilitySize, null), payFreq: String(r.payFreq || 'Q').trim().toUpperCase()[0] || 'Q',
    dip: truthy(r.dip), currentPay: truthy(r.currentPay), pik: truthy(r.pik), revolver: truthy(r.revolver),
    participation: truthy(r.participation), synthetic: truthy(r.synthetic), zeroCoupon: truthy(r.zeroCoupon), discountCured: truthy(r.discountCured)
  };
  return o;
}

// ---------- portfolio analytics
function analysePortfolio(spec, tape, opt) {
  const rec = spec.recovery, hc = spec.haircuts;
  const asOf = opt.asOf; const libor = opt.libor;
  const rows = tape.map(normaliseRow);
  const cccM = mIdx(hc.ccc.moodysAtOrBelow), cccS = sIdx(hc.ccc.spAtOrBelow);
  const rf = spec.ratingFactors;
  for (const r of rows) {
    r.rf = rf[r.moodysDPR] != null ? rf[r.moodysDPR] : 10000;
    // Moody's recovery: notches by which facility rating sits above the DPR
    const notch = mIdx(r.moodysDPR) - mIdx(r.moodysFacility);
    const tbl = r.assetType === 'SSL' ? rec.moodys.SSL : r.assetType === 'BOND' ? rec.moodys.BOND : rec.moodys.NSSL;
    const n = clamp(notch, -3, 2);
    r.mRR = tbl[String(n)];
    const srr = r.spRecRating || rec.sp.defaultRecoveryRating[r.assetType] || '3';
    r.spRecUsed = srr;
    const rowS = rec.sp.table[srr] || rec.sp.table['3'];
    r.sRR = {}; rec.sp.cols.forEach((c, k) => { r.sRR[c] = rowS[k]; });
    r.ccc = !r.defaulted && (mIdx(r.moodysDPR) >= cccM || sIdx(r.spRating) >= cccS);
    const belowB3 = mIdx(r.moodysFacility) > mIdx('B3');
    const dTbl = r.assetType === 'BOND' ? hc.discount.other : hc.discount.loan;
    r.discount = !r.defaulted && !r.discountCured && r.purchasePrice < (belowB3 ? dTbl.belowB3 : dTbl.atLeastB3);
    r.matAfterStated = r.maturity ? D(r.maturity) > D(spec.meta.statedMaturity) : false;
    r.yrs = r.maturity ? Math.max(0, Math.round(days(asOf, r.maturity) / 365 * 100) / 100) : 0;
    r.yrsDefaulted = r.defaulted && r.defaultDate ? days(r.defaultDate, asOf) / 365 : 0;
  }
  return { rows, cccM, cccS, libor, asOf };
}

function principalBalances(spec, pf, principalCash, seniorCol) {
  const hc = spec.haircuts; const rows = pf.rows;
  let hDef = 0, hDisc = 0, hCcc = 0;
  for (const r of rows) {
    r.ocPB = r.par; r.ocReason = '';
    if (r.defaulted) {
      const recVal = r2(Math.min(r.mRR, r.sRR[seniorCol]) / 100 * r.par);
      const b = r.yrsDefaulted > hc.defaulted.zeroAfterYears ? 0 : Math.min(r2(r.price / 100 * r.par), recVal);
      hDef += r.par - b; r.ocPB = b; r.ocReason = r.yrsDefaulted > hc.defaulted.zeroAfterYears ? 'Defaulted > ' + hc.defaulted.zeroAfterYears + 'y: zero' : 'Defaulted: lesser of MV and recovery value';
    } else if (r.discount) {
      const b = r2(r.purchasePrice / 100 * r.par); hDisc += r.par - b; r.ocPB = b; r.ocReason = 'Discount obligation: purchase price';
    }
  }
  const pcvNoCcc = sum(rows, r => r.ocPB) + principalCash;
  const elig = r => !r.defaulted && !r.discount;
  const bucketM = rows.filter(r => elig(r) && mIdx(r.moodysDPR) >= pf.cccM);
  const bucketS = rows.filter(r => elig(r) && sIdx(r.spRating) >= pf.cccS);
  const amtM = sum(bucketM, r => r.par), amtS = sum(bucketS, r => r.par);
  const limit = r2(hc.ccc.limitPct / 100 * pcvNoCcc);
  const bucket = amtM >= amtS ? bucketM : bucketS;
  const cccAmt = Math.max(amtM, amtS);
  let excess = r2(Math.max(0, cccAmt - limit));
  const cccExcess = excess;
  if (excess > 0) {
    const sorted = bucket.slice().sort((a, b) => a.price - b.price);
    for (const r of sorted) {
      if (excess <= 0) break;
      const alloc = Math.min(r.par, excess); excess = r2(excess - alloc);
      const hcBal = Math.min(r2(hc.ccc.haircutPct / 100 * alloc), r2(r.price / 100 * alloc));
      const nb = (r.par - alloc) + hcBal; hCcc += r.ocPB - nb; r.ocPB = nb; r.cccAlloc = alloc;
      r.ocReason = 'CCC excess: lesser of ' + hc.ccc.haircutPct + '% and MV on ' + fmtM(alloc);
    }
  }
  const parTotal = sum(rows, r => r.par);
  const pcvOC = sum(rows, r => r.ocPB) + principalCash;
  return { parTotal, pcvGeneral: parTotal + principalCash, pcvOC, principalCash, cccAmtMoodys: amtM, cccAmtSP: amtS, cccLimit: limit, cccExcess, haircut: { defaulted: hDef, discount: hDisc, ccc: hCcc } };
}
function fmtM(x) { return '$' + (x / 1e6).toFixed(2) + 'm'; }

// Moody's diversity score
function industryScore(u) {
  const x = Math.round(u * 10) / 10;
  if (x <= 1) return x;
  if (x <= 3) return 1 + 0.5 * (x - 1);
  if (x <= 6) return 2 + (x - 3) / 3;
  if (x <= 10) return 3 + 0.25 * (x - 6);
  return Math.min(5, 4 + 0.1 * (x - 10));
}
function diversityScore(rows) {
  const byOb = {};
  for (const r of rows) { const k = r.obligor; (byOb[k] = byOb[k] || { par: 0, ind: r.mIndustry }).par += r.par; }
  const obs = Object.values(byOb); if (!obs.length) return 0;
  const avg = sum(obs, o => o.par) / obs.length;
  const byInd = {};
  for (const o of obs) byInd[o.ind] = (byInd[o.ind] || 0) + Math.min(1, o.par / avg);
  return Math.round(sum(Object.values(byInd), u => industryScore(u)) * 100) / 100;
}

function interp1(xs, x) {
  if (x <= xs[0]) return [0, 0, 0];
  if (x >= xs[xs.length - 1]) return [xs.length - 1, xs.length - 1, 0];
  for (let i = 0; i < xs.length - 1; i++) if (x >= xs[i] && x <= xs[i + 1]) return [i, i + 1, (x - xs[i]) / (xs[i + 1] - xs[i])];
  return [0, 0, 0];
}
function matrixLookup(mx, rowVal, colVal) {
  const [r0, r1, rt] = interp1(mx.rows, rowVal); const [c0, c1, ct] = interp1(mx.cols, colVal);
  const v = (r, c) => mx.values[r][c];
  const top = v(r0, c0) + (v(r0, c1) - v(r0, c0)) * ct;
  const bot = v(r1, c0) + (v(r1, c1) - v(r1, c0)) * ct;
  return Math.round((top + (bot - top) * rt) * 100) / 100;
}

function qualityMetrics(spec, pf, sel) {
  const nd = pf.rows.filter(r => !r.defaulted);
  const apb = sum(nd, r => r.par);
  const fl = nd.filter(r => r.rateType === 'FLOAT'), fx = nd.filter(r => r.rateType === 'FIXED');
  const flPar = sum(fl, r => r.par), fxPar = sum(fx, r => r.par);
  const sp = spec.spreadRules || {};
  const excessFunded = sp.excessParSpread ? pf.libor * Math.max(0, apb - spec.meta.targetPar) : 0;
  const wasRaw = flPar ? (sum(fl, r => r.par * r.spread) + excessFunded) / flPar : 0;
  const wacRaw = fxPar ? sum(fx, r => r.par * r.coupon) / fxPar : null;
  const minWAS = sp.minWAS != null ? sp.minWAS : 0, minWAC = sp.minWAC != null ? sp.minWAC : 0;
  const spreadExcess = fxPar ? Math.max(0, wasRaw - minWAS) * flPar / fxPar : 0;
  const couponExcess = (fxPar && flPar && wacRaw != null) ? Math.max(0, wacRaw - minWAC) * fxPar / flPar : 0;
  const warf = apb ? Math.ceil(sum(nd, r => r.par * r.rf) / apb) : 0;
  const mwarr = apb ? Math.ceil(sum(nd, r => r.par * r.mRR) / apb * 10) / 10 : 0;
  const swarr = {}; spec.recovery.sp.cols.forEach(c => { swarr[c] = apb ? sum(nd, r => r.par * r.sRR[c]) / apb : 0; });
  const wal = apb ? sum(nd, r => r.par * r.yrs) / apb : 0;
  const ds = diversityScore(nd);
  let wac = wacRaw;
  if (wacRaw != null && wacRaw < minWAC) wac = Math.min(minWAC, wacRaw + spreadExcess);
  return { apb, flPar, fxPar, wasRaw, wacRaw, wac, spreadExcess, couponExcess, excessFunded, warf, mwarr, swarr, wal, ds, anyLateMaturity: pf.rows.some(r => r.matAfterStated), nObligors: new Set(nd.map(r => r.obligor)).size };
}

function evalQuality(spec, qm, sel, ctx) {
  const out = [];
  // WAS requirement drives coupon-excess top-up
  let wasNeeded = 0;
  for (const t of spec.qualityTests) {
    if (t.metric !== 'was') continue;
    try { const need = requiredWAS(t, qm, sel); if (isFinite(need)) wasNeeded = Math.max(wasNeeded, need); } catch (err) { /* reported when the test itself is evaluated below */ }
  }
  let was = qm.wasRaw;
  if (was < wasNeeded) was = Math.min(wasNeeded, was + qm.couponExcess);
  qm.was = was;
  for (const t of spec.qualityTests) {
    try {
    const r = { id: t.id, label: t.label, ref: t.ref, op: t.op, note: '' };
    if (t.metric === 'external') { r.value = null; r.limit = null; r.pass = sel.external && sel.external[t.id] != null ? sel.external[t.id] : null; r.note = t.note || 'Requires the rating agency model; enter the result manually.'; out.push(r); continue; }
    if (t.metric === 'warf') { r.value = qm.warf; r.fmt = 'int'; }
    else if (t.metric === 'was') { r.value = was; r.fmt = 'pct2'; }
    else if (t.metric === 'wac') { r.value = qm.wac; r.fmt = 'pct2'; if (qm.wac == null) { r.pass = true; r.note = 'No fixed-rate assets: test not applicable'; r.limit = t.limit; out.push(r); continue; } }
    else if (t.metric === 'wal') { r.value = qm.wal; r.fmt = 'yrs'; }
    else if (t.metric === 'diversity') { r.value = qm.ds; r.fmt = 'dec1'; }
    else if (t.metric === 'moodysWARR') { r.value = qm.mwarr; r.fmt = 'pct1'; }
    else if (t.metric === 'spWARR') {
      const caseIdx = (sel.spCase || 1) - 1; const lim = t.limit.values[caseIdx] || t.limit.values[0];
      r.sub = spec.recovery.sp.cols.map((c, k) => ({ col: c, value: qm.swarr[c], limit: lim[k], pass: qm.swarr[c] >= lim[k] }));
      r.pass = r.sub.every(s => s.pass); r.value = qm.swarr[spec.recovery.sp.cols[0]]; r.limit = lim[0]; r.fmt = 'pct2';
      r.note = 'Case ' + (caseIdx + 1) + '; shown for the most senior class, all classes checked'; out.push(r); continue;
    }
    // limit
    let lim = t.limit;
    if (lim && typeof lim === 'object') {
      if (lim.type === 'matrix') {
        const mx = (qm.anyLateMaturity && lim.alt) ? lim.alt : lim.main;
        const base = matrixLookup(mx, clamp(was, mx.rows[0], mx.rows[mx.rows.length - 1]), clamp(qm.ds, mx.cols[0], mx.cols[mx.cols.length - 1]));
        let rfm = 0;
        if (lim.modifier) { const mv = sel.moodysModifier || lim.modifier.maxDefault || 100; rfm = Math.max(0, Math.min(qm.mwarr, mv) - lim.modifier.base) * lim.modifier.mult; }
        lim = Math.min(base + rfm, lim.cap || Infinity);
        r.note = 'Matrix ' + (+base.toFixed(2)) + (rfm ? ' + modifier ' + (+rfm.toFixed(2)) : '') + (qm.anyLateMaturity && t.limit.alt ? ' (Table II: an asset matures after Stated Maturity)' : '');
      } else if (lim.type === 'case') { lim = lim.values[(sel.spCase || 1) - 1]; r.note = 'Case ' + (sel.spCase || 1); }
      else if (lim.type === 'declining') { const L = lim; const y = days(ctx.meta[L.from] || ctx.meta.effectiveDate, ctx.asOf) / 365; lim = Math.max(0, L.startYears - y); r.note = L.startYears + ' years less ' + y.toFixed(2) + ' years since the ' + (L.from || 'effectiveDate').replace(/([A-Z])/g, ' $1').toLowerCase(); }
    }
    if (t.metric === 'was' && t.adjust && t.adjust.type === 'recoveryModifier') {
      const mv = sel.moodysModifier; const row = (t.adjust.table || []).find(x => x[0] === mv);
      const add = row && row[1] != null ? Math.max(0, qm.mwarr - mv) * row[1] / 100 : 0;
      r.value = was + add; r.note = add ? 'WAS ' + was.toFixed(2) + '% + recovery modifier ' + add.toFixed(3) + '%' : 'No recovery modifier at this Modifier Variable';
    }
    r.limit = lim;
    r.pass = t.op === '<=' ? r.value <= lim + 1e-9 : r.value >= lim - 1e-9;
    if (t.metric === 'was' && qm.wasRaw < was) r.note = (r.note ? r.note + '; ' : '') + 'includes coupon excess ' + (was - qm.wasRaw).toFixed(3) + '%';
    if (typeof r.limit !== 'number' || !isFinite(r.limit) || r.value == null || isNaN(r.value)) { r.pass = null; r.failed = true; r.note = 'Could not be evaluated: the deal spec gives no usable limit for this test'; }
    out.push(r);
    } catch (err) { out.push({ id: t.id, label: t.label, ref: t.ref, op: t.op, value: null, limit: null, pass: null, failed: true, note: 'Could not be evaluated: ' + plainError(err) }); }
  }
  return out;
}
function requiredWAS(t, qm, sel) {
  let lim = t.limit;
  if (lim && typeof lim === 'object' && lim.type === 'case') lim = lim.values[(sel.spCase || 1) - 1];
  if (t.adjust && t.adjust.type === 'recoveryModifier') {
    const row = (t.adjust.table || []).find(x => x[0] === sel.moodysModifier);
    if (row && row[1] != null) lim -= Math.max(0, qm.mwarr - sel.moodysModifier) * row[1] / 100;
  }
  return typeof lim === 'number' ? lim : 0;
}

// ---------- concentrations (Portfolio Profile Test)
function rowMatches(r, filter) {
  for (const c of (filter || [])) {
    const v = r[c.f];
    if (c.in && !c.in.map(x => String(x).toUpperCase()).includes(String(v).toUpperCase())) return false;
    if (c.notIn && c.notIn.map(x => String(x).toUpperCase()).includes(String(v).toUpperCase())) return false;
    if (c.eq !== undefined && !!v !== !!c.eq) return false;
    if (c.lt !== undefined && !(v != null && v < c.lt)) return false;
    if (c.gt !== undefined && !(v != null && v > c.gt)) return false;
  }
  return true;
}
function evalConcentrations(spec, pf, pcvGeneral, rawTape, principalCash) {
  const out = []; const rows = pf.rows;
  const fieldPresent = f => ['ccc', 'matAfterStated', 'discount', 'assetType', 'rateType', 'country', 'defaulted'].includes(f) || rawTape.some(t => t[f] !== undefined && t[f] !== '' && t[f] !== null);
  for (const c of spec.concentrations || []) {
    const r = { id: c.id, label: c.label, ref: c.ref, op: c.op || '<=', limit: c.limit };
    if (c.metric === 'maxObligor' || c.metric === 'maxIndustry' || c.metric === 'maxByField') {
      const field = c.metric === 'maxObligor' ? 'obligor' : (c.field || (c.metric === 'maxIndustry' ? 'spIndustry' : 'country'));
      const g = {};
      for (const x of rows) { const k = x[field]; if (c.within && !c.within.includes(k)) continue; g[k] = (g[k] || 0) + x.par; }
      const arr = Object.entries(g).map(([k, v]) => ({ k, pct: v / pcvGeneral * 100 })).sort((a, b) => b.pct - a.pct);
      const ex = c.exceptions; let pass = true, worst = arr[0] || { k: '—', pct: 0 };
      arr.forEach((e, i) => { const lim = ex && i < ex.count ? ex.limit : c.limit; if (e.pct > lim + 1e-9) pass = false; });
      r.value = worst.pct; r.top = arr.slice(0, 3); r.pass = pass; r.fmt = 'pct2';
      r.note = 'Largest: ' + worst.k + (ex ? '; up to ' + ex.count + ' may reach ' + ex.limit + '%' : '');
    } else {
      const missing = (c.filter || []).filter(f => !fieldPresent(f.f)).map(f => f.f);
      let amt = sum(rows.filter(x => rowMatches(x, c.filter)), x => x.par);
      if (c.cashAs && rowMatches(Object.assign({ assetType: 'SSL', rateType: 'FLOAT', country: 'US' }, c.cashAs), c.filter)) { amt += principalCash; r.note = 'Principal cash counted as senior secured, as the clause directs'; }
      r.value = amt / pcvGeneral * 100; r.amount = amt; r.fmt = 'pct2';
      r.pass = r.op === '>=' ? r.value >= c.limit - 1e-9 : r.value <= c.limit + 1e-9;
      if (missing.length) { r.note = (r.note ? r.note + '; ' : '') + 'Tape has no ' + missing.join(', ') + ' column: treated as none'; r.missing = true; }
    }
    out.push(r);
  }
  return out;
}

// ---------- waterfall interpreter
function hurdleDetail(spec, hist, date, paidToday) {
  const inc = (spec.fees && spec.fees.incentive) || { hurdleIRR: 0 }; const r = inc.hurdleIRR / 100; const basis = inc.dayBasis || 360; const c0 = spec.meta.closingDate;
  const df = n => +(1 / Math.pow(1 + r, n / basis)).toFixed(9);
  const rows = []; let pvSum = 0;
  for (const h of hist) { if (D(h.date) <= D(date)) { const n = days(c0, h.date); const f = df(n); const pv = r2(h.amount * f); pvSum += pv; rows.push({ date: h.date, n, amount: h.amount, f, pv }); } }
  const tn = days(c0, date);
  if (paidToday > 0.005) { const f = df(tn); const pv = r2(paidToday * f); pvSum += pv; rows.push({ date: date + ' (earlier today)', n: tn, amount: paidToday, f, pv }); }
  pvSum = r2(pvSum); const unrec = r2(spec.equity.balance - pvSum); const grow = +Math.pow(1 + r, tn / basis).toFixed(9);
  return { rows, pvSum, unrec, grow, tn, r, basis, c0, need: r2(unrec * grow) };
}
function hurdleAmount(spec, hist, date, paidToday) {
  if (!spec.fees || !spec.fees.incentive || !(+spec.fees.incentive.hurdleIRR > 0) || !spec.equity) return Infinity;
  return hurdleDetail(spec, hist, date, paidToday).need;
}
function xirr(flows, basis) {
  // flows: [{t (days), amount}]
  const f = rate => sum(flows, x => x.amount / Math.pow(1 + rate, x.t / basis));
  let lo = -0.99, hi = 5;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

// Fill optional blocks an interpreted spec may leave out, without touching the caller's object.
// Anything that changes the result is reported in warnings.
function prepSpec(s0, warnings) {
  const s = Object.assign({}, s0);
  const F = s.fees = Object.assign({}, s0.fees || {});
  const fill = (k, label) => { if (F[k]) F[k] = Object.assign({ label }, F[k]); };
  fill('seniorMgmt', 'Senior Management Fee'); fill('structuring', 'Structuring Fee'); fill('subMgmt', 'Subordinated Management Fee');
  ['seniorMgmt', 'structuring'].forEach(k => {
    const f = F[k]; if (!f) return;
    if (!Array.isArray(f.schedule) || !f.schedule.length) {
      const bps = +f.bps; F[k] = Object.assign({}, f, { schedule: [{ bps: bps >= 0 ? bps : 0 }] });
      if (!(bps >= 0)) warnings.push('fees.' + k + ' gives no rate, so it is treated as 0 bps');
    }
  });
  if (F.subMgmt && !(+F.subMgmt.bps >= 0)) { F.subMgmt = Object.assign({}, F.subMgmt, { bps: 0 }); warnings.push('fees.subMgmt gives no rate, so it is treated as 0 bps'); }
  if (F.adminCap && !(+F.adminCap.bpsOfPCV >= 0 && +F.adminCap.fixed >= 0)) { delete F.adminCap; warnings.push('fees.adminCap is incomplete, so Administrative Expenses are uncapped'); }
  if (F.incentive && !(+F.incentive.hurdleIRR > 0)) { delete F.incentive; warnings.push('fees.incentive gives no hurdle IRR, so no incentive fee is modelled'); }
  else if (F.incentive && !(+F.incentive.managerShare >= 0)) { F.incentive = Object.assign({}, F.incentive, { managerShare: 0 }); warnings.push('fees.incentive gives no manager share, so the incentive split pays 0% to the manager'); }
  const C = s.coverage = Object.assign({}, s0.coverage || {});
  C.tests = Array.isArray(C.tests) ? C.tests : []; C.icNumeratorDeducts = C.icNumeratorDeducts || [];
  const rt = C.reinvestmentTest;
  if (rt && !(Array.isArray(rt.ocClasses) && rt.ocClasses.length && +rt.trigger > 0)) { delete C.reinvestmentTest; warnings.push('coverage.reinvestmentTest is incomplete (it needs ocClasses and trigger), so no interest is diverted'); }
  else if (rt) {
    C.reinvestmentTest = Object.assign({ label: 'Interest Reinvestment Test' }, rt);
    if (!(+rt.maxDiversionPct > 0)) { C.reinvestmentTest.maxDiversionPct = 100; warnings.push('coverage.reinvestmentTest gives no maximum diversion, so up to 100% of remaining interest can be diverted'); }
  }
  const et = C.eodTest;
  if (et && !(Array.isArray(et.ocClasses) && et.ocClasses.length && +et.trigger > 0)) { delete C.eodTest; warnings.push('coverage.eodTest is incomplete (it needs ocClasses and trigger), so the Event of Default test is not run'); }
  else if (et) C.eodTest = Object.assign({ label: 'Event of Default OC test' }, et);
  s.equity = Object.assign({ name: 'Subordinated Notes' }, s0.equity || {});
  s.waterfalls = Object.assign({}, s0.waterfalls || {});
  return s;
}
const STEP_NEEDS = { principal: ['classes'], interest: ['classes'], fees: ['items'], cure: ['paydown'], cureAll: ['tests', 'paydown'], rcf: ['paydown'], specialRedemption: ['paydown'], amortize: ['paydown'], unpaidFrom: ['steps'] };
function stepGap(st) {
  const f = (STEP_NEEDS[st.type] || []).find(f => !Array.isArray(st[f]) || !st[f].length);
  if (f) return 'the step has no \u201c' + f + '\u201d list in the deal spec';
  if (st.type === 'expense' && !st.item && !(Array.isArray(st.items) && st.items.length)) return 'the step has no \u201citem\u201d in the deal spec';
  if (st.type === 'interestAndPrincipal' && !st.class) return 'the step has no \u201cclass\u201d in the deal spec';
  return null;
}
// "Cannot read properties of undefined (reading 'x')" in words a reader can act on
function plainError(e) {
  const m = String(e && e.message || e);
  let k = m.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/);
  if (k && /^(map|forEach|reduce|filter|find|some|every|join|includes|length|slice|indexOf|\d+)$/.test(k[1])) return 'the deal spec is missing a list or table the engine needs';
  if (k) return 'the deal spec is missing \u201c' + k[1] + '\u201d, or the block that holds it';
  k = m.match(/^([\w.]+) is not iterable/);
  if (k) return 'the deal spec is missing a list the engine needs (\u201c' + k[1].replace(/^st\./, '') + '\u201d)';
  return m;
}

function run(spec0, tape, inp) {
  const warnings = [];
  const spec = prepSpec(spec0, warnings);
  const sched = schedule(spec);
  const idx = Math.max(0, sched.findIndex(s => s.date === inp.paymentDate));
  const pd = sched[idx] ? sched[idx].date : inp.paymentDate;
  const prev = idx > 0 ? sched[idx - 1].date : spec.meta.closingDate;
  const period = idx + 1;
  const ndays = days(prev, pd); const dcf = ndays / 360;
  const inRP = D(pd) <= D(spec.meta.reinvestmentPeriodEnd);
  const libor = +inp.libor || 0;
  const mode = inp.mode || 'regular';
  const sel = inp.selections || {};

  // notes
  const notes = {}; const order = spec.classes.map(c => c.id);
  for (const c of spec.classes) {
    const st = (inp.notes || {})[c.id] || {};
    const bal = st.bal != null ? +st.bal : c.balance, def = +(st.def || 0);
    const rate = c.fixedRate != null && c.fixedRate !== '' ? +c.fixedRate : libor + (+c.spread || 0);
    notes[c.id] = { id: c.id, name: c.name, deferrable: !!c.deferrable, spread: +c.spread || 0, fixed: c.fixedRate != null && c.fixedRate !== '', rate, bal0: bal, def0: def, bal, def, defForTest: def,
      intDue: r2((bal + def) * rate / 100 * dcf), intPaid: 0, defPaid: 0, prinPaid: 0, defPaidCure: 0 };
  }
  const seniorOut = spec.classes.find(c => notes[c.id].bal > 0.5);
  const seniorCol = (seniorOut || spec.classes[0]).spCol || spec.recovery.sp.cols[0];

  // portfolio
  const principalCash = +inp.principalProceeds || 0;
  const pf = analysePortfolio(spec, tape, { asOf: pd, libor });
  const pb = principalBalances(spec, pf, principalCash, seniorCol);
  const qm = qualityMetrics(spec, pf, sel);
  const quality = evalQuality(spec, qm, sel, { meta: spec.meta, asOf: pd });
  const conc = evalConcentrations(spec, pf, pb.pcvGeneral, tape, principalCash);

  // interest proceeds estimate
  const nd = pf.rows.filter(r => !r.defaulted);
  const ndF = nd.filter(r => r.rateType !== 'FIXED'), ndX = nd.filter(r => r.rateType === 'FIXED');
  const estParts = { flPar: sum(ndF, r => r.par), flSp: sum(ndF, r => r.par * r.spread), fxPar: sum(ndX, r => r.par), fxCp: sum(ndX, r => r.par * r.coupon) };
  estParts.idx = r2(estParts.flPar * libor / 100 * dcf); estParts.spr = r2(estParts.flSp / 100 * dcf); estParts.cpn = r2(estParts.fxCp / 100 * dcf);
  const estInterest = r2(estParts.idx + estParts.spr + estParts.cpn);
  const interestProceeds = inp.interestProceeds != null && inp.interestProceeds !== '' ? +inp.interestProceeds : estInterest;

  // fees & expenses due
  const feeBasis = inp.feeBasis != null && inp.feeBasis !== '' ? +inp.feeBasis : pb.pcvGeneral;
  const F = spec.fees;
  const eRate = notes[F.subMgmt && F.subMgmt.unpaidAccruesAtClass] ? notes[F.subMgmt.unpaidAccruesAtClass].rate : 0;
  const dues = {
    taxes: +inp.taxes || 0,
    hedge: +inp.hedgePayment || 0,
    hedgeTermSenior: +inp.hedgeTermSenior || 0,
    hedgeTermSub: +inp.hedgeTermSub || 0,
    revolverFunding: 0,
    seniorMgmt: F.seniorMgmt ? r2(feeBasis * bpsOn(F.seniorMgmt.schedule, pd) / 1e4 * dcf) + (+inp.unpaidSeniorFees || 0) : 0,
    structuring: F.structuring ? r2(feeBasis * bpsOn(F.structuring.schedule, pd) / 1e4 * dcf) : 0,
    subMgmtCurrent: F.subMgmt ? r2(feeBasis * F.subMgmt.bps / 1e4 * dcf) : 0,
    subMgmtPrior: r2((+inp.unpaidSubFee || 0) * (1 + eRate / 100 * dcf))
  };
  // ---- manual amounts tagged to waterfall steps
  const manualNotes = [];
  const hasItem = (st, k) => (st.type === 'expense' || st.type === 'fees') && (st.type === 'fees' ? st.items || [] : st.items || [st.item]).includes(k);
  const RANKTXT = { before: 'paid before the clause\'s own amounts', prorata: 'pro rata with the clause\'s own amounts', after: 'paid after the clause\'s own amounts' };
  const manualAll = (Array.isArray(inp.manual) ? inp.manual : []).map((m, i) => ({ n: i + 1, name: String(m.name || '').trim() || 'Manual amount ' + (i + 1), amount: r2(+m.amount || 0), wf: ['interest', 'principal', 'liquidation'].includes(m.wf) ? m.wf : 'interest', step: String(m.step == null ? '' : m.step), rank: ['before', 'prorata', 'after'].includes(m.rank) ? m.rank : 'after', paid: 0, status: '' }));
  const manualAt = {}; const adminRows = [];
  manualAll.forEach(m => {
    if (!(m.amount > 0.005)) { m.status = 'No amount'; return; }
    const st = (spec.waterfalls[m.wf] || []).find(x => x.id === m.step);
    if (!st) { m.status = 'Not paid: this deal has no ' + m.wf + ' step ' + (m.step || '(none chosen)'); manualNotes.push('Manual input ' + m.n + ', ' + m.name + ', is tagged to ' + m.wf + ' step ' + (m.step || '(none)') + ', which this deal does not have, so it is not paid.'); return; }
    m.label = st.label;
    if (hasItem(st, 'admin')) { m.admin = true; m.rank = 'cap'; adminRows.push(m); return; }
    if ((m.wf === 'liquidation') !== (mode === 'liquidation')) { m.status = m.wf === 'liquidation' ? 'Applies only to the Liquidation waterfall' : 'Not paid: the Liquidation waterfall is running'; return; }
    (manualAt[m.wf + '|' + m.step] = manualAt[m.wf + '|' + m.step] || []).push(m);
  });
  const adminEntered = +inp.adminDue || 0;
  const adminSeq = [{ name: 'Administrative Expenses entered', amount: adminEntered }].concat(adminRows.map(m => ({ name: m.name, amount: m.amount, m })));
  const adminDue = r2(adminEntered + sum(adminRows, m => m.amount));
  let adminCap = Infinity;
  if (F.adminCap) adminCap = Math.max(0, r2(F.adminCap.bpsOfPCV / 1e4 * pb.pcvGeneral) + F.adminCap.fixed - (+inp.adminPaidPrior || 0));
  dues.admin = Math.min(adminDue, adminCap); dues.adminExcess = adminDue - dues.admin;
  const origDues = Object.assign({}, dues);

  const cov = spec.coverage;
  const ctx = {
    spec, notes, order, pcv: pb.pcvOC - (inp.principalCashInPCV === false ? principalCash : 0), pcvStart: pb.pcvOC - (inp.principalCashInPCV === false ? principalCash : 0), pcvLog: [], holdOut: 0, principalInPCV: inp.principalCashInPCV !== false, period, dcf, mode, inRP,
    icNum: 0, subPaidToday: 0, cmIncentive: 0, unpaidManual: {}, adminCapPaid: 0, adminExcessPaid: 0, adminCapPaidAll: 0, buckets: { regular: principalCash, reinvestOnly: 0 },
    unpaid: {}, cumDeferredFee: +inp.cumDeferredFee || 0, subFeeUnpaidOut: 0, currentDeferred: 0, recouped: 0, eod: [], reinvested: 0
  };

  // IC numerator: Interest Proceeds less amounts payable under the listed interest-POP steps
  const stepDue = st => {
    const man = sum(manualAt['interest|' + st.id] || [], m => m.amount);
    if (st.type === 'expense') return sum(st.items || [st.item], k => k === 'admin' ? dues.admin : (dues[k] || 0)) + man;
    if (st.type === 'fees') return sum(st.items, k => dues[k] || 0) + man;
    return man;
  };
  const ipSteps = spec.waterfalls.interest || [];
  const icDeduct = sum(ipSteps.filter(s => (cov.icNumeratorDeducts || []).includes(s.id)), stepDue);
  ctx.icNum = interestProceeds - icDeduct;
  const icParts = ipSteps.filter(s => (cov.icNumeratorDeducts || []).includes(s.id)).map(s => ({ id: s.id, label: s.label, amount: stepDue(s) }));

  // ---- test helpers
  const ocOf = (classes, n, pcv) => { const den = sum(classes, c => n[c] ? n[c].bal : 0); return { num: pcv, den, ratio: den > 0.5 ? pcv / den * 100 : Infinity }; };
  const icOf = (classes, n) => {
    const den = sum(classes, c => { const x = n[c]; if (!x) return 0; return r2((x.bal + x.defForTest) * x.rate / 100 * dcf) + (x.deferrable ? x.defForTest : 0); });
    return { num: ctx.icNum, den, ratio: den > 0.01 ? ctx.icNum / den * 100 : Infinity };
  };
  const testById = id => cov.tests.find(t => t.id === id);
  const evalGroup = (t, n, pcv) => {
    const o = ocOf(t.oc.classes, n, pcv); const oPass = o.ratio >= t.oc.trigger - 1e-11;
    let i = null, iPass = true, icApplies = !!t.ic && period >= (t.ic.fromPeriod || 1);
    if (t.ic) { i = icOf(t.ic.classes, n); if (icApplies) iPass = i.ratio >= t.ic.trigger - 1e-11; }
    return { oc: o, ic: i, ocPass: oPass, icPass: iPass, icApplies, pass: oPass && iPass };
  };
  const snapshotTests = (n, pcv) => cov.tests.map(t => Object.assign({ id: t.id, label: t.label, ocTrigger: t.oc.trigger, icTrigger: t.ic ? t.ic.trigger : null, ocRef: t.oc.ref, icRef: t.ic && t.ic.ref }, evalGroup(t, n, pcv)));
  const cloneNotes = n => { const o = {}; for (const k in n) o[k] = Object.assign({}, n[k]); return o; };
  const applyPaydown = (n, seq, X, inclDef) => {
    let left = X; const paid = [];
    for (const c of seq) {
      const x = n[c]; if (!x || left <= 0) continue;
      if (x.deferrable && (inclDef || []).includes(c) && x.def > 0) { const p = Math.min(left, x.def); x.def -= p; x.defForTest = Math.max(0, x.defForTest - p); left -= p; paid.push({ to: c, kind: 'deferred', amount: p }); }
      // interest the class was short on this same date is deferred today, so a paydown that includes its deferred interest pays it too
      if (x.deferrable && (inclDef || []).includes(c) && left > 0) { const short = (x.intDue || 0) - (x.intPaid || 0) - (x.sameDayDef || 0); if (short > 0.005) { const p = Math.min(left, short); x.sameDayDef = (x.sameDayDef || 0) + p; left -= p; paid.push({ to: c, kind: 'deferred', amount: p, today: true }); } }
      if (left > 0 && x.bal > 0) { const p = Math.min(left, x.bal); x.bal -= p; left -= p; paid.push({ to: c, kind: 'principal', amount: p }); }
    }
    return { used: X - left, paid };
  };
  const capacity = (n, seq, inclDef) => sum(seq, c => n[c] ? n[c].bal + (n[c].deferrable && (inclDef || []).includes(c) ? n[c].def : 0) : 0);
  const solveCure = (t, seq, avail, source, inclDef, testFn) => {
    const pcvAt = X => source === 'principal' && ctx.principalInPCV ? ctx.pcv - X : ctx.pcv;
    const passAt = X => { const n = cloneNotes(notes); applyPaydown(n, seq, X, inclDef); return testFn(n, pcvAt(X)); };
    if (passAt(0)) return 0;
    const hi0 = Math.min(avail, capacity(notes, seq, inclDef));
    if (hi0 <= 0) return 0;
    if (!passAt(hi0)) return hi0;
    let lo = 0, hi = Math.ceil(hi0 * 100);
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (passAt(m / 100)) hi = m; else lo = m; } // integer cents: smallest passing cent
    return Math.min(hi0, hi / 100);
  };

  // ---- ledger
  const preTests = snapshotTests(notes, ctx.pcv);
  const preNotes = cloneNotes(notes);
  const preIRT = cov.reinvestmentTest ? ocOf(cov.reinvestmentTest.ocClasses, notes, ctx.pcv) : null;
  const preEoD = cov.eodTest ? ocOf(cov.eodTest.ocClasses, notes, ctx.pcv) : null;

  // ---- calculation trail helpers (every number shown so it can be re-done by hand)
  const LN = {
    row: (label, expr, value, o) => Object.assign({ t: 'row', label, expr: expr || '', value }, o || {}),
    sub: (label, expr, value) => ({ t: 'row', label, expr: expr || '', value, sub: true }),
    total: (label, value, expr) => ({ t: 'total', label, expr: expr || '', value }),
    note: text => ({ t: 'note', text }),
    head: text => ({ t: 'head', text }),
    check: (label, expr, ok, applies) => ({ t: 'check', label, expr: expr || '', ok, applies: applies !== false }),
    table: (head, rows, align) => ({ t: 'table', head, rows, align })
  };
  const dS = ndays + ' / 360';
  const rateExpr = c => notes[c].fixed ? 'a fixed ' + fpct(notes[c].rate) : fpct(libor) + ' + ' + fpct(notes[c].spread) + ' spread';
  const lbl = k => (spec.labels && spec.labels[k]) || k;
  const pcvBridge = () => {
    const out = [LN.sub('Aggregate par of the tape', '', pb.parTotal)];
    if (pb.haircut.defaulted) out.push(LN.sub('Less: Defaulted Securities carried at lesser of market and recovery value', '', -pb.haircut.defaulted));
    if (pb.haircut.discount) out.push(LN.sub('Less: Discount Obligations carried at purchase price', '', -pb.haircut.discount));
    if (pb.haircut.ccc) out.push(LN.sub('Less: CCC Excess of ' + fmt2(pb.cccExcess) + ' carried at lesser of ' + spec.haircuts.ccc.haircutPct + '% and market value', '', -pb.haircut.ccc));
    out.push(LN.sub(ctx.principalInPCV ? 'Plus: Principal Proceeds on deposit' : 'Principal Proceeds on deposit (excluded by your setting)', '', ctx.principalInPCV ? principalCash : 0));
    out.push(LN.row('Principal Collateral Value on the Determination Date', '', ctx.pcvStart));
    ctx.pcvLog.forEach(x => out.push(LN.row(x.why, '', x.amt)));
    if (ctx.pcvLog.length) out.push(LN.row('Principal Collateral Value at this step', '', ctx.pcv));
    return out;
  };
  const ocLines = (t, n, pcv, title, compact) => {
    const o = ocOf(t.oc.classes, n, pcv);
    const out = [LN.head(title || (t.label + ' overcollateralization test'))];
    if (pcv === ctx.pcv && !compact) out.push(...pcvBridge()); else out.push(LN.row('Principal Collateral Value' + (compact && ctx.pcvLog.length ? ' after this payment' : ''), compact && ctx.pcvLog.length ? fmt2(ctx.pcvStart) + (ctx.pcvLog.map(x => (x.amt < 0 ? ' − ' : ' + ') + fmt2(Math.abs(x.amt))).join('')) : '', pcv));
    t.oc.classes.forEach(c => out.push(LN.sub('Class ' + c + ' principal outstanding' + (n[c].def > 0.5 && notes[c].deferrable ? ' (deferred interest excluded)' : ''), '', n[c].bal)));
    out.push(LN.row('Denominator', t.oc.classes.join(' + '), o.den));
    out.push(LN.row('OC ratio', fmt2(o.num) + ' ÷ ' + fmt2(o.den), fratio(o.ratio)));
    out.push(LN.check('Trigger ' + fpct(t.oc.trigger, 2), fratio(o.ratio) + (o.ratio >= t.oc.trigger - 1e-9 ? ' ≥ ' : ' < ') + fpct(t.oc.trigger, 2), o.ratio >= t.oc.trigger - 1e-9));
    return out;
  };
  const icLines = (t, n, title) => {
    if (!t.ic) return [];
    const i = icOf(t.ic.classes, n); const applies = period >= (t.ic.fromPeriod || 1);
    const out = [LN.head(title || (t.label + ' interest coverage test'))];
    out.push(LN.sub(inp.interestProceeds != null && inp.interestProceeds !== '' ? 'Interest Proceeds (entered)' : 'Interest Proceeds (tape estimate)', '', interestProceeds));
    icParts.forEach(x => out.push(LN.sub('Less: step ' + x.id + ', ' + x.label, '', -x.amount)));
    out.push(LN.row('Numerator', '', i.num));
    t.ic.classes.forEach(c => {
      const x = n[c]; const base = x.bal + x.defForTest; const intr = r2(base * x.rate / 100 * dcf);
      out.push(LN.sub('Class ' + c + ' interest', (x.defForTest > 0.5 ? '(' + fmt2(x.bal) + ' + ' + fmt2(x.defForTest) + ' deferred)' : fmt2(x.bal)) + ' × ' + fpct(x.rate) + ' × ' + dS, intr));
      if (x.deferrable && x.defForTest > 0.5) out.push(LN.sub('Class ' + c + ' deferred interest due', '', x.defForTest));
    });
    out.push(LN.row('Denominator', 'interest due on ' + t.ic.classes.join(', '), i.den));
    out.push(LN.row('IC ratio', fmt2(i.num) + ' ÷ ' + fmt2(i.den), fratio(i.ratio)));
    out.push(LN.check('Trigger ' + fpct(t.ic.trigger, 2), applies ? fratio(i.ratio) + (i.ratio >= t.ic.trigger - 1e-9 ? ' ≥ ' : ' < ') + fpct(t.ic.trigger, 2) : 'not applied until Payment Date ' + t.ic.fromPeriod, i.ratio >= t.ic.trigger - 1e-9, applies));
    return out;
  };
  const reqFor = (t, seq, src, inclDef, part) => {
    const fn = (n, pcv) => { const g = evalGroup(t, n, pcv); return part === 'oc' ? g.ocPass : part === 'ic' ? g.icPass : g.pass; };
    const cap = capacity(notes, seq, inclDef); const x = solveCure(t, seq, Infinity, src, inclDef, fn);
    const n = cloneNotes(notes); applyPaydown(n, seq, x, inclDef);
    return { x, cap, curable: fn(n, src === 'principal' && ctx.principalInPCV ? ctx.pcv - x : ctx.pcv) };
  };
  // explains the paydown needed to pass the OC and IC parts of test t
  const cureNeedLines = (t, seq, src, inclDef, before) => {
    const out = [LN.head('Paydown needed to pass')]; let need = 0;
    const fromPCV = src === 'principal' && ctx.principalInPCV;
    if (!before.ocPass) {
      const r = reqFor(t, seq, src, inclDef, 'oc'); const tr = t.oc.trigger / 100; const o = before.oc;
      const closed = fromPCV ? (tr * o.den - o.num) / (tr - 1) : o.den - o.num / tr;
      if (Math.abs(closed - r.x) < 1 && r.curable) {
        if (fromPCV) {
          out.push(LN.note('Paying from principal lowers the numerator and the denominator by the same amount X, so the test passes when (PCV − X) ÷ (Denominator − X) ≥ trigger, which gives X = (trigger × Denominator − PCV) ÷ (trigger − 1).'));
          out.push(LN.row('OC paydown, rounded up to the cent', '(' + fpct(t.oc.trigger, 2) + ' × ' + fmt2(o.den) + ' − ' + fmt2(o.num) + ') ÷ (' + fpct(t.oc.trigger, 2) + ' − 100%)', r.x));
        } else {
          out.push(LN.row('Denominator must fall to', fmt2(o.num) + ' ÷ ' + fpct(t.oc.trigger, 2), r2(o.num / tr)));
          out.push(LN.row('OC paydown, rounded up to the cent', fmt2(o.den) + ' − ' + fmt2(o.num) + ' ÷ ' + fpct(t.oc.trigger, 2), r.x));
        }
      } else out.push(LN.row('OC paydown', r.curable ? 'solved step by step along the payment sequence' : 'cannot pass even if ' + seq.join(', ') + ' are repaid in full', r.x));
      need = Math.max(need, r.x);
    }
    if (before.icApplies && !before.icPass && t.ic) {
      const r = reqFor(t, seq, src, inclDef, 'ic'); const first = seq.find(c => notes[c].bal > 0.5); const tr = t.ic.trigger / 100;
      const per = first ? notes[first].rate / 100 * dcf : 0; const i = before.ic;
      const closed = per ? (i.den - i.num / tr) / per : NaN;
      out.push(LN.row('IC denominator must fall to', fmt2(i.num) + ' ÷ ' + fpct(t.ic.trigger, 2), r2(i.num / tr)));
      if (first && Math.abs(closed - r.x) < 2 && r.curable) {
        out.push(LN.note('Each $1 of Class ' + first + ' repaid cuts the interest due by ' + fpct(notes[first].rate) + ' × ' + dS + '.'));
        const cu = Math.ceil(closed * 100 - 1e-6) / 100;
        out.push(LN.row('IC paydown by formula, rounded up to the cent', '(' + fmt2(i.den) + ' − ' + fmt2(i.num) + ' ÷ ' + fpct(t.ic.trigger, 2) + ') ÷ (' + fpct(notes[first].rate) + ' × ' + dS + ')', cu));
        if (Math.abs(cu - r.x) > 0.005) { out.push(LN.row('IC paydown, smallest amount that passes', 'checked cent by cent, with each class\'s interest rounded to the cent', r.x)); out.push(LN.note('The two differ by ' + fmt2(Math.abs(cu - r.x)) + ' because interest due is rounded to the cent while the formula is continuous.')); }
      } else out.push(LN.row('IC paydown', r.curable ? 'solved step by step: the paydown runs past Class ' + first + ' into classes with other coupons' : 'cannot pass even if ' + seq.join(', ') + ' are repaid in full', r.x));
      need = Math.max(need, r.x);
    }
    out.push(LN.total('Paydown required', need, before.ocPass || !(before.icApplies && !before.icPass) ? '' : 'larger of the OC and IC amounts'));
    return { lines: out, need };
  };
  const allocLines = (paid, snap) => {
    let left = sum(paid, x => x.amount); const out = [];
    paid.forEach(x => { const outst = x.kind === 'deferred' ? snap[x.to].def : snap[x.to].bal;
      out.push(LN.row('Class ' + x.to + (x.kind === 'deferred' ? ' deferred interest' : ' principal'), 'lesser of ' + fmt2(left) + ' left and ' + fmt2(outst) + ' outstanding', x.amount)); left -= x.amount; });
    return out;
  };
  const dueSource = k => {
    const o = origDues[k] || 0; const out = [];
    if (k === 'taxes') out.push(LN.row('Taxes and governmental fees', 'as entered', o));
    else if (k === 'hedge') out.push(LN.row('Hedge Payment Amount', 'as entered', o));
    else if (k === 'hedgeTermSenior') out.push(LN.row('Senior hedge termination payments', 'as entered', o));
    else if (k === 'hedgeTermSub') out.push(LN.row('Subordinated hedge termination payments', 'as entered', o));
    else if (k === 'revolverFunding') out.push(LN.row('Unfunded revolver and synthetic obligations', 'not modelled', 0));
    else if (k === 'admin') {
      if (adminRows.length) {
        out.push(LN.sub('Administrative Expenses entered', 'as entered', adminEntered));
        adminRows.forEach(m => out.push(LN.sub(m.name + ' (manual input ' + m.n + ')', 'as entered', m.amount)));
        out.push(LN.row('Administrative Expenses due', adminSeq.map(x => fmt2(x.amount)).join(' + '), adminDue));
        out.push(LN.note('Paid in the order listed (the Administrative Expense Payment Sequence): the cap is used up from the top of the list, and anything above it is paid later at the uncapped step.'));
      } else out.push(LN.row('Administrative Expenses due', 'as entered', adminDue));
      if (isFinite(adminCap)) {
        const C = F.adminCap; const pct = fmt2(pb.pcvGeneral) + ' × ' + fpct(C.bpsOfPCV / 100, 3);
        out.push(LN.sub(fpct(C.bpsOfPCV / 100, 3) + ' of Principal Collateral Value (par plus principal cash)', pct, r2(C.bpsOfPCV / 1e4 * pb.pcvGeneral)));
        out.push(LN.sub('Plus fixed amount', '', C.fixed));
        out.push(LN.sub('Cap across this and the ' + C.priorPeriods + ' prior Payment Dates', '', r2(C.bpsOfPCV / 1e4 * pb.pcvGeneral) + C.fixed));
        out.push(LN.sub('Less: paid under this step on the prior ' + C.priorPeriods + ' dates', 'as entered', -(+inp.adminPaidPrior || 0)));
        out.push(LN.row('Cap available on this date', '', adminCap));
        out.push(LN.row('Due under the cap', 'lesser of ' + fmt2(adminDue) + ' and ' + fmt2(adminCap), o));
        if (adminDue > adminCap + 0.5) out.push(LN.note(fmt2(adminDue - adminCap) + ' above the cap is paid later, at the uncapped expenses step.'));
        out.push(LN.note('The indenture measures Principal Collateral Value at the start of the Due Period; this uses today\'s par plus principal cash.'));
      }
    } else if (k === 'adminExcess') out.push(LN.row('Administrative Expenses above the cap', fmt2(adminDue) + ' − ' + fmt2(origDues.admin), o));
    else if ((k === 'seniorMgmt' || k === 'structuring') && !F[k]) out.push(LN.note('The deal spec has no terms for this fee (fees.' + k + '), so nothing is due.'));
    else if (k === 'seniorMgmt' || k === 'structuring') {
      const f = F[k]; const bps = bpsOn(f.schedule, pd);
      out.push(...feeBasisLines());
      out.push(LN.row(f.label, fmt2(feeBasis) + ' × ' + fpct(bps / 100, 3) + ' × ' + dS, r2(feeBasis * bps / 1e4 * dcf)));
      const sch = f.schedule.map(s => s.bps + ' bps' + (s.through ? ' through ' + s.through : ' after')).join(', ');
      out.push(LN.note('Rate on this date: ' + bps + ' bps a year (schedule: ' + sch + ').'));
      if (k === 'seniorMgmt' && +inp.unpaidSeniorFees) out.push(LN.row('Plus: senior fees unpaid from prior dates', 'as entered', +inp.unpaidSeniorFees));
    }
    const paidEarlier = o - (k === 'admin' ? dues.admin : (dues[k] || 0));
    if (paidEarlier > 0.005) { out.push(LN.row('Less: already paid at an earlier step', '', -paidEarlier)); out.push(LN.total('Still due', o - paidEarlier)); }
    else if (out.length > 1) out.push(LN.total('Due', o));
    return out;
  };
  const feeBasisLines = () => {
    if (inp.feeBasis != null && inp.feeBasis !== '') return [LN.sub('Fee Basis Amount', 'as entered', feeBasis)];
    return [LN.sub('Aggregate par of the Collateral Debt Securities', '', pb.parTotal), LN.sub('Plus: Principal Proceeds held in Eligible Investments', '', principalCash), LN.sub('Fee Basis Amount', '', feeBasis)];
  };
  const interestLine = (c, alreadyPaid) => {
    const x = notes[c]; const out = [];
    out.push(LN.row('Class ' + c + ' interest at ' + rateExpr(c) + ' = ' + fpct(x.rate), (x.def0 > 0.5 ? '(' + fmt2(x.bal0) + ' + ' + fmt2(x.def0) + ' deferred b/f)' : fmt2(x.bal0)) + ' × ' + fpct(x.rate) + ' × ' + dS, x.intDue));
    if (alreadyPaid > 0.005) out.push(LN.row('Less: Class ' + c + ' interest already paid', '', -alreadyPaid));
    return out;
  };
  const proRataLines = (parts, paid, due) => {
    const out = [];
    if (due - paid > 0.005 && parts.length > 1) {
      out.push(LN.note('Cash covers ' + fpct(paid / due * 100, 4) + ' of the amount due, so it is shared pro rata.'));
      let left = paid; parts.forEach((x, i) => { const a = i === parts.length - 1 ? r2(left) : Math.min(left, r2(x.d * paid / due)); left -= a; out.push(LN.row(x.label, fmt2(x.d) + ' × ' + fmt2(paid) + ' ÷ ' + fmt2(due) + (i === parts.length - 1 && parts.length > 1 ? ' (remainder, to the cent)' : ''), a)); });
    } else if (parts.length > 1) parts.forEach(x => out.push(LN.row(x.label, 'paid in full', x.d)));
    return out;
  };
  const hurdleLines = (paidToday) => {
    const inc = F.incentive; const H = hurdleDetail(spec, inp.subHistory || [], pd, paidToday);
    const r = H.r, basis = H.basis, c0 = H.c0, tn = H.tn, unrec = H.unrec, grow = H.grow, pvSum = H.pvSum;
    const rows = [[c0, '0', fmt2(-spec.equity.balance), '1.000000000', fmt2(-spec.equity.balance)]].concat(H.rows.map(x => [x.date, String(x.n), fmt2(x.amount), x.f.toFixed(9), fmt2(x.pv)]));
    return { lines: [
      LN.note('The hurdle is met when the distributions, discounted to the Closing Date at ' + inc.hurdleIRR + '% a year (Actual/' + basis + '), repay the ' + fmt2(spec.equity.balance) + ' issue price.'),
      LN.table(['Date', 'Days from closing', 'Cash flow', 'Discount factor 1 ÷ ' + (1 + r).toFixed(2) + '^(days/' + basis + ')', 'Value at closing'], rows, ['l', 'r', 'r', 'r', 'r']),
      LN.row('Issue price', '', spec.equity.balance),
      LN.row('Less: value at closing of distributions so far', 'sum of the last column, excluding the issue price', -pvSum),
      LN.row('Still unrecovered, at closing value', '', unrec),
      LN.sub('Growth factor to this Payment Date', (1 + r).toFixed(2) + '^(' + tn + ' / ' + basis + ')', grow.toFixed(9)),
      LN.row('Grown to this Payment Date', fmt2(unrec) + ' × ' + grow.toFixed(9), H.need),
      LN.total('Needed today to reach ' + inc.hurdleIRR + '%', Math.max(0, H.need))
    ], need: Math.max(0, H.need) };
  };
  const skipLines = (when) => {
    if (when === 'duringRP') return [LN.note('Applies only during the Reinvestment Period, which ended on ' + spec.meta.reinvestmentPeriodEnd + '. This Payment Date is ' + pd + '.')];
    if (when === 'afterRP') return [LN.note('Applies only after the Reinvestment Period ends on ' + spec.meta.reinvestmentPeriodEnd + '. This Payment Date is ' + pd + '.')];
    if (when === 'noRatedOutstanding') return [LN.note('Principal reaches the Subordinated Notes only once every rated class is repaid or at Stated Maturity. Rated notes outstanding: ' + order.filter(c => notes[c].bal > 0.5).map(c => 'Class ' + c + ' ' + fmt2(notes[c].bal)).join(', ') + '.')];
    if (when === 'rcf') return [LN.note('Applies only while a Rating Confirmation Failure continues. Tick it under Events to apply it.')];
    if (when === 'specialRedemption') return [LN.note('Applies only when the manager gives notice of a Special Redemption. Enter an amount under Events to apply it.')];
    if (when === 'redemption') return [LN.note('Applies only on a Redemption Date (an optional redemption of the notes). Tick it under Events to apply it.')];
    return [LN.note('Not triggered on this date.')];
  };

  const ownDue = st => {
    if (st.type === 'expense' || st.type === 'fees') return sum(st.type === 'fees' ? st.items : (st.items || [st.item]), k => k === 'admin' ? dues.admin : (dues[k] || 0));
    if (st.type === 'interest') return sum(st.classes, c => Math.max(0, notes[c].intDue - notes[c].intPaid)) + (st.withSeniorTermination ? dues.hedgeTermSenior : 0);
    if (st.type === 'interestAndPrincipal') { const x = notes[st.class]; return Math.max(0, x.intDue - x.intPaid) + x.def + x.bal; }
    if (st.type === 'none') return 0;
    return null;
  };
  // split a payment of Administrative Expenses across the entered amount and the manual rows, in sequence
  const splitSeq = (offset, amount, suffix) => {
    const out = []; let start = 0;
    for (const x of adminSeq) {
      const a = Math.max(start, offset), b = Math.min(start + x.amount, offset + amount);
      if (b - a > 0.004) { const v = r2(b - a); out.push({ to: x.name + (suffix || ''), amount: v, manual: !!x.m }); if (x.m) x.m.paid = r2(x.m.paid + v); }
      start += x.amount;
    }
    const got = r2(sum(out, x => x.amount)); if (out.length && Math.abs(got - amount) >= 0.005) out[out.length - 1].amount = r2(out[out.length - 1].amount + amount - got);
    return out;
  };
  const waterfalls = {};
  function runList(kind, steps, pool) {
    const ledger = [];
    const take = (amt) => { const p = Math.min(Math.max(0, amt), pool.avail()); pool.spend(p); return p; };
    for (const st of steps) {
      const row = { id: st.id, label: st.label, clause: st.clause, section: st.section, ref: st.ref, type: st.type, due: 0, paid: 0, before: pool.avail(), payees: [], note: '', calc: { due: [], paid: [] } };
      const CD = row.calc.due, CP = row.calc.paid;
      const mRows = manualAt[kind + '|' + st.id] || [];
      const when = st.when || 'always';
      const noRated = order.every(c => notes[c].bal < 0.5 && notes[c].def < 0.5);
      const ok = when === 'always' || (when === 'duringRP' && inRP) || (when === 'afterRP' && !inRP) || (when === 'noRatedOutstanding' && (noRated || mode === 'liquidation'))
        || (when === 'rcf' && inp.rcf) || (when === 'specialRedemption' && (+inp.specialRedemption > 0)) || (when === 'redemption' && (inp.redemption || mode === 'liquidation'));
      if (!ok) { CP.push(LN.row('Cash available before this step', '', row.before)); row.skipped = when === 'duringRP' ? 'Reinvestment Period has ended' : when === 'afterRP' ? 'Still in the Reinvestment Period' : when === 'noRatedOutstanding' ? 'Rated notes still outstanding' : when === 'redemption' ? 'Not a Redemption Date' : when === 'rcf' ? 'No Rating Confirmation Failure' : 'Not triggered'; row.after = pool.avail(); CD.push(...skipLines(when)); CP.push(LN.note('Nothing is paid; ' + fmt2(row.before) + ' passes to the next step.'));
        if (mRows.length) { CD.push(LN.note('Manual inputs tagged here are not paid because the step does not apply on this date: ' + mRows.map(m => m.name + ' ' + fmt2(m.amount)).join(', ') + '.')); row.manual = mRows.map(m => ({ n: m.n, name: m.name, due: m.amount, paid: 0, rank: m.rank })); mRows.forEach(m => { m.status = 'Not paid: step ' + st.id + ' does not apply on this date'; manualNotes.push('Manual input ' + m.n + ', ' + m.name + ', is not paid: ' + kind + ' step ' + st.id + ' does not apply on this date.'); }); }
        ledger.push(row); continue; }
      let simplePaid = true; // generic "lesser of due and cash" explanation
      const kindName = { interest: 'Interest', principal: 'Principal', liquidation: 'Liquidation' }[kind] || kind;
      const mLines = [];
      const payManual = (m, amt, expr) => { const b = pool.avail(); const p = take(amt); m.paid = r2(m.paid + p); row.payees.push({ to: m.name, amount: p, manual: true }); mLines.push(LN.row(m.name + ' (manual input ' + m.n + ')', expr || 'lesser of ' + fmt2(amt) + ' and ' + fmt2(b) + ' cash', p)); return p; };
      const mPro0 = mRows.filter(m => m.rank === 'prorata'); const proOwn = mPro0.length ? ownDue(st) : null;
      const mBefore = mRows.filter(m => m.rank === 'before'), mPro = proOwn == null ? [] : mPro0, mAfter = mRows.filter(m => m.rank === 'after' || (m.rank === 'prorata' && proOwn == null));
      if (mPro0.length && proOwn == null) mLines.push(LN.note('This kind of step has no fixed amount to share with, so the rows marked pro rata are paid after it.'));
      mBefore.forEach(m => payManual(m, m.amount));
      if (mPro.length) {
        const Dm = sum(mPro, m => m.amount); const a = pool.avail();
        const share = proOwn + Dm <= a + 0.005 ? Dm : Math.min(Dm, r2(a * Dm / (proOwn + Dm)));
        if (share < Dm - 0.005) mLines.push(LN.note('Cash of ' + fmt2(a) + ' does not cover the clause\'s ' + fmt2(proOwn) + ' and the manual ' + fmt2(Dm) + ' together, so they share it pro rata.'), LN.row('Manual inputs\' share', fmt2(a) + ' × ' + fmt2(Dm) + ' ÷ ' + fmt2(proOwn + Dm), share));
        let left = share; mPro.forEach((m, i) => { const last = i === mPro.length - 1; const x = last ? r2(left) : Math.min(left, r2(m.amount * share / Dm)); left = r2(left - x); payManual(m, x, share >= Dm - 0.005 ? 'paid in full, pro rata with the clause' : last && mPro.length > 1 ? 'remainder of the share, to the cent' : fmt2(m.amount) + ' × ' + fmt2(share) + ' ÷ ' + fmt2(Dm)); });
      }
      const before0 = row.before; row.before = pool.avail(); const ownStart = row.before;
      try {
      switch (st.type) {
        case 'expense': case 'fees': {
          const items = st.type === 'fees' ? st.items : (st.items || [st.item]);
          const itemDues = items.map(k => ({ k, d: k === 'admin' ? dues.admin : (dues[k] || 0) }));
          itemDues.forEach(x => { if (items.length > 1) CD.push(LN.head(lbl(x.k))); CD.push(...dueSource(x.k)); });
          row.due = sum(itemDues, x => x.d);
          if (items.length > 1) CD.push(LN.total('Due under this step', row.due, itemDues.map(x => fmt2(x.d)).join(' + ')));
          if (st.type === 'fees' || st.proRata) {
            const p = take(row.due); const f = row.due ? p / row.due : 0;
            let left = p; itemDues.forEach((x, i) => { const a = i === itemDues.length - 1 ? r2(left) : Math.min(left, r2(x.d * f)); left -= a; row.payees.push({ to: lbl(x.k), amount: a }); dues[x.k] = r2((dues[x.k] || 0) - a); });
            row.paid = p;
            CP.push(LN.row('Paid', 'lesser of ' + fmt2(row.due) + ' due and ' + fmt2(row.before) + ' cash', p));
            CP.push(...proRataLines(itemDues.map(x => ({ label: lbl(x.k), d: x.d })), p, row.due)); simplePaid = false;
          } else if (itemDues.length > 1) {
            simplePaid = false; CP.push(LN.note('Items are paid in order, each from the cash left after the one before.'));
            for (const x of itemDues) { const b = pool.avail(); const p = take(x.d); row.paid += p; row.payees.push({ to: lbl(x.k), amount: p }); dues[x.k] = x.d - p; CP.push(LN.row(lbl(x.k), 'lesser of ' + fmt2(x.d) + ' due and ' + fmt2(b) + ' cash', p)); }
            CP.push(LN.total('Paid', row.paid));
          } else {
            for (const x of itemDues) { const p = take(x.d); row.paid += p; row.payees.push({ to: lbl(x.k), amount: p }); dues[x.k] = x.d - p; }
          }
          if (kind === 'interest') ctx.unpaid[st.id] = { items: itemDues.map(x => x.k) };
          if (st.item === 'admin' && isFinite(adminCap)) row.note = 'Cap available this date ' + money(adminCap) + (adminDue > adminCap ? '; ' + money(adminDue - adminCap) + ' falls to the uncapped step' : '');
          break;
        }
        case 'interest': {
          const cls = st.classes;
          const cur = cls.map(c => ({ c, d: Math.max(0, notes[c].intDue - notes[c].intPaid), pre: notes[c].intPaid }));
          cur.forEach(x => CD.push(...interestLine(x.c, x.pre)));
          const extra = st.withSeniorTermination ? dues.hedgeTermSenior : 0;
          if (st.withSeniorTermination) CD.push(LN.row('Senior hedge and synthetic termination payments', 'as entered, pari passu with Class ' + cls.join(', ') + ' interest', extra));
          const tot = sum(cur, x => x.d) + extra; row.due = tot;
          const p = take(tot); const f = tot ? p / tot : 0;
          let leftI = p; const nParts = cur.length + (extra ? 1 : 0);
          cur.forEach((x, i) => { const a = i === nParts - 1 ? r2(leftI) : Math.min(leftI, r2(x.d * f)); leftI -= a; notes[x.c].intPaid += a; row.payees.push({ to: 'Class ' + x.c + ' interest', amount: a }); });
          if (extra) { const a = r2(leftI); dues.hedgeTermSenior -= a; row.payees.push({ to: 'Senior hedge termination', amount: a }); }
          row.paid = p;
          const parts = cur.map(x => ({ label: 'Class ' + x.c + ' interest', d: x.d })).concat(extra ? [{ label: 'Senior hedge termination', d: extra }] : []);
          CP.push(LN.row(st.includeDeferred ? 'Current interest paid' : 'Paid', 'lesser of ' + fmt2(tot) + ' due and ' + fmt2(row.before) + ' cash', p));
          CP.push(...proRataLines(parts, p, tot)); simplePaid = false;
          if (st.includeDeferred) {
            for (const c of cls) {
              const x = notes[c]; const d = Math.max(0, x.def - x.defPaid);
              CD.push(LN.row('Class ' + c + ' deferred interest brought forward', d > 0.5 ? 'as entered under Notes outstanding' : 'none outstanding', d));
              if (d > 0) { row.due += d; const b = pool.avail(); const q = take(d); x.defPaid += q; x.def -= q; row.paid += q; row.payees.push({ to: 'Class ' + c + ' deferred interest', amount: q }); CP.push(LN.row('Class ' + c + ' deferred interest paid', 'lesser of ' + fmt2(d) + ' and ' + fmt2(b) + ' cash left', q)); }
            }
          }
          if (cur.length + (st.withSeniorTermination ? 1 : 0) + (st.includeDeferred ? cls.length : 0) > 1) CD.push(LN.total('Due under this step', row.due));
          if (st.includeDeferred) CP.push(LN.total('Paid', row.paid));
          if (kind === 'interest') ctx.unpaid[st.id] = { classes: cls };
          const short = row.due - row.paid;
          if (short > 0.5) {
            row.note = cls.every(c => notes[c].deferrable) ? money(short) + ' unpaid: deferred and capitalised' : money(short) + ' unpaid on a non-deferrable class';
            CP.push(LN.note(cls.every(c => notes[c].deferrable) ? 'The ' + fmt2(short) + ' unpaid is deferred: it is added to the class\'s deferred interest and bears interest at the class rate. It is not an Event of Default while a more senior class is outstanding.' : 'The ' + fmt2(short) + ' unpaid is on a class whose interest cannot defer, so it is flagged as a potential Event of Default.'));
          }
          break;
        }
        case 'cure': {
          const t = testById(st.test);
          const fn = (n, pcv) => evalGroup(t, n, pcv).pass;
          const before = evalGroup(t, notes, ctx.pcv);
          row.test = { label: t.label, before };
          CD.push(...ocLines(t, notes, ctx.pcv), ...icLines(t, notes));
          simplePaid = false;
          if (before.pass) {
            row.note = t.label + ' coverage tests pass: no diversion';
            CD.push(LN.total('Due under this step', 0, (t.ic && before.icApplies ? 'both tests pass' : 'the test passes') + ', so nothing is diverted'));
            CP.push(LN.row('Cash available before this step', '', row.before), LN.note('Nothing is diverted; all ' + fmt2(row.before) + ' passes to the next step.'));
            row.after = pool.avail(); ledger.push(row); continue;
          }
          const src = kind === 'interest' ? 'interest' : 'principal';
          const nd = cureNeedLines(t, st.paydown, src, st.includeDeferredOf, before); CD.push(...nd.lines);
          const cap = capacity(notes, st.paydown, st.includeDeferredOf);
          CD.push(LN.row('Cash available before this step', '', row.before));
          CD.push(LN.row('Most ' + st.paydown.join(', ') + ' can absorb', 'principal' + ((st.includeDeferredOf || []).length ? ' plus deferred interest of ' + st.includeDeferredOf.join(', ') : '') + ' outstanding', cap));
          const X = solveCure(t, st.paydown, pool.avail(), src, st.includeDeferredOf, fn);
          CD.push(LN.total('Due under this step', X, 'lesser of ' + fmt2(nd.need) + ', ' + fmt2(row.before) + ' and ' + fmt2(cap)));
          row.due = X; const snap = cloneNotes(notes); const p = take(X);
          const r = applyPaydown(notes, st.paydown, p, st.includeDeferredOf);
          r.paid.forEach(x => { if (x.kind === 'principal') notes[x.to].prinPaid += x.amount; else notes[x.to].defPaidCure += x.amount; row.payees.push({ to: 'Class ' + x.to + (x.kind === 'deferred' ? ' deferred interest' : ' principal'), amount: x.amount }); });
          CP.push(LN.row('Paid', 'the full amount due, from ' + (src === 'interest' ? 'Interest' : 'Principal') + ' Proceeds', p));
          CP.push(LN.head('Applied in payment order: ' + st.paydown.join(', ')), ...allocLines(r.paid, snap));
          if (kind !== 'interest' && ctx.principalInPCV) { ctx.pcv -= p; ctx.pcvLog.push({ why: 'Less: principal paid out at ' + kind + ' step ' + st.id, amt: -p }); }
          row.paid = p; row.test.after = evalGroup(t, notes, ctx.pcv);
          CP.push(...ocLines(t, notes, ctx.pcv, t.label + ' OC after this payment', true));
          if (t.ic && before.icApplies) CP.push(...icLines(t, notes, t.label + ' IC after this payment'));
          const failedParts = [!before.ocPass && 'OC', !before.icPass && 'IC'].filter(Boolean).join(' and ');
          row.note = t.label + ' ' + failedParts + ' failing' + (row.test.after.pass ? ': cured with ' + money(p) : ': still failing after ' + money(p));
          break;
        }
        case 'cureAll': {
          let total = 0; row.tests = []; simplePaid = false;
          CD.push(LN.note('Each coverage test is checked again after the interest waterfall, most senior first. Principal paid out reduces the numerator as well as the denominator.'));
          for (const tid of st.tests) {
            const t = testById(tid); const fn = (n, pcv) => evalGroup(t, n, pcv).pass;
            const before = evalGroup(t, notes, ctx.pcv);
            if (before.pass) { row.tests.push({ label: t.label, before, after: before, paid: 0 }); CD.push(LN.check(t.label + ' tests', 'OC ' + fratio(before.oc.ratio) + (t.ic && before.icApplies ? ', IC ' + fratio(before.ic.ratio) : '') + ': pass, nothing needed', true)); continue; }
            CD.push(...ocLines(t, notes, ctx.pcv), ...icLines(t, notes));
            const nd = cureNeedLines(t, st.paydown, 'principal', st.includeDeferredOf, before); CD.push(...nd.lines);
            const b = pool.avail();
            const X = solveCure(t, st.paydown, pool.avail(), 'principal', st.includeDeferredOf, fn);
            CD.push(LN.row('Applied for ' + t.label, 'lesser of ' + fmt2(nd.need) + ' and ' + fmt2(b) + ' cash left', X));
            const snap = cloneNotes(notes); const p = take(X); total += p;
            const r = applyPaydown(notes, st.paydown, p, st.includeDeferredOf);
            r.paid.forEach(x => { if (x.kind === 'principal') notes[x.to].prinPaid += x.amount; else notes[x.to].defPaidCure += x.amount; row.payees.push({ to: 'Class ' + x.to + (x.kind === 'deferred' ? ' deferred interest' : ' principal'), amount: x.amount }); });
            if (ctx.principalInPCV) { ctx.pcv -= p; ctx.pcvLog.push({ why: 'Less: principal paid out at principal step ' + st.id, amt: -p }); }
            CP.push(LN.head('For the ' + t.label + ' tests, in order ' + st.paydown.join(', ')), ...allocLines(r.paid, snap));
            const after = evalGroup(t, notes, ctx.pcv);
            CP.push(LN.check(t.label + ' after', 'OC ' + fratio(after.oc.ratio) + (t.ic && after.icApplies ? ', IC ' + fratio(after.ic.ratio) : ''), after.pass));
            row.tests.push({ label: t.label, before, after, paid: p });
          }
          row.due = total; row.paid = total;
          CD.push(LN.total('Due under this step', total));
          CP.push(LN.total('Paid', total));
          const failing = row.tests.filter(x => !x.before.pass);
          row.note = failing.length ? failing.map(x => x.label + (x.after.pass ? ' cured' : ' still failing')).join('; ') : 'All coverage tests pass after the interest waterfall';
          break;
        }
        case 'rcf': case 'specialRedemption': {
          const amt = st.type === 'rcf' ? (+inp.rcfAmount || 0) : (+inp.specialRedemption || 0);
          CD.push(LN.row(st.type === 'rcf' ? 'Paydown needed to reinstate ratings' : 'Special Redemption Amount', 'as entered', amt));
          row.due = amt; const snap = cloneNotes(notes); const p = take(amt); const r = applyPaydown(notes, st.paydown, p, st.includeDeferredOf);
          r.paid.forEach(x => { if (x.kind === 'principal') notes[x.to].prinPaid += x.amount; else notes[x.to].defPaidCure += x.amount; row.payees.push({ to: 'Class ' + x.to + ' ' + x.kind, amount: x.amount }); });
          if (kind !== 'interest' && ctx.principalInPCV) { ctx.pcv -= p; ctx.pcvLog.push({ why: 'Less: principal paid out at ' + kind + ' step ' + st.id, amt: -p }); }
          row.paid = p; CP.push(LN.row('Paid', 'lesser of ' + fmt2(amt) + ' and ' + fmt2(row.before) + ' cash', p), LN.head('Applied in order ' + st.paydown.join(', ')), ...allocLines(r.paid, snap)); simplePaid = false; break;
        }
        case 'subMgmtFee': {
          if (!F.subMgmt) { warnings.push(kindName + ' step ' + st.id + ' pays the Subordinated Management Fee, but the deal spec has no fees.subMgmt, so nothing is due there'); row.note = 'No Subordinated Management Fee in the deal spec'; CD.push(LN.note('The deal spec has no Subordinated Management Fee (fees.subMgmt), so nothing is due here.'), LN.total('Due under this step', 0)); break; }
          const curDue = dues.subMgmtCurrent, prior = dues.subMgmtPrior; const f = F.subMgmt;
          const origCur = r2(feeBasis * f.bps / 1e4 * dcf); const origPrior = +inp.unpaidSubFee || 0; const priorGrown = r2(origPrior * (1 + eRate / 100 * dcf));
          const feeLines = () => {
            const o = [...feeBasisLines(), LN.row(f.label, fmt2(feeBasis) + ' × ' + fpct(f.bps / 100, 3) + ' × ' + dS, origCur)];
            if (origPrior) o.push(LN.row('Unpaid from prior dates, with interest at the Class ' + f.unpaidAccruesAtClass + ' rate', fmt2(origPrior) + ' × (1 + ' + fpct(eRate) + ' × ' + dS + ')', priorGrown));
            if (kind !== 'interest' && origCur + priorGrown - (curDue + prior) > 0.005) o.push(LN.row('Less: paid or deferred by election at the interest step', '', -r2(origCur + priorGrown - curDue - prior)));
            return o;
          };
          CD.push(...feeLines());
          if (st.includeCumulativeDeferred) {
            CD.push(LN.row('Cumulative Deferred Management Fee', 'as entered', ctx.cumDeferredFee));
            row.due = curDue + prior + ctx.cumDeferredFee; CD.push(LN.total('Due under this step', row.due));
            const p = take(row.due); row.paid = p; row.payees.push({ to: 'Collateral Manager', amount: p });
            const covered = Math.min(p, curDue + prior); dues.subMgmtPrior = Math.max(0, prior - covered); dues.subMgmtCurrent = Math.max(0, curDue - Math.max(0, covered - prior));
            ctx.recouped += Math.min(ctx.cumDeferredFee, Math.max(0, p - curDue - prior)); break;
          }
          const elect = kind === 'interest' ? Math.min(+inp.subFeeDeferElect || 0, curDue) : 0;
          if (elect) CD.push(LN.row('Less: current fee the manager elects to defer', 'as entered, up to the current fee', -elect));
          const toPay = curDue - elect + prior;
          row.due = toPay; const p = take(toPay); row.paid = p; row.payees.push({ to: 'Collateral Manager (sub. fee)', amount: p });
          let rem = toPay - p;
          dues.subMgmtPrior = Math.max(0, prior - p); dues.subMgmtCurrent = Math.max(0, rem - dues.subMgmtPrior);
          simplePaid = false; CP.push(LN.row('Fee paid to the manager', 'lesser of ' + fmt2(toPay) + ' and ' + fmt2(row.before) + ' cash', p));
          if (rem > 0.5) CP.push(LN.note(fmt2(rem) + ' is unpaid and carried forward; it can be paid at the principal step and accrues interest at the Class ' + f.unpaidAccruesAtClass + ' rate.'));
          if (elect > 0) {
            ctx.currentDeferred += elect;
            if (inp.subFeeDeferTo === 'principal') { const mv = take(elect); ctx.buckets.reinvestOnly += mv; if (ctx.principalInPCV) { ctx.pcv += mv; ctx.pcvLog.push({ why: 'Plus: deferred fee moved to principal at step ' + st.id, amt: mv }); } row.payees.push({ to: 'Current deferred fee → Principal Proceeds', amount: mv }); row.paid += mv; row.due += elect; CD.push(LN.row('Plus: deferred fee moved to Principal Proceeds', 'manager\'s election', elect)); CP.push(LN.row('Moved to Principal Proceeds for reinvestment', '', mv)); }
            else { row.note = money(elect) + ' deferred by the manager stays in Interest Proceeds'; CP.push(LN.note(fmt2(elect) + ' deferred by the manager stays in Interest Proceeds for the steps below.')); }
          }
          const rc = Math.min(+inp.recoupCumDeferred || 0, ctx.cumDeferredFee);
          if (rc > 0) { CD.push(LN.row('Plus: cumulative deferred fee the manager elects to take', 'lesser of ' + fmt2(+inp.recoupCumDeferred) + ' requested and ' + fmt2(ctx.cumDeferredFee) + ' deferred', rc)); row.due += rc; const b = pool.avail(); const q = take(rc); row.paid += q; ctx.recouped += q; row.payees.push({ to: 'Cumulative deferred fee repaid', amount: q }); CP.push(LN.row('Cumulative deferred fee repaid', 'lesser of ' + fmt2(rc) + ' and ' + fmt2(b) + ' cash', q)); }
          CD.push(LN.total('Due under this step', row.due));
          if (row.payees.length > 1) CP.push(LN.total('Paid', row.paid));
          break;
        }
        case 'reinvestmentDiversion': {
          if (!cov.reinvestmentTest) { warnings.push(kindName + ' step ' + st.id + ' diverts interest under the Interest Reinvestment Test, but the deal spec has no coverage.reinvestmentTest, so nothing is diverted'); row.note = 'No Interest Reinvestment Test in the deal spec'; CD.push(LN.note('The deal spec has no Interest Reinvestment Test (coverage.reinvestmentTest), so no interest is diverted here.'), LN.total('Due under this step', 0)); break; }
          const rt = cov.reinvestmentTest; const o = ocOf(rt.ocClasses, notes, ctx.pcv);
          row.test = { label: rt.label, ratio: o.ratio, trigger: rt.trigger };
          CD.push(...ocLines({ label: rt.label, oc: { classes: rt.ocClasses, trigger: rt.trigger } }, notes, ctx.pcv, rt.label));
          if (o.ratio >= rt.trigger - 1e-9) { row.note = rt.label + ' passes (' + o.ratio.toFixed(2) + '%)'; CD.push(LN.total('Due under this step', 0, 'the test passes')); break; }
          const need = Math.ceil((rt.trigger / 100 * o.den - ctx.pcv) * 100 - 1e-6) / 100; const cap = Math.floor(rt.maxDiversionPct / 100 * pool.avail() * 100 + 1e-6) / 100;
          CD.push(LN.head('Diversion'));
          CD.push(LN.note('Diverted cash buys collateral, so it adds to the numerator: the test passes when (PCV + X) ÷ Denominator ≥ trigger, so X = trigger × Denominator − PCV.'));
          CD.push(LN.row('Needed to pass, rounded up to the cent', fpct(rt.trigger, 2) + ' × ' + fmt2(o.den) + ' − ' + fmt2(ctx.pcv), need));
          CD.push(LN.row(rt.maxDiversionPct + '% of interest remaining, rounded down to the cent', fmt2(pool.avail()) + ' × ' + rt.maxDiversionPct + '%', cap));
          row.due = Math.min(need, cap); CD.push(LN.total('Due under this step', row.due, 'lesser of the two'));
          const p = take(row.due); row.paid = p;
          ctx.buckets.reinvestOnly += p; ctx.pcv += p; ctx.pcvLog.push({ why: 'Plus: interest diverted to buy collateral at step ' + st.id, amt: p }); ctx.irtDiverted = p;
          row.payees.push({ to: 'Principal Collection Account (buy collateral)', amount: p });
          row.test.after = ocOf(rt.ocClasses, notes, ctx.pcv).ratio;
          simplePaid = false; CP.push(LN.row('Moved to the Principal Collection Account', 'the full amount due', p));
          CP.push(LN.row(rt.label + ' after', fmt2(ctx.pcv) + ' ÷ ' + fmt2(o.den), fratio(row.test.after)));
          CP.push(LN.note('This cash can only be reinvested in collateral; it never pays down notes or reaches the Subordinated Notes.'));
          row.note = rt.label + ' at ' + o.ratio.toFixed(2) + '% vs ' + rt.trigger.toFixed(2) + '%: diverted the lesser of ' + rt.maxDiversionPct + '% of remaining interest and the cure amount';
          break;
        }
        case 'unpaidFrom': {
          simplePaid = false;
          for (const sid of st.steps) {
            const u = ctx.unpaid[sid]; if (!u) continue;
            if (u.items) for (const k of u.items) { const d = k === 'admin' ? dues.admin : (dues[k] || 0); if (d > 0.005) { CD.push(LN.row('Left unpaid at interest step ' + sid + ': ' + lbl(k), '', d)); row.due += d; const b = pool.avail(); const p = take(d); row.paid += p; dues[k] -= p; row.payees.push({ to: lbl(k), amount: p }); CP.push(LN.row(lbl(k), 'lesser of ' + fmt2(d) + ' and ' + fmt2(b) + ' cash', p)); } }
            if (u.classes) for (const c of u.classes) { const x = notes[c]; const d = Math.max(0, x.intDue - x.intPaid); if (d > 0.005) { CD.push(LN.row('Left unpaid at interest step ' + sid + ': Class ' + c + ' interest', fmt2(x.intDue) + ' − ' + fmt2(x.intPaid) + ' paid', d)); row.due += d; const b = pool.avail(); const p = take(d); x.intPaid += p; row.paid += p; row.payees.push({ to: 'Class ' + c + ' interest', amount: p }); CP.push(LN.row('Class ' + c + ' interest', 'lesser of ' + fmt2(d) + ' and ' + fmt2(b) + ' cash', p)); } }
          }
          for (const sid of st.steps) for (const m of (ctx.unpaidManual[sid] || [])) {
            const d = r2(m.amount - m.paid); if (d <= 0.005) continue;
            CD.push(LN.row('Left unpaid at interest step ' + sid + ': ' + m.name + ' (manual input ' + m.n + ')', fmt2(m.amount) + ' − ' + fmt2(m.paid) + ' paid', d)); row.due += d;
            const b = pool.avail(); const p = take(d); m.paid = r2(m.paid + p); row.paid += p; row.payees.push({ to: m.name, amount: p, manual: true, carried: true }); CP.push(LN.row(m.name, 'lesser of ' + fmt2(d) + ' and ' + fmt2(b) + ' cash', p));
          }
          if (!row.due) { row.note = 'Nothing was left unpaid in the interest waterfall'; CD.push(LN.note('Interest steps ' + st.steps.join(', ') + ' were all paid in full from Interest Proceeds.')); }
          CD.push(LN.total('Due under this step', row.due)); if (row.paid) CP.push(LN.total('Paid', row.paid));
          break;
        }
        case 'reinvest': {
          const a = pool.avail(); row.due = a; const p = take(a); row.paid = p; ctx.reinvested += p; row.payees.push({ to: 'Collection Account for reinvestment', amount: p });
          CD.push(LN.note('During the Reinvestment Period all remaining Principal Proceeds go to the Collection Account to buy Collateral Debt Securities.'));
          if (ctx.holdOut > 0.005) CD.push(LN.row('Includes interest diverted earlier, released here', '', ctx.holdOut));
          CD.push(LN.total('Due under this step', a, 'all principal cash remaining'));
          break;
        }
        case 'amortize': {
          simplePaid = false;
          const bucket = ctx.buckets.reinvestOnly, elect = +inp.reinvestElect || 0;
          const reinv = Math.min(pool.avail(), bucket + elect);
          CD.push(LN.row('Interest diverted to principal (reinvest only)', '', bucket));
          CD.push(LN.row('Credit-improved or prepaid proceeds the manager reinvests', 'as entered', elect));
          CD.push(LN.row('Reinvested', 'lesser of ' + fmt2(bucket + elect) + ' and ' + fmt2(pool.avail()) + ' cash', reinv));
          if (reinv > 0) { const p = take(reinv); ctx.reinvested += p; row.payees.push({ to: 'Reinvested at manager\'s option', amount: p }); row.paid += p; row.due += p; CP.push(LN.row('Reinvested at the manager\'s option', '', p)); }
          const a = pool.avail(); row.due += a; CD.push(LN.row('Remaining principal for sequential paydown', '', a)); CD.push(LN.total('Due under this step', row.due));
          const snap = cloneNotes(notes); const p = take(a); const r = applyPaydown(notes, st.paydown, p, st.includeDeferredOf);
          r.paid.forEach(x => { if (x.kind === 'principal') notes[x.to].prinPaid += x.amount; else notes[x.to].defPaidCure += x.amount; row.payees.push({ to: 'Class ' + x.to + ' ' + x.kind, amount: x.amount }); });
          CP.push(LN.head('Sequential paydown, in order ' + st.paydown.join(', ')), ...allocLines(r.paid, snap));
          const unused = p - r.used; if (unused > 0.005) { pool.refund(unused); CP.push(LN.note(fmt2(unused) + ' is left after every class is repaid and passes to the next step.')); }
          row.paid += r.used; if (ctx.principalInPCV) { ctx.pcv -= r.used; ctx.pcvLog.push({ why: 'Less: principal paid out at principal step ' + st.id, amt: -r.used }); }
          CP.push(LN.total('Paid', row.paid));
          break;
        }
        case 'principal': {
          const cls = st.classes || []; const inclDef = st.includeDeferredOf || cls.filter(c => notes[c] && notes[c].deferrable);
          cls.forEach(c => { CD.push(LN.row('Class ' + c + ' principal outstanding', '', notes[c].bal)); if (inclDef.includes(c) && notes[c].def > 0.005) CD.push(LN.row('Class ' + c + ' deferred interest', '', notes[c].def)); });
          row.due = capacity(notes, cls, inclDef); CD.push(LN.total('Due under this step', row.due));
          const snap = cloneNotes(notes); const p = take(row.due); const r = applyPaydown(notes, cls, p, inclDef);
          r.paid.forEach(x => { if (x.kind === 'principal') notes[x.to].prinPaid += x.amount; else notes[x.to].defPaidCure += x.amount; row.payees.push({ to: 'Class ' + x.to + ' ' + x.kind, amount: x.amount }); });
          row.paid = p; simplePaid = false; CP.push(LN.row('Paid', 'lesser of ' + fmt2(row.due) + ' due and ' + fmt2(row.before) + ' cash', p), LN.head('Applied in order ' + cls.join(', ')), ...allocLines(r.paid, snap));
          break;
        }
        case 'interestAndPrincipal': {
          const c = st.class; const x = notes[c];
          const di = Math.max(0, x.intDue - x.intPaid); const dd = x.def; const dp = x.bal;
          CD.push(...interestLine(c, x.intPaid));
          CD.push(LN.row('Class ' + c + ' deferred interest', dd > 0.5 ? '' : 'none', dd));
          CD.push(LN.row('Class ' + c + ' principal outstanding', '', dp));
          row.due = di + dd + dp; CD.push(LN.total('Due under this step', row.due));
          simplePaid = false; let b = pool.avail();
          let p = take(di); x.intPaid += p; row.paid += p; row.payees.push({ to: 'Class ' + c + ' interest', amount: p }); CP.push(LN.row('Interest', 'lesser of ' + fmt2(di) + ' and ' + fmt2(b) + ' cash', p));
          if (dd) { b = pool.avail(); p = take(dd); x.def -= p; x.defPaid += p; row.paid += p; row.payees.push({ to: 'Class ' + c + ' deferred interest', amount: p }); CP.push(LN.row('Deferred interest', 'lesser of ' + fmt2(dd) + ' and ' + fmt2(b) + ' cash', p)); }
          b = pool.avail(); p = take(dp); x.bal -= p; x.prinPaid += p; row.paid += p; row.payees.push({ to: 'Class ' + c + ' principal', amount: p }); CP.push(LN.row('Principal', 'lesser of ' + fmt2(dp) + ' and ' + fmt2(b) + ' cash', p));
          CP.push(LN.total('Paid', row.paid));
          break;
        }
        case 'equityHurdle': {
          if (!F.incentive) {
            warnings.push(kindName + ' step ' + st.id + ' applies the incentive fee hurdle, but the deal spec has no fees.incentive, so all remaining cash goes to the ' + spec.equity.name);
            const a = pool.avail(); const p = take(a); row.due = p; row.paid = p; ctx.subPaidToday += p; row.payees.push({ to: spec.equity.name, amount: p });
            CD.push(LN.note('The deal spec has no Incentive Management Fee (fees.incentive), so there is no IRR hurdle: all remaining cash goes to the ' + spec.equity.name + '.'), LN.total('Due under this step', p, 'all cash remaining'));
            row.note = 'No incentive fee in the deal spec: all remaining cash to the ' + spec.equity.name; break;
          }
          const H = hurdleLines(ctx.subPaidToday); CD.push(...H.lines);
          const need = H.need;
          const p = take(need); row.due = p; row.paid = p; row.hurdleRemaining = need - p; ctx.subPaidToday += p; row.payees.push({ to: spec.equity.name, amount: p });
          CD.push(LN.total('Due under this step', p, 'lesser of ' + fmt2(need) + ' needed and ' + fmt2(row.before) + ' cash'));
          if (need - p > 0.5) CD.push(LN.note('The step takes only the cash there is. The ' + fmt2(need - p) + ' still needed is not owed; it only means the 80/20 split has not started.'));
          row.note = need <= 0.5 ? 'Hurdle already met: residual is shared' : (need - p > 0.5 ? 'Takes all remaining cash; ' + money(need - p) + ' more is still needed to reach the ' + F.incentive.hurdleIRR + '% IRR hurdle (not a shortfall: the hurdle only sets when the split starts)' : 'Reaches the ' + F.incentive.hurdleIRR + '% IRR hurdle with this payment');
          break;
        }
        case 'incentiveSplit': {
          if (!F.incentive) { warnings.push(kindName + ' step ' + st.id + ' splits the residual with the manager, but the deal spec has no fees.incentive, so nothing is split'); row.note = 'No incentive fee in the deal spec'; CD.push(LN.note('The deal spec has no Incentive Management Fee (fees.incentive), so nothing is split here.'), LN.total('Due under this step', 0)); simplePaid = false; CP.push(LN.note('Nothing is paid.')); break; }
          const H = hurdleLines(ctx.subPaidToday); const need = H.need;
          if (need > 0.5) { row.note = 'Hurdle not yet met: no incentive fee'; CD.push(LN.row('Still needed to reach the hurdle', 'see the hurdle step above', need), LN.total('Due under this step', 0, 'the split starts only once the hurdle is met')); simplePaid = false; CP.push(LN.note('Nothing is paid.')); break; }
          CD.push(LN.row('Still needed to reach the hurdle', 'met by the step above', 0));
          const a = pool.avail(); row.due = a; CD.push(LN.total('Due under this step', a, 'all cash remaining'));
          const p = take(a); const share = F.incentive.managerShare / 100; const mgr = r2(p * share), eq = r2(p - mgr);
          ctx.subPaidToday += eq; ctx.cmIncentive += mgr;
          row.payees.push({ to: spec.equity.name, amount: eq }, { to: 'Incentive Management Fee', amount: mgr }); row.paid = p;
          simplePaid = false; CP.push(LN.row('Incentive Management Fee', fmt2(p) + ' × ' + F.incentive.managerShare + '%', mgr), LN.row(spec.equity.name, fmt2(p) + ' − ' + fmt2(mgr), eq), LN.total('Paid', p));
          break;
        }
        case 'none': { // a clause with no amount of its own: pays only the manual inputs tagged to it
          CD.push(LN.note(st.manual ? 'This clause pays amounts entered by hand: add them on the Manual inputs tab and tag them to this step. The clause has no amount of its own.' : 'This clause is read as making no payment of its own. Manual inputs tagged to this step are still paid here.'), LN.total('Due under this step', 0));
          row.note = mRows.length ? 'Pays only the manual inputs tagged here' : st.manual ? 'Entered by hand: tag a manual input to this step' : 'No payment of its own';
          break;
        }
        default:
          row.note = 'Step type "' + st.type + '" is not supported by the engine: skipped'; row.unsupported = true; warnings.push('Unsupported step ' + kind + ' ' + st.id + ': ' + st.type);
          CD.push(LN.note('The engine has no rule for this step type, so it is skipped.'));
      }
      } catch (err) {
        const spent = row.before - pool.avail(); if (Math.abs(spent) > 0) pool.refund(spent);
        const why = stepGap(st) || plainError(err);
        row.due = 0; row.paid = 0; row.payees = row.payees.filter(p => p.manual); row.failed = why; row.unsupported = true; simplePaid = false; CD.length = 0; CP.length = 0;
        row.note = 'Could not be computed: ' + why + '. Skipped, so the steps below are not reliable';
        CD.push(LN.note('This step could not be computed: ' + why + '. Its cash passes to the next step, so amounts below it are not reliable until the spec is fixed (Rules tab, Deal spec).'));
        CP.push(LN.note('Nothing is paid.'));
        warnings.push(kindName + ' step ' + st.id + ' (' + (st.label || st.type) + ') could not be computed: ' + why + '. It was skipped');
      }
      row.before = before0;
      if (mRows.length) {
        const oDue = row.due, oPaid = row.paid;
        mAfter.forEach(m => payManual(m, m.amount));
        CD.push(LN.head('Manual inputs tagged to this step'));
        mRows.forEach(m => CD.push(LN.sub(m.name + ' (manual input ' + m.n + ', ' + RANKTXT[m.rank] + ')', 'as entered', m.amount)));
        const mDue = sum(mRows, m => m.amount), mPaid = r2(sum(row.payees.filter(p => p.manual && !p.carried), p => p.amount));
        row.due = oDue + mDue; CD.push(LN.total('Due under this step, including manual inputs', row.due, fmt2(oDue) + ' + ' + fmt2(mDue)));
        if (simplePaid) { CP.push(LN.row('Paid under the clause', 'lesser of ' + fmt2(oDue) + ' due and ' + fmt2(ownStart) + ' cash', oPaid)); simplePaid = false; }
        CP.forEach(l => { if (l.t === 'total' && l.label === 'Paid') l.label = 'Paid under the clause'; });
        CP.push(LN.head('Manual inputs'), ...mLines);
        row.paid = oPaid + mPaid; CP.push(LN.total('Paid', row.paid, fmt2(oPaid) + ' + ' + fmt2(mPaid)));
        row.manual = mRows.map(m => ({ n: m.n, name: m.name, due: m.amount, paid: m.paid, rank: m.rank }));
        if (kind === 'interest') mRows.forEach(m => { if (m.amount - m.paid > 0.005) (ctx.unpaidManual[st.id] = ctx.unpaidManual[st.id] || []).push(m); });
      }
      ctx.adminCapPaidAll += sum(row.payees.filter(p => !p.manual && p.to === lbl('admin')), p => p.amount);
      if (adminRows.length && row.payees.some(p => !p.manual && (p.to === lbl('admin') || p.to === lbl('adminExcess')))) {
        const seqLines = [];
        row.payees = [].concat(...row.payees.map(p => {
          if (p.manual || !(p.to === lbl('admin') || p.to === lbl('adminExcess'))) return [p];
          const ex = p.to === lbl('adminExcess'); const out = ex ? splitSeq(origDues.admin + ctx.adminExcessPaid, p.amount, ' (above the cap)') : splitSeq(ctx.adminCapPaid, p.amount);
          if (ex) ctx.adminExcessPaid += p.amount; else ctx.adminCapPaid += p.amount;
          out.forEach(x => seqLines.push(LN.sub(x.to, '', x.amount))); return out;
        }));
        if (seqLines.length) { const hm = CP.findIndex(l => l.t === 'head' && l.text === 'Manual inputs'); const k = hm >= 0 ? hm : CP.map(l => l.t === 'total' && l.label === 'Paid').lastIndexOf(true); CP.splice(k < 0 ? CP.length : k, 0, LN.head('Administrative Expenses applied in sequence'), ...seqLines); }
      }
      row.shortfall = Math.max(0, row.due - row.paid);
      row.after = pool.avail();
      if (!CD.length) CD.push(LN.total('Due under this step', row.due));
      if (simplePaid) CP.push(LN.total('Paid', row.paid, 'lesser of ' + fmt2(row.due) + ' due and ' + fmt2(row.before) + ' cash'));
      if (kind === 'principal' && ctx.holdOut > 0.005 && st.type !== 'reinvest' && st.type !== 'amortize') CP.unshift(LN.note('Excludes ' + fmt2(ctx.holdOut) + ' diverted from interest, which can only be reinvested and is released at the reinvest or paydown step.'));
      CP.unshift(LN.row('Cash available before this step', '', row.before));
      if (row.shortfall > 0.5 && st.type !== 'equityHurdle') CP.push(LN.row('Shortfall', fmt2(row.due) + ' − ' + fmt2(row.paid), row.shortfall));
      CP.push(LN.total('Cash left for the next step', row.after, fmt2(row.before) + ' − ' + fmt2(row.before - row.after)));
      ledger.push(row);
    }
    return ledger;
  }

  const result = { period, paymentDate: pd, prevDate: prev, days: ndays, inRP, mode, libor, interestProceeds, estInterest, principalProceeds: principalCash, feeBasis, dues: Object.assign({}, dues), adminCap, adminDue, adminEntered, pf, pb, qm, quality, conc, preTests, preIRT, preEoD, icDeduct, warnings, manual: manualAll, manualNotes };

  if (mode === 'liquidation') {
    let cash = interestProceeds + principalCash + (+inp.liquidationProceeds || 0);
    const pool = { avail: () => cash, spend: x => { cash -= x; }, refund: x => { cash += x; } };
    result.liquidationCash = cash;
    waterfalls.liquidation = runList('liquidation', spec.waterfalls.liquidation || [], pool);
    result.residual = cash;
  } else {
    let ic = interestProceeds;
    const ipool = { avail: () => ic, spend: x => { ic -= x; }, refund: x => { ic += x; } };
    waterfalls.interest = runList('interest', spec.waterfalls.interest || [], ipool);
    result.interestResidual = ic;
    // principal pool: regular + amounts moved from interest (reinvest-only)
    let pc = ctx.buckets.regular + ctx.buckets.reinvestOnly + ic; // any residual interest (should be ~0) joins principal
    const ppool = { avail: () => pc, spend: x => { pc -= x; }, refund: x => { pc += x; } };
    // steps before reinvest/amortize may only use the regular bucket
    const pre = ctx.buckets.reinvestOnly;
    let hold = pre; pc -= hold; ctx.holdOut = hold;
    const steps = spec.waterfalls.principal || [];
    const out = [];
    for (const st of steps) {
      if ((st.type === 'reinvest' || st.type === 'amortize') && hold > 0) { ctx.holdOut = hold; pc += hold; hold = 0; }
      out.push(...runList('principal', [st], ppool));
      if (st.type === 'reinvest' || st.type === 'amortize') ctx.holdOut = 0; else ctx.holdOut = hold;
    }
    pc += hold;
    waterfalls.principal = out;
    result.residual = pc;
  }

  // ---- working for the cash each waterfall starts with
  {
    const entered = inp.interestProceeds != null && inp.interestProceeds !== '';
    const ipl = [];
    if (entered) ipl.push(LN.total('Interest Proceeds', interestProceeds, 'as entered'));
    else {
      const fl = ndF, fx = ndX; const flPar = estParts.flPar, flSp = estParts.flSp, fxPar = estParts.fxPar, fxCp = estParts.fxCp;
      const defd = pf.rows.filter(r => r.defaulted);
      ipl.push(LN.note('Estimated from the tape: every performing loan is assumed to pay a full period of interest at today\'s index. Enter the trustee report figure under Rates and collections to replace it.'));
      ipl.push(LN.row('Floating-rate par, performing (' + fl.length + ' positions)', '', flPar));
      if (flPar) {
        ipl.push(LN.row('Index interest', fmt2(flPar) + ' × ' + fpct(libor) + ' × ' + dS, estParts.idx));
        ipl.push(LN.sub('Annual spread income, sum of par × spread over each loan (par-weighted spread ' + fpct(flSp / flPar, 4) + ')', 'see the Portfolio tab for each loan', fmt2(flSp / 100)));
        ipl.push(LN.row('Spread interest', fmt2(flSp / 100) + ' × ' + dS, estParts.spr));
      }
      if (fxPar) { ipl.push(LN.row('Fixed-rate par, performing (' + fx.length + ' positions)', '', fxPar)); ipl.push(LN.row('Coupon interest', fmt2(fxCp / 100) + ' a year × ' + dS, estParts.cpn)); }
      if (defd.length) ipl.push(LN.note(defd.length + ' defaulted positions (' + fmt2(sum(defd, r => r.par)) + ' par) are assumed to pay nothing.'));
      ipl.push(LN.total('Interest Proceeds', interestProceeds));
    }
    result.sourceCalc = { interest: ipl };
    const ppl = [LN.row('Principal Proceeds in the Principal Collection Account', 'as entered', principalCash)];
    if (mode !== 'liquidation') {
      if (ctx.irtDiverted) ppl.push(LN.row('Plus: interest diverted under the ' + (cov.reinvestmentTest ? cov.reinvestmentTest.label : 'reinvestment test'), 'reinvestment only', ctx.irtDiverted));
      const movedFee = ctx.buckets.reinvestOnly - (ctx.irtDiverted || 0);
      if (movedFee > 0.005) ppl.push(LN.row('Plus: deferred management fee moved to principal', 'reinvestment only', movedFee));
      if (result.interestResidual > 0.005) ppl.push(LN.row('Plus: interest left after the last interest step', '', result.interestResidual));
      ppl.push(LN.total('Principal waterfall starts with', ctx.buckets.regular + ctx.buckets.reinvestOnly + (result.interestResidual || 0)));
    }
    result.sourceCalc.principal = ppl;
    if (mode === 'liquidation') result.sourceCalc.liquidation = [LN.row('Interest Proceeds', entered ? 'as entered' : 'tape estimate', interestProceeds), LN.row('Principal Proceeds', 'as entered', principalCash), LN.row('Sale proceeds of the portfolio', 'as entered (defaults to par × price, capped at par)', +inp.liquidationProceeds || 0), LN.total('Liquidation cash', interestProceeds + principalCash + (+inp.liquidationProceeds || 0))];
  }
  // post-payment
  for (const c of order) {
    const x = notes[c];
    x.intShort = Math.max(0, x.intDue - x.intPaid - (x.sameDayDef || 0));
    x.defEnd = x.deferrable ? x.def + x.intShort : x.def;
    x.balEnd = x.bal;
    if (!x.deferrable && x.intShort > 0.5) ctx.eod.push('Class ' + c + ' interest shortfall of ' + money(x.intShort) + ' (Event of Default if not paid within the grace period)');
  }
  const postNotes = cloneNotes(notes); for (const c of order) { postNotes[c].def = postNotes[c].defEnd; postNotes[c].defForTest = postNotes[c].defEnd; }
  result.postTests = snapshotTests(postNotes, ctx.pcv);
  result.postIRT = cov.reinvestmentTest ? ocOf(cov.reinvestmentTest.ocClasses, postNotes, ctx.pcv) : null;
  result.postEoD = cov.eodTest ? ocOf(cov.eodTest.ocClasses, postNotes, ctx.pcv) : null;
  if (preEoD && preEoD.ratio < cov.eodTest.trigger) ctx.eod.push(cov.eodTest.label + ' at ' + preEoD.ratio.toFixed(2) + '% is below ' + cov.eodTest.trigger + '%');
  result.pcvAfter = ctx.pcv;
  manualAll.forEach(m => { if (m.status) return; m.status = m.paid >= m.amount - 0.005 ? 'Paid in full' : m.paid > 0.005 ? 'Part paid, ' + fmt2(r2(m.amount - m.paid)) + ' short' : 'Not paid: no cash left when it was reached'; });
  result.notes = notes; result.waterfalls = waterfalls; result.ctx = { subPaidToday: ctx.subPaidToday, cmIncentive: ctx.cmIncentive, currentDeferred: ctx.currentDeferred, recouped: ctx.recouped, cumDeferredFeeEnd: ctx.cumDeferredFee + ctx.currentDeferred - ctx.recouped, irtDiverted: ctx.irtDiverted || 0, reinvested: ctx.reinvested, eod: ctx.eod, subFeeUnpaid: (dues.subMgmtCurrent || 0) + (dues.subMgmtPrior || 0), seniorFeesUnpaid: (dues.seniorMgmt || 0) + (dues.structuring || 0), adminCapPaid: ctx.adminCapPaidAll };
  // equity IRR to date (incl. today)
  const flows = [{ t: 0, amount: -spec.equity.balance }].concat((inp.subHistory || []).filter(h => D(h.date) < D(pd)).map(h => ({ t: days(spec.meta.closingDate, h.date), amount: h.amount })));
  if (ctx.subPaidToday > 0) flows.push({ t: days(spec.meta.closingDate, pd), amount: ctx.subPaidToday });
  result.equityIRR = xirr(flows, (spec.fees.incentive && spec.fees.incentive.dayBasis) || 360);
  result.equityCum = sum(flows.slice(1), f => f.amount);
  // ---- every test: how its numerator and denominator are built, and the assets behind each figure
  // (skipped when inp.lite is set: a projection runs the engine many times and needs only the figures)
  if (inp.lite) result.testCalc = null; else try {
    const P4 = x => x === Infinity ? 'n/m' : (+x).toFixed(4) + '%';
    // asset table: cols are [label, fmt, getter, sum?]
    const TB = (title, cols, rows, note) => {
      const body = rows.map(r => cols.map(c => { const v = c[2](r); return v == null ? '' : v; }));
      const total = cols.some(c => c[3]) ? cols.map((c, i) => c[3] ? (c[1] === 'usd' ? r2(sum(body, b => +b[i] || 0)) : sum(body, b => +b[i] || 0)) : (i === 0 ? 'Total, ' + rows.length + (rows.length === 1 ? ' row' : ' rows') : '')) : null;
      return { title, cols: cols.map(c => ({ label: c[0], fmt: c[1] })), rows: body, total, note: note || '' };
    };
    const cID = ['ID', 'text', r => r.id], cOb = ['Obligor', 'text', r => r.obligor], cTy = ['Type', 'text', r => r.assetType];
    const cPar = ['Par', 'usd', r => r.par, true], cM = ["Moody's DPR", 'text', r => r.moodysDPR], cS = ['S&P rating', 'text', r => r.spRating];
    const rows = pf.rows, nd = rows.filter(r => !r.defaulted);
    const part = (title, value, fmt, lines, tables) => ({ title, value, fmt, lines, tables: tables || [] });
    const cashIn = ctx.principalInPCV ? principalCash : 0;
    const pcvGen = pb.pcvGeneral;

    // Principal Collateral Value (numerator of every OC test)
    const defd = rows.filter(r => r.defaulted), disc = rows.filter(r => !r.defaulted && r.discount), cccA = rows.filter(r => r.cccAlloc > 0);
    const assetsCarried = r2(sum(rows, r => r.ocPB));
    const pcvLines = [LN.row('Aggregate par of the collateral', 'sum of the Par column, ' + rows.length + ' positions', pb.parTotal)];
    if (defd.length) pcvLines.push(LN.sub('Less: Defaulted Securities, carried at the lesser of market value and recovery value', fmt2(sum(defd, r => r.ocPB)) + ' − ' + fmt2(sum(defd, r => r.par)), -pb.haircut.defaulted));
    if (disc.length) pcvLines.push(LN.sub('Less: Discount Obligations, carried at purchase price', fmt2(sum(disc, r => r.ocPB)) + ' − ' + fmt2(sum(disc, r => r.par)), -pb.haircut.discount));
    if (cccA.length) pcvLines.push(LN.sub('Less: CCC Excess of ' + fmt2(pb.cccExcess) + ', carried at the lesser of ' + spec.haircuts.ccc.haircutPct + '% of par and market value', fmt2(sum(cccA, r => r.ocPB)) + ' − ' + fmt2(sum(cccA, r => r.par)), -pb.haircut.ccc));
    pcvLines.push(LN.row('Carrying value of the collateral', [fmt2(pb.parTotal)].concat(defd.length ? [fmt2(pb.haircut.defaulted)] : [], disc.length ? [fmt2(pb.haircut.discount)] : [], cccA.length ? [fmt2(pb.haircut.ccc)] : []).join(' − '), assetsCarried));
    pcvLines.push(LN.row(ctx.principalInPCV ? 'Plus: Principal Proceeds on deposit' : 'Principal Proceeds on deposit, excluded by your setting', ctx.principalInPCV ? '' : 'not counted', cashIn));
    pcvLines.push(LN.total('Principal Collateral Value', ctx.pcvStart, fmt2(assetsCarried) + ' + ' + fmt2(cashIn)));
    const elig = r => !r.defaulted && !r.discount;
    const bM = rows.filter(r => elig(r) && mIdx(r.moodysDPR) >= pf.cccM), bS = rows.filter(r => elig(r) && sIdx(r.spRating) >= pf.cccS);
    const useM = pb.cccAmtMoodys >= pb.cccAmtSP; const bucket = (useM ? bM : bS).slice().sort((a, b) => a.price - b.price);
    if (bM.length || bS.length) {
      const pcvNoCcc = r2(pb.parTotal - pb.haircut.defaulted - pb.haircut.discount + principalCash);
      pcvLines.push(LN.head('CCC Excess'));
      pcvLines.push(LN.sub("Par rated " + spec.haircuts.ccc.moodysAtOrBelow + " or below by Moody's", bM.length + ' positions', pb.cccAmtMoodys));
      pcvLines.push(LN.sub('Par rated ' + spec.haircuts.ccc.spAtOrBelow + ' or below by S&P', bS.length + ' positions', pb.cccAmtSP));
      pcvLines.push(LN.sub('Collateral before the CCC haircut', fmt2(pb.parTotal) + ' − ' + fmt2(pb.haircut.defaulted) + ' − ' + fmt2(pb.haircut.discount) + ' + ' + fmt2(principalCash), pcvNoCcc));
      pcvLines.push(LN.row('Limit', fpct(spec.haircuts.ccc.limitPct, 2) + ' × ' + fmt2(pcvNoCcc), pb.cccLimit));
      pcvLines.push(LN.row('CCC Excess, using the larger bucket (' + (useM ? "Moody's" : 'S&P') + ')', pb.cccExcess > 0 ? fmt2(Math.max(pb.cccAmtMoodys, pb.cccAmtSP)) + ' − ' + fmt2(pb.cccLimit) : 'within the limit', pb.cccExcess));
      if (pb.cccExcess > 0) pcvLines.push(LN.note('The excess is assigned to the lowest-priced CCC assets first and carried at the lesser of ' + spec.haircuts.ccc.haircutPct + '% of par and market value. The CCC table shows the allocation.'));
    }
    const statusOf = r => r.defaulted ? 'Defaulted' : r.discount ? 'Discount' : r.cccAlloc ? 'CCC excess' : r.ccc ? 'CCC' : '';
    const pcvTables = [];
    if (defd.length) pcvTables.push(TB('Defaulted Securities', [cID, cOb, ['Defaulted on', 'text', r => r.defaultDate], ['Years in default', 'num2', r => r.yrsDefaulted], cPar, ['Price', 'num2', r => r.price], ['Market value', 'usd', r => r2(r.price / 100 * r.par), true], ["Moody's recovery", 'pct1', r => r.mRR], ['S&P recovery, ' + seniorCol, 'pct1', r => r.sRR[seniorCol]], ['Recovery value', 'usd', r => r2(Math.min(r.mRR, r.sRR[seniorCol]) / 100 * r.par), true], ['Carried at', 'usd', r => r.ocPB, true]], defd,
      'Recovery value uses the lower of the Moody\'s and S&P (' + seniorCol + ' column) recovery rates. Carried at zero after ' + spec.haircuts.defaulted.zeroAfterYears + ' years in default.'));
    if (disc.length) pcvTables.push(TB('Discount Obligations', [cID, cOb, cTy, ["Moody's facility", 'text', r => r.moodysFacility], cPar, ['Purchase price', 'num2', r => r.purchasePrice], ['Threshold', 'num2', r => { const d = r.assetType === 'BOND' ? spec.haircuts.discount.other : spec.haircuts.discount.loan; return mIdx(r.moodysFacility) > mIdx('B3') ? d.belowB3 : d.atLeastB3; }], ['Carried at', 'usd', r => r.ocPB, true]], disc, 'Bought below the threshold price, so carried at purchase price until the obligation is cured.'));
    if (bucket.length) pcvTables.push(TB('CCC bucket (' + (useM ? "Moody's" : 'S&P') + '), lowest price first', [cID, cOb, cM, cS, cPar, ['Price', 'num2', r => r.price], ['Excess assigned', 'usd', r => r.cccAlloc || 0, true], ['Carried at', 'usd', r => r.ocPB, true]], bucket));
    pcvTables.push(TB('All collateral', [cID, cOb, cTy, cM, cS, cPar, ['Price', 'num2', r => r.price], ['Treatment', 'text', statusOf], ['Carried at', 'usd', r => r.ocPB, true], ['Haircut', 'usd', r => r2(r.par - r.ocPB), true]], rows.slice().sort((a, b) => (b.par - b.ocPB) - (a.par - a.ocPB) || b.par - a.par),
      'Sorted with the largest haircuts first. Principal Proceeds of ' + fmt2(principalCash) + (ctx.principalInPCV ? ' are added on top.' : ' are not counted, by your setting.')));
    const pcvPart = part('Principal Collateral Value', ctx.pcvStart, 'usd', pcvLines, pcvTables);

    const noteTable = (classes, n) => TB('Notes in the denominator', [['Class', 'text', c => c], ['Principal outstanding', 'usd', c => n[c].bal, true], ['Deferred interest', 'usd', c => n[c].def || 0], ['Counted', 'usd', c => n[c].bal, true]], classes,
      classes.some(c => (n[c].def || 0) > 0.5) ? 'Capitalised deferred interest is shown for reference; the OC denominator counts principal only.' : '');
    const ocDen = (classes, n) => part('Principal of Class ' + classes.join(', '), sum(classes, c => n[c].bal), 'usd',
      classes.map(c => LN.sub('Class ' + c + ' principal outstanding', '', n[c].bal)).concat([LN.total('Denominator', sum(classes, c => n[c].bal), classes.map(c => fmt2(n[c].bal)).join(' + '))]), [noteTable(classes, n)]);
    const ocResult = (label, num, den, trigger) => { const ratio = den > 0.5 ? num / den * 100 : Infinity; return [LN.head('Result'), LN.row(label, fmt2(num) + ' ÷ ' + fmt2(den), fratio(ratio)), LN.check('Trigger ' + fpct(trigger, 2), fratio(ratio) + (ratio >= trigger - 1e-9 ? ' ≥ ' : ' < ') + fpct(trigger, 2), ratio >= trigger - 1e-9)]; };
    const withResult = (p, extra) => Object.assign({}, p, { lines: p.lines.concat(extra) });
    const ocPair = (label, classes, trigger, n, pcvP) => { const d = ocDen(classes, n); const res = ocResult(label, pcvP.value, d.value, trigger); return { num: withResult(pcvP, res), den: withResult(d, res) }; };
    // after this Payment Date
    const pcvAfterLines = [LN.row('Principal Collateral Value on the Determination Date', 'see the numerator before payments', ctx.pcvStart)].concat(ctx.pcvLog.map(x => LN.row(x.why, '', x.amt)), [LN.total('Principal Collateral Value after payments', ctx.pcv, [fmt2(ctx.pcvStart)].concat(ctx.pcvLog.map(x => (x.amt < 0 ? '− ' : '+ ') + fmt2(Math.abs(x.amt)))).join(' '))]);
    const pcvAfter = part('Principal Collateral Value after payments', ctx.pcv, 'usd', pcvAfterLines, ctx.pcvLog.length ? [TB('Changes during the waterfalls', [['Change', 'text', x => x.why], ['Amount', 'usd', x => x.amt, true]], ctx.pcvLog)] : []);

    // Interest coverage
    const entered = inp.interestProceeds != null && inp.interestProceeds !== '';
    const ipLines = (result.sourceCalc.interest || []).slice(0, -1);
    const icNumLines = ipLines.concat([LN.row('Interest Proceeds', entered ? 'as entered' : 'tape estimate', interestProceeds)], icParts.map(x => LN.sub('Less: interest step ' + x.id + ', ' + x.label, '', -x.amount)), [LN.total('Numerator', ctx.icNum, fmt2(interestProceeds) + ' − ' + fmt2(icDeduct))]);
    const icNumTables = [];
    if (icParts.length) icNumTables.push(TB('Deducted from Interest Proceeds', [['Step', 'text', x => x.id], ['Item', 'text', x => x.label], ['Amount', 'usd', x => x.amount, true]], icParts));
    if (!entered) {
      const perf = nd.slice().sort((a, b) => b.par - a.par);
      const intOf = r => r2(r.par * (r.rateType === 'FIXED' ? r.coupon : libor + r.spread) / 100 * dcf);
      const tableSum = r2(sum(perf, intOf)); const diff = r2(tableSum - interestProceeds);
      icNumTables.push(TB('Performing collateral: interest for this period', [cID, cOb, ['Rate type', 'text', r => r.rateType], cPar, ['Index', 'pct4', r => r.rateType === 'FIXED' ? '' : libor], ['Spread', 'pct4', r => r.rateType === 'FIXED' ? '' : r.spread], ['Coupon', 'pct4', r => r.rateType === 'FIXED' ? r.coupon : ''], ['All-in rate', 'pct4', r => r.rateType === 'FIXED' ? r.coupon : libor + r.spread], ['Interest, ' + ndays + ' days', 'usd', intOf, true]], perf,
        'Each row is par × all-in rate × ' + ndays + ' / 360, rounded to the cent.' + (Math.abs(diff) >= 0.005 ? ' The estimate above is computed on the totals, so it differs from this column by ' + fmt2(diff) + ' of rounding.' : '') + (defd.length ? ' Defaulted Securities are assumed to pay nothing and are left out.' : '')));
    }
    const icNumPart = part('Interest Proceeds less senior payments', ctx.icNum, 'usd', icNumLines, icNumTables);
    const icDenPart = (classes, n) => {
      const L = []; let den = 0;
      classes.forEach(c => { const x = n[c]; const base = x.bal + x.defForTest; const intr = r2(base * x.rate / 100 * dcf); den += intr;
        L.push(LN.sub('Class ' + c + ' interest', (x.defForTest > 0.5 ? '(' + fmt2(x.bal) + ' + ' + fmt2(x.defForTest) + ')' : fmt2(x.bal)) + ' × ' + fpct(x.rate) + ' × ' + dS, intr));
        if (x.deferrable && x.defForTest > 0.5) { L.push(LN.sub('Class ' + c + ' deferred interest due', '', x.defForTest)); den += x.defForTest; } });
      L.push(LN.total('Denominator', den));
      return part('Interest due on Class ' + classes.join(', '), den, 'usd', L, [TB('Notes in the denominator', [['Class', 'text', c => c], ['Principal', 'usd', c => n[c].bal], ['Deferred interest', 'usd', c => n[c].defForTest || 0], ['Rate', 'pct4', c => n[c].rate], ['Interest, ' + ndays + ' days', 'usd', c => r2((n[c].bal + n[c].defForTest) * n[c].rate / 100 * dcf), true], ['Deferred interest due', 'usd', c => n[c].deferrable ? n[c].defForTest || 0 : 0, true]], classes)]);
    };
    const coverage = {};
    cov.tests.forEach((t, i) => {
      const pre = preTests[i]; const o = ocPair(t.label + ' OC ratio', t.oc.classes, t.oc.trigger, preNotes, pcvPart);
      const post = result.postTests[i]; const oa = ocDen(t.oc.classes, postNotes); const resA = ocResult(t.label + ' OC ratio after payments', ctx.pcv, oa.value, t.oc.trigger);
      const x = { oc: o, ocAfter: { num: withResult(pcvAfter, resA), den: withResult(Object.assign({}, oa, { title: 'Principal of Class ' + t.oc.classes.join(', ') + ' after payments' }), resA) } };
      if (t.ic) {
        const dp = icDenPart(t.ic.classes, preNotes); const applies = period >= (t.ic.fromPeriod || 1);
        const res = [LN.head('Result'), LN.row(t.label + ' IC ratio', fmt2(ctx.icNum) + ' ÷ ' + fmt2(dp.value), fratio(pre.ic.ratio)), LN.check('Trigger ' + fpct(t.ic.trigger, 2), applies ? fratio(pre.ic.ratio) + (pre.ic.ratio >= t.ic.trigger - 1e-9 ? ' ≥ ' : ' < ') + fpct(t.ic.trigger, 2) : 'not applied until Payment Date ' + t.ic.fromPeriod, pre.ic.ratio >= t.ic.trigger - 1e-9, applies)];
        x.ic = { num: withResult(icNumPart, res), den: withResult(dp, res) };
      }
      coverage[t.id] = x;
    });
    const TC = { coverage };
    if (cov.reinvestmentTest) { const rt = cov.reinvestmentTest; TC.irt = ocPair(rt.label, rt.ocClasses, rt.trigger, preNotes, pcvPart); const d = ocDen(rt.ocClasses, postNotes); const res = ocResult(rt.label + ' after payments', ctx.pcv, d.value, rt.trigger); TC.irtAfter = { num: withResult(pcvAfter, res), den: withResult(d, res) }; }
    if (cov.eodTest) { const et = cov.eodTest; TC.eod = ocPair(et.label, et.ocClasses, et.trigger, preNotes, pcvPart); const d = ocDen(et.ocClasses, postNotes); const res = ocResult(et.label + ' after payments', ctx.pcv, d.value, et.trigger); TC.eodAfter = { num: withResult(pcvAfter, res), den: withResult(d, res) }; }

    // Collateral Quality Tests
    const apb = qm.apb; const parLine = LN.total('Denominator: par of performing collateral', apb, 'sum of the Par column, ' + nd.length + ' positions');
    const limitLines = (q) => { const o = [LN.head('Against the limit')]; if (q.note) o.push(LN.note(q.note)); if (q.limit != null && q.value != null && q.pass != null) o.push(LN.check('Limit ' + (q.op === '<=' ? '≤ ' : '≥ ') + (typeof q.limit === 'number' ? +q.limit.toFixed(4) : q.limit), String(+(+q.value).toFixed(4)) + (q.pass ? ' passes' : ' fails'), q.pass)); return o; };
    const quality = {};
    for (const q of result.quality) {
      const t = (spec.qualityTests || []).find(x => x.id === q.id) || {}; let num = null, den = null;
      const defNote = defd.length ? [LN.note(defd.length + ' Defaulted Securities (' + fmt2(sum(defd, r => r.par)) + ' par) are excluded.')] : [];
      if (t.metric === 'warf') {
        const S1 = sum(nd, r => r.par * r.rf); const T = TB('Performing collateral by rating factor', [cID, cOb, cM, ['Rating factor', 'num0', r => r.rf], cPar, ['Par × rating factor', 'num0', r => r.par * r.rf, true]], nd.slice().sort((a, b) => b.rf - a.rf || b.par - a.par));
        const res = [LN.head('Result'), LN.row('Par-weighted rating factor', fmt2(S1) + ' ÷ ' + fmt2(apb), apb ? S1 / apb : 0), LN.row('WARF, rounded up to a whole number', '', String(qm.warf))].concat(limitLines(q));
        num = part('Σ par × Moody\'s Rating Factor', S1, 'num', [LN.total('Numerator: Σ par × rating factor', S1, 'sum of the last column')].concat(defNote, res), [T]);
        den = part('Par of performing collateral', apb, 'usd', [parLine].concat(defNote, res), [T]);
      } else if (t.metric === 'was') {
        const fl = nd.filter(r => r.rateType !== 'FIXED'); const S1 = sum(fl, r => r.par * r.spread / 100); const exF = qm.excessFunded / 100;
        const T = TB('Floating-rate performing collateral', [cID, cOb, cPar, ['Spread', 'pct4', r => r.spread], ['Annual spread income', 'usd', r => r.par * r.spread / 100, true]], fl.slice().sort((a, b) => b.spread - a.spread));
        const nl = [LN.row('Annual spread income: Σ par × spread', 'sum of the last column', S1)];
        if (exF) nl.push(LN.row('Plus: index earned on par above the Target Par', fpct(libor) + ' × ' + fmt2(apb - spec.meta.targetPar), exF));
        nl.push(LN.total('Numerator', S1 + exF));
        const res = [LN.head('Result'), LN.row('Weighted average spread', fmt2(S1 + exF) + ' ÷ ' + fmt2(qm.flPar), P4(qm.wasRaw))];
        if (qm.was > qm.wasRaw + 1e-12) { res.push(LN.row('Plus: excess coupon converted to spread, (WAC − minimum WAC) × fixed par ÷ floating par', '(' + fpct(qm.wacRaw, 6) + ' − ' + fpct(spec.spreadRules.minWAC, 2) + ') × ' + fmt2(qm.fxPar) + ' ÷ ' + fmt2(qm.flPar), P4(qm.couponExcess))); res.push(LN.row('Weighted average spread with the excess, capped at the level the tests need', '', P4(qm.was))); }
        if (t.adjust && t.adjust.type === 'recoveryModifier' && q.value - qm.was > 1e-12) { const mv = sel.moodysModifier; const row = (t.adjust.table || []).find(x => x[0] === mv); res.push(LN.row("Plus: Moody's recovery modifier, in percentage points", '(' + qm.mwarr.toFixed(1) + ' − ' + mv + ') × ' + row[1] + ' ÷ 100', (q.value - qm.was).toFixed(4)), LN.row('Spread for this test', '', P4(q.value))); }
        res.push(...limitLines(q));
        num = part('Annual spread income on floating-rate collateral', S1 + exF, 'usd', nl.concat(res), [T]);
        den = part('Par of floating-rate performing collateral', qm.flPar, 'usd', [LN.total('Denominator: floating-rate par', qm.flPar, 'sum of the Par column, ' + fl.length + ' positions')].concat(defNote, res), [T]);
      } else if (t.metric === 'wac') {
        const fx = nd.filter(r => r.rateType === 'FIXED'); const S1 = sum(fx, r => r.par * r.coupon / 100);
        const T = TB('Fixed-rate performing collateral', [cID, cOb, cPar, ['Coupon', 'pct4', r => r.coupon], ['Annual coupon income', 'usd', r => r.par * r.coupon / 100, true]], fx.slice().sort((a, b) => b.coupon - a.coupon));
        const res = [LN.head('Result')];
        if (!fx.length) res.push(LN.note('There are no fixed-rate assets, so the test does not apply.'));
        else { res.push(LN.row('Weighted average coupon', fmt2(S1) + ' ÷ ' + fmt2(qm.fxPar), P4(qm.wacRaw))); if (qm.wac > qm.wacRaw + 1e-12) { res.push(LN.row('Plus: excess spread converted to coupon, (WAS − minimum WAS) × floating par ÷ fixed par', '(' + fpct(qm.wasRaw, 6) + ' − ' + fpct(spec.spreadRules.minWAS, 2) + ') × ' + fmt2(qm.flPar) + ' ÷ ' + fmt2(qm.fxPar), P4(qm.spreadExcess))); res.push(LN.row('Coupon for the test, capped at the minimum', '', P4(qm.wac))); } }
        res.push(...limitLines(q));
        num = part('Annual coupon income on fixed-rate collateral', S1, 'usd', [LN.total('Numerator: Σ par × coupon', S1, 'sum of the last column')].concat(res), [T]);
        den = part('Par of fixed-rate performing collateral', qm.fxPar, 'usd', [LN.total('Denominator: fixed-rate par', qm.fxPar, 'sum of the Par column, ' + fx.length + ' positions')].concat(res), [T]);
      } else if (t.metric === 'wal') {
        const S1 = sum(nd, r => r.par * r.yrs); const T = TB('Performing collateral by remaining life', [cID, cOb, ['Maturity', 'text', r => r.maturity], ['Years to maturity', 'num2', r => r.yrs], cPar, ['Par × years', 'num2', r => r.par * r.yrs, true]], nd.slice().sort((a, b) => b.yrs - a.yrs), 'Years run from ' + pd + ' to each maturity, divided by 365 and rounded to 0.01.');
        const res = [LN.head('Result'), LN.row('Weighted average life, in years', fmt2(S1) + ' ÷ ' + fmt2(apb), apb ? S1 / apb : 0)].concat(limitLines(q));
        num = part('Σ par × years to maturity', S1, 'num', [LN.total('Numerator: Σ par × years', S1, 'sum of the last column')].concat(defNote, res), [T]);
        den = part('Par of performing collateral', apb, 'usd', [parLine].concat(defNote, res), [T]);
      } else if (t.metric === 'diversity') {
        const byOb = {}; for (const r of nd) { const k = r.obligor; (byOb[k] = byOb[k] || { ob: k, par: 0, ind: r.mIndustry }).par += r.par; }
        const obs = Object.values(byOb); const tot = sum(obs, o => o.par); const avg = obs.length ? tot / obs.length : 0;
        obs.forEach(o => { o.units = avg ? Math.min(1, o.par / avg) : 0; });
        const byInd = {}; obs.forEach(o => { (byInd[o.ind] = byInd[o.ind] || { ind: o.ind, n: 0, par: 0, units: 0 }); byInd[o.ind].n++; byInd[o.ind].par += o.par; byInd[o.ind].units += o.units; });
        const inds = Object.values(byInd).map(x => Object.assign(x, { u1: Math.round(x.units * 10) / 10, score: industryScore(x.units) })).sort((a, b) => b.score - a.score);
        const res = [LN.head('Result'), LN.row('Diversity Score, sum of the industry scores', 'rounded to 0.01', qm.ds)].concat(limitLines(q));
        num = part('Sum of industry diversity scores', qm.ds, 'num2', [LN.note('Each obligor counts as the lesser of 1 and its par ÷ the Average Par Amount. Units are added up by Moody\'s industry, rounded to 0.1, and converted to an industry score with Moody\'s table: 1 unit scores 1, 2 score 1.5, 3 score 2, then the increments shrink to a cap of 5.')].concat(res),
          [TB('Industries', [['Moody\'s industry', 'text', x => x.ind], ['Obligors', 'num0', x => x.n, true], ['Par', 'usd', x => x.par, true], ['Obligor units', 'num4', x => x.units], ['Units, to 0.1', 'num1', x => x.u1], ['Industry score', 'num2', x => x.score, true]], inds)]);
        den = part('Average Par Amount per obligor', avg, 'usd', [LN.row('Par of performing collateral, summed by obligor', '', tot), LN.row('Number of obligors', '', String(obs.length)), LN.total('Average Par Amount', avg, fmt2(tot) + ' ÷ ' + obs.length)].concat(res),
          [TB('Obligors', [cOb, ['Moody\'s industry', 'text', o => o.ind], ['Par', 'usd', o => o.par, true], ['Units: lesser of 1 and par ÷ average', 'num4', o => o.units, true]], obs.sort((a, b) => b.par - a.par))]);
      } else if (t.metric === 'moodysWARR') {
        const S1 = sum(nd, r => r.par * r.mRR / 100);
        const T = TB("Performing collateral by Moody's recovery rate", [cID, cOb, cTy, cM, ["Moody's facility", 'text', r => r.moodysFacility], ['Notches, facility above DPR', 'num0', r => clamp(mIdx(r.moodysDPR) - mIdx(r.moodysFacility), -3, 2)], ['Recovery rate', 'pct1', r => r.mRR], cPar, ['Par × rate', 'usd', r => r.par * r.mRR / 100, true]], nd.slice().sort((a, b) => a.mRR - b.mRR || b.par - a.par));
        const res = [LN.head('Result'), LN.row('Weighted average recovery rate', fmt2(S1) + ' ÷ ' + fmt2(apb), P4(apb ? S1 / apb * 100 : 0)), LN.row('Rounded up to 0.1%', '', qm.mwarr.toFixed(1) + '%')].concat(limitLines(q));
        num = part('Σ par × Moody\'s recovery rate', S1, 'usd', [LN.total('Numerator: recovery value at Moody\'s rates', S1, 'sum of the last column')].concat(defNote, res), [T]);
        den = part('Par of performing collateral', apb, 'usd', [parLine].concat(defNote, res), [T]);
      } else if (t.metric === 'spWARR') {
        const cols = spec.recovery.sp.cols; const c0 = cols[0]; const S1 = sum(nd, r => r.par * r.sRR[c0] / 100);
        const T = TB('Performing collateral by S&P recovery rate', [cID, cOb, cTy, ['S&P recovery rating', 'text', r => r.spRecUsed]].concat(cols.map(c => [c + ' rate', 'pct1', r => r.sRR[c]]), [cPar, ['Par × ' + c0 + ' rate', 'usd', r => r.par * r.sRR[c0] / 100, true]]), nd.slice().sort((a, b) => a.sRR[c0] - b.sRR[c0] || b.par - a.par));
        const res = [LN.head('Result')].concat(cols.map(c => LN.sub(c + ' column', fmt2(sum(nd, r => r.par * r.sRR[c] / 100)) + ' ÷ ' + fmt2(apb), P4(qm.swarr[c]))), limitLines(q));
        num = part('Σ par × S&P recovery rate, ' + c0 + ' column', S1, 'usd', [LN.total('Numerator: recovery value at the ' + c0 + ' rates', S1, 'sum of the last column'), LN.note('Each rated class is tested against its own column; the table shows every column.')].concat(defNote, res), [T]);
        den = part('Par of performing collateral', apb, 'usd', [parLine].concat(defNote, res), [T]);
      }
      if (num) quality[q.id] = { num, den };
    }
    TC.quality = quality;

    // Portfolio Profile Test
    const FL = { payFreq: 'Pays', revolver: 'Revolver', rateType: 'Rate type', assetType: 'Asset type', participation: 'Participation', country: 'Country', ccc: 'CCC', dip: 'DIP loan', currentPay: 'Current pay', pik: 'PIK', facilitySize: 'Facility size', zeroCoupon: 'Zero coupon', covLite: 'Cov-lite', synthetic: 'Synthetic', matAfterStated: 'Matures after Stated Maturity', spIndustry: 'S&P industry', mIndustry: "Moody's industry", obligor: 'Obligor', discount: 'Discount', defaulted: 'Defaulted' };
    const BOOL = ['revolver', 'participation', 'ccc', 'dip', 'currentPay', 'pik', 'zeroCoupon', 'covLite', 'synthetic', 'matAfterStated', 'discount', 'defaulted'];
    const fCol = f => f === 'facilitySize' ? ['Facility size', 'usd', r => r.facilitySize] : f === 'matAfterStated' ? ['Maturity', 'text', r => r.maturity] : f === 'ccc' ? ["Moody's DPR / S&P", 'text', r => r.moodysDPR + ' / ' + r.spRating] : [FL[f] || f, BOOL.includes(f) ? 'yn' : 'text', r => r[f]];
    const fText = c => (c.filter || []).map(x => (FL[x.f] || x.f) + (x.in ? ' is ' + x.in.join(' or ') : x.notIn ? ' is not ' + x.notIn.join(' or ') : x.eq !== undefined ? (x.eq ? ' = yes' : ' = no') : x.lt !== undefined ? ' below ' + (x.f === 'facilitySize' ? fmt2(x.lt) : x.lt) : x.gt !== undefined ? ' above ' + x.gt : '')).join(' and ');
    const allT = TB('All collateral', [cID, cOb, cTy, ['Country', 'text', r => r.country], cPar, ['Share of PCV', 'pct4', r => r.par / pcvGen * 100]], rows.slice().sort((a, b) => b.par - a.par), 'Principal Proceeds of ' + fmt2(principalCash) + ' are added to the par of the collateral.');
    const denConc = part('Principal Collateral Value at par', pcvGen, 'usd', [LN.row('Aggregate par of the collateral', 'sum of the Par column, ' + rows.length + ' positions', pb.parTotal), LN.row('Plus: Principal Proceeds on deposit', '', principalCash), LN.total('Denominator', pcvGen, fmt2(pb.parTotal) + ' + ' + fmt2(principalCash))], [allT]);
    const conc = {};
    for (const c of result.conc) {
      const t = (spec.concentrations || []).find(x => x.id === c.id) || {}; let num;
      const chk = (val, lim, op) => LN.check('Limit ' + (op === '>=' ? '≥ ' : '≤ ') + fpct(lim, 2), P4(val) + ((op === '>=' ? val >= lim - 1e-9 : val <= lim + 1e-9) ? ' passes' : ' fails'), op === '>=' ? val >= lim - 1e-9 : val <= lim + 1e-9);
      if (t.metric === 'maxObligor' || t.metric === 'maxIndustry' || t.metric === 'maxByField') {
        const field = t.metric === 'maxObligor' ? 'obligor' : (t.field || (t.metric === 'maxIndustry' ? 'spIndustry' : 'country'));
        const g = {}; for (const x of rows) { const k = x[field]; if (t.within && !t.within.includes(k)) continue; (g[k] = g[k] || { k, par: 0, n: 0 }).par += x.par; g[k].n++; }
        const arr = Object.values(g).sort((a, b) => b.par - a.par); const ex = t.exceptions;
        arr.forEach((e, i) => { e.pct = e.par / pcvGen * 100; e.lim = ex && i < ex.count ? ex.limit : t.limit; e.pass = e.pct <= e.lim + 1e-9; });
        const top = arr[0] || { k: '—', par: 0, pct: 0 }; const inTop = rows.filter(x => x[field] === top.k);
        const gName = FL[field] || field;
        const res = [LN.head('Result'), LN.row('Largest ' + gName.toLowerCase() + ', ' + top.k, fmt2(top.par) + ' ÷ ' + fmt2(pcvGen), P4(top.pct))];
        if (ex) res.push(LN.note('Up to ' + ex.count + ' may each reach ' + ex.limit + '%; the rest are limited to ' + t.limit + '%. The table checks each against the limit that applies to its rank.'));
        res.push(LN.check(c.pass ? 'Every ' + gName.toLowerCase() + ' within its limit' : 'At least one ' + gName.toLowerCase() + ' over its limit', arr.filter(e => !e.pass).map(e => e.k).join(', ') || 'none over', c.pass));
        const GT = TB('By ' + gName.toLowerCase() + (t.within ? ' (' + t.within.join(', ') + ' only)' : ''), [[gName, 'text', e => e.k], ['Positions', 'num0', e => e.n, true], ['Par', 'usd', e => e.par, true], ['Share of PCV', 'pct4', e => e.pct], ['Limit that applies', 'pct2', e => e.lim], ['Within', 'yn', e => e.pass]], arr);
        num = part('Par of the largest ' + gName.toLowerCase() + ': ' + top.k, top.par, 'usd', [LN.total('Numerator', top.par, 'sum of the Par column in the second table')].concat(res), [GT, TB('Positions of ' + top.k, [cID, cOb, cTy, ['Country', 'text', r => r.country], ["S&P industry", 'text', r => r.spIndustry], cPar], inTop.sort((a, b) => b.par - a.par))]);
        conc[c.id] = { num, den: withResult(denConc, res) };
      } else {
        const m = rows.filter(x => rowMatches(x, t.filter)).sort((a, b) => b.par - a.par); const mPar = sum(m, x => x.par);
        const cashOk = t.cashAs && rowMatches(Object.assign({ assetType: 'SSL', rateType: 'FLOAT', country: 'US' }, t.cashAs), t.filter);
        const amt = mPar + (cashOk ? principalCash : 0);
        const L = [LN.row('Par of collateral where ' + (fText(t) || 'the clause applies'), 'sum of the Par column, ' + m.length + ' positions', mPar)];
        if (cashOk) L.push(LN.row('Plus: Principal Proceeds, counted as the clause directs', '', principalCash));
        L.push(LN.total('Numerator', amt, cashOk ? fmt2(mPar) + ' + ' + fmt2(principalCash) : ''));
        if (c.missing) L.push(LN.note(c.note));
        const res = [LN.head('Result'), LN.row('Share of Principal Collateral Value', fmt2(amt) + ' ÷ ' + fmt2(pcvGen), P4(c.value)), chk(c.value, c.limit, c.op)];
        const extra = []; (t.filter || []).forEach(x => { if (!['assetType'].includes(x.f) && !extra.some(e => e[0] === fCol(x.f)[0])) extra.push(fCol(x.f)); });
        const MT = TB('Collateral counted', [cID, cOb, cTy].concat(extra, [cPar, ['Share of PCV', 'pct4', r => r.par / pcvGen * 100, true]]), m, m.length ? '' : 'No collateral meets this clause.');
        num = part('Par of collateral counted under ' + c.id, amt, 'usd', L.concat(res), [MT]);
        conc[c.id] = { num, den: withResult(denConc, res) };
      }
    }
    TC.conc = conc;
    result.testCalc = TC;
  } catch (err) { result.testCalc = null; warnings.push('The working behind the test figures could not be built: ' + plainError(err)); }
  return result;
}

function fmt2(x) { const v = Math.abs(x) < 0.005 ? 0 : x; return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fpct(x, d) { d = d == null ? 5 : d; let s = (+x).toFixed(d); if (s.indexOf('.') >= 0) { s = s.replace(/0+$/, ''); if ((s.split('.')[1] || '').length < 2) s = (+x).toFixed(2); } return s + '%'; }
function fratio(x) { return x === Infinity ? 'n/m (no notes outstanding)' : x.toFixed(4) + '%'; }
function money(x) { const a = Math.abs(x); const s = a >= 1e6 ? '$' + (a / 1e6).toFixed(2) + 'm' : a >= 1e3 ? '$' + (a / 1e3).toFixed(1) + 'k' : '$' + a.toFixed(0); return (x < 0 ? '−' : '') + s; }

// ---------- spec validation (for interpreted deals)
const KNOWN_TYPES = ['none', 'expense', 'fees', 'interest', 'cure', 'cureAll', 'rcf', 'specialRedemption', 'subMgmtFee', 'reinvestmentDiversion', 'unpaidFrom', 'reinvest', 'amortize', 'interestAndPrincipal', 'principal', 'equityHurdle', 'incentiveSplit'];
function validateSpec(s) {
  const errs = [], warns = [];
  if (!s || typeof s !== 'object') return { errs: ['Spec is not an object'], warns };
  if (!s.meta) errs.push('meta is missing');
  else ['closingDate', 'firstPaymentDate', 'statedMaturity', 'reinvestmentPeriodEnd'].forEach(k => { if (!s.meta[k] || isNaN(D(s.meta[k]))) errs.push('meta.' + k + ' must be a yyyy-mm-dd date'); });
  if (!Array.isArray(s.classes) || !s.classes.length) errs.push('classes must list the rated notes');
  const ids = (s.classes || []).map(c => c.id);
  (s.classes || []).forEach(c => { if (!(c.balance > 0)) errs.push('Class ' + c.id + ' needs a balance'); if (c.spread == null) warns.push('Class ' + c.id + ' has no spread'); });
  if (!s.equity) errs.push('equity (subordinated notes) is missing');
  if (!s.coverage || !Array.isArray(s.coverage.tests)) errs.push('coverage.tests is missing');
  else s.coverage.tests.forEach(t => { (t.oc && t.oc.classes || []).forEach(c => { if (!ids.includes(c)) errs.push('Test ' + t.id + ' refers to unknown class ' + c); }); });
  if (!s.waterfalls || !Array.isArray(s.waterfalls.interest)) errs.push('waterfalls.interest is missing');
  ['interest', 'principal', 'liquidation'].forEach(k => (s.waterfalls && s.waterfalls[k] || []).forEach(st => {
    if (!KNOWN_TYPES.includes(st.type)) warns.push(k + ' step ' + st.id + ' has unsupported type "' + st.type + '" and will be skipped');
    (st.paydown || []).concat(st.classes || []).forEach(c => { if (!ids.includes(c)) errs.push(k + ' step ' + st.id + ' refers to unknown class ' + c); });
    if (st.type === 'cure' && !(s.coverage && s.coverage.tests || []).some(t => t.id === st.test)) errs.push(k + ' step ' + st.id + ' cures unknown test ' + st.test);
  }));
  ['recovery', 'ratingFactors', 'haircuts', 'fees'].forEach(k => { if (!s[k]) errs.push(k + ' is missing'); });
  if (s.equity && !(+s.equity.balance > 0)) errs.push('equity.balance (the Subordinated Notes issue amount) is missing');
  const arr = x => Array.isArray(x) && x.length > 0;
  (s.coverage && Array.isArray(s.coverage.tests) ? s.coverage.tests : []).forEach(t => {
    if (!t.oc || !arr(t.oc.classes) || !(+t.oc.trigger > 0)) errs.push('Coverage test ' + t.id + ' needs oc.classes and oc.trigger');
    if (t.ic && (!arr(t.ic.classes) || !(+t.ic.trigger > 0))) errs.push('Coverage test ' + t.id + ' has an ic block without classes and trigger');
    (t.ic && t.ic.classes || []).forEach(c => { if (!ids.includes(c)) errs.push('Test ' + t.id + ' refers to unknown class ' + c); });
  });
  const rt = s.coverage && s.coverage.reinvestmentTest;
  if (rt) { if (!arr(rt.ocClasses) || !(+rt.trigger > 0)) warns.push('coverage.reinvestmentTest needs ocClasses and trigger; without them no interest is diverted'); else rt.ocClasses.forEach(c => { if (!ids.includes(c)) errs.push('coverage.reinvestmentTest refers to unknown class ' + c); }); }
  const needs = STEP_NEEDS;
  ['interest', 'principal', 'liquidation'].forEach(k => (s.waterfalls && s.waterfalls[k] || []).forEach(st => {
    (needs[st.type] || []).forEach(f => { if (!arr(st[f])) errs.push(k + ' step ' + st.id + ' (' + st.type + ') needs a non-empty "' + f + '" list'); });
    if (st.type === 'expense' && !st.item && !arr(st.items)) errs.push(k + ' step ' + st.id + ' (expense) needs "item"');
    if (st.type === 'interestAndPrincipal' && !ids.includes(st.class)) errs.push(k + ' step ' + st.id + ' (interestAndPrincipal) needs "class" set to a rated class');
    if (st.type === 'cureAll') (st.tests || []).forEach(t => { if (!(s.coverage && s.coverage.tests || []).some(x => x.id === t)) errs.push(k + ' step ' + st.id + ' cures unknown test ' + t); });
    if (st.type === 'subMgmtFee' && !(s.fees && s.fees.subMgmt)) warns.push(k + ' step ' + st.id + ' pays the Subordinated Management Fee, but fees.subMgmt is missing: nothing will be due');
    if ((st.type === 'equityHurdle' || st.type === 'incentiveSplit') && !(s.fees && s.fees.incentive)) warns.push(k + ' step ' + st.id + ' uses the incentive fee hurdle, but fees.incentive is missing: no hurdle is applied');
    if (st.type === 'reinvestmentDiversion' && !rt) warns.push(k + ' step ' + st.id + ' diverts interest under the Interest Reinvestment Test, but coverage.reinvestmentTest is missing: nothing is diverted');
  }));
  const hc = s.haircuts || {};
  if (s.haircuts) {
    if (!hc.ccc || !hc.ccc.moodysAtOrBelow || !hc.ccc.spAtOrBelow || !(hc.ccc.limitPct >= 0) || !(hc.ccc.haircutPct >= 0)) errs.push('haircuts.ccc needs moodysAtOrBelow, spAtOrBelow, limitPct and haircutPct');
    if (!hc.defaulted || !(hc.defaulted.zeroAfterYears >= 0)) errs.push('haircuts.defaulted needs zeroAfterYears');
    ['loan', 'other'].forEach(k => { const d = hc.discount && hc.discount[k]; if (!d || !(d.atLeastB3 >= 0) || !(d.belowB3 >= 0)) errs.push('haircuts.discount.' + k + ' needs atLeastB3 and belowB3 prices'); });
  }
  const rc = s.recovery;
  if (rc) {
    ['SSL', 'NSSL', 'BOND'].forEach(k => { const t = rc.moodys && rc.moodys[k]; if (!t || ['-3', '-2', '-1', '0', '1', '2'].some(n => !(t[n] >= 0))) errs.push('recovery.moodys.' + k + ' needs rates for notches -3 to 2'); });
    if (!rc.sp || !arr(rc.sp.cols) || !rc.sp.table || !rc.sp.table['3'] || !rc.sp.defaultRecoveryRating) errs.push('recovery.sp needs cols, table (with row "3") and defaultRecoveryRating');
  }
  if (s.qualityTests && !Array.isArray(s.qualityTests)) errs.push('qualityTests must be a list');
  return { errs, warns };
}

const api = { plainError, run, schedule, analysePortfolio, principalBalances, qualityMetrics, validateSpec, normaliseRow, money, days, addMonths, D, iso, M_SCALE, S_SCALE, mIdx, sIdx, xirr, hurdleAmount, diversityScore, KNOWN_TYPES };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CLOEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
