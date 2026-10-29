// ---------- manual inputs: every amount the user supplies, tagged to a waterfall step
const manRows = () => (state.manualByDeal[state.dealId] = state.manualByDeal[state.dealId] || []);
const manId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const WF_SHORT = { interest: 'Interest', principal: 'Principal', liquidation: 'Liquidation' };
const stepItems = st => (st.type === 'expense' || st.type === 'fees') ? (st.type === 'fees' ? st.items || [] : st.items || [st.item]) : [];
const isCapStep = st => !!st && stepItems(st).includes('admin');
const canProRata = st => !!st && ['expense', 'fees', 'interest', 'interestAndPrincipal'].includes(st.type) && !isCapStep(st);
function stepWithItem(key, wf) {
  const L = deal().waterfalls[wf || 'interest'] || [];
  if (key === 'hedgeTermSenior') return L.find(st => st.withSeniorTermination) || L.find(st => stepItems(st).includes(key));
  return L.find(st => stepItems(st).includes(key));
}
const MAN_PRESETS = [
  ['Trustee fees and expenses', 'admin'], ['Collateral administrator fee', 'admin'], ['Rating agency surveillance fees', 'admin'], ['Legal fees', 'admin'],
  ['Accountant and audit fees', 'admin'], ['Administrator and registered office fees', 'admin'], ['Listing and filing fees', 'admin'],
  ['Hedge counterparty payment', 'hedge'], ['Tax payment', 'taxes'], ['Other amount', null]];
function manualDefaultsFor(key) {
  const st = key ? stepWithItem(key) : null; const L = deal().waterfalls.interest || [];
  const tgt = st || L[0] || { id: '' };
  return { wf: 'interest', step: tgt.id, rank: isCapStep(tgt) ? 'cap' : 'after' };
}
// the standard amounts the indenture names: kept as inputs, shown here so every manual amount is in one place
function standardRows() {
  const s = deal(); const out = [];
  const add = (key, field, name, how) => { const st = stepWithItem(key); if (st) out.push({ key, field, name, st, how }); };
  add('taxes', 'taxes', 'Taxes and governmental fees', 'Named in the clause');
  add('admin', 'adminDue', 'Administrative Expenses', 'Against the cap, first in order');
  add('hedge', 'hedgePayment', 'Hedge Payment Amount', 'Named in the clause');
  add('hedgeTermSenior', 'hedgeTermSenior', 'Senior hedge termination payments', 'Pro rata, named in the clause');
  add('hedgeTermSub', 'hedgeTermSub', 'Subordinated hedge termination payments', 'Named in the clause');
  return out;
}
function standardPaid(key) {
  const r = state.result; if (!r || !r.waterfalls) return null; const s = deal(); const lb = k => (s.labels && s.labels[k]) || k;
  const names = key === 'admin' ? [lb('admin'), lb('adminExcess'), 'Administrative Expenses entered', 'Administrative Expenses entered (above the cap)'] : key === 'hedgeTermSenior' ? ['Senior hedge termination', lb('hedgeTermSenior')] : [lb(key)];
  return sum(Object.values(r.waterfalls), rows => sum(rows, x => sum(x.payees.filter(p => !p.manual && names.includes(p.to)), p => p.amount)));
}
function stepOptions(wf, cur) {
  const W = deal().waterfalls; const here = (W[wf] || []).some(st => st.id === cur);
  return (!here ? '<option value="' + esc(wf + '|' + (cur || '')) + '" selected>' + (cur ? esc(WF_SHORT[wf] + ' ' + cur) + ' (not in this deal)' : 'Choose a step') + '</option>' : '') +
    ['interest', 'principal', 'liquidation'].filter(k => (W[k] || []).length).map(k => '<optgroup label="' + WF_SHORT[k] + ' waterfall">' + W[k].map(st => '<option value="' + esc(k + '|' + st.id) + '"' + (k === wf && st.id === cur ? ' selected' : '') + '>' + esc(WF_SHORT[k] + ' ' + st.id + ' · ' + st.label) + '</option>').join('') + '</optgroup>').join('');
}
function rankOptions(st, cur) {
  if (isCapStep(st)) return '<option value="cap" selected>Against the cap, in list order</option>';
  const opts = [['before', 'Before the clause']].concat(canProRata(st) ? [['prorata', 'Pro rata with the clause']] : [], [['after', 'After the clause']]);
  const v = opts.some(o => o[0] === cur) ? cur : 'after';
  return opts.map(o => '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>').join('');
}
function renderManual() {
  const P = $('#p-manual'); if (!P) return;
  const ae = document.activeElement; const fk = ae && ae.dataset ? ae.dataset.fk : null; const selS = ae && 'selectionStart' in ae ? ae.selectionStart : null;
  const s = deal(); const r = state.result; const rows = manRows(); const I = state.inputs;
  const res = r && r.manual ? r.manual : []; const stat = i => res[i] || null;
  let h = '<div class="sec"><h2>Manual inputs</h2><p class="lead">Amounts that come from the trustee report, the administrator or the manager for this Payment Date. Each row is paid at the waterfall step you tag it to. A row tagged to the capped Administrative Expenses step counts against the cap, in the order listed; anything above the cap is paid at the uncapped expenses step.</p>';
  h += '<div class="toolbar"><button class="btn small" type="button" id="manAdd">Add a row</button><select id="manPreset" aria-label="Add a common item"><option value="">Add a common item…</option>' + MAN_PRESETS.map((x, i) => '<option value="' + i + '">' + esc(x[0]) + '</option>').join('') + '</select><button class="btn small" type="button" id="manPasteT">Paste from a spreadsheet</button>' +
    (rows.length ? '<button class="btn small" type="button" id="manCsv">' + (state.caps.downloads ? 'Download as CSV' : 'Copy as CSV') + '</button><button class="btn small" type="button" id="manZero">Set amounts to zero</button>' : '') + '</div>';
  h += '<div id="manPaste" hidden class="box" style="margin:0 0 12px"><p class="small" style="margin:0 0 6px">One row per line: description, amount, waterfall, step, position. Copy straight from a spreadsheet, or separate the values with commas. Waterfall is interest, principal or liquidation; position is before, pro rata or after (optional; ignored at the capped step). Example: <code>Trustee fee, 12500, interest, B</code></p><textarea id="manPasteText" rows="5" spellcheck="false"></textarea><div class="toolbar" style="margin-top:6px"><button class="btn small primary" type="button" id="manPasteGo">Add these rows</button><span class="src" id="manPasteMsg"></span></div></div>';
  h += '<div class="scroll"><table class="manual"><thead><tr><th>#</th><th>Description</th><th class="num">Amount</th><th>Waterfall step</th><th>Within the step</th><th class="num">Paid</th><th><span class="sr">Actions</span></th></tr></thead>';
  h += '<tbody class="std">' + standardRows().map(x => {
    const v = I[x.field] || 0; const pd = standardPaid(x.key);
    return '<tr><td class="small">—</td><td>' + esc(x.name) + '</td><td class="num"><input type="text" inputmode="decimal" class="amt" data-key="' + x.field + '" data-kind="amt" data-fk="k-' + x.field + '" aria-label="' + esc(x.name) + '" value="' + esc(v ? fmtAmt(v) : '0') + '"></td><td>' + esc('Interest ' + x.st.id + ' · ' + x.st.label) + '</td><td class="small">' + esc(x.how) + '</td><td class="num">' + (v > 0.005 && pd != null ? usd(pd) + '<div class="st">' + (pd >= v - 0.5 ? 'Paid in full' : pd > 0.5 ? 'Part paid' : 'Not paid') + '</div>' : '') + '</td><td></td></tr>';
  }).join('') + '</tbody><tbody id="manBody">';
  if (!rows.length) h += '<tr><td colspan="7" class="small" style="padding:14px 10px">No other manual amounts yet. Add a row, pick a common item, or paste rows from a spreadsheet.</td></tr>';
  rows.forEach((m, i) => {
    const st = (s.waterfalls[m.wf] || []).find(x => x.id === m.step); const z = stat(i);
    const cls = z && /^Not paid|^Part paid/.test(z.status) && +m.amount > 0 ? ' class="warnrow"' : '';
    h += '<tr' + cls + '><td class="small">' + (i + 1) + '</td>' +
      '<td><input type="text" data-mi="' + i + '" data-f="name" data-fk="m-' + m.id + '-name" aria-label="Row ' + (i + 1) + ' description" value="' + esc(m.name || '') + '" placeholder="Description" list="manNames"></td>' +
      '<td class="num"><input type="text" inputmode="decimal" class="amt" data-mi="' + i + '" data-f="amount" data-fk="m-' + m.id + '-amount" aria-label="Row ' + (i + 1) + ' amount" value="' + esc(m.amount ? fmtAmt(m.amount) : '') + '" placeholder="0"></td>' +
      '<td><select class="stepsel" data-mi="' + i + '" data-f="step" data-fk="m-' + m.id + '-step" aria-label="Row ' + (i + 1) + ' step">' + stepOptions(m.wf, m.step) + '</select></td>' +
      '<td><select data-mi="' + i + '" data-f="rank" data-fk="m-' + m.id + '-rank" aria-label="Row ' + (i + 1) + ' position within the step"' + (isCapStep(st) ? ' disabled' : '') + '>' + rankOptions(st, m.rank) + '</select></td>' +
      '<td class="num">' + (z && +m.amount > 0 ? usd(z.paid) + '<div class="st">' + esc(z.status) + '</div>' : '') + '</td>' +
      '<td class="acts"><button type="button" class="ib" data-up="' + i + '" aria-label="Move row ' + (i + 1) + ' up"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="ib" data-down="' + i + '" aria-label="Move row ' + (i + 1) + ' down"' + (i < rows.length - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="ib" data-del="' + i + '" aria-label="Delete row ' + (i + 1) + '">×</button></td></tr>';
  });
  const tot = sum(rows, m => +m.amount || 0) + sum(standardRows(), x => +I[x.field] || 0);
  const totPaid = sum(res, m => m.paid || 0) + sum(standardRows(), x => standardPaid(x.key) || 0);
  h += '</tbody><tfoot><tr><td></td><td><b>Total</b></td><td class="num"><b>' + usd(tot) + '</b></td><td colspan="2"></td><td class="num"><b>' + usd(totPaid) + '</b></td><td></td></tr></tfoot></table></div>';
  h += '<datalist id="manNames">' + MAN_PRESETS.slice(0, -1).map(x => '<option value="' + esc(x[0]) + '">').join('') + '</datalist>';
  h += '<p class="small" style="margin-top:8px">Rows are kept in this browser for ' + esc(s.meta.name) + ' and carry over when you change the Payment Date or roll forward. ' + (I.mode === 'liquidation' ? 'The Liquidation waterfall is running, so only rows tagged to it, or to the capped expenses step, are paid.' : 'Rows tagged to the Liquidation waterfall are paid only when it runs.') + '</p></div>';
  // by step
  if (r && r.waterfalls) {
    const touched = []; Object.entries(r.waterfalls).forEach(([k, L]) => L.forEach((x, i) => { if (x.manual || x.payees.some(p => p.manual)) touched.push([k, i, x]); }));
    if (touched.length) {
      h += '<div class="sec"><h2>Where they were paid</h2><p class="lead">Each step with manual amounts on this Payment Date. Select a figure to see the working.</p><div class="scroll"><table><thead><tr><th>Waterfall</th><th>Step</th><th class="num">Manual amounts</th><th class="num">Manual paid</th><th class="num">Step due</th><th class="num">Step paid</th><th class="num">Shortfall</th></tr></thead><tbody>' +
        touched.map(([k, i, x]) => { const md = sum(x.manual || [], m => m.due); const mp = sum(x.payees.filter(p => p.manual), p => p.amount); const lk = (v, part) => '<button type="button" class="calc" data-k="' + k + '" data-i="' + i + '" data-part="' + part + '">' + usd(v) + '</button>';
          return '<tr><td>' + WF_SHORT[k] + '</td><td><b>' + esc(x.id) + '</b> ' + esc(x.label) + '</td><td class="num">' + (md ? usd(md) : '–') + '</td><td class="num">' + usd(mp) + '</td><td class="num">' + lk(x.due, 'due') + '</td><td class="num">' + lk(x.paid, 'paid') + '</td><td class="num">' + usdz(Math.max(0, x.due - x.paid)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    if (r.manualNotes && r.manualNotes.length) h += '<div class="notice warn">' + r.manualNotes.map(esc).join('<br>') + '</div>';
  }
  // balances and elections
  h += '<div class="sec"><h2>Fee balances and elections</h2><p class="lead">Amounts carried from earlier Payment Dates and the manager\'s choices for this one.</p><div class="fieldgrid">' +
    (s.fees.adminCap ? field('Admin paid, prior ' + (s.fees.adminCap.priorPeriods || 3) + ' dates', 'adminPaidPrior', { sub: 'Counts against the rolling cap' }) : '') +
    field('Senior fees unpaid b/f', 'unpaidSeniorFees') + field('Sub. fee unpaid b/f', 'unpaidSubFee') +
    field('Sub. fee manager defers', 'subFeeDeferElect', { sub: 'Current Deferred Management Fee' }) +
    '<div class="field"><label for="deferTo">Deferred fee goes to</label><select id="deferTo"><option value="interest"' + (I.subFeeDeferTo !== 'principal' ? ' selected' : '') + '>Interest Proceeds</option><option value="principal"' + (I.subFeeDeferTo === 'principal' ? ' selected' : '') + '>Principal Proceeds</option></select></div>' +
    field('Cumulative deferred fee', 'cumDeferredFee') + field('Repay to manager now', 'recoupCumDeferred') + '</div></div>';
  P.innerHTML = h;
  bindManual(P);
  if (fk) { const el = P.querySelector('[data-fk="' + (window.CSS && CSS.escape ? CSS.escape(fk) : fk) + '"]'); if (el) { el.focus(); if (selS != null && el.setSelectionRange && el.type === 'text') try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* not a text field */ } } }
}
function manChanged() { saveManual(); scheduleRun(); renderRail(); }
function addManual(rows) { const L = manRows(); rows.forEach(x => L.push(Object.assign({ id: manId(), name: '', amount: 0 }, x))); manChanged(); }
function bindKeys(root) {
  $$('input[data-key]', root).forEach(inp => inp.addEventListener('change', () => {
    const key = inp.dataset.key; const kind = inp.dataset.kind; const raw = inp.value.trim();
    const v = kind === 'pct' ? (raw === '' ? 0 : parseFloat(raw)) : parseAmt(raw);
    if (v !== null && isNaN(v)) { inp.setCustomValidity('Enter a number such as 3.1m, 450k or 3100000'); inp.reportValidity(); return; }
    inp.setCustomValidity(''); state.inputs[key] = v; if (kind !== 'pct' && v != null) inp.value = fmtAmt(v);
    scheduleRun();
  }));
}
function bindManual(P) {
  bindKeys(P);
  const dt = $('#deferTo', P); if (dt) dt.onchange = e => { state.inputs.subFeeDeferTo = e.target.value; scheduleRun(); };
  $('#manAdd', P).onclick = () => { addManual([Object.assign({ name: '' }, manualDefaultsFor(null))]); setTimeout(() => { const L = $$('#manBody input[data-f="name"]'); if (L.length) L[L.length - 1].focus(); }, 150); };
  $('#manPreset', P).onchange = e => { const x = MAN_PRESETS[+e.target.value]; if (!x) return; addManual([Object.assign({ name: x[1] ? x[0] : '' }, manualDefaultsFor(x[1]))]); setTimeout(() => { const L = $$('#manBody input[data-f="amount"]'); if (L.length) L[L.length - 1].focus(); }, 150); };
  $('#manPasteT', P).onclick = () => { const b = $('#manPaste', P); b.hidden = !b.hidden; if (!b.hidden) $('#manPasteText', P).focus(); };
  $('#manPasteGo', P).onclick = () => {
    const s = deal(); const add = [], bad = [];
    $('#manPasteText', P).value.split(/\n+/).forEach(line => {
      const t = line.trim(); if (!t) return; const c = (/\t/.test(t) ? t.split('\t') : t.split(/,(?!\d{3}(?:\D|$))/)).map(x => x.trim().replace(/^"|"$/g, ''));
      if (/^description$/i.test(c[0])) return;
      const amt = parseAmt(c[1]); const wf = /^p/i.test(c[2] || '') ? 'principal' : /^l/i.test(c[2] || '') ? 'liquidation' : 'interest';
      const st = (s.waterfalls[wf] || []).find(x => x.id.toLowerCase() === String(c[3] || '').replace(/[()]/g, '').trim().toLowerCase());
      if (!c[0] || amt == null || isNaN(amt) || !st) { bad.push(t); return; }
      const rk = /pro/i.test(c[4] || '') ? 'prorata' : /bef/i.test(c[4] || '') ? 'before' : 'after';
      add.push({ name: c[0], amount: amt, wf, step: st.id, rank: isCapStep(st) ? 'cap' : rk === 'prorata' && !canProRata(st) ? 'after' : rk });
    });
    if (add.length) { addManual(add); $('#manPasteText').value = ''; }
    const msg = (add.length ? 'Added ' + add.length + ' row' + (add.length > 1 ? 's' : '') + '. ' : '') + (bad.length ? 'Skipped ' + bad.length + ' line' + (bad.length > 1 ? 's' : '') + ' without a description, an amount and a step in this deal: ' + bad.slice(0, 2).join('; ') : '');
    setTimeout(() => { const m = $('#manPasteMsg'); if (m) m.textContent = msg; else toast(msg); if (bad.length) { const b = $('#manPaste'); if (b) b.hidden = false; } }, 150);
  };
  const csv = $('#manCsv', P); if (csv) csv.onclick = async () => {
    const out = manRows().map((m, i) => ({ row: i + 1, description: m.name, amount: (+m.amount || 0).toFixed(2), waterfall: m.wf, step: m.step, position: m.rank === 'cap' ? 'cap' : m.rank === 'prorata' ? 'pro rata' : m.rank }));
    const txt = toCSV(out, ['row', 'description', 'amount', 'waterfall', 'step', 'position']);
    if (state.caps.downloads) saveFile('manual-inputs-' + state.inputs.paymentDate + '.csv', txt);
    else { try { await navigator.clipboard.writeText(txt); toast('Copied. It pastes into a spreadsheet.'); } catch (e) { toast('Copying is blocked here.'); } }
  };
  const z = $('#manZero', P); if (z) z.onclick = () => { manRows().forEach(m => { m.amount = 0; }); manChanged(); toast('Amounts set to zero; the rows and their tags are kept.'); };
  $$('#manBody [data-mi]', P).forEach(el => el.addEventListener('change', () => {
    const m = manRows()[+el.dataset.mi]; if (!m) return; const f = el.dataset.f;
    if (f === 'amount') { const v = parseAmt(el.value); if (v !== null && isNaN(v)) { el.setCustomValidity('Enter a number such as 12.5k or 12500'); el.reportValidity(); return; } el.setCustomValidity(''); m.amount = v || 0; }
    else if (f === 'step') { const [w, sid] = el.value.split('|'); m.wf = w; m.step = sid; const st = (deal().waterfalls[m.wf] || []).find(x => x.id === m.step); m.rank = isCapStep(st) ? 'cap' : (m.rank === 'cap' || (m.rank === 'prorata' && !canProRata(st)) ? 'after' : m.rank); }
    else m[f] = el.value;
    manChanged();
  }));
  $$('[data-del]', P).forEach(b => b.onclick = () => { manRows().splice(+b.dataset.del, 1); manChanged(); });
  $$('[data-up],[data-down]', P).forEach(b => b.onclick = () => { const L = manRows(); const i = +(b.dataset.up || b.dataset.down); const j = b.dataset.up != null ? i - 1 : i + 1; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; manChanged(); });
  $$('button.calc[data-k]', P).forEach(b => b.onclick = () => openCalc({ k: b.dataset.k, i: +b.dataset.i, part: b.dataset.part }));
}
