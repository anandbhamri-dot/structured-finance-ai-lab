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
if (typeof module !== 'undefined') module.exports = { htmlToPages };
