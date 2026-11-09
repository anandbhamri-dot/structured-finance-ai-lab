// ---- calculations: figures and loan columns the user defines, in a small formula language
// A deal-level calculation is one value per Payment Date (a Fee Basis Amount worked out a different way, say).
// A loan-level calculation is a new column on the tape (a Principal Balance, say). Either can replace a figure
// the interpreter works out itself, and the run then uses the replacement everywhere it uses the original.
// Formulas are parsed and evaluated here, without eval. No DOM access in this file.
const CALC = (function () {
'use strict';

class CalcError extends Error { constructor(m) { super(m); this.name = 'CalcError'; } }
const fail = msg => { throw new CalcError(msg); };

// ---------- functions
const FUNCS = {
  IF: { n: [3, 3], sig: 'IF(condition, if true, if false)', d: 'One value or the other' },
  MIN: { n: [1, 99], sig: 'MIN(a, b, …)', d: 'The smallest' },
  MAX: { n: [1, 99], sig: 'MAX(a, b, …)', d: 'The largest' },
  ROUND: { n: [1, 2], sig: 'ROUND(x, places)', d: 'Rounded; ROUND(x, 2) is to the cent' },
  ABS: { n: [1, 1], sig: 'ABS(x)', d: 'Without its sign' },
  IFBLANK: { n: [2, 2], sig: 'IFBLANK(x, otherwise)', d: 'x, or the second value where x is blank' },
  ISBLANK: { n: [1, 1], sig: 'ISBLANK(x)', d: '1 where x is blank' },
  CONTAINS: { n: [2, 2], sig: 'CONTAINS(text, "part")', d: '1 where the text includes the part, in any case' },
  AND: { n: [1, 99], sig: 'AND(a, b, …)', d: '1 where all are true; a AND b also works' },
  OR: { n: [1, 99], sig: 'OR(a, b, …)', d: '1 where any is true; a OR b also works' },
  SUM: { n: [1, 2], agg: true, sig: 'SUM(x, condition)', d: 'x added up over the loans that meet the condition, or over all loans' },
  COUNT: { n: [0, 1], agg: true, sig: 'COUNT(condition)', d: 'How many loans meet the condition' },
  AVG: { n: [1, 2], agg: true, sig: 'AVG(x, condition)', d: 'Simple average of x over the loans' },
  WAVG: { n: [2, 3], agg: true, sig: 'WAVG(x, weight, condition)', d: 'Weighted average, e.g. WAVG(spread, par)' },
  DAYS: { n: [2, 2], sig: 'DAYS(start, end)', d: 'Days from one date to another, e.g. DAYS(Payment_Date, Stated_Maturity_Date)' },
  YEARS: { n: [2, 2], sig: 'YEARS(start, end)', d: 'Years between two dates: the days ÷ 365' },
  EDATE: { n: [2, 2], sig: 'EDATE(date, months)', d: 'The date that many months later, or earlier if negative' },
  DATE: { n: [3, 3], sig: 'DATE(year, month, day)', d: 'A date from its parts, e.g. DATE(2011, 7, 18)' },
  YEAR: { n: [1, 1], sig: 'YEAR(date)', d: 'The year of a date' },
  MONTH: { n: [1, 1], sig: 'MONTH(date)', d: 'The month of a date, 1 to 12' },
  SP_TO_MOODYS: { n: [1, 1], sig: 'SP_TO_MOODYS(rating)', d: 'The Moody\'s rating on the same rung: BB- gives Ba3' },
  MOODYS_TO_SP: { n: [1, 1], sig: 'MOODYS_TO_SP(rating)', d: 'The S&P rating on the same rung: Caa1 gives CCC+' },
  NOTCH: { n: [2, 2], sig: 'NOTCH(rating, notches)', d: 'The rating that many notches lower (higher if negative), on its own scale' },
  RATING_RANK: { n: [1, 1], sig: 'RATING_RANK(rating)', d: 'Rung on either scale, 1 for Aaa or AAA, 17 for Caa1 or CCC+: compare ratings with it' },
  RATING_FACTOR: { n: [1, 1], sig: 'RATING_FACTOR(rating)', d: 'Moody\'s rating factor from the deal\'s table; an S&P rating uses its Moody\'s rung' },
  MINOF: { n: [1, 2], agg: true, sig: 'MINOF(x, condition)', d: 'Smallest x over the loans' },
  MAXOF: { n: [1, 2], agg: true, sig: 'MAXOF(x, condition)', d: 'Largest x over the loans' }
};
const KEYWORDS = ['AND', 'OR', 'NOT', 'TRUE', 'FALSE'];
// rating scales, best first; the same rung on each (Ba3 is BB-, Caa1 is CCC+)
const M_SCALE = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'];
const S_SCALE = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'SD', 'D'];
const RF_STD = { Aaa: 1, Aa1: 10, Aa2: 20, Aa3: 40, A1: 70, A2: 120, A3: 180, Baa1: 260, Baa2: 360, Baa3: 610, Ba1: 940, Ba2: 1350, Ba3: 1766, B1: 2220, B2: 2720, B3: 3490, Caa1: 4770, Caa2: 6500, Caa3: 8070, Ca: 10000, C: 10000 };
let ENV = { rf: RF_STD }; // the deal's rating factors, set for each evaluation
function moodysOf(v) { const m = String(v).trim().match(/^(aaa|aa|a|baa|ba|b|caa|ca|c)([123])?$/i); if (!m) return null; const r = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + (m[2] || ''); return M_SCALE.includes(r) ? r : null; }
function spOf(v) { const r = String(v).trim().toUpperCase(); return S_SCALE.includes(r) ? r : null; }
// a rating on either scale, as a rung on the Moody's scale: 0 is Aaa or AAA
function rung(v, fn) { const m = moodysOf(v); if (m) return { scale: 'm', i: M_SCALE.indexOf(m) }; const s = spOf(v); if (s) return { scale: 's', i: Math.min(20, S_SCALE.indexOf(s)) }; fail(fn + ': "' + v + '" is not a Moody\'s or S&P rating'); }
const AGG_COND = { SUM: 1, COUNT: 0, AVG: 1, WAVG: 2, MINOF: 1, MAXOF: 1 };

// ---------- tokens and parser
function tokenize(src) {
  const s = String(src == null ? '' : src).replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '<>');
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = s.slice(i); let m;
    if ((m = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/))) { out.push({ k: 'num', v: parseFloat(m[0]), text: m[0], at: i }); i += m[0].length; continue; }
    if (c === '"' || c === "'") { const j = s.indexOf(c, i + 1); if (j < 0) fail('The text starting at position ' + (i + 1) + ' has no closing quote'); out.push({ k: 'str', v: s.slice(i + 1, j), at: i }); i = j + 1; continue; }
    if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) { out.push({ k: 'id', v: m[0], at: i }); i += m[0].length; continue; }
    if ((m = rest.match(/^(<=|>=|<>|!=|==|&&|\|\|)/))) { out.push({ k: 'op', v: m[0], at: i }); i += 2; continue; }
    if ('+-*/^%(),=<>!'.includes(c)) { out.push({ k: 'op', v: c, at: i }); i++; continue; }
    if (c === '$' || c === ',') fail('Write amounts without "$" or thousands commas: 2500000, not $2,500,000 (position ' + (i + 1) + ')');
    fail('"' + c + '" at position ' + (i + 1) + ' is not part of a formula');
  }
  out.push({ k: 'end', at: s.length });
  return out;
}
function parse(src) {
  const T = tokenize(src); let p = 0;
  const at = t => t.k === 'end' ? ' at the end' : ' at position ' + (t.at + 1);
  const isOp = v => T[p].k === 'op' && T[p].v === v;
  const isKw = w => T[p].k === 'id' && T[p].v.toUpperCase() === w && !(T[p + 1].k === 'op' && T[p + 1].v === '(');
  const expect = v => { if (!isOp(v)) fail('Expected "' + v + '"' + at(T[p])); p++; };
  function orE() { let a = andE(); while (isKw('OR') || isOp('||')) { p++; a = { t: 'logic', op: 'OR', a, b: andE() }; } return a; }
  function andE() { let a = notE(); while (isKw('AND') || isOp('&&')) { p++; a = { t: 'logic', op: 'AND', a, b: notE() }; } return a; }
  function notE() { if ((T[p].k === 'id' && T[p].v.toUpperCase() === 'NOT') || isOp('!')) { p++; return { t: 'not', a: notE() }; } return cmpE(); }
  function cmpE() {
    const a = addE(); const t = T[p];
    if (t.k === 'op' && ['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(t.v)) { p++; return { t: 'cmp', op: t.v === '==' ? '=' : t.v === '!=' ? '<>' : t.v, a, b: addE() }; }
    return a;
  }
  function addE() { let a = mulE(); while (isOp('+') || isOp('-')) { const op = T[p++].v; a = { t: 'bin', op, a, b: mulE() }; } return a; }
  function mulE() { let a = unE(); while (isOp('*') || isOp('/')) { const op = T[p++].v; a = { t: 'bin', op, a, b: unE() }; } return a; }
  function unE() { if (isOp('-') || isOp('+')) { const op = T[p++].v; const a = unE(); return op === '-' ? { t: 'neg', a } : a; } return powE(); }
  function powE() { const a = postE(); if (isOp('^')) { p++; return { t: 'bin', op: '^', a, b: unE() }; } return a; }
  function postE() { let a = prim(); while (isOp('%')) { p++; a = { t: 'pct', a }; } return a; }
  function prim() {
    const t = T[p];
    if (t.k === 'num') { p++; return { t: 'num', v: t.v, text: t.text }; }
    if (t.k === 'str') { p++; return { t: 'str', v: t.v }; }
    if (t.k === 'op' && t.v === '(') { p++; const e = orE(); expect(')'); return { t: 'paren', a: e }; }
    if (t.k === 'id') {
      p++; const U = t.v.toUpperCase();
      if (isOp('(')) {
        const F = FUNCS[U]; if (!F) fail('There is no function ' + t.v + at(t) + '. The functions are ' + Object.keys(FUNCS).join(', '));
        p++; const args = [];
        if (!isOp(')')) { args.push(orE()); while (isOp(',')) { p++; args.push(orE()); } }
        expect(')');
        if (args.length < F.n[0] || args.length > F.n[1]) fail(U + ' takes ' + (F.n[0] === F.n[1] ? F.n[0] : F.n[0] + ' to ' + (F.n[1] > 9 ? 'any number of' : F.n[1])) + ' value' + (F.n[1] === 1 ? '' : 's') + ': ' + F.sig);
        return { t: 'call', fn: U, args };
      }
      if (U === 'TRUE') return { t: 'num', v: 1, text: 'TRUE' };
      if (U === 'FALSE') return { t: 'num', v: 0, text: 'FALSE' };
      if (U === 'AND' || U === 'OR') fail(U + at(t) + ' needs a value on each side');
      return { t: 'ref', name: t.v, key: t.v.toLowerCase() };
    }
    if (t.k === 'end') fail('The formula ends too soon');
    fail('Unexpected "' + t.v + '"' + at(t));
  }
  if (T[0].k === 'end') fail('The formula is empty');
  const ast = orE();
  if (T[p].k !== 'end') fail('Unexpected "' + T[p].v + '"' + at(T[p]) + (T[p].k === 'id' || T[p].k === 'num' ? ': is an operator missing before it?' : ''));
  return ast;
}
// every name a formula uses, with whether it sits inside SUM, AVG and the like
function refsOf(ast) {
  const out = [];
  (function walk(n, inAgg) {
    if (!n) return;
    if (n.t === 'ref') out.push({ key: n.key, name: n.name, inAgg });
    else if (n.t === 'call') n.args.forEach(a => walk(a, inAgg || !!FUNCS[n.fn].agg));
    else ['a', 'b'].forEach(k => n[k] && walk(n[k], inAgg));
  })(ast, false);
  return out;
}
const hasAgg = ast => { let f = false; (function walk(n) { if (!n || f) return; if (n.t === 'call') { if (FUNCS[n.fn].agg) f = true; n.args.forEach(walk); } else ['a', 'b'].forEach(k => n[k] && walk(n[k])); })(ast); return f; };

// ---------- values: numbers, text, or blank (null)
const isBlank = v => v == null || v === '';
const numLike = v => typeof v === 'number' || (typeof v === 'string' && /^\s*\(?-?[$]?[\d,]*\.?\d+\)?%?\s*$/.test(v) && /\d/.test(v));
function cellValue(v) {
  if (v === true) return 1; if (v === false) return 0;
  if (v == null) return null; if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim(); if (s === '') return null;
  if (numLike(s)) { const neg = /^\(.*\)$/.test(s); const n = parseFloat(s.replace(/[()$,%\s]/g, '')); return isFinite(n) ? (neg ? -n : n) : s; }
  return s;
}
const isDateText = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
function toNum(v, what) {
  if (isBlank(v)) return 0; if (typeof v === 'number') return v;
  const c = cellValue(v); if (typeof c === 'number') return c;
  if (isDateText(v)) fail((what ? what + ' is ' : '') + v + ', a date. Use DAYS(start, end) for the days between two dates, or EDATE(date, months) to move a date');
  fail((what ? what + ' is ' : '') + '"' + v + '", which is text, not a number');
}
// dates are text, yyyy-mm-dd (a tape's m/d/yyyy is read too); worked on as UTC days
function toDate(v) {
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  fail('"' + s + '" is not a date. Write dates as "yyyy-mm-dd"');
}
const isoDay = t => new Date(t).toISOString().slice(0, 10);
function moveMonths(t, n) { const d = new Date(t); const y = d.getUTCFullYear(), mo = d.getUTCMonth() + n; const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); return isoDay(Date.UTC(y, mo, Math.min(d.getUTCDate(), last))); }
const truthy = v => typeof v === 'number' ? v !== 0 && !isNaN(v) : isBlank(v) ? false : /^(y|yes|true|1)$/i.test(String(v).trim()) || (numLike(v) && toNum(v) !== 0);
function compare(a, b, op) {
  let x, y;
  if ((isBlank(a) || numLike(a)) && (isBlank(b) || numLike(b))) { x = toNum(a); y = toNum(b); }
  else { x = isBlank(a) ? '' : String(a).trim().toLowerCase(); y = isBlank(b) ? '' : String(b).trim().toLowerCase(); }
  const r = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
  return r ? 1 : 0;
}
const round = (x, d) => { const k = Math.pow(10, d || 0); return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * k) / k; };
const r2 = x => round(x, 2);

// ---------- evaluation. X: { look(node) → value, agg(node) → value }
function ev(n, X) {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'paren': return ev(n.a, X);
    case 'pct': return toNum(ev(n.a, X)) / 100;
    case 'neg': return -toNum(ev(n.a, X));
    case 'not': return truthy(ev(n.a, X)) ? 0 : 1;
    case 'logic': { const a = truthy(ev(n.a, X)); if (n.op === 'AND') return a && truthy(ev(n.b, X)) ? 1 : 0; return a || truthy(ev(n.b, X)) ? 1 : 0; }
    case 'cmp': return compare(ev(n.a, X), ev(n.b, X), n.op);
    case 'bin': {
      const a = toNum(ev(n.a, X)), b = toNum(ev(n.b, X));
      if (n.op === '+') return a + b; if (n.op === '-') return a - b; if (n.op === '*') return a * b;
      if (n.op === '/') { if (b === 0) fail('Division by zero: ' + show(n.b) + ' is 0'); return a / b; }
      const v = Math.pow(a, b); if (!isFinite(v)) fail(show(n) + ' has no value'); return v;
    }
    case 'ref': return X.look(n);
    case 'call': {
      const A = n.args, F = n.fn;
      if (FUNCS[F].agg) return X.agg(n);
      if (F === 'IF') return truthy(ev(A[0], X)) ? ev(A[1], X) : ev(A[2], X);
      if (F === 'IFBLANK') { const v = ev(A[0], X); return isBlank(v) ? ev(A[1], X) : v; }
      if (F === 'ISBLANK') return isBlank(ev(A[0], X)) ? 1 : 0;
      if (F === 'AND') return A.every(a => truthy(ev(a, X))) ? 1 : 0;
      if (F === 'OR') return A.some(a => truthy(ev(a, X))) ? 1 : 0;
      if (F === 'CONTAINS') { const a = ev(A[0], X), b = ev(A[1], X); return String(isBlank(a) ? '' : a).toLowerCase().includes(String(isBlank(b) ? '' : b).toLowerCase()) ? 1 : 0; }
      if (F === 'DAYS' || F === 'YEARS' || F === 'EDATE' || F === 'YEAR' || F === 'MONTH') {
        const a = ev(A[0], X); if (isBlank(a)) return null; const ta = toDate(a); // a blank date gives a blank result
        if (F === 'YEAR') return new Date(ta).getUTCFullYear(); if (F === 'MONTH') return new Date(ta).getUTCMonth() + 1;
        if (F === 'EDATE') return moveMonths(ta, Math.round(toNum(ev(A[1], X))));
        const b = ev(A[1], X); if (isBlank(b)) return null; const d = Math.round((toDate(b) - ta) / 864e5); return F === 'DAYS' ? d : d / 365;
      }
      if (F === 'SP_TO_MOODYS' || F === 'MOODYS_TO_SP' || F === 'NOTCH' || F === 'RATING_RANK' || F === 'RATING_FACTOR') {
        const a = ev(A[0], X); if (isBlank(a) || /^\s*(NR|WR|N\/A)\s*$/i.test(String(a))) return null; // not rated: blank
        const g = rung(a, F);
        if (F === 'SP_TO_MOODYS') return M_SCALE[g.i];
        if (F === 'MOODYS_TO_SP') return S_SCALE[g.i];
        if (F === 'RATING_RANK') return g.i + 1;
        if (F === 'RATING_FACTOR') { const r = M_SCALE[g.i]; return (ENV.rf && ENV.rf[r] != null ? +ENV.rf[r] : RF_STD[r]); }
        const j = Math.max(0, Math.min(20, g.i + Math.round(toNum(ev(A[1], X))))); return g.scale === 'm' ? M_SCALE[j] : S_SCALE[j];
      }
      if (F === 'DATE') { const [y, mo, d] = A.map(a => Math.round(toNum(ev(a, X)))); if (!(y > 1900 && y < 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) fail('DATE(' + y + ', ' + mo + ', ' + d + ') is not a date'); const t = Date.UTC(y, mo - 1, d); if (new Date(t).getUTCDate() !== d) fail('DATE(' + y + ', ' + mo + ', ' + d + ') is not a date'); return isoDay(t); }
      const xs = A.map(a => toNum(ev(a, X)));
      if (F === 'MIN') return Math.min(...xs); if (F === 'MAX') return Math.max(...xs);
      if (F === 'ABS') return Math.abs(xs[0]);
      if (F === 'ROUND') return round(xs[0], A.length > 1 ? Math.round(xs[1]) : 0);
    }
  }
  fail('Cannot evaluate this formula');
}
// aggregate over the loans; inside, each loan's columns are in scope
function aggregate(n, X, R, rowLook) {
  if (X.cache && X.cache.has(n)) return X.cache.get(n).v;
  const F = n.fn, A = n.args; const ci = AGG_COND[F]; const cond = A[ci]; const body = F === 'COUNT' ? null : A[0], wt = F === 'WAVG' ? A[1] : null;
  let s = 0, w = 0, cnt = 0, mn = Infinity, mx = -Infinity; const hit = [];
  for (let i = 0; i < R.count; i++) {
    const RX = { look: m => rowLook(i, m), agg: m => aggregate(m, X, R, rowLook) };
    if (cond && !truthy(ev(cond, RX))) continue;
    cnt++;
    if (!body) { hit.push([i]); continue; }
    const v = toNum(ev(body, RX), 'For ' + R.label(i) + ', ' + show(body));
    if (wt) { const k = toNum(ev(wt, RX), 'For ' + R.label(i) + ', ' + show(wt)); s += v * k; w += k; hit.push([i, v, k]); }
    else { s += v; mn = Math.min(mn, v); mx = Math.max(mx, v); hit.push([i, v]); }
  }
  const v = F === 'SUM' ? s : F === 'COUNT' ? cnt : F === 'AVG' ? (cnt ? s / cnt : null) : F === 'WAVG' ? (w ? s / w : null) : F === 'MINOF' ? (cnt ? mn : null) : (cnt ? mx : null);
  if (X.cache) X.cache.set(n, { v, cnt, hit, of: R.count });
  return v;
}

// ---------- printing a formula, with names or with their values
const fmtV = v => {
  if (isBlank(v)) return 'blank';
  if (typeof v === 'string') return isDateText(v) ? v : '"' + v + '"';
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return (v < 0 ? '−' : '') + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : '') + String(+a.toFixed(6));
};
function show(n, val) {
  const S = m => show(m, val);
  switch (n.t) {
    case 'num': return n.text;
    case 'str': return '"' + n.v + '"';
    case 'paren': return '(' + S(n.a) + ')';
    case 'pct': return S(n.a) + '%';
    case 'neg': return (val ? '−' : '-') + S(n.a);
    case 'not': return 'NOT ' + S(n.a);
    case 'logic': return S(n.a) + ' ' + n.op + ' ' + S(n.b);
    case 'cmp': return S(n.a) + ' ' + n.op + ' ' + S(n.b);
    case 'bin': return S(n.a) + ' ' + (val ? { '*': '×', '/': '÷', '-': '−' }[n.op] || n.op : n.op) + ' ' + S(n.b);
    case 'ref': return val ? fmtV(val(n)) : n.name;
    case 'call': return val && FUNCS[n.fn].agg ? fmtV(val(n)) : n.fn + '(' + n.args.map(a => show(a, FUNCS[n.fn].agg ? null : val)).join(', ') + ')';
  }
  return '?';
}

// ---------- the names a formula can use
const STD_COLS = [
  ['id', 'Loan ID', n => n.id], ['obligor', 'Obligor', n => n.obligor], ['industry', "Moody's industry", n => n.mIndustry], ['sp_industry', 'S&P industry', n => n.spIndustry],
  ['country', 'Country', n => n.country], ['asset_type', 'SSL, 2L, UNSEC or BOND', n => n.assetType], ['rate_type', 'FLOAT or FIXED', n => n.rateType],
  ['par', 'Par', n => n.par], ['price', 'Market price', n => n.price], ['purchase_price', 'Purchase price', n => n.purchasePrice], ['spread', 'Spread, %', n => n.spread], ['coupon', 'Coupon, %', n => n.coupon],
  ['moodys_rating', "Moody's default probability rating; blank if the tape has none (the interpreter then uses B2)", (n, w) => isBlank(w && (w.moodysDPR || w.moodys)) ? null : n.moodysDPR],
  ['moodys_facility_rating', "Moody's facility rating; blank if the tape has none", (n, w) => isBlank(w && w.moodysFacility) ? null : n.moodysFacility],
  ['sp_rating', 'S&P rating; blank if the tape has none (the interpreter then uses B)', (n, w) => isBlank(w && w.spRating) ? null : n.spRating],
  ['maturity', 'Maturity date, yyyy-mm-dd', n => n.maturity || null], ['defaulted', '1 if defaulted', n => n.defaulted ? 1 : 0], ['default_date', 'Default date', n => n.defaultDate || null],
  ['cov_lite', '1 if covenant-lite', n => n.covLite ? 1 : 0], ['facility_size', 'Facility size', n => n.facilitySize], ['pik', '1 if PIK', n => n.pik ? 1 : 0], ['revolver', '1 if a revolver or delayed draw', n => n.revolver ? 1 : 0],
  ['dip', '1 if DIP', n => n.dip ? 1 : 0], ['current_pay', '1 if Current Pay', n => n.currentPay ? 1 : 0], ['participation', '1 if a participation', n => n.participation ? 1 : 0], ['zero_coupon', '1 if zero coupon', n => n.zeroCoupon ? 1 : 0],
  ['rating_factor', "Moody's rating factor (worked out)", n => n.rf], ['is_ccc', '1 if in the CCC bucket (worked out)', n => n.ccc ? 1 : 0], ['is_discount', '1 if a Discount Obligation (worked out)', n => n.discount ? 1 : 0],
  ['years_to_maturity', 'Years to maturity from the Payment Date (worked out)', n => n.yrs], ['years_in_default', 'Years in default (worked out)', n => n.yrsDefaulted || 0],
  ['moodys_recovery_rate', "Moody's recovery rate, % (worked out)", n => n.mRR], ['oc_balance', 'Carrying value in Principal Collateral Value, after haircuts (worked out)', n => n.ocPB]
];
const STD = {}; STD_COLS.forEach(([k, label, get]) => { STD[k] = { key: k, name: k, label, get }; });
const ENGINE_FIELDS = ['id', 'obligor', 'mIndustry', 'spIndustry', 'industry', 'moodys', 'country', 'assetType', 'rateType', 'par', 'price', 'purchasePrice', 'spread', 'coupon', 'moodysDPR', 'moodysFacility', 'spRating', 'spRecRating', 'maturity', 'defaulted', 'defaultDate', 'covLite', 'facilitySize', 'payFreq', 'dip', 'currentPay', 'pik', 'revolver', 'participation', 'synthetic', 'zeroCoupon', 'discountCured'];
const snake = s => { let k = String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (/^\d/.test(k)) k = 'c_' + k; return k; };
// columns on the tape beyond the ones the engine reads: kept so formulas can use them
function extraColumns(tape) {
  const byKey = new Map(); const done = new Set(); // one column per name; a key already in snake case wins
  (tape || []).forEach(r => Object.keys(r || {}).forEach(k => { if (done.has(k)) return; done.add(k); if (ENGINE_FIELDS.includes(k)) return; const s = snake(k); if (!s || STD[s]) return; if (!byKey.has(s) || k === s) byKey.set(s, k); }));
  return [...byKey].map(([key, raw]) => ({ raw, key, name: key }));
}
function classKey(id) { return String(id).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
// the interpreter's own figures for the Payment Date, as names
function builtinDefs(spec) {
  const B = []; const add = (name, label, get, group) => B.push({ name, key: name.toLowerCase(), label, get, group });
  const m = spec.meta || {}; const F = spec.fees || {}; const day = v => v ? String(v).slice(0, 10) : null;
  const bpsOn = (sch, d) => { for (const x of sch || []) if (!x.through || d <= x.through) return x.bps; return 0; };
  add('Payment_Date', 'This Payment Date', r => r.paymentDate, 'Dates');
  add('Previous_Payment_Date', 'The Payment Date before this one (the Closing Date before the first)', r => r.prevDate, 'Dates');
  add('First_Payment_Date', 'First Payment Date', () => day(m.firstPaymentDate), 'Dates');
  add('Closing_Date', 'Closing Date', () => day(m.closingDate), 'Dates');
  add('Effective_Date', 'Effective Date', () => day(m.effectiveDate), 'Dates');
  add('Reinvestment_Period_End_Date', 'Last day of the Reinvestment Period', () => day(m.reinvestmentPeriodEnd), 'Dates');
  add('Non_Call_Period_End_Date', 'End of the Non-Call Period', () => day(m.nonCallEnd), 'Dates');
  add('Stated_Maturity_Date', 'Stated Maturity of the notes', () => day(m.statedMaturity), 'Dates');
  add('Target_Par_Amount', 'Target Par Amount', () => m.targetPar != null ? +m.targetPar : null, 'Deal');
  add('Payments_Per_Year', 'Payment Dates a year', () => 12 / (+m.paymentFrequencyMonths || 3), 'Deal');
  add('Subordinated_Notes_Balance', ((spec.equity && spec.equity.name) || 'Subordinated Notes') + ', principal at closing', () => spec.equity && spec.equity.balance != null ? +spec.equity.balance : null, 'Deal');
  if (F.seniorMgmt) add('Senior_Management_Fee_Rate', 'Senior management fee rate on this Payment Date, % a year', r => bpsOn(F.seniorMgmt.schedule, r.paymentDate) / 100, 'Fees');
  if (F.structuring) add('Structuring_Fee_Rate', 'Structuring fee rate on this Payment Date, % a year', r => bpsOn(F.structuring.schedule, r.paymentDate) / 100, 'Fees');
  if (F.subMgmt) add('Subordinated_Management_Fee_Rate', 'Subordinated management fee rate, % a year', () => +F.subMgmt.bps / 100, 'Fees');
  if (F.incentive) add('Incentive_Fee_Hurdle_IRR', 'IRR the Subordinated Notes must reach before the incentive fee, %', () => +F.incentive.hurdleIRR, 'Fees');
  add('Days_In_Period', 'Days in the interest period', r => r.days, 'Period');
  add('Day_Count_Fraction', 'Days in the period ÷ 360', r => r.days / 360, 'Period');
  add('Index_Rate', 'Index rate (' + ((spec.meta && spec.meta.index) || 'LIBOR') + '), %', r => r.libor, 'Period');
  add('Period', 'Payment Date number', r => r.period, 'Period');
  add('In_Reinvestment_Period', '1 in the Reinvestment Period, otherwise 0', r => r.inRP ? 1 : 0, 'Period');
  add('Aggregate_Principal_Balance', 'Par of all the collateral', r => r.pb.parTotal, 'Collateral');
  add('Principal_Collateral_Value', 'OC numerator before payments: par less haircuts, plus principal cash', r => r.pcvInterp != null ? r.pcvInterp : r.pb.pcvOC, 'Collateral');
  add('Defaulted_Haircut', 'Haircut on Defaulted Securities', r => r.pb.haircut.defaulted, 'Collateral');
  add('Discount_Haircut', 'Haircut on Discount Obligations', r => r.pb.haircut.discount, 'Collateral');
  add('CCC_Excess', 'Par in the CCC bucket above its limit', r => r.pb.cccExcess, 'Collateral');
  add('CCC_Haircut', 'Haircut on the CCC Excess', r => r.pb.haircut.ccc, 'Collateral');
  add('Interest_Proceeds', 'Interest Proceeds, entered or estimated', r => r.interestProceeds, 'Cash');
  add('Estimated_Interest_Proceeds', 'Interest Proceeds estimated from the tape', r => r.estInterest, 'Cash');
  add('Principal_Proceeds', 'Principal Proceeds on deposit', r => r.principalProceeds, 'Cash');
  add('Fee_Basis_Amount', 'Fee Basis Amount as the interpreter works it out', r => r.feeBasis, 'Fees');
  add('Senior_Management_Fee_Due', 'Senior management fee due', r => r.dues.seniorMgmt, 'Fees');
  add('Structuring_Fee_Due', 'Structuring fee due', r => r.dues.structuring, 'Fees');
  add('Subordinated_Management_Fee_Due', 'Subordinated management fee due this period', r => r.dues.subMgmtCurrent, 'Fees');
  add('Administrative_Expenses_Due', 'Administrative Expenses due, before the cap', r => r.adminDue, 'Fees');
  add('Administrative_Expense_Cap', 'Administrative Expense Cap available', r => isFinite(r.adminCap) ? r.adminCap : null, 'Fees');
  (spec.classes || []).forEach(c => {
    const k = classKey(c.id); const N = r => r.notes && r.notes[c.id];
    add('Class_' + k + '_Balance', 'Class ' + c.id + ' principal before this date', r => N(r) ? N(r).bal0 : null, 'Notes');
    add('Class_' + k + '_Deferred_Interest', 'Class ' + c.id + ' deferred interest before this date', r => N(r) ? N(r).def0 : null, 'Notes');
    add('Class_' + k + '_Rate', 'Class ' + c.id + ' interest rate, %', r => N(r) ? N(r).rate : null, 'Notes');
    add('Class_' + k + '_Interest_Due', 'Class ' + c.id + ' interest due', r => N(r) ? N(r).intDue : null, 'Notes');
  });
  ((spec.coverage && spec.coverage.tests) || []).forEach((t, i) => {
    const k = classKey(t.id); const T = r => (r.preTests || [])[i];
    add('OC_Ratio_' + k, (t.label || t.id) + ' OC ratio before payments, %', r => T(r) && T(r).oc && isFinite(T(r).oc.ratio) ? T(r).oc.ratio : null, 'Tests');
    if (t.oc && t.oc.trigger != null) add('OC_Trigger_' + k, (t.label || t.id) + ' OC trigger, %', () => +t.oc.trigger, 'Tests');
    if (t.ic) add('IC_Ratio_' + k, (t.label || t.id) + ' IC ratio before payments, %', r => T(r) && T(r).ic && isFinite(T(r).ic.ratio) ? T(r).ic.ratio : null, 'Tests');
    if (t.ic && t.ic.trigger != null) add('IC_Trigger_' + k, (t.label || t.id) + ' IC trigger, %', () => +t.ic.trigger, 'Tests');
  });
  const rt = spec.coverage && spec.coverage.reinvestmentTest, eod = spec.coverage && spec.coverage.eodTest;
  if (rt) { add('Reinvestment_Test_Ratio', (rt.label || 'Interest Reinvestment Test') + ' ratio before payments, %', r => r.preIRT && isFinite(r.preIRT.ratio) ? r.preIRT.ratio : null, 'Tests'); add('Reinvestment_Test_Trigger', (rt.label || 'Interest Reinvestment Test') + ' trigger, %', () => +rt.trigger, 'Tests'); }
  if (eod) { add('Event_Of_Default_Ratio', (eod.label || 'Event of Default test') + ' ratio, %', r => r.preEoD && isFinite(r.preEoD.ratio) ? r.preEoD.ratio : null, 'Tests'); add('Event_Of_Default_Trigger', (eod.label || 'Event of Default test') + ' trigger, %', () => +eod.trigger, 'Tests'); }
  return B;
}

// ---------- what a calculation can replace
const TARGETS = {
  deal: [
    { id: 'feeBasis', label: 'Fee Basis Amount', how: 'input', field: 'feeBasis', proj: true, d: 'the management fees are worked out on it' },
    { id: 'pcvOC', label: 'Principal Collateral Value', how: 'ov', proj: true, d: 'the numerator of every OC test' },
    { id: 'seniorMgmt', label: 'Senior management fee due', how: 'ov', proj: true, d: 'this period, before unpaid amounts brought forward' },
    { id: 'structuring', label: 'Structuring fee due', how: 'ov', proj: true, d: 'this period' },
    { id: 'subMgmtCurrent', label: 'Subordinated management fee due', how: 'ov', proj: true, d: 'this period, before unpaid amounts brought forward' },
    { id: 'interestProceeds', label: 'Interest Proceeds', how: 'input', field: 'interestProceeds' },
    { id: 'principalProceeds', label: 'Principal Proceeds', how: 'input', field: 'principalProceeds' },
    { id: 'adminDue', label: 'Administrative Expenses entered', how: 'input', field: 'adminDue', d: 'the amount on the Manual inputs tab; manual rows still add to it' }
  ],
  loan: [
    { id: 'par', label: 'Par', field: 'par', d: 'every collateral figure, test and fee then uses this balance' },
    { id: 'price', label: 'Market price', field: 'price' },
    { id: 'purchasePrice', label: 'Purchase price', field: 'purchasePrice' },
    { id: 'spread', label: 'Spread, %', field: 'spread' },
    { id: 'coupon', label: 'Coupon, %', field: 'coupon' },
    { id: 'defaulted', label: 'Defaulted', field: 'defaulted', d: 'a true value marks the loan defaulted' },
    { id: 'moodysDPR', label: "Moody's rating", field: 'moodysDPR', text: 'm', d: 'the default probability rating: rating factors, the CCC bucket, recoveries' },
    { id: 'moodysFacility', label: "Moody's facility rating", field: 'moodysFacility', text: 'm', d: 'used for recovery rates and discount obligations' },
    { id: 'spRating', label: 'S&P rating', field: 'spRating', text: 's', d: 'the CCC bucket and S&P recoveries' }
  ]
};
const targetOf = (kind, id) => (TARGETS[kind] || []).find(t => t.id === id) || null;
const lc = t => /^(Moody|S&P)/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); // a label inside a sentence
const TCOL = { par: 'par', price: 'price', purchasePrice: 'purchase_price', spread: 'spread', coupon: 'coupon', defaulted: 'defaulted', moodysDPR: 'moodys_rating', moodysFacility: 'moodys_facility_rating', spRating: 'sp_rating' }; // the column each replaces
const interpValue = (id, r, inp) => {
  if (!r) return null;
  if (id === 'feeBasis') return r.feeBasis; if (id === 'interestProceeds') return r.interestProceeds; if (id === 'principalProceeds') return r.principalProceeds;
  if (id === 'adminDue') return r.adminEntered;
  if (id === 'pcvOC') return r.pcvInterp != null ? r.pcvInterp : r.pb.pcvOC;
  if (id === 'seniorMgmt') return r.dues.seniorMgmt - (+inp.unpaidSeniorFees || 0);
  if (id === 'structuring') return r.dues.structuring; if (id === 'subMgmtCurrent') return r.dues.subMgmtCurrent;
  return null;
};

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isFormulaRow = m => !!m && typeof m.formula === 'string' && m.formula.trim() !== '';

// ---------- compile: parse each calculation, check its names, order them so each comes after what it uses
function compile(calcs, spec, tape) {
  const B = builtinDefs(spec); const BK = new Map(B.map(b => [b.key, b]));
  const extra = extraColumns(tape); const XK = new Map(extra.map(c => [c.key, c]));
  const vars = []; const byKey = new Map();
  (calcs || []).forEach((c, i) => {
    const v = { id: c.id || 'c' + i, name: String(c.name || '').trim(), key: String(c.name || '').trim().toLowerCase(), kind: c.kind === 'loan' ? 'loan' : 'deal', formula: String(c.formula || '').trim(), use: c.use || '', note: c.note || '', on: c.on !== false, err: null, ast: null, deps: [], refs: [] };
    vars.push(v);
    if (!v.on) return;
    if (!v.name) { v.err = 'Give the calculation a name'; return; }
    if (!NAME_RE.test(v.name)) { v.err = 'A name uses letters, digits and underscores, and starts with a letter: Fee_Basis_Amount_2'; return; }
    const U = v.name.toUpperCase();
    if (FUNCS[U] || KEYWORDS.includes(U)) { v.err = v.name + ' is a function or word of the formula language; choose another name'; return; }
    if (BK.has(v.key)) { v.err = v.name + ' is the name of a built-in figure; choose another name, such as ' + v.name + '_2'; return; }
    if (STD[v.key] || XK.has(v.key)) { v.err = v.name + ' is a column on the tape; choose another name, such as ' + v.name + '_2'; return; }
    if (byKey.has(v.key)) { v.err = 'Another calculation is already called ' + byKey.get(v.key).name; return; }
    byKey.set(v.key, v);
    if (!v.formula) { v.err = 'Enter a formula'; return; }
    try { v.ast = parse(v.formula.replace(/^=/, '')); } catch (e) { v.err = e instanceof CalcError ? e.message : 'The formula could not be read'; return; }
    v.refs = refsOf(v.ast);
  });
  const allNames = () => B.map(b => b.name).concat(STD_COLS.map(c => c[0]), extra.map(c => c.name), vars.filter(x => x.on && x.name).map(x => x.name));
  const kindOf = key => byKey.has(key) ? (byKey.get(key).kind === 'loan' ? 'loanvar' : 'dealvar') : BK.has(key) ? 'builtin' : STD[key] || XK.has(key) ? 'column' : null;
  const off = new Map(vars.filter(x => !x.on && x.key).map(x => [x.key, x]));
  const checkRefs = (refs, kind) => {
    for (const r of refs) {
      const k = kindOf(r.key);
      if (!k && off.has(r.key)) return 'Uses ' + off.get(r.key).name + ', which is switched off';
      if (!k) return 'Unknown name ' + r.name + suggest(r.name, allNames());
      if (kind === 'deal' && !r.inAgg && (k === 'column' || k === 'loanvar')) return r.name + ' is ' + (k === 'column' ? 'a loan column' : 'a loan-level calculation') + '. In a deal figure use it inside SUM, AVG, WAVG, MINOF, MAXOF or COUNT, e.g. SUM(' + r.name + ')';
    }
    return null;
  };
  vars.forEach(v => {
    if (!v.on || v.err || !v.ast) return;
    v.err = checkRefs(v.refs, v.kind);
    v.deps = [...new Set(v.refs.map(r => r.key).filter(k => byKey.has(k)))];
    if (v.use && !targetOf(v.kind, v.use)) v.err = v.err || 'This calculation cannot replace "' + v.use + '"';
  });
  // one calculation per replaced figure
  const usedT = new Map();
  vars.forEach(v => { if (!v.on || !v.use) return; const T = targetOf(v.kind, v.use); if (!T) return; const k = v.kind + ':' + v.use; if (usedT.has(k)) v.err = v.err || T.label + ' is already replaced by ' + usedT.get(k).name; else usedT.set(k, v); });
  // order by dependency; cycles and broken inputs are errors
  const order = []; const mark = new Map();
  const visit = (v, path) => {
    if (mark.get(v.key) === 2) return; if (mark.get(v.key) === 1) { const cyc = path.slice(path.indexOf(v.key)).concat(v.key).map(k => byKey.get(k).name); cyc.forEach(n => { const x = byKey.get(n.toLowerCase()); if (!x.err) x.err = 'Circular: ' + cyc.join(' uses ') + ''; }); return; }
    mark.set(v.key, 1);
    v.deps.forEach(d => { const w = byKey.get(d); if (w && w.on && w !== v) visit(w, path.concat(v.key)); else if (w === v && !v.err) v.err = v.name + ' uses itself'; });
    mark.set(v.key, 2); order.push(v);
  };
  vars.filter(v => v.on && v.ast && byKey.get(v.key) === v).forEach(v => visit(v, []));
  return { vars, order, byKey, B, BK, extra, XK, kindOf, checkRefs, spec };
}
function suggest(name, names) {
  const a = name.toLowerCase(); let best = null, bd = 99;
  const part = a.length >= 3 ? names.filter(n => n.toLowerCase().startsWith(a) || n.toLowerCase().includes(a)).sort((x, y) => x.length - y.length)[0] : null;
  if (part) return '. Did you mean ' + part + '?';
  for (const n of names) { const d = lev(a, n.toLowerCase()); if (d < bd) { bd = d; best = n; } }
  return best && bd <= Math.max(2, Math.floor(a.length / 4)) ? '. Did you mean ' + best + '?' : '. The names you can use are listed on the Calculations tab';
}
function lev(a, b) { const m = a.length, n = b.length; if (Math.abs(m - n) > 6) return 99; let p = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const q = [i]; for (let j = 1; j <= n; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; } return p[n]; }

// rows: each loan's columns, from the tape and the interpreter's analysis of it
function rowsOf(E, tape, res, extra) {
  const N = res && res.pf && res.pf.rows && res.pf.rows.length === tape.length ? res.pf.rows : tape.map(E.normaliseRow);
  return { count: tape.length, raw: tape, N, label: i => (N[i].obligor || 'loan ' + N[i].id) + ' (' + N[i].id + ')', id: i => N[i].id, obligor: i => N[i].obligor,
    col(i, key) { if (STD[key]) return STD[key].get(N[i], tape[i]); const x = extra.find(c => c.key === key); return x ? cellValue(tape[i][x.raw]) : undefined; } };
}

// ---------- evaluate every calculation in order, against one Payment Date's figures and rows
function evaluate(M, res, R, prev) {
  ENV = { rf: (M.spec && M.spec.ratingFactors) || RF_STD };
  const st = { vals: new Map(), errs: new Map(), aggs: new Map(), used: new Map() };
  const B = new Map(M.B.map(b => [b.key, (() => { try { const v = b.get(res); return v == null || (typeof v === 'number' && !isFinite(v)) ? null : v; } catch (e) { return null; } })()]));
  st.builtins = B;
  const dealLook = (n, v) => {
    const k = n.key;
    if (M.byKey.has(k)) { const w = M.byKey.get(k); if (w.kind === 'deal') { if (st.errs.has(k)) fail('Uses ' + w.name + ', which has an error'); return st.vals.get(k); } }
    if (B.has(k)) return B.get(k);
    fail(n.name + ' is a loan column; use it inside SUM, AVG, WAVG, MINOF, MAXOF or COUNT');
  };
  const rowLook = (i, n) => {
    const k = n.key;
    if (M.byKey.has(k)) { const w = M.byKey.get(k); if (w.kind === 'loan') { if (st.errs.has(k)) fail('Uses ' + w.name + ', which has an error'); return st.vals.get(k)[i]; } return dealLook(n); }
    const c = R.col(i, k); if (c !== undefined) return c;
    return dealLook(n);
  };
  for (const v of M.order) {
    if (v.err) { st.errs.set(v.key, v.err); continue; }
    if (prev && v.kind === 'loan') { if (prev.errs.has(v.key)) st.errs.set(v.key, prev.errs.get(v.key)); else st.vals.set(v.key, prev.vals.get(v.key)); continue; }
    const cache = new Map();
    try {
      if (v.kind === 'deal') {
        const X = { cache, look: n => dealLook(n), agg: n => aggregate(n, X, R, rowLook) };
        const val = ev(v.ast, X); st.vals.set(v.key, typeof val === 'number' && !isFinite(val) ? null : val); st.aggs.set(v.key, cache);
      } else {
        const out = new Array(R.count);
        for (let i = 0; i < R.count; i++) {
          const X = { cache, look: n => rowLook(i, n), agg: n => aggregate(n, X, R, rowLook) };
          try { const val = ev(v.ast, X); out[i] = typeof val === 'number' && !isFinite(val) ? null : val; } catch (e) { if (e instanceof CalcError) fail('For ' + R.label(i) + ': ' + e.message); throw e; }
        }
        st.vals.set(v.key, out); st.aggs.set(v.key, cache);
      }
    } catch (e) { if (!(e instanceof CalcError)) throw e; st.errs.set(v.key, e.message); }
  }
  M.vars.forEach(v => { if (v.on && v.err && !st.errs.has(v.key) && v.key) st.errs.set(v.key, v.err); });
  st.dealLook = dealLook; st.rowLook = rowLook;
  return st;
}
// a formula typed into a Manual inputs amount: a deal-level value
function evalManual(M, st, R, formula) {
  let ast; try { ast = parse(String(formula).replace(/^\s*=/, '')); } catch (e) { if (e instanceof CalcError) return { err: e.message }; throw e; }
  const e1 = M.checkRefs(refsOf(ast), 'deal'); if (e1) return { err: e1 };
  const cache = new Map(); const X = { cache, look: n => st.dealLook(n), agg: n => aggregate(n, X, R, st.rowLook) };
  try { const v = ev(ast, X); if (isBlank(v)) return { amount: 0, ast, blank: true }; return { amount: r2(toNum(v, 'The result')), ast, cache }; }
  catch (e) { if (e instanceof CalcError) return { err: e.message }; throw e; }
}

// ---------- your adjustments to the tests (Tests tab): lists of loan-level conditions in the same formula language
// rules: { adj: { 'conc:<id>' | 'quality:<id>' | 'coverage:<id>': { numOnly: [..], numSkip: [..], denSkip: [..], denCash, on } },
//          custom: [{ id, label, kind: 'share' | 'largest', field, numOnly, numSkip, denSkip, denCash, limit, op, on }] }
// numOnly conditions must all hold (AND); a loan meeting any numSkip or denSkip condition is left out (OR)
const condList = L => (Array.isArray(L) ? L : []).map(x => String(x == null ? '' : x).trim().replace(/^=\s*/, '')).filter(Boolean);
const onlyOf = a => a.numMode === 'all' ? [] : condList(a.numOnly); // the numerator's own conditions, unless you switched back to the indenture's
const adjActive = a => !!a && a.on !== false && !!(onlyOf(a).length || condList(a.numSkip).length || condList(a.denSkip).length || a.denCash === false);
function hasTestRules(T) { return !!T && (Object.values(T.adj || {}).some(adjActive) || (T.custom || []).some(u => u && u.on !== false)); }
const joinConds = (L, op) => L.length === 1 ? L[0] : L.map(x => /\b(AND|OR)\b|&&|\|\|/i.test(x) ? '(' + x + ')' : x).join(' ' + op + ' ');
// one condition, worked out for every loan: { flags, n } or { err }
function rowCond(M, st, R, text) {
  let ast; try { ast = parse(String(text).replace(/^\s*=/, '')); } catch (e) { if (e instanceof CalcError) return { err: e.message }; throw e; }
  const e1 = M.checkRefs(refsOf(ast), 'loan'); if (e1) return { err: e1 };
  const cache = new Map(); const out = new Array(R.count);
  try {
    for (let i = 0; i < R.count; i++) {
      const X = { cache, look: n => st.rowLook(i, n), agg: n => aggregate(n, X, R, st.rowLook) };
      try { out[i] = truthy(ev(ast, X)); } catch (e) { if (e instanceof CalcError) fail('For ' + R.label(i) + ': ' + e.message); throw e; }
    }
  } catch (e) { if (e instanceof CalcError) return { err: e.message }; throw e; }
  return { flags: out, n: out.filter(Boolean).length };
}
// a loan column's value for every loan (to group by): { vals } or { err }
function rowValues(M, st, R, field) {
  const f = String(field || '').trim(); const k = f.toLowerCase(); const kind = M.kindOf(k);
  if (!f) return { err: 'Choose the field to group by' };
  if (kind !== 'column' && kind !== 'loanvar') return { err: f + ' is not a loan column' + (kind ? '' : suggest(f, STD_COLS.map(c => c[0]).concat(M.extra.map(c => c.name)))) };
  try { return { vals: Array.from({ length: R.count }, (_, i) => st.rowLook(i, { key: k, name: f })) }; } catch (e) { if (e instanceof CalcError) return { err: e.message }; throw e; }
}
function testAdjustFrom(M, st, R, T) {
  const adjust = { ids: R.N.map(n => n.id), conc: {}, quality: {}, coverage: {}, custom: [] };
  const errs = {}, counts = {}; let any = false;
  const one = (key, a, lists) => {
    const flags = {}, text = {}; let bad = null;
    lists.forEach(([k, op]) => {
      const L = k === 'numOnly' ? onlyOf(a) : condList(a[k]); if (!L.length) return;
      const res = L.map(c => ({ c, r: rowCond(M, st, R, c) }));
      res.filter(x => x.r.err).forEach(x => (bad = bad || []).push({ list: k, cond: x.c, err: x.r.err }));
      if (res.some(x => x.r.err)) return;
      flags[k] = R.N.map((_, i) => op === 'AND' ? res.every(x => x.r.flags[i]) : res.some(x => x.r.flags[i]));
      text[k] = joinConds(L, op); (counts[key] = counts[key] || {})[k] = flags[k].filter(Boolean).length;
      counts[key][k + 'Each'] = res.map(x => x.r.n);
    });
    if (bad) { errs[key] = bad; return null; }
    const summary = [text.numOnly ? 'only loans where ' + text.numOnly : '', text.numSkip ? 'numerator leaves out ' + text.numSkip : '', text.denSkip ? 'denominator leaves out ' + text.denSkip : '', a.denCash === false ? 'no Principal Proceeds in the denominator' : ''].filter(Boolean).join('; ');
    return Object.assign({ text, summary, denCash: a.denCash !== false }, flags);
  };
  const ALL = [['numOnly', 'AND'], ['numSkip', 'OR'], ['denSkip', 'OR']];
  Object.entries(T.adj || {}).forEach(([key, a]) => {
    if (!adjActive(a)) return; const m = key.match(/^(conc|quality|coverage):(.+)$/); if (!m) return;
    const o = one(key, a, m[1] === 'coverage' ? [['numSkip', 'OR']] : ALL); if (!o) return;
    if (m[1] === 'coverage' && !o.numSkip) return;
    adjust[m[1]][m[2]] = o; any = true;
  });
  (T.custom || []).forEach(u => {
    if (!u || u.on === false || !u.id) return; const key = 'custom:' + u.id; const kind = u.kind === 'largest' ? 'largest' : 'share';
    const problems = [];
    if (kind === 'share' && !condList(u.numOnly).length) problems.push({ list: 'numOnly', cond: '', err: 'Say which loans the test counts' });
    if (u.limit === '' || u.limit == null || !isFinite(+u.limit)) problems.push({ list: 'limit', cond: '', err: 'Enter the limit, as a percentage' });
    let groups = null; if (kind === 'largest') { const g = rowValues(M, st, R, u.field); if (g.err) problems.push({ list: 'field', cond: String(u.field || ''), err: g.err }); else groups = g.vals; }
    const o = one(key, u, ALL);
    if (!o) { errs[key] = (errs[key] || []).concat(problems); return; }
    if (problems.length) { errs[key] = problems; return; }
    adjust.custom.push(Object.assign({ id: u.id, label: String(u.label || '').trim() || 'Your test ' + u.id, kind, field: u.field, fieldLabel: String(u.field || ''), limit: +u.limit, op: u.op === '>=' ? '>=' : '<=', groups }, o)); any = true;
  });
  return { adjust: any ? adjust : null, errs, counts };
}

// ---------- the run: built-in figures first, then the calculations, then the run that uses them
// opt.projection: only the replacements that make sense on a projected date; opt.skipLoanOverrides: the tape already has them
function runWith(E, spec, tape, inp, calcs, opt) {
  opt = opt || {};
  const list = (calcs || []).filter(c => c && c.on !== false && (String(c.formula || '').trim() !== '' || String(c.name || '').trim() !== ''));
  const man = Array.isArray(inp.manual) ? inp.manual : [];
  const TR = hasTestRules(opt.tests) ? opt.tests : null;
  if (!list.length && !man.some(isFormulaRow) && !TR) return { result: E.run(spec, tape, inp), info: null };
  const M = compile(list, spec, tape);
  const inpLite = Object.assign({}, inp, { lite: true, manual: man.map(m => isFormulaRow(m) ? Object.assign({}, m, { amount: 0 }) : m) });
  let pre = E.run(spec, tape, inpLite);
  let R = rowsOf(E, tape, pre, M.extra); const R0 = R;
  let st = evaluate(M, pre, R);
  // loan-level replacements: a new tape, and the built-in figures again from it
  let tape2 = tape; const loanApplied = [];
  const loanOv = M.order.filter(v => v.kind === 'loan' && v.use && !st.errs.has(v.key) && targetOf('loan', v.use));
  if (loanOv.length && !opt.skipLoanOverrides) {
    tape2 = tape.map(r => Object.assign({}, r));
    loanOv.forEach(v => {
      const T = targetOf('loan', v.use); const vals = st.vals.get(v.key); let blank = 0, n = 0, bad = 0, changed = 0; let before = 0, after = 0;
      tape2.forEach((row, i) => {
        const x = vals[i]; const was = R.col(i, TCOL[T.id]);
        if (isBlank(x)) { blank++; return; }
        if (T.text) { const y = T.text === 'm' ? moodysOf(x) : spOf(x); if (!y) { bad++; return; } row[T.field] = y; n++; if (String(was || '').toUpperCase() !== y.toUpperCase()) changed++; return; }
        if (T.id === 'defaulted') { row.defaulted = truthy(x) ? 'Y' : 'N'; n++; before += was ? 1 : 0; after += truthy(x) ? 1 : 0; if (!!was !== truthy(x)) changed++; return; }
        const y = typeof x === 'number' ? x : cellValue(x); if (typeof y !== 'number') { bad++; return; }
        row[T.field] = T.id === 'par' ? r2(y) : y; n++; before += +was || 0; after += row[T.field]; if (Math.abs(row[T.field] - (+was || 0)) > 0.005) changed++;
      });
      loanApplied.push({ key: v.key, name: v.name, target: T, n, blank, bad, before, after, changed });
    });
    pre = E.run(spec, tape2, inpLite); R = rowsOf(E, tape2, pre, M.extra);
    st = evaluate(M, pre, R, st);
  }
  // deal-level replacements and manual formulas
  const inp2 = Object.assign({}, inp, { sourceOf: Object.assign({}, inp.sourceOf || {}), overrides: Object.assign({}, inp.overrides || {}) });
  const dealApplied = [];
  M.order.filter(v => v.kind === 'deal' && v.use).forEach(v => {
    const T = targetOf('deal', v.use); if (!T) return;
    if (opt.projection && !T.proj) return;
    const interp = interpValue(T.id, pre, inp);
    if (st.errs.has(v.key)) { dealApplied.push({ key: v.key, name: v.name, target: T, applied: false, why: 'it has an error', interp }); return; }
    const x = st.vals.get(v.key);
    if (isBlank(x)) { dealApplied.push({ key: v.key, name: v.name, target: T, applied: false, why: 'it is blank', interp }); return; }
    if (typeof x !== 'number') { st.errs.set(v.key, 'The result is text ("' + x + '"); ' + T.label + ' needs a number'); dealApplied.push({ key: v.key, name: v.name, target: T, applied: false, why: 'it is text', interp }); return; }
    const val = r2(x);
    if (T.how === 'input') { inp2[T.field] = val; inp2.sourceOf[T.field] = 'calculation ' + v.name; }
    else inp2.overrides[T.id] = { value: val, source: 'calculation ' + v.name };
    dealApplied.push({ key: v.key, name: v.name, target: T, applied: true, value: val, interp });
  });
  const manOut = man.map(m => {
    if (!isFormulaRow(m)) return { amount: +m.amount || 0 };
    return evalManual(M, st, R, m.formula);
  });
  inp2.manual = man.map((m, i) => isFormulaRow(m) ? Object.assign({}, m, { amount: manOut[i].err ? 0 : manOut[i].amount, src: manOut[i].err ? 'formula with an error, counted as zero' : 'formula =' + m.formula.replace(/^\s*=/, '').trim() }) : m);
  // your adjustments to the tests: each condition worked out on the loans as the run will see them
  let tests = null;
  if (TR) { tests = testAdjustFrom(M, st, R, TR); if (tests.adjust) inp2.testAdjust = tests.adjust; }
  const result = E.run(spec, tape2, inp2);
  const info = { M, st, R, R0, pre, tape: tape2, tape0: tape, loanApplied, dealApplied, manual: manOut, projection: !!opt.projection, tests, inp: inp2 };
  return { result, info };
}
// the engine the projection uses: replacements of the fee basis, collateral value and fees on every projected date
// coverage tests you adjusted change the cash, so they are applied on every projected date too, on that date's loans
function projectionEngine(E, calcs, tests) {
  const list = (calcs || []).filter(c => c && c.on !== false && c.kind !== 'loan' && c.use && (targetOf('deal', c.use) || {}).proj);
  const cov = tests && tests.adj ? Object.keys(tests.adj).filter(k => /^coverage:/.test(k) && adjActive(tests.adj[k])) : [];
  if (!list.length && !cov.length) return E;
  const T = cov.length ? { adj: Object.fromEntries(cov.map(k => [k, tests.adj[k]])) } : null;
  return Object.assign({}, E, { run: (spec, tape, inp) => runWith(E, spec, tape, inp, calcs, { projection: true, skipLoanOverrides: true, tests: T }).result });
}

// ---------- the working behind a calculation, in the same lines as every other figure
function working(info, key) {
  const v = info.M.byKey.get(key); if (!v) return null;
  const st = info.st, R = info.R; const L = [];
  const row = (label, expr, value, o) => L.push(Object.assign({ t: 'row', label, expr: expr || '', value }, o || {}));
  L.push({ t: 'head', text: 'Formula' }, { t: 'note', text: '= ' + v.formula.replace(/^=/, '') });
  if (v.note) L.push({ t: 'note', text: v.note });
  const err = st.errs.get(key);
  if (err) { L.push({ t: 'head', text: 'Error' }, { t: 'note', text: err }); return { title: v.name, kind: v.kind, lines: L, err }; }
  const descr = r => { const k = info.M.kindOf(r.key); if (k === 'builtin') return 'built-in: ' + info.M.BK.get(r.key).label; if (k === 'dealvar') return 'your calculation'; if (k === 'loanvar') return 'your loan-level calculation'; return 'loan column'; };
  const cache = st.aggs.get(key) || new Map();
  if (v.kind === 'deal') {
    const seen = new Set(); const ins = [];
    v.refs.filter(r => !r.inAgg).forEach(r => { if (seen.has(r.key)) return; seen.add(r.key); ins.push(r); });
    const aggNodes = []; (function walk(n) { if (!n) return; if (n.t === 'call') { if (FUNCS[n.fn].agg) { aggNodes.push(n); return; } n.args.forEach(walk); } else ['a', 'b'].forEach(k => n[k] && walk(n[k])); })(v.ast);
    if (ins.length || aggNodes.length) L.push({ t: 'head', text: 'Figures it uses' });
    ins.forEach(r => { const val = st.dealLook({ key: r.key, name: r.name }); row(r.name, descr(r), typeof val === 'number' ? val : fmtV(val)); });
    aggNodes.forEach(n => { const c = cache.get(n); row(show(n), c ? 'over ' + c.cnt + ' of ' + c.of + ' loans' : '', c && typeof c.v === 'number' ? c.v : fmtV(c ? c.v : null)); });
    const val = st.vals.get(key);
    L.push({ t: 'head', text: 'Result' });
    const sub = show(v.ast, n => n.t === 'ref' ? st.dealLook(n) : (cache.get(n) || {}).v);
    L.push({ t: 'total', label: v.name, expr: sub, value: typeof val === 'number' ? val : fmtV(val) });
    const D = (info.dealApplied || []).find(x => x.key === key);
    if (D) {
      L.push({ t: 'head', text: 'Replaces ' + D.target.label });
      if (D.interp != null) row('The interpreter\'s figure', '', D.interp);
      if (D.applied) { row('Used instead', 'this calculation, to the cent', D.value); if (D.interp != null) row('Difference', '', r2(D.value - D.interp)); }
      else L.push({ t: 'note', text: 'Not applied, because ' + D.why + '. The interpreter\'s figure is used.' });
      if (info.projection === false && D.target.proj) L.push({ t: 'note', text: 'The projection applies this replacement on every projected Payment Date as well.' });
    }
    // loans behind each SUM, AVG and the like
    aggNodes.forEach(n => {
      const c = cache.get(n); if (!c || !c.hit.length) return;
      const body = n.fn === 'COUNT' ? null : n.args[0];
      L.push({ t: 'head', text: 'Loans in ' + show(n) });
      const head = ['ID', 'Obligor'].concat(body ? [show(body)] : [], n.fn === 'WAVG' ? [show(n.args[1])] : []);
      const rows = c.hit.map(h => [R.id(h[0]), R.obligor(h[0])].concat(h.length > 1 ? [fmtV(h[1])] : [], h.length > 2 ? [fmtV(h[2])] : []));
      L.push({ t: 'table', head, rows, align: head.map((x, i) => i >= 2 ? 'r' : '') });
    });
  } else {
    const vals = st.vals.get(key); const nums = vals.filter(x => typeof x === 'number'); const blanks = vals.filter(isBlank).length;
    L.push({ t: 'head', text: 'Result' });
    row('Loans', '', String(R.count));
    if (blanks) row('Blank', 'no value for these loans', String(blanks));
    if (nums.length) { row('Total over the loans', nums.length + ' with a number', r2(nums.reduce((s, x) => s + x, 0))); }
    const A = (info.loanApplied || []).find(x => x.key === key);
    if (v.use) {
      const T = targetOf('loan', v.use); const lab = lc(T.label); L.push({ t: 'head', text: 'Replaces ' + lab + ' on the tape' });
      if (!A) L.push({ t: 'note', text: info.projection ? 'Applied to the starting tape of the projection.' : 'Not applied.' });
      else if (T.id === 'defaulted') { row('Loans defaulted on the tape', '', String(A.before)); row('Loans defaulted with this column', '', String(A.after)); }
      else if (T.text) row('Loans given a rating from this column', '', String(A.n));
      else { row(T.label + ' on the tape', A.n + ' loans with a value here', r2(A.before)); row(T.label + ' with this column', 'the same loans', r2(A.after)); if (T.id === 'par') row('Change in par', '', r2(A.after - A.before)); }
      if (A) L.push({ t: 'note', text: A.changed + ' of the ' + A.n + ' loans ' + (A.changed === 1 ? 'differs' : 'differ') + ' from the tape.' });
      if (A && A.blank) L.push({ t: 'note', text: A.blank + ' loan' + (A.blank > 1 ? 's are' : ' is') + ' blank in this column, so ' + (A.blank > 1 ? 'they keep' : 'it keeps') + ' the tape value.' });
      if (A && A.bad) L.push({ t: 'note', text: A.bad + ' loan' + (A.bad > 1 ? 's have' : ' has') + (T.text ? ' a value that is not a ' + (T.text === 'm' ? 'Moody\'s' : 'S&P') + ' rating' : ' text') + ' in this column, so ' + (A.bad > 1 ? 'they keep' : 'it keeps') + ' the tape value.' });
    }
    // the columns it uses, as they were when it was worked out: the tape before any replacement
    const cols = []; v.refs.filter(r => !r.inAgg).forEach(r => { if (!cols.some(c => c.key === r.key)) cols.push(r); });
    const T = v.use ? targetOf('loan', v.use) : null; const tk = T ? TCOL[T.id] : null; const R0 = info.R0 || R;
    const cell = x => isBlank(x) ? '' : typeof x === 'string' ? x : fmtV(x);
    const show1 = (i, r) => { const k = info.M.kindOf(r.key); try { return cell(k === 'loanvar' ? st.vals.get(r.key)[i] : k === 'column' ? R0.col(i, r.key) : st.dealLook(r)); } catch (e) { return ''; } };
    const tapeCol = T && A && !cols.some(c => c.key === tk);
    const head = ['ID', 'Obligor'].concat(cols.map(c => c.name), [v.name], tapeCol ? ['Tape ' + lc(T.label)] : []);
    // where it replaces a tape figure, the loans it changes come first
    const differs = i => { if (!T || !A || isBlank(vals[i])) return false; const was = R0.col(i, tk), now = vals[i]; if (T.id === 'defaulted') return !!was !== truthy(now); if (T.text) return String(was || '').toUpperCase() !== String(now).trim().toUpperCase(); const y = typeof now === 'number' ? now : cellValue(now); return typeof y === 'number' && Math.abs(y - (+was || 0)) > 0.005; };
    const order = vals.map((x, i) => i); if (T && A) order.sort((a, b) => (differs(b) ? 1 : 0) - (differs(a) ? 1 : 0) || a - b);
    const rows = order.map(i => [R.id(i), R.obligor(i)].concat(cols.map(c => show1(i, c)), [cell(vals[i])], tapeCol ? [cell(R0.col(i, tk))] : []));
    L.push({ t: 'head', text: 'By loan' + (T && A && A.changed ? ', the ' + A.changed + ' that differ from the tape first' : '') }, { t: 'table', head, rows, align: head.map((x, i) => i >= 2 ? 'r' : '') });
  }
  return { title: v.name, kind: v.kind, lines: L, err: null };
}

// a group's steps side by side: each loan column of the group for every loan, the final one beside the tape
function groupWorking(info, keys, title) {
  const st = info.st, R = info.R, R0 = info.R0 || R; const vars = keys.map(k => info.M.byKey.get(k)).filter(Boolean);
  const cell = x => isBlank(x) ? '' : typeof x === 'string' ? x : fmtV(x);
  const L = [{ t: 'head', text: 'Steps, in order' }];
  vars.forEach((v, i) => {
    const err = st.errs.get(v.key) || v.err; const T = v.use ? targetOf(v.kind, v.use) : null; let val = '';
    if (!err && v.kind === 'deal') { const x = st.vals.get(v.key); val = typeof x === 'number' ? x : cell(x); }
    else if (!err) { const xs = st.vals.get(v.key) || []; const nums = xs.filter(x => typeof x === 'number'); val = nums.length === xs.length && nums.length ? r2(nums.reduce((a, b) => a + b, 0)) : xs.filter(x => !isBlank(x)).length + ' of ' + xs.length + ' loans'; }
    L.push({ t: 'row', label: (i + 1) + '. ' + v.name + (v.kind === 'loan' ? ' (loan column' + (T ? ', replaces ' + lc(T.label) : '') + ')' : T ? ' (replaces ' + T.label + ')' : ''), expr: '= ' + v.formula.replace(/^=/, ''), value: err ? 'error' : val });
    if (err) L.push({ t: 'note', text: v.name + ': ' + err });
  });
  const lv = vars.filter(v => v.kind === 'loan' && !(st.errs.get(v.key) || v.err));
  if (lv.length) {
    const fin = lv.slice().reverse().find(v => v.use && targetOf('loan', v.use)); const T = fin ? targetOf('loan', fin.use) : null; const A = fin ? (info.loanApplied || []).find(a => a.key === fin.key) : null; const tk = T ? TCOL[T.id] : null;
    const vals = fin ? st.vals.get(fin.key) : null;
    const differs = i => { if (!A || isBlank(vals[i])) return false; const was = R0.col(i, tk), now = vals[i]; if (T.id === 'defaulted') return !!was !== truthy(now); if (T.text) return String(was || '').toUpperCase() !== String(now).trim().toUpperCase(); const y = typeof now === 'number' ? now : cellValue(now); return typeof y === 'number' && Math.abs(y - (+was || 0)) > 0.005; };
    const order = Array.from({ length: R.count }, (x, i) => i); if (A) order.sort((a, b) => (differs(b) ? 1 : 0) - (differs(a) ? 1 : 0) || a - b);
    const head = ['ID', 'Obligor'].concat(A ? ['Tape ' + lc(T.label)] : [], lv.map(v => v.name));
    const rows = order.map(i => [R.id(i), R.obligor(i)].concat(A ? [cell(R0.col(i, tk))] : [], lv.map(v => cell(st.vals.get(v.key)[i]))));
    L.push({ t: 'head', text: 'Each loan, step by step' + (A && A.changed ? ', the ' + A.changed + ' that ' + fin.name + ' changes first' : '') }, { t: 'table', head, rows, align: head.map((x, i) => i >= 2 ? 'r' : '') });
  }
  return { title, lines: L };
}

// examples the Calculations tab offers
const EXAMPLES = [
  { name: 'Fee_Basis_Amount_2', kind: 'deal', use: 'feeBasis', formula: 'SUM(par, NOT defaulted) + SUM(oc_balance, defaulted) + Principal_Proceeds', note: 'Defaulted Obligations counted at their carrying value in Principal Collateral Value rather than at par.' },
  { name: 'Principal_Balance_2', kind: 'loan', use: 'par', formula: 'IFBLANK(principal_balance, par)', note: 'The Principal Balance column of the tape in place of par, where it has one.' },
  { name: 'Senior_Fee_Check', kind: 'deal', use: '', formula: 'ROUND(Fee_Basis_Amount * Senior_Management_Fee_Rate% * Day_Count_Fraction, 2)', note: 'The senior fee worked out again from its rate, to compare with the trustee report.' },
  { name: 'Years_To_Maturity', kind: 'deal', use: '', formula: 'YEARS(Payment_Date, Stated_Maturity_Date)', note: 'Years left to Stated Maturity.' },
  { group: 'Principal Balance', label: 'Principal Balance in steps (a group)', steps: [
    { name: 'PB_From_Tape', kind: 'loan', formula: 'IFBLANK(principal_balance, par)', note: 'Step 1: the trustee\'s Principal Balance where the tape gives one, otherwise par.' },
    { name: 'PB_Not_Above_Par', kind: 'loan', formula: 'MIN(PB_From_Tape, par)', note: 'Step 2: never more than par.' },
    { name: 'Principal_Balance_Final', kind: 'loan', use: 'par', formula: 'ROUND(PB_Not_Above_Par, 2)', note: 'Step 3: to the cent, in place of par.' }] },
  { group: "Moody's rating", label: "Moody's rating from S&P where there is none (a group)", steps: [
    { name: 'SP_As_Moodys', kind: 'loan', formula: 'SP_TO_MOODYS(sp_rating)', note: 'Step 1: the S&P rating on the Moody\'s scale.' },
    { name: 'Moodys_Rating_Final', kind: 'loan', use: 'moodysDPR', formula: 'IFBLANK(moodys_rating, NOTCH(SP_As_Moodys, 1))', note: 'Step 2: the Moody\'s rating, or one notch below the S&P equivalent where the loan has no Moody\'s rating.' }] }
];

return { lc, parse, show, tokenize, refsOf, compile, evaluate, runWith, projectionEngine, hasTestRules, adjActive, condList, rowsFor: (E, tape, res) => rowsOf(E, tape, res, extraColumns(tape)), working, groupWorking, builtinDefs, extraColumns, snake, cellValue, fmtV, isFormulaRow, FUNCS, STD_COLS, TARGETS, EXAMPLES, CalcError, hasAgg };
})();
if (typeof module !== 'undefined') module.exports = CALC;
