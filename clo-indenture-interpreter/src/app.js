(function () {
'use strict';
const E = window.CLOEngine, DATA = window.CLOData;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const usd = x => (x < -0.5 ? '−' : '') + Math.round(Math.abs(x || 0)).toLocaleString('en-US');
const usdz = x => Math.abs(x || 0) < 0.5 ? '–' : usd(x);
const mm = x => { const a = Math.abs(x || 0); const s = a >= 1e6 ? '$' + (a / 1e6).toFixed(2) + 'm' : a >= 1e3 ? '$' + (a / 1e3).toFixed(0) + 'k' : '$' + a.toFixed(0); return (x < -0.5 ? '−' : '') + s; };
const pct = (x, d) => x == null || !isFinite(x) ? (x === Infinity ? 'n/m' : '—') : x.toFixed(d == null ? 2 : d) + '%';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = s => { const [y, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m - 1] + ' ' + y; };
const shortDate = s => { const [y, m] = s.split('-').map(Number); return MONTHS[m - 1].slice(0, 3) + ' ' + y; };
function parseAmt(v) {
  if (v == null) return null; const s = String(v).trim().replace(/[$,\s]/g, '').toLowerCase(); if (s === '') return null;
  const m = s.match(/^(-?\d*\.?\d+)(bn|b|m|mm|k)?$/); if (!m) return NaN;
  const mult = { b: 1e9, bn: 1e9, m: 1e6, mm: 1e6, k: 1e3 }[m[2]] || 1; return parseFloat(m[1]) * mult;
}
const fmtAmt = x => x == null || x === '' ? '' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(3).replace(/\.?0+$/, '') + 'm' : Math.abs(x) >= 1e3 ? (x / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(x));
let toastT; function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); }
  const d = $('#calcd'); const host = d && d.open ? d : document.body; if (t.parentNode !== host) host.appendChild(t);
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3600);
}

// ---------------- deals & state
const BUILTIN = { example: DATA.EXAMPLE_CLO };
// the fictional sample indenture and trustee figures from sample_inputs, so the page can be tried without a document
const SAMPLE_INDENTURE = /*@text sample_inputs/example-clo-indenture.txt*/;
const SAMPLE_TIEOUT = { date: '2009-04-18', csv: /*@text sample_inputs/example-tieout-apr09.csv*/ };
const LS_KEY = 'clo-interpreter-deals-v1';
function loadSavedDeals() { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } }
function saveDeals() { try { localStorage.setItem(LS_KEY, JSON.stringify(state.saved)); } catch (e) { /* storage unavailable: keep in memory */ } }
const MAN_KEY = 'clo-interpreter-manual-v1';
function loadManual() { try { const raw = localStorage.getItem(MAN_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } }
function saveManual() { try { localStorage.setItem(MAN_KEY, JSON.stringify(state.manualByDeal)); } catch (e) { /* storage unavailable: keep in memory */ } }
const DW_KEY = 'clo-interpreter-docwords-v1';
function loadDocWords() { try { const raw = localStorage.getItem(DW_KEY); return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } }
function saveDocWords() { try { localStorage.setItem(DW_KEY, JSON.stringify(state.docWords)); } catch (e) { /* storage unavailable: keep in memory */ } }
const SCEN = DATA.scenarios();
const state = {
  saved: loadSavedDeals(), docWords: loadDocWords(), manualByDeal: loadManual(), dealId: 'example', scenarioId: 'apr09', tape: null, tapeSource: '', inputs: null,
  stress: { extraDefaultPct: 0, notches: 0, priceShock: 0, defaultPrice: 45 }, tab: 'waterfall', wfView: 'interest', result: null, hist: [],
  interp: { pages: null, fileName: '', excerpts: null, status: '', log: [], spec: null, check: null, busy: false, ctl: null },
  caps: { sample: null, downloads: null }
};
const deal = () => BUILTIN[state.dealId] || state.saved[state.dealId];
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function loadScenario(id) {
  const sc = SCEN.find(s => s.id === id) || SCEN[1];
  state.scenarioId = sc.id; state.tape = sc.tape.map(x => Object.assign({}, x));
  state.tapeSource = 'Illustrative tape for the ' + sc.label.split(' — ')[0] + ' scenario (' + sc.tape.length + ' positions; fictional obligors, not the deal\'s actual holdings)';
  state.inputs = clone(sc.inputs); state.stress = { extraDefaultPct: 0, notches: 0, priceShock: 0, defaultPrice: 45 };
  if (state.inputs.mode === 'liquidation') state.wfView = 'liquidation'; else if (state.wfView === 'liquidation') state.wfView = 'interest';
}
function freshInputsFor(spec) {
  const sel = {}; const S = spec.selections || {};
  if (S.moodysModifier) sel.moodysModifier = S.moodysModifier.default; if (S.spCase) sel.spCase = S.spCase.default; sel.external = {};
  const notes = {}; spec.classes.forEach(c => { notes[c.id] = { bal: c.balance, def: 0 }; });
  return { paymentDate: E.schedule(spec)[0].date, libor: 5.0, principalProceeds: 0, interestProceeds: null, feeBasis: null, adminDue: 100000, adminPaidPrior: 0, taxes: 0, hedgePayment: 0, hedgeTermSenior: 0, hedgeTermSub: 0, unpaidSeniorFees: 0, unpaidSubFee: 0, subFeeDeferElect: 0, subFeeDeferTo: 'interest', cumDeferredFee: 0, recoupCumDeferred: 0, rcf: false, rcfAmount: 0, specialRedemption: 0, reinvestElect: 0, principalCashInPCV: true, mode: 'regular', liquidationProceeds: 0, notes, subHistory: [], selections: sel };
}
function loadDeal(id) {
  state.proj = null;
  state.dealId = id; state.hist = [];
  if (id === 'example') { loadScenario(state.scenarioId || 'apr09'); }
  else {
    const spec = deal(); fillDefaults(spec); saveDeals(); const base = SCEN[0].tape; const tot = sum(base, x => x.par); const k = (spec.meta.targetPar || tot) / tot;
    state.tape = base.map(x => Object.assign({}, x, { par: Math.round(x.par * k) }));
    state.tapeSource = 'Illustrative tape scaled to this deal\'s ' + mm(spec.meta.targetPar || tot) + ' target par. Upload the deal\'s own tape for real results.';
    state.inputs = freshInputsFor(spec); state.wfView = 'interest';
  }
  renderMast(); renderRail(); run();
}

// ---------------- run
let runT;
function scheduleRun() { clearTimeout(runT); runT = setTimeout(run, 90); }
function effectiveTape() { return DATA.applyStress(state.tape, state.stress, state.inputs.paymentDate); }
function run() {
  state.inputs.manual = manRows();
  try {
    state.result = E.run(deal(), effectiveTape(), state.inputs);
    state.error = null;
  } catch (e) { state.error = e; console.error(e); }
  renderOutput();
}

// ---------------- masthead
function renderMast() {
  const s = deal();
  $('#dealName').textContent = s.meta.name;
  $('#dealDoc').innerHTML = 'Interpreted from the <b>' + esc(s.meta.document || 'deal documents') + '</b>' + (s.meta.manager ? ', managed by ' + esc(s.meta.manager) : '') + (s.meta.trustee ? ', ' + esc(s.meta.trustee) + ' as trustee' : '') + '.';
  const sel = $('#dealSel');
  const opts = [['example', 'Example CLO I (built in, fictional)']].concat(Object.keys(state.saved).map(k => [k, state.saved[k].meta.name + ' (interpreted)']));
  sel.innerHTML = opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === state.dealId ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
}

// ---------------- rail (inputs)
function field(label, key, opts) {
  opts = opts || {}; const v = opts.get ? opts.get() : state.inputs[key];
  const id = 'f-' + (opts.id || key);
  const shown = opts.kind === 'pct' ? (v == null ? '' : v) : (v == null || v === '' ? '' : fmtAmt(v));
  return '<div class="field' + (opts.wide ? ' wide' : '') + '"><label for="' + id + '">' + label + (opts.sub ? '<small>' + opts.sub + '</small>' : '') + '</label>' +
    '<input type="text" inputmode="decimal" id="' + id + '" data-key="' + esc(key) + '" data-kind="' + (opts.kind || 'amt') + '" value="' + esc(shown) + '"' + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '></div>';
}
function renderRail() {
  const s = deal(); const I = state.inputs; const sched = E.schedule(s);
  const isSym = state.dealId === 'example';
  let h = '';
  if (isSym) {
    h += '<div class="grp"><h3>Scenario <small>illustrative</small></h3><div class="scen">' + SCEN.map(sc => '<button type="button" data-scen="' + sc.id + '" aria-pressed="' + (sc.id === state.scenarioId) + '"><b>' + esc(sc.label) + '</b><span>' + esc(sc.blurb) + '</span></button>').join('') + '</div></div>';
  }
  h += '<div class="grp"><h3>Payment Date</h3>' +
    '<div class="field wide"><select id="pdSel" aria-label="Payment Date">' + sched.map(x => '<option value="' + x.date + '"' + (x.date === I.paymentDate ? ' selected' : '') + '>' + x.n + '. ' + longDate(x.date) + '</option>').join('') + '</select></div>' +
    '<div class="period-line" id="periodLine"></div>' +
    '<div class="field"><label for="modeSel">Waterfall</label><select id="modeSel"><option value="regular"' + (I.mode !== 'liquidation' ? ' selected' : '') + '>Regular</option><option value="liquidation"' + (I.mode === 'liquidation' ? ' selected' : '') + '>Liquidation</option></select></div></div>';
  h += '<div class="grp"><h3>Rates and collections <small>$; 3.1m, 450k ok</small></h3>' +
    field((s.meta.index || 'Index') + ' %', 'libor', { kind: 'pct' }) +
    field('Interest Proceeds', 'interestProceeds', { sub: 'Blank uses the tape estimate', placeholder: 'estimate' }) +
    field('Principal Proceeds', 'principalProceeds', { sub: 'Cash in the Principal Collection Account' }) +
    (I.mode === 'liquidation' ? field('Liquidation proceeds', 'liquidationProceeds', { sub: 'Sale of the portfolio', placeholder: 'market value' }) : '') +
    '<label class="check"><input type="checkbox" id="cashPCV"' + (I.principalCashInPCV !== false ? ' checked' : '') + '> Principal cash counts in the OC numerator</label></div>';
  h += '<div class="grp"><h3>Notes outstanding <small>before this date</small></h3><div class="notes-grid"><span></span><span class="h">Principal</span><span class="h">Deferred interest</span>' +
    s.classes.map(c => '<span>' + esc(c.id) + '</span><input type="text" inputmode="decimal" aria-label="Class ' + esc(c.id) + ' principal" data-note="' + esc(c.id) + '" data-part="bal" value="' + fmtAmt(I.notes[c.id] ? I.notes[c.id].bal : c.balance) + '"><input type="text" inputmode="decimal" aria-label="Class ' + esc(c.id) + ' deferred interest" data-note="' + esc(c.id) + '" data-part="def" value="' + (c.deferrable ? fmtAmt(I.notes[c.id] ? I.notes[c.id].def : 0) : '') + '"' + (c.deferrable ? '' : ' disabled placeholder="n/a"') + '>').join('') + '</div></div>';
  { const MR = manRows().filter(m => +m.amount > 0); const std = standardRows().filter(x => +I[x.field] > 0);
    h += '<div class="grp"><h3>Expenses and fees</h3><p class="hint" style="margin-top:0">' + (MR.length + std.length) + ' manual amount' + (MR.length + std.length === 1 ? '' : 's') + ', ' + mm(sum(MR, m => +m.amount) + sum(std, x => +I[x.field])) + ' in total, each tagged to a waterfall step. Fee balances and the manager\'s elections are there too.</p><button class="btn small" type="button" id="toManual">Open Manual inputs</button></div>'; }
  h += '<div class="grp"><h3>Events</h3><label class="check"><input type="checkbox" id="rcfChk"' + (I.rcf ? ' checked' : '') + '> Rating Confirmation Failure continues</label>' +
    (Object.values(s.waterfalls || {}).some(W => (W || []).some(st => st.when === 'redemption')) ? '<label class="check"><input type="checkbox" id="redChk"' + (I.redemption ? ' checked' : '') + '> This Payment Date is a Redemption Date</label>' : '') +
    (I.rcf ? field('Paydown to reinstate ratings', 'rcfAmount') : '') + field('Special Redemption Amount', 'specialRedemption') +
    field('Reinvest after RP', 'reinvestElect', { sub: 'Credit-improved or prepaid proceeds' }) + '</div>';
  h += '<div class="grp"><h3>Stress overlay <small>on the tape</small></h3>' +
    rng('extraDefaultPct', 'Extra defaults, % of par', 0, 10, 0.5, v => v.toFixed(1) + '%') +
    rng('notches', 'Downgrade every performing loan', 0, 3, 1, v => v + (v === 1 ? ' notch' : ' notches')) +
    rng('priceShock', 'Price shock', 0, 25, 1, v => '−' + v + ' pts') +
    '<p class="hint">Defaults hit the weakest names first and are marked at 45. CCC names that were already haircut lose less on default than you might expect.</p>' +
    '<button class="btn small" type="button" id="stressReset">Clear stress</button></div>';
  h += '<div class="grp"><h3>Subordinated Notes history <small>date, amount</small></h3><textarea id="subHist" rows="4" aria-label="Prior distributions to the Subordinated Notes">' + esc((I.subHistory || []).map(x => x.date + ', ' + Math.round(x.amount)).join('\n')) + '</textarea><p class="hint">Prior distributions drive the ' + (s.fees.incentive ? s.fees.incentive.hurdleIRR + '% IRR hurdle' : 'IRR') + '.</p></div>';
  $('#railBody').innerHTML = h;
  bindRail();
  updatePeriodLine();
}
function rng(key, label, min, max, step, f) {
  const v = state.stress[key] || 0;
  return '<div class="range"><label for="r-' + key + '">' + label + ' <output id="o-' + key + '">' + f(v) + '</output></label><input type="range" id="r-' + key + '" data-stress="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"></div>';
}
const RNG_FMT = { extraDefaultPct: v => v.toFixed(1) + '%', notches: v => v + (v === 1 ? ' notch' : ' notches'), priceShock: v => '−' + v + ' pts' };
function bindRail() {
  const R = $('#railBody');
  $$('[data-scen]', R).forEach(b => b.onclick = () => { loadScenario(b.dataset.scen); state.hist = []; renderRail(); run(); });
  $('#pdSel').onchange = e => { state.inputs.paymentDate = e.target.value; updatePeriodLine(); scheduleRun(); };
  $('#modeSel').onchange = e => {
    state.inputs.mode = e.target.value;
    if (e.target.value === 'liquidation') { state.wfView = 'liquidation'; if (!state.inputs.liquidationProceeds) { const pf = E.analysePortfolio(deal(), effectiveTape(), { asOf: state.inputs.paymentDate, libor: +state.inputs.libor }); state.inputs.liquidationProceeds = Math.round(sum(pf.rows, r => r.par * Math.min(100, r.price) / 100)); } }
    else state.wfView = 'interest';
    renderRail(); run();
  };
  $$('input[data-key]', R).forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.key; const kind = inp.dataset.kind; const raw = inp.value.trim();
      let v = kind === 'pct' ? (raw === '' ? 0 : parseFloat(raw)) : parseAmt(raw);
      if (v !== null && isNaN(v)) { inp.setCustomValidity('Enter a number such as 3.1m, 450k or 3100000'); inp.reportValidity(); return; }
      inp.setCustomValidity('');
      state.inputs[key] = v; if (kind !== 'pct' && v != null) inp.value = fmtAmt(v);
      scheduleRun();
    });
  });
  $$('input[data-note]', R).forEach(inp => inp.addEventListener('change', () => {
    const v = parseAmt(inp.value); if (v != null && isNaN(v)) { inp.setCustomValidity('Enter an amount'); inp.reportValidity(); return; }
    inp.setCustomValidity(''); const c = inp.dataset.note; state.inputs.notes[c] = state.inputs.notes[c] || { bal: 0, def: 0 };
    state.inputs.notes[c][inp.dataset.part] = v || 0; inp.value = fmtAmt(v || 0); scheduleRun();
  }));
  $('#cashPCV').onchange = e => { state.inputs.principalCashInPCV = e.target.checked; scheduleRun(); };
  $('#toManual').onclick = () => { selectTab('manual'); const t = $('#tabs'); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  $('#rcfChk').onchange = e => { state.inputs.rcf = e.target.checked; renderRail(); scheduleRun(); };
  const rd = $('#redChk'); if (rd) rd.onchange = e => { state.inputs.redemption = e.target.checked; scheduleRun(); };
  $$('input[data-stress]', R).forEach(inp => inp.oninput = () => { const k = inp.dataset.stress; state.stress[k] = +inp.value; $('#o-' + k).textContent = RNG_FMT[k](+inp.value); scheduleRun(); });
  $('#stressReset').onclick = () => { state.stress = { extraDefaultPct: 0, notches: 0, priceShock: 0, defaultPrice: 45 }; renderRail(); run(); };
  $('#subHist').onchange = e => {
    const rows = []; const bad = [];
    e.target.value.split(/\n+/).forEach(line => { const t = line.trim(); if (!t) return; const m = t.match(/^(\d{4}-\d{2}-\d{2})[,;\s]+([\d.,]+[mk]?)$/i); if (!m) { bad.push(t); return; } rows.push({ date: m[1], amount: parseAmt(m[2]) }); });
    if (bad.length) { toast('Skipped lines that are not "yyyy-mm-dd, amount": ' + bad.slice(0, 2).join('; ')); }
    state.inputs.subHistory = rows; scheduleRun();
  };
}
function updatePeriodLine() {
  const s = deal(); const sched = E.schedule(s); const i = sched.findIndex(x => x.date === state.inputs.paymentDate);
  const prev = i > 0 ? sched[i - 1].date : s.meta.closingDate; const d = E.days(prev, state.inputs.paymentDate);
  const inRP = E.D(state.inputs.paymentDate) <= E.D(s.meta.reinvestmentPeriodEnd);
  const el = $('#periodLine'); if (el) el.innerHTML = 'Period <b>' + (i + 1) + '</b>, <b>' + d + '</b> days of interest, ' + (inRP ? 'inside the Reinvestment Period' : 'after the Reinvestment Period');
}

// ---------------- output
function renderOutput() {
  if (state.error) {
    const s = deal(); const v = E.validateSpec(s); const why = E.plainError(state.error);
    const msg = '<div class="notice err"><b>This deal could not be run:</b> ' + esc(why) + '.' + (v.errs.length ? ' The spec check finds: ' + esc(v.errs.slice(0, 4).join('; ')) + (v.errs.length > 4 ? ' (and ' + (v.errs.length - 4) + ' more)' : '') + '.' : '') + ' Open the <b>Rules</b> tab to edit the deal spec, or switch back to the built-in Example CLO I.</div>';
    $('#verdict').innerHTML = msg; $('#strip').innerHTML = '';
    $$('#tabs button').forEach(b => { const n = b.querySelector('.n'); if (n) n.remove(); });
    ['waterfall', 'tests', 'tieout', 'projection', 'notes', 'portfolio'].forEach(k => { const P = $('#p-' + k); if (P) P.innerHTML = '<p class="lead">Nothing to show until the deal runs.</p>'; });
    renderRules(); renderManual(); return;
  }
  renderVerdict(); renderStrip(); renderTabs();
  renderWaterfall(); renderManual(); renderTests(); renderTieout(); renderProjection(); renderNotes(); renderPortfolio(); renderRules();
}

function interestCures(r) { return (r.waterfalls.interest || []).filter(s => (s.type === 'cure') && s.paid > 0.5); }
function renderVerdict() {
  const r = state.result, s = deal();
  const fails = r.preTests.filter(t => !t.pass);
  const parts = [];
  const when = longDate(r.paymentDate) + ', Payment Date ' + r.period + ' (' + r.days + ' days), ' + (r.mode === 'liquidation' ? 'liquidation' : (r.inRP ? 'inside the Reinvestment Period' : 'after the Reinvestment Period'));
  if (r.mode === 'liquidation') {
    const L = r.waterfalls.liquidation; const rated = L.filter(x => x.type === 'interestAndPrincipal');
    const short = rated.filter(x => x.due - x.paid > 0.5);
    parts.push('In liquidation, ' + mm(r.liquidationCash) + ' of cash runs through one combined waterfall.');
    parts.push(short.length ? 'It falls short at <strong>' + esc(short[0].label) + '</strong>, which recovers ' + mm(short[0].paid) + ' of ' + mm(short[0].due) + '.' : 'Every rated class is repaid in full with interest.');
    parts.push('The Subordinated Notes receive <strong>' + mm(r.ctx.subPaidToday) + '</strong>' + (r.ctx.cmIncentive > 0.5 ? ' and the manager takes ' + mm(r.ctx.cmIncentive) + ' of incentive fee' : '') + '.');
  } else {
    if (!fails.length) parts.push('<strong>All coverage tests pass</strong>' + (r.period < 2 ? ' (interest coverage starts on Payment Date 2)' : '') + '.');
    else parts.push(fails.map(t => { const bits = []; if (!t.ocPass) bits.push('OC test fails at ' + pct(t.oc.ratio) + ' against ' + pct(t.ocTrigger)); if (t.icApplies && !t.icPass) bits.push('IC test fails at ' + pct(t.ic.ratio, 1) + ' against ' + pct(t.icTrigger, 1)); return 'The <strong>' + esc(t.label) + '</strong> ' + bits.join(' and its '); }).join('; ') + '.');
    const ip = r.interestProceeds; const W = r.waterfalls.interest;
    const deferred = s.classes.filter(c => c.deferrable && r.notes[c.id].intShort > 0.5);
    const seniorShort = s.classes.filter(c => !c.deferrable && r.notes[c.id].intShort > 0.5);
    const cures = interestCures(r); const irt = W.find(x => x.type === 'reinvestmentDiversion' && x.paid > 0.5);
    let sent = 'Interest Proceeds of ' + mm(ip) + (state.inputs.interestProceeds == null ? ' (estimated from the tape)' : '');
    if (seniorShort.length) sent += ' do not cover <strong>' + seniorShort.map(c => 'Class ' + c.id).join(' and ') + ' interest</strong>';
    else if (deferred.length) sent += ' pay the senior notes, but ' + deferred.map(c => 'Class ' + c.id).join(', ') + ' interest of ' + mm(sum(deferred, c => r.notes[c.id].intShort)) + ' is <strong>deferred</strong>';
    else sent += ' cover expenses, senior fees and every class\'s interest';
    parts.push(sent + '.');
    if (cures.length || irt) {
      const bits = cures.map(c => mm(c.paid) + ' at step ' + c.id + ' to pay down ' + c.payees.filter(p => p.amount > 0.5).map(p => p.to.replace(' principal', '')).join(' and '));
      let t = bits.length ? 'The indenture diverts ' + bits.join(', ') : '';
      if (irt) t += (t ? ', and the ' : 'The ') + esc(s.coverage.reinvestmentTest.label) + ' moves ' + mm(irt.paid) + ' into principal to buy collateral';
      parts.push(t + '.');
    }
    const P = r.waterfalls.principal || [];
    const pcure = P.find(x => x.type === 'cureAll' && x.paid > 0.5); const rein = P.find(x => x.type === 'reinvest' && x.paid > 0.5); const am = P.find(x => x.type === 'amortize' && x.paid > 0.5);
    const pbits = [];
    if (pcure) pbits.push(mm(pcure.paid) + ' of principal goes to cure coverage tests');
    if (rein) pbits.push(mm(rein.paid) + ' is reinvested');
    if (am) { const paid = am.payees.filter(p => /principal/.test(p.to) && p.amount > 0.5); const reinv = am.payees.find(p => /Reinvested/.test(p.to)); pbits.push((paid.length ? mm(sum(paid, p => p.amount)) + ' pays ' + paid.map(p => p.to.replace(' principal', '')).join(', ') + ' down' + (paid.length === 1 ? ' to ' + mm(r.notes[paid[0].to.split(' ')[1]].balEnd) : '') : '') + (reinv ? (paid.length ? ' and ' : '') + mm(reinv.amount) + ' is reinvested' : '')); }
    if (pbits.length) parts.push('Of the principal, ' + pbits.join('; ') + '.');
    const eq = r.ctx.subPaidToday; const inc = s.fees.incentive;
    parts.push(eq > 0.5 ? 'The Subordinated Notes receive <strong>' + mm(eq) + '</strong>' + (r.ctx.cmIncentive > 0.5 ? ', with ' + mm(r.ctx.cmIncentive) + ' of incentive fee to the manager now that the ' + inc.hurdleIRR + '% hurdle is met' : inc ? ', all of it counting toward the ' + inc.hurdleIRR + '% hurdle' : '') + '.' : 'Nothing reaches the Subordinated Notes this Payment Date.');
  }
  const qf = r.quality.filter(q => q.pass === false).length; const cf = r.conc.filter(c => c.pass === false).length;
  const tags = [];
  r.ctx.eod.forEach(e => tags.push('<span class="tag fail"><i></i>' + esc(e) + '</span>'));
  if (r.preIRT && s.coverage.reinvestmentTest) { const ok = r.preIRT.ratio >= s.coverage.reinvestmentTest.trigger; tags.push('<span class="tag ' + (ok ? 'ok' : 'warn') + '"><i></i>' + esc(s.coverage.reinvestmentTest.label) + ' ' + pct(r.preIRT.ratio) + '</span>'); }
  tags.push('<span class="tag ' + (qf ? 'warn' : 'ok') + '"><i></i>' + (qf ? qf + ' quality test' + (qf > 1 ? 's' : '') + ' failing' : 'Quality tests pass') + '</span>');
  tags.push('<span class="tag ' + (cf ? 'warn' : 'ok') + '"><i></i>' + (cf ? cf + ' concentration limit' + (cf > 1 ? 's' : '') + ' breached' : 'Within concentration limits') + '</span>');
  const st = state.stress; if (st.extraDefaultPct || st.notches || st.priceShock) tags.push('<span class="tag warn"><i></i>Stress overlay on</span>');
  const mu = (r.manual || []).filter(m => m.amount > 0.005 && /^Not paid|^Part paid/.test(m.status)).length; if (mu) tags.push('<span class="tag warn"><i></i>' + mu + ' manual input' + (mu > 1 ? 's' : '') + ' not paid in full</span>');
  const W = Array.from(new Set(r.warnings.concat(r.quality.filter(q => q.failed).map(q => 'Collateral Quality Test \u201c' + q.label + '\u201d ' + q.note.charAt(0).toLowerCase() + q.note.slice(1)))));
  const bad = W.filter(w => /could not be computed/.test(w)), gaps = W.filter(w => !/could not be computed/.test(w));
  const wl = (cls, head, L, m) => L.length ? '<div class="notice ' + cls + '" style="margin:' + m + '"><b>' + head + '</b><ul style="margin:4px 0 0;padding-left:18px">' + L.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '';
  $('#verdict').innerHTML = wl('err', 'Steps the engine had to skip. The figures below are not reliable until the deal spec is fixed (Rules tab, Deal spec):', bad, '0 0 12px') +
    '<p class="when">' + when + '</p><p class="say">' + parts.join(' ') + '</p><div class="alerts">' + tags.join('') + '</div>' + wl('warn', 'Gaps in the deal spec, and how the engine handled them:', gaps, '10px 0 0');
}

function renderStrip() {
  const r = state.result, s = deal();
  const cells = r.preTests.map(t => {
    const cushion = t.oc.num - t.ocTrigger / 100 * t.oc.den; const fail = !t.pass;
    const w = Math.max(0, Math.min(100, (t.oc.ratio - (t.ocTrigger - 8)) / 16 * 100));
    return '<div class="cell' + (fail ? ' failing' : '') + '"><div class="t"><span>' + esc(t.label) + ' OC</span><span class="st ' + (t.ocPass ? 'pass' : 'fail') + '">' + (t.ocPass ? 'Pass' : 'Fail') + '</span></div>' +
      '<div class="v">' + pct(t.oc.ratio) + '</div><div class="bar"><span style="width:' + w + '%"></span><em style="left:50%"></em></div>' +
      '<div class="s">Trigger ' + pct(t.ocTrigger) + ', cushion ' + (cushion >= 0 ? mm(cushion) : '−' + mm(-cushion)) + '</div>' +
      (t.ic ? '<div class="ic">IC ' + (t.icApplies ? pct(t.ic.ratio, 1) + ' vs ' + pct(t.icTrigger, 1) + ' <span class="st ' + (t.icPass ? 'pass' : 'fail') + '">' + (t.icPass ? 'pass' : 'fail') + '</span>' : '<span class="st na">not yet applicable</span>') + '</div>' : '') + '</div>';
  });
  if (r.preIRT && s.coverage.reinvestmentTest) {
    const rt = s.coverage.reinvestmentTest; const ok = r.preIRT.ratio >= rt.trigger; const w = Math.max(0, Math.min(100, (r.preIRT.ratio - (rt.trigger - 8)) / 16 * 100));
    cells.push('<div class="cell' + (ok ? '' : ' failing') + '"><div class="t"><span>' + esc(rt.label.replace('Interest Reinvestment Test', 'Reinvestment test')) + '</span><span class="st ' + (ok ? 'pass' : 'fail') + '">' + (ok ? 'Pass' : 'Fail') + '</span></div><div class="v">' + pct(r.preIRT.ratio) + '</div><div class="bar"><span style="width:' + w + '%"></span><em style="left:50%"></em></div><div class="s">Trigger ' + pct(rt.trigger) + '; diverts up to ' + rt.maxDiversionPct + '%</div></div>');
  }
  if (r.preEoD && s.coverage.eodTest) {
    const et = s.coverage.eodTest; const ok = r.preEoD.ratio >= et.trigger;
    cells.push('<div class="cell' + (ok ? '' : ' failing') + '"><div class="t"><span>Event of Default OC</span><span class="st ' + (ok ? 'pass' : 'fail') + '">' + (ok ? 'Clear' : 'Breach') + '</span></div><div class="v">' + pct(r.preEoD.ratio) + '</div><div class="s">' + esc(et.label.replace(/ \(Event of Default\)/, '')) + ', minimum ' + pct(et.trigger, 0) + '</div></div>');
  }
  const el = $('#strip'); el.style.gridTemplateColumns = 'repeat(' + Math.min(6, cells.length) + ', minmax(0, 1fr))';
  if (window.matchMedia('(max-width: 1180px)').matches) el.style.gridTemplateColumns = '';
  el.innerHTML = cells.join('');
}

function renderTabs() {
  const r = state.result;
  const counts = { tests: r.preTests.filter(t => !t.pass).length + r.quality.filter(q => q.pass === false).length + r.conc.filter(c => c.pass === false).length, manual: (r.manual || []).filter(m => m.amount > 0.005 && !/^Paid in full|^Applies only/.test(m.status)).length, tieout: tieOffCount() };
  $$('#tabs button').forEach(b => { const n = counts[b.dataset.tab]; const base = b.textContent.replace(/\d+$/, '').trim(); b.innerHTML = esc(base) + (n ? '<span class="n">' + n + '</span>' : ''); });
}

// ---------- waterfall tab
const CAT = {
  exp: ['Expenses and senior fees', 'var(--cat-exp)'], int: ['Note interest', 'var(--cat-int)'], cure: ['Coverage cures', 'var(--cat-cure)'], fee: ['Manager fees', 'var(--cat-fee)'],
  irt: ['Reinvestment test diversion', 'var(--cat-irt)'], eq: ['Subordinated Notes', 'var(--cat-eq)'], rein: ['Reinvested', 'var(--cat-rein)'], pay: ['Note principal', 'var(--cat-int)'], left: ['Not distributed', 'var(--rule)']
};
function catOf(row, payee) {
  switch (row.type) {
    case 'expense': case 'fees': return 'exp';
    case 'interest': return 'int';
    case 'unpaidFrom': return /interest/.test(payee.to) ? 'int' : 'exp';
    case 'cure': case 'cureAll': case 'rcf': case 'specialRedemption': return 'cure';
    case 'subMgmtFee': return /Principal Proceeds/.test(payee.to) ? 'irt' : 'fee';
    case 'reinvestmentDiversion': return 'irt';
    case 'equityHurdle': return 'eq';
    case 'incentiveSplit': return /Incentive/.test(payee.to) ? 'fee' : 'eq';
    case 'reinvest': return 'rein';
    case 'amortize': return /Reinvest/.test(payee.to) ? 'rein' : 'pay';
    case 'interestAndPrincipal': return /principal/.test(payee.to) ? 'pay' : 'int';
    default: return 'exp';
  }
}
function allocation(rows, total, residual) {
  const acc = {}; rows.forEach(row => row.payees.forEach(p => { if (p.amount > 0.005) { const c = catOf(row, p); acc[c] = (acc[c] || 0) + p.amount; } }));
  if (residual > 0.5) acc.left = residual;
  const order = ['exp', 'int', 'cure', 'fee', 'irt', 'pay', 'rein', 'eq', 'left'];
  const segs = order.filter(k => acc[k] > 0.005).map(k => ({ k, v: acc[k] }));
  return '<div class="bar" role="img" aria-label="Allocation of ' + mm(total) + '">' + segs.map(x => '<span style="width:' + (x.v / Math.max(total, 1) * 100).toFixed(3) + '%;background:' + CAT[x.k][1] + '" title="' + esc(CAT[x.k][0]) + ': ' + mm(x.v) + '"></span>').join('') + '</div>' +
    '<div class="legend">' + segs.map(x => '<span><i style="background:' + CAT[x.k][1] + '"></i>' + esc(CAT[x.k][0]) + '<b>' + mm(x.v) + '</b></span>').join('') + '</div>';
}
function wordsFor(k, id) { const D = state.docWords[state.dealId]; return D && D[k] && D[k][id] || null; }
function docwHTML(k, id, open) {
  const w = wordsFor(k, id); if (!w) return '';
  return '<details class="docw"' + (open ? ' open' : '') + '><summary>Document wording<span class="ref">' + esc(w.page) + '</span></summary><p>' + esc(w.text) + '</p></details>';
}
async function filePages(file, onStatus) {
  if (isTextDoc(file)) { const raw = await file.text(); return { pages: htmlToPages(raw, /\.html?$/i.test(file.name) || /html/.test(file.type) || /<html|<body|<p[\s>]/i.test(raw.slice(0, 5000))), unit: 'page' }; }
  if (!window.pdfjsLib) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' '));
    if (onStatus && p % 25 === 0) onStatus('Reading page ' + p + ' of ' + pdf.numPages + '…');
  }
  return { pages, unit: 'PDF p.' };
}
// Attach the document's own wording to the current deal's steps (works for the built-in deal too)
async function matchDocument(file) {
  const s = deal(); const st = $('#docMsg'); const say = m => { if (st) st.textContent = m; };
  say('Reading ' + file.name + '…');
  try {
    const { pages, unit } = await filePages(file, say);
    const loc = locateWaterfall(pages);
    if (!loc) { say('No Priority of Payments found in ' + file.name + '. Use this deal\'s indenture or offering memorandum.'); return; }
    const words = clauseTexts(loc, s.waterfalls); let n = 0, m = 0;
    ['interest', 'principal', 'liquidation'].forEach(k => (s.waterfalls[k] || []).forEach(x => { m++; const w = (words[k] || {})[x.id]; if (w) { n++; w.page = unit + ' ' + w.page; } }));
    if (!n) { say('Found a Priority of Payments on ' + unit + ' ' + (loc.from + 1) + '\u2013' + (loc.to + 1) + ', but none of its clause letters match this deal\'s steps. Is it this deal\'s document?'); return; }
    state.docWords[state.dealId] = Object.assign({ file: file.name, from: loc.from + 1, to: loc.to + 1, unit }, words); saveDocWords();
    renderWaterfall(); renderRules();
    toast('Matched ' + n + ' of ' + m + ' steps to the clauses on ' + unit + ' ' + (loc.from + 1) + '\u2013' + (loc.to + 1) + ' of ' + file.name + '.');
  } catch (e) { say('Could not read ' + file.name + ': ' + e.message); }
}
function renderWaterfall() {
  const r = state.result, s = deal(); const v = r.mode === 'liquidation' ? 'liquidation' : state.wfView;
  const rows = r.waterfalls[v] || [];
  const total = rows.length ? rows[0].before : 0;
  const titles = { interest: 'Interest Proceeds', principal: 'Principal Proceeds', liquidation: 'Liquidation cash' };
  let h = '<div class="toolbar">';
  if (r.mode !== 'liquidation') h += '<div class="seg" role="group" aria-label="Waterfall">' + ['interest', 'principal'].map(k => '<button type="button" data-wf="' + k + '" aria-pressed="' + (v === k) + '">' + (k === 'interest' ? 'Interest priority' : 'Principal priority') + '</button>').join('') + '</div>';
  else h += '<span class="src">Liquidation Priority of Payments: Interest and Principal Proceeds plus sale proceeds, combined.</span>';
  h += '<span class="src">Select any Due, Paid or Cash left amount to see the working behind it.</span>' + (state.caps.downloads ? '<button class="btn small" type="button" id="dlLedger">Download ledger CSV</button>' : '') + '</div>';
  const DW = state.docWords[state.dealId];
  h += '<div class="docbar">' + (DW ? '<span>Each step shows its clause as printed in <b>' + esc(DW.file) + '</b>, ' + esc(DW.unit) + ' ' + DW.from + '\u2013' + DW.to + '.</span><button class="linkbtn" type="button" id="docClear">Remove</button>'
    : '<span>Steps cite their clause in the ' + esc(s.meta.document || 'deal documents') + '. To see each clause\'s own wording beside it, add the document; it is read here in your browser.</span><label class="btn small" for="docFile">Add the document\u2026</label><input type="file" id="docFile" accept="application/pdf,.pdf,.htm,.html,text/html,.txt,text/plain" hidden>') + '<span class="src" id="docMsg" aria-live="polite"></span></div>';
  const residual = v === 'interest' ? r.interestResidual : r.residual;
  h += '<div class="alloc"><div class="head"><h3>Where the ' + titles[v] + ' went</h3><span class="tot"><button type="button" class="calc" data-src="' + v + '" aria-label="' + esc(titles[v]) + ' of ' + usd(total) + ': show the working">' + mm(total) + '</button>' + (v === 'principal' && r.ctx.irtDiverted ? ', of which ' + mm(r.ctx.irtDiverted) + ' was diverted from interest' : '') + '</span></div>' + allocation(rows, total, residual) + '</div>';
  h += '<div class="scroll"><table class="ledger"><thead><tr><th>Step</th><th>What the indenture requires</th><th class="num">Due</th><th class="num">Paid</th><th class="num">Shortfall</th><th class="num">Cash left</th></tr></thead><tbody>';
  for (const row of rows) {
    const ri = rows.indexOf(row);
    const link = (val, part, txt) => '<button type="button" class="calc" data-k="' + v + '" data-i="' + ri + '" data-part="' + part + '" aria-label="' + esc((part === 'due' ? 'Due' : part === 'paid' ? 'Paid' : 'Cash left') + ' at step ' + row.id + ': ' + usd(val) + '. Show the working') + '">' + txt + '</button>';
    const divert = (row.type === 'cure' || row.type === 'cureAll' || row.type === 'reinvestmentDiversion') && row.paid > 0.5;
    const short = row.due - row.paid > 0.5;
    const cls = [row.skipped ? 'skip' : '', divert ? 'divert' : '', short && !row.skipped ? 'short' : ''].join(' ');
    let w = '<b>' + esc(row.label) + '</b>';
    if (row.clause) w += '<div class="cl">' + esc(row.clause) + '</div>';
    if (row.section || row.ref) w += '<div class="sect">' + esc([row.section, row.ref].filter(Boolean).join(' \u00b7 ')) + '</div>';
    w += docwHTML(v, row.id);
    if (row.skipped) w += '<div class="nt">Skipped: ' + esc(row.skipped) + '</div>';
    else {
      if (row.test && row.test.before) {
        const b = row.test.before, a = row.test.after;
        const line = (lab, x, y, trig, ok, applies) => '<span class="testline"><span>' + lab + ' ' + pct(x.ratio) + '</span>' + (y ? '<span class="arrow">to</span><span>' + pct(y.ratio) + '</span>' : '') + '<span class="small">trigger ' + pct(trig) + '</span><span class="res ' + (applies === false ? 'na' : ok ? 'pass' : 'fail') + '">' + (applies === false ? 'n/a' : ok ? 'pass' : 'fail') + '</span></span>';
        const t = s.coverage.tests.find(x => x.id === (s.waterfalls[v].find(z => z.id === row.id) || {}).test) || {};
        w += '<div>' + line('OC', b.oc, a && a.oc, t.oc ? t.oc.trigger : 0, a ? a.ocPass : b.ocPass) + (b.ic && t.ic ? ' ' + line('IC', b.ic, a && a.ic && b.icApplies ? a.ic : null, t.ic.trigger, a ? a.icPass : b.icPass, b.icApplies) : '') + '</div>';
      }
      if (row.tests) w += '<div>' + row.tests.map(x => '<span class="testline"><span>' + esc(x.label) + ' OC ' + pct(x.before.oc.ratio) + (x.paid > 0.5 ? ' to ' + pct(x.after.oc.ratio) : '') + '</span><span class="res ' + (x.after.pass ? 'pass' : 'fail') + '">' + (x.after.pass ? 'pass' : 'fail') + '</span></span>').join('<br>') + '</div>';
      if (row.type === 'reinvestmentDiversion' && row.test) w += '<span class="testline"><span>' + pct(row.test.ratio) + (row.test.after ? ' to ' + pct(row.test.after) : '') + '</span><span class="small">trigger ' + pct(row.test.trigger) + '</span><span class="res ' + (row.test.ratio >= row.test.trigger ? 'pass' : 'fail') + '">' + (row.test.ratio >= row.test.trigger ? 'pass' : 'fail') + '</span></span>';
      if (row.note) w += '<div class="nt' + (divert ? ' d' : short && row.type !== 'equityHurdle' ? ' f' : '') + '">' + esc(row.note) + '</div>';
      const pays = row.payees.filter(p => p.amount > 0.5);
      if (pays.length > 1 || (pays.length === 1 && row.type !== 'expense')) w += '<ul class="pay">' + pays.map(p => '<li><span>' + esc(p.to) + (p.manual ? ' <span class="mtag">manual' + (p.carried ? ', carried' : '') + '</span>' : '') + '</span><span>' + usd(p.amount) + '</span></li>').join('') + '</ul>';
    }
    const remPct = total > 0 ? Math.max(0, row.after / total * 100) : 0;
    h += '<tr class="' + cls + '"><td class="step">' + esc(row.id) + '</td><td class="what">' + w + '</td><td class="num">' + link(row.due, 'due', usdz(row.due)) + '</td><td class="num">' + link(row.paid, 'paid', usdz(row.paid)) + '</td><td class="num sh">' + usdz(Math.max(0, row.due - row.paid)) + '</td><td class="rem"><div class="remv">' + link(row.after, 'paid', usd(row.after)) + '</div><div class="rembar' + (divert ? ' dv' : '') + '"><span style="width:' + remPct.toFixed(2) + '%"></span></div></td></tr>';
  }
  h += '</tbody></table></div>';
  const P = $('#p-waterfall'); P.innerHTML = h;
  $$('[data-wf]', P).forEach(b => b.onclick = () => { state.wfView = b.dataset.wf; renderWaterfall(); });
  const dl = $('#dlLedger', P); if (dl) dl.onclick = downloadLedger;
  const df = $('#docFile', P); if (df) df.onchange = e => { const f = e.target.files[0]; if (f) matchDocument(f); };
  const dc = $('#docClear', P); if (dc) dc.onclick = () => { delete state.docWords[state.dealId]; saveDocWords(); renderWaterfall(); renderRules(); };
  $$('button.calc', P).forEach(b => b.onclick = () => b.dataset.src ? openCalc({ src: b.dataset.src }) : openCalc({ k: b.dataset.k, i: +b.dataset.i, part: b.dataset.part }));
  if (state.calc && $('#calcd').open) renderCalc();
}

// ---------- working panel: every Due and Paid figure, recomputable by hand
const cents = x => (x < -0.005 ? '−' : '') + Math.abs(Math.abs(x) < 0.005 ? 0 : x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WF_NAME = { interest: 'Priority of Interest Payments', principal: 'Priority of Principal Payments', liquidation: 'Liquidation Priority of Payments' };
const SRC_NAME = { interest: 'Interest Proceeds', principal: 'Principal Proceeds', liquidation: 'Liquidation cash' };
function calcLinesHTML(lines) {
  return lines.map(l => {
    const val = v => typeof v === 'number' ? cents(v) : esc(v);
    if (l.t === 'head') return '<h4 class="cl-h">' + esc(l.text) + '</h4>';
    if (l.t === 'note') return '<p class="cl-note">' + esc(l.text) + '</p>';
    if (l.t === 'check') return '<div class="cl-row cl-check"><span class="lab">' + esc(l.label) + '</span>' + (l.expr ? '<span class="ex">' + esc(l.expr) + '</span>' : '') + '<span class="val"><span class="pill ' + (!l.applies ? 'na' : l.ok ? 'pass' : 'fail') + '">' + (!l.applies ? 'Not applied' : l.ok ? 'Pass' : 'Fail') + '</span></span></div>';
    if (l.t === 'table') return '<div class="cl-tablewrap"><table class="cl-table"><thead><tr>' + l.head.map((x, i) => '<th class="' + ((l.align || [])[i] === 'r' ? 'num' : '') + '">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + l.rows.map(r => '<tr>' + r.map((x, i) => '<td class="' + ((l.align || [])[i] === 'r' ? 'num' : '') + '">' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    const cls = 'cl-row' + (l.t === 'total' ? ' cl-total' : '') + (l.sub ? ' cl-sub' : '');
    return '<div class="' + cls + '"><span class="lab">' + esc(l.label) + '</span>' + (l.expr ? '<span class="ex">' + esc(l.expr) + '</span>' : '') + '<span class="val">' + (l.value == null ? '' : val(l.value)) + '</span></div>';
  }).join('');
}
function calcText(title, lines) {
  const out = [title];
  lines.forEach(l => {
    const v = l.value == null ? '' : typeof l.value === 'number' ? cents(l.value) : l.value;
    if (l.t === 'head') out.push('', l.text);
    else if (l.t === 'note') out.push('  ' + l.text);
    else if (l.t === 'check') out.push([l.label, l.expr, !l.applies ? 'Not applied' : l.ok ? 'Pass' : 'Fail'].join('\t'));
    else if (l.t === 'table') { out.push(l.head.join('\t')); l.rows.forEach(r => out.push(r.join('\t'))); }
    else out.push([(l.sub ? '  ' : '') + l.label, l.expr || '', v].join('\t'));
  });
  return out.join('\n');
}
function openCalc(c) {
  state.calc = c; renderCalc();
  const d = $('#calcd'); if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
  const f = $('.cd-seg button[aria-pressed="true"]', d) || $('.cd-x', d); if (f) f.focus();
}
function renderCalc() {
  const c = state.calc, r = state.result, d = $('#calcd'); if (!c || !r) return;
  let h = '';
  if (c.src) {
    const lines = (r.sourceCalc || {})[c.src] || [];
    h = '<header class="cd-head"><div><p class="cd-kicker">Cash at the start of the ' + esc(WF_NAME[c.src]) + '</p><h2 id="calcTitle">' + esc(SRC_NAME[c.src]) + '</h2></div><button type="button" class="cd-x" aria-label="Close the working">×</button></header>' +
      '<div class="cd-body"><div class="cd-lines">' + calcLinesHTML(lines) + '</div></div>' +
      '<footer class="cd-foot"><span></span><button type="button" class="btn small" id="cdCopy">Copy working</button><span></span></footer>';
    d.innerHTML = h; bindCalc(SRC_NAME[c.src], lines); return;
  }
  if (c.tc) {
    const P = tcPart(c.tc); if (!P) { d.close(); return; }
    const isNum = /\|num$/.test(c.tc); const other = c.tc.replace(/\|(num|den)$/, isNum ? '|den' : '|num'); const O = tcPart(other);
    const after = /After/.test(c.tc);
    h = '<header class="cd-head"><div><p class="cd-kicker">' + esc(c.name || 'Test') + '</p><h2 id="calcTitle">' + esc(P.title) + '</h2></div><button type="button" class="cd-x" aria-label="Close the working">×</button></header>' +
      '<div class="cd-body">' + (O ? '<div class="seg cd-seg" role="group" aria-label="Which figure">' + [['num', 'Numerator'], ['den', 'Denominator']].map(([k, lab]) => { const X = k === 'num' ? (isNum ? P : O) : (isNum ? O : P); return '<button type="button" data-tcp="' + k + '" aria-pressed="' + ((k === 'num') === isNum) + '"><span>' + lab + (after ? ', after payments' : '') + '</span><b>' + tcFmt(X.fmt, X.value) + '</b></button>'; }).join('') + '</div>' : '') +
      '<div class="cd-lines">' + calcLinesHTML(P.lines) + '</div>' + P.tables.map(assetTableHTML).join('') +
      '<p class="cd-fine">Amounts are to the cent; each line can be recomputed from the figures shown, and each table total ties to the line that cites it.</p></div>' +
      '<footer class="cd-foot"><span></span><button type="button" class="btn small" id="cdCopy">Copy working</button>' + (state.caps.downloads && P.tables.length ? '<button type="button" class="btn small" id="cdCsv">Download tables (CSV)</button>' : '<span></span>') + '</footer>';
    d.innerHTML = h;
    $$('.cd-seg button', d).forEach(b => b.onclick = () => { state.calc.tc = state.calc.tc.replace(/\|(num|den)$/, '|' + b.dataset.tcp); renderCalc(); const f = $('.cd-seg button[aria-pressed="true"]', d); if (f) f.focus(); });
    const ttl = (c.name ? c.name + ': ' : '') + P.title;
    bindCalc(ttl, P.lines);
    $('#cdCopy', d).onclick = async () => {
      const txt = calcText(ttl, P.lines) + (P.tables.length ? '\n\n' + P.tables.map(tableText).join('\n\n') : '');
      try { await navigator.clipboard.writeText(txt); toast('Working and tables copied. They paste into a spreadsheet as columns.'); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.className = 'cd-copybox'; ta.setAttribute('aria-label', 'Working as text'); $('.cd-body', d).appendChild(ta); ta.focus(); ta.select(); toast('Copying is blocked here. The text is selected below; copy it with your keyboard.'); }
    };
    const cv = $('#cdCsv', d); if (cv) cv.onclick = () => saveFile(((c.name || 'test') + ' ' + (isNum ? 'numerator' : 'denominator')).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '-' + r.paymentDate + '.csv', P.tables.map(T => '"' + T.title.replace(/"/g, '""') + '"\n' + tableCSV(T)).join('\n\n'));
    return;
  }
  const rows = r.waterfalls[c.k] || []; const row = rows[c.i]; if (!row) { d.close(); return; }
  const lines = row.calc[c.part === 'due' ? 'due' : 'paid'];
  const prev = rows[c.i - 1], next = rows[c.i + 1];
  h = '<header class="cd-head"><div><p class="cd-kicker">Step ' + esc(row.id) + ' of the ' + esc(WF_NAME[c.k]) + (row.skipped ? ', skipped on this date' : '') + '</p><h2 id="calcTitle">' + esc(row.label) + '</h2></div><button type="button" class="cd-x" aria-label="Close the working">×</button></header>' +
    '<div class="cd-body">' + (row.clause ? '<p class="cd-clause">' + esc(row.clause) + ' <span class="ref">' + esc([row.section, row.ref].filter(Boolean).join(' \u00b7 ')) + '</span></p>' : '') + docwHTML(c.k, row.id) +
    '<div class="seg cd-seg" role="group" aria-label="Which figure">' + ['due', 'paid'].map(p => '<button type="button" data-part="' + p + '" aria-pressed="' + ((c.part === 'due') === (p === 'due')) + '"><span>' + (p === 'due' ? 'Due' : 'Paid') + '</span><b>' + cents(p === 'due' ? row.due : row.paid) + '</b></button>').join('') + '</div>' +
    '<div class="cd-lines">' + calcLinesHTML(lines) + '</div><p class="cd-fine">The ledger rounds to whole dollars. The working is to the cent, and each line can be recomputed from the figures shown.</p></div>' +
    '<footer class="cd-foot">' + (prev ? '<button type="button" class="btn small" data-go="' + (c.i - 1) + '" title="' + esc(prev.label) + '">Step ' + esc(prev.id) + '</button>' : '<span></span>') +
    '<button type="button" class="btn small" id="cdCopy">Copy working</button>' +
    (next ? '<button type="button" class="btn small" data-go="' + (c.i + 1) + '" title="' + esc(next.label) + '">Step ' + esc(next.id) + '</button>' : '<span></span>') + '</footer>';
  d.innerHTML = h;
  $$('.cd-seg button', d).forEach(b => b.onclick = () => { state.calc.part = b.dataset.part; renderCalc(); const f = $('.cd-seg button[aria-pressed="true"]', d); if (f) f.focus(); });
  $$('[data-go]', d).forEach((b, bi) => b.onclick = () => { const back = +b.dataset.go < state.calc.i; state.calc.i = +b.dataset.go; renderCalc(); $('.cd-body', d).scrollTop = 0; const btns = $$('[data-go]', d); const f = btns.find(x => (+x.dataset.go < state.calc.i) === back) || $('.cd-x', d); f.focus(); });
  bindCalc('Step ' + row.id + ', ' + row.label + ', ' + (c.part === 'due' ? 'Due ' + cents(row.due) : 'Paid ' + cents(row.paid)), lines);
}
function bindCalc(title, lines) {
  const d = $('#calcd');
  $('.cd-x', d).onclick = () => d.close();
  $('#cdCopy', d).onclick = async () => {
    const txt = calcText(title, lines);
    try { await navigator.clipboard.writeText(txt); toast('Working copied. It pastes into a spreadsheet as columns.'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.className = 'cd-copybox'; ta.setAttribute('aria-label', 'Working as text'); $('.cd-body', d).appendChild(ta); ta.focus(); ta.select(); toast('Copying is blocked here. The text is selected below; copy it with your keyboard.'); }
  };
}

/*@include manual_ui.js*/
/*@include tieout_ui.js*/
/*@include projection.js*/
/*@include projection_ui.js*/
// ---------- tests tab: numerator and denominator links
function tcPart(path) {
  const T = state.result && state.result.testCalc; if (!T) return null; const [g, id, k, p] = path.split('|');
  if (g === 'coverage') return T.coverage[id] && T.coverage[id][k] ? T.coverage[id][k][p] : null;
  if (g === 'quality' || g === 'conc') return T[g][id] ? T[g][id][p] : null;
  return T[g] ? T[g][p] : null;
}
const tcFmt = (fmt, v) => v == null || v === '' ? '—' : fmt === 'usd' ? usd(v) : fmt === 'num' ? Math.round(v).toLocaleString('en-US') : fmt === 'num2' ? (+v).toFixed(2) : String(v);
function tcLink(path, name) {
  const P = tcPart(path); if (!P) return '—';
  const isNum = /\|num$/.test(path);
  return '<button type="button" class="calc" data-tc="' + esc(path) + '" data-name="' + esc(name) + '" title="' + esc(P.title) + '" aria-label="' + esc(name + ', ' + (isNum ? 'numerator' : 'denominator') + ': ' + P.title + ', ' + tcFmt(P.fmt, P.value) + '. Show the working') + '">' + tcFmt(P.fmt, P.value) + '</button>';
}
const cellFmt = (fmt, v) => {
  if (v === '' || v == null) return '';
  if (fmt === 'text') return esc(v);
  if (fmt === 'yn') return v === true || v === 'true' ? 'Yes' : v === false ? 'No' : esc(v);
  if (typeof v !== 'number') return esc(v);
  if (fmt === 'usd') return cents(v);
  const m = fmt.match(/^(pct|num)(\d)$/); if (m) return v.toLocaleString('en-US', { minimumFractionDigits: +m[2], maximumFractionDigits: +m[2] }) + (m[1] === 'pct' ? '%' : '');
  return esc(v);
};
function assetTableHTML(T) {
  const al = c => c.fmt === 'text' || c.fmt === 'yn' ? '' : 'num';
  return '<h4 class="cl-h">' + esc(T.title) + '</h4>' + (T.note ? '<p class="cl-note">' + esc(T.note) + '</p>' : '') +
    '<div class="cl-tablewrap tall"><table class="cl-table"><thead><tr>' + T.cols.map(c => '<th class="' + al(c) + '">' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
    (T.rows.length ? T.rows.map(r => '<tr>' + r.map((v, i) => '<td class="' + al(T.cols[i]) + '">' + cellFmt(T.cols[i].fmt, v) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + T.cols.length + '">None</td></tr>') + '</tbody>' +
    (T.total ? '<tfoot><tr>' + T.total.map((v, i) => '<td class="' + al(T.cols[i]) + '">' + (typeof v === 'number' ? cellFmt(T.cols[i].fmt, v) : esc(v)) + '</td>').join('') + '</tr></tfoot>' : '') + '</table></div>';
}
function tableText(T) {
  const plain = (fmt, v) => v === '' || v == null ? '' : fmt === 'yn' ? (v === true ? 'Yes' : v === false ? 'No' : v) : typeof v === 'number' ? (fmt === 'usd' ? v.toFixed(2) : String(+v.toFixed(6))) : String(v);
  return [T.title, T.cols.map(c => c.label).join('\t')].concat(T.rows.map(r => r.map((v, i) => plain(T.cols[i].fmt, v)).join('\t')), T.total ? [T.total.map((v, i) => typeof v === 'number' ? plain(T.cols[i].fmt, v) : v).join('\t')] : []).join('\n');
}
function tableCSV(T) {
  const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  return tableText(T).split('\n').slice(1).map(line => line.split('\t').map(q).join(',')).join('\n');
}
function bindTestLinks(P) { $$('button.calc[data-tc]', P).forEach(b => b.onclick = () => openCalc({ tc: b.dataset.tc, name: b.dataset.name })); }
function renderTests() {
  const r = state.result, s = deal(); let h = '';
  h += '<div class="sec"><h2>Coverage tests</h2><p class="lead">Measured on the Determination Date before any payment, then pro forma after this Payment Date\'s cures, diversions and paydowns. OC denominators exclude capitalised deferred interest.</p>';
  h += '<p class="small" style="margin:-4px 0 10px">Select a numerator or denominator to see how it is calculated and the assets or notes behind it.</p>';
  h += '<div class="scroll"><table class="tests"><thead><tr><th>Test</th><th>Measure</th><th class="num">Numerator</th><th class="num">Denominator</th><th class="num">Ratio</th><th class="num">Trigger</th><th class="num">Cushion</th><th>Result</th><th class="num">After payments</th><th>Source</th></tr></thead><tbody>';
  const sgn = x => x >= 0 ? mm(x) : '−' + mm(-x);
  r.preTests.forEach((t, i) => {
    const post = r.postTests[i]; const cush = t.oc.num - t.ocTrigger / 100 * t.oc.den; const span = t.ic ? ' rowspan="2"' : '';
    h += '<tr><td' + span + '><b>' + esc(t.label) + '</b></td><td>OC</td><td class="num">' + tcLink('coverage|' + t.id + '|oc|num', t.label + ' OC test') + '</td><td class="num">' + tcLink('coverage|' + t.id + '|oc|den', t.label + ' OC test') + '</td><td class="num">' + pct(t.oc.ratio) + '</td><td class="num">' + pct(t.ocTrigger) + '</td><td class="num">' + sgn(cush) + '</td><td><span class="res ' + (t.ocPass ? 'pass' : 'fail') + '">' + (t.ocPass ? 'Pass' : 'Fail') + '</span></td>' +
      '<td class="num">' + (tcPart('coverage|' + t.id + '|ocAfter|num') ? '<button type="button" class="calc" data-tc="coverage|' + esc(t.id) + '|ocAfter|den" data-name="' + esc(t.label + ' OC test after payments') + '">' + pct(post.oc.ratio) + '</button>' : pct(post.oc.ratio)) + '</td><td class="ref">' + esc(t.ocRef || '') + '</td></tr>';
    if (t.ic) {
      const icush = t.ic.num - t.icTrigger / 100 * t.ic.den;
      h += '<tr class="sub"><td>IC</td><td class="num">' + tcLink('coverage|' + t.id + '|ic|num', t.label + ' IC test') + '</td><td class="num">' + tcLink('coverage|' + t.id + '|ic|den', t.label + ' IC test') + '</td><td class="num">' + pct(t.ic.ratio, 2) + '</td><td class="num">' + pct(t.icTrigger, 2) + '</td><td class="num">' + (t.icApplies ? sgn(icush) : '—') + '</td><td>' + (t.icApplies ? '<span class="res ' + (t.icPass ? 'pass' : 'fail') + '">' + (t.icPass ? 'Pass' : 'Fail') + '</span>' : '<span class="res na">From period ' + ((s.coverage.tests[i].ic || {}).fromPeriod || 1) + '</span>') + '</td><td class="num">—</td><td class="ref">' + esc(t.icRef || '') + '</td></tr>';
    }
  });
  h += '</tbody></table></div>';
  h += '<p class="small" style="margin-top:8px">IC numerator: Interest Proceeds ' + mm(r.interestProceeds) + ' less ' + mm(r.icDeduct) + ' payable under interest steps ' + esc((s.coverage.icNumeratorDeducts || []).join(', ')) + ' = ' + mm(r.interestProceeds - r.icDeduct) + '.</p></div>';

  // PCV bridge
  const pb = r.pb; const hc = pb.haircut;
  h += '<div class="two"><div class="sec"><h2>Principal Collateral Value for the OC tests</h2><p class="lead">Par is haircut for defaults, discount purchases and excess CCC before it enters every OC ratio.</p><div class="scroll"><table class="bridge"><tbody>' +
    '<tr><td>Aggregate par of the tape</td><td class="num">' + usd(pb.parTotal) + '</td></tr>' +
    '<tr><td>Less: Defaulted Securities to lesser of market value and recovery value <span class="ref">' + esc(s.haircuts.defaulted.ref || '') + '</span></td><td class="num neg">' + (hc.defaulted ? '−' + usd(hc.defaulted) : '–') + '</td></tr>' +
    '<tr><td>Less: Discount Obligations to purchase price <span class="ref">' + esc(s.haircuts.discount.ref || '') + '</span></td><td class="num neg">' + (hc.discount ? '−' + usd(hc.discount) : '–') + '</td></tr>' +
    '<tr><td>Less: CCC Excess of ' + mm(pb.cccExcess) + ' to lesser of ' + s.haircuts.ccc.haircutPct + '% and market value <span class="ref">' + esc(s.haircuts.ccc.ref || '') + '</span></td><td class="num neg">' + (hc.ccc ? '−' + usd(hc.ccc) : '–') + '</td></tr>' +
    '<tr><td>Plus: Principal Proceeds on deposit' + (state.inputs.principalCashInPCV === false ? ' (excluded by your setting)' : '') + '</td><td class="num">' + usd(state.inputs.principalCashInPCV === false ? 0 : pb.principalCash) + '</td></tr>' +
    '<tr class="total"><td>Principal Collateral Value (OC numerator)</td><td class="num">' + (r.preTests[0] ? tcLink('coverage|' + r.preTests[0].id + '|oc|num', 'OC tests') : usd(state.inputs.principalCashInPCV === false ? pb.pcvOC - pb.principalCash : pb.pcvOC)) + '</td></tr></tbody></table></div>' +
    '<p class="small" style="margin-top:8px">CCC bucket: ' + mm(pb.cccAmtMoodys) + ' by Moody\'s, ' + mm(pb.cccAmtSP) + ' by S&amp;P, against a limit of ' + s.haircuts.ccc.limitPct + '% = ' + mm(pb.cccLimit) + '.</p></div>';
  // other ratio tests
  h += '<div class="sec"><h2>Other ratio tests</h2><p class="lead">Tests that divert cash or trigger default rather than cure by paydown.</p><div class="scroll"><table><thead><tr><th>Test</th><th class="num">Numerator</th><th class="num">Denominator</th><th class="num">Ratio</th><th class="num">Trigger</th><th>Result</th><th class="num">After</th></tr></thead><tbody>';
  if (r.preIRT) { const rt = s.coverage.reinvestmentTest; h += '<tr><td><b>' + esc(rt.label) + '</b><div class="small">Diverts up to ' + rt.maxDiversionPct + '% of remaining interest <span class="ref">' + esc(rt.ref || '') + '</span></div></td><td class="num">' + tcLink('irt|||num', rt.label) + '</td><td class="num">' + tcLink('irt|||den', rt.label) + '</td><td class="num">' + pct(r.preIRT.ratio) + '</td><td class="num">' + pct(rt.trigger) + '</td><td><span class="res ' + (r.preIRT.ratio >= rt.trigger ? 'pass' : 'fail') + '">' + (r.preIRT.ratio >= rt.trigger ? 'Pass' : 'Fail') + '</span></td><td class="num">' + (tcPart('irtAfter|||den') ? '<button type="button" class="calc" data-tc="irtAfter|||den" data-name="' + esc(rt.label + ' after payments') + '">' + pct(r.postIRT.ratio) + '</button>' : pct(r.postIRT.ratio)) + '</td></tr>'; }
  if (r.preEoD) { const et = s.coverage.eodTest; h += '<tr><td><b>' + esc(et.label) + '</b><div class="small">Breach is an Event of Default <span class="ref">' + esc(et.ref || '') + '</span></div></td><td class="num">' + tcLink('eod|||num', et.label) + '</td><td class="num">' + tcLink('eod|||den', et.label) + '</td><td class="num">' + pct(r.preEoD.ratio) + '</td><td class="num">' + pct(et.trigger) + '</td><td><span class="res ' + (r.preEoD.ratio >= et.trigger ? 'pass' : 'fail') + '">' + (r.preEoD.ratio >= et.trigger ? 'Clear' : 'Breach') + '</span></td><td class="num">' + (tcPart('eodAfter|||den') ? '<button type="button" class="calc" data-tc="eodAfter|||den" data-name="' + esc(et.label + ' after payments') + '">' + pct(r.postEoD.ratio) + '</button>' : pct(r.postEoD.ratio)) + '</td></tr>'; }
  h += '</tbody></table></div></div></div>';

  // quality tests
  const S = s.selections || {}; const sel = state.inputs.selections || {};
  h += '<div class="sec"><h2>Collateral Quality Tests</h2><p class="lead">Purchase criteria rather than cash triggers: a failure restricts reinvestment but does not divert cash. Defaulted Securities are excluded.</p><div class="selects">';
  if (S.moodysModifier) h += '<label>' + esc(S.moodysModifier.label) + ' <select data-sel="moodysModifier">' + S.moodysModifier.options.map(o => '<option' + (o === sel.moodysModifier ? ' selected' : '') + ' value="' + o + '">' + o + '%</option>').join('') + '</select></label>';
  if (S.spCase) h += '<label>' + esc(S.spCase.label) + ' <select data-sel="spCase">' + S.spCase.options.map(o => '<option' + (o === sel.spCase ? ' selected' : '') + ' value="' + o + '">Case ' + o + '</option>').join('') + '</select></label>';
  h += '</div><div class="scroll"><table><thead><tr><th>Test</th><th class="num">Numerator</th><th class="num">Denominator</th><th class="num">Portfolio</th><th class="num">Limit</th><th>Result</th><th>How the limit is set</th><th>Source</th></tr></thead><tbody>';
  const fmtQ = (q, x) => x == null ? '—' : q.fmt === 'int' ? Math.round(x).toLocaleString('en-US') : q.fmt === 'pct1' ? pct(x, 1) : q.fmt === 'yrs' ? x.toFixed(2) + ' yrs' : q.fmt === 'dec1' ? x.toFixed(1) : pct(x, 2);
  r.quality.forEach(q => {
    let res;
    if (q.failed) res = '<span class="res na">Not evaluated</span>';
    else if (q.pass == null) res = '<select data-ext="' + esc(q.id) + '" aria-label="' + esc(q.label) + ' result"><option value="">Not entered</option><option value="1"' + (sel.external && sel.external[q.id] === true ? ' selected' : '') + '>Pass</option><option value="0"' + (sel.external && sel.external[q.id] === false ? ' selected' : '') + '>Fail</option></select>';
    else res = '<span class="res ' + (q.pass ? 'pass' : 'fail') + '">' + (q.pass ? 'Pass' : 'Fail') + '</span>';
    const lim = q.op ? (q.op === '<=' ? '≤ ' : '≥ ') + fmtQ(q, q.limit) : '';
    h += '<tr><td><b>' + esc(q.label) + '</b>' + (q.sub ? '<div class="small">' + q.sub.map(x => x.col + ' ' + pct(x.value, 1) + ' / ' + pct(x.limit, 1) + (x.pass ? '' : ' ✗')).join(', ') + '</div>' : '') + '</td><td class="num">' + tcLink('quality|' + q.id + '||num', q.label) + '</td><td class="num">' + tcLink('quality|' + q.id + '||den', q.label) + '</td><td class="num">' + fmtQ(q, q.value) + '</td><td class="num">' + (q.limit != null ? lim : '—') + '</td><td>' + res + '</td><td class="small">' + esc(q.note || '') + '</td><td class="ref">' + esc(q.ref || '') + '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  // concentrations
  h += '<div class="sec"><h2>Portfolio Profile Test</h2><p class="lead">Percentages of Principal Collateral Value at par (' + mm(r.pb.pcvGeneral) + '). The indenture applies these when buying, requiring a breached limit to be maintained or improved.</p><div class="scroll"><table><thead><tr><th>Clause</th><th>Limit on</th><th class="num">Numerator</th><th class="num">Denominator</th><th class="num">Portfolio</th><th class="num">Limit</th><th>Result</th><th>Note</th><th>Source</th></tr></thead><tbody>';
  r.conc.forEach(c => { h += '<tr><td class="ref" style="color:var(--ink-2)">' + esc(c.id) + '</td><td>' + esc(c.label) + '</td><td class="num">' + tcLink('conc|' + c.id + '||num', 'Portfolio Profile Test ' + c.id + ', ' + c.label) + '</td><td class="num">' + tcLink('conc|' + c.id + '||den', 'Portfolio Profile Test ' + c.id + ', ' + c.label) + '</td><td class="num">' + pct(c.value) + '</td><td class="num">' + (c.op === '>=' ? '≥ ' : '≤ ') + pct(c.limit, c.limit % 1 ? 1 : 0) + '</td><td><span class="res ' + (c.pass ? 'pass' : 'fail') + '">' + (c.pass ? 'Pass' : 'Fail') + '</span></td><td class="small">' + esc(c.note || '') + '</td><td class="ref">' + esc(c.ref || '') + '</td></tr>'; });
  h += '</tbody></table></div></div>';
  const P = $('#p-tests'); P.innerHTML = h; bindTestLinks(P);
  $$('select[data-sel]', P).forEach(x => x.onchange = () => { state.inputs.selections[x.dataset.sel] = +x.value; run(); });
  $$('select[data-ext]', P).forEach(x => x.onchange = () => { state.inputs.selections.external = state.inputs.selections.external || {}; state.inputs.selections.external[x.dataset.ext] = x.value === '' ? null : x.value === '1'; run(); });
}

// ---------- notes tab
function renderNotes() {
  const r = state.result, s = deal(); let h = '';
  h += '<div class="sec"><h2>Rated notes on this Payment Date</h2><p class="lead">Interest accrues ' + esc(s.meta.dayCount || 'Actual/360') + ' on principal plus capitalised deferred interest, at ' + esc(s.meta.index || 'the index') + ' of ' + pct(r.libor, 2) + ' plus each class\'s spread.</p><div class="scroll"><table><thead><tr><th>Class</th><th>Rating</th><th class="num">Coupon</th><th class="num">Principal b/f</th><th class="num">Deferred b/f</th><th class="num">Interest due</th><th class="num">Interest paid</th><th class="num">Principal paid</th><th class="num">Principal c/f</th><th class="num">Deferred c/f</th></tr></thead><tbody>';
  s.classes.forEach(c => { const n = r.notes[c.id]; h += '<tr><td><b>' + esc(c.id) + '</b><div class="small">' + esc(c.name) + '</div></td><td>' + esc(c.rating || '') + '</td><td class="num">' + pct(n.rate, 3) + '</td><td class="num">' + usd(n.bal0) + '</td><td class="num">' + usdz(n.def0) + '</td><td class="num">' + usd(n.intDue + n.def0) + '</td><td class="num">' + usd(n.intPaid + n.defPaid) + '</td><td class="num">' + usdz(n.prinPaid + n.defPaidCure) + '</td><td class="num">' + usd(n.balEnd) + '</td><td class="num"' + (n.defEnd > 0.5 ? ' style="color:var(--divert);font-weight:600"' : '') + '>' + usdz(n.defEnd) + '</td></tr>'; });
  h += '</tbody></table></div><p class="small" style="margin-top:8px">Interest due includes deferred interest brought forward on deferrable classes. Shortfalls on deferrable classes are capitalised; shortfalls on the senior classes are flagged as potential Events of Default.</p></div>';
  const inc = s.fees.incentive; const hurdleLeft = inc ? Math.max(0, E.hurdleAmount(s, state.inputs.subHistory || [], r.paymentDate, r.ctx.subPaidToday)) : 0;
  h += '<div class="two"><div class="sec"><h2>' + esc(s.equity.name) + '</h2><div class="box"><dl class="kv">' +
    '<dt>Paid this Payment Date</dt><dd><b>' + mm(r.ctx.subPaidToday) + '</b></dd>' +
    '<dt>Cumulative since closing</dt><dd>' + mm(r.equityCum) + ' on ' + mm(s.equity.balance) + ' issued</dd>' +
    '<dt>IRR to date</dt><dd>' + (r.equityIRR == null ? 'not meaningful yet' : pct(r.equityIRR * 100, 2)) + (inc ? ' (Actual/' + (inc.dayBasis || 360) + ')' : '') + '</dd>' +
    (inc ? '<dt>Still needed for ' + inc.hurdleIRR + '% hurdle</dt><dd>' + (hurdleLeft > 0.5 ? mm(hurdleLeft) + ' as of today' : 'Hurdle met; residual splits ' + (100 - inc.managerShare) + '/' + inc.managerShare) + '</dd>' : '') +
    '</dl></div></div>';
  const d = r.dues;
  h += '<div class="sec"><h2>Collateral manager</h2><div class="box"><dl class="kv">' +
    '<dt>Fee Basis Amount</dt><dd>' + mm(r.feeBasis) + '</dd>' +
    '<dt>Senior fees due</dt><dd>' + mm(d.seniorMgmt + d.structuring) + ' (management ' + mm(d.seniorMgmt) + ', structuring ' + mm(d.structuring) + ')</dd>' +
    '<dt>Subordinated fee due</dt><dd>' + mm(d.subMgmtCurrent + d.subMgmtPrior) + '</dd>' +
    '<dt>Incentive fee this date</dt><dd>' + mm(r.ctx.cmIncentive) + '</dd>' +
    '<dt>Deferred by election</dt><dd>' + mm(r.ctx.currentDeferred) + '; cumulative carried ' + mm(r.ctx.cumDeferredFeeEnd) + '</dd>' +
    '<dt>Unpaid, carried forward</dt><dd>senior ' + mm(r.ctx.seniorFeesUnpaid) + ', subordinated ' + mm(r.ctx.subFeeUnpaid) + '</dd>' +
    '</dl></div></div></div>';
  const sched = E.schedule(s); const i = sched.findIndex(x => x.date === r.paymentDate); const next = sched[i + 1];
  h += '<div class="sec"><h2>Roll forward</h2><p class="lead">Carry this date\'s ending balances, deferred interest, unpaid fees, admin cap usage and equity distributions into the next Payment Date. The loan tape is not aged: upload a new tape or adjust Principal Proceeds for the next period.</p>' +
    (next && r.mode !== 'liquidation' ? '<button class="btn primary" type="button" id="rollBtn">Roll to ' + longDate(next.date) + '</button>' : '<p class="small">No later Payment Date to roll into.</p>') +
    (state.hist.length ? ' <button class="btn" type="button" id="rollBack">Back to ' + longDate(state.hist[state.hist.length - 1].inputs.paymentDate) + '</button>' : '') + '</div>';
  const P = $('#p-notes'); P.innerHTML = h;
  const rb = $('#rollBtn', P); if (rb) rb.onclick = () => rollForward(next.date);
  const bb = $('#rollBack', P); if (bb) bb.onclick = () => { const prev = state.hist.pop(); state.inputs = prev.inputs; renderRail(); run(); toast('Back to ' + longDate(state.inputs.paymentDate)); };
}
function rollForward(nextDate) {
  const r = state.result, s = deal(); state.hist.push({ inputs: clone(state.inputs) });
  const I = clone(state.inputs);
  s.classes.forEach(c => { I.notes[c.id] = { bal: Math.max(0, Math.round(r.notes[c.id].balEnd * 100) / 100), def: Math.round(r.notes[c.id].defEnd * 100) / 100 }; });
  const bPaid = r.ctx.adminCapPaid || 0;
  I.adminPaidPrior = Math.round((+I.adminPaidPrior || 0) * 2 / 3 + bPaid);
  I.unpaidSeniorFees = Math.round(r.ctx.seniorFeesUnpaid); I.unpaidSubFee = Math.round(r.ctx.subFeeUnpaid); I.cumDeferredFee = Math.round(r.ctx.cumDeferredFeeEnd);
  I.subFeeDeferElect = 0; I.recoupCumDeferred = 0; I.interestProceeds = null; I.specialRedemption = 0;
  I.subHistory = (I.subHistory || []).filter(x => x.date !== r.paymentDate).concat(r.ctx.subPaidToday > 0.5 ? [{ date: r.paymentDate, amount: Math.round(r.ctx.subPaidToday) }] : []);
  I.paymentDate = nextDate; state.inputs = I; renderRail(); run();
  toast('Rolled to ' + longDate(nextDate) + '. Admin cap usage approximated from the prior total.');
}

// ---------- portfolio tab
const TAPE_COLS = ['id', 'obligor', 'mIndustry', 'spIndustry', 'country', 'assetType', 'rateType', 'par', 'price', 'purchasePrice', 'spread', 'coupon', 'moodysDPR', 'moodysFacility', 'spRating', 'spRecRating', 'maturity', 'defaulted', 'defaultDate', 'covLite', 'facilitySize', 'payFreq', 'dip', 'currentPay', 'pik', 'revolver', 'participation', 'synthetic', 'zeroCoupon', 'discountCured'];
function renderPortfolio() {
  const r = state.result; const rows = r.pf.rows; const q = r.qm;
  const def = rows.filter(x => x.defaulted), ccc = rows.filter(x => x.ccc), disc = rows.filter(x => x.discount);
  let h = '<div class="kpis">' +
    [['Par', mm(r.pb.parTotal)], ['Positions', rows.length], ['Obligors', q.nObligors], ['WARF', q.warf.toLocaleString('en-US')], ['Weighted avg spread', pct(q.wasRaw, 2)], ['Diversity', q.ds.toFixed(1)], ['Defaulted', mm(sum(def, x => x.par))], ['Caa1 / CCC+ and below', mm(sum(ccc, x => x.par))], ['Discount obligations', mm(sum(disc, x => x.par))], ['Estimated interest', mm(r.estInterest)]]
      .map(([a, b]) => '<div><b>' + esc(b) + '</b><span>' + esc(a) + '</span></div>').join('') + '</div>';
  h += '<div class="toolbar"><span class="src">' + esc(state.tapeSource) + '</span>' +
    '<label class="btn small" for="tapeFile">Upload tape CSV</label><input type="file" id="tapeFile" accept=".csv,text/csv" hidden>' +
    (state.caps.downloads ? '<button class="btn small" type="button" id="dlTape">Download tape CSV</button><button class="btn small" type="button" id="dlTemplate">Blank template</button>' : '') + '</div>';
  h += '<p class="hint">Columns are matched by name (par, price, spread, moodysDPR, spRating, maturity, defaulted, covLite and so on). Missing optional columns default to "no". ' + (state.stress.extraDefaultPct || state.stress.notches || state.stress.priceShock ? '<b>The table shows the tape after your stress overlay.</b>' : '') + '</p>';
  h += '<div class="scroll" style="max-height:560px"><table class="tape"><thead><tr><th>ID</th><th>Obligor</th><th>Industry</th><th>Type</th><th class="num">Par</th><th class="num">Price</th><th class="num">Spread</th><th>Moody\'s DPR / facility</th><th>S&amp;P</th><th>Rec.</th><th>Maturity</th><th>Flags</th><th class="num">OC balance</th><th>OC treatment</th></tr></thead><tbody>';
  rows.slice().sort((a, b) => (b.defaulted - a.defaulted) || ((b.cccAlloc || 0) - (a.cccAlloc || 0)) || (b.discount - a.discount) || (b.par - a.par)).forEach(x => {
    const flags = (x.defaulted ? '<span class="flag def">DEF</span>' : '') + (x.ccc ? '<span class="flag ccc">CCC</span>' : '') + (x.discount ? '<span class="flag dsc">DISC</span>' : '') + (x.covLite ? '<span class="flag cl">CL</span>' : '');
    h += '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.obligor) + '</td><td>' + esc(x.mIndustry) + '</td><td>' + esc(x.assetType) + (x.rateType === 'FIXED' ? ' fixed' : '') + '</td><td class="num">' + usd(x.par) + '</td><td class="num">' + (+x.price).toFixed(2) + '</td><td class="num">' + (x.rateType === 'FIXED' ? pct(x.coupon, 2) + ' cpn' : pct(x.spread, 3)) + '</td><td>' + esc(x.moodysDPR) + ' / ' + esc(x.moodysFacility) + '</td><td>' + esc(x.spRating) + '</td><td>' + esc(x.spRecUsed) + '</td><td>' + esc(x.maturity) + '</td><td>' + flags + '</td><td class="num">' + usd(x.ocPB) + '</td><td class="small">' + esc(x.ocReason || 'Par') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  const P = $('#p-portfolio'); P.innerHTML = h;
  $('#tapeFile', P).onchange = e => { const f = e.target.files[0]; if (f) readTapeFile(f); };
  const d1 = $('#dlTape', P); if (d1) d1.onclick = () => saveFile('loan-tape.csv', toCSV(state.tape, TAPE_COLS));
  const d2 = $('#dlTemplate', P); if (d2) d2.onclick = () => saveFile('loan-tape-template.csv', TAPE_COLS.join(',') + '\nL001,Example Holdings,Healthcare Education & Childcare,Healthcare Education & Childcare,US,SSL,FLOAT,2500000,98.5,99.75,2.75,0,B2,B1,B,3,2014-06-15,N,,N,450000000,Q,N,N,N,N,N,N,N,N\n');
}
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const ALIASES = { id: ['id', 'loanid', 'assetid', 'lxid', 'cusip', 'figi'], obligor: ['obligor', 'issuer', 'borrower', 'obligorname', 'issuername', 'name'], mIndustry: ['mindustry', 'moodysindustry', 'industry'], spIndustry: ['spindustry', 'sandpindustry', 'spindustryclassification'], country: ['country', 'domicile', 'countryofdomicile'], assetType: ['assettype', 'type', 'lien', 'seniority', 'facilitytype'], rateType: ['ratetype', 'fixedfloat', 'coupontype'], par: ['par', 'parvalue', 'paramount', 'principal', 'principalbalance', 'balance', 'outstanding', 'currentpar', 'quantity'], price: ['price', 'marketprice', 'mark', 'mv', 'marketvalue', 'bidprice'], purchasePrice: ['purchaseprice', 'cost', 'costprice', 'purchasepx'], spread: ['spread', 'margin', 'floatingspread'], coupon: ['coupon', 'fixedcoupon', 'rate'], moodysDPR: ['moodysdpr', 'dpr', 'moodysdefaultprobabilityrating', 'moodyscfr', 'cfr', 'moodys', 'moodysrating'], moodysFacility: ['moodysfacility', 'moodysfacilityrating', 'moodysissuerating', 'facilityrating'], spRating: ['sprating', 'sandprating', 'snp', 'sp', 'spissuerrating'], spRecRating: ['sprecrating', 'sprecoveryrating', 'recoveryrating'], maturity: ['maturity', 'maturitydate', 'finalmaturity'], defaulted: ['defaulted', 'default', 'isdefaulted', 'defaultflag'], defaultDate: ['defaultdate'], covLite: ['covlite', 'covenantlite'], facilitySize: ['facilitysize', 'tranchesize', 'dealsize', 'issuesize'], payFreq: ['payfreq', 'paymentfrequency', 'frequency'], dip: ['dip'], currentPay: ['currentpay'], pik: ['pik'], revolver: ['revolver', 'ddtl', 'delayeddraw'], participation: ['participation'], synthetic: ['synthetic'], zeroCoupon: ['zerocoupon'], discountCured: ['discountcured'] };
function readTapeFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    const rows = parseCSV(String(fr.result)); if (rows.length < 2) { toast('That file has no data rows.'); return; }
    const head = rows[0].map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const map = {}; Object.entries(ALIASES).forEach(([k, al]) => { const i = head.findIndex(h => h === k.toLowerCase() || al.includes(h)); if (i >= 0) map[k] = i; });
    if (map.par == null) { toast('No par column found. Name it "par", "principal" or "balance".'); return; }
    const tape = rows.slice(1).map((r, i) => { const o = {}; Object.entries(map).forEach(([k, j]) => { o[k] = r[j]; }); if (!o.id) o.id = 'R' + (i + 1); return o; }).filter(o => parseAmt(o.par) > 0).map(o => Object.assign(o, { par: parseAmt(o.par) }));
    state.tape = tape; state.stress = { extraDefaultPct: 0, notches: 0, priceShock: 0, defaultPrice: 45 };
    const missing = ['price', 'spread', 'moodysDPR', 'spRating', 'maturity'].filter(k => map[k] == null);
    state.tapeSource = 'Uploaded ' + file.name + ': ' + tape.length + ' positions, ' + Object.keys(map).length + ' columns recognised' + (missing.length ? '; missing ' + missing.join(', ') + ' (defaults used)' : '');
    renderRail(); run(); toast('Loaded ' + tape.length + ' positions from ' + file.name);
  };
  fr.readAsText(file);
}
function toCSV(rows, cols) { const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return cols.join(',') + '\n' + rows.map(r => cols.map(c => q(r[c])).join(',')).join('\n') + '\n'; }
async function saveFile(name, data) {
  const dl = state.caps.downloads; if (!dl) return;
  try { await dl.save({ filename: name, data }); toast('Saved ' + name); }
  catch (e) { if (e && e.code !== 'declined') toast('Could not save the file (' + (e.code || 'error') + ').'); }
}
function downloadLedger() {
  const r = state.result; const out = [];
  Object.entries(r.waterfalls).forEach(([k, rows]) => rows.forEach(x => out.push({ waterfall: k, step: x.id, label: x.label, due: x.due.toFixed(2), paid: x.paid.toFixed(2), shortfall: Math.max(0, x.due - x.paid).toFixed(2), cash_left: x.after.toFixed(2), note: x.skipped ? 'Skipped: ' + x.skipped : (x.note || ''), payees: x.payees.filter(p => p.amount > 0.005).map(p => p.to + ' ' + p.amount.toFixed(2)).join('; ') })));
  saveFile('waterfall-' + r.paymentDate + '.csv', toCSV(out, ['waterfall', 'step', 'label', 'due', 'paid', 'shortfall', 'cash_left', 'note', 'payees']));
}

// ---------- rules tab (the interpreted indenture) + interpreter
function cfgOf(st) { const o = Object.assign({}, st); delete o.label; delete o.clause; delete o.ref; delete o.id; return JSON.stringify(o).replace(/","/g, '", "').replace(/,"/g, ', "'); }
function renderRules() {
  const s = deal(); let h = '';
  const safe = (title, f) => { try { return f(); } catch (e) { return '<div class="sec"><h2>' + esc(title) + '</h2><div class="notice err">This part of the deal spec could not be displayed: ' + esc(E.plainError(e)) + '. You can fix it in the Deal spec at the bottom of this tab.</div></div>'; } };
  h += '<div class="box interp" id="interpBox">' + interpHTML() + '</div>';
  const m = s.meta;
  h += safe('Deal terms', () => '<div class="sec" style="margin-top:22px"><h2>Deal terms</h2><div class="box"><dl class="kv">' +
    [['Closing Date', m.closingDate], ['First Payment Date', m.firstPaymentDate + ', then every ' + (m.paymentFrequencyMonths || 3) + ' months'], ['Reinvestment Period ends', m.reinvestmentPeriodEnd], ['Non-call period ends', m.nonCallEnd || '—'], ['Effective Date', (m.effectiveDate || '—') + (m.effectiveDateNote ? ' (' + m.effectiveDateNote + ')' : '')], ['Stated Maturity', m.statedMaturity], ['Target Par', mm(m.targetPar || 0)], ['Interest basis', (m.index || '') + ', ' + (m.dayCount || '')]]
      .map(([a, b]) => '<dt>' + esc(a) + '</dt><dd>' + esc(b) + '</dd>').join('') + '</dl></div></div>');
  h += safe('Capital structure', () => '<div class="sec"><h2>Capital structure</h2><div class="scroll"><table><thead><tr><th>Class</th><th>Name</th><th class="num">Original balance</th><th class="num">Spread</th><th>Deferrable</th><th>Rating</th><th>Source</th></tr></thead><tbody>' +
    s.classes.map(c => '<tr><td><b>' + esc(c.id) + '</b></td><td>' + esc(c.name) + '</td><td class="num">' + usd(c.balance) + '</td><td class="num">' + pct(c.spread) + '</td><td>' + (c.deferrable ? 'Yes' : 'No') + '</td><td>' + esc(c.rating || '') + '</td><td class="ref">' + esc(c.ref || '') + '</td></tr>').join('') +
    '<tr><td><b>' + esc(s.equity.id) + '</b></td><td>' + esc(s.equity.name) + '</td><td class="num">' + usd(s.equity.balance) + '</td><td class="num">residual</td><td>—</td><td>Unrated</td><td class="ref">' + esc(s.equity.ref || '') + '</td></tr></tbody></table></div></div>');
  h += safe('Coverage tests and diversion triggers', () => '<div class="sec"><h2>Coverage tests and diversion triggers</h2>' + s.coverage.tests.map(t => '<div class="rule"><div class="id">' + esc(t.id) + '</div><div class="txt"><b>' + esc(t.label) + '</b>OC: Principal Collateral Value over the principal of ' + esc(t.oc.classes.join(', ')) + ', at least ' + pct(t.oc.trigger) + '.' + (t.ic ? ' IC: interest proceeds net of senior items over interest due on ' + esc(t.ic.classes.join(', ')) + ', at least ' + pct(t.ic.trigger) + (t.ic.fromPeriod > 1 ? ' from Payment Date ' + t.ic.fromPeriod : '') + '.' : '') + ' <span class="ref">' + esc([t.oc.ref, t.ic && t.ic.ref].filter(Boolean).join('; ')) + '</span></div><div class="cfg">' + esc(JSON.stringify({ oc: t.oc.trigger, ic: t.ic ? t.ic.trigger : null })) + '</div></div>').join('') +
    (s.coverage.reinvestmentTest ? '<div class="rule"><div class="id">IRT</div><div class="txt"><b>' + esc(s.coverage.reinvestmentTest.label) + '</b>OC over all rated notes of at least ' + pct(s.coverage.reinvestmentTest.trigger) + '; otherwise up to ' + s.coverage.reinvestmentTest.maxDiversionPct + '% of remaining interest is diverted to buy collateral. <span class="ref">' + esc(s.coverage.reinvestmentTest.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify({ trigger: s.coverage.reinvestmentTest.trigger, maxDiversionPct: s.coverage.reinvestmentTest.maxDiversionPct })) + '</div></div>' : '') +
    (s.coverage.eodTest ? '<div class="rule"><div class="id">EoD</div><div class="txt"><b>' + esc(s.coverage.eodTest.label) + '</b>Falling below ' + pct(s.coverage.eodTest.trigger, 0) + ' after the Effective Date is an Event of Default. <span class="ref">' + esc(s.coverage.eodTest.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify({ trigger: s.coverage.eodTest.trigger })) + '</div></div>' : '') + '</div>');
  const hc = s.haircuts;
  h += safe('Collateral haircuts in the OC numerator', () => '<div class="sec"><h2>Collateral haircuts in the OC numerator</h2>' +
    '<div class="rule"><div class="id">CCC</div><div class="txt"><b>CCC Excess</b>Par rated ' + esc(hc.ccc.moodysAtOrBelow) + ' or ' + esc(hc.ccc.spAtOrBelow) + ' and below, above ' + hc.ccc.limitPct + '% of the collateral, carried at the lesser of ' + hc.ccc.haircutPct + '% of par and market value, lowest-priced first. <span class="ref">' + esc(hc.ccc.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify(hc.ccc)) + '</div></div>' +
    '<div class="rule"><div class="id">Def.</div><div class="txt"><b>Defaulted Securities</b>Carried at the lesser of market value and recovery value; zero after ' + hc.defaulted.zeroAfterYears + ' years in default. <span class="ref">' + esc(hc.defaulted.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify(hc.defaulted)) + '</div></div>' +
    '<div class="rule"><div class="id">Disc.</div><div class="txt"><b>Discount Obligations</b>Loans bought below ' + hc.discount.loan.atLeastB3 + ' (' + hc.discount.loan.belowB3 + ' if rated below B3) are carried at purchase price until they recover. <span class="ref">' + esc(hc.discount.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify(hc.discount)) + '</div></div></div>');
  const F = s.fees;
  h += safe('Fees', () => '<div class="sec"><h2>Fees</h2>' + Object.entries(F).filter(([k, f]) => f && typeof f === 'object').map(([k, f]) => {
    const txt = k === 'adminCap' ? 'Capped Administrative Expenses: ' + (f.bpsOfPCV / 100).toFixed(3) + '% of Principal Collateral Value plus ' + mm(f.fixed) + ' across this and the ' + f.priorPeriods + ' prior Payment Dates.'
      : k === 'incentive' ? 'Incentive fee of ' + f.managerShare + '% of residual once the Subordinated Notes reach a ' + f.hurdleIRR + '% IRR (Actual/' + (f.dayBasis || 360) + ').'
      : Array.isArray(f.schedule) ? esc(f.label || k) + ': ' + f.schedule.map(x => x.bps + ' bps' + (x.through ? ' through ' + x.through : ' thereafter')).join(', ') + ' a year on the Fee Basis Amount.'
      : esc(f.label || k) + ': ' + f.bps + ' bps a year' + (f.unpaidAccruesAtClass ? '; unpaid amounts accrue at the Class ' + f.unpaidAccruesAtClass + ' rate' : '') + '.';
    return '<div class="rule"><div class="id">' + esc({ seniorMgmt: 'Sr.', structuring: 'Str.', subMgmt: 'Sub.', adminCap: 'Cap', incentive: 'Inc.' }[k] || k) + '</div><div class="txt">' + txt + ' <span class="ref">' + esc(f.ref || '') + '</span></div><div class="cfg">' + esc(JSON.stringify(f)) + '</div></div>';
  }).join('') + '</div>');
  ['interest', 'principal', 'liquidation'].forEach(k => {
    const L = s.waterfalls[k]; if (!L || !L.length) return;
    h += safe(({ interest: 'Priority of Interest Payments', principal: 'Priority of Principal Payments', liquidation: 'Liquidation Priority of Payments' }[k]), () => '<div class="sec"><h2>' + ({ interest: 'Priority of Interest Payments', principal: 'Priority of Principal Payments', liquidation: 'Liquidation Priority of Payments' }[k]) + '</h2>' +
      L.map(st => '<div class="rule"><div class="id">' + esc(st.id) + '</div><div class="txt"><b>' + esc(st.label) + '</b>' + esc(st.clause || '') + ' <span class="ref">' + esc([st.section, st.ref].filter(Boolean).join(' \u00b7 ')) + '</span>' + docwHTML(k, st.id) + (E.KNOWN_TYPES.includes(st.type) ? '' : '<div class="nt f" style="font-family:var(--sans);font-size:12.5px;color:var(--fail)">The engine cannot execute this step type; it is skipped.</div>') + '</div><div class="cfg">' + esc(cfgOf(st)) + '</div></div>').join('') + '</div>');
  });
  h += '<div class="sec"><h2>Interpretation assumptions</h2><ol class="assump">' + (s.assumptions || []).map(a => '<li>' + esc(a) + '</li>').join('') + '</ol></div>';
  h += '<div class="sec"><h2>Deal spec</h2><p class="lead">The full machine-readable interpretation. Edit and apply to change any rule; the engine validates it first.</p><details><summary class="linkbtn">Show and edit the JSON</summary><textarea id="specText" rows="18" spellcheck="false" style="font:12px/1.45 var(--mono);margin-top:10px">' + esc(JSON.stringify(s, null, 1)) + '</textarea><div class="toolbar" style="margin-top:8px"><button class="btn" type="button" id="specApply">Apply edits as a new deal</button>' + (state.caps.downloads ? '<button class="btn" type="button" id="specDl">Download JSON</button>' : '') + '<span class="src" id="specMsg"></span></div></details></div>';
  const P = $('#p-rules'); P.innerHTML = h;
  bindInterp();
  $('#specApply', P).onclick = () => {
    let spec; try { spec = JSON.parse($('#specText').value); } catch (e) { $('#specMsg').textContent = 'Not valid JSON: ' + e.message; return; }
    fillDefaults(spec); const v = E.validateSpec(spec);
    if (v.errs.length) { $('#specMsg').textContent = v.errs.slice(0, 3).join('; '); return; }
    const id = 'edit-' + Date.now().toString(36); if (state.docWords[state.dealId]) { state.docWords[id] = state.docWords[state.dealId]; saveDocWords(); } spec.meta.name = spec.meta.name.replace(/ \(edited\)$/, '') + ' (edited)';
    state.saved[id] = spec; saveDeals(); loadDeal(id); toast('Loaded your edited spec' + (v.warns.length ? ' with ' + v.warns.length + ' warning(s)' : ''));
  };
  const sd = $('#specDl', P); if (sd) sd.onclick = () => saveFile((deal().meta.name || 'deal').replace(/[^\w]+/g, '-').toLowerCase() + '-spec.json', JSON.stringify(deal(), null, 2));
}

/*@include teach_ui.js*/
// ---- interpreter
function interpHTML() {
  const I = state.interp; const can = state.caps.sample;
  let h = '<h3>Interpret another indenture</h3><p class="hint" style="font-size:13px">Drop in an indenture or offering memorandum. The page reads the deal terms straight from the document\'s text, here in your browser and without Claude: the notes, dates, fees, coverage triggers, every clause of the Priority of Payments, quality test limits and concentration limits, each with its page. Review what it read before loading it. Where it missed something, use <b>Teach the reader</b> below the list: it remembers the lesson for every later document. Asking Claude is optional, to fill what the rules could not read.</p>';
  h += '<div class="drop" id="drop"><p style="margin:0 0 8px">Drop a PDF, or an HTML filing saved from SEC EDGAR, here, or</p><label class="btn small" for="pdfFile">Choose file</label><input type="file" id="pdfFile" accept="application/pdf,.pdf,.htm,.html,text/html,.txt,text/plain" hidden> <button class="btn small" type="button" id="pasteToggle">Paste text instead</button> <button class="btn small" type="button" id="trySample">Try the sample indenture</button></div>';
  h += '<div id="pasteBox" hidden style="margin-top:10px"><textarea id="pasteText" rows="6" placeholder="Paste the notes table, Priority of Payments and the coverage test, fee and quality test definitions"></textarea><button class="btn small" type="button" id="pasteUse" style="margin-top:6px">Use this text</button></div>';
  if (I.status) h += '<p class="small" style="margin:10px 0 0" id="interpStatus">' + esc(I.status) + '</p>';
  if (I.excerpts) {
    h += '<p class="small" style="margin:10px 0 2px">' + esc(I.fileName) + ': ' + I.pages.length + ' pages. Sections found:</p><div class="excerpts">' + I.excerpts.map(x => '<span class="tag">' + esc(x.label) + ', p. ' + (x.from + 1) + (x.to > x.from ? '–' + (x.to + 1) : '') + '</span>').join('') + '</div>';
    if (!I.excerpts.some(x => /Priority/.test(x.label))) h += '<div class="notice warn">No Priority of Payments section was found, so the waterfalls could not be read.' + (can ? ' Claude can still search the document.' : '') + '</div>';
    if (!I.spec && can) h += '<div class="toolbar"><button class="btn primary" type="button" id="interpGo"' + (I.busy ? ' disabled' : '') + '>' + (I.busy ? 'Interpreting…' : 'Interpret with Claude') + '</button>' + (I.busy ? '<button class="btn" type="button" id="interpStop">Stop</button>' : '') + '<span class="src">Runs on your Claude usage; usually one to three minutes.</span></div>';
  }
  if (I.log.length) h += '<div class="log" id="interpLog">' + esc(I.log.join('\n')) + '</div>';
  if (I.spec) {
    const v = I.check; const S = I.spec; const W = S.waterfalls || {};
    const nUns = [].concat(W.interest || [], W.principal || [], W.liquidation || []).filter(st => !E.KNOWN_TYPES.includes(st.type)).length;
    h += '<div style="margin-top:12px"><b>' + esc(S.meta && S.meta.name || 'Interpreted deal') + '</b>' + (I.how === 'rules' ? ' <span class="tag ok" style="margin-left:6px">read by text rules, no Claude</span>' + ((I.used || []).length ? ' <span class="tag ok">' + I.used.length + ' lesson' + (I.used.length > 1 ? 's' : '') + ' applied</span>' : '') : ' <span class="tag" style="margin-left:6px">interpreted by Claude</span>') + '<p class="small" style="margin:4px 0 0">' + (S.classes || []).length + ' rated classes, ' + (W.interest || []).length + ' interest, ' + (W.principal || []).length + ' principal and ' + (W.liquidation || []).length + ' post-acceleration clauses' + (nUns ? ' (' + nUns + ' not modelled)' : '') + ', ' + ((S.coverage || {}).tests || []).length + ' coverage tests, ' + (S.qualityTests || []).length + ' quality tests, ' + (S.concentrations || []).length + ' concentration limits.</p>';
    if (I.found && I.found.length) {
      const order = ['Notes', 'Dates', 'Fees', 'Coverage tests', 'Waterfall', 'Haircuts', 'Quality tests', 'Concentration limits'];
      const gaps = I.found.filter(f => !RR_DONE.includes(f.how)).length;
      const STL = { found: 'Found', taught: 'Taught', entered: 'Entered by you', missing: 'Not found', estimated: 'Estimated', default: 'Standard value' };
      const tlink = f => { if (!f.teach || RR_DONE.includes(f.how) && f.how === 'found') return ''; const lab = RR_DONE.includes(f.how) ? 'Change' : 'Teach'; return ' <button class="linkbtn tl" type="button" ' + (f.teach === 'clause' ? 'data-tclause="' + esc(f.k + '|' + f.cid) + '"' : f.teach === 'concItem' ? 'data-tconc="' + esc(f.cid) + '"' : 'data-tfield="' + esc(f.teach) + '"') + ' aria-label="' + lab + ': ' + esc(f.field) + '">' + lab + '</button>'; };
      h += '<details class="readlist" id="readList"' + (I.readOpen != null ? (I.readOpen ? ' open' : '') : gaps ? ' open' : '') + '><summary>What was read, with pages' + (gaps ? ' <span class="tag warn" style="margin-left:6px">' + gaps + ' to check or enter</span>' : '') + '</summary><div class="scroll" style="margin-top:8px"><table><thead><tr><th>Item</th><th>Value</th><th>Page</th><th>Status</th></tr></thead><tbody>' +
        order.filter(g => I.found.some(f => f.group === g)).map(g => '<tr class="grp"><td colspan="4"><b>' + esc(g) + '</b></td></tr>' + I.found.filter(f => f.group === g).map(f => '<tr' + (!RR_DONE.includes(f.how) ? ' class="gap"' : '') + '><td>' + esc(f.field) + '</td><td' + (f.snippet ? ' title="' + esc(f.snippet) + '"' : '') + '>' + esc(f.value) + '</td><td class="ref">' + (f.page ? esc(I.unit + ' ' + f.page) : '—') + '</td><td class="stc"><span class="res ' + (RR_DONE.includes(f.how) ? 'pass' : f.how === 'missing' ? 'fail' : 'na') + '">' + esc(STL[f.how] || f.how) + '</span>' + tlink(f) + '</td></tr>').join('')).join('') +
        '</tbody></table></div><p class="small" style="margin-top:6px">Hover a value to see the text it came from. Use <b>Teach</b> to show the reader where a value is; it will look there first on later documents too.</p></details>';
      if (I.how === 'rules' && I.items) h += teachHTML();
    }
    if (v.errs.length || v.warns.length) h += '<ul class="errs">' + v.errs.map(e => '<li class="e">' + esc(e) + '</li>').join('') + v.warns.map(e => '<li class="w">' + esc(e) + '</li>').join('') + '</ul>';
    if ((S.assumptions || []).length > 1) h += '<details class="readlist"><summary>' + (S.assumptions.length) + ' assumptions and clauses not modelled</summary><ol class="assump" style="margin-top:8px">' + S.assumptions.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></details>';
    h += '<div class="toolbar" style="margin-top:10px"><button class="btn primary" type="button" id="interpLoad"' + (v.errs.length ? ' disabled' : '') + '>Load into the engine</button>' +
      (can && !I.busy ? '<button class="btn" type="button" id="interpFix">' + (I.how === 'rules' ? 'Ask Claude to fill the gaps' : 'Ask Claude to fix these') + '</button>' : '') + (I.busy ? '<button class="btn" type="button" id="interpStop">Stop</button><span class="src">Claude is working…</span>' : can && I.how === 'rules' ? '<span class="src">Optional. Sends the draft and the relevant pages to Claude, on your usage.</span>' : '') + '</div></div>';
  }
  if (!(I.spec && I.how === 'rules' && I.items && I.found && I.found.length)) h += teachHTML();
  return h;
}
function bindInterp() {
  const B = $('#interpBox'); if (!B) return;
  const drop = $('#drop', B);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readDoc(f); });
  $('#pdfFile', B).onchange = e => { const f = e.target.files[0]; if (f) readDoc(f); };
  $('#pasteToggle', B).onclick = () => { $('#pasteBox', B).hidden = !$('#pasteBox', B).hidden; };
  $('#trySample', B).onclick = () => usePages(htmlToPages(SAMPLE_INDENTURE, false), 'example-clo-indenture.txt (fictional sample)', 'page');
  $('#pasteUse', B).onclick = () => { const t = $('#pasteText', B).value.trim(); if (t.length < 500) { toast('Paste more of the document: at least the Priority of Payments and test definitions.'); return; } usePages(splitPasted(t), 'Pasted text', 'part'); };
  const go = $('#interpGo', B); if (go) go.onclick = () => interpret();
  const stop = $('#interpStop', B); if (stop) stop.onclick = () => { if (state.interp.ctl) state.interp.ctl.abort(); };
  const ld = $('#interpLoad', B); if (ld) ld.onclick = () => { const id = 'deal-' + Date.now().toString(36); state.saved[id] = state.interp.spec; saveDeals(); if (state.interp.docWords) { state.docWords[id] = state.interp.docWords; saveDocWords(); } state.tab = 'waterfall'; selectTab('waterfall'); loadDeal(id); toast('Loaded ' + state.interp.spec.meta.name); };
  const fx = $('#interpFix', B); if (fx) fx.onclick = () => interpret(true);
  const rl = $('#readList', B); if (rl) rl.addEventListener('toggle', () => { state.interp.readOpen = rl.open; });
  $$('.tl', B).forEach(b => b.onclick = () => openTeach(b.dataset.tclause ? { pane: 'clause', clause: b.dataset.tclause, phraseFor: null } : b.dataset.tconc ? { pane: 'conc', conc: b.dataset.tconc, kphraseFor: null } : { pane: 'value', field: b.dataset.tfield }));
  bindTeach();
}
function rerenderInterp() { const B = $('#interpBox'); if (B) { B.innerHTML = interpHTML(); bindInterp(); const lg = $('#interpLog'); if (lg) lg.scrollTop = lg.scrollHeight; } }
function logI(msg) { state.interp.log.push(msg); const lg = $('#interpLog'); if (lg) { lg.textContent = state.interp.log.join('\n'); lg.scrollTop = lg.scrollHeight; } else rerenderInterp(); }
function splitPasted(t) { const parts = t.split('\f'); if (parts.length > 1) return parts; const out = []; for (let i = 0; i < t.length; i += 3200) out.push(t.slice(i, i + 3200)); return out; }
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
const isTextDoc = f => /\.(html?|txt)$/i.test(f.name) || /^text\/(html|plain)/.test(f.type);
function readDoc(file) { return isTextDoc(file) ? readHtmlDoc(file) : readPdf(file); }
/*@include docpages.js*/
async function readHtmlDoc(file) {
  const I = state.interp; I.status = 'Reading ' + file.name + '…'; I.excerpts = null; I.spec = null; I.log = []; rerenderInterp();
  try {
    const raw = await file.text();
    const pages = htmlToPages(raw, /\.html?$/i.test(file.name) || /html/.test(file.type) || /<html|<body|<p[\s>]/i.test(raw.slice(0, 5000)));
    if (pages.join('').length < 20000) { I.status = 'That file has too little text to be an indenture or offering memorandum.'; rerenderInterp(); return; }
    usePages(pages, file.name, 'page');
  } catch (e) { I.status = 'Could not read the file: ' + e.message + '.'; rerenderInterp(); }
}
async function readPdf(file) {
  const I = state.interp; I.status = 'Loading the PDF reader…'; I.excerpts = null; I.spec = null; I.log = []; rerenderInterp();
  try {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pg = await pdf.getPage(p); const tc = await pg.getTextContent();
      pages.push(tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' '));
      if (p % 10 === 0) { I.status = 'Reading page ' + p + ' of ' + pdf.numPages + '…'; const st = $('#interpStatus'); if (st) st.textContent = I.status; }
    }
    const chars = sum(pages, x => x.length);
    if (chars < pdf.numPages * 200) { I.status = 'This PDF has little extractable text (it may be scanned). Paste the text instead.'; rerenderInterp(); return; }
    usePages(pages, file.name, 'PDF p.');
  } catch (e) { I.status = 'Could not read the PDF: ' + e.message + '. Try pasting the text instead.'; rerenderInterp(); }
}
function relabelRefs(o, unit) {
  if (Array.isArray(o)) { o.forEach(x => relabelRefs(x, unit)); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) { if (k === 'ref' && typeof o[k] === 'string') o[k] = o[k].replace(/^(?:PDF )?p\. (\d+)$/, (m, n) => unit + ' ' + n); else relabelRefs(o[k], unit); }
}
// one reading of the loaded document with a set of lessons, completed with standard values where the document gave none
function readOnce(lessons) {
  const I = state.interp; const r = readDealText(I.pages, I.fileName, lessons); const filled = [];
  relabelRefs(r.spec, I.unit); fillDefaults(r.spec, filled);
  // values the document did not give, filled with standard ones: shown as gaps rather than only in the assumptions
  filled.forEach(f => { if (/^CCC/.test(f.field) && r.found.some(x => x.teach === 'ccc')) return; r.found.push({ group: 'Haircuts', field: f.field, value: f.value, page: null, how: 'default', snippet: '', teach: /^CCC/.test(f.field) ? 'ccc' : null }); });
  return r;
}
function readRules() {
  const I = state.interp; I.how = 'rules'; I.found = null;
  try {
    const t0 = performance.now(); const { spec, found, items, used, docKey } = readOnce(getLessons());
    I.spec = spec; I.found = found; I.items = items; I.used = used; I.docKey = docKey; I.check = E.validateSpec(spec);
    if (!I.terms) I.terms = docTerms(I.pages);
    const dm = docMatch(spec); I.docWords = dm.words; I.check.doc = []; I.check.warns = I.check.warns.concat(dm.warns);
    I.log = ['Read the deal terms from the document in ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms, here in your browser, without Claude.'].concat(dm.note ? [dm.note] : []);
  } catch (e) { I.spec = null; I.status = 'The text rules could not read this document (' + e.message + ').' + (state.caps.sample ? ' You can ask Claude instead.' : ''); }
}
function usePages(pages, name, unit) {
  const I = state.interp; I.pages = pages; I.fileName = name; I.unit = unit || 'p.'; I.terms = null; I.teach = null; I.wfLoc = locateWaterfall(pages); I.excerpts = findExcerpts(pages, I.wfLoc); I.status = ''; I.spec = null; I.log = [];
  readRules(); rerenderInterp();
}
/*@include docclauses.js*/
/*@include rulereader.js*/
const PATTERNS = [
  { label: 'Summary of terms', re: /SUMMARY OF TERMS|Summary of Terms|SUMMARY OF PRINCIPAL TERMS/, span: 12, max: 1, firstPages: 60 },
  { label: 'Notes offered', re: /Principal\s+Amount[\s\S]{0,600}Class\s+A/i, span: 2, max: 1, firstPages: 40 },
  { label: 'Priority of Payments', re: /following order of priority|in the following order/i, span: 4, max: 4 },
  { label: 'Coverage test definitions', re: /["\u201c][^"\u201d]{0,40}(Overcollateralization|Over-collateralization|Par Value|Interest Coverage)\s+(Ratio|Test)["\u201d]/i, span: 1, max: 14 },
  { label: 'Diversion test', re: /["\u201c](Interest Reinvestment Test|Reinvestment Overcollateralization Test|Interest Diversion Test|Reinvestment Test)["\u201d]/i, span: 1, max: 2 },
  { label: 'Collateral value and haircuts', re: /["\u201c](Principal Collateral Value|Adjusted Collateral Principal Amount|Adjusted Pool Balance|Collateral Principal Amount|Principal Balance|CCC Excess|Caa Excess|Excess CCC Adjustment Amount|Discount Obligation|Defaulted (Security|Obligation))["\u201d]/i, span: 2, max: 7 },
  { label: 'Fees', re: /["\u201c](Senior (Collateral )?Management Fee|Subordinated (Collateral )?Management Fee|Incentive (Collateral )?Management Fee|Administrative Expense Cap|Senior Deferred Structuring Fee|Fee Basis Amount|Internal Rate of Return|Incentive Management Fee Threshold)["\u201d]/i, span: 1, max: 8 },
  { label: 'Collateral quality tests', re: /["\u201c](Weighted Average Spread Test|Minimum Weighted Average Spread Test|Weighted Average Life Test|Moody's Diversity Test|Diversity Test|Moody's Maximum Weighted Average Rating Factor Test|Maximum Moody's Rating Factor Test|Collateral Quality Matrix|Weighted Average Coupon Test|Moody's Minimum Weighted Average Recovery Rate Test|S&P Minimum Weighted Average Recovery Rate)["\u201d]/i, span: 1, max: 10 },
  { label: 'Concentration limits', re: /(Portfolio Profile Test|Concentration Limitations)[\s\S]{0,1500}\(i\)/i, span: 4, max: 1 },
  { label: 'Events of Default', re: /["\u201c]Event of Default["\u201d] is defined|Events of Default\.|["\u201c]Event of Default["\u201d]/, span: 2, max: 1 }
];
function findExcerpts(pages, loc) {
  const picked = []; const budget = 175000; let used = 0;
  if (loc) { picked.push({ label: 'Priority of Payments (operative text)', from: loc.from, to: loc.to }); used += sum(pages.slice(loc.from, loc.to + 1), x => x.length); }
  for (const p of PATTERNS) {
    if (loc && p.label === 'Priority of Payments') continue;
    let n = 0; const lim = Math.min(pages.length, p.firstPages || pages.length);
    for (let i = 0; i < lim && n < p.max; i++) {
      const txt = pages[i] + (pages[i + 1] ? pages[i + 1].slice(0, 1500) : '');
      if (!p.re.test(txt)) continue;
      const from = i, to = Math.min(pages.length - 1, i + p.span - 1);
      if (picked.some(x => from >= x.from && to <= x.to)) { n++; continue; }
      const size = sum(pages.slice(from, to + 1), x => x.length);
      if (used + size > budget) break;
      picked.push({ label: p.label, from, to }); used += size; n++; i = to;
    }
  }
  picked.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const x of picked) { const last = merged[merged.length - 1]; if (last && x.from <= last.to + 1) { last.to = Math.max(last.to, x.to); if (!last.label.includes(x.label)) last.label = /operative/.test(x.label) ? x.label + ' + ' + last.label : last.label + ' + ' + x.label; } else merged.push(Object.assign({}, x)); }
  return merged;
}
function excerptText() { const I = state.interp; return I.excerpts.map(x => '=== ' + (I.unit === 'PDF p.' ? 'PDF pages ' : I.unit === 'part' ? 'Parts ' : 'Pages ') + (x.from + 1) + '–' + (x.to + 1) + ' (' + x.label + ') ===\n' + I.pages.slice(x.from, x.to + 1).map((t, k) => '[' + I.unit + ' ' + (x.from + k + 1) + ']\n' + t).join('\n')).join('\n\n'); }
function exampleSpec() { const s = clone(DATA.EXAMPLE_CLO); delete s.ratingFactors; delete s.recovery; s.concentrations = s.concentrations.slice(0, 10); s.assumptions = s.assumptions.slice(0, 3); return JSON.stringify(s); }
const SCHEMA_DOC = `Return ONE JSON object (no prose, no code fence) with these keys. Dates are yyyy-mm-dd. Percentages are numbers in percent (111.8 means 111.80%). Money is in dollars.
meta: {name, manager, trustee, document, closingDate, firstPaymentDate, paymentFrequencyMonths, paymentDay, statedMaturity, reinvestmentPeriodEnd (the last Payment Date inside the Reinvestment Period), nonCallEnd, effectiveDate (estimate if not fixed, and say so in assumptions), targetPar, dayCount, index, effectiveDateNote?}
classes: rated notes in payment seniority: [{id ("A","B","C"... or "A-1","X"), name, balance, spread (percent over the index), fixedRate? (coupon in percent, for fixed-rate classes only), deferrable (true if interest can defer without default), rating, spCol (closest S&P recovery column of AAA, AA, A, BBB, BB), ref}]
equity: {id, name, balance, ref}
labels: {itemKey: display name} for expense items you use
fees: {seniorMgmt: {label, schedule: [{through?, bps}], ref}, structuring?: {...}, subMgmt: {label, bps, unpaidAccruesAtClass?, ref}, adminCap?: {bpsOfPCV, fixed, priorPeriods, ref}, incentive?: {hurdleIRR, managerShare, dayBasis (360 or 365), ref}}
coverage: {icNumeratorDeducts: [interest step ids deducted from the IC numerator], tests: [{id, label, oc: {classes (all classes in the denominator), trigger, ref}, ic?: {classes, trigger, fromPeriod (Payment Date number it first applies), ref}}], reinvestmentTest?: {label, ocClasses, trigger, maxDiversionPct, ref}, eodTest?: {label, ocClasses, trigger, ref}}
haircuts: {ccc: {limitPct, haircutPct (carried at the lesser of this % of par and market value), moodysAtOrBelow, spAtOrBelow, ref}, defaulted: {zeroAfterYears, ref}, discount: {loan: {atLeastB3, belowB3}, other: {atLeastB3, belowB3}, ref}}
spreadRules: {minWAS, minWAC, excessParSpread}
selections: {moodysModifier?: {label, options, default}, spCase?: {label, options, default}} only if the deal has those elections
qualityTests: [{id, label, metric (warf|was|wac|wal|diversity|moodysWARR|spWARR|external), op ("<=" or ">="), limit, ref, adjust?, note?}]. limit is a number, or {type:"matrix", cap, modifier?:{base, mult}, main:{rows:[spread %], cols:[diversity], values:[[...]]}, alt?}, or {type:"case", values:[...]} indexed by selections.spCase, or {type:"declining", startYears, from:"effectiveDate"}, or for spWARR {type:"caseByClass", values:[[one value per S&P column] per case]}. Use metric "external" for model-based tests such as the S&P CDO Monitor.
concentrations: [{id (clause number), label, filter:[{f, in|notIn|eq|lt|gt}], op ("<=" default or ">="), limit, ref, cashAs?}] or [{id, label, metric:"maxObligor"|"maxIndustry"|"maxByField", field?, within?, limit, exceptions?:{count, limit}, ref}]. Filter fields: assetType (SSL|2L|UNSEC|BOND), rateType (FLOAT|FIXED), country (ISO 2-letter), payFreq (Q|S|A), covLite, dip, currentPay, pik, revolver, participation, synthetic, zeroCoupon (true/false), facilitySize (dollars), ccc (derived), matAfterStated (derived). Skip limits that cannot be expressed this way and mention them in assumptions.
waterfalls: {interest: [steps], principal: [steps], liquidation?: [steps]}. Each step: {id (the clause letter or number exactly as printed in the operative Priority of Payments, e.g. "E" for clause (E)), section (the full citation as the document numbers it, e.g. "Section 11.1(a)(i)(E)" in an indenture, "Priority of Interest Payments, clause E" in an offering memorandum, "Condition 3(c)(i)(E)" in European conditions), type, label (under 60 characters), clause (one sentence in your own plain English; never copy the document's wording), ref (the page marker shown in the excerpts, e.g. "PDF p. N" or "page N"), when?}. when is one of always (default), duringRP, afterRP, noRatedOutstanding, rcf, specialRedemption, redemption (only on a Redemption Date).
WHERE THE WATERFALL COMES FROM: build the three waterfalls only from the operative Priority of Payments. In an indenture that is Article XI, Section 11.1 "Disbursements of Monies from Payment Account" (Application of Monies): 11.1(a)(i) interest, 11.1(a)(ii) principal, 11.1(a)(iii) post-acceleration or enforcement; some indentures put the clauses in the definition of "Priority of Payments" instead. In an offering memorandum it is "Priority of Payments" under Description of the Notes, or "Application of Interest Proceeds" and "Application of Principal Proceeds" in the summary. In European deals it is the "Priorities of Payment" or "Application of Monies" condition. The excerpt labelled "Priority of Payments (operative text)" is that section. Follow it clause by clause: one step per lettered clause, in the printed order, with the printed letters; do not merge, split, skip or reorder clauses, and never build steps from definitions, risk factors or cross-references. A clause that pays several items in sequence (for example (1) taxes, then (2) capped expenses) stays one step. The post-acceleration or enforcement waterfall goes in liquidation. If that excerpt is missing or stops early, use search_document for "Section 11.1", "Priority of Interest", "Application of Monies", "Priorities of Payment" or "order of priority", then read_pages.
Step types and their fields:
 expense {item or items:[...]} with item keys taxes, admin (the capped expense step), adminExcess (expenses above the cap), hedge, hedgeTermSenior, hedgeTermSub, revolverFunding
 fees {items: ["seniorMgmt","structuring"]} paid pari passu
 interest {classes:[ids], includeDeferred?, withSeniorTermination?} current interest pari passu, then deferred interest
 cure {test (coverage test id), paydown:[class ids in order], includeDeferredOf?:[ids]} pay down until that class's OC and IC tests pass
 cureAll {tests:[ids], paydown, includeDeferredOf?} principal-waterfall cure of every failing test
 rcf {paydown}; specialRedemption {paydown}
 subMgmtFee {includeCumulativeDeferred?}
 reinvestmentDiversion (uses coverage.reinvestmentTest)
 unpaidFrom {steps:[interest step ids]} principal pays what interest could not
 reinvest (principal to the collection account, when:"duringRP")
 amortize {paydown, includeDeferredOf?} sequential paydown, when:"afterRP"
 interestAndPrincipal {class} liquidation: interest, deferred interest, then principal of one class
 principal {classes, includeDeferredOf?} principal (and deferred interest where listed) of the classes, in order; for post-acceleration clauses that pay principal separately from interest
 equityHurdle (to the subordinated notes until the IRR hurdle); incentiveSplit (residual split by fees.incentive.managerShare)
 none {manual?} a clause with no amount of its own (manual: true when the amount is entered by hand on the Manual inputs tab)
 If a clause fits none of these, still include it with type "unsupported" and explain it in assumptions. Do not invent clauses.
assumptions: [plain-English strings] listing everything you inferred, estimated, defaulted or simplified.
Leave out ratingFactors and recovery unless the document states non-standard values; the app fills Moody's standard rating factors and recovery tables.`;
// Compare the spec's waterfall steps with the clauses printed in the document's operative Priority of Payments
function docLetters(loc, kind) {
  const seq = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['AA', 'BB', 'CC', 'DD', 'EE', 'FF']);
  const ct = clauseTexts(loc, { [kind]: seq.map(id => ({ id })) })[kind] || {}; const out = [];
  for (const id of seq) { if (!ct[id]) break; out.push(id); }
  return out;
}
function docMatch(spec) {
  const I = state.interp; const loc = I.wfLoc; const res = { words: null, warns: [], note: '' };
  if (!loc || !spec.waterfalls) { if (!loc) res.note = 'The operative Priority of Payments was not found automatically, so the steps could not be checked against the document.'; return res; }
  const words = clauseTexts(loc, spec.waterfalls); const name = { interest: 'interest', principal: 'principal', liquidation: 'post-acceleration' };
  let n = 0, m = 0;
  ['interest', 'principal', 'liquidation'].forEach(k => {
    const steps = spec.waterfalls[k] || []; const got = words[k] || {};
    steps.forEach(st => { m++; if (got[st.id]) { n++; got[st.id].page = I.unit + ' ' + got[st.id].page; } });
    const miss = steps.filter(st => !got[st.id]).map(st => st.id);
    if (miss.length && Object.keys(got).length) res.warns.push('Not found in the document\'s ' + name[k] + ' Priority of Payments: step' + (miss.length > 1 ? 's ' : ' ') + miss.join(', ') + '. Check the clause letters.');
    const L = loc.anchors[k] ? docLetters(loc, k) : [];
    const ids = steps.map(st => wfShortId(st.id)); const absent = L.filter(x => !ids.includes(x));
    if (L.length >= 3 && absent.length) res.warns.push('The document\'s ' + name[k] + ' Priority of Payments has clauses ' + L[0] + '\u2013' + L[L.length - 1] + ', but the spec has no step for ' + absent.join(', ') + '.');
  });
  res.words = Object.assign({ file: I.fileName, from: loc.from + 1, to: loc.to + 1, unit: I.unit }, words);
  res.note = 'Matched ' + n + ' of ' + m + ' steps to the clauses printed on ' + I.unit + ' ' + (loc.from + 1) + '\u2013' + (loc.to + 1) + '.';
  return res;
}
/*@include filldefaults.js*/
async function interpret(fix) {
  const I = state.interp; const sample = state.caps.sample; if (!sample || I.busy) return;
  I.busy = true; I.ctl = new AbortController(); if (!fix) { I.log = []; I.spec = null; }
  rerenderInterp(); logI(fix ? 'Asking Claude to correct the spec…' : 'Sending ' + I.excerpts.length + ' sections (' + Math.round(excerptText().length / 1000) + 'k characters) to Claude…');
  const pages = I.pages;
  const tools = [
    { name: 'search_document', description: 'Search the full document for a word or phrase (case-insensitive). Returns up to 8 hits with PDF page numbers and a snippet. Use it to find a definition that is missing from the excerpts.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: ({ query }) => { logI('Claude searched for "' + query + '"'); const q = String(query || '').toLowerCase(); const hits = []; pages.forEach((t, i) => { let k = t.toLowerCase().indexOf(q); if (k >= 0 && hits.length < 8) hits.push({ page: i + 1, snippet: t.slice(Math.max(0, k - 120), k + 240) }); }); return { hits }; } },
    { name: 'read_pages', description: 'Return the text of PDF pages from..to, at most 4 pages per call.', inputSchema: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'] },
      execute: ({ from, to }) => { const a = Math.max(1, from | 0), b = Math.min(pages.length, Math.min((to | 0) || a, a + 3)); logI('Claude read ' + (state.interp.unit === 'PDF p.' ? 'PDF pages ' : 'pages ') + a + '–' + b); return { text: pages.slice(a - 1, b).map((t, k) => '[' + state.interp.unit + ' ' + (a + k) + ']\n' + t).join('\n') }; } }
  ];
  let prompt = 'You are interpreting a CLO indenture so a rules engine can run its waterfall and tests. Read the excerpts, use the tools if a needed definition is missing, and output the deal spec.' + (I.wfLoc ? ' The operative Priority of Payments is on ' + I.unit + ' ' + (I.wfLoc.from + 1) + '\u2013' + (I.wfLoc.to + 1) + '; take every waterfall step from there.' : ' No operative Priority of Payments was found automatically: search for it before writing the waterfalls.') + '\n\n' + SCHEMA_DOC + '\n\nWORKED EXAMPLE for a different, fictional deal (Example CLO I). Follow its structure; use the new document\'s own numbers, step letters and page references:\n' + exampleSpec() + '\n\nDOCUMENT EXCERPTS (' + I.fileName + '):\n' + excerptText();
  if (fix && I.spec && I.how === 'rules') {
    const gaps = I.check.errs.concat(I.check.warns, (I.found || []).filter(f => !RR_DONE.includes(f.how)).map(f => f.group + ': ' + f.field + ' (' + f.value + ')'), (I.spec.assumptions || []).filter(x => /not modelled|not found|assumed/i.test(x)));
    prompt += '\n\nDRAFT SPEC, read from this document by text rules. Its values were matched to the document text and are usually right; keep them unless the excerpts show they are wrong. Complete or correct these items:\n- ' + gaps.join('\n- ') + '\n\n' + JSON.stringify(I.spec) + '\nReturn the full corrected spec.';
  } else if (fix && I.spec) prompt += '\n\nYOUR PREVIOUS SPEC:\n' + JSON.stringify(I.spec) + '\n\nIt failed validation with:\n- ' + I.check.errs.concat(I.check.warns).join('\n- ') + '\nReturn the corrected full spec.';
  const started = Date.now(); const tick = setInterval(() => { const st = $('#interpStatus'); if (st) st.textContent = 'Working: ' + Math.round((Date.now() - started) / 1000) + 's'; }, 1000);
  I.status = 'Working: 0s'; rerenderInterp();
  try {
    let spec;
    try { spec = await sample.json(prompt, { tools, signal: I.ctl.signal, modelTier: 'complex', onText: () => { } }); }
    catch (e) { if (e && e.code === 'tools_unavailable') { logI('Tools unavailable here; using the excerpts only.'); spec = await sample.json(prompt, { signal: I.ctl.signal, modelTier: 'complex' }); } else throw e; }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw { code: 'invalid_json', message: 'Claude did not return a JSON object' };
    fillDefaults(spec); I.spec = spec; I.how = 'claude'; I.found = null; I.check = E.validateSpec(spec);
    const dm = docMatch(spec); I.docWords = dm.words; I.check.doc = dm.warns; I.check.warns = I.check.warns.concat(dm.warns); if (dm.note) logI(dm.note);
    logI('Received the spec in ' + Math.round((Date.now() - started) / 1000) + 's: ' + (I.check.errs.length ? I.check.errs.length + ' error(s) to fix' : 'it validates') + (I.check.warns.length ? ', ' + I.check.warns.length + ' warning(s)' : '') + '.');
    I.status = '';
  } catch (e) {
    const code = e && e.code;
    const msg = { cancelled: 'Stopped.', not_granted: 'Asking Claude was not allowed, so nothing was sent.', rate_limited: 'Too many requests right now. Wait a minute and try again.', prompt_too_large: 'The excerpts are too large. Paste a smaller set of sections instead.', invalid_json: 'Claude\'s answer could not be read as a deal spec. Try again; long documents sometimes need a second attempt.', sampling_disabled: 'Claude is not available for this account.' }[code] || ('The request failed' + (e && e.message ? ': ' + e.message : '') + '.');
    logI(msg); I.status = msg; if (code === 'not_granted' || code === 'sampling_disabled') state.caps.sample = false;
  } finally { clearInterval(tick); I.busy = false; I.ctl = null; rerenderInterp(); }
}

// ---------------- tabs & boot
function selectTab(t) { state.tab = t; $$('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t))); $$('.panel').forEach(p => { p.hidden = p.id !== 'p-' + t; }); }
$$('#tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
$('#tabs').addEventListener('keydown', e => { const tabs = $$('#tabs button'); const i = tabs.findIndex(b => b.dataset.tab === state.tab); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; selectTab(n.dataset.tab); n.focus(); } });
$('#dealSel').onchange = e => loadDeal(e.target.value);
$('#calcd').addEventListener('click', e => { if (e.target === $('#calcd')) $('#calcd').close(); });
$('#calcd').addEventListener('close', () => { const c = state.calc; state.calc = null; if (!c) return; const sel = c.src ? 'button.calc[data-src="' + c.src + '"]' : 'button.calc[data-k="' + c.k + '"][data-i="' + c.i + '"][data-part="' + (c.part === 'due' ? 'due' : 'paid') + '"]'; const b = $(sel); if (b) b.focus(); });
$('#goInterpret').onclick = () => { selectTab('rules'); $('#interpBox').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('#railToggle').onclick = () => { const r = $('#rail'); const c = r.classList.toggle('collapsed'); $('#railToggle').setAttribute('aria-expanded', String(!c)); $('#railToggleState').textContent = c ? 'Show' : 'Hide'; };
window.addEventListener('resize', () => { if (state.result) renderStrip(); });
if (window.matchMedia('(max-width: 880px)').matches) { $('#rail').classList.add('collapsed'); $('#railToggle').setAttribute('aria-expanded', 'false'); $('#railToggleState').textContent = 'Show'; }

if (state.dealId !== 'example' && !deal()) state.dealId = 'example';
loadScenario('apr09'); renderMast(); renderRail(); run();

// capabilities light up later. Outside Claude (GitHub Pages, a file on disk) there is no runtime:
// "Ask Claude" stays hidden and files are saved with an ordinary browser download.
const browserDownloads = { save: async ({ filename, data }) => {
  const type = /\.json$/i.test(filename) ? 'application/json' : /\.csv$/i.test(filename) ? 'text/csv' : 'text/plain';
  const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' }));
  a.download = filename; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
} };
(async () => {
  if (!window.claude || !window.claude.use) { state.caps.sample = false; state.caps.downloads = browserDownloads; renderOutput(); rerenderInterp(); return; }
  try { const s = await window.claude.use('sample'); state.caps.sample = s || false; } catch (e) { state.caps.sample = false; }
  try { const d = await window.claude.use('downloads'); state.caps.downloads = d || null; } catch (e) { state.caps.downloads = null; }
  renderOutput();
})();
})();
