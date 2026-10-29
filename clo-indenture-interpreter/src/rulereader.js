// ---- Rule-based reader: builds a deal spec from the document's own text, with no model.
// Every value it sets is logged in `found` with the page it came from; anything it could not find is
// left out or filled with a labelled default, and listed for review.
const RR_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const RR_MON = 'January|February|March|April|May|June|July|August|September|October|November|December';
const rrPad = n => String(n).padStart(2, '0');
const rrM = x => '$' + (x % 1e6 === 0 ? String(x / 1e6) : (x / 1e6).toFixed(3).replace(/0+$/, '')) + 'm';
const rrNum = s => +String(s).replace(/[^\d.]/g, '');
function rrJoin(pages) {
  const offs = []; let text = '';
  const tidy = p => p.replace(/[“”]/g, '"').replace(/"[ \t]*([^"\n]{1,120}?)[ \t]*"/g, '"$1"');
  pages.forEach(p => { offs.push(text.length); text += (isTocPage(p) ? ' '.repeat(p.length) : tidy(p).replace(/[‘’]/g, "'").replace(/ /g, ' ')) + '\n'; });
  const pageAt = k => { let lo = 0, hi = offs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= k) lo = mid; else hi = mid - 1; } return lo + 1; };
  return { text, pageAt, n: pages.length };
}
function rrDate(s, payDay) {
  if (!s) return null; let m;
  if ((m = s.match(new RegExp('(' + RR_MON + ')\\s+(\\d{1,2}),?\\s+(\\d{4})')))) return m[3] + '-' + rrPad(RR_MONTHS[m[1].toLowerCase()]) + '-' + rrPad(m[2]);
  if ((m = s.match(new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + RR_MON + '),?\\s+(\\d{4})')))) return m[3] + '-' + rrPad(RR_MONTHS[m[2].toLowerCase()]) + '-' + rrPad(m[1]);
  if ((m = s.match(new RegExp('(' + RR_MON + ')\\s+(\\d{4})')))) return m[2] + '-' + rrPad(RR_MONTHS[m[1].toLowerCase()]) + '-' + rrPad(payDay || 15);
  return null;
}
// A defined term: "Term": ..., "Term" means ..., Term ........ (summary), or (the "Term") inline
function rrDef(J, term, len, test, after) {
  len = len || 900; const T = J.text; const t = term.replace(/ /g, '\\s+');
  const tries = [new RegExp('"' + t + '"\\s*(?::|means|shall mean|has the meaning|will be|is)', 'i'), new RegExp('\\n\\s*' + t + '\\s*[:.]{1}\\s?\\.{2,}', 'i'), new RegExp('\\(\\s*(?:the|each,? a|each)\\s+"' + t + '"\\s*\\)', 'i'), new RegExp('"' + t + '"', 'i')];
  for (let k = 0; k < tries.length; k++) {
    const g = new RegExp(tries[k].source, 'gi'); let m;
    while ((m = g.exec(T))) {
      const s = k === 2 && !after ? T.slice(Math.max(0, m.index - len / 2), m.index + m[0].length + len / 2) : T.slice(m.index, m.index + len);
      if (/^\s*[^\n]*?\.{4,}\s*\d+\s*(?:\n|$)/.test(s.slice(0, 200)) && !/[a-z]{3,}[^\n]*\.{4,}\s*[A-Z][a-z]/.test(s.slice(0, 200))) continue; // index or contents line
      if (test && !test(s)) continue;
      return { s, page: J.pageAt(m.index), at: m.index };
    }
  }
  return null;
}
const rrPct = (s, re) => { const m = s && s.match(re || /(\d{1,3}(?:\.\d+)?)\s*%/); return m ? +m[1] : null; };
const rrMoney = s => { const m = s && s.match(/(?:U\.S\.)?\s?\$\s?([\d,]{4,}(?:\.\d+)?)/); return m ? rrNum(m[1]) : null; };

// ---- Lessons: what a person has taught the reader. A value lesson names the term a deal uses for a field, or the
// words just before its value (tried first on every document), or gives the value for one document. A clause lesson
// maps a phrase to a waterfall step type; a concentration lesson maps a phrase to a tape test.
const RR_FIELDS = [
  { key: 'seniorFee', group: 'Fees', label: 'Senior management fee', type: 'pct', eg: 'Base Management Fee', kw: /Fee/ },
  { key: 'subFee', group: 'Fees', label: 'Subordinated management fee', type: 'pct', eg: 'Subordinated Collateral Management Fee', kw: /Fee/ },
  { key: 'structFee', group: 'Fees', label: 'Structuring fee', type: 'pct', eg: 'Deferred Structuring Fee', kw: /Fee/ },
  { key: 'incentive', group: 'Fees', label: 'Incentive fee', type: 'incentive', eg: 'Incentive Collateral Management Fee', valueEg: '20% above a 12% IRR', kw: /Fee|Return|Hurdle/ },
  { key: 'adminCap', group: 'Fees', label: 'Administrative Expense Cap', type: 'cap', eg: 'Senior Expenses Cap', valueEg: '0.02% + $200,000 a year', kw: /Cap|Expense/ },
  { key: 'closing', group: 'Dates', label: 'Closing Date', type: 'date', eg: 'Issue Date', kw: /Date/ },
  { key: 'maturity', group: 'Dates', label: 'Stated Maturity', type: 'date', eg: 'Maturity Date', kw: /Maturity|Date/ },
  { key: 'rpEnd', group: 'Dates', label: 'Reinvestment Period ends', type: 'date', eg: 'Reinvestment Period', kw: /Period|Date/ },
  { key: 'nonCall', group: 'Dates', label: 'Non-call period ends', type: 'date', eg: 'Non-Call Period', kw: /Period|Call|Date/ },
  { key: 'effective', group: 'Dates', label: 'Effective Date', type: 'date', eg: 'Ramp-Up Completion Date', kw: /Date/ },
  { key: 'targetPar', group: 'Dates', label: 'Target Par', type: 'money', eg: 'Target Initial Par Amount', kw: /Par|Amount/ },
  { key: 'equity', group: 'Notes', label: 'Equity (subordinated notes or shares)', type: 'money', eg: 'Preferred Shares', kw: /Shares|Notes|Interests/ },
  { key: 'spread', group: 'Notes', label: 'Spread column of the notes table', type: 'label', eg: 'Margin', noValue: true },
  { key: 'ocTable', group: 'Coverage tests', label: 'OC trigger levels', type: 'table', eg: 'Required Par Value Ratio', kw: /Ratio|Test|Coverage|Overcollateral/, noValue: true },
  { key: 'icTable', group: 'Coverage tests', label: 'IC trigger levels', type: 'table', eg: 'Required Interest Coverage Ratio', kw: /Ratio|Test|Coverage/, noValue: true },
  { key: 'irt', group: 'Coverage tests', label: 'Interest diversion (reinvestment) test', type: 'pct', eg: 'Interest Diversion Test', kw: /Test|Diversion|Reinvestment/ },
  { key: 'eod', group: 'Coverage tests', label: 'Event of Default test', type: 'pct', eg: 'Event of Default Par Ratio', kw: /Default|Ratio/ },
  { key: 'ccc', group: 'Haircuts', label: 'CCC excess limit', type: 'pct', eg: 'Excess CCC Adjustment Amount', kw: /CCC|Caa|Excess/ },
  { key: 'warf', group: 'Quality tests', label: 'Maximum Weighted Average Rating Factor', type: 'num', eg: 'Maximum Rating Factor Test', kw: /Rating Factor|WARF/ },
  { key: 'was', group: 'Quality tests', label: 'Minimum Weighted Average Spread', type: 'pct', eg: 'Minimum Floating Spread Test', kw: /Spread/ },
  { key: 'wac', group: 'Quality tests', label: 'Minimum Weighted Average Coupon', type: 'pct', eg: 'Minimum Weighted Average Coupon Test', kw: /Coupon/ },
  { key: 'wal', group: 'Quality tests', label: 'Weighted Average Life', type: 'years', eg: 'Weighted Average Life Test', kw: /Life/ },
  { key: 'div', group: 'Quality tests', label: 'Minimum Diversity Score', type: 'num', eg: 'Diversity Test', kw: /Diversity/ },
  { key: 'mwarr', group: 'Quality tests', label: "Minimum Moody's Weighted Average Recovery Rate", type: 'pct', eg: "Moody's Recovery Rate Test", kw: /Recovery/ },
  { key: 'conc', group: 'Concentration limits', label: 'Concentration Limitations section', type: 'section', eg: 'Portfolio Criteria', kw: /Concentration|Criteria|Profile|Limitation|Eligib/, noValue: true }
];
const RR_CLAUSE_TYPES = [
  ['manual', 'An amount I enter by hand (Manual inputs tab)'], ['none', 'No payment: skip it'],
  ['expense:taxes', 'Taxes and governmental fees'], ['expense:admin', 'Administrative Expenses, capped'], ['expense:adminExcess', 'Administrative Expenses above the cap'],
  ['expense:hedge', 'Hedge payments'], ['expense:hedgeTermSenior', 'Hedge termination, senior'], ['expense:hedgeTermSub', 'Hedge termination, subordinated'], ['expense:revolverFunding', 'Unfunded commitments'],
  ['fees', 'Senior management fee'], ['subMgmtFee', 'Subordinated management fee'],
  ['interest', 'Interest on the classes the clause names'], ['principal', 'Principal of the classes the clause names'],
  ['cure', 'Coverage cure for the test the clause names'], ['cureAll', 'Coverage cure of every failing test'],
  ['amortize', 'Sequential paydown of the notes'], ['reinvest', 'Reinvest (during the Reinvestment Period)'], ['reinvestmentDiversion', 'Interest diversion (reinvestment test)'],
  ['equityHurdle', 'Remaining cash to the equity'], ['incentiveSplit', 'Residual split with the incentive fee']
];
const RR_CONC = {
  skip: ['Not a tape test: skip it'],
  ssl: ['Senior secured loans (minimum)', () => ({ filter: [{ f: 'assetType', in: ['SSL'] }], op: '>=', cashAs: { assetType: 'SSL' } })],
  obligor: ['Single obligor', c => ({ metric: 'maxObligor', exceptions: c.exO })],
  industry: ['Single industry', c => ({ metric: 'maxIndustry', field: /Moody/i.test(c.u) ? 'mIndustry' : 'spIndustry', exceptions: c.exO })],
  secondLien: ['Second lien', () => ({ filter: [{ f: 'assetType', in: ['2L'] }] })],
  unsecured: ['Unsecured', () => ({ filter: [{ f: 'assetType', in: ['UNSEC'] }] })],
  bonds: ['Bonds', () => ({ filter: [{ f: 'assetType', in: ['BOND'] }] })],
  fixed: ['Fixed rate', () => ({ filter: [{ f: 'rateType', in: ['FIXED'] }] })],
  dip: ['DIP loans', () => ({ filter: [{ f: 'dip', eq: true }] })],
  currentPay: ['Current pay obligations', () => ({ filter: [{ f: 'currentPay', eq: true }] })],
  covLite: ['Cov-lite loans', () => ({ filter: [{ f: 'covLite', eq: true }] })],
  revolver: ['Revolvers and delayed drawdowns', () => ({ filter: [{ f: 'revolver', eq: true }] })],
  participation: ['Participations', () => ({ filter: [{ f: 'participation', eq: true }] })],
  pik: ['PIK and deferring obligations', () => ({ filter: [{ f: 'pik', eq: true }] })],
  ccc: ['Caa1 / CCC+ and below', () => ({ filter: [{ f: 'ccc', eq: true }] })],
  payFreq: ['Pays less often than quarterly', () => ({ filter: [{ f: 'payFreq', in: ['S', 'A'] }] })],
  zeroCoupon: ['Zero coupon', () => ({ filter: [{ f: 'zeroCoupon', eq: true }] })],
  synthetic: ['Synthetic securities', () => ({ filter: [{ f: 'synthetic', eq: true }] })],
  nonUS: ['Non-US obligors', () => ({ filter: [{ f: 'country', notIn: ['US'] }] })],
  canada: ['Canadian obligors', () => ({ filter: [{ f: 'country', in: ['CA'] }] })]
};
const rrEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a phrase as a pattern: words in order, any spacing or quote marks between them
const rrWords = s => String(s || '').split(/[\s"“”'‘’]+/).filter(Boolean).map(rrEsc).join('[\\s"\'“”‘’]+');
const rrNorm = s => String(s || '').toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[^a-z0-9%$.]+/g, ' ').trim();
const rrHas = (text, phrase) => { const p = rrNorm(phrase); return p.length >= 4 && rrNorm(text).includes(p); };
function rrDocKey(pages, fileName) { let n = 0; for (const p of pages || []) n += p.length; return (fileName || 'document') + '|' + (pages || []).length + '|' + n; }
function rrLessons(L) {
  const str = (x, n) => typeof x === 'string' ? x.trim().slice(0, n || 200) : '';
  const o = { values: [], clauses: [], conc: [] }; if (!L || typeof L !== 'object') return o;
  (Array.isArray(L.values) ? L.values : []).forEach(x => { if (!x || !RR_FIELDS.some(f => f.key === x.field)) return; const v = { id: str(x.id, 40) || 'v' + Math.random().toString(36).slice(2, 9), field: x.field, term: str(x.term), phrase: str(x.phrase), value: str(x.value, 80), doc: str(x.doc, 300), from: str(x.from, 160), added: str(x.added, 30) };
    if ((v.term && v.term.replace(/\W/g, '').length >= 3) || (v.phrase && rrNorm(v.phrase).length >= 4) || (v.value && v.doc)) o.values.push(v); });
  (Array.isArray(L.clauses) ? L.clauses : []).forEach(x => { if (!x || !RR_CLAUSE_TYPES.some(t => t[0] === x.type) || rrNorm(x.phrase).length < 4) return; o.clauses.push({ id: str(x.id, 40) || 'c' + Math.random().toString(36).slice(2, 9), phrase: str(x.phrase), type: x.type, k: ['interest', 'principal', 'liquidation'].includes(x.k) ? x.k : 'any', override: !!x.override, from: str(x.from, 160), added: str(x.added, 30) }); });
  (Array.isArray(L.conc) ? L.conc : []).forEach(x => { if (!x || !RR_CONC[x.cat] || rrNorm(x.phrase).length < 4) return; o.conc.push({ id: str(x.id, 40) || 'k' + Math.random().toString(36).slice(2, 9), phrase: str(x.phrase), cat: x.cat, override: !!x.override, from: str(x.from, 160), added: str(x.added, 30) }); });
  return o;
}
// words just before a value: the window starts after them
function rrAfter(J, phrase, len, test) {
  const src = rrWords(phrase); if (!src) return null; const g = new RegExp(src, 'gi'); let m;
  while ((m = g.exec(J.text))) { const s = J.text.slice(m.index + m[0].length, m.index + m[0].length + (len || 600)); if (test && !test(s)) continue; return { s, page: J.pageAt(m.index), at: m.index }; }
  return null;
}
const rrParseMoney = s => { const m = String(s || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(bn|billion|b\b|mm|million|m\b|k\b|thousand)?/i); if (!m) return null; const u = (m[2] || '').toLowerCase(); return +m[1] * (/^(bn|billion|b)$/.test(u) ? 1e9 : /^(mm|million|m)$/.test(u) ? 1e6 : /^(k|thousand)$/.test(u) ? 1e3 : 1); };
const rrParseDate = s => { const t = String(s || '').trim(); const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return m[1] + '-' + rrPad(m[2]) + '-' + rrPad(m[3]); const d = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (d) return d[3] + '-' + rrPad(d[1]) + '-' + rrPad(d[2]); return rrDate(t); };
// check a value typed for one document; returns {ok, v} or {err}
function rrParseValue(field, s) {
  const f = RR_FIELDS.find(x => x.key === field); if (!f) return { err: 'Unknown item' }; const t = String(s || '').trim(); if (!t) return { err: 'Enter a value' };
  const pcs = [...t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m => +m[1]); const num = +(t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/) || [NaN])[0];
  switch (f.type) {
    case 'pct': return isFinite(num) && num > 0 && num < 1000 ? { ok: true, v: num } : { err: 'Enter a percentage, like 0.15%' };
    case 'num': return isFinite(num) && num > 0 ? { ok: true, v: num } : { err: 'Enter a number' };
    case 'years': return isFinite(num) && num > 0 && num < 40 ? { ok: true, v: num } : { err: 'Enter years, like 8' };
    case 'date': { const d = rrParseDate(t); return d ? { ok: true, v: d } : { err: 'Enter a date, like 2031-10-15 or October 15, 2031' }; }
    case 'money': { const v = rrParseMoney(t); return v && v >= 1000 ? { ok: true, v } : { err: 'Enter an amount, like $45,000,000 or 45m' }; }
    case 'incentive': return pcs.length >= 2 ? { ok: true, v: { share: pcs[0], hurdle: pcs[1] } } : { err: 'Enter the share and the hurdle, like 20% above a 12% IRR' };
    case 'cap': { const pc = pcs[0]; const mo = t.match(/\$\s?([\d,]+(?:\.\d+)?\s*(?:m|mm|k|million|thousand)?)/i); return pc != null && mo ? { ok: true, v: { pc, fixed: rrParseMoney(mo[1]), perQuarter: /quarter|payment date|period/i.test(t) } } : { err: 'Enter the percentage and the fixed amount, like 0.02% + $200,000 a year' }; }
  }
  return { err: 'This item takes a term, not a value' };
}

const RR_LOGKEY = { 'Fees|Senior management fee': 'seniorFee', 'Fees|Subordinated management fee': 'subFee', 'Fees|Structuring fee': 'structFee', 'Fees|Incentive fee': 'incentive', 'Fees|Administrative Expense Cap': 'adminCap', 'Dates|Closing Date': 'closing', 'Dates|Stated Maturity': 'maturity', 'Dates|Reinvestment Period ends': 'rpEnd', 'Dates|Non-call period ends': 'nonCall', 'Dates|Effective Date': 'effective', 'Dates|Target Par': 'targetPar', 'Coverage tests|OC and IC triggers': 'ocTable', 'Coverage tests|Event of Default test': 'eod', 'Haircuts|CCC Excess': 'ccc', 'Haircuts|CCC Excess limit': 'ccc', 'Concentration limits|Concentration Limitations': 'conc' };
function rrTeachKey(group, field) {
  if (RR_LOGKEY[group + '|' + field]) return RR_LOGKEY[group + '|' + field];
  if (group === 'Notes') return /^Class /.test(field) ? 'spread' : 'equity';
  if (group === 'Coverage tests') return / OC$/.test(field) ? 'ocTable' : / IC$/.test(field) ? 'icTable' : /Diversion limit/.test(field) ? null : 'irt';
  if (group === 'Quality tests') { const f = RR_FIELDS.find(x => x.label === field); return f ? f.key : null; }
  return null;
}
const RR_DONE = ['found', 'taught', 'entered'];
function readDealText(pages, fileName, lessons) {
  const J = rrJoin(pages); const T = J.text;
  const found = []; const assumptions = [];
  const LS = rrLessons(lessons); const docKey = rrDocKey(pages, fileName); const usedL = new Set(); const items = { clauses: [], conc: [] };
  const log = (group, field, value, page, how, snippet) => { how = how || 'found'; const teach = rrTeachKey(group, field);
    if (RR_DONE.includes(how)) for (let i = found.length - 1; i >= 0; i--) if (found[i].group === group && (how === 'entered' || !RR_DONE.includes(found[i].how)) && (found[i].field === field || (teach && found[i].teach === teach && !['spread', 'ocTable', 'icTable'].includes(teach)))) found.splice(i, 1);
    const e = { group, field, value, page, how, snippet: snippet ? String(snippet).replace(/\s+/g, ' ').trim().slice(0, 220) : '', teach }; found.push(e); return e; };
  // taught lookups come first; each returns a window like rrDef's, marked with the lesson it came from
  const taughtFor = key => LS.values.filter(x => x.field === key && (x.term || x.phrase));
  const tau = (key, len, test, after) => { for (const x of taughtFor(key)) { const d = x.term ? rrDef(J, rrWords(x.term), len, test, after) : rrAfter(J, x.phrase, len, test); if (d) { d.taught = x; usedL.add(x.id); return d; } } return null; };
  const hw = d => d && d.taught ? 'taught' : 'found';
  const anyRate = s => rrPct(s, /(\d{1,2}\.\d{1,4})\s*%/);
  const spec = { meta: { dayCount: 'Actual/360' }, classes: [], equity: null, labels: {}, fees: {}, coverage: { tests: [], icNumeratorDeducts: [] }, haircuts: {}, spreadRules: { minWAS: 0, minWAC: 0, excessParSpread: false }, selections: {}, qualityTests: [], concentrations: [], waterfalls: {}, assumptions };

  // ---- 1. the notes: column table ("Designation ... Principal Amount ... Spread"), else the cover lines
  const firstPart = T.slice(0, Math.min(T.length, Math.max(250000, T.length * 0.45)));
  let cls = null;
  const amtRe = /(?:Original|Initial)?\s*(?:Aggregate\s+)?Principal\s+Amount[^\n$]{0,60}/gi; let am;
  while (!cls && (am = amtRe.exec(firstPart))) {
    const after = T.slice(am.index + am[0].length, am.index + am[0].length + 2500);
    const toks = []; const g = /(?:U\.S\.)?\s?\$\s?([\d,]{6,})/g; let x, last = 0;
    while ((x = g.exec(after))) { const gap = after.slice(last, x.index); if (toks.length && !/^[\s\d()*†,]*$/.test(gap)) break; if (!toks.length && x.index > 200) break; toks.push(rrNum(x[1])); last = x.index + x[0].length; }
    if (toks.length < 2) continue;
    const before = T.slice(Math.max(0, am.index - 2500), am.index);
    const hk = Math.max(before.lastIndexOf('Designation'), before.lastIndexOf('Securities Offered'), before.lastIndexOf('Class\n'), before.lastIndexOf('Securities\n'));
    const seg = hk >= 0 ? before.slice(hk) : before.slice(-900);
    const parseNames = sg => { const out = []; const ng = /Class\s+([A-Z](?:-?[0-9A-Z]{1,3})?)\b((?:\s+(?:Senior|Mezzanine|Junior|Deferrable|Floating|Fixed|Rate|Secured|Notes|Loans|Debt|Note))*)|(Subordinated(?:\s+Notes)?|Preferred\s+Shares|Income\s+Notes)|^\s*([A-Z](?:-\d)?)\s*$/gm; let n;
      while ((n = ng.exec(sg))) out.push(n[1] ? { id: n[1], kind: /Loans/i.test(n[2] || '') ? 'Loans' : 'Notes', deferrable: /Deferrable/i.test(n[2] || '') } : n[3] ? { equity: true, name: n[3].replace(/\s+/g, ' ') } : { id: n[4], kind: 'Notes' }); return out; };
    let names = parseNames(seg);
    // the class names can sit just above the column heading ("Class A Notes ... Subordinated Notes / Class Designation / Original Principal Amount")
    if (names.length !== toks.length && hk >= 0) { const alt = parseNames(before.slice(Math.max(0, hk - 700), hk)); if (alt.length >= toks.length && alt.slice(-toks.length).filter(x => x.equity).length <= 1) names = alt.slice(alt.length - toks.length); }
    if (names.length !== toks.length) continue;
    cls = names.map((c, i) => Object.assign({}, c, { balance: toks[i] }));
    cls.page = J.pageAt(am.index); cls.tail = T.slice(am.index, am.index + 6000); cls.how = 'notes table';
  }
  if (!cls) { // one row per class: "Class A-1 Notes" ... $296,750,000 ... LIBOR plus 1.02%
    const g = /"?(?:Class\s+([A-Z](?:-?[0-9A-Z]{1,3})?)\s+(Notes|Loans)|(Subordinated Notes|Preferred Shares|Income Notes))"?[^$]{0,400}?(?:U\.S\.)?\$\s?([\d,]{6,})/g; let m, run = [], lastEnd = -1;
    const H = T.slice(0, Math.min(T.length, 120000));
    while ((m = g.exec(H))) {
      if (run.length && m.index - lastEnd > 3000) { if (run.length >= 2) break; run = []; }
      const rest = H.slice(m.index + m[0].length, m.index + m[0].length + 300); const rt = rest.match(/(?:LIBOR|SOFR|EURIBOR|Benchmark|Reference Rate)\s*(?:\+|plus)\s*(\d{1,2}\.\d{1,4})\s*%|^[^%"]{0,80}?(\d{1,2}\.\d{1,4})\s*%/);
      run.push(m[1] ? { id: m[1], kind: m[2], deferrable: /Deferrable/i.test(m[0]), balance: rrNum(m[4]), rate: rt ? +(rt[1] || rt[2]) : null, at: m.index } : { equity: true, name: m[3], balance: rrNum(m[4]), at: m.index }); lastEnd = m.index + m[0].length;
    }
    if (run.length >= 2 && run.some(x => !x.equity)) { const seen = new Set(); cls = run.filter(x => { const k = x.equity ? 'EQ' : x.id + x.kind; if (seen.has(k)) return false; seen.add(k); return true; }); cls.page = J.pageAt(run[0].at); cls.tail = H.slice(run[0].at, run[run.length - 1].at + 600); cls.how = 'notes rows'; cls.rowRates = cls.filter(x => !x.equity).map(x => x.rate); }
  }
  if (!cls) { // cover page: U.S.$300,000,000 Class A Senior Notes Due 2021
    const L = []; const g = /U\.S\.\s?\$\s?([\d,]{6,})\s+(?:Class\s+([A-Z](?:-?[0-9A-Z]{1,3})?)\b([^\n]{0,80}?)(Notes|Loans)|(Subordinated Notes|Preferred Shares|Income Notes))/g; let m;
    const head = T.slice(0, 40000);
    while ((m = g.exec(head))) { if (m[2]) L.push({ id: m[2], kind: m[4], deferrable: /Deferrable/i.test(m[3]), balance: rrNum(m[1]) }); else L.push({ equity: true, name: m[5], balance: rrNum(m[1]) }); }
    if (L.length >= 2) { cls = L; cls.page = J.pageAt(head.search(/U\.S\.\s?\$/)); cls.tail = T.slice(0, 120000); cls.how = 'cover page'; }
  }
  if (cls) {
    const ids = {}; cls.filter(c => !c.equity).forEach(c => { let id = c.id; if (ids[id]) { id = c.id + (c.kind === 'Loans' ? 'L' : 'N'); } ids[id] = 1; c.uid = id; });
    // spreads, in the same column order
    const tail = cls.tail; const rated = cls.filter(c => !c.equity);
    const labs = [/Spread\/Coupon/, /\bSpread\b/, /Interest\s+Rate[^\n]{0,4}\n(?!\s*Index)/, /\bCoupon\b/].map(re => tail.search(re)).filter(i => i >= 0 && i < 4500).sort((a, b) => a - b);
    let rates = [], ratesTaught = null;
    const grab = lab => { const got = []; const g = /((?:LIBOR|SOFR|Term SOFR|EURIBOR|Benchmark|Reference Rate|Index)\s*(?:\+|plus)\s*)?(\d{1,2}\.\d{1,4})\s*%|N\/A|None/g; g.lastIndex = lab; let m; while ((m = g.exec(tail)) && got.length < cls.length) { if (m.index - lab > 1200) break; got.push(m[2] ? +m[2] : null); } return got; };
    for (const x of taughtFor('spread')) { const i = tail.search(new RegExp(rrWords(x.term || x.phrase), 'i')); if (i < 0 || i > 4500) continue; const got = grab(i); if (got.filter(v => v != null).length >= rated.length) { rates = got; ratesTaught = x; usedL.add(x.id); break; } }
    if (!ratesTaught) for (const lab of labs) { const got = grab(lab);
      if (got.filter(x => x != null).length >= rated.length) { rates = got; break; } }
    if (ratesTaught) rates = rates.filter((x, i) => !(cls[i] && cls[i].equity));
    else if (cls.rowRates && cls.rowRates.every(x => x != null)) rates = cls.rowRates;
    else if (rates.filter(x => x != null).length < rated.length) { // OM style: LIBOR + 0.25% anywhere in sequence
      const g = /(?:LIBOR|SOFR|EURIBOR|Benchmark)\s*\+\s*(\d{1,2}\.\d{1,4})\s*%/g; const seq = []; let m, prev = -1; const H = T.slice(0, 200000);
      while ((m = g.exec(H))) { if (prev >= 0 && m.index - prev > 400) { if (seq.length >= rated.length) break; seq.length = 0; } seq.push(+m[1]); prev = m.index + m[0].length; }
      if (seq.length >= rated.length) rates = seq.slice(0, rated.length);
    } else rates = rates.filter((x, i) => !(cls[i] && cls[i].equity));
    const fixedRow = tail.match(/Fixed\s+Rate(?:\s+Notes?)?\s*\n((?:\s*(?:Yes|No|N\/A)\s*\n?){2,})/);
    const fixedFlags = fixedRow ? fixedRow[1].trim().split(/\s+/) : [];
    const defRow = tail.match(/(?:Interest\s+)?[Dd]eferrable\s*\n?((?:\s*(?:Yes|No|N\/A)\s*\n?){2,})/);
    const defFlags = defRow ? defRow[1].trim().split(/\s+/) : [];
    rated.forEach((c, i) => {
      const fx = fixedFlags[i] === 'Yes';
      const sp = rates[i];
      const o = { id: c.uid, name: 'Class ' + c.id + ' ' + c.kind, balance: c.balance, spread: fx ? 0 : (sp != null ? sp : null), deferrable: c.deferrable || defFlags[i] === 'Yes', ref: 'p. ' + cls.page };
      if (fx && sp != null) o.fixedRate = sp;
      spec.classes.push(o);
      log('Notes', 'Class ' + c.uid, rrM(c.balance) + (fx ? ', fixed ' + sp + '%' : sp != null ? ', spread ' + sp + '%' : ', spread not found'), cls.page, sp != null ? (ratesTaught ? 'taught' : 'found') : 'missing');
    });
    const eq = cls.find(c => c.equity);
    if (eq) { spec.equity = { id: 'SUB', name: eq.name.replace(/^Subordinated$/, 'Subordinated Notes'), balance: eq.balance, ref: 'p. ' + cls.page }; log('Notes', spec.equity.name, rrM(eq.balance), cls.page); }
  }
  if (!spec.equity) {
    const m = T.slice(0, 300000).match(/U\.S\.\s?\$\s?([\d,]{6,})\s+(?:aggregate\s+(?:principal|notional)\s+amount\s+of\s+)?(Subordinated Notes|Preferred Shares|Income Notes)/);
    if (m) { spec.equity = { id: 'SUB', name: m[2], balance: rrNum(m[1]), ref: 'p. ' + J.pageAt(T.indexOf(m[0])) }; log('Notes', m[2], rrM(rrNum(m[1])), J.pageAt(T.indexOf(m[0]))); }
  }
  if (!spec.equity) for (const x of taughtFor('equity')) { // a taught name for the equity, with its amount nearby
    const w = rrWords(x.term || x.phrase); const m = x.term ? (T.match(new RegExp('(?:U\\.S\\.)?\\s?\\$\\s?([\\d,]{6,})[^$\\n]{0,80}?' + w, 'i')) || T.match(new RegExp(w + '"?[^$]{0,300}?(?:U\\.S\\.)?\\$\\s?([\\d,]{6,})', 'i'))) : T.match(new RegExp(w + '[^$]{0,120}?(?:U\\.S\\.)?\\$\\s?([\\d,]{6,})', 'i'));
    if (m && rrNum(m[1]) >= 1e5) { const pg = J.pageAt(m.index); const nm = x.term ? x.term.replace(/^the\s+/i, '') : 'Subordinated Notes'; spec.equity = { id: 'SUB', name: nm, balance: rrNum(m[1]), ref: 'p. ' + pg }; usedL.add(x.id); log('Notes', nm, rrM(rrNum(m[1])), pg, 'taught', m[0]); break; }
  }
  const classIds = spec.classes.map(c => c.id);
  // deferrable classes named in the text ("Class C Deferred Interest", "Deferred Interest on the Class D Notes")
  spec.classes.forEach(c => { if (!c.deferrable) { const b = c.id.replace(/[LN]$/, ''); if (new RegExp('Class\\s+' + b.replace('-', '\\-') + '(?:\\s+\\w+)?\\s+Deferred\\s+Interest|Deferred\\s+Interest\\s+(?:on|with respect to)\\s+(?:the\\s+)?Class\\s+' + b.replace('-', '\\-') + '\\b').test(T)) c.deferrable = true; } });

  // class references in text -> class ids
  const refIdx = ref => { const r = ref.replace(/\s+/g, ''); const out = []; spec.classes.forEach((c, i) => { const b = c.id.replace(/[LN]$/, ''); if (b === r || b.startsWith(r + '-') || (r.length === 1 && b[0] === r && /^[A-Z]-?\d/.test(b))) out.push(i); }); return out; };
  const classesIn = s => { const set = new Set(); const g = /Class(?:es)?\s+((?:[A-Z](?:-?[0-9A-Z]{1,3})?)(?:\s*(?:\/|,|and|or|&)\s*(?:the\s+)?(?:Class\s+)?[A-Z](?:-?[0-9A-Z]{1,3})?\b)*)/g; let m; while ((m = g.exec(s))) m[1].split(/\s*(?:\/|,|and|or|&)\s*(?:the\s+)?(?:Class\s+)?/).forEach(r => refIdx(r.trim()).forEach(i => set.add(i))); return [...set].sort((a, b) => a - b); };

  // ---- 2. dates and amounts
  const pd = (() => { const m = T.match(new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+day\\s+of\\s+((?:(?:' + RR_MON + ')\\s*,?\\s*(?:and\\s+)?){3,4})(?:of\\s+each\\s+year)?[\\s\\S]{0,300}?commencing\\s+(?:on\\s+the\\s+Payment\\s+Date\\s+)?(?:in\\s+)?(' + RR_MON + ')\\s*(\\d{1,2},?\\s*)?(\\d{4})', 'i')); return m ? { day: +m[1], first: m[5] + '-' + rrPad(RR_MONTHS[m[3].toLowerCase()]) + '-' + rrPad(m[1]), page: J.pageAt(T.indexOf(m[0])), s: m[0] } : null; })();
  if (pd) { spec.meta.paymentDay = pd.day; spec.meta.firstPaymentDate = pd.first; spec.meta.paymentFrequencyMonths = 3; log('Dates', 'First Payment Date', pd.first + ' (day ' + pd.day + ', quarterly)', pd.page, 'found', pd.s); }
  const yr = d => +String(d || '').slice(0, 4);
  const sane = (field, v) => { const c = spec.meta.closingDate; if (!v || !c || field === 'Closing Date' || field === 'Effective Date') return !!v; const dy = yr(v) - yr(c); return field === 'Stated Maturity' ? dy >= 4 && dy <= 40 : dy >= 0 && dy <= 15 && v >= c; };
  const dateOf = (field, term, pick, key) => { const pred = s => sane(field, rrDate(pick ? pick(s) : s, spec.meta.paymentDay)); const d = (key && tau(key, 700, pred)) || (term && rrDef(J, term, 700, pred)); const v = d && rrDate(pick ? pick(d.s) : d.s, spec.meta.paymentDay); if (v) { log('Dates', field, v, d.page, hw(d), d.s.slice(0, 200)); return v; } return null; };
  spec.meta.closingDate = dateOf('Closing Date', 'Closing Date', null, 'closing') || (() => { const m = T.slice(0, 20000).match(new RegExp('(?:Dated\\s+as\\s+of|dated|on or about)\\s+(' + RR_MON + '\\s+\\d{1,2},?\\s+\\d{4})', 'i')); if (m) { const v = rrDate(m[1]); log('Dates', 'Closing Date', v, J.pageAt(T.indexOf(m[0])), 'found', m[0]); return v; } return null; })();
  const smRow = cls && cls.tail ? cls.tail.match(new RegExp('Stated\\s+Maturity\\d?\\s*\\n?\\s*((?:Payment\\s+Date\\s+in\\s+)?(?:' + RR_MON + ')(?:\\s+\\d{1,2},)?\\s+\\d{4})', 'i')) : null;
  const pickMat = s => (s.match(new RegExp('Payment\\s+Date\\s+(?:occurring\\s+)?in\\s+(?:' + RR_MON + ')\\s+\\d{4}')) || [s])[0];
  spec.meta.statedMaturity = dateOf('Stated Maturity', null, pickMat, 'maturity') || (smRow ? (log('Dates', 'Stated Maturity', rrDate(smRow[1], spec.meta.paymentDay), cls.page, 'found', smRow[0]), rrDate(smRow[1], spec.meta.paymentDay)) : (dateOf('Stated Maturity', 'Stated Maturity', s => (s.match(new RegExp('Payment\\s+Date\\s+(?:occurring\\s+)?in\\s+(?:' + RR_MON + ')\\s+\\d{4}')) || [s])[0]) || (() => { const m = T.slice(0, 30000).match(/Notes\s+[Dd]ue\s+(\d{4})/); if (m && spec.meta.paymentDay && spec.meta.firstPaymentDate) { const mm = +spec.meta.firstPaymentDate.slice(5, 7); const v = m[1] + '-' + rrPad(mm) + '-' + rrPad(spec.meta.paymentDay); log('Dates', 'Stated Maturity', v, J.pageAt(T.indexOf(m[0])), 'estimated', m[0] + ' (month taken from the payment cycle)'); return v; } return null; })()));
  spec.meta.reinvestmentPeriodEnd = dateOf('Reinvestment Period ends', 'Reinvestment Period', s => (s.match(new RegExp('earli?est\\s+of[\\s\\S]{0,120}?(?:(?:Payment\\s+Date\\s+(?:occurring\\s+)?in\\s+)?(?:' + RR_MON + ')(?:\\s+\\d{1,2},)?\\s+\\d{4})')) || [s])[0], 'rpEnd');
  if (!spec.meta.reinvestmentPeriodEnd && spec.meta.closingDate) { spec.meta.reinvestmentPeriodEnd = spec.meta.closingDate; log('Dates', 'Reinvestment Period ends', 'none found: treated as a static deal (no reinvestment)', null, 'default'); assumptions.push('No Reinvestment Period found, so the deal is treated as static: principal is never reinvested.'); }
  spec.meta.nonCallEnd = dateOf('Non-call period ends', 'Non-Call Period', null, 'nonCall') || undefined;
  if (!spec.meta.nonCallEnd) log('Dates', 'Non-call period ends', 'not found', null, 'missing');
  spec.meta.effectiveDate = dateOf('Effective Date', 'Effective Date', s => (s.match(new RegExp('(?:earlier|earliest)\\s+of[\\s\\S]{0,80}?(' + RR_MON + ')\\s+\\d{1,2},?\\s+\\d{4}')) || [s])[0], 'effective') || spec.meta.closingDate;
  const tp = tau('targetPar', 300, s => (rrMoney(s) || 0) >= 1e6) || rrDef(J, 'Target (?:Initial )?Par Amount', 300) || rrDef(J, 'Target Par', 300);
  if (tp && rrMoney(tp.s)) { spec.meta.targetPar = rrMoney(tp.s); log('Dates', 'Target Par', rrM(spec.meta.targetPar), tp.page, hw(tp), tp.s); }
  else if (spec.classes.length) { spec.meta.targetPar = Math.round((sum(spec.classes, c => c.balance) + (spec.equity ? spec.equity.balance : 0)) / 1e5) * 1e5; log('Dates', 'Target Par', rrM(spec.meta.targetPar) + ' (sum of the notes)', null, 'default'); assumptions.push('Target Par not found; set to the total of the notes.'); }
  const idxCount = k => (T.slice(0, 400000).match(new RegExp('\\b' + k + '\\b', 'g')) || []).length;
  spec.meta.index = ['SOFR', 'LIBOR', 'EURIBOR'].map(k => [k, idxCount(k)]).sort((a, b) => b[1] - a[1])[0][0];
  const p1 = (pages[0] || '') + '\n' + (pages[1] || '');
  const head3 = pages.slice(0, 3).join('\n'); const asIssuer = head3.match(/(?:^|\n)\s*([A-Z][A-Za-z0-9&.'\- ]{2,60}?,?\s+(?:Ltd\.?|Limited|LLC|Inc\.|Designated Activity Company|DAC))\s*,?\s*(?:\n\s*)?as\s+(?:the\s+)?Issuer/);
  const nm = asIssuer ? [asIssuer[0], asIssuer[1]] : p1.match(/([A-Z][A-Za-z0-9&.,'\- ]{2,60}?(?:CLO|Ltd\.?|LLC|Limited|Funding)[A-Za-z0-9 .,\-]{0,25})/);
  spec.meta.name = (nm ? nm[1].replace(/\s+/g, ' ').replace(/[,\s]+$/, '') : (fileName || 'Deal').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  spec.meta.document = fileName || 'document'; spec.meta.paymentFrequencyMonths = spec.meta.paymentFrequencyMonths || 3;
  const mgr = T.slice(0, 60000).match(/([A-Z][A-Za-z0-9&.,' ]{3,60}?(?:LLC|L\.P\.|LP|Limited|Ltd\.|Inc\.))[^\n]{0,30}?(?:will act as|as)\s+(?:the\s+)?"?(?:Collateral|Investment|Portfolio)\s+Manager/);
  if (mgr) spec.meta.manager = mgr[1].trim();

  // ---- 3. fees
  const perAnnum = s => rrPct(s, /(\d{1,2}\.\d{1,4})\s*%\s*(?:per\s+annum|of the Fee Basis|of the Collateral|of the Aggregate)/i);
  const sfT = tau('seniorFee', 1600, x => anyRate(x) != null);
  const sf = sfT || rrDef(J, '(?:Senior|Base) (?:Collateral |Investment |Portfolio )?Management Fee', 900) || rrDef(J, '(?:Collateral|Investment|Portfolio) Management Fee', 900);
  const sf2 = sfT || rrDef(J, '(?:Senior|Base) (?:Collateral |Investment |Portfolio )?Management Fee', 900, s => perAnnum(s) != null) || rrDef(J, '(?:Collateral|Investment|Portfolio) Management Fee', 900, s => perAnnum(s) != null) || sf;
  if (sfT || (sf2 && perAnnum(sf2.s) != null)) {
    const W = sfT ? sfT.s : (rrDef(J, '(?:Senior|Base) (?:Collateral |Investment |Portfolio )?Management Fee', 1600, x => perAnnum(x) != null) || rrDef(J, '(?:Collateral|Investment|Portfolio) Management Fee', 1600, x => perAnnum(x) != null)).s;
    let rs = [...W.matchAll(/(\d{1,2}\.\d{1,4})\s*%\s*per\s+annum/gi)].map(m => +m[1]); if (!rs.length) rs = [anyRate(W)]; const sw = W.slice(0, 900).match(new RegExp('(?:Payment\\s+Date\\s+(?:occurring\\s+)?in\\s+)?(?:' + RR_MON + ')(?:\\s+\\d{1,2},)?\\s+\\d{4}'));
    const sched = rs.length >= 2 && rs[0] !== rs[1] && sw ? [{ through: rrDate(sw[0], spec.meta.paymentDay), bps: Math.round(rs[0] * 10000) / 100 }, { bps: Math.round(rs[1] * 10000) / 100 }] : [{ bps: Math.round(rs[0] * 10000) / 100 }];
    spec.fees.seniorMgmt = { label: 'Senior management fee', schedule: sched, ref: 'p. ' + sf2.page }; log('Fees', 'Senior management fee', sched.map(x => x.bps / 100 + '%' + (x.through ? ' a year to ' + x.through : ' a year' + (sched.length > 1 ? ' after' : ''))).join(', '), sf2.page, hw(sf2), sf2.s); }
  else log('Fees', 'Senior management fee', 'rate not stated in this document', sf && sf.page, 'missing');
  const stD = tau('structFee', 700, x => anyRate(x) != null) || rrDef(J, '(?:Senior )?(?:Deferred )?Structuring Fee', 700, x => perAnnum(x) != null);
  if (stD) { const r1 = stD.taught ? anyRate(stD.s) : perAnnum(stD.s); const until = stD.s.match(new RegExp('on\\s+or\\s+(?:prior\\s+to|before)\\s+the\\s+(?:Payment\\s+Date\\s+(?:occurring\\s+)?in\\s+)?(?:' + RR_MON + ')(?:\\s+\\d{1,2},)?\\s+\\d{4}'));
    const sched = until ? [{ through: rrDate(until[0], spec.meta.paymentDay), bps: Math.round(r1 * 10000) / 100 }, { bps: 0 }] : [{ bps: Math.round(r1 * 10000) / 100 }];
    spec.fees.structuring = { label: 'Structuring fee', schedule: sched, ref: 'p. ' + stD.page }; log('Fees', 'Structuring fee', r1 + '% a year' + (until ? ' to ' + sched[0].through + ', nothing after' : ''), stD.page, hw(stD), stD.s); }
  const ubT = tau('subFee', 900, x => anyRate(x) != null);
  const ub = ubT || rrDef(J, 'Subordinated (?:Collateral |Investment |Portfolio )?Management Fee', 900, s => perAnnum(s) != null) || rrDef(J, 'Subordinated (?:Collateral |Investment |Portfolio )?Management Fee', 900);
  const ubR = ub ? (ubT ? anyRate(ub.s) : perAnnum(ub.s)) : null;
  if (ub && ubR != null) { spec.fees.subMgmt = { label: 'Subordinated management fee', bps: Math.round(ubR * 100 * 100) / 100, ref: 'p. ' + ub.page }; log('Fees', 'Subordinated management fee', ubR + '% a year', ub.page, hw(ub), ub.s); }
  else log('Fees', 'Subordinated management fee', 'rate not stated in this document', ub && ub.page, 'missing');
  const icT = tau('incentive', 1200, s => /\d\s*%/.test(s));
  const ic = icT || rrDef(J, 'Incentive (?:Collateral |Investment |Portfolio )?(?:Management )?Fee', 1200) || rrDef(J, 'Investment Manager Incentive Fee Amount', 1200);
  const irr = (icT && (icT.s.match(/(?:Internal Rate of Return|IRR)[^%]{0,160}?(\d{1,2}(?:\.\d+)?)\s*%/i) || [])[1]) || (T.match(/Internal Rate of Return[^%]{0,160}?(?:of|equal to|at least)\s+(\d{1,2}(?:\.\d+)?)\s*%/) || T.match(/"(?:Target Return|Incentive (?:Management )?Fee Threshold)"[\s\S]{0,400}?(\d{1,2}(?:\.\d+)?)\s*%/) || [])[1];
  const share = ic ? rrPct(ic.s, /(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:any\s+|all\s+|such\s+)?(?:remaining|Interest Proceeds and Principal Proceeds|the remaining)/i) : null;
  if (irr && share) { spec.fees.incentive = { hurdleIRR: +irr, managerShare: share, dayBasis: 360, ref: 'p. ' + ic.page }; log('Fees', 'Incentive fee', share + '% of the residual above a ' + irr + '% IRR', ic.page, hw(ic), ic.s); }
  else if (irr || share) log('Fees', 'Incentive fee', 'partly found (' + (irr ? irr + '% hurdle' : share + '% share') + '); not modelled', ic && ic.page, 'missing');
  const capD = tau('adminCap', 1100, s => /\d\.\d{1,4}\s*%/.test(s) && /\$\s?[\d,]{5,}/.test(s)) || rrDef(J, 'Administrative Expense Cap', 1100);
  if (capD) { const pc = capD.taught ? rrPct(capD.s, /(\d\.\d{1,4})\s*%/) : rrPct(capD.s, /(\d\.\d{1,4})\s*%\s*per\s+annum/i); const fx = (capD.s.match(/(?:U\.S\.)?\s?\$\s?([\d,]{5,})\s*(?:per\s+annum)?/) || [])[1];
    if (pc != null && fx) { spec.fees.adminCap = { bpsOfPCV: Math.round(pc * 100 / 4 * 1000) / 1000, fixed: Math.round(rrNum(fx) / 4), priorPeriods: 0, ref: 'p. ' + capD.page }; log('Fees', 'Administrative Expense Cap', pc + '% a year of the collateral plus ' + rrM(rrNum(fx)) + ' a year, per quarter', capD.page, hw(capD), capD.s); assumptions.push('The Administrative Expense Cap is applied per Payment Date as a quarter of the annual percentage and fixed amount.'); }
    else log('Fees', 'Administrative Expense Cap', 'formula not recognised; expenses uncapped', capD.page, 'missing'); }

  // ---- 4. coverage tests
  const groups = new Map(); // tested level (class index) -> {oc, ic, label, page}
  const put = (classesRef, kind, pct, page, snippet, lesson) => {
    const idx = typeof classesRef === 'string' ? (/Secured Notes|Secured Debt|Rated Notes/i.test(classesRef) ? [spec.classes.length - 1] : classesIn(/Class/.test(classesRef) ? classesRef : 'Class ' + classesRef)) : classesRef;
    if (!idx.length || !(pct > 50 && pct < 400)) return; let lv = Math.max(...idx);
    const base = spec.classes[lv].id.replace(/[LN]$/, '').replace(/-\d+$/, ''); while (lv + 1 < spec.classes.length && spec.classes[lv + 1].id.replace(/[LN]$/, '').replace(/-\d+$/, '') === base) lv++; // pari passu siblings
    const g = groups.get(lv) || { lv, page };
    if (g[kind] == null) { g[kind] = pct; g[kind + 'Page'] = page; g[kind + 'Snip'] = snippet; if (lesson) { g[kind + 'How'] = 'taught'; usedL.add(lesson.id); } }
    groups.set(lv, g);
  };
  let lastTab = null;
  // a trigger table after a term: labels then percentages, "A 126.8%" rows, or "For the Class ..., 139.3%" items
  const readTab = tt => {
    const term = tt.term, kind = tt.kind; const m = { index: tt.at, 0: tt.len != null ? T.substr(tt.at, tt.len) : (T.slice(tt.at).match(new RegExp('^"?' + term + '"?')) || [''])[0] };
    const w = T.slice(m.index + m[0].length, m.index + m[0].length + 900); const page = J.pageAt(m.index); const name = tt.lesson ? (tt.lesson.term || tt.lesson.phrase) : term;
    // table: labels then percentages
    const t = w.match(/^\s*(?:\n|\|)?\s*((?:(?:Class\s+)?[A-Z](?:-\d)?(?:\/[A-Z])?\s*\n\s*){1,8})((?:\d{2,3}(?:\.\d+)?\s*%\s*\n?\s*){1,8})/);
    if (!t) { // rows: "A 126.8%" one per line
      const rows = [...w.slice(0, 400).matchAll(/(?:^|\n)\s*(?:Class\s+)?([A-Z](?:-\d)?(?:\/[A-Z](?:-\d)?)?)\s+(\d{2,3}(?:\.\d+)?)\s*%/g)];
      if (rows.length >= 1 && rows[0].index < 40) {
        let kk = kind; const labs = rows.map(x => x[1]);
        if (!tt.lesson && kk === 'oc' && lastTab && lastTab.kind === 'ic' && m.index - lastTab.end < 260 && labs.every(l => { const ix = classesIn('Class ' + l); return ix.length && [...groups.values()].some(g => g.oc != null && ix.includes(g.lv)); })) kk = 'ic';
        rows.forEach(x => put(x[1], kk, +x[2], page, name + ': ' + x[0].trim(), tt.lesson)); lastTab = { kind: kk, end: m.index + m[0].length + rows[rows.length - 1].index + rows[rows.length - 1][0].length };
        return;
      }
      // definition list: (a) For the Class A-1 Debt, the Class A-2 Notes and the Class B Notes, 139.3%
      const li = /(?:For|for)\s+the\s+((?:Class(?:(?!\bis\b|at\s+least|equal\s+to)[^%;"]){0,160}?)|Secured Notes|Secured Debt|Rated Notes),?\s*(\d{2,3}(?:\.\d+)?)\s*%/g; let x;
      while ((x = li.exec(w)) && x.index < 700) put(x[1].replace(/\bthe\b/g, ''), kind, +x[2], page, name + ': ' + x[0], tt.lesson);
      return;
    }
    const labs = t[1].trim().split(/\s*\n\s*/).map(s => s.replace(/^Class\s+/, '')); const pcs = t[2].trim().split(/\s*%\s*/).filter(Boolean).map(Number); labs.forEach((l, i) => { if (pcs[i] != null) put(l, kind, pcs[i], page, name + ' table: ' + l + ' ' + pcs[i] + '%', tt.lesson); });
  };
  { // taught terms for the trigger tables come first
    const taughtTab = []; for (const [key, kind] of [['ocTable', 'oc'], ['icTable', 'ic']]) for (const x of taughtFor(key)) { const src = rrWords(x.term || x.phrase); const g = new RegExp('"?' + src + '"?', 'gi'); let m; while ((m = g.exec(T))) taughtTab.push({ term: src, kind, at: m.index, len: m[0].length, lesson: x }); }
    taughtTab.sort((a, b) => a.at - b.at); taughtTab.forEach(readTab); lastTab = null;
  }
  { // sentences: "Class A/B Overcollateralization Test ... at least 111.80%"
    const g = /Class(?:es)?\s+([A-Z0-9][A-Z0-9/\-, ]*?(?:\s+and\s+(?:the\s+)?(?:Class\s+)?[A-Z0-9\-]+)?)\s+(?:Notes\s+)?(Overcollateralization|Over-collateralization|Par\s+Value|Interest\s+Coverage)\s+(?:Ratio\s+)?Test"?[^"]{0,420}?at\s+least\s+(?:equal\s+to\s+)?(\d{2,3}(?:\.\d+)?)\s*%/g; let m;
    while ((m = g.exec(T))) put(m[1], /Interest/.test(m[2]) ? 'ic' : 'oc', +m[3], J.pageAt(m.index), m[0]);
  }
  const tabTerms = [];
  for (const [term, kind] of [['Required (?:Overcollateralization|Over-collateralization|Par Value) Ratio', 'oc'], ['Required Interest Coverage Ratio', 'ic']]) { const g = new RegExp('"?' + term + '"?', 'g'); let m; while ((m = g.exec(T))) tabTerms.push({ term, kind, at: m.index }); }
  tabTerms.sort((a, b) => a.at - b.at); tabTerms.forEach(readTab);
  { const g = /(Overcollateralization Ratio Test|Par Value Test|Interest Coverage Test)\s*\n\s*((?:Class(?:es)?\s+)[^\n]{1,80}?)\s*\n\s*(?:[^\n]{0,60}\n\s*)?(\d{2,3}\.\d{1,3})\s*%?\s*\n/g; let m;
    while ((m = g.exec(T))) put(m[2], /Interest/.test(m[1]) ? 'ic' : 'oc', +m[3], J.pageAt(m.index), m[0]); }
  const icFrom = /Interest\s+Coverage\s+Test[\s\S]{0,500}?second\s+(?:Payment|Determination)\s+Date|second\s+(?:Payment|Determination)\s+Date[\s\S]{0,300}?Interest\s+Coverage/i.test(T) ? 2 : 1;
  [...groups.values()].sort((a, b) => a.lv - b.lv).forEach(g => {
    if (g.oc == null) return; const ids = spec.classes.slice(0, g.lv + 1).map(c => c.id); const top = spec.classes[g.lv].id.replace(/[LN]$/, '');
    const firstBase = spec.classes[0].id.replace(/[LN]$/, '').replace(/-\d+$/, ''); const lbBase = top.replace(/-\d+$/, '');
    const label = 'Class ' + (lbBase !== firstBase && g.lv > 0 && spec.classes.slice(0, g.lv).every(c => c.id.replace(/[LN]$/, '').replace(/-\d+$/, '') === firstBase) ? firstBase + '/' + lbBase : lbBase);
    const t = { id: label.replace(/^Class\s+/, '').replace(/[^A-Za-z0-9]/g, '') || ('T' + g.lv), label, oc: { classes: ids, trigger: g.oc, ref: 'p. ' + g.ocPage } };
    if (g.ic != null) t.ic = { classes: ids, trigger: g.ic, fromPeriod: icFrom, ref: 'p. ' + g.icPage };
    spec.coverage.tests.push(t);
    log('Coverage tests', label + ' OC', g.oc + '%', g.ocPage, g.ocHow || 'found', g.ocSnip); if (g.ic != null) log('Coverage tests', label + ' IC', g.ic + '% from Payment Date ' + icFrom, g.icPage, g.icHow || 'found', g.icSnip);
  });
  if (!spec.coverage.tests.length) log('Coverage tests', 'OC and IC triggers', 'not found', null, 'missing');
  const irtD = tau('irt', 800, s => rrPct(s, /(\d{2,3}(?:\.\d+)?)\s*%/) != null) || rrDef(J, '(?:Interest Diversion Test|Interest Reinvestment Test|Reinvestment Overcollateralization Test|Reinvestment Test)', 800);
  if (irtD) { const p = rrPct(irtD.s, /at\s+least\s+(?:equal\s+to\s+)?(\d{2,3}(?:\.\d+)?)\s*%/i) || (irtD.taught ? rrPct(irtD.s, /(\d{2,3}(?:\.\d+)?)\s*%/) : null); const cl = classesIn(irtD.s); const lv = cl.length ? Math.max(...cl) : spec.classes.length - 1;
    if (p) { spec.coverage.reinvestmentTest = { label: (irtD.taught && irtD.taught.term) || (irtD.s.match(/(Interest Diversion Test|Interest Reinvestment Test|Reinvestment Overcollateralization Test|Reinvestment Test)/) || [])[1] || 'Interest Reinvestment Test', ocClasses: spec.classes.slice(0, lv + 1).map(c => c.id), trigger: p, maxDiversionPct: 50, ref: 'p. ' + irtD.page }; log('Coverage tests', spec.coverage.reinvestmentTest.label, p + '% on Class ' + spec.classes[lv].id + ' and above', irtD.page, hw(irtD), irtD.s); } }
  const eodT = tau('eod', 600, s => { const p = rrPct(s, /(\d{2,3}(?:\.\d+)?)\s*%/); return p >= 90 && p <= 130; });
  const eodRes = [/Event of Default (?:Trigger|Ratio)"?\s*[:\-]?[^%]{0,40}?(\d{2,3}(?:\.\d+)?)\s*%/, /(?:if|that)\s+the\s+Class\s+[A-Z][A-Z0-9-]*\s+(?:Overcollateralization|Par Value)\s+Ratio\s+(?:is\s+)?less\s+than\s+(\d{2,3}(?:\.\d+)?)\s*%/, /Event of Default[^.]{0,300}?less\s+than\s+(\d{2,3}(?:\.\d+)?)\s*%/, /Aggregate\s+Outstanding\s+Amount\s+of\s+the\s+Class\s+[A-Z][A-Z0-9-]*\s+Notes[^%]{0,120}?to\s+equal\s+or\s+exceed\s+(\d{2,3}(?:\.\d+)?)\s*%/];
  const eodOk = m => { const p = m && +(m[1] || m[2]); return p >= 90 && p <= 130; };
  const eod = eodT ? Object.assign([eodT.s.slice(0, 200), rrPct(eodT.s, /(\d{2,3}(?:\.\d+)?)\s*%/)], { page: eodT.page }) : eodRes.map(re => { const g = new RegExp(re.source, 'g'); let m; while ((m = g.exec(T))) if (eodOk(m)) return m; return null; }).find(Boolean) || null;
  if (eod && spec.classes.length) { const p = +(eod[1] || eod[2]); const top = spec.classes[0].id.replace(/[LN]$/, '').replace(/-\d+$/, ''); const ids = spec.classes.filter(c => c.id.replace(/[LN]$/, '').replace(/-\d+$/, '') === top).map(c => c.id);
    const pg = eod.page || J.pageAt(T.indexOf(eod[0]));
    { const named = String(eod[0]).match(/Aggregate\s+Outstanding\s+Amount\s+of\s+the\s+(Class\s+[A-Z][A-Z0-9-]*)\s+Notes/); const cl = named ? classesIn(named[1]) : []; if (cl.length) { ids.length = 0; cl.forEach(i => ids.push(spec.classes[i].id)); } }
    if (p >= 90 && p <= 130) { spec.coverage.eodTest = { label: 'Class ' + (ids.length === 1 ? ids[0] : top) + ' OC (Event of Default)', ocClasses: ids, trigger: p, ref: 'p. ' + pg }; log('Coverage tests', 'Event of Default test', p + '% on Class ' + (ids.length === 1 ? ids[0] : top), pg, eodT ? 'taught' : 'found', eod[0]); } }
  if (!spec.coverage.eodTest && spec.classes.length) log('Coverage tests', 'Event of Default test', 'no par ratio Event of Default found', null, 'missing');

  // ---- 5. the waterfalls, clause by clause, from the operative Priority of Payments
  const loc = locateWaterfall(pages);
  if (!loc) log('Waterfall', 'Priority of Payments', 'not found', null, 'missing');
  else {
    const seq = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH']);
    const all = clauseTexts(loc, { interest: seq.map(id => ({ id })), principal: seq.map(id => ({ id })), liquidation: seq.map(id => ({ id })) });
    const lettersOf = k => { const o = []; for (const id of seq) { if (!(all[k] || {})[id]) break; o.push(id); } return o; };
    const rated = spec.classes.map(c => c.id); const defer = spec.classes.filter(c => c.deferrable).map(c => c.id);
    const tests = spec.coverage.tests;
    const testFor = (txt, used) => { const cl = classesIn(txt.replace(/Notes? Payment Sequence/g, '')); const lvl = cl.length ? Math.max(...cl) : null; let t = lvl != null ? tests.find(x => x.oc.classes.length - 1 >= lvl && x.oc.classes.indexOf(rated[lvl]) >= 0 && !used.has(x.id)) : null; if (!t) t = tests.find(x => !used.has(x.id)); return t; };
    const payOrder = txt => { const cl = classesIn(txt); return /Note Payment Sequence|Priority Sequence|Debt Payment Sequence|sequential/i.test(txt) || cl.length < 1 ? rated.slice() : rated.slice(0, Math.max(...cl) + 1); };
    const ratedFor = txt => { const cl = classesIn(txt); return cl.map(i => rated[i]); };
    const used = new Set(); let incentiveSeen = false;
    const classify = (k, id, txt, prev) => {
      const t = txt.replace(/\s+/g, ' '); const st = { id, label: '', clause: '', ref: '' };
      const has = re => re.test(t);
      const notSat = has(/not\s+(?:be\s+)?satisfied|is\s+not\s+met|fails?\b/i);
      const items = [];
      if (has(/\btax(es)?\b/i) && (has(/governmental fee/i) || id === 'A')) items.push('taxes');
      if (has(/Administrative Expenses/i) && !has(/not paid|limitation|in excess of|to the extent not|not otherwise paid|above the cap/i) && !(k !== 'interest' && notSat)) items.push('admin');
      const adminExcess = has(/Administrative Expenses/i) && has(/not paid|limitation|in excess of|to the extent not|not otherwise paid/i);
      if (k === 'principal') {
        const ref = t.match(/(?:referred\s+to\s+in|set\s+forth\s+in|described\s+in|in\s+accordance\s+with|under)\s+clauses?\s+\(?([A-Z]{1,2})(?:\)|\.)(?:\s*(?:\(\d\)\s*)?(?:through|to|and)\s+\(?([A-Z]{1,2})(?:\)|\.))?/);
        if (ref && has(/Priority of Interest|Section 11\.1\(a\)\(i\)|Interest Proceeds/i)) {
          const a = seq.indexOf(ref[1]), b = ref[2] ? seq.indexOf(ref[2]) : a; const ids = ref[2] && /\band\b/.test(ref[0]) ? [ref[1], ref[2]] : seq.slice(a, b + 1);
          const I = spec.waterfalls.interest || []; const refd = ids.map(x => I.find(s => s.id === x)).filter(Boolean);
          if (refd.length && refd.every(s => s.type === 'cure' || s.type === 'cureAll')) return Object.assign(st, { type: 'cureAll', tests: tests.map(x => x.id), paydown: rated.slice(), includeDeferredOf: defer, label: 'Coverage cure from principal' });
          if (refd.length && refd.every(s => s.type === 'subMgmtFee')) return Object.assign(st, { type: 'subMgmtFee', label: 'Unpaid subordinated fee' });
          return Object.assign(st, { type: 'unpaidFrom', steps: ids, label: 'Unpaid amounts from interest steps ' + ids[0] + (ids.length > 1 ? '–' + ids[ids.length - 1] : '') });
        }
      }
      if (k === 'liquidation') {
        const ref = t.match(/(?:referred\s+to\s+in|set\s+forth\s+in|described\s+in|in\s+accordance\s+with|under)\s+clauses?\s+\(?([A-Z]{1,2})(?:\)|\.)(?:\s*(?:\(\d\)\s*)?(?:through|to|and)\s+\(?([A-Z]{1,2})(?:\)|\.))?/);
        if (ref && has(/Priority of Interest|Section 11\.1\(a\)\(i\)/i)) {
          const a = seq.indexOf(ref[1]), b = ref[2] ? seq.indexOf(ref[2]) : a; const I = spec.waterfalls.interest || []; const refd = (ref[2] && /\band\b/.test(ref[0]) ? [ref[1], ref[2]] : seq.slice(a, b + 1)).map(x => I.find(s => s.id === x)).filter(Boolean);
          const its = [].concat(...refd.filter(s => s.type === 'expense' || s.type === 'fees').map(s => s.items || [s.item]));
          if (its.length && refd.every(s => s.type === 'expense')) return Object.assign(st, { type: 'expense', items: its, label: 'As interest clauses ' + ref[1] + (ref[2] ? '–' + ref[2] : '') });
          if (its.length && refd.every(s => s.type === 'fees')) return Object.assign(st, { type: 'fees', items: its, label: 'Senior fees' });
          if (its.length) return Object.assign(st, { type: 'expense', items: its, label: 'As interest clauses ' + ref[1] + (ref[2] ? '–' + ref[2] : '') + ', in order' });
        }
      }
      if (items.length && !has(/interest on the Class/i)) return Object.assign(st, { type: 'expense', items, label: items.map(x => ({ taxes: 'Taxes', admin: 'Administrative Expenses, capped' }[x])).join(' and ') });
      if (adminExcess) return Object.assign(st, { type: 'expense', items: ['adminExcess'].concat(has(/Hedge|termination/i) ? ['hedgeTermSub'] : []), label: 'Expenses above the cap' + (has(/Hedge|termination/i) ? ' and subordinated termination payments' : '') });
      if (has(/Revolv|Delayed Drawdown|Unfunded/i) && has(/Revolver Funding|obligations/i) && k === 'liquidation' && !has(/interest on the Class/i)) return Object.assign(st, { type: 'expense', item: 'revolverFunding', label: 'Unfunded commitments' });
      if (has(/Hedge/i) && !has(/interest on the Class/i) && (!has(/Subordinated|Defaulted/i) || has(/other than\s+(?:any\s+)?(?:Subordinated|Defaulted)/i)) && !notSat) return Object.assign(st, { type: 'expense', item: has(/terminat/i) ? 'hedgeTermSenior' : 'hedge', label: has(/terminat/i) ? 'Hedge termination payments' : 'Hedge payments' });
      if (has(/Cumulative Deferred Management Fee/i) && !has(/(?<!Deferred\s)(?:Collateral|Investment|Portfolio|Senior|Base)\s+Management\s+Fee/i) && !has(/interest on the Class/i)) return Object.assign(st, { type: 'subMgmtFee', includeCumulativeDeferred: true, label: 'Cumulative deferred management fee' });
      if (has(/(?:Senior|Base|Aggregate)\s+(?:Collateral\s+|Investment\s+|Portfolio\s+)?Management\s+Fee|Senior\s+Servicing\s+Fee|Structuring Fee|(?<!Subordinated |Incentive |Deferred )(?:Collateral|Investment|Portfolio)\s+Management\s+Fee/i) && !has(/Subordinated (?:Collateral |Investment |Portfolio )?Management Fee|Incentive/i) && !has(/interest on the Class/i)) return Object.assign(st, { type: 'fees', items: ['seniorMgmt'].concat(has(/Structuring/i) ? ['structuring'] : []), label: 'Senior management fee' + (has(/Structuring/i) ? ' and structuring fee' : '') });
      if (notSat && has(/Coverage Test|Overcollateralization|Interest Coverage|Par Value Test/i) && !has(/Interest Diversion|Reinvestment Test|Reinvestment Overcollateralization/i)) {
        if (k === 'interest' && !has(/either of the Coverage Tests|all Coverage Tests|any Coverage Test/i)) { const tt = testFor(t, used); if (tt) { used.add(tt.id);
          // pay down the classes the clause names, once the test's own name is set aside ("principal of the Class E Notes" only); otherwise every class the test covers
          const named = ratedFor(t.replace(/Class(?:es)?\s+[A-Z0-9][A-Z0-9/\-, ]*?(?:\s+and\s+(?:the\s+)?(?:Class\s+)?[A-Z0-9-]+)?\s+(?:Notes\s+)?(?:Coverage|Overcollateralization|Over-collateralization|Interest Coverage|Par Value)[^,;.]*?(?:Tests?|Ratios?)/g, ' ')).filter(c => tt.oc.classes.includes(c));
          const pd = named.length && !/Payment Sequence|Priority Sequence|sequential/i.test(t) ? named : tt.oc.classes.slice();
          return Object.assign(st, { type: 'cure', test: tt.id, paydown: pd, includeDeferredOf: defer.filter(c => pd.includes(c)), label: tt.label + ' coverage cure' }); } }
        return Object.assign(st, { type: 'cureAll', tests: tests.map(x => x.id), paydown: rated.slice(), includeDeferredOf: defer, label: 'Coverage cure' });
      }
      if (has(/Interest Diversion Test|Interest Reinvestment Test|Reinvestment Overcollateralization Test|Reinvestment Test/i) && k === 'interest') {
        const mx = rrPct(t, /(\d{2,3}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:remaining|all remaining|available|such remaining)/i); if (mx && spec.coverage.reinvestmentTest) { spec.coverage.reinvestmentTest.maxDiversionPct = mx; log('Coverage tests', 'Diversion limit', mx + '% of remaining interest', null, 'found', t.slice(0, 200)); }
        return Object.assign(st, { type: 'reinvestmentDiversion', label: (spec.coverage.reinvestmentTest || {}).label || 'Interest diversion', when: has(/Reinvestment Period/i) ? 'duringRP' : undefined });
      }
      if (has(/(?:Supplemental|Expense|Interest|Discretionary)\s+Reserve\s+Account/i) && has(/deposit/i) && !has(/interest on the Class|Coverage Test/i)) return Object.assign(st, { type: 'none', manual: true, label: 'Reserve account deposit (entered by hand)' });
      if (k === 'principal' && /^\s*\(?[A-Z]{1,2}\)?\s*(?:to\s+)?make\s+payments\s+in\s+accordance\s+with\s+the\s+(?:Note|Debt|Secured Note)\s+Payment\s+Sequence\s*[;.]?\s*(?:and)?\s*$/i.test(t)) { const st2 = spec.meta.reinvestmentPeriodEnd && spec.meta.reinvestmentPeriodEnd !== spec.meta.closingDate; return Object.assign(st, { type: 'amortize', paydown: rated.slice(), includeDeferredOf: defer, label: 'Sequential paydown', when: st2 ? 'afterRP' : undefined }); }
      if (k === 'principal' && has(/if\s+such\s+date\s+is\s+a\s+Redemption\s+Date/i) && has(/Payment Sequence/i) && !has(/Special Redemption/i)) return Object.assign(st, { type: 'amortize', paydown: rated.slice(), includeDeferredOf: defer, label: 'Redemption paydown', when: 'redemption' });
      if (has(/Rating Confirmation|Ratings Confirmation|has not (?:yet )?confirmed/i)) return Object.assign(st, { type: 'rcf', paydown: rated.slice(), label: 'Rating confirmation paydown', when: 'rcf' });
      if (has(/Special Redemption/i)) return Object.assign(st, { type: 'specialRedemption', paydown: rated.slice(), label: 'Special Redemption', when: 'specialRedemption' });
      if (has(/Subordinated\s+(?:Collateral\s+|Investment\s+|Portfolio\s+)?Management\s+Fee|Subordinated\s+Servicing\s+Fee/i)) return Object.assign(st, { type: 'subMgmtFee', includeCumulativeDeferred: k === 'liquidation' && has(/Cumulative Deferred/i), label: 'Subordinated management fee' });
      if (k === 'principal' && has(/during\s+the\s+Reinvestment\s+Period/i) && has(/Collateral Obligations|Collateral Debt Securities|Eligible Investments|Collection Account/i)) return Object.assign(st, { type: 'reinvest', label: 'Reinvest', when: 'duringRP' });
      if (k === 'principal' && has(/after\s+the\s+Reinvestment\s+Period|Redemption Date/i) && has(/Payment Sequence|principal of|pay principal|payments in accordance/i) && !has(/Subordinated Notes until|Internal Rate/i)) return Object.assign(st, { type: 'amortize', paydown: rated.slice(), includeDeferredOf: defer, label: 'Sequential paydown', when: has(/after\s+the\s+Reinvestment\s+Period/i) ? 'afterRP' : undefined });
      if (has(/Incentive/i) && has(/\d{1,2}(?:\.\d+)?\s*%/)) { incentiveSeen = true; return Object.assign(st, { type: 'incentiveSplit', label: 'Residual split with the incentive fee', when: k === 'principal' ? 'noRatedOutstanding' : undefined }); }
      if (has(/Internal Rate of Return|Target Return|Incentive (?:Management )?Fee Threshold/i)) return Object.assign(st, { type: 'equityHurdle', label: 'Subordinated Notes to the hurdle', when: k === 'principal' ? 'noRatedOutstanding' : undefined });
      const cl = ratedFor(t);
      if (cl.length && has(/interest/i) && k === 'liquidation' && has(/principal/i) && cl.length === 1) return Object.assign(st, { type: 'interestAndPrincipal', class: cl[0], label: 'Class ' + cl[0] + ' interest and principal' });
      if (cl.length && k === 'liquidation' && has(/principal/i) && !has(/interest/i)) return Object.assign(st, { type: 'principal', classes: cl, includeDeferredOf: defer.filter(c => cl.includes(c)), label: 'Class ' + cl.join(', ') + ' principal' });
      if (cl.length && has(/interest/i) && !notSat) return Object.assign(st, { type: 'interest', classes: cl, includeDeferred: has(/Deferred Interest/i), withSeniorTermination: has(/terminat/i) && has(/Hedge/i), label: 'Class ' + cl.join(', ') + (has(/^(?:to the payment of )?(?:any )?Deferred Interest/i) ? ' deferred interest' : ' interest') });
      if (has(/remaining|balance|residual/i) && has(/Subordinated Notes|Preferred Shares|Income Notes|Issuer|Holders/i)) return Object.assign(st, { type: 'equityHurdle', label: 'Remaining to the ' + ((t.match(/Subordinated Notes|Preferred Shares|Income Notes/) || ['equity'])[0]), when: k === 'principal' ? 'noRatedOutstanding' : undefined });
      return Object.assign(st, { type: 'unsupported', label: 'Not modelled: ' + t.slice(0, 48) + '…' });
    };
    // a clause read the way a person taught it; the classes, tests and labels still come from the clause's own words
    const rrShort = t => { const x = t.replace(/^\s*\(?[A-Z]{1,2}\)\s*/, '').replace(/^(?:to\s+(?:the\s+)?(?:payment|deposit)\s+(?:of|into|to)\s+(?:the\s+)?(?:any\s+)?)/i, ''); return x.length > 54 ? x.slice(0, 54).replace(/\s+\S*$/, '') + '…' : x; };
    const asTaught = (x, k, id, txt) => {
      const t = txt.replace(/\s+/g, ' '); const st = { id, label: '', clause: '', ref: '' }; const [ty, item] = x.type.split(':'); const cl = ratedFor(t);
      switch (ty) {
        case 'manual': return Object.assign(st, { type: 'none', manual: true, label: 'Entered by hand: ' + rrShort(t) });
        case 'none': return Object.assign(st, { type: 'none', label: 'No payment: ' + rrShort(t) });
        case 'expense': return Object.assign(st, { type: 'expense', items: [item], label: (RR_CLAUSE_TYPES.find(c => c[0] === x.type) || [])[1] || item });
        case 'fees': return Object.assign(st, { type: 'fees', items: ['seniorMgmt'].concat(/Structuring/i.test(t) ? ['structuring'] : []), label: 'Senior management fee' + (/Structuring/i.test(t) ? ' and structuring fee' : '') });
        case 'subMgmtFee': return Object.assign(st, { type: 'subMgmtFee', includeCumulativeDeferred: k === 'liquidation' && /Cumulative Deferred/i.test(t), label: 'Subordinated management fee' });
        case 'interest': return cl.length ? Object.assign(st, { type: 'interest', classes: cl, includeDeferred: /Deferred Interest/i.test(t), label: 'Class ' + cl.join(', ') + ' interest' }) : null;
        case 'principal': return cl.length ? Object.assign(st, { type: 'principal', classes: cl, includeDeferredOf: defer.filter(c => cl.includes(c)), label: 'Class ' + cl.join(', ') + ' principal' }) : null;
        case 'cure': { if (k !== 'interest') return tests.length ? Object.assign(st, { type: 'cureAll', tests: tests.map(q => q.id), paydown: rated.slice(), includeDeferredOf: defer, label: 'Coverage cure' }) : null; const tt = testFor(t, used); if (!tt) return null; used.add(tt.id); return Object.assign(st, { type: 'cure', test: tt.id, paydown: tt.oc.classes.slice(), includeDeferredOf: defer.filter(c => tt.oc.classes.includes(c)), label: tt.label + ' coverage cure' }); }
        case 'cureAll': return tests.length ? Object.assign(st, { type: 'cureAll', tests: tests.map(q => q.id), paydown: rated.slice(), includeDeferredOf: defer, label: 'Coverage cure' }) : null;
        case 'amortize': return Object.assign(st, { type: 'amortize', paydown: rated.slice(), includeDeferredOf: defer, label: 'Sequential paydown', when: k === 'principal' && /after\s+the\s+Reinvestment\s+Period/i.test(t) ? 'afterRP' : undefined });
        case 'reinvest': return Object.assign(st, { type: 'reinvest', label: 'Reinvest', when: 'duringRP' });
        case 'reinvestmentDiversion': return spec.coverage.reinvestmentTest && k === 'interest' ? Object.assign(st, { type: 'reinvestmentDiversion', label: spec.coverage.reinvestmentTest.label, when: /Reinvestment Period/i.test(t) ? 'duringRP' : undefined }) : null;
        case 'equityHurdle': return Object.assign(st, { type: 'equityHurdle', label: 'Remaining to the ' + ((t.match(/Subordinated Notes|Preferred Shares|Income Notes/) || [(spec.equity && spec.equity.name) || 'equity'])[0]), when: k === 'principal' ? 'noRatedOutstanding' : undefined });
        case 'incentiveSplit': return Object.assign(st, { type: 'incentiveSplit', label: 'Residual split with the incentive fee', when: k === 'principal' ? 'noRatedOutstanding' : undefined });
      }
      return null;
    };
    const fits = (x, k, txt) => (x.k === 'any' || x.k === k) && rrHas(txt, x.phrase);
    for (const k of ['interest', 'principal', 'liquidation']) {
      if (!loc.anchors[k]) continue; const L = lettersOf(k); if (!L.length) continue; const out = []; const rows = []; const kn = { interest: 'Interest', principal: 'Principal', liquidation: 'Post-acceleration' }[k];
      L.forEach(id => { const w = all[k][id];
        let lesson = LS.clauses.find(x => x.override && fits(x, k, w.text)); let st = lesson && asTaught(lesson, k, id, w.text); if (!st) lesson = null;
        if (!st) st = classify(k, id, w.text, out[out.length - 1]);
        if (st.type === 'unsupported') { const x = LS.clauses.find(q => fits(q, k, w.text)); const s2 = x && asTaught(x, k, id, w.text); if (s2) { st = s2; lesson = x; } }
        if (lesson) usedL.add(lesson.id);
        st.ref = 'PDF p. ' + w.page; st.clause = w.text.replace(/\s+/g, ' ').slice(0, 160) + (w.text.length > 160 ? '…' : ''); if (st.when === undefined) delete st.when; out.push(st);
        if (st.type === 'unsupported') assumptions.push(k[0].toUpperCase() + k.slice(1) + ' clause (' + id + ') is not modelled: ' + w.text.replace(/\s+/g, ' ').slice(0, 140) + '…');
        if (st.type === 'unsupported' || lesson) rows.push([kn + ' clause (' + id + ')', lesson ? st.label : 'not modelled: ' + rrShort(w.text.replace(/\s+/g, ' ')), w.page, lesson ? 'taught' : 'missing', w.text, id]);
        items.clauses.push({ k, id, page: w.page, text: w.text.replace(/\s+/g, ' ').trim().slice(0, 900), type: st.type, item: st.type === 'expense' ? (st.items || [st.item])[0] : undefined, manual: !!st.manual, label: st.label, lesson: lesson ? lesson.id : null }); });
      spec.waterfalls[k] = out;
      const nT = rows.filter(r => r[3] === 'taught').length;
      log('Waterfall', kn + ' priority', out.length + ' clauses, ' + L[0] + '–' + L[L.length - 1] + (out.some(s => s.type === 'unsupported') ? ', ' + out.filter(s => s.type === 'unsupported').length + ' not modelled' : '') + (nT ? ', ' + nT + ' read from lessons' : ''), all[k][L[0]].page, 'found');
      rows.forEach(r => Object.assign(log('Waterfall', r[0], r[1], r[2], r[3], r[4]), { teach: 'clause', k, cid: r[5] }));
    }
    // a cap written into the clause itself: "(x) 0.065% of the Principal Collateral Value ... and (y) U.S.$122,000", over this and the prior N Payment Dates
    if (!spec.fees.adminCap) { const capSt = (spec.waterfalls.interest || []).find(x => (x.items || [x.item]).includes('admin')); const w = capSt && all.interest[capSt.id]; const tx = w ? w.text.replace(/\s+/g, ' ') : '';
      const pc = rrPct(tx, /(\d\.\d{1,4})\s*%\s*of\s+the\s+(?:Principal Collateral Value|Collateral Principal Amount|Fee Basis Amount|Aggregate Principal Balance)/i); const fx = rrMoney(tx);
      if (pc != null && fx) { const pa = /per\s+annum/i.test(tx); const np = (tx.match(/(one|two|three|four|\d)\s+immediately\s+preceding\s+Payment\s+Dates?/i) || [])[1]; const nn = np ? ({ one: 1, two: 2, three: 3, four: 4 }[np.toLowerCase()] || +np) : 0;
        spec.fees.adminCap = { bpsOfPCV: pa ? Math.round(pc * 100 / 4 * 1000) / 1000 : pc * 100, fixed: pa ? Math.round(fx / 4) : fx, priorPeriods: nn, ref: capSt.ref }; log('Fees', 'Administrative Expense Cap', pc + '% of the collateral plus ' + rrM(fx) + (pa ? ' a year' : '') + (nn ? ', across this and the ' + nn + ' prior Payment Dates' : ''), w.page, 'found', tx.slice(0, 220)); } }
    // the IC numerator deducts every interest step before the first class interest step
    const I = spec.waterfalls.interest || []; const fi = I.findIndex(s => s.type === 'interest');
    spec.coverage.icNumeratorDeducts = I.slice(0, fi < 0 ? 0 : fi).filter(s => s.type === 'expense' || s.type === 'fees').map(s => s.id);
    if (spec.coverage.reinvestmentTest && !I.some(s => s.type === 'reinvestmentDiversion')) delete spec.coverage.reinvestmentTest;
    if (spec.coverage.reinvestmentTest && !found.some(f => f.field === 'Diversion limit')) assumptions.push('The share of interest the ' + spec.coverage.reinvestmentTest.label + ' can divert was not found; 50% is assumed.');
    const incSt = [].concat(I, spec.waterfalls.principal || [], spec.waterfalls.liquidation || []).find(s => s.type === 'incentiveSplit');
    if (!spec.fees.incentive && incSt) { const w = (all[incSt.ref && I.includes(incSt) ? 'interest' : 'principal'] || {})[incSt.id] || all.interest[incSt.id]; const tx = (w ? w.text : '').replace(/\s+/g, ' ');
      const sh = rrPct(tx, /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:\([^)]*\)\s*)?to\s+the\s+(?:Collateral|Investment|Portfolio)\s+Manager/i) || rrPct(tx, /(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:any\s+|such\s+|the\s+|all\s+)?(?:[A-Z][a-z]+\s+){0,3}remaining/i);
      const hr = rrPct(tx, /Internal Rate of Return[^%]{0,80}?(\d{1,2}(?:\.\d+)?)\s*%/i) || (irr ? +irr : null);
      if (sh && hr) { spec.fees.incentive = { hurdleIRR: hr, managerShare: sh, dayBasis: 360, ref: incSt.ref }; log('Fees', 'Incentive fee', sh + '% of the residual above a ' + hr + '% IRR', w && w.page, 'found', tx.slice(0, 200)); } }
    if (!spec.fees.incentive && [].concat(I, spec.waterfalls.principal || []).some(s => s.type === 'incentiveSplit')) assumptions.push('An incentive fee clause was found but its hurdle and share were not; the residual goes to the subordinated notes.');
  }
  // ---- 6. haircuts (defaults where the document's text was not recognised)
  const ccc = tau('ccc', 1200, s => /\d\s*%/.test(s)) || rrDef(J, '(?:Excess CCC Adjustment Amount|CCC Excess|Caa Excess|Excess Caa)', 1200);
  const cccLim = ccc && ccc.taught ? rrPct(ccc.s, /(\d{1,2}(?:\.\d+)?)\s*%/) : ccc ? rrPct(ccc.s, /(\d{1,2}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:Collateral Principal Amount|Aggregate Principal Balance|aggregate principal balance|Principal Collateral Value)/i) : null;
  if (cccLim) { spec.haircuts.ccc = { limitPct: cccLim, haircutPct: ccc && /Market Value/i.test(ccc.s) && !/\d{2}\s*%\s*of\s+(?:its\s+)?(?:par|principal balance)/i.test(ccc.s) ? 100 : 70, moodysAtOrBelow: 'Caa1', spAtOrBelow: 'CCC+', ref: 'p. ' + ccc.page }; log('Haircuts', 'CCC Excess limit', cccLim + '% of the collateral; excess carried at ' + (spec.haircuts.ccc.haircutPct === 100 ? 'market value' : 'the lesser of 70% and market value'), ccc.page, hw(ccc), ccc.s); }
  else log('Haircuts', 'CCC Excess', 'not recognised: standard values used', null, 'default');
  // ---- 7. collateral quality tests: single-number limits only; matrices and models are left to you
  const qt = (id, metric, label, term, re, op, conv, loose) => { const d = tau(id, 900, s => re.test(s) || loose.test(s)) || rrDef(J, term, 900); if (!d) return; const m = d.s.match(re) || (d.taught ? d.s.match(loose) : null); if (!m) { log('Quality tests', label, 'found, but the limit is a matrix or table: enter it by hand', d.page, 'missing'); return; } let v = +String(m[1]).replace(/,/g, ''); if (conv) v = conv(v); const q = { id, label, metric, op, limit: v, ref: 'p. ' + d.page }; if (metric === 'wal' && /elapsed|minus|less\s+the|reduced/i.test(d.s)) q.limit = { type: 'declining', startYears: v, from: 'closingDate' }; spec.qualityTests.push(q); log('Quality tests', label, (op === '<=' ? '≤ ' : '≥ ') + v, d.page, hw(d), d.s); };
  qt('warf', 'warf', "Maximum Weighted Average Rating Factor", "(?:Maximum (?:Moody's )?Weighted Average (?:Moody's )?Rating Factor Test|Maximum Moody's Rating Factor Test|Weighted Average Rating Factor Test)", /(?:exceed|greater than|or less than|equal to or less than|at most)\s+(\d,?\d{3})/i, '<=', null, /(\d,?\d{3})/);
  qt('was', 'was', 'Minimum Weighted Average Spread', '(?:Minimum (?:Weighted Average |Floating )?Spread Test|Minimum Weighted Average Spread Test|Weighted Average Spread Test)', /(?:at least|equal to or greater than|not less than|greater than or equal to)\s+(?:equal\s+to\s+)?(\d\.\d{1,3})\s*%/i, '>=', null, /(\d\.\d{1,3})\s*%/);
  qt('wac', 'wac', 'Minimum Weighted Average Coupon', '(?:Minimum Weighted Average Coupon Test|Weighted Average Coupon Test)', /(?:at least|equal to or greater than|not less than|greater than or equal to)\s+(?:equal\s+to\s+)?(\d{1,2}\.\d{1,3})\s*%/i, '>=', null, /(\d{1,2}\.\d{1,3})\s*%/);
  qt('wal', 'wal', 'Weighted Average Life', '(?:Weighted Average Life Test|Maximum Weighted Average Life Test)', /(\d{1,2}(?:\.\d+)?)\s*years/i, '<=', null, /(\d{1,2}(?:\.\d+)?)\s*years/i);
  qt('div', 'diversity', 'Minimum Diversity Score', "(?:Minimum Diversity Test|Diversity Test|Moody's Diversity Test|Minimum Diversity Score)", /(?:at least|equal to or greater than|not less than|greater than or equal to)\s+(?:equal\s+to\s+)?(\d{2,3})\b/i, '>=', null, /\b(\d{2,3})\b/);
  qt('mwarr', 'moodysWARR', "Minimum Moody's Weighted Average Recovery Rate", "(?:Moody's Minimum Weighted Average Recovery Rate Test|Minimum Weighted Average Moody's Recovery Rate Test|Minimum Moody's Weighted Average Recovery Rate)", /(?:at least|equal to or greater than|not less than|greater than)\s+(?:equal\s+to\s+)?(\d{2}(?:\.\d+)?)\s*%/i, '>=', null, /(\d{2}(?:\.\d+)?)\s*%/);
  if (/S&P CDO Monitor|CDO Monitor Test/.test(T)) { spec.qualityTests.push({ id: 'cdom', label: 'S&P CDO Monitor', metric: 'external', ref: 'p. ' + J.pageAt(T.indexOf('CDO Monitor')), note: 'Requires the S&P model; enter the result by hand.' }); log('Quality tests', 'S&P CDO Monitor', 'found; result entered by hand', J.pageAt(T.indexOf('CDO Monitor')), 'found'); }
  // ---- 8. concentration limits: each numbered item, matched to a tape field where it can be
  const cd = tau('conc', 14000, s => /\(i\)[\s\S]{0,1500}\(ii\)/.test(s.slice(0, 4000)), true) || rrDef(J, '(?:Concentration Limitations|Portfolio Profile Test)', 14000, s => /\(i\)[\s\S]{0,1500}\(ii\)/.test(s.slice(0, 4000)), true);
  if (cd) {
    const S = cd.s; const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx', 'xxi', 'xxii', 'xxiii', 'xxiv', 'xxv', 'xxvi', 'xxvii', 'xxviii', 'xxix', 'xxx'];
    const starts = []; let pos = 0; for (const r of roman) { const g = new RegExp('(?:^|\\n|;\\s*(?:and\\s+|or\\s+)?|\\.{3,})\\s*\\(' + r + '\\)\\s', 'g'); g.lastIndex = pos; const m = g.exec(S); if (!m) break; starts.push({ r, at: m.index + m[0].indexOf('(') }); pos = m.index + m[0].length; }
    starts.forEach((x, i) => {
      const t = S.slice(x.at, i + 1 < starts.length ? starts[i + 1].at : Math.min(S.length, x.at + 1500)).replace(/\s+/g, ' ');
      const pct = rrPct(t, /(\d{1,3}(?:\.\d+)?)\s*%/); if (pct == null) return;
      const ge = /not\s+less\s+than|at\s+least|minimum|greater\s+than\s+or\s+equal/i.test(t.slice(0, 160)); const id = '(' + x.r + ')';
      const pg = J.pageAt(cd.at + x.at); let lab = null;
      const add = (label, o, how) => { lab = label; spec.concentrations.push(Object.assign({ id, label, limit: pct, ref: 'p. ' + pg }, o)); const e = log('Concentration limits', id + ' ' + label, (o.op === '>=' ? '≥ ' : '≤ ') + pct + '%', pg, how || 'found', t); if (how) Object.assign(e, { teach: 'concItem', cid: id }); };
      const exc = t.match(/(?:except\s+that|provided,?\s+(?:however,?\s+)?that)[\s\S]{0,220}?(?:up\s+to|no\s+more\s+than)\s+(\w+)\s+(?:obligors?|groups?|industr|S&P Industry|Moody's Industry)[\s\S]{0,200}?(\d{1,2}(?:\.\d+)?)\s*%/i);
      const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const exO = exc ? { count: words[exc[1].toLowerCase()] || +exc[1] || 1, limit: +exc[2] } : undefined;
      const u = t.replace(/\((?:excluding|other than|but excluding)[^)]*\)/gi, ' ').replace(/(?:excluding|other than)\s+[^,;]{0,80}/gi, ' ');
      const rules = [
        [/Letters? of Credit|Finance Leases?|Structured Finance|CDO Securities|Securities Lending|Derived Rating|Counterparty Criteria|Step-Down|Long-Dated|Bridge Loan/i, () => null],
        [/Senior Secured Loans?/i, () => ge ? add('Senior secured loans' + (/Domiciled/i.test(u) ? ', US' + (/Canada/i.test(u) ? ', Canada' : '') + (/United Kingdom/i.test(u) ? ', UK' : '') + ' obligors' : ''), Object.assign({ filter: [{ f: 'assetType', in: ['SSL'].concat(/Senior Secured Loans? or Second Lien/i.test(u) ? ['2L'] : []) }].concat(/Domiciled/i.test(u) ? [{ f: 'country', in: ['US'].concat(/Canada/i.test(u) ? ['CA'] : [], /United Kingdom/i.test(u) ? ['GB', 'UK'] : []) }] : []), op: '>=' }, /Domiciled/i.test(u) ? {} : { cashAs: { assetType: 'SSL' } })) : false],
        [/single\s+obligor|any\s+one\s+obligor|single\s+issuer|any\s+single\s+Obligor/i, () => add('Single obligor', { metric: 'maxObligor', exceptions: exO })],
        [/Industry Classification|same\s+industry|single\s+industry|any\s+one\s+industry/i, () => add('Single industry', { metric: 'maxIndustry', field: /Moody/i.test(u) ? 'mIndustry' : 'spIndustry', exceptions: exO })],
        [/Second Lien|Senior Unsecured|Unsecured Loans?|High[- ]Yield|\bBonds?\b/i, () => { const inn = [].concat(/Second Lien/i.test(u) ? ['2L'] : [], /unsecured/i.test(u) ? ['UNSEC'] : [], /bond/i.test(u) ? ['BOND'] : []); return add(inn.map(x => ({ '2L': 'Second lien', UNSEC: 'Unsecured', BOND: 'Bonds' }[x])).join(', '), { filter: [{ f: 'assetType', in: inn }] }); }],
        [/fixed\s+rate/i, () => add('Fixed rate', { filter: [{ f: 'rateType', in: ['FIXED'] }] })],
        [/\bDIP\b|Debtor[- ]in[- ]Possession/i, () => add('DIP loans', { filter: [{ f: 'dip', eq: true }] })],
        [/Current Pay/i, () => add('Current pay obligations', { filter: [{ f: 'currentPay', eq: true }] })],
        [/Cov[- ]Lite/i, () => add('Cov-lite loans', { filter: [{ f: 'covLite', eq: true }] })],
        [/Revolving|Delayed Drawdown/i, () => add('Revolvers and delayed drawdowns', { filter: [{ f: 'revolver', eq: true }] })],
        [/Participation Interests?|Participations?/i, () => add('Participations', { filter: [{ f: 'participation', eq: true }] })],
        [/\bPIK\b|Partial Deferring|Deferrable Obligation|Deferring Obligation/i, () => add('PIK and deferring obligations', { filter: [{ f: 'pik', eq: true }] })],
        [/"?Caa1"?\s+or\s+below|"?CCC\+?"?\s+or\s+below|Caa Collateral|CCC Collateral/i, () => add('Caa1 / CCC+ and below', { filter: [{ f: 'ccc', eq: true }] })],
        [/less\s+frequently\s+than\s+quarterly|semi-?annual/i, () => add('Pays less often than quarterly', { filter: [{ f: 'payFreq', in: ['S', 'A'] }] })],
        [/Zero[- ]Coupon/i, () => add('Zero coupon', { filter: [{ f: 'zeroCoupon', eq: true }] })],
        [/Synthetic Securit/i, () => add('Synthetic securities', { filter: [{ f: 'synthetic', eq: true }] })],
        [/issuance\s+size|facility\s+size|tranche\s+size|total\s+potential\s+indebtedness/i, () => { const lt = rrMoney(u); return lt ? add('Facility size under ' + rrM(lt), { filter: [{ f: 'facilitySize', lt }] }) : null; }],
        [/Canad/i, () => /not\s+Domiciled|other\s+than/i.test(u) ? null : add('Canadian obligors', { filter: [{ f: 'country', in: ['CA'] }] })],
        [/Domiciled|organized/i, () => /United States/i.test(u) && /not|outside|other than/i.test(t) ? add('Non-US obligors', { filter: [{ f: 'country', notIn: ['US'] }] }) : null]
      ];
      const applyC = q => { usedL.add(q.id); if (q.cat === 'skip') { lab = 'Not a tape test'; Object.assign(log('Concentration limits', id + ' not a tape test', 'skipped, as taught', pg, 'taught', t), { teach: 'concItem', cid: id }); return true; } const c = RR_CONC[q.cat]; add(c[0], c[1]({ u, ge, exO }), 'taught'); return true; };
      let done = false, lessonId = null; const pre = LS.conc.find(q => q.override && rrHas(t, q.phrase));
      if (pre) { done = applyC(pre); lessonId = pre.id; }
      const hits = done ? [] : rules.map((r, k) => ({ k, at: u.search(r[0]) })).filter(h => h.at >= 0).sort((a, b) => a.at - b.at || a.k - b.k);
      for (const h of hits) { const out = rules[h.k][1](); if (out !== false) { done = out !== null || h.k === 0; if (h.k === 0) lab = 'Not tested (outside the tape fields)'; break; } }
      if (!done) { const post = LS.conc.find(q => rrHas(t, q.phrase)); if (post) { done = applyC(post); lessonId = post.id; } }
      if (!done) { assumptions.push('Concentration limit ' + id + ' is not modelled: ' + t.slice(0, 150) + '…'); Object.assign(log('Concentration limits', id + ' not modelled', t.replace(/^\(\w+\)\s*/, '').slice(0, 70).replace(/\s+\S*$/, '') + '…', pg, 'missing', t), { teach: 'concItem', cid: id }); }
      items.conc.push({ id, page: pg, text: t.slice(0, 900), label: done ? lab : null, lesson: lessonId });
    });
    if (!spec.concentrations.length) log('Concentration limits', 'Concentration Limitations', 'found, but no item could be matched to a tape field', cd.page, 'missing');
  } else log('Concentration limits', 'Concentration Limitations', 'not found', null, 'missing');
  spec.labels = { taxes: 'Taxes and governmental fees', admin: 'Administrative Expenses (capped)', adminExcess: 'Administrative Expenses above cap', hedge: 'Hedge payments', hedgeTermSenior: 'Senior hedge termination', hedgeTermSub: 'Subordinated hedge termination', seniorMgmt: 'Senior management fee', structuring: 'Structuring fee', revolverFunding: 'Unfunded commitments' };
  // things a reader must check
  spec.classes.forEach(c => { if (c.spread == null) { c.spread = 0; assumptions.push('Class ' + c.id + ' spread not found: set to 0%. Enter it in the deal spec.'); } });
  if (!spec.equity) { const est = Math.max(0, (spec.meta.targetPar || 0) - sum(spec.classes, c => c.balance)); const nmE = /Preferred Shares/.test(T) ? 'Preferred Shares' : /Income Notes/.test(T) ? 'Income Notes' : 'Subordinated Notes'; spec.equity = { id: 'SUB', name: nmE, balance: est || 1 }; log('Notes', nmE, est ? rrM(est) + ', estimated as Target Par less the rated notes' : 'not found', null, est ? 'estimated' : 'missing'); assumptions.push('The ' + nmE + ' amount is not stated in this document; ' + (est ? 'it is estimated as Target Par less the rated notes (' + rrM(est) + ').' : 'enter it in the deal spec.') + ' It drives the IRR hurdle.'); }
  // values entered by hand for this one document replace what was read
  for (const x of LS.values.filter(q => q.value && q.doc === docKey)) {
    const r = rrParseValue(x.field, x.value); if (!r.ok) continue; const v = r.v; const f = RR_FIELDS.find(q => q.key === x.field); let group = f.group, field = f.label, shown = x.value; const ref = 'entered by you'; const drop = re => { for (let i = assumptions.length - 1; i >= 0; i--) if (re.test(assumptions[i])) assumptions.splice(i, 1); };
    const bp = p => Math.round(p * 10000) / 100;
    switch (x.field) {
      case 'seniorFee': spec.fees.seniorMgmt = { label: 'Senior management fee', schedule: [{ bps: bp(v) }], ref }; shown = v + '% a year'; break;
      case 'subFee': spec.fees.subMgmt = { label: 'Subordinated management fee', bps: bp(v), ref }; shown = v + '% a year'; break;
      case 'structFee': spec.fees.structuring = { label: 'Structuring fee', schedule: [{ bps: bp(v) }], ref }; shown = v + '% a year'; break;
      case 'incentive': spec.fees.incentive = { hurdleIRR: v.hurdle, managerShare: v.share, dayBasis: 360, ref }; shown = v.share + '% of the residual above a ' + v.hurdle + '% IRR'; drop(/incentive fee clause was found but/); break;
      case 'adminCap': { const pa = !v.perQuarter; spec.fees.adminCap = { bpsOfPCV: pa ? Math.round(v.pc * 100 / 4 * 1000) / 1000 : v.pc * 100, fixed: pa ? Math.round(v.fixed / 4) : v.fixed, priorPeriods: (spec.fees.adminCap && spec.fees.adminCap.priorPeriods) || 0, ref }; shown = v.pc + '% of the collateral plus ' + rrM(v.fixed) + (pa ? ' a year, per quarter' : ' per Payment Date'); break; }
      case 'closing': spec.meta.closingDate = v; shown = v; break;
      case 'maturity': spec.meta.statedMaturity = v; shown = v; break;
      case 'rpEnd': spec.meta.reinvestmentPeriodEnd = v; shown = v; drop(/^No Reinvestment Period found/); break;
      case 'nonCall': spec.meta.nonCallEnd = v; shown = v; break;
      case 'effective': spec.meta.effectiveDate = v; shown = v; break;
      case 'targetPar': spec.meta.targetPar = v; shown = rrM(v); drop(/^Target Par not found/); break;
      case 'equity': if (spec.equity) spec.equity.balance = v; else spec.equity = { id: 'SUB', name: 'Subordinated Notes', balance: v }; spec.equity.ref = ref; field = spec.equity.name; shown = rrM(v); drop(/amount is not stated in this document/); break;
      case 'irt': if (spec.coverage.reinvestmentTest) Object.assign(spec.coverage.reinvestmentTest, { trigger: v, ref }); else spec.coverage.reinvestmentTest = { label: 'Interest Reinvestment Test', ocClasses: spec.classes.map(c => c.id), trigger: v, maxDiversionPct: 50, ref }; field = spec.coverage.reinvestmentTest.label; shown = v + '%'; break;
      case 'eod': { if (!spec.classes.length) continue; const top = spec.classes[0].id.replace(/[LN]$/, '').replace(/-\d+$/, ''); spec.coverage.eodTest = { label: 'Class ' + top + ' OC (Event of Default)', ocClasses: spec.classes.filter(c => c.id.replace(/[LN]$/, '').replace(/-\d+$/, '') === top).map(c => c.id), trigger: v, ref }; field = 'Event of Default test'; shown = v + '% on Class ' + top; break; }
      case 'ccc': spec.haircuts.ccc = Object.assign({ haircutPct: 70, moodysAtOrBelow: 'Caa1', spAtOrBelow: 'CCC+' }, spec.haircuts.ccc || {}, { limitPct: v, ref }); field = 'CCC Excess limit'; shown = v + '% of the collateral'; break;
      case 'warf': case 'was': case 'wac': case 'wal': case 'div': case 'mwarr': {
        const metric = { warf: 'warf', was: 'was', wac: 'wac', wal: 'wal', div: 'diversity', mwarr: 'moodysWARR' }[x.field]; const op = ['warf', 'wal'].includes(x.field) ? '<=' : '>=';
        const q = { id: x.field, label: f.label, metric, op, limit: v, ref }; const i = spec.qualityTests.findIndex(t => t.id === x.field); if (i >= 0) spec.qualityTests[i] = q; else spec.qualityTests.push(q); shown = (op === '<=' ? '≤ ' : '≥ ') + v; break; }
      default: continue;
    }
    usedL.add(x.id); log(group, field, shown, null, 'entered', 'Entered by you for this document');
  }
  assumptions.unshift('Read from the document by text rules, without a model. Check each value against its page before relying on the results.');
  if (usedL.size) assumptions.splice(1, 0, usedL.size + ' lesson' + (usedL.size > 1 ? 's' : '') + ' you taught the reader ' + (usedL.size > 1 ? 'were' : 'was') + ' used on this document; those values are marked Taught or Entered.');
  return { spec, found, items, used: [...usedL], docKey };
}
