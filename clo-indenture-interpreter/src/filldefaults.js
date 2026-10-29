// Fills anything a deal spec needs but the document did not give, with the standard values the built-in example uses.
// Each fill is noted in the assumptions and, when `filled` is passed, listed there so the reader can show it as a gap.
function fillDefaults(spec, filled) {
  const S = DATA.EXAMPLE_CLO; spec.assumptions = spec.assumptions || [];
  const SHOW = { "Moody's Rating Factors": "Moody's standard rating factor table", 'Recovery rate tables': "Moody's and S&P standard recovery tables", 'CCC Excess haircut': 'CCC limit ' + S.haircuts.ccc.limitPct + '% of par; excess carried at the lesser of ' + S.haircuts.ccc.haircutPct + '% and market value', 'Defaulted Security treatment': 'lesser of market value and recovery rate; zero after ' + S.haircuts.defaulted.zeroAfterYears + ' years', 'Discount Obligation thresholds': 'loans bought below ' + S.haircuts.discount.loan.atLeastB3 + '% of par (' + S.haircuts.discount.loan.belowB3 + '% if rated below B3)' };
  const note = k => { const t = k + ' not found in the document: standard values from the built-in example used. Check them against the document.'; if (!spec.assumptions.includes(t)) spec.assumptions.push(t); if (filled && !filled.some(f => f.field === k)) filled.push({ field: k, value: (SHOW[k.replace(/ \(.*\)$/, '')] || 'standard values') + ' (standard values, not read from the document)' }); };
  const obj = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!obj(spec.ratingFactors)) { spec.ratingFactors = clone(S.ratingFactors); note('Moody\'s Rating Factors'); }
  if (!obj(spec.recovery)) { spec.recovery = clone(S.recovery); note('Recovery rate tables'); }
  const R = spec.recovery; if (!obj(R.moodys)) R.moodys = {};
  ['SSL', 'NSSL', 'BOND'].forEach(k => { const t = R.moodys[k]; if (!obj(t) || ['-3', '-2', '-1', '0', '1', '2'].some(n => !(t[n] >= 0))) { R.moodys[k] = Object.assign({}, S.recovery.moodys[k], obj(t) ? t : {}); note('Moody\'s recovery rates (' + k + ')'); } });
  if (!obj(R.sp) || !Array.isArray(R.sp.cols) || !R.sp.cols.length || !obj(R.sp.table) || !R.sp.table['3']) { R.sp = clone(S.recovery.sp); note('S&P recovery rate table'); }
  else if (!obj(R.sp.defaultRecoveryRating)) { R.sp.defaultRecoveryRating = clone(S.recovery.sp.defaultRecoveryRating); note('S&P default recovery ratings'); }
  if (!obj(spec.haircuts)) spec.haircuts = {};
  const H = spec.haircuts;
  if (!obj(H.ccc) || !H.ccc.moodysAtOrBelow || !H.ccc.spAtOrBelow || !(H.ccc.limitPct >= 0) || !(H.ccc.haircutPct >= 0)) { H.ccc = Object.assign({}, S.haircuts.ccc, obj(H.ccc) ? H.ccc : {}); ['limitPct', 'haircutPct'].forEach(k => { if (!(H.ccc[k] >= 0)) H.ccc[k] = S.haircuts.ccc[k]; }); note('CCC Excess haircut'); }
  if (!obj(H.defaulted) || !(H.defaulted.zeroAfterYears >= 0)) { H.defaulted = Object.assign({}, S.haircuts.defaulted, obj(H.defaulted) ? H.defaulted : {}); if (!(H.defaulted.zeroAfterYears >= 0)) H.defaulted.zeroAfterYears = S.haircuts.defaulted.zeroAfterYears; note('Defaulted Security treatment'); }
  if (!obj(H.discount)) { H.discount = clone(S.haircuts.discount); note('Discount Obligation thresholds'); }
  ['loan', 'other'].forEach(k => { const d = H.discount[k]; if (!obj(d) || !(d.atLeastB3 >= 0) || !(d.belowB3 >= 0)) { H.discount[k] = clone(S.haircuts.discount[k]); note('Discount Obligation thresholds (' + k + ')'); } });
  spec.spreadRules = spec.spreadRules || { minWAS: 0, minWAC: 0, excessParSpread: false };
  spec.selections = spec.selections || {}; spec.qualityTests = Array.isArray(spec.qualityTests) ? spec.qualityTests : []; spec.concentrations = Array.isArray(spec.concentrations) ? spec.concentrations : [];
  spec.labels = Object.assign({}, S.labels, spec.labels || {});
  spec.fees = spec.fees || {};
  if (spec.meta) { if (!spec.meta.paymentDay && spec.meta.firstPaymentDate) spec.meta.paymentDay = +spec.meta.firstPaymentDate.slice(8, 10); if (!spec.meta.paymentFrequencyMonths) spec.meta.paymentFrequencyMonths = 3; if (!spec.meta.effectiveDate) spec.meta.effectiveDate = spec.meta.closingDate; }
  if (spec.waterfalls) ['interest', 'principal', 'liquidation'].forEach(k => (spec.waterfalls[k] || []).forEach(st => { if (st.when === 'always') delete st.when; }));
  if (spec.coverage && !spec.coverage.icNumeratorDeducts) spec.coverage.icNumeratorDeducts = [];
  return spec;
}
