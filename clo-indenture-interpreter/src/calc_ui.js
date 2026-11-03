// ---------- calculations tab: the user's own figures and loan columns, and what they replace
const calcRows = () => (state.calcsByDeal[state.dealId] = state.calcsByDeal[state.dealId] || []);
const cvId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function calcsChanged() { saveCalcs(); scheduleRun(); }
// a figure the run took from a calculation rather than from the inputs or the interpreter
function calcSource(field) {
  const I = state.calcInfo; if (!I) return null;
  const D = I.dealApplied.find(x => x.applied && x.target.how === 'input' && x.target.field === field); return D || null;
}
function calcErrCount() { const I = state.calcInfo; if (!I) return 0; return I.M.vars.filter(v => v.on && v.formula && (I.st.errs.has(v.key) || v.err)).length; } // a new, empty calculation is not an error yet
// the line on the Waterfall and Tests tabs that says which figures your calculations replaced
function overrideBanner(here) {
  const I = state.calcInfo; if (!I) return '';
  const used = I.dealApplied.filter(x => x.applied).map(x => '<b>' + esc(x.target.label) + '</b> (<code class="f">' + esc(x.name) + '</code>)')
    .concat(I.loanApplied.filter(x => x.n).map(x => '<b>' + esc(CALC.lc(x.target.label)) + '</b> (<code class="f">' + esc(x.name) + '</code>, ' + x.changed + ' of ' + x.n + ' loans changed)'));
  const bad = I.dealApplied.filter(x => !x.applied).map(x => esc(x.name) + ' ' + esc(x.why) + ', so the interpreter\'s ' + esc(x.target.label) + ' is used');
  const mErr = I.manual.filter(m => m.err).length;
  if (!used.length && !bad.length && !mErr) return '';
  return '<div class="notice' + (bad.length || mErr ? ' warn' : '') + '">' + (used.length ? 'Your calculations replace the interpreter\'s ' + used.join(', ') + '. ' : '') + (bad.length ? bad.join('; ') + '. ' : '') +
    (mErr ? mErr + ' manual amount' + (mErr > 1 ? 's have formula errors and count' : ' has a formula error and counts') + ' as zero. ' : '') + (here ? '' : '<button class="linkbtn" type="button" data-gotab="calcs">Open Calculations</button>') + '</div>';
}
function bindBanner(P) { $$('[data-gotab]', P).forEach(b => b.onclick = () => { selectTab(b.dataset.gotab); const top = tabsTop(); if (window.scrollY > top) window.scrollTo(0, top); }); }

function cvTargetOptions(kind, cur) {
  const T = CALC.TARGETS[kind === 'loan' ? 'loan' : 'deal']; const s = deal(); const F = s.fees || {};
  const has = t => t.id === 'seniorMgmt' ? !!F.seniorMgmt : t.id === 'structuring' ? !!F.structuring : t.id === 'subMgmtCurrent' ? !!F.subMgmt : true;
  return '<option value="">Replaces nothing</option>' + T.filter(t => has(t) || t.id === cur).map(t => '<option value="' + t.id + '"' + (t.id === cur ? ' selected' : '') + '>Replaces ' + esc(kind === 'loan' ? CALC.lc(t.label) + ' on the tape' : t.label) + '</option>').join('');
}
function cvResultHTML(c) {
  const I = state.calcInfo; if (!c.on) return '<span class="small">Switched off. It replaces nothing and other formulas cannot use it.</span>';
  const v = I && I.M.vars.find(x => x.id === c.id); if (!v) return '<span class="small">Not run yet.</span>';
  if (!v.formula) return '<span class="small">' + (v.name ? 'Enter a formula. Typing part of a name lists the names that match.' : 'Give it a name, then a formula.') + '</span>';
  const err = I.st.errs.get(v.key) || v.err; if (err) return '<span class="cv-err">' + esc(err) + '</span>';
  const btn = (txt, lab) => '<button type="button" class="calc" data-cv="' + esc(v.key) + '" aria-label="' + esc(lab) + '">' + txt + '</button>';
  if (v.kind === 'deal') {
    const x = I.st.vals.get(v.key); const D = I.dealApplied.find(d => d.key === v.key);
    let h = '<span>Value</span> <span class="v">' + btn(esc(typeof x === 'number' ? cents(x) : CALC.fmtV(x)), v.name + ': show the working') + '</span>';
    if (D && D.applied && D.interp != null) h += '<span>Interpreter\'s ' + esc(D.target.label) + ' ' + cents(D.interp) + '; difference ' + cents(D.value - D.interp) + '</span>';
    else if (D && !D.applied) h += '<span class="cv-err">Not applied: ' + esc(D.why) + '</span>';
    return h;
  }
  const vals = I.st.vals.get(v.key) || []; const nums = vals.filter(x => typeof x === 'number'); const blank = vals.filter(x => x == null || x === '').length;
  let h = '<span>' + vals.length + ' loans' + (blank ? ', ' + blank + ' blank' : '') + '</span>' + (nums.length ? '<span>Total <span class="v">' + btn(cents(nums.reduce((s, x) => s + x, 0)), v.name + ': show the working, loan by loan') + '</span></span>' : '<span>' + btn('Working', v.name + ': show the working, loan by loan') + '</span>');
  const A = I.loanApplied.find(a => a.key === v.key);
  if (A && A.target.id === 'defaulted') h += '<span>Defaulted loans: ' + A.before + ' on the tape, ' + A.after + ' with this column</span>';
  else if (A && A.target.text) h += '<span>' + esc(A.target.label) + ': ' + A.changed + ' of ' + A.n + ' loans changed' + (A.bad ? '; ' + A.bad + ' not a rating, so the tape\'s is kept' : '') + '</span>';
  else if (A) h += '<span>' + esc(A.target.label) + ': ' + cents(A.before) + ' on the tape, ' + cents(A.after) + ' with this column; ' + A.changed + ' of ' + A.n + ' loans changed</span>';
  return h;
}
// groups are named sets of steps, e.g. "Principal Balance": shown together, in the order the calculations were added
function cvGroups(L) { const G = []; L.forEach(c => { const g = c.group || ''; if (!G.includes(g)) G.push(g); }); return G; }
function cvCardHTML(c, i, L, step) {
  const I = state.calcInfo; const v = I && I.M.vars.find(x => x.id === c.id); const bad = c.on !== false && v && v.formula && (I.st.errs.has(v.key) || v.err);
  const g = c.group || ''; const same = L.map((x, k) => k).filter(k => (L[k].group || '') === g); const at = same.indexOf(i);
  const G = cvGroups(L).filter(Boolean);
  const lab = (step ? 'Step ' + step + (g ? ' of ' + g : '') : 'Calculation ' + (i + 1));
  return '<div class="cv' + (c.on === false ? ' off' : '') + (bad ? ' bad' : '') + '" data-ci="' + i + '"><div class="cv-top">' + (step ? '<span class="cvstep">Step ' + step + '</span>' : '') +
    '<input type="text" class="cvname" data-cf="name" data-fk="' + c.id + '-name" value="' + esc(c.name || '') + '" placeholder="Name, e.g. ' + (c.kind === 'loan' ? 'Principal_Balance_2' : 'Fee_Basis_Amount_2') + '" aria-label="' + esc(lab) + ' name" spellcheck="false" autocomplete="off">' +
    '<select data-cf="kind" data-fk="' + c.id + '-kind" aria-label="' + esc(lab) + ' kind"><option value="deal"' + (c.kind !== 'loan' ? ' selected' : '') + '>Deal figure</option><option value="loan"' + (c.kind === 'loan' ? ' selected' : '') + '>Loan column</option></select>' +
    '<select data-cf="use" data-fk="' + c.id + '-use" aria-label="' + esc(lab) + ': what it replaces">' + cvTargetOptions(c.kind, c.use) + '</select>' +
    '<label class="check" style="margin:0"><input type="checkbox" data-cf="on" data-fk="' + c.id + '-on"' + (c.on !== false ? ' checked' : '') + '> On</label>' +
    '<span class="cv-acts"><button type="button" class="ib" data-cup="' + i + '" aria-label="Move ' + esc(lab) + ' up"' + (at > 0 ? '' : ' disabled') + '>↑</button><button type="button" class="ib" data-cdown="' + i + '" aria-label="Move ' + esc(lab) + ' down"' + (at < same.length - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="ib" data-cdel="' + i + '" aria-label="Delete ' + esc(lab) + '">×</button></span></div>' +
    '<textarea class="cvf" data-cf="formula" data-fk="' + c.id + '-formula" rows="2" spellcheck="false" autocomplete="off" aria-label="Formula for ' + esc(c.name || lab) + '" placeholder="' + (c.kind === 'loan' ? 'IFBLANK(principal_balance, par)' : 'SUM(par, NOT defaulted) + Principal_Proceeds') + '">' + esc(c.formula || '') + '</textarea>' +
    '<div class="cv-live small" aria-live="polite"></div>' +
    '<div class="cv-meta"><input type="text" class="cvnote" data-cf="note" data-fk="' + c.id + '-note" value="' + esc(c.note || '') + '" placeholder="Note: the definition it follows, e.g. Fee Basis Amount, Section 1.1" aria-label="' + esc(lab) + ' note">' +
    '<select data-cf="group" data-fk="' + c.id + '-group" aria-label="' + esc(lab) + ': group"><option value=""' + (g ? '' : ' selected') + '>Not in a group</option>' + G.map(x => '<option value="' + esc(x) + '"' + (x === g ? ' selected' : '') + '>In ' + esc(x) + '</option>').join('') + '<option value="__new">In a new group…</option></select></div>' +
    '<div class="cv-res">' + cvResultHTML(c) + '</div></div>';
}
function cvGroupHTML(g, gi, G, L) {
  const ix = L.map((c, k) => k).filter(k => (L[k].group || '') === g); const cs = ix.map(k => L[k]);
  const closed = state.cvClosed && state.cvClosed.has(g); const nOn = cs.filter(c => c.on !== false).length;
  const fin = cs.filter(c => c.use && c.on !== false).map(c => { const T = (CALC.TARGETS[c.kind === 'loan' ? 'loan' : 'deal'] || []).find(t => t.id === c.use); return T ? c.name + ' replaces ' + (c.kind === 'loan' ? CALC.lc(T.label) : T.label) : ''; }).filter(Boolean);
  const loans = cs.some(c => c.kind === 'loan' && c.on !== false && c.name);
  const named = G.filter(Boolean); const ni = named.indexOf(g);
  return '<section class="cvgroup" data-gi="' + gi + '" aria-label="Group ' + esc(g) + '"><div class="cvg-head">' +
    '<button type="button" class="cvg-tog" data-gtog="' + gi + '" aria-expanded="' + !closed + '" aria-label="' + (closed ? 'Show' : 'Hide') + ' the steps of ' + esc(g) + '">▾</button>' +
    '<input type="text" class="cvgname" data-gname="' + gi + '" data-fk="g-' + esc(cs[0].id) + '" value="' + esc(g) + '" aria-label="Group name" spellcheck="false" autocomplete="off">' +
    '<span class="cvgsum">' + cs.length + ' step' + (cs.length === 1 ? '' : 's') + (fin.length ? '; ' + esc(fin.join('; ')) : '') + '</span>' +
    '<span class="cvg-acts"><label class="check" style="margin:0"><input type="checkbox" data-gon="' + gi + '"' + (nOn ? ' checked' : '') + (nOn && nOn < cs.length ? ' data-mixed="1"' : '') + '> On</label>' +
    '<button type="button" class="btn small" data-gadd="' + gi + '">Add a step</button>' +
    (loans && state.calcInfo ? '<button type="button" class="btn small" data-gwork="' + gi + '">Working, loan by loan</button>' : '') +
    '<button type="button" class="ib" data-gup="' + gi + '" aria-label="Move the group ' + esc(g) + ' up"' + (ni > 0 ? '' : ' disabled') + '>↑</button><button type="button" class="ib" data-gdown="' + gi + '" aria-label="Move the group ' + esc(g) + ' down"' + (ni < named.length - 1 ? '' : ' disabled') + '>↓</button>' +
    '<button type="button" class="btn small" data-gdel="' + gi + '">Delete group</button></span></div>' +
    '<div class="cvg-body"' + (closed ? ' hidden' : '') + '>' + ix.map((k, n) => cvCardHTML(L[k], k, L, n + 1)).join('') + '</div></section>';
}
function renderCalcs() {
  const P = $('#p-calcs'); if (!P) return;
  const ae = document.activeElement; const fk = ae && ae.dataset ? ae.dataset.fk : null; const selS = ae && 'selectionStart' in ae ? ae.selectionStart : null, selE = ae && 'selectionEnd' in ae ? ae.selectionEnd : null;
  const draft = ae && ae.dataset && ae.dataset.cf === 'formula' && P.contains(ae) ? ae.value : null; // a formula being typed survives a redraw
  const L = calcRows(); const s = deal(); state.cvClosed = state.cvClosed || new Set();
  let h = '<div class="sec"><h2>Calculations</h2><p class="lead">Your own figures and loan columns, written as formulas. Use one where the interpreter does not work a figure out the way the indenture does: it can replace the Fee Basis Amount, Principal Collateral Value, a fee due, or a loan\'s par, price or rating, and everything that uses that figure then uses yours. Where it takes several steps, put them in a <b>group</b>, such as Principal Balance: each step can use the ones before it, and the last can replace the tape\'s figure. A calculation\'s name can also be used in Manual inputs, where an amount that starts with = is a formula.</p>' + overrideBanner(true);
  h += '<div class="toolbar"><button class="btn small" type="button" id="cvAddGroup">Add a group</button><button class="btn small" type="button" id="cvAddDeal">Add a deal figure</button><button class="btn small" type="button" id="cvAddLoan">Add a loan column</button>' +
    '<select id="cvEx" aria-label="Add an example"><option value="">Add an example…</option>' + CALC.EXAMPLES.map((x, i) => '<option value="' + i + '">' + esc(x.label || (x.name + (x.use ? ', replaces ' + CALC.lc((CALC.TARGETS[x.kind].find(t => t.id === x.use) || {}).label || '') : ''))) + '</option>').join('') + '</select>' +
    (L.length ? '<button class="btn small" type="button" id="cvExport">' + (state.caps.downloads ? 'Download (JSON)' : 'Copy as JSON') + '</button>' : '') + '<label class="btn small" for="cvImport">Import</label><input type="file" id="cvImport" accept=".json,application/json" hidden></div>';
  if (!L.length) h += '<div class="box small" style="max-width:760px">No calculations for ' + esc(s.meta.name) + ' yet. A <b>deal figure</b> is one number for the Payment Date, such as <code class="f">SUM(par, NOT defaulted) + Principal_Proceeds</code>. A <b>loan column</b> is worked out for every loan, such as <code class="f">IFBLANK(principal_balance, par)</code>, and can stand in for par. A <b>group</b> holds the steps of one longer calculation. Pick an example to start from.</div>';
  const G = cvGroups(L); const grouped = G.some(Boolean);
  h += '<div class="cvlist">' + G.map((g, gi) => g ? cvGroupHTML(g, gi, G, L) : (grouped ? '<h3 class="cvg-plain">Not in a group</h3>' : '') + L.map((c, k) => (c.group || '') === '' ? cvCardHTML(c, k, L, 0) : '').join('')).join('') + '</div>';
  if (L.length) h += '<p class="small" style="margin-top:8px">Kept in this browser for ' + esc(s.meta.name) + ' and worked out again on every Payment Date, in whatever order the formulas need. A formula is applied when you leave the box, or press Ctrl+Enter. Where a deal figure replaces the Fee Basis Amount, Principal Collateral Value or a fee, the projection uses it on every projected date; loan columns are applied to the projection\'s starting tape.</p>';
  h += '</div>' + cvRefHTML();
  P.innerHTML = h; bindCalcs(P);
  $$('[data-mixed]', P).forEach(x => { x.indeterminate = true; });
  if (fk) { const el = P.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(fk) : fk) + '"]'); if (el) { if (draft != null && el.dataset.cf === 'formula') { el.value = draft; el.dispatchEvent(new Event('input')); } el.focus(); if (selS != null && el.setSelectionRange && (el.type === 'text' || el.tagName === 'TEXTAREA')) try { el.setSelectionRange(selS, selE); } catch (e) { /* not a text field */ } } }
}
// the names a formula can use, with today's values; selecting one adds it to the formula being edited
function cvRefHTML() {
  const s = deal(); const I = state.calcInfo; const r = state.result;
  const B = CALC.builtinDefs(s); const bval = b => { if (I && I.st.builtins.has(b.key)) return I.st.builtins.get(b.key); try { return b.get(r); } catch (e) { return null; } };
  const nm = (name, label, value) => '<div class="nm"><button type="button" data-ins="' + esc(name) + '" aria-label="Add ' + esc(name) + ' to the formula">' + esc(name) + '</button>' + (value !== undefined ? '<em>' + esc(value == null ? '—' : typeof value === 'number' ? CALC.fmtV(value) : value) + '</em>' : '<em></em>') + '<span>' + esc(label) + '</span></div>';
  const groups = ['Dates', 'Deal', 'Period', 'Collateral', 'Cash', 'Fees', 'Notes', 'Tests'];
  const extra = CALC.extraColumns(state.tape || []);
  const mine = calcRows().filter(c => c.on !== false && c.name);
  let h = '<div class="sec refs"><h2>Names you can use</h2><p class="lead">Built-in figures are the interpreter\'s own for this Payment Date, before any calculation replaces them. Loan columns are used loan by loan in a loan column, and inside SUM, AVG, WAVG, MINOF, MAXOF or COUNT in a deal figure. Select a name to add it to the formula you are editing.</p>';
  h += '<details open><summary>Built-in figures</summary><div class="names">' + groups.map(g => B.filter(b => b.group === g).map(b => nm(b.name, b.label, bval(b))).join('')).join('') + '</div></details>';
  h += '<details><summary>Loan columns (' + (CALC.STD_COLS.length + extra.length) + ')</summary><div class="names">' + extra.map(c => nm(c.name, 'From your tape' + (c.raw !== c.key ? ' (column "' + c.raw + '")' : ''))).join('') + CALC.STD_COLS.map(c => nm(c[0], c[1])).join('') + '</div>' +
    (extra.length ? '' : '<p class="small" style="margin:8px 0 0">Columns in an uploaded tape beyond the standard ones, such as a Principal Balance column, appear here under their own names, e.g. <code class="f">principal_balance</code>.</p>') + '</details>';
  if (mine.length) h += '<details open><summary>Your calculations</summary><div class="names">' + mine.map(c => { const v = I && I.M.byKey.get(String(c.name).toLowerCase()); const x = v && v.kind === 'deal' && I.st.vals.has(v.key) ? I.st.vals.get(v.key) : undefined; return nm(c.name, (c.kind === 'loan' ? 'Loan column' : 'Deal figure') + (c.group ? ' in ' + c.group : '') + (c.note ? ': ' + c.note : ''), x); }).join('') + '</div></details>';
  h += '<details><summary>Functions and operators</summary><div class="names">' + Object.entries(CALC.FUNCS).map(([k, f]) => '<div class="nm"><button type="button" data-ins="' + esc(k + '(') + '" aria-label="Add ' + k + ' to the formula">' + esc(f.sig) + '</button><em></em><span>' + esc(f.d) + '</span></div>').join('') +
    [['+ − * / ^', 'Arithmetic; ^ is a power'], ['0.15%', 'A percentage: 0.15% is 0.0015'], ['= <> < <= > >=', 'Comparisons, giving 1 or 0; text is compared in any case'], ['AND OR NOT', 'Combine conditions: NOT defaulted AND asset_type = "SSL"'], ['"SSL"', 'Text goes in quotes'], ['TRUE FALSE', '1 and 0']].map(([a, b]) => '<div class="nm"><code class="f">' + esc(a) + '</code><em></em><span>' + esc(b) + '</span></div>').join('') + '</div></details></div>';
  return h;
}
function cvNewGroupName(L, base) { const have = new Set(L.map(c => (c.group || '').toLowerCase())); let n = L.filter(c => c.group).length ? cvGroups(L).filter(Boolean).length + 1 : 1; let g = base || 'Group ' + n; let k = 2; while (have.has(g.toLowerCase())) g = (base || 'Group') + ' ' + (base ? k++ : ++n); return g; }
function bindCalcs(P) {
  bindBanner(P);
  const L = calcRows(); const G = cvGroups(L);
  const blank = { name: '', kind: 'deal', formula: '', use: '', note: '', on: true, group: '' };
  const focusCard = (id, sel) => setTimeout(() => { const el = $$('#p-calcs .cv').find(x => (L[+x.dataset.ci] || {}).id === id); const f = el && el.querySelector(sel || '.cvname'); if (f) f.focus(); }, 30);
  const add = (c, focus) => { const x = Object.assign({ id: cvId() }, blank, c); const g = x.group || ''; let at = -1; L.forEach((y, k) => { if ((y.group || '') === g) at = k; }); if (g && at >= 0) L.splice(at + 1, 0, x); else L.push(x); calcsChanged(); renderCalcs(); focusCard(x.id, focus); return x; };
  $('#cvAddDeal', P).onclick = () => add({ kind: 'deal' });
  $('#cvAddLoan', P).onclick = () => add({ kind: 'loan' });
  $('#cvAddGroup', P).onclick = () => { const g = cvNewGroupName(L); add({ kind: 'loan', group: g }); setTimeout(() => { const el = $$('#p-calcs .cvgname').find(x => x.value === g); if (el) { el.focus(); el.select(); } }, 40); };
  $('#cvEx', P).onchange = e => {
    const x = CALC.EXAMPLES[+e.target.value]; if (!x) return; const taken = n => L.some(c => String(c.name).toLowerCase() === n.toLowerCase());
    const uniq = n => { let m = n, k = 2; while (taken(m)) m = n + '_' + (k++); return m; };
    const useFree = (kind, use) => use && !L.some(c => c.on !== false && c.kind === kind && c.use === use) ? use : '';
    if (!x.steps) { const name = uniq(x.name); const use = useFree(x.kind, x.use); add(Object.assign({}, x, { name, use, group: '' }), '.cvf'); if (use !== (x.use || '')) toast('Added without replacing ' + x.use + ': another calculation already does.'); return; }
    // a group: steps renamed where a name is taken, and the later steps' formulas follow the new names
    const g = cvNewGroupName(L, x.group); const ren = {}; x.steps.forEach(st => { ren[st.name] = uniq(st.name); });
    const fix = f => f.replace(/[A-Za-z_][A-Za-z0-9_]*/g, w => ren[w] || w); let lost = '';
    x.steps.forEach(st => { const use = useFree(st.kind, st.use); if (use !== (st.use || '')) lost = st.use; L.push(Object.assign({ id: cvId() }, blank, st, { name: ren[st.name], formula: fix(st.formula), use, group: g })); });
    calcsChanged(); renderCalcs(); toast('Added the group ' + g + ' with ' + x.steps.length + ' steps.' + (lost ? ' Its last step replaces nothing yet: another calculation already replaces ' + lost + '.' : ''));
  };
  const ex = $('#cvExport', P); if (ex) ex.onclick = async () => {
    const json = JSON.stringify({ format: 'clo-interpreter-calculations', version: 2, deal: deal().meta.name, exported: new Date().toISOString().slice(0, 10), calculations: L.map(c => ({ group: c.group || '', name: c.name, kind: c.kind, formula: c.formula, use: c.use || '', note: c.note || '', on: c.on !== false })) }, null, 1);
    if (state.caps.downloads) { saveFile('calculations-' + deal().meta.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '.json', json); return; }
    try { await navigator.clipboard.writeText(json); toast('Calculations copied as JSON.'); } catch (e) { toast('Copying is blocked here.'); }
  };
  $('#cvImport', P).onchange = async e => {
    const f = e.target.files[0]; if (!f) return; let d; try { d = JSON.parse(await f.text()); } catch (er) { toast('That file is not JSON.'); return; }
    const list = Array.isArray(d) ? d : d && Array.isArray(d.calculations) ? d.calculations : null; if (!list) { toast('No calculations in that file.'); return; }
    let added = 0, replaced = 0;
    list.filter(x => x && (x.name || x.formula)).forEach(x => {
      const c = { name: String(x.name || '').trim(), kind: x.kind === 'loan' ? 'loan' : 'deal', formula: String(x.formula || ''), use: String(x.use || ''), note: String(x.note || ''), on: x.on !== false, group: String(x.group || '').trim() };
      const i = L.findIndex(y => y.name && String(y.name).toLowerCase() === c.name.toLowerCase());
      if (i >= 0) { L[i] = Object.assign({ id: L[i].id }, c); replaced++; } else { L.push(Object.assign({ id: cvId() }, c)); added++; }
    });
    calcsChanged(); toast('Imported ' + (added + replaced) + ' calculation' + (added + replaced === 1 ? '' : 's') + (replaced ? ' (' + replaced + ' replaced one with the same name)' : '') + '.');
  };
  $$('.cv', P).forEach(card => {
    const i = +card.dataset.ci; const c = L[i]; if (!c) return;
    $$('[data-cf]', card).forEach(el => {
      const f = el.dataset.cf;
      if (f === 'formula') {
        el.dataset.acSelf = c.name || ''; attachComplete(el);
        const live = $('.cv-live', card);
        const check = () => { const t = el.value.trim(); if (!t) { live.textContent = ''; return; } try { CALC.parse(t.replace(/^=/, '')); live.textContent = ''; } catch (er) { live.textContent = er.message; live.classList.add('cv-err'); } };
        el.addEventListener('input', check);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.blur(); el.focus(); } });
        el.addEventListener('focus', () => { state.cvFocus = { id: c.id }; });
        el.addEventListener('change', () => { c.formula = el.value.trim(); calcsChanged(); });
        el.addEventListener('blur', () => { state.cvFocus = { id: c.id, start: el.selectionStart, end: el.selectionEnd }; });
        return;
      }
      el.addEventListener('change', () => {
        if (f === 'on') c.on = el.checked;
        else if (f === 'kind') { c.kind = el.value; if (c.use && !CALC.TARGETS[c.kind].some(t => t.id === c.use)) c.use = ''; }
        else if (f === 'use') { const clash = el.value && L.find(y => y !== c && y.on !== false && y.kind === c.kind && y.use === el.value); if (clash) { toast(clash.name + ' already replaces it. Switch that one off, or have it replace nothing, first.'); el.value = c.use || ''; return; } c.use = el.value; }
        else if (f === 'group') {
          // moved to the end of the group it joins, so its steps stay together
          const g = el.value === '__new' ? cvNewGroupName(L) : el.value; L.splice(i, 1); c.group = g; let at = -1; L.forEach((y, k) => { if ((y.group || '') === g) at = k; }); if (at >= 0) L.splice(at + 1, 0, c); else L.push(c);
          calcsChanged(); renderCalcs(); focusCard(c.id, 'select[data-cf="group"]'); if (el.value === '__new') toast('Moved to a new group, ' + g + '. Rename it in the group\'s header.'); return;
        }
        else c[f] = el.value.trim();
        calcsChanged();
      });
    });
  });
  // a step moves within its group; a group moves as a block
  const sameIx = i => L.map((x, k) => k).filter(k => (L[k].group || '') === (L[i].group || ''));
  $$('[data-cdel]', P).forEach(b => b.onclick = () => { const c = L[+b.dataset.cdel]; L.splice(+b.dataset.cdel, 1); calcsChanged(); toast('Deleted ' + (c.name || 'the calculation') + '.'); });
  $$('[data-cup],[data-cdown]', P).forEach(b => b.onclick = () => { const i = +(b.dataset.cup || b.dataset.cdown); const S = sameIx(i); const at = S.indexOf(i); const j = S[b.dataset.cup != null ? at - 1 : at + 1]; if (j == null) return; [L[i], L[j]] = [L[j], L[i]]; calcsChanged(); renderCalcs(); focusCard(L[j].id, b.dataset.cup != null ? '[data-cup]' : '[data-cdown]'); });
  const inG = gi => L.filter(c => (c.group || '') === G[+gi]);
  $$('[data-gtog]', P).forEach(b => b.onclick = () => { const g = G[+b.dataset.gtog]; if (state.cvClosed.has(g)) state.cvClosed.delete(g); else state.cvClosed.add(g); renderCalcs(); const t = $('[data-gtog="' + b.dataset.gtog + '"]', P); if (t) t.focus(); });
  $$('[data-gname]', P).forEach(inp => inp.addEventListener('change', () => {
    const old = G[+inp.dataset.gname]; const g = inp.value.trim().replace(/\s+/g, ' ');
    if (!g) { inp.value = old; toast('A group needs a name.'); return; }
    if (g.toLowerCase() !== old.toLowerCase() && G.some(x => x && x.toLowerCase() === g.toLowerCase())) { inp.value = old; toast('There is already a group called ' + g + '.'); return; }
    L.forEach(c => { if (c.group === old) c.group = g; }); if (state.cvClosed.has(old)) { state.cvClosed.delete(old); state.cvClosed.add(g); } calcsChanged();
  }));
  $$('[data-gon]', P).forEach(x => x.addEventListener('change', () => { inG(x.dataset.gon).forEach(c => { c.on = x.checked; }); calcsChanged(); }));
  $$('[data-gadd]', P).forEach(b => b.onclick = () => { const cs = inG(b.dataset.gadd); add({ kind: cs.length ? cs[cs.length - 1].kind : 'loan', group: G[+b.dataset.gadd] }); });
  $$('[data-gwork]', P).forEach(b => b.onclick = () => openCalc({ cg: G[+b.dataset.gwork], gi: +b.dataset.gwork }));
  $$('[data-gup],[data-gdown]', P).forEach(b => b.onclick = () => {
    const gi = +(b.dataset.gup || b.dataset.gdown); const named = G.filter(Boolean); const k = named.indexOf(G[gi]); const k2 = b.dataset.gup != null ? k - 1 : k + 1; if (k2 < 0 || k2 >= named.length) return;
    const order = G.slice(); const a1 = order.indexOf(named[k]), a2 = order.indexOf(named[k2]); [order[a1], order[a2]] = [order[a2], order[a1]]; const next = order.flatMap(g => L.filter(c => (c.group || '') === g)); // the ungrouped block keeps its place
    L.splice(0, L.length, ...next); calcsChanged(); renderCalcs(); const t = $$('#p-calcs [data-gname]').find(x => x.value === named[k]); if (t) t.focus();
  });
  $$('[data-gdel]', P).forEach(b => b.onclick = () => {
    const g = G[+b.dataset.gdel]; const n = inG(b.dataset.gdel).length;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete ' + n + ' step' + (n === 1 ? '' : 's') + '?'; b.classList.add('warn'); setTimeout(() => { if (document.body.contains(b)) { delete b.dataset.armed; b.textContent = 'Delete group'; b.classList.remove('warn'); } }, 4000); return; }
    L.splice(0, L.length, ...L.filter(c => (c.group || '') !== g)); state.cvClosed.delete(g); calcsChanged(); renderCalcs(); toast('Deleted the group ' + g + ' and its ' + n + ' step' + (n === 1 ? '' : 's') + '.');
  });
  $$('button.calc[data-cv]', P).forEach(b => b.onclick = () => openCalc({ cv: b.dataset.cv }));
  $$('[data-ins]', P).forEach(b => b.onclick = () => {
    const F = state.cvFocus; const card = F && $$('.cv', P).find(x => (L[+x.dataset.ci] || {}).id === F.id); const ta = card && $('.cvf', card);
    if (!ta) { toast('Select a formula box first, then the name to add.'); return; }
    const a = F.start != null ? F.start : ta.value.length, z = F.end != null ? F.end : a; const ins = b.dataset.ins;
    ta.value = ta.value.slice(0, a) + ins + ta.value.slice(z); ta.focus(); const p = a + ins.length; ta.setSelectionRange(p, p); state.cvFocus = { id: F.id, start: p, end: p };
    ta.dispatchEvent(new Event('input'));
  });
}
// ---------- suggestions while a formula is typed: every name that matches the word at the cursor
const AC = { list: null, field: null, items: [], i: 0, start: 0, end: 0, mute: false };
function acItems(self) {
  const I = state.calcInfo, r = state.result, out = [];
  const bval = b => { if (I && I.st.builtins.has(b.key)) return I.st.builtins.get(b.key); try { return b.get(r); } catch (e) { return null; } };
  calcRows().filter(c => c.on !== false && c.name && c.name.toLowerCase() !== String(self || '').toLowerCase()).forEach(c => {
    const v = I && I.M.byKey.get(String(c.name).toLowerCase()); const x = v && v.kind === 'deal' && I.st.vals.has(v.key) ? I.st.vals.get(v.key) : undefined;
    out.push({ name: c.name, kind: (c.kind === 'loan' ? 'Your loan column' : 'Your calculation') + (c.group ? ' in ' + c.group : ''), detail: c.note || '', value: x });
  });
  CALC.builtinDefs(deal()).forEach(b => out.push({ name: b.name, kind: 'Built-in', detail: b.label, value: bval(b) }));
  CALC.extraColumns(state.tape || []).forEach(c => out.push({ name: c.name, kind: 'Loan column', detail: 'From your tape' }));
  CALC.STD_COLS.forEach(c => out.push({ name: c[0], kind: 'Loan column', detail: c[1] }));
  Object.entries(CALC.FUNCS).forEach(([k, f]) => out.push({ name: k, kind: 'Function', detail: f.sig + ': ' + f.d, insert: k + '(' }));
  return out;
}
// names that start with the word come first, then a part of a name (after an underscore), then anywhere in it
function acMatch(items, word) {
  const w = word.toLowerCase(), w2 = w.replace(/_/g, '');
  const score = n => { const l = n.toLowerCase(); if (l.startsWith(w)) return 0; if (l.includes('_' + w)) return 1; if (l.replace(/_/g, '').includes(w2)) return 2; return -1; };
  return items.map((x, i) => ({ x, s: score(x.name), i })).filter(o => o.s >= 0).sort((a, b) => a.s - b.s || a.i - b.i).map(o => o.x).slice(0, 40);
}
function acEnsure() {
  if (AC.list) return;
  const u = document.createElement('ul'); u.id = 'acList'; u.className = 'aclist'; u.setAttribute('role', 'listbox'); u.setAttribute('aria-label', 'Names that match'); u.hidden = true; document.body.appendChild(u);
  u.addEventListener('mousedown', e => { const li = e.target.closest('li[data-ai]'); e.preventDefault(); if (li) acPick(+li.dataset.ai); });
  window.addEventListener('resize', acClose); window.addEventListener('scroll', () => { if (AC.field) acPlace(); }, true);
  AC.list = u;
}
function acClose() { if (!AC.list || AC.list.hidden) return; AC.list.hidden = true; if (AC.field) { AC.field.setAttribute('aria-expanded', 'false'); AC.field.removeAttribute('aria-activedescendant'); } AC.field = null; }
function acPlace() {
  const f = AC.field, u = AC.list; if (!f || !document.body.contains(f)) { acClose(); return; }
  const r = f.getBoundingClientRect(); const W = Math.min(440, window.innerWidth - 16);
  u.style.width = W + 'px'; u.style.left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) + window.scrollX + 'px';
  const h = u.offsetHeight; const below = window.innerHeight - r.bottom; const up = below < h + 8 && r.top > h + 8;
  u.style.top = (up ? r.top - h - 4 : r.bottom + 4) + window.scrollY + 'px';
}
function acShow() {
  const u = AC.list; const w = AC.word.toLowerCase();
  const mark = n => { const k = n.toLowerCase().indexOf(w); return k < 0 ? esc(n) : esc(n.slice(0, k)) + '<mark>' + esc(n.slice(k, k + w.length)) + '</mark>' + esc(n.slice(k + w.length)); };
  u.innerHTML = AC.items.map((x, i) => '<li role="option" id="ac-' + i + '" data-ai="' + i + '" aria-selected="' + (i === AC.i) + '"><b>' + mark(x.name) + '</b><em>' + (x.value === undefined || x.value === null ? '' : esc(typeof x.value === 'number' ? CALC.fmtV(x.value) : String(x.value))) + '</em><span>' + esc(x.kind + (x.detail ? ' · ' + x.detail : '')) + '</span></li>').join('') +
    '<li class="achint" role="presentation">↑ ↓ to choose · Enter or Tab to use · Esc to close</li>';
  u.hidden = false; AC.field.setAttribute('aria-expanded', 'true'); AC.field.setAttribute('aria-activedescendant', 'ac-' + AC.i); acPlace();
}
function acMove(d) { const n = AC.items.length; AC.i = (AC.i + d + n) % n; $$('li[data-ai]', AC.list).forEach(li => li.setAttribute('aria-selected', String(+li.dataset.ai === AC.i))); AC.field.setAttribute('aria-activedescendant', 'ac-' + AC.i); const li = $('#ac-' + AC.i); if (li) li.scrollIntoView({ block: 'nearest' }); }
function acUpdate(f, eqOnly) {
  if (AC.mute) return;
  const v = f.value, pos = f.selectionStart; if (pos == null || pos !== f.selectionEnd) { acClose(); return; }
  if (eqOnly && !/^\s*=/.test(v)) { acClose(); return; }
  const before = v.slice(0, pos); if ((before.match(/"/g) || []).length % 2) { acClose(); return; } // inside "text"
  const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/); if (!m) { acClose(); return; }
  const start = pos - m[0].length; if (start > 0 && /[\d.]/.test(before[start - 1])) { acClose(); return; } // part of a number such as 1e6
  const tail = v.slice(pos).match(/^[A-Za-z0-9_]*/)[0]; const whole = (m[0] + tail).toLowerCase();
  const items = acMatch(acItems(f.dataset.acSelf), m[0]);
  if (!items.length || (items.length === 1 && items[0].name.toLowerCase() === whole)) { acClose(); return; }
  if (AC.field && AC.field !== f) acClose();
  Object.assign(AC, { field: f, items, i: 0, start, end: pos + tail.length, word: m[0] }); acShow();
}
function acPick(i) {
  const x = AC.items[i], f = AC.field; if (!x || !f) return;
  const ins = x.insert || x.name; f.value = f.value.slice(0, AC.start) + ins + f.value.slice(AC.end); const p = AC.start + ins.length;
  acClose(); f.focus(); f.setSelectionRange(p, p);
  AC.mute = true; f.dispatchEvent(new Event('input', { bubbles: true })); AC.mute = false;
}
function attachComplete(f, eqOnly) {
  if (f.dataset.ac) return; f.dataset.ac = '1'; acEnsure();
  f.setAttribute('aria-autocomplete', 'list'); f.setAttribute('aria-controls', 'acList'); f.setAttribute('aria-expanded', 'false');
  f.addEventListener('input', () => acUpdate(f, eqOnly));
  f.addEventListener('keydown', e => {
    if (!AC.list || AC.list.hidden || AC.field !== f) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acMove(e.key === 'ArrowDown' ? 1 : -1); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); acPick(AC.i); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acClose(); }
  });
  f.addEventListener('blur', () => setTimeout(() => { if (AC.field === f && document.activeElement !== f) acClose(); }, 150));
}
