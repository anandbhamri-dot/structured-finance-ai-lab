// ---- teaching the reader: lessons saved in this browser and tried first on every document read after
const LESSON_KEY = 'clo-interpreter-lessons-v1';
function getLessons() { if (!state.lessons) state.lessons = loadLessons(); return state.lessons; }
function loadLessons() { try { const raw = localStorage.getItem(LESSON_KEY); return rrLessons(raw ? JSON.parse(raw) : null); } catch (e) { return rrLessons(null); } }
function saveLessons() { try { localStorage.setItem(LESSON_KEY, JSON.stringify(state.lessons)); } catch (e) { /* storage unavailable: lessons last for this visit */ } }
const lessonCount = L => L.values.length + L.clauses.length + L.conc.length;
const lessonList = L => [].concat(L.values.map(x => ['values', x]), L.clauses.map(x => ['clauses', x]), L.conc.map(x => ['conc', x]));
const fieldOf = key => RR_FIELDS.find(f => f.key === key) || { label: key, group: '' };
const docName = d => String(d || '').split('|')[0];
const WF_LOWER = { interest: 'interest', principal: 'principal', liquidation: 'post-acceleration' };
function lessonText(kind, x) {
  if (kind === 'values') { const f = fieldOf(x.field); return f.label + ': ' + (x.term ? 'this deal’s name for it is “' + x.term + '”' : x.phrase ? 'the value follows “' + x.phrase + '”' : x.value + ', for ' + docName(x.doc) + ' only'); }
  if (kind === 'clauses') return 'Clauses containing “' + x.phrase + '”: ' + ((RR_CLAUSE_TYPES.find(t => t[0] === x.type) || [])[1] || x.type).replace(/ \(Manual inputs tab\)/, ', on the Manual inputs tab') + (x.k !== 'any' ? ' (' + WF_LOWER[x.k] + ' priority only)' : '') + (x.override ? ', even where the reader has its own reading' : '');
  return 'Concentration limits containing “' + x.phrase + '”: ' + (RR_CONC[x.cat] || [x.cat])[0];
}
const sameLesson = (kind, a, b) => kind === 'values' ? a.field === b.field && (a.term || '').toLowerCase() === (b.term || '').toLowerCase() && rrNorm(a.phrase) === rrNorm(b.phrase) && (a.value ? a.doc === b.doc : !b.value) : rrNorm(a.phrase) === rrNorm(b.phrase) && (kind === 'clauses' ? a.k === b.k : true);
function withLesson(L, kind, x) { const o = { values: L.values.slice(), clauses: L.clauses.slice(), conc: L.conc.slice() }; o[kind] = o[kind].filter(y => !sameLesson(kind, x, y)); o[kind].unshift(x); return o; }
// defined terms printed in the document, for the "name for it" suggestions
function docTerms(pages) {
  const T = pages.join('\n').replace(/[“”]/g, '"'); const set = new Map(); let m;
  const g = /"\s*([A-Z][A-Za-z0-9'’&\/\-., ]{2,70}?)\s*"\s*(?:means|shall mean|has the meaning|will (?:mean|be)|:|\))/g;
  while ((m = g.exec(T)) && set.size < 4000) { const t = m[1].replace(/\s+/g, ' ').replace(/[.,]$/, ''); if (t.split(' ').length <= 9 && !set.has(t.toLowerCase())) set.set(t.toLowerCase(), t); }
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}
function suggestClausePhrase(t) {
  const x = t.replace(/^\s*\(?[A-Z]{1,2}\)\s*/, '');
  const stop = /^(?:Class|Notes?|Payment Date|Priority|Section|Issuer|Co-Issuer|Holders?|Trustee|Interest Proceeds|Principal Proceeds|Subordinated Notes|Secured Notes|Rated Notes|Collateral Principal Amount|Aggregate Outstanding Amount|Collateral Manager|Reinvestment Period)$/;
  const caps = [...x.matchAll(/\b([A-Z][a-z]+(?:[ -](?:of |the |and |to )?[A-Z][a-z]+){1,5})\b/g)].map(m => m[1]).filter(c => !stop.test(c));
  if (caps.length) return caps.sort((a, b) => b.length - a.length)[0];
  return x.replace(/^to\s+(?:the\s+)?(?:payment\s+(?:of|to)\s+)?/i, '').split(/\s+/).slice(0, 8).join(' ').replace(/[,;:.…]+$/, '');
}
function suggestConcPhrase(t) {
  const x = t.replace(/^\(\w+\)\s*/, '').replace(/^[\s\S]*?(?:Collateral Principal Amount|Aggregate Principal Balance|Maximum Amount)\s*(?:may\s+)?(?:consist\s+of|be\s+issued\s+by|be|have|represent)?\s*/i, '');
  return x.split(/\s+/).slice(0, 8).join(' ').replace(/[,;:.…]+$/, '');
}
function teachState() { const I = state.interp; if (!I.teach) I.teach = { open: false, pane: 'value', field: null, clause: null, conc: null, mode: 'term' }; return I.teach; }
// what changed between two readings of the same document
function readDiff(oldR, newR) {
  const key = f => f.group + '|' + f.field; const O = new Map(oldR.found.map(f => [key(f), f])); const N = new Map(newR.found.map(f => [key(f), f])); const out = [];
  const st = h => ({ found: 'found', taught: 'taught', entered: 'entered by you', missing: 'not found', estimated: 'estimated', default: 'standard value' }[h] || h);
  const quiet = f => f.group === 'Waterfall' && / priority$/.test(f.field);
  newR.found.forEach(f => { if (quiet(f)) return; const o = O.get(key(f)); if (!o) out.push(f.field + ': ' + f.value + ' (' + st(f.how) + ')'); else if (o.value !== f.value || o.how !== f.how) out.push(f.field + ': ' + (o.value === f.value ? 'now ' + st(f.how) : o.value + ' → ' + f.value + ' (' + st(f.how) + ')')); });
  oldR.found.forEach(o => { if (!N.has(key(o)) && !RR_DONE.includes(o.how) && o.teach !== 'concItem' && o.teach !== 'clause') out.push(o.field + ': no longer a gap'); });
  return out;
}
function teachTry(kind, x) {
  const I = state.interp; const r = readOnce(withLesson(state.lessons, kind, x));
  return { used: r.used.includes(x.id), changes: readDiff({ found: I.found }, r) };
}
function tryHTML(res, saved) {
  if (!res.used) return '<span class="res fail">Nothing in this document matched.</span> Check the words are exactly as printed, without the clause letter.' + (saved ? ' The lesson is saved and will be tried on later documents.' : '');
  const ch = res.changes; const lead = saved ? '<b>Saved.</b> ' : '';
  if (!ch.length) return lead + 'The lesson works on this document, and the reading is unchanged.';
  return lead + (saved ? 'This document has been read again:' : 'On this document it would change:') + '<ul class="tchanges">' + ch.slice(0, 10).map(c => '<li>' + esc(c) + '</li>').join('') + (ch.length > 10 ? '<li>and ' + (ch.length - 10) + ' more</li>' : '') + '</ul>';
}
// the panel
function teachHTML() {
  const I = state.interp; const S = teachState(); const n = lessonCount(getLessons()); const used = (I.used || []).length;
  let h = '<details class="readlist teach" id="teachBox"' + (S.open ? ' open' : '') + '><summary>Teach the reader <span class="tag" style="margin-left:6px">' + n + ' lesson' + (n === 1 ? '' : 's') + ' saved</span>' + (used ? ' <span class="tag ok">' + used + ' used on this document</span>' : '') + '</summary>';
  h += '<p class="small" style="margin:8px 0 10px;max-width:760px">Where the reader missed something, tell it where to look. Each lesson is saved in this browser and tried first on every document you read after this one, so the reader improves with each indenture. Values you enter for one document stay with that document. Lessons stay in your browser unless you export them.</p>';
  h += '<div class="seg tseg" role="group" aria-label="What to teach">' + [['value', 'A value'], ['clause', 'A waterfall clause'], ['conc', 'A concentration limit'], ['saved', 'Saved lessons (' + n + ')']].map(([k, l]) => '<button type="button" data-tp="' + k + '" aria-pressed="' + (S.pane === k) + '">' + l + '</button>').join('') + '</div>';
  h += '<div class="teachpane" id="teachPane">' + teachPaneHTML() + '</div></details>';
  return h;
}
function teachPaneHTML() {
  const I = state.interp; const S = teachState();
  if (S.pane === 'saved') return savedLessonsHTML();
  if (!(I.spec && I.how === 'rules' && I.items && I.found)) return '<p class="small" style="margin:0">Read a document first, using the box above. The reader then lists everything it found with its page, and puts a <b>Teach</b> link beside anything it missed. Lessons you have already saved are under <b>Saved lessons</b>, where you can also import lessons from a colleague.</p>';
  if (S.pane === 'clause') {
    const C = (I.items && I.items.clauses) || []; if (!C.length) return '<p class="small">No Priority of Payments clauses were read from this document.</p>';
    if (!S.clause || !C.some(c => c.k + '|' + c.id === S.clause)) S.clause = (C.find(c => c.type === 'unsupported') || C[0]).k + '|' + (C.find(c => c.type === 'unsupported') || C[0]).id;
    const c = C.find(x => x.k + '|' + x.id === S.clause);
    if (S.phraseFor !== S.clause) { const cur = c.lesson ? (lessonList(state.lessons).find(e => e[1].id === c.lesson) || [])[1] : null; const known = v => RR_CLAUSE_TYPES.some(t => t[0] === v);
      S.phrase = cur ? cur.phrase : suggestClausePhrase(c.text); S.phraseFor = S.clause; S.anyWf = cur ? cur.k === 'any' : S.anyWf;
      S.ctype = cur ? cur.type : c.type === 'unsupported' ? 'manual' : c.type === 'none' ? (c.manual ? 'manual' : 'none') : c.type === 'expense' && known('expense:' + c.item) ? 'expense:' + c.item : known(c.type) ? c.type : 'manual'; S.over = cur ? cur.override : c.type !== 'unsupported'; }
    let h = '<label class="blk">Clause<select id="tcClause">' + ['interest', 'principal', 'liquidation'].filter(k => C.some(x => x.k === k)).map(k => '<optgroup label="' + { interest: 'Interest priority', principal: 'Principal priority', liquidation: 'Post-acceleration priority' }[k] + '">' + C.filter(x => x.k === k).map(x => '<option value="' + x.k + '|' + x.id + '"' + (x.k + '|' + x.id === S.clause ? ' selected' : '') + '>(' + x.id + ') ' + esc(x.type === 'unsupported' ? 'Not modelled: ' : x.lesson ? 'Taught: ' : '') + esc((x.type === 'unsupported' ? x.text.replace(/^\(\w+\)\s*/, '') : x.label).slice(0, 70)) + '</option>').join('') + '</optgroup>').join('') + '</select></label>';
    h += '<div class="tquote"><div class="small">' + esc(I.unit + ' ' + c.page) + ' · read now as <b>' + esc(c.type === 'unsupported' ? 'not modelled' : c.label) + '</b>' + (c.lesson ? ' (from a lesson)' : '') + '</div>' + esc(c.text.slice(0, 600)) + (c.text.length > 600 ? '…' : '') + '</div>';
    h += '<label class="blk">Treat every clause containing these words<input type="text" id="tcPhrase" value="' + esc(S.phrase || '') + '" autocomplete="off"></label><div class="small" id="tcMatch">' + clauseMatchHTML() + '</div>';
    h += '<label class="blk">as<select id="tcType">' + RR_CLAUSE_TYPES.map(t => '<option value="' + t[0] + '"' + (t[0] === S.ctype ? ' selected' : '') + '>' + esc(t[1]) + '</option>').join('') + '</select></label>';
    h += '<label class="check"><input type="checkbox" id="tcAny"' + (S.anyWf !== false ? ' checked' : '') + '> In any waterfall, not only the ' + WF_LOWER[c.k] + ' priority</label><label class="check"><input type="checkbox" id="tcOver"' + (S.over ? ' checked' : '') + '> Even where the reader has its own reading of the clause</label>';
    return h + teachButtons();
  }
  if (S.pane === 'conc') {
    const K = (I.items && I.items.conc) || []; if (!K.length) return '<p class="small">No concentration limits were read from this document. If the deal has them under another heading, teach the heading on the <b>A value</b> tab (Concentration Limitations section).</p>';
    if (!S.conc || !K.some(c => c.id === S.conc)) S.conc = (K.find(c => !c.label) || K[0]).id;
    const c = K.find(x => x.id === S.conc);
    if (S.kphraseFor !== S.conc) { const cur = c.lesson ? (lessonList(state.lessons).find(e => e[1].id === c.lesson) || [])[1] : null; const byLabel = (Object.entries(RR_CONC).find(e => e[1][0] === c.label) || [])[0];
      S.kphrase = cur ? cur.phrase : suggestConcPhrase(c.text); S.kphraseFor = S.conc; S.kcat = cur ? cur.cat : byLabel || 'skip'; S.kover = cur ? cur.override : !!c.label; }
    let h = '<label class="blk">Concentration limit<select id="tkItem">' + K.map(x => '<option value="' + esc(x.id) + '"' + (x.id === S.conc ? ' selected' : '') + '>' + esc(x.id + ' ' + (x.label ? x.label + (x.lesson ? ' (taught)' : '') : 'Not modelled: ' + x.text.replace(/^\(\w+\)\s*/, '').slice(0, 60))) + '</option>').join('') + '</select></label>';
    h += '<div class="tquote"><div class="small">' + esc(I.unit + ' ' + c.page) + ' · read now as <b>' + esc(c.label || 'not modelled') + '</b></div>' + esc(c.text.slice(0, 600)) + (c.text.length > 600 ? '…' : '') + '</div>';
    h += '<label class="blk">Treat every concentration limit containing these words<input type="text" id="tkPhrase" value="' + esc(S.kphrase || '') + '" autocomplete="off"></label><div class="small" id="tkMatch">' + concMatchHTML() + '</div>';
    h += '<label class="blk">as<select id="tkCat">' + Object.entries(RR_CONC).map(([k, v]) => '<option value="' + k + '"' + (k === S.kcat ? ' selected' : '') + '>' + esc(v[0]) + '</option>').join('') + '</select></label>';
    h += '<label class="check"><input type="checkbox" id="tkOver"' + (S.kover ? ' checked' : '') + '> Even where the reader has its own reading of the limit</label>';
    return h + teachButtons();
  }
  // a value
  if (!S.field) { const g = (I.found || []).find(f => f.teach && !RR_DONE.includes(f.how) && RR_FIELDS.some(x => x.key === f.teach)); S.field = g ? g.teach : 'seniorFee'; }
  const f = fieldOf(S.field); if (f.noValue && S.mode === 'value') S.mode = 'term';
  const now = (I.found || []).filter(x => x.teach === S.field);
  const groups = [...new Set(RR_FIELDS.map(x => x.group))];
  let h = '<label class="blk">Item<select id="tvField">' + groups.map(g => '<optgroup label="' + esc(g) + '">' + RR_FIELDS.filter(x => x.group === g).map(x => { const st = (I.found || []).filter(y => y.teach === x.key); const gap = st.some(y => !RR_DONE.includes(y.how)) || (!st.length && !x.noValue); return '<option value="' + x.key + '"' + (x.key === S.field ? ' selected' : '') + '>' + esc(x.label) + (gap ? ' — not found' : '') + '</option>'; }).join('') + '</optgroup>').join('') + '</select></label>';
  h += '<div class="tquote"><div class="small">Read now</div>' + (now.length ? now.slice(0, 6).map(x => '<div><b>' + esc(x.field) + '</b>: ' + esc(x.value) + ' <span class="res ' + (RR_DONE.includes(x.how) ? 'pass' : x.how === 'missing' ? 'fail' : 'na') + '">' + esc({ found: 'Found', taught: 'Taught', entered: 'Entered by you', missing: 'Not found', estimated: 'Estimated', default: 'Standard value' }[x.how] || x.how) + '</span>' + (x.page ? ' <span class="small">' + esc(I.unit + ' ' + x.page) + '</span>' : '') + '</div>').join('') : '<div>Nothing read for this item.</div>') + '</div>';
  const terms = (I.terms || []).filter(t => !f.kw || f.kw.test(t)).slice(0, 300);
  h += '<fieldset class="tmode"><legend class="sr">How to teach it</legend>';
  h += '<label class="check"><input type="radio" name="tvMode" value="term"' + (S.mode === 'term' ? ' checked' : '') + '> This deal’s name for it</label><input type="text" id="tvTerm" list="tvTerms" placeholder="' + esc('e.g. ' + (f.eg || '')) + '" value="' + esc(S.term || '') + '" autocomplete="off"><datalist id="tvTerms">' + terms.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>';
  h += '<label class="check"><input type="radio" name="tvMode" value="phrase"' + (S.mode === 'phrase' ? ' checked' : '') + '> The words printed just before ' + (f.type === 'table' || f.type === 'section' || f.type === 'label' ? 'it' : 'its value') + '</label><input type="text" id="tvPhrase" placeholder="Copy them from the document" value="' + esc(S.vphrase || '') + '" autocomplete="off">';
  if (!f.noValue) h += '<label class="check"><input type="radio" name="tvMode" value="value"' + (S.mode === 'value' ? ' checked' : '') + '> The value itself, for this document only</label><input type="text" id="tvValue" placeholder="' + esc('e.g. ' + (f.valueEg || { pct: '0.15%', date: '2031-10-15', money: '$45,000,000', num: '2850', years: '8' }[f.type] || '')) + '" value="' + esc(S.value || '') + '" autocomplete="off">';
  h += '</fieldset><p class="small" style="margin:0">' + esc(f.type === 'table' ? 'The reader looks for the trigger levels right after these words: a table of classes and percentages, or "For the Class B Notes, 120%" items.' : f.type === 'section' ? 'The reader looks for the numbered (i), (ii), (iii) list after this heading.' : f.type === 'label' ? 'The column heading over the notes\' spreads or rates in the notes table.' : 'A name is looked up as a defined term ("Term" means …). Words before the value are matched exactly, and the value is read from what follows.') + '</p>';
  return h + teachButtons();
}
const teachButtons = () => '<div class="toolbar" style="margin:4px 0 0"><button class="btn small" type="button" id="tTry">Try on this document</button><button class="btn small primary" type="button" id="tSave">Save lesson</button></div><div class="small tout" id="tOut" aria-live="polite"></div>';
function clauseMatchHTML() {
  const I = state.interp; const S = teachState(); const C = (I.items && I.items.clauses) || []; const c0 = C.find(x => x.k + '|' + x.id === S.clause);
  if (rrNorm(S.phrase).length < 4) return 'Enter at least four letters.';
  const hit = C.filter(x => (S.anyWf !== false || x.k === (c0 && c0.k)) && rrHas(x.text, S.phrase)); if (!hit.length) return '<span class="res fail">No clause in this document contains these words.</span>';
  const change = hit.filter(x => S.over || x.type === 'unsupported'), keep = hit.filter(x => !(S.over || x.type === 'unsupported'));
  return (change.length ? 'Would read: ' + change.map(x => WF_LOWER[x.k] + ' (' + x.id + ')').join(', ') + '. ' : 'Would change no clause here. ') + (keep.length ? 'Also contains the words but keeps its own reading: ' + keep.map(x => WF_LOWER[x.k] + ' (' + x.id + ')').join(', ') + '.' : '');
}
function concMatchHTML() {
  const I = state.interp; const S = teachState(); const K = (I.items && I.items.conc) || [];
  if (rrNorm(S.kphrase).length < 4) return 'Enter at least four letters.';
  const hit = K.filter(x => rrHas(x.text, S.kphrase)); if (!hit.length) return '<span class="res fail">No limit in this document contains these words.</span>';
  const change = hit.filter(x => S.kover || !x.label), keep = hit.filter(x => !(S.kover || !x.label));
  return (change.length ? 'Would read: ' + change.map(x => x.id).join(', ') + '. ' : 'Would change no limit here. ') + (keep.length ? 'Keeps its own reading: ' + keep.map(x => x.id).join(', ') + '.' : '');
}
function savedLessonsHTML() {
  const I = state.interp; const all = lessonList(state.lessons); const used = new Set(I.used || []);
  let h = all.length ? '<div class="scroll"><table class="tlessons"><thead><tr><th>Lesson</th><th>Taught on</th><th>This document</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' + all.map(([k, x]) => '<tr><td>' + esc(lessonText(k, x)) + '</td><td class="small">' + esc((x.from || '—') + (x.added ? ', ' + x.added : '')) + '</td><td>' + (used.has(x.id) ? '<span class="res pass">Used</span>' : '<span class="small">—</span>') + '</td><td><button class="ib" type="button" data-rm="' + k + '|' + esc(x.id) + '" aria-label="Remove this lesson" title="Remove">✕</button></td></tr>').join('') + '</tbody></table></div>' : '<p class="small">No lessons yet. Teach one from the other tabs, or from a <b>Teach</b> link in the list above.</p>';
  h += '<div class="toolbar" style="margin-top:8px">' + (all.length ? '<button class="btn small" type="button" id="tExport">' + (state.caps.downloads ? 'Download lessons (JSON)' : 'Copy lessons as JSON') + '</button>' : '') + '<label class="btn small" for="tImport">Import lessons</label><input type="file" id="tImport" accept=".json,application/json" hidden></div><p class="small" style="margin:4px 0 0">To share what the reader has learned, export the lessons and have colleagues import them; imported lessons are added to theirs. Values entered for one document travel with them too, and apply only to that document.</p><textarea id="tJson" rows="5" hidden readonly style="font:12px/1.4 var(--mono);margin-top:6px"></textarea>';
  return h;
}
function draftLesson() {
  const I = state.interp; const S = teachState(); const id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); const meta = { id, from: I.fileName, added: new Date().toISOString().slice(0, 10) };
  if (S.pane === 'clause') { const c = (I.items.clauses || []).find(x => x.k + '|' + x.id === S.clause); if (rrNorm(S.phrase).length < 4) return { err: 'Enter at least four letters of the clause’s words.' }; return { kind: 'clauses', x: Object.assign({ phrase: S.phrase.trim(), type: S.ctype, k: S.anyWf !== false ? 'any' : c.k, override: !!S.over }, meta) }; }
  if (S.pane === 'conc') { if (rrNorm(S.kphrase).length < 4) return { err: 'Enter at least four letters of the limit’s words.' }; return { kind: 'conc', x: Object.assign({ phrase: S.kphrase.trim(), cat: S.kcat, override: !!S.kover }, meta) }; }
  const f = fieldOf(S.field);
  if (S.mode === 'term') { const t = (S.term || '').replace(/^["“”\s]+|["“”\s]+$/g, ''); if (t.replace(/\W/g, '').length < 3) return { err: 'Enter the name the deal uses, as printed.' }; return { kind: 'values', x: Object.assign({ field: S.field, term: t }, meta) }; }
  if (S.mode === 'phrase') { const t = (S.vphrase || '').trim(); if (rrNorm(t).length < 4) return { err: 'Enter the words printed just before the value.' }; return { kind: 'values', x: Object.assign({ field: S.field, phrase: t }, meta) }; }
  const p = rrParseValue(S.field, S.value); if (!p.ok) return { err: p.err + '.' };
  return { kind: 'values', x: Object.assign({ field: S.field, value: (S.value || '').trim(), doc: I.docKey }, meta), note: f.label };
}
function teachMsg(html) { const o = $('#tOut'); if (o) o.innerHTML = html; }
function renderTeachPane(focusSel) { const P = $('#teachPane'); if (!P) return; P.innerHTML = teachPaneHTML(); $$('.tseg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tp === teachState().pane))); bindTeachPane(); if (focusSel) { const el = $(focusSel); if (el) el.focus(); } }
function rereadWithLessons() { const I = state.interp; const S = teachState(); S.open = true; if (I.pages) readRules(); rerenderInterp(); const tb = $('#teachBox'); if (tb) tb.scrollIntoView({ block: 'nearest' }); return I; }
function bindTeach() {
  const B = $('#teachBox'); if (!B) return; const S = teachState();
  B.addEventListener('toggle', () => { S.open = B.open; });
  $$('.tseg button', B).forEach(b => b.onclick = () => { S.pane = b.dataset.tp; renderTeachPane(); });
  bindTeachPane();
}
function bindTeachPane() {
  const P = $('#teachPane'); if (!P) return; const S = teachState(); const I = state.interp;
  const on = (sel, ev, fn) => { const el = $(sel, P); if (el) el.addEventListener(ev, fn); };
  on('#tvField', 'change', e => { S.field = e.target.value; S.term = ''; S.vphrase = ''; S.value = ''; renderTeachPane('#tvField'); });
  on('#tvTerm', 'input', e => { S.term = e.target.value; }); on('#tvPhrase', 'input', e => { S.vphrase = e.target.value; }); on('#tvValue', 'input', e => { S.value = e.target.value; });
  [['#tvTerm', 'term'], ['#tvPhrase', 'phrase'], ['#tvValue', 'value']].forEach(([sel, m]) => on(sel, 'focus', () => { S.mode = m; const r = $('input[name=tvMode][value=' + m + ']', P); if (r) r.checked = true; }));
  $$('input[name=tvMode]', P).forEach(r => r.onchange = () => { S.mode = r.value; const el = $({ term: '#tvTerm', phrase: '#tvPhrase', value: '#tvValue' }[r.value], P); if (el) el.focus(); });
  on('#tcClause', 'change', e => { S.clause = e.target.value; renderTeachPane('#tcClause'); });
  on('#tcPhrase', 'input', e => { S.phrase = e.target.value; $('#tcMatch', P).innerHTML = clauseMatchHTML(); });
  on('#tcType', 'change', e => { S.ctype = e.target.value; });
  on('#tcAny', 'change', e => { S.anyWf = e.target.checked; $('#tcMatch', P).innerHTML = clauseMatchHTML(); });
  on('#tcOver', 'change', e => { S.over = e.target.checked; $('#tcMatch', P).innerHTML = clauseMatchHTML(); });
  on('#tkItem', 'change', e => { S.conc = e.target.value; renderTeachPane('#tkItem'); });
  on('#tkPhrase', 'input', e => { S.kphrase = e.target.value; $('#tkMatch', P).innerHTML = concMatchHTML(); });
  on('#tkCat', 'change', e => { S.kcat = e.target.value; });
  on('#tkOver', 'change', e => { S.kover = e.target.checked; $('#tkMatch', P).innerHTML = concMatchHTML(); });
  on('#tTry', 'click', () => { const d = draftLesson(); if (d.err) { teachMsg('<span class="res fail">' + esc(d.err) + '</span>'); return; } try { teachMsg(tryHTML(teachTry(d.kind, d.x), false)); } catch (e) { teachMsg('<span class="res fail">The reader could not use this lesson (' + esc(e.message) + ').</span>'); } });
  on('#tSave', 'click', () => {
    const d = draftLesson(); if (d.err) { teachMsg('<span class="res fail">' + esc(d.err) + '</span>'); return; }
    let res; try { res = teachTry(d.kind, d.x); } catch (e) { teachMsg('<span class="res fail">The reader could not use this lesson (' + esc(e.message) + ').</span>'); return; }
    state.lessons = rrLessons(withLesson(state.lessons, d.kind, d.x)); saveLessons();
    if (S.pane === 'value') { S.term = ''; S.vphrase = ''; S.value = ''; } S.phraseFor = null; S.kphraseFor = null;
    rereadWithLessons(); teachMsg(tryHTML(res, true)); toast(d.x.value ? 'Saved for this document' : 'Lesson saved: the reader will try it first on every document');
  });
  $$('[data-rm]', P).forEach(b => b.onclick = () => { const [k, id] = b.dataset.rm.split('|'); state.lessons[k] = state.lessons[k].filter(x => x.id !== id); saveLessons(); rereadWithLessons(); toast('Lesson removed'); });
  on('#tExport', 'click', async () => {
    const json = JSON.stringify(Object.assign({ format: 'clo-reader-lessons', version: 1, exported: new Date().toISOString().slice(0, 10) }, state.lessons), null, 1);
    if (state.caps.downloads) { saveFile('clo-reader-lessons.json', json); return; }
    try { await navigator.clipboard.writeText(json); toast('Lessons copied as JSON'); } catch (e) { const t = $('#tJson', P); t.hidden = false; t.value = json; t.select(); toast('Copy the JSON below'); }
  });
  on('#tImport', 'change', async e => {
    const f = e.target.files[0]; if (!f) return; let o;
    try { o = JSON.parse(await f.text()); } catch (err) { toast('That file is not a lessons file (not valid JSON).'); return; }
    const inc = rrLessons(o); let added = 0; let L = state.lessons;
    lessonList(inc).forEach(([k, x]) => { if (!L[k].some(y => sameLesson(k, x, y))) { L = withLesson(L, k, x); added++; } });
    state.lessons = rrLessons(L); saveLessons(); S.pane = 'saved'; rereadWithLessons(); toast(added ? 'Imported ' + added + ' lesson' + (added > 1 ? 's' : '') : 'No new lessons in that file');
  });
}
function openTeach(o) {
  const S = teachState(); Object.assign(S, { open: true }, o); if (o.field) { S.term = ''; S.vphrase = ''; S.value = ''; S.mode = 'term'; }
  rerenderInterp(); const B = $('#teachBox'); if (B) { B.scrollIntoView({ behavior: 'smooth', block: 'start' }); const el = $(S.pane === 'clause' ? '#tcPhrase' : S.pane === 'conc' ? '#tkPhrase' : '#tvTerm', B); if (el) el.focus({ preventScroll: true }); }
}
