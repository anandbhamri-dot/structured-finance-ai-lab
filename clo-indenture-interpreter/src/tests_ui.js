// ---------- Tests tab: your adjustments to a test (loans left out of the numerator or the denominator, your own numerator) and tests of your own
const testRules = () => { const R = (state.testsByDeal[state.dealId] = state.testsByDeal[state.dealId] || {}); R.adj = R.adj || {}; R.custom = R.custom || []; return R; };
const fmtQv = (q, x) => x == null ? '—' : q.fmt === 'int' ? Math.round(x).toLocaleString('en-US') : q.fmt === 'pct1' ? pct(x, 1) : q.fmt === 'yrs' ? x.toFixed(2) + ' yrs' : q.fmt === 'dec1' ? x.toFixed(1) : pct(x, 2);
const ADJ_FLAGS = ['defaulted', 'cov_lite', 'pik', 'revolver', 'dip', 'current_pay', 'participation', 'zero_coupon', 'is_ccc', 'is_discount'];
const ADJ_DATES = ['maturity', 'default_date'];
const ADJ_QUICK = [['defaulted', 'Defaulted'], ['is_ccc', 'CCC'], ['is_discount', 'Discount'], ['cov_lite', 'Cov-lite'], ['pik', 'PIK']];
const LIST_NAME = { numOnly: 'Count only loans where', numSkip: 'Leave out of the numerator', denSkip: 'Leave out of the denominator' };
function testsChanged(focusSel) { state.adjFocus = focusSel || null; saveTestAdj(); run(); }
const adjKeyId = key => key.slice(key.indexOf(':') + 1);
// what a test is, where its figures are, and which of your lists apply to it
function adjTest(key) {
  const s = deal(); const g = key.slice(0, key.indexOf(':')), id = adjKeyId(key); const cov = s.coverage || {};
  const ratio = (res, f) => { const x = res && f(res); return x == null ? null : x; };
  if (g === 'coverage') {
    if (id === 'irt' || id === 'eod') {
      const t = id === 'irt' ? cov.reinvestmentTest : cov.eodTest; if (!t) return null; const k = id === 'irt' ? 'preIRT' : 'preEoD';
      return { g, id, key, label: t.label, lists: ['numSkip'], value: res => ratio(res, x => x[k] && x[k].ratio), show: v => pct(v), limit: '≥ ' + pct(t.trigger), pass: res => res[k] ? res[k].ratio >= t.trigger - 1e-9 : null, tc: id + '|||num', num: 'Principal Collateral Value', den: 'Principal of Class ' + t.ocClasses.join(', ') };
    }
    const i = (cov.tests || []).findIndex(t => t.id === id); if (i < 0) return null; const t = cov.tests[i];
    return { g, id, key, label: t.label + ' OC test', lists: ['numSkip'], value: res => ratio(res, x => x.preTests[i] && x.preTests[i].oc.ratio), show: v => pct(v), limit: '≥ ' + pct(t.oc.trigger), pass: res => res.preTests[i] ? res.preTests[i].ocPass : null, tc: 'coverage|' + id + '|oc|num', num: 'Principal Collateral Value', den: 'Principal of Class ' + t.oc.classes.join(', ') };
  }
  if (g === 'quality') {
    const t = (s.qualityTests || []).find(x => x.id === id); if (!t || t.metric === 'external') return null; const one = t.metric === 'diversity';
    const q = res => res.quality.find(x => x.id === id) || {};
    return { g, id, key, label: t.label, metric: t.metric, one, lists: one ? ['numOnly', 'numSkip'] : ['numOnly', 'numSkip', 'denSkip'], value: res => q(res).value, show: v => fmtQv(q(state.result), v), limit: () => { const x = q(state.result); return x.op && x.limit != null ? (x.op === '<=' ? '≤ ' : '≥ ') + fmtQv(x, x.limit) : ''; }, pass: res => q(res).pass, tc: 'quality|' + id + '||num' };
  }
  if (g === 'conc') {
    const t = (s.concentrations || []).find(x => x.id === id); if (!t) return null; const group = /^max/.test(t.metric || '');
    const c = res => res.conc.find(x => x.id === id) || {};
    return { g, id, key, label: 'Portfolio Profile Test ' + id + ', ' + t.label, group, clause: t, lists: ['numOnly', 'numSkip', 'denSkip'], cash: true, value: res => c(res).value, show: v => pct(v), limit: (t.op === '>=' ? '≥ ' : '≤ ') + pct(t.limit, t.limit % 1 ? 1 : 0), pass: res => c(res).pass, tc: 'conc|' + id + '||num' };
  }
  if (g === 'custom') {
    const u = testRules().custom.find(x => x.id === id); if (!u) return null; const c = res => res.conc.find(x => x.id === id) || {};
    return { g, id, key, label: u.label || 'Your test ' + id, custom: u, group: u.kind === 'largest', lists: ['numOnly', 'numSkip', 'denSkip'], cash: true, value: res => c(res).value, show: v => pct(v), limit: u.limit === '' || u.limit == null ? '' : (u.op === '>=' ? '≥ ' : '≤ ') + pct(+u.limit, +u.limit % 1 ? 2 : 0), pass: res => c(res).pass, tc: 'conc|' + id + '||num' };
  }
  return null;
}
const adjOf = key => key.startsWith('custom:') ? testRules().custom.find(u => u.id === adjKeyId(key)) : testRules().adj[key];
const adjErrs = key => (state.calcInfo && state.calcInfo.tests && state.calcInfo.tests.errs[key]) || null;
const adjCounts = key => (state.calcInfo && state.calcInfo.tests && state.calcInfo.tests.counts[key]) || {};
// is the adjustment in force on this run (as against saved but broken, or empty)?
function adjApplied(key) {
  const r = state.result; if (!r || !r.testAdjust) return false; const g = key.slice(0, key.indexOf(':')), id = adjKeyId(key); const A = r.testAdjust;
  return g === 'conc' ? A.conc.includes(id) : g === 'quality' ? A.quality.includes(id) : g === 'coverage' ? A.coverage.includes(id) : A.custom.includes(id);
}
const adjSummary = a => { if (!a) return ''; const L = k => CALC.condList(a[k]); const only = a.numMode === 'all' ? [] : L('numOnly');
  return [only.length ? 'only ' + only.join(' and ') : '', L('numSkip').length ? 'numerator without ' + L('numSkip').join(' or ') : '', L('denSkip').length ? 'denominator without ' + L('denSkip').join(' or ') : '', a.denCash === false ? 'no Principal Proceeds in the denominator' : ''].filter(Boolean).join('; '); };
// the button and the note shown in each test's row
function adjCell(key, name) {
  const a = adjOf(key); const on = !!a && (key.startsWith('custom:') || CALC.adjActive(a)); const err = adjErrs(key); const applied = adjApplied(key);
  let h = '<div class="adjc"><button type="button" class="linkbtn adjb" data-adj="' + esc(key) + '" aria-label="' + esc((on ? 'Change your adjustment to ' : 'Adjust ') + name) + '">' + (on ? 'Change adjustment' : 'Adjust') + '</button>';
  if (on && err) h += ' <span class="adjtag err" title="' + esc(err.map(e => e.err).join('; ')) + '">Not applied: ' + (err.length === 1 ? 'a condition has an error' : err.length + ' problems') + '</span>';
  else if (on && applied && !key.startsWith('custom:')) h += ' <span class="adjtag">Adjusted</span><div class="small adjsum">' + esc(adjSummary(a)) + '</div>';
  return h + '</div>';
}
// a notice at the top of the Tests tab, and on the Waterfall when a coverage test's numerator is yours
function testsNotice(where) {
  const R = testRules(); const keys = Object.keys(R.adj).filter(k => CALC.adjActive(R.adj[k]) && adjTest(k)); const cov = keys.filter(k => /^coverage:/.test(k)); const nC = R.custom.length;
  const bad = keys.concat(R.custom.map(u => 'custom:' + u.id)).filter(k => adjErrs(k));
  if (where === 'waterfall') return cov.length ? '<div class="notice">You left loans out of the numerator of ' + cov.map(k => '<b>' + esc(adjTest(k).label) + '</b>').join(', ') + '. The cures and diversions on this page follow your version of ' + (cov.length > 1 ? 'those tests' : 'that test') + '. <button class="linkbtn" type="button" data-gotab="tests">Open Tests</button></div>' : '';
  if (!keys.length && !nC) return '';
  return '<div class="notice' + (bad.length ? ' warn' : '') + '">' + (keys.length ? 'You adjusted ' + keys.length + ' test' + (keys.length > 1 ? 's' : '') + '. ' : '') + (nC ? 'You added ' + nC + ' test' + (nC > 1 ? 's' : '') + ' of your own, at the end of the Portfolio Profile Test. ' : '') +
    (bad.length ? bad.length + (bad.length > 1 ? ' have problems and are' : ' has a problem and is') + ' not applied; open ' + (bad.length > 1 ? 'them' : 'it') + ' to see why. ' : '') + 'Every figure, and the working behind it, shows your version. ' +
    (keys.length ? '<button class="linkbtn" type="button" id="adjResetAll">Put every test back as the indenture reads</button>' : '') + '</div>';
}
function bindTestsNotice(P) {
  const b = $('#adjResetAll', P); if (!b) return;
  b.onclick = () => { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Select again to remove every adjustment (your own tests stay)'; return; } testRules().adj = {}; testsChanged(); toast('Every test is back as the indenture reads.'); };
}

// ---------- the side panel for one test
function adjFields() {
  const F = CALC.STD_COLS.map(([k, label]) => ({ key: k, name: k, label }));
  CALC.extraColumns(state.tape || []).forEach(c => F.push({ key: c.key, name: c.name, label: 'Your tape: ' + c.raw }));
  calcRows().filter(c => c.kind === 'loan' && c.on !== false && c.name && /^[A-Za-z_]\w*$/.test(c.name)).forEach(c => F.push({ key: c.name.toLowerCase(), name: c.name, label: 'Your calculation' + (c.group ? ' in ' + c.group : '') }));
  return F;
}
// each loan's value of a field, as the run sees it
function adjValues(key) {
  const I = state.calcInfo;
  if (I && I.M && I.M.byKey.has(key) && I.M.byKey.get(key).kind === 'loan') return (I.st.vals.get(key) || []).slice();
  try { const R = I ? I.R : CALC.rowsFor(E, effectiveTape(), state.result); return Array.from({ length: R.count }, (_, i) => R.col(i, key)); } catch (e) { return []; }
}
function adjType(key, vals) {
  if (ADJ_FLAGS.includes(key)) return 'flag'; if (ADJ_DATES.includes(key)) return 'date';
  const v = vals.filter(x => x != null && x !== ''); if (!v.length) return 'text';
  if (v.every(x => typeof x === 'number')) return v.every(x => x === 0 || x === 1) && v.length > 1 ? 'flag' : 'num';
  if (v.every(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x)))) return 'date';
  return 'text';
}
const ADJ_OPS = {
  flag: [['yes', 'is yes'], ['no', 'is no']],
  text: [['=', 'is'], ['<>', 'is not'], ['in', 'is one of'], ['has', 'contains'], ['blank', 'is blank'], ['nb', 'is not blank']],
  num: [['=', '='], ['<>', '≠'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥'], ['blank', 'is blank']],
  date: [['<', 'before'], ['<=', 'on or before'], ['>', 'after'], ['>=', 'on or after'], ['=', 'on'], ['blank', 'is blank']]
};
const qstr = v => { const s = String(v); return s.includes('"') ? (s.includes("'") ? '"' + s.replace(/"/g, '') + '"' : "'" + s + "'") : '"' + s + '"'; };
// the condition the builder's choices make, in the formula language
function adjBuild(b) {
  const f = b.field, op = b.op; if (!f) return '';
  if (op === 'yes') return f; if (op === 'no') return 'NOT ' + f;
  if (op === 'blank') return 'ISBLANK(' + f + ')'; if (op === 'nb') return 'NOT ISBLANK(' + f + ')';
  if (op === 'has') return b.value ? 'CONTAINS(' + f + ', ' + qstr(b.value) + ')' : '';
  if (op === 'in') { const L = (b.values || []).filter(x => x !== ''); return L.length ? (L.length === 1 ? f + ' = ' + qstr(L[0]) : '(' + L.map(v => f + ' = ' + qstr(v)).join(' OR ') + ')') : ''; }
  if (b.value === '' || b.value == null) return '';
  const val = b.type === 'num' ? (isFinite(+b.value) ? String(+b.value) : '') : qstr(b.value); if (!val) return '';
  return f + ' ' + op + ' ' + val;
}
function adjBuilderHTML(list, B) {
  const F = adjFields(); const b = B[list] = B[list] || { field: '', op: '', value: '', values: [] };
  if (!b.field) b.field = list === 'numOnly' ? 'industry' : 'is_ccc';
  const vals = adjValues(b.field); const type = b.type = adjType(b.field, vals); const ops = ADJ_OPS[type];
  if (!ops.some(o => o[0] === b.op)) { b.op = ops[0][0]; b.value = ''; b.values = []; }
  let ctl = '';
  if (type === 'text' && (b.op === '=' || b.op === '<>' || b.op === 'in')) {
    const cnt = new Map(); vals.forEach(v => { if (v == null || v === '') return; const k = String(v); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const opts = [...cnt].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 400);
    if (b.op !== 'in' && !opts.some(o => o[0] === b.value)) b.value = opts.length ? opts[0][0] : '';
    ctl = '<select data-bv' + (b.op === 'in' ? ' multiple size="5"' : '') + ' aria-label="Value">' + opts.map(([v, n]) => '<option value="' + esc(v) + '"' + ((b.op === 'in' ? (b.values || []).includes(v) : v === b.value) ? ' selected' : '') + '>' + esc(v) + ' (' + n + ')</option>').join('') + '</select>';
  } else if (type === 'text' && b.op === 'has') ctl = '<input type="text" data-bv aria-label="Text the value contains" value="' + esc(b.value || '') + '" placeholder="text">';
  else if (type === 'num' && b.op !== 'blank') ctl = '<input type="number" step="any" data-bv aria-label="Number" value="' + esc(b.value || '') + '" placeholder="number">';
  else if (type === 'date' && b.op !== 'blank') ctl = '<input type="date" data-bv aria-label="Date" value="' + esc(b.value || '') + '">';
  const cond = adjBuild(b);
  return '<div class="adjbuild" data-for="' + list + '"><select data-bf aria-label="Field">' + F.map(x => '<option value="' + esc(x.key) + '"' + (x.key === b.field ? ' selected' : '') + ' title="' + esc(x.label) + '">' + esc(x.name) + '</option>').join('') + '</select>' +
    '<select data-bo aria-label="Test">' + ops.map(([k, l]) => '<option value="' + k + '"' + (k === b.op ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' + ctl +
    '<button type="button" class="btn small" data-badd' + (cond ? '' : ' disabled') + '>Add</button></div>' +
    '<p class="adjpreview small">' + (cond ? 'Adds <code class="f">' + esc(cond) + '</code>' : 'Choose a value to add the condition') + '</p>' +
    '<div class="adjtype"><input type="text" data-bt aria-label="' + esc(LIST_NAME[list]) + ': type a condition" placeholder="or type a condition, e.g. defaulted OR price < 80" spellcheck="false" autocomplete="off"><button type="button" class="btn small" data-btadd>Add</button></div>';
}
function adjListHTML(key, list, a, B, title, hint, T) {
  const L = CALC.condList(a && a[list]); const errs = (adjErrs(key) || []).filter(e => e.list === list); const C = adjCounts(key); const each = C[list + 'Each'] || [];
  const joinW = list === 'numOnly' ? 'and' : 'or';
  let h = '<div class="adjlist" data-list="' + list + '"><h4>' + esc(title) + '</h4>' + (hint ? '<p class="small">' + hint + '</p>' : '');
  if (L.length) h += '<ul class="chips">' + L.map((c, i) => { const e = errs.find(x => x.cond === c); return '<li class="' + (e ? 'bad' : '') + '">' + (i ? '<span class="jw">' + joinW + '</span>' : '') + '<code class="f">' + esc(c) + '</code>' + (e ? '' : each[i] != null ? '<span class="small">' + each[i] + ' loan' + (each[i] === 1 ? '' : 's') + '</span>' : '') + '<button type="button" class="chipx" data-rm="' + list + ':' + i + '" aria-label="Remove ' + esc(c) + '">×</button>' + (e ? '<div class="cv-err">' + esc(e.err) + '</div>' : '') + '</li>'; }).join('') + '</ul>' +
    (C[list] != null && L.length > 1 ? '<p class="small">' + C[list] + ' loan' + (C[list] === 1 ? '' : 's') + ' in all</p>' : '');
  if (list !== 'numOnly') h += '<div class="quick" role="group" aria-label="Common choices">' + ADJ_QUICK.filter(([k]) => !(k === 'defaulted' && T && T.g === 'quality')).map(([k, l]) => '<button type="button" class="btn small" data-quick="' + k + '"' + (L.includes(k) ? ' disabled' : '') + '>' + esc(l) + '</button>').join('') + '</div>';
  return h + adjBuilderHTML(list, B) + '</div>';
}
function renderAdjust(c, d) {
  const T = adjTest(c.adj); const r = state.result; if (!T || !r) { d.close(); return; }
  d.classList.remove('wide');
  const R = testRules(); let a = adjOf(c.adj); const B = (state.adjB = state.adjB || {})[c.adj] = (state.adjB[c.adj] || {});
  const base = adjBaseline(); const now = T.value(r), was = base ? T.value(base) : null; const pNow = T.pass(r), pWas = base ? T.pass(base) : null;
  const lim = typeof T.limit === 'function' ? T.limit() : T.limit;
  const pill = p => p == null ? '' : '<span class="pill ' + (p ? 'pass' : 'fail') + '">' + (p ? 'Pass' : 'Fail') + '</span>';
  const U = T.custom; const errs = adjErrs(c.adj) || [];
  let h = '<header class="cd-head"><div><p class="cd-kicker">' + (U ? 'A test of your own' : 'Adjust a test') + '</p><h2 id="calcTitle">' + esc(T.label) + '</h2></div><button type="button" class="cd-x" aria-label="Close">×</button></header><div class="cd-body adjbody">';
  h += '<div class="adjres">' + (U ? '' : '<div><span class="small">As the indenture reads</span><b>' + (was == null ? '—' : T.show(was)) + '</b>' + pill(pWas) + '</div>') +
    '<div><span class="small">' + (U ? 'This Payment Date' : 'As you adjusted it') + '</span><b>' + (now == null || !adjApplied(c.adj) && U ? '—' : T.show(now)) + '</b>' + (U && !adjApplied(c.adj) ? '' : pill(pNow)) + '</div>' + (lim ? '<div><span class="small">Limit</span><b>' + esc(lim) + '</b></div>' : '') + '</div>';
  if (U) {
    const top = errs.filter(e => e.list === 'limit' || e.list === 'field' || (e.list === 'numOnly' && !e.cond));
    h += '<div class="adjsec"><h3>The test</h3><div class="adjgrid"><label>Name <input type="text" data-u="label" value="' + esc(U.label || '') + '"></label>' +
      '<label>Measures <select data-u="kind"><option value="share"' + (U.kind !== 'largest' ? ' selected' : '') + '>Share of loans that meet conditions</option><option value="largest"' + (U.kind === 'largest' ? ' selected' : '') + '>Largest single value of a field</option></select></label>' +
      (U.kind === 'largest' ? '<label>Field to group by <select data-u="field">' + adjFields().map(x => '<option value="' + esc(x.name) + '"' + (x.name === U.field ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' : '') +
      '<label>Limit, % <span class="adjlim"><select data-u="op" aria-label="At most or at least"><option value="<="' + (U.op !== '>=' ? ' selected' : '') + '>at most</option><option value=">="' + (U.op === '>=' ? ' selected' : '') + '>at least</option></select><input type="number" step="any" data-u="limit" value="' + esc(U.limit == null ? '' : U.limit) + '" aria-label="Limit, percent"></span></label></div>' +
      (top.length ? '<p class="cv-err">To show this test: ' + top.map(e => esc(e.err)).join('; ') + '.</p>' : '') + '</div>';
  }
  // numerator
  const fText = t => (t.filter || []).length ? t.filter.map(x => x.f + (x.in ? ' is ' + x.in.join(' or ') : x.notIn ? ' is not ' + x.notIn.join(' or ') : x.eq !== undefined ? (x.eq ? ' = yes' : ' = no') : x.lt !== undefined ? ' below ' + x.lt : x.gt !== undefined ? ' above ' + x.gt : '')).join(' and ') : 'every loan';
  h += '<div class="adjsec"><h3>Numerator</h3>';
  if (T.g === 'coverage') h += '<p class="small">' + esc(T.num) + ': par less the haircuts for defaulted, discount and excess CCC loans, plus Principal Proceeds. The loans you leave out come off at their carrying value, for this test only. When the test fails, the waterfall cures your version of it.</p>';
  const only = U && !T.group ? true : !!(a && a.numMode !== 'all' && CALC.condList(a.numOnly).length) || (a && a.numMode === 'only');
  if (T.lists.includes('numOnly')) {
    if (U && !T.group) h += adjListHTML(c.adj, 'numOnly', a, B, 'Count loans where', 'Pick a field and a value, such as industry is Healthcare. Add more to narrow it: every condition must hold.', T);
    else {
      const what = T.g === 'conc' && !T.group ? 'the loans the clause describes (' + esc(fText(T.clause)) + ')' : T.group ? 'every loan' : 'every loan the test measures' + (T.metric === 'was' ? ' (floating rate, performing)' : T.metric === 'wac' ? ' (fixed rate, performing)' : ' (performing)');
      h += '<fieldset class="adjmode"><legend>' + (T.group ? 'Group' : 'Count') + '</legend><label><input type="radio" name="adjmode" value="all"' + (only ? '' : ' checked') + '> ' + what + '</label><label><input type="radio" name="adjmode" value="only"' + (only ? ' checked' : '') + '> only loans where…' + (T.g === 'conc' && !T.group ? ' (in place of the clause\'s own test)' : '') + '</label></fieldset>';
      if (only) h += adjListHTML(c.adj, 'numOnly', a, B, 'Count only loans where', 'Every condition must hold. Pick a field and a value, such as asset_type is 2L.', T);
    }
  }
  if (T.lists.includes('numSkip')) h += adjListHTML(c.adj, 'numSkip', a, B, T.one ? 'Leave out of the score' : 'Leave out of the numerator', 'A loan that meets any of these is left out' + (T.g === 'coverage' ? ' of this test\'s numerator.' : T.g === 'quality' ? '. Defaulted loans are already left out of this test.' : '.'), T);
  h += '</div>';
  // denominator
  h += '<div class="adjsec"><h3>Denominator</h3>';
  if (T.g === 'coverage') h += '<p class="small">' + esc(T.den) + ': the notes, so loans do not enter it.</p>';
  else if (T.one) h += '<p class="small">The Diversity Score is not a ratio of two sums: the loans you leave out above leave the whole score, including the Average Par Amount it divides by.</p>';
  else {
    h += '<p class="small">' + (T.g === 'quality' ? 'Par of the loans the test measures' + (T.metric === 'was' ? ' (floating rate, performing)' : T.metric === 'wac' ? ' (fixed rate, performing)' : ' (performing)') : 'Principal Collateral Value at par: every loan, plus Principal Proceeds') + '.</p>';
    h += adjListHTML(c.adj, 'denSkip', a, B, 'Leave out of the denominator', 'A loan that meets any of these is left out.' + (T.g === 'quality' ? ' Defaulted loans are already left out of this test.' : ''), T);
    if (T.cash) h += '<label class="chk"><input type="checkbox" data-cash' + (a && a.denCash === false ? '' : ' checked') + '> Count Principal Proceeds on deposit in the denominator</label>';
  }
  h += '</div>';
  const other = errs.filter(e => !['limit', 'field'].includes(e.list) && e.cond && !CALC.condList(a && a[e.list]).includes(e.cond));
  if (other.length) h += '<p class="cv-err">' + other.map(e => esc(e.err)).join('; ') + '</p>';
  h += '<p class="cd-fine">Conditions use the names on the Calculations tab: tape columns, the interpreter\'s columns such as is_ccc and oc_balance, and your loan calculations. Your changes apply at once and are kept for this deal in this browser.</p></div>';
  h += '<footer class="cd-foot">' + (U ? '<button type="button" class="btn small" id="adjDel">Remove this test</button>' : '<button type="button" class="btn small" id="adjReset"' + (a ? '' : ' disabled') + '>As the indenture reads</button>') +
    '<button type="button" class="btn small" id="adjWork"' + (adjApplied(c.adj) || !U ? '' : ' disabled') + '>Show the working</button><button type="button" class="btn small primary" id="adjDone">Done</button></footer>';
  d.innerHTML = h;
  bindAdjust(c, d, T, B);
}
// the run as the indenture reads, for comparison: the same inputs, without your adjustments
function adjBaseline() {
  const I = state.calcInfo; if (!I || !I.inp || !I.inp.testAdjust) return state.result;
  if (I._base === undefined) { try { const inp = Object.assign({}, I.inp, { lite: true }); delete inp.testAdjust; I._base = E.run(deal(), I.tape, inp); } catch (e) { I._base = null; } }
  return I._base;
}
function bindAdjust(c, d, T, B) {
  const key = c.adj; const R = testRules();
  const get = (make) => { if (key.startsWith('custom:')) return T.custom; let a = R.adj[key]; if (!a && make) a = R.adj[key] = {}; return a; };
  const tidy = () => { const a = R.adj[key]; if (a && !CALC.adjActive(a) && a.numMode !== 'only') delete R.adj[key]; };
  $('.cd-x', d).onclick = () => d.close(); $('#adjDone', d).onclick = () => d.close();
  const add = (list, cond, sel, sel2) => { cond = String(cond || '').trim().replace(/^=\s*/, ''); if (!cond) return; const a = get(true); a[list] = CALC.condList(a[list]); if (a[list].includes(cond)) { toast('That condition is already there.'); return; } a[list].push(cond); if (list === 'numOnly' && !T.custom) a.numMode = 'only'; state.adjFocus2 = sel2 || null; testsChanged(sel); };
  $$('.adjlist', d).forEach(box => {
    const list = box.dataset.list; const b = B[list]; const at = s => '.adjlist[data-list="' + list + '"] ' + s;
    $$('[data-rm]', box).forEach(x => x.onclick = () => { const a = get(); const i = +x.dataset.rm.split(':')[1]; a[list] = CALC.condList(a[list]); a[list].splice(i, 1); tidy(); testsChanged(at('[data-bt]')); });
    $$('[data-quick]', box).forEach(x => x.onclick = () => add(list, x.dataset.quick, at('.quick button:not([disabled])'), at('[data-bt]')));
    const bf = $('[data-bf]', box), bo = $('[data-bo]', box), bv = $('[data-bv]', box);
    const redraw = sel => { renderAdjust(c, d); const f = $(sel, d); if (f) f.focus(); };
    bf.onchange = () => { b.field = bf.value; b.op = ''; b.value = ''; b.values = []; redraw(at('[data-bf]')); };
    bo.onchange = () => { b.op = bo.value; redraw(at('[data-bo]')); };
    if (bv) bv.addEventListener(bv.tagName === 'SELECT' ? 'change' : 'input', () => { if (bv.multiple) b.values = [...bv.selectedOptions].map(o => o.value); else b.value = bv.value; const cond = adjBuild(b); $('[data-badd]', box).disabled = !cond; $('.adjpreview', box).innerHTML = cond ? 'Adds <code class="f">' + esc(cond) + '</code>' : 'Choose a value to add the condition'; });
    $('[data-badd]', box).onclick = () => { const cond = adjBuild(b); if (cond) { b.value = ''; b.values = []; add(list, cond, at('[data-bf]')); } };
    const bt = $('[data-bt]', box); attachComplete(bt);
    const typed = () => add(list, bt.value, at('[data-bt]'));
    $('[data-btadd]', box).onclick = typed; bt.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); typed(); } });
  });
  $$('input[name="adjmode"]', d).forEach(x => x.onchange = () => { const a = get(true); a.numMode = x.value; tidy(); testsChanged('input[name="adjmode"][value="' + x.value + '"]'); });
  const cash = $('[data-cash]', d); if (cash) cash.onchange = () => { const a = get(true); if (cash.checked) delete a.denCash; else a.denCash = false; tidy(); testsChanged('[data-cash]'); };
  $$('[data-u]', d).forEach(x => x.onchange = () => { const u = T.custom; const k = x.dataset.u; u[k] = k === 'limit' ? (x.value === '' ? '' : +x.value) : x.value; if (k === 'kind' && u.kind === 'largest' && !u.field) u.field = 'industry'; testsChanged('[data-u="' + k + '"]'); });
  const rs = $('#adjReset', d); if (rs) rs.onclick = () => { delete R.adj[key]; delete state.adjB[key]; testsChanged('#adjDone'); toast('This test is back as the indenture reads.'); };
  const del = $('#adjDel', d); if (del) del.onclick = () => { if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Select again to remove it'; return; } R.custom = R.custom.filter(u => u.id !== T.id); d.close(); testsChanged(); toast('Your test ' + T.label + ' is removed.'); };
  const wk = $('#adjWork', d); if (wk) wk.onclick = () => { if (tcPart(T.tc)) openCalc({ tc: T.tc, name: T.label }); };
  if (state.adjFocus) { const f = $(state.adjFocus, d), f2 = state.adjFocus2 && $(state.adjFocus2, d); state.adjFocus = state.adjFocus2 = null; const g = f && !f.disabled ? f : f2 && !f2.disabled ? f2 : $('#adjDone', d); if (g) g.focus(); }
}
function addCustomTest() {
  const R = testRules(); let k = R.custom.length + 1; while (R.custom.some(u => u.id === 'U' + k)) k++;
  const u = { id: 'U' + k, label: 'Your test ' + k, kind: 'share', numOnly: [], numSkip: [], denSkip: [], limit: '', op: '<=' };
  R.custom.push(u); saveTestAdj(); run(); openCalc({ adj: 'custom:' + u.id });
  const f = $('#calcd [data-u="label"]'); if (f) { f.focus(); f.select(); }
}
function bindAdjButtons(P) { $$('button.adjb[data-adj]', P).forEach(b => b.onclick = () => openCalc({ adj: b.dataset.adj })); const n = $('#adjNew', P); if (n) n.onclick = addCustomTest; }
