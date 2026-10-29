// ---------- projection tab: Base, Stress and Severe runs of the deal to maturity or a call
function projState() {
  if (!state.proj) state.proj = { sc: PROJ_PRESETS.map(p => Object.assign({}, p)), common: null, res: null, sel: 'base', running: false, stamp: '' };
  if (!state.proj.common) state.proj.common = projDefaults(deal(), state.result, state.inputs);
  return state.proj;
}
const projStamp = () => state.dealId + '|' + state.inputs.paymentDate + '|' + JSON.stringify(state.inputs.notes) + '|' + JSON.stringify(state.stress) + '|' + (state.tape ? state.tape.length : 0) + '|' + state.tapeSource;
const yrsFmt = x => x == null ? '—' : x.toFixed(2);
function renderProjection() {
  const P = $('#p-projection'); if (!P) return; const r = state.result; if (!r) { P.innerHTML = ''; return; }
  const S = projState(); const s = deal(); const sched = E.schedule(s).map(x => x.date);
  const calls = sched.filter(d => d > state.inputs.paymentDate && (!s.meta.nonCallEnd || d >= s.meta.nonCallEnd));
  let h = '<div class="sec"><h2>Projection</h2><p class="lead">Runs the deal forward from the ' + esc(longDate(state.inputs.paymentDate)) + ' Payment Date to Stated Maturity (' + esc(longDate(s.meta.statedMaturity)) + ') or a call. Each loan on the tape defaults and prepays at the annual rates below, defaulted par is recovered after the lag, and loans repay at maturity. Every future Payment Date then runs through the same waterfall and tests as this one, so the cures, diversions and fees behave as the indenture says. Notes, fees and the equity history carry from date to date.</p>';
  h += '<div class="pgrid"><div><h3>Credit scenarios</h3><div class="scroll"><table class="passm"><thead><tr><th>Assumption</th>' + S.sc.map(x => '<th class="num">' + esc(x.label) + '</th>').join('') + '</tr></thead><tbody>' +
    [['cdr', 'Default rate, CDR (% a year)'], ['cpr', 'Prepayment rate, CPR (% a year)'], ['recovery', 'Recovery (% of par)'], ['lagMonths', 'Recovery lag (months)']].map(([k, l]) => '<tr><td>' + l + '</td>' + S.sc.map((x, i) => '<td class="num"><input type="text" inputmode="decimal" data-sc="' + i + '" data-f="' + k + '" value="' + esc(x[k]) + '" aria-label="' + esc(x.label + ': ' + l) + '"></td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
  const C = S.common; const fld = (k, l, sub) => '<div class="field"><label for="pc_' + k + '">' + l + (sub ? '<small>' + sub + '</small>' : '') + '</label><input type="text" inputmode="decimal" id="pc_' + k + '" data-c="' + k + '" value="' + esc(C[k]) + '"></div>';
  h += '<div><h3>Common to all three</h3>' + fld('index', 'Index rate (%)', esc(s.meta.index || 'LIBOR') + ', held flat') + fld('reinvestSpread', 'Reinvestment spread (%)', 'New loans bought in the Reinvestment Period') + fld('reinvestPrice', 'Reinvestment price (% of par)') + fld('reinvestYears', 'Reinvestment term (years)') + fld('adminPerPeriod', 'Administrative expenses ($ each date)') +
    '<div class="field"><label for="pc_call">Call<small>Optional redemption: collateral sold, notes repaid</small></label><select id="pc_call" data-c="callDate"><option value="">No call</option>' + calls.map(d => '<option value="' + d + '"' + (C.callDate === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select></div>' +
    fld('callPrice', 'Sale price at a call or maturity (%)') + '</div></div>';
  const stale = S.res && S.stamp !== projStamp();
  h += '<div class="toolbar" style="margin-top:12px"><button class="btn primary" type="button" id="projRun"' + (S.running ? ' disabled' : '') + '>' + (S.running ? 'Running…' : S.res ? 'Run again' : 'Run the projection') + '</button><span class="src" id="projMsg">' + (S.running ? 'Running ' + esc(S.running) + '…' : stale ? 'The inputs on the left have changed since this ran.' : S.res ? 'Ran ' + S.res.base.periods.length + ' Payment Dates per scenario.' : 'Usually a second or two.') + '</span></div></div>';
  if (S.res) h += projResultsHTML(S, s);
  P.innerHTML = h; bindProjection(P);
}
function projResultsHTML(S, s) {
  const R = S.res; const ids = S.sc.map(x => x.id); let h = '<div class="sec"><h2>Results by scenario</h2><div class="scroll"><table class="pres"><thead><tr><th></th>' + S.sc.map(x => '<th class="num">' + esc(x.label) + '<small>' + x.cdr + ' CDR, ' + x.cpr + ' CPR, ' + x.recovery + '% rec.</small></th>').join('') + '</tr></thead><tbody>';
  const row = (lab, f, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + lab + '</td>' + ids.map(id => '<td class="num">' + f(R[id]) + '</td>').join('') + '</tr>';
  h += '<tr class="grp"><td colspan="' + (ids.length + 1) + '"><b>Weighted average life from ' + esc(state.inputs.paymentDate) + ' (years)</b></td></tr>' + s.classes.map(c => row('Class ' + esc(c.id), o => yrsFmt(o.classes.find(x => x.id === c.id).wal))).join('');
  h += '<tr class="grp"><td colspan="' + (ids.length + 1) + '"><b>Principal not repaid (loss)</b></td></tr>' + s.classes.map(c => row('Class ' + esc(c.id), o => { const x = o.classes.find(y => y.id === c.id); return x.loss > 0.5 ? '<span class="res fail">' + mm(x.loss) + '</span>' : '—'; })).join('');
  h += '<tr class="grp"><td colspan="' + (ids.length + 1) + '"><b>' + esc(s.equity.name) + '</b></td></tr>' + row('Distributions from here', o => mm(o.equity.total)) + row('IRR since closing (with history)', o => o.equity.irr == null ? 'n/m' : pct(o.equity.irr * 100, 1));
  h += '<tr class="grp"><td colspan="' + (ids.length + 1) + '"><b>Collateral</b></td></tr>' + row('Defaults', o => mm(o.defaults)) + row('Recoveries', o => mm(o.recoveries)) + row('Last Payment Date', o => esc(o.endDate) + (o.called ? ' (called)' : ''));
  h += '</tbody></table></div><p class="small" style="margin-top:6px">A class\'s loss is its principal and deferred interest still unpaid at the last Payment Date. Equity IRR counts the ' + esc(s.equity.name) + ' at par on the Closing Date, the distributions in the history on the left, and the projected ones.</p></div>';
  const sel = R[S.sel] ? S.sel : 'base'; const o = R[sel];
  h += '<div class="sec"><div class="tabsline"><h2>Cash flows</h2><div class="seg" role="group" aria-label="Scenario">' + S.sc.map(x => '<button type="button" data-ps="' + x.id + '" aria-pressed="' + (x.id === sel) + '">' + esc(x.label) + '</button>').join('') + '</div>' + '<button class="btn small" type="button" id="projCsv">' + (state.caps.downloads ? 'Download cash flows (CSV)' : 'Copy cash flows (CSV)') + '</button></div>';
  h += projChartHTML(o, s);
  h += '<div class="scroll" style="max-height:520px;margin-top:12px"><table class="pflows"><thead><tr><th>Date</th><th class="num">Collateral par</th><th class="num">Defaults</th><th class="num">Prepaid</th><th class="num">Matured</th><th class="num">Recoveries</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Reinvested</th>' + s.classes.map(c => '<th class="num">' + esc(c.id) + ' balance</th>').join('') + '<th class="num">' + esc(s.equity.name.replace(/ Notes$/, '')) + ' paid</th><th class="num">' + esc(o.periods[0] ? o.periods[0].juniorOCLabel : 'Junior') + ' OC</th><th>Tests failing</th></tr></thead><tbody>' +
    o.periods.map(p => '<tr' + (p.failing.length ? ' class="warnrow"' : '') + '><td>' + esc(p.date) + (p.mode === 'liquidation' ? ' <span class="mtag">' + (o.called && p === o.periods[o.periods.length - 1] ? 'call' : p.wound ? 'wound up' : 'final') + '</span>' : '') + '</td><td class="num">' + usdz(p.poolStart) + '</td><td class="num">' + usdz(p.defaults) + '</td><td class="num">' + usdz(p.prepay) + '</td><td class="num">' + usdz(p.scheduled) + '</td><td class="num">' + usdz(p.recoveries) + '</td><td class="num">' + usdz(p.interest) + '</td><td class="num">' + usdz(p.principal + p.sale) + '</td><td class="num">' + usdz(p.reinvested) + '</td>' + s.classes.map(c => '<td class="num">' + usdz(p.notes[c.id].bal) + '</td>').join('') + '<td class="num">' + usdz(p.equity) + '</td><td class="num">' + (p.juniorOC == null ? '' : p.juniorOC.toFixed(2) + '%') + '</td><td class="small">' + esc(p.failing.join(', ')) + '</td></tr>').join('') +
    '</tbody></table></div><p class="small" style="margin-top:6px">Principal includes sale proceeds at a call or at maturity. When the collateral is used up before maturity, the last date with collections winds the deal up through the post-acceleration waterfall. Interest is collected on performing par at the index plus each loan\'s spread (fixed-rate loans at their coupon); defaulted par earns nothing. Quality tests are run on each date but do not restrict reinvestment here.</p></div>';
  return h;
}
// stacked areas of the rated notes' balances, with the performing collateral as a line, on one $ axis
function projChartHTML(o, s) {
  const P = o.periods; if (!P.length) return '';
  const W = 760, H = 260, L = 52, Rt = 12, T = 12, B = 28; const n = P.length; const ids = s.classes.map(c => c.id);
  const pts = [{ date: o.start, notes: Object.fromEntries(ids.map(id => [id, { bal: o.classes.find(c => c.id === id).start }])), pool: P[0].poolStart }].concat(P.map(p => ({ date: p.date, notes: p.notes, pool: p.poolEnd })));
  const max = Math.max(...pts.map(p => Math.max(p.pool, ids.reduce((a, id) => a + p.notes[id].bal, 0)))) || 1;
  const step = max > 4e8 ? 1e8 : max > 2e8 ? 5e7 : max > 5e7 ? 2.5e7 : 1e7; const top = Math.ceil(max / step) * step;
  const x = i => L + (W - L - Rt) * (i / Math.max(1, pts.length - 1)); const y = v => T + (H - T - B) * (1 - v / top);
  let svg = '';
  for (let v = 0; v <= top + 1; v += step) svg += '<line x1="' + L + '" x2="' + (W - Rt) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="pgrid-l"/><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" class="pax" text-anchor="end">' + (v / 1e6).toFixed(0) + 'm</text>';
  const yearIdx = pts.map((p, i) => [p.date.slice(0, 4), i]).filter((a, i, arr) => i === 0 || a[0] !== arr[i - 1][0]); const every = Math.ceil(yearIdx.length / 8);
  yearIdx.forEach(([yr, i], k) => { if (k % every === 0) svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="pax" text-anchor="middle">' + yr + '</text>'; });
  const cum = pts.map(() => 0);
  ids.forEach((id, k) => {
    const lo = cum.slice(); pts.forEach((p, i) => { cum[i] += Math.max(0, p.notes[id].bal); });
    const d = 'M' + pts.map((p, i) => x(i).toFixed(1) + ',' + y(cum[i]).toFixed(1)).join('L') + 'L' + pts.map((p, i) => i).reverse().map(i => x(i).toFixed(1) + ',' + y(lo[i]).toFixed(1)).join('L') + 'Z';
    svg += '<path d="' + d + '" class="parea" style="fill:var(--series-' + (k % 5 + 1) + ')"><title>Class ' + esc(id) + '</title></path>';
  });
  svg += '<path d="M' + pts.map((p, i) => x(i).toFixed(1) + ',' + y(p.pool).toFixed(1)).join('L') + '" class="ppool"/>';
  svg += '<line class="pcross" id="pcross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/><rect x="' + L + '" y="' + T + '" width="' + (W - L - Rt) + '" height="' + (H - T - B) + '" fill="transparent" id="phit"/>';
  const legend = '<div class="plegend">' + ids.map((id, k) => '<span><i style="background:var(--series-' + (k % 5 + 1) + ')"></i>Class ' + esc(id) + '</span>').join('') + '<span><i class="pl"></i>Performing collateral par</span></div>';
  return '<figure class="pchart viz-root" data-n="' + pts.length + '">' + legend + '<div class="pwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rated note balances and performing collateral by Payment Date; the table below has the figures">' + svg + '</svg><div class="ptip" id="ptip" hidden></div></div><figcaption class="small">Note balances stacked from Class ' + esc(ids[0]) + ' at the bottom; the line is the performing collateral. Hover for the figures on each date.</figcaption></figure>';
}
function bindProjection(P) {
  const S = projState();
  $$('input[data-sc]', P).forEach(inp => inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v) && v >= 0) S.sc[+inp.dataset.sc][inp.dataset.f] = v; else { inp.value = S.sc[+inp.dataset.sc][inp.dataset.f]; toast('Enter a number of zero or more.'); } }));
  $$('[data-c]', P).forEach(inp => inp.addEventListener('change', () => { const k = inp.dataset.c; if (k === 'callDate') { S.common.callDate = inp.value; return; } const v = parseAmt(inp.value); if (isFinite(v) && v >= 0) S.common[k] = v; else { inp.value = S.common[k]; toast('Enter a number of zero or more.'); } }));
  const run = $('#projRun', P); if (run) run.onclick = () => runProjection();
  $$('[data-ps]', P).forEach(b => b.onclick = () => { S.sel = b.dataset.ps; renderProjection(); const f = $('#p-projection .pchart'); if (f) f.scrollIntoView({ block: 'nearest' }); });
  const csv = $('#projCsv', P); if (csv) csv.onclick = async () => {
    const o = S.res[S.sel]; const s = deal(); const cols = ['date', 'mode', 'collateral_par_start', 'defaults', 'prepaid', 'matured', 'recoveries', 'interest', 'principal', 'sale', 'reinvested'].concat(...s.classes.map(c => [c.id + '_interest', c.id + '_principal', c.id + '_balance', c.id + '_deferred']), ['equity_paid', 'senior_fees', 'sub_fee', 'incentive_fee', 'interest_diverted', 'junior_oc', 'tests_failing']);
    const rows = o.periods.map(p => { const x = { date: p.date, mode: p.mode, collateral_par_start: p.poolStart.toFixed(2), defaults: p.defaults.toFixed(2), prepaid: p.prepay.toFixed(2), matured: p.scheduled.toFixed(2), recoveries: p.recoveries.toFixed(2), interest: p.interest.toFixed(2), principal: p.principal.toFixed(2), sale: p.sale.toFixed(2), reinvested: p.reinvested.toFixed(2), equity_paid: p.equity.toFixed(2), senior_fees: p.seniorFees.toFixed(2), sub_fee: p.subFee.toFixed(2), incentive_fee: p.incentive.toFixed(2), interest_diverted: p.diverted.toFixed(2), junior_oc: p.juniorOC == null ? '' : p.juniorOC.toFixed(4), tests_failing: p.failing.join('; ') }; s.classes.forEach(c => { const n = p.notes[c.id]; x[c.id + '_interest'] = n.int.toFixed(2); x[c.id + '_principal'] = n.prin.toFixed(2); x[c.id + '_balance'] = n.bal.toFixed(2); x[c.id + '_deferred'] = n.def.toFixed(2); }); return x; });
    const txt = toCSV(rows, cols); const name = 'projection-' + S.sel + '-' + state.inputs.paymentDate + '.csv';
    if (state.caps.downloads) saveFile(name, txt); else { try { await navigator.clipboard.writeText(txt); toast('Copied as CSV'); } catch (e) { toast('Could not copy here.'); } }
  };
  const fig = $('.pchart', P); if (fig) bindProjChart(fig, S.res[S.sel]);
}
function bindProjChart(fig, o) {
  const svg = $('svg', fig), hit = $('#phit', fig), cross = $('#pcross', fig), tip = $('#ptip', fig); const s = deal(); const n = +fig.dataset.n;
  const pts = [{ date: o.start, notes: Object.fromEntries(s.classes.map(c => [c.id, { bal: o.classes.find(x => x.id === c.id).start }])), pool: o.periods[0].poolStart }].concat(o.periods.map(p => ({ date: p.date, notes: p.notes, pool: p.poolEnd })));
  const show = ev => {
    const bb = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const sx = (ev.clientX - bb.left) * vb.width / bb.width; const L = 52, Rt = 12;
    const i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / ((vb.width - L - Rt) / Math.max(1, n - 1))))); const p = pts[i]; const xx = L + (vb.width - L - Rt) * i / Math.max(1, n - 1);
    cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = '<b>' + esc(p.date) + '</b>' + s.classes.map((c, k) => '<div><i style="background:var(--series-' + (k % 5 + 1) + ')"></i>Class ' + esc(c.id) + '<span>' + mm(p.notes[c.id].bal) + '</span></div>').join('') + '<div><i class="pl"></i>Collateral<span>' + mm(p.pool) + '</span></div>';
    tip.hidden = false; const px = xx * bb.width / vb.width; tip.style.left = Math.min(bb.width - tip.offsetWidth - 4, Math.max(4, px + 12)) + 'px';
  };
  hit.addEventListener('mousemove', show); hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  hit.addEventListener('touchstart', e => { if (e.touches[0]) show(e.touches[0]); }, { passive: true });
}
function runProjection() {
  const S = projState(); const s = deal(); const tape = effectiveTape(); const I = clone(state.inputs); const first = state.result; const out = {}; let k = 0;
  S.running = S.sc[0].label; renderProjection();
  const next = () => {
    if (k >= S.sc.length) { S.res = out; S.running = false; S.stamp = projStamp(); renderProjection(); toast('Projection done'); return; }
    const sc = S.sc[k]; S.running = sc.label; const m = $('#projMsg'); if (m) m.textContent = 'Running ' + sc.label + '…';
    setTimeout(() => {
      try { out[sc.id] = projectDeal(E, s, tape, I, Object.assign({}, S.common, sc), first); }
      catch (e) { S.running = false; renderProjection(); const mm2 = $('#projMsg'); if (mm2) mm2.textContent = 'The projection stopped: ' + E.plainError(e) + '.'; return; }
      k++; next();
    }, 30);
  };
  next();
}
