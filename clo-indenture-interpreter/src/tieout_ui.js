// ---------- trustee tie-out: the trustee report's figures beside the model's, with the difference for each
// Figures are kept per deal and Payment Date in this browser. Nothing here changes the model; it only measures it.
const TIE_KEY = 'clo-interpreter-tieout-v1';
function loadTie() { try { const raw = localStorage.getItem(TIE_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function saveTie() { try { localStorage.setItem(TIE_KEY, JSON.stringify(state.tie)); } catch (e) { /* storage unavailable: figures last for this visit */ } }
const TIE_TOL = { amount: 1, ratio: 0.01, number: 0.5 };
function tieBook() {
  if (!state.tie) state.tie = loadTie();
  const d = state.tie[state.dealId] = state.tie[state.dealId] || {}; const k = state.inputs.paymentDate;
  const b = d[k] = d[k] || { values: {}, tol: Object.assign({}, TIE_TOL) }; b.values = b.values || {}; b.tol = Object.assign({}, TIE_TOL, b.tol || {}); return b;
}
// every figure a trustee report normally prints for a Payment Date, with the model's value
function tieItems(r) {
  const s = deal(); const out = []; const add = (group, key, label, model, kind, extra) => { if (model == null || !isFinite(model)) return; out.push(Object.assign({ group, key, label, model, kind }, extra || {})); };
  const G1 = 'Collections and collateral';
  add(G1, 'ip', 'Interest Proceeds', r.interestProceeds, 'amount', { src: 'interest' });
  add(G1, 'pp', 'Principal Proceeds', r.principalProceeds, 'amount', { src: 'principal' });
  add(G1, 'apb', 'Aggregate Principal Balance of the collateral', r.pb.parTotal, 'amount');
  add(G1, 'pcv', 'Principal Collateral Value (OC numerator)', r.pb.pcvOC, 'amount');
  add(G1, 'ccc', 'CCC Excess', r.pb.cccExcess, 'amount');
  const G2 = 'Coverage tests, before payments (%)';
  r.preTests.forEach(t => { add(G2, 'oc.' + t.id, t.label + ' OC ratio', t.oc && t.oc.ratio, 'ratio'); if (t.ic && t.ic.ratio != null && t.ic.applies !== false) add(G2, 'ic.' + t.id, t.label + ' IC ratio', t.ic.ratio, 'ratio'); });
  if (s.coverage.reinvestmentTest && r.preIRT) add(G2, 'irt', (s.coverage.reinvestmentTest.label || 'Interest Reinvestment Test') + ' ratio', r.preIRT.ratio, 'ratio');
  if (s.coverage.eodTest && r.preEoD) add(G2, 'eod', (s.coverage.eodTest.label || 'Event of Default') + ' ratio', r.preEoD.ratio, 'ratio');
  const G3 = 'Collateral quality tests';
  (r.quality || []).forEach(q => { if (typeof q.value === 'number') add(G3, 'q.' + q.id, q.label, q.value, /pct/.test(q.fmt || '') ? 'ratio' : 'number'); });
  const W = { interest: 'Interest waterfall, paid', principal: 'Principal waterfall, paid', liquidation: 'Post-acceleration waterfall, paid' };
  Object.keys(W).forEach(k => (r.waterfalls[k] || []).forEach((row, i) => { if (row.skipped && !(row.paid > 0)) return; add(W[k], 'wf.' + k + '.' + row.id, '(' + row.id + ') ' + (row.label || row.type), row.paid, 'amount', { calc: { k, i } }); }));
  const G5 = 'Notes';
  s.classes.forEach(c => { const n = r.notes[c.id]; if (!n) return;
    add(G5, 'n.' + c.id + '.int', 'Class ' + c.id + ' interest paid', (n.intPaid || 0) + (n.defPaid || 0), 'amount');
    add(G5, 'n.' + c.id + '.prin', 'Class ' + c.id + ' principal paid', n.prinPaid || 0, 'amount');
    add(G5, 'n.' + c.id + '.bal', 'Class ' + c.id + ' balance after payments', n.balEnd, 'amount');
    if (c.deferrable) add(G5, 'n.' + c.id + '.def', 'Class ' + c.id + ' deferred interest after payments', n.defEnd || 0, 'amount'); });
  add(G5, 'eq', s.equity.name + ' distribution', r.ctx.subPaidToday, 'amount');
  return out;
}
const tieNum = v => { if (v == null) return null; const t = String(v).trim().replace(/[$,\s%]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^−/, '-'); if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return t === '' ? null : NaN; return +t; };
const tieFmt = (x, kind) => x == null || !isFinite(x) ? '' : kind === 'amount' ? cents(x) : kind === 'ratio' ? x.toFixed(3) : (Math.round(x * 100) / 100).toLocaleString('en-US');
function tieRes(it, b) {
  const v = b.values[it.key]; if (v == null || v === '') return { st: 'none' };
  const n = tieNum(v); if (!isFinite(n)) return { st: 'bad' };
  const d = it.model - n; const tol = b.tol[it.kind]; return { st: Math.abs(d) <= tol + 1e-9 ? 'ok' : 'off', d };
}
function tieSummary(items, b) {
  const res = items.map(it => Object.assign({ it }, tieRes(it, b))); const ent = res.filter(x => x.st === 'ok' || x.st === 'off'); const off = res.filter(x => x.st === 'off');
  if (!ent.length) return { n: 0, off: 0, html: 'No trustee figures entered for this Payment Date yet. Type them into the right-hand column, or import a CSV made from the template.' };
  const rank = { amount: 2, ratio: 1, number: 0 }; const worst = off.slice().sort((a, b2) => (rank[b2.it.kind] - rank[a.it.kind]) || (Math.abs(b2.d) - Math.abs(a.d)))[0];
  return { n: ent.length, off: off.length, html: '<b>' + (ent.length - off.length) + ' of ' + ent.length + '</b> entered figure' + (ent.length === 1 ? '' : 's') + ' tie' + (ent.length - off.length === 1 && ent.length === 1 ? 's' : '') + ' within tolerance' + (off.length ? '; <b>' + off.length + '</b> differ' + (off.length === 1 ? 's' : '') + '. Largest: ' + esc(worst.it.label) + ', model ' + (worst.d > 0 ? 'higher' : 'lower') + ' by ' + esc(tieFmt(Math.abs(worst.d), worst.it.kind)) + (worst.it.kind === 'ratio' ? ' points' : '') + '.' : '.') + (items.length > ent.length ? ' ' + (items.length - ent.length) + ' not entered.' : '') };
}
function tieCells(it, b) {
  const r = tieRes(it, b);
  const tiny = r.d != null && Math.abs(r.d) < (it.kind === 'ratio' ? 0.0005 : 0.005);
  const diff = r.st === 'ok' || r.st === 'off' ? (tiny ? '' : r.d > 0 ? '+' : '−') + tieFmt(tiny ? 0 : Math.abs(r.d), it.kind) : '';
  const res = r.st === 'ok' ? '<span class="res pass">Ties</span>' : r.st === 'off' ? '<span class="res fail">Differs</span>' : r.st === 'bad' ? '<span class="res fail">Not a number</span>' : '<span class="small">—</span>';
  return [diff, res];
}
function renderTieout() {
  const P = $('#p-tieout'); if (!P) return; const r = state.result; if (!r) { P.innerHTML = ''; return; }
  const b = tieBook(); const items = tieItems(r); const sm = tieSummary(items, b);
  let h = '<div class="sec"><h2>Trustee tie-out</h2><p class="lead">Enter figures from the trustee\'s report for the ' + esc(longDate(r.paymentDate)) + ' Payment Date beside the model\'s own. A figure ties when it is within the tolerance. Tie out at least one real Payment Date before relying on the model for a deal. Figures are kept in this browser, per deal and Payment Date; the inputs on the left should match that report\'s period.</p>';
  h += '<div class="toolbar tietools"><button class="btn small" type="button" id="tieTpl">' + (state.caps.downloads ? 'Download template (CSV)' : 'Copy template (CSV)') + '</button><label class="btn small" for="tieFile">Import trustee figures (CSV)</label><input type="file" id="tieFile" accept=".csv,text/csv" hidden>' + (state.dealId === 'example' && state.inputs.paymentDate === SAMPLE_TIEOUT.date ? '<button class="btn small" type="button" id="tieSample">Try the sample trustee figures</button>' : '') + (sm.n ? '<button class="btn small" type="button" id="tieOut">' + (state.caps.downloads ? 'Download the tie-out (CSV)' : 'Copy the tie-out (CSV)') + '</button><button class="btn small" type="button" id="tieClear">Clear this date</button>' : '') + '</div>';
  h += '<div class="fieldgrid tietol"><label class="field"><span>Tolerance, amounts ($)</span><input type="text" inputmode="decimal" data-tol="amount" value="' + b.tol.amount + '"></label><label class="field"><span>Tolerance, ratios (% points)</span><input type="text" inputmode="decimal" data-tol="ratio" value="' + b.tol.ratio + '"></label><label class="field"><span>Tolerance, other figures</span><input type="text" inputmode="decimal" data-tol="number" value="' + b.tol.number + '"></label></div>';
  h += '<p class="notice' + (sm.off ? ' warn' : '') + '" id="tieSum" aria-live="polite">' + sm.html + '</p>';
  h += '<div class="scroll"><table class="tie"><thead><tr><th>Item</th><th class="num">Model</th><th class="num">Trustee report</th><th class="num">Difference</th><th>Result</th></tr></thead><tbody>';
  let g = null;
  items.forEach(it => {
    if (it.group !== g) { g = it.group; h += '<tr class="grp"><td colspan="5"><b>' + esc(g) + '</b></td></tr>'; }
    const [diff, res] = tieCells(it, b);
    const model = it.calc ? '<button type="button" class="calc" data-k="' + it.calc.k + '" data-i="' + it.calc.i + '" data-part="paid" aria-label="Model ' + esc(it.label) + ' ' + esc(tieFmt(it.model, it.kind)) + ': show the working">' + tieFmt(it.model, it.kind) + '</button>' : it.src ? '<button type="button" class="calc" data-src="' + it.src + '" aria-label="Model ' + esc(it.label) + ': show the working">' + tieFmt(it.model, it.kind) + '</button>' : tieFmt(it.model, it.kind);
    h += '<tr data-row="' + esc(it.key) + '"><td>' + esc(it.label) + '</td><td class="num">' + model + '</td><td class="num"><input type="text" inputmode="decimal" class="tiein" data-key="' + esc(it.key) + '" aria-label="Trustee figure for ' + esc(it.label) + '" value="' + esc(b.values[it.key] == null ? '' : b.values[it.key]) + '"></td><td class="num tdiff">' + diff + '</td><td class="tres">' + res + '</td></tr>';
  });
  h += '</tbody></table></div><p class="small" style="margin-top:6px">Ratios are compared in percentage points. Waterfall figures are the amounts paid at each step; select a model figure to see its working. Import a CSV with columns <code>key</code> (or <code>item</code>) and <code>trustee</code>; the template lists every key.</p></div>';
  P.innerHTML = h; bindTieout(P, items);
}
function bindTieout(P, items) {
  const b = tieBook();
  const refresh = () => { const sm = tieSummary(items, b); const el = $('#tieSum', P); el.innerHTML = sm.html; el.className = 'notice' + (sm.off ? ' warn' : ''); renderTabs(); };
  $$('input.tiein', P).forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.key; const v = inp.value.trim(); if (v === '') delete b.values[k]; else b.values[k] = v; saveTie();
    const it = items.find(x => x.key === k); const tr = inp.closest('tr'); const [diff, res] = tieCells(it, b); $('.tdiff', tr).textContent = diff; $('.tres', tr).innerHTML = res; refresh();
  }));
  $$('input[data-tol]', P).forEach(inp => inp.addEventListener('change', () => { const n = tieNum(inp.value); if (isFinite(n) && n >= 0) { b.tol[inp.dataset.tol] = n; saveTie(); renderTieout(); renderTabs(); } else { inp.value = b.tol[inp.dataset.tol]; toast('Enter a tolerance of zero or more.'); } }));
  $$('button.calc', P).forEach(x => x.onclick = () => x.dataset.src ? openCalc({ src: x.dataset.src }) : openCalc({ k: x.dataset.k, i: +x.dataset.i, part: 'paid' }));
  const csvRows = withRes => items.map(it => { const o = { key: it.key, item: it.label, group: it.group, model: tieFmt(it.model, it.kind).replace(/,/g, '').replace('−', '-'), trustee: b.values[it.key] == null ? '' : b.values[it.key] }; if (withRes) { const rr = tieRes(it, b); o.difference = rr.d == null ? '' : (Math.round(rr.d * 1e6) / 1e6); o.result = { ok: 'ties', off: 'differs', bad: 'not a number', none: '' }[rr.st]; } return o; });
  const give = async (name, txt) => { if (state.caps.downloads) { saveFile(name, txt); return; } try { await navigator.clipboard.writeText(txt); toast('Copied as CSV'); } catch (e) { toast('Could not copy here; use the download in a browser.'); } };
  const tpl = $('#tieTpl', P); if (tpl) tpl.onclick = () => give('tieout-template-' + state.inputs.paymentDate + '.csv', toCSV(csvRows(false), ['key', 'item', 'group', 'model', 'trustee']));
  const out = $('#tieOut', P); if (out) out.onclick = () => give('tieout-' + state.inputs.paymentDate + '.csv', toCSV(csvRows(true), ['key', 'item', 'group', 'model', 'trustee', 'difference', 'result']));
  const clr = $('#tieClear', P); if (clr) clr.onclick = () => { b.values = {}; saveTie(); renderTieout(); renderTabs(); toast('Cleared the trustee figures for this date'); };
  const importCSV = text => {
    const rows = parseCSV(text); if (rows.length < 2) { toast('That file has no rows.'); return; }
    const head = rows[0].map(x => x.trim().toLowerCase()); const ki = head.indexOf('key'), li = head.indexOf('item'), ti = ['trustee', 'trustee report', 'trustee_value', 'value', 'reported'].map(x => head.indexOf(x)).find(i => i >= 0);
    if (ti == null || (ki < 0 && li < 0)) { toast('The CSV needs a "trustee" column and a "key" or "item" column.'); return; }
    let n = 0, miss = 0; rows.slice(1).forEach(rw => { const v = (rw[ti] || '').trim(); if (!v) return; const it = items.find(x => (ki >= 0 && x.key === (rw[ki] || '').trim()) || (li >= 0 && x.label.toLowerCase() === (rw[li] || '').trim().toLowerCase())); if (it) { b.values[it.key] = v; n++; } else miss++; });
    saveTie(); renderTieout(); renderTabs(); toast('Imported ' + n + ' figure' + (n === 1 ? '' : 's') + (miss ? '; ' + miss + ' row' + (miss === 1 ? '' : 's') + ' matched no item' : ''));
  };
  const f = $('#tieFile', P); if (f) f.onchange = async e => { const file = e.target.files[0]; if (file) importCSV(await file.text()); };
  const smp = $('#tieSample', P); if (smp) smp.onclick = () => importCSV(SAMPLE_TIEOUT.csv);
}
function tieOffCount() { try { const r = state.result; if (!r) return 0; const b = tieBook(); return tieItems(r).filter(it => tieRes(it, b).st === 'off').length; } catch (e) { return 0; } }
