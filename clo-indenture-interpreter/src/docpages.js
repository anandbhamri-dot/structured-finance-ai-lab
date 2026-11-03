// EDGAR exhibits mark printed page breaks with page-break styles or <hr>; split there so page numbers track the document
function htmlToPages(raw, isHtml) {
  const PB = '@@PB@@';
  let text;
  if (isHtml) {
    let s = raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<[^>]*page-break-(before|after)\s*:\s*always[^>]*>/gi, (m, w) => w.toLowerCase() === 'before' ? PB + m : m + PB);
    s = s.replace(/<hr\b[^>]*>/gi, ' ' + PB + ' ');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|center)>/gi, '$&\n').replace(/<\/t[dh]>/gi, '$& ');
    const doc = new DOMParser().parseFromString(s, 'text/html');
    text = (doc.body || doc.documentElement).textContent;
  } else text = raw.replace(/\f/g, PB).replace(/^[ \t]*Page[ \t]+\d{1,4}[ \t]*$/gm, PB); // plain text: form feeds or "Page N" lines
  text = text.replace(/\u00a0/g, ' ').replace(/[ \t\r]+/g, ' ').replace(/ *\n[ \n]*/g, '\n');
  let pages = text.split(PB).map(p => p.trim()).filter(p => p.length > 0);
  const merged = []; for (const p of pages) { if (merged.length && (p.length < 400 || merged[merged.length - 1].length < 400)) merged[merged.length - 1] += '\n' + p; else merged.push(p); }
  pages = merged;
  if (pages.length < 10) { const all = pages.join('\n'); pages = []; let i = 0; while (i < all.length) { let j = Math.min(all.length, i + 3500); const nl = all.lastIndexOf('\n', j); if (j < all.length && nl > i + 2000) j = nl; pages.push(all.slice(i, j)); i = j; } }
  return pages;
}
// Several documents for one deal (an indenture, its collateral management agreement, a supplemental indenture):
// read as one text, in the order listed, so where two give the same term the reader normally takes the first.
// Every page keeps a label naming its own document, e.g. "cma page 4".
function docShort(name) { const s = String(name || 'document').replace(/\s*\(fictional sample\)\s*$/i, '').replace(/\.(pdf|html?|txt)$/i, '').trim(); return s.length > 40 ? s.slice(0, 38).replace(/[\s,.-]+$/, '') + '…' : s; }
function docSet(docs) {
  const pages = []; const map = [];
  docs.forEach((d, i) => d.pages.forEach((t, p) => { pages.push(t); map.push([i, p + 1]); }));
  const multi = docs.length > 1;
  const label = n => { const m = map[(n | 0) - 1]; if (!m) return (docs[0] ? docs[0].unit : 'p.') + ' ' + n; const d = docs[m[0]]; return (multi ? docShort(d.name) + ' ' : '') + (d.unit || 'p.') + ' ' + m[1]; };
  const range = (a, b) => { if (!b || b === a) return label(a); const x = map[a - 1], y = map[b - 1]; if (x && y && x[0] === y[0]) return label(a) + '\u2013' + y[1]; return label(a) + ' to ' + label(b); };
  return { pages, map, label, range, multi, name: docs.map(d => d.name).join(' + '), keys: docs.map(d => rrDocKey(d.pages, d.name)), docOf: n => (map[(n | 0) - 1] || [0])[0] };
}
if (typeof module !== 'undefined') module.exports = { htmlToPages, docSet, docShort };
