// ---- Locate the operative Priority of Payments in a document and read each clause's own wording
// Works on an array of page texts (PDF pages or HTML parts). Deterministic: no model involved.
const WF_KINDS = ['interest', 'principal', 'liquidation'];
const WF_ANCHOR = {
  interest: [
    /(?:following order of priority|in the following order|order of priority set forth below)[^.;]{0,60}?\(the\s+["“]\s*(?:Priority of Interest (?:Payments|Proceeds)|Interest Priority of Payments|Interest Proceeds Priority of Payments|Interest Waterfall|Pre-Enforcement Interest Priority of Payments)\s*["”]\)/i,
    /Interest Proceeds(?:(?!Principal Proceeds)[\s\S]){0,700}?(?:shall|will) be (?:applied|disbursed|distributed|paid)(?:(?!Principal Proceeds)[\s\S]){0,250}?(?:following order of priority|in the following order|order of priority set forth below)/i
  ],
  principal: [
    /(?:following order of priority|in the following order|order of priority set forth below)[^.;]{0,60}?\(the\s+["“]\s*(?:Priority of Principal (?:Payments|Proceeds)|Principal Priority of Payments|Principal Proceeds Priority of Payments|Principal Waterfall|Pre-Enforcement Principal Priority of Payments)\s*["”]/i,
    /Principal Proceeds(?:(?!Interest Proceeds (?:shall|will))[\s\S]){0,900}?(?:shall|will) be (?:applied|disbursed|distributed|paid)[\s\S]{0,250}?(?:following order of priority|in the following order|order of priority set forth below)/i
  ],
  liquidation: [
    /(?:following order of priority|in the following order|order of priority set forth below)[^.;]{0,80}?\(the\s+["“]\s*(?:[\w\s-]{0,30}(?:Post-Acceleration|Acceleration|Liquidation|Enforcement|Post-Enforcement|Special)[\w\s-]{0,30}(?:Priority of (?:Payments|Proceeds)|Waterfall)|Priority of (?:Post-Acceleration|Liquidation|Enforcement) (?:Payments|Proceeds))\s*["”]\)/i,
    /(?:Enforcement Event|Event of Default|accelerat|Stated Maturity|Maturity of the (?:Securities|Notes))[\s\S]{0,700}?(?:Interest Proceeds and Principal Proceeds|Interest Proceeds, Principal Proceeds|proceeds in respect of the (?:Assets|Collateral)|distributions and proceeds|all (?:P|p)roceeds|all amounts)[\s\S]{0,300}?(?:following order of priority|in the following order)/i
  ]
};
const isTocPage = t => (t.match(/\bSection\s+\d+\.\d+/g) || []).length >= 14 && (t.match(/\.{5,}|\s\d{1,3}\s*\n/g) || []).length >= 10 || /TABLE OF CONTENTS/.test(t.slice(0, 400));
function wfFind(text, kind, from) {
  let best = null;
  for (const re of WF_ANCHOR[kind]) {
    const g = new RegExp(re.source.replace(/ /g, '\\s+'), 'gi'); g.lastIndex = from || 0; const m = g.exec(text);
    if (m && (!best || m.index < best.index || (re === WF_ANCHOR[kind][0] && m.index <= best.index + 200))) best = { index: m.index, end: m.index + m[0].length, strong: re === WF_ANCHOR[kind][0] };
    if (best && best.strong) break;
  }
  return best;
}
// clause markers "(A)" or "A." at the start of a line, or after ";" / ":"
const wfMarker = id => { const x = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('(?:^|\\n|[;:]\\s+(?:and\\s+|or\\s+)?)[ \\t]*(\\(' + x + '\\)|' + x + '\\.)(?=[ \\t\\n])', 'g'); };
const wfShortId = id => { const s = String(id || '').trim(); const m = s.match(/\(([^()]+)\)\s*$/); return (m ? m[1] : s).replace(/[.)\s]+$/, '').replace(/^\(/, ''); };
function locateWaterfall(pages) {
  const offs = []; let text = ''; pages.forEach((p, i) => { offs.push(text.length); text += (isTocPage(p) ? ' '.repeat(p.length) : p) + '\n'; });
  const pageAt = k => { let lo = 0, hi = offs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= k) lo = mid; else hi = mid - 1; } return lo; };
  let best = null, from = 0;
  for (let guard = 0; guard < 40; guard++) {
    const I = wfFind(text, 'interest', from); if (!I) break; from = I.end;
    const P = wfFind(text, 'principal', I.end); if (!P || pageAt(P.index) - pageAt(I.index) > 10) continue;
    const L = wfFind(text, 'liquidation', P.end); const Lok = L && pageAt(L.index) - pageAt(P.index) <= 8 ? L : null;
    const listA = (text.slice(I.end, P.index).match(/(?:^|\n)[ \t]*(?:\([A-Z]{1,2}\)|[A-Z]{1,2}\.)(?=[ \t\n])/g) || []).length;
    const listB = (text.slice(I.end, P.index).match(/(?:^|\n)[ \t]*(?:\([a-z]{1,4}\)|\(\d{1,2}\)|\d{1,2}\.)(?=[ \t\n])/g) || []).length;
    const score = (I.strong ? 3 : 0) + (P.strong ? 3 : 0) + (Lok ? 3 : 0) + Math.min(12, Math.max(listA, listB * 0.6));
    if (listA + listB < 3) continue;
    if (!best || score > best.score) best = { score, I, P, L: Lok };
  }
  if (!best) return null;
  const endIdx = best.L ? Math.min(text.length, best.L.end + 9000) : Math.min(text.length, best.P.end + 14000);
  const a = pageAt(best.I.index), b = pageAt(Math.min(endIdx, text.length - 1));
  return { from: Math.max(0, a), to: b, text, offs, pageAt, anchors: { interest: best.I, principal: best.P, liquidation: best.L } };
}
// For each step id, the document's own text of that clause (as printed) and the page it starts on
function clauseTexts(loc, waterfalls) {
  const out = {}; if (!loc) return out; const T = loc.text;
  const bounds = { interest: [loc.anchors.interest.end, loc.anchors.principal.index], principal: [loc.anchors.principal.end, loc.anchors.liquidation ? loc.anchors.liquidation.index : loc.anchors.principal.end + 14000], liquidation: loc.anchors.liquidation ? [loc.anchors.liquidation.end, loc.anchors.liquidation.end + 9000] : null };
  for (const k of WF_KINDS) {
    const steps = (waterfalls && waterfalls[k]) || []; const B = bounds[k]; if (!B || !steps.length) continue;
    const seg = T.slice(B[0], Math.min(T.length, B[1])); const hits = []; let pos = 0;
    for (const st of steps) {
      const g = wfMarker(wfShortId(st.id)); g.lastIndex = pos; const m = g.exec(seg);
      if (!m) { hits.push(null); continue; }
      const start = m.index + m[0].length - m[1].length; hits.push({ st, start }); pos = m.index + m[0].length;
    }
    const found = hits.filter(Boolean);
    found.forEach((h, j) => {
      let end = j + 1 < found.length ? found[j + 1].start : seg.length;
      if (j + 1 === found.length) { const tail = seg.slice(h.start); const stop = tail.search(/[.;]\s*\n(?=[ \t]*(?:[A-Z][a-z]|\d{1,3}\s*\n|[A-Z]{2,}\s))|\.\s*\n(?=[ \t]*\((?:[ivx]{1,5}|[a-z])\)\s)/); if (stop > 0) end = h.start + stop + 1; }
      let t = seg.slice(h.start, end).replace(/\n[ \t]*-?[ \t]*\d{1,3}[ \t]*-?[ \t]*(?=\n|$)/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().replace(/-\n(?=[a-z])/g, '-').replace(/\n(?!\((?:\d{1,2}|[ivx]{1,5}|[a-z]|[A-Z]{1,2})\)\s)/g, ' ').replace(/(?:\s*\b(?:and|or))?[\s;]*$/, m => m.includes(';') ? ';' : '');
      if (t.length > 4000) t = t.slice(0, 4000) + ' …';
      (out[k] = out[k] || {})[h.st.id] = { text: t, page: loc.pageAt(B[0] + h.start) + 1 };
    });
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { locateWaterfall, clauseTexts, wfShortId, wfFind, isTocPage };
