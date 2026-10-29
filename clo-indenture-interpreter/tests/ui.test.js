// Browser checks on the built page (needs Playwright: npm i -D playwright && npx playwright install chromium).
// Opens index.html from disk, so it also proves the page works outside Claude: downloads, no "Ask Claude".
// Optional: CLO_DOCS=folder with real indentures (HTML or PDF) to read; PDFJS=folder with a local pdf.js build.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('SKIP ui tests: Playwright is not installed'); process.exit(0); }
const ROOT = path.join(__dirname, '..'); const PAGE = 'file://' + path.join(ROOT, 'index.html');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const errs = [];
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(String(e)));
  await pg.route('**/*', r => /fonts\.g/.test(r.request().url()) ? r.abort() : process.env.PDFJS && /pdf(\.worker)?\.min\.js/.test(r.request().url()) ? r.fulfill({ path: path.join(process.env.PDFJS, /worker/.test(r.request().url()) ? 'pdf.worker.min.js' : 'pdf.min.js'), contentType: 'application/javascript' }) : r.continue());
  await pg.goto(PAGE); await pg.waitForTimeout(700);
  console.log('## built-in deal');
  ok((await pg.textContent('#dealName')).includes('Example CLO I'), 'the fictional example deal loads');
  ok(await pg.$$eval('#p-waterfall table.ledger tbody tr', r => r.length) > 10, 'waterfall rows render');
  ok(!(await pg.$('#interpFix')) && !(await pg.$('#interpGo')), 'no "Ask Claude" outside Claude');
  // downloads work outside Claude
  const dlBtn = await pg.$('#p-waterfall button:has-text("CSV")');
  ok(!!dlBtn, 'a download button is offered on the waterfall');
  if (dlBtn) { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), dlBtn.click()]); ok(/\.csv$/.test(d.suggestedFilename()), 'browser download: ' + d.suggestedFilename()); }
  console.log('## tie-out');
  await pg.click('#tabs button[data-tab="tieout"]'); await pg.waitForTimeout(200);
  const nIn = await pg.$$eval('#p-tieout input.tiein', x => x.length); ok(nIn > 30, 'tie-out lists ' + nIn + ' figures');
  const model = await pg.$eval('#p-tieout tr[data-row="ip"] td.num', td => td.textContent.replace(/,/g, ''));
  await pg.fill('#p-tieout tr[data-row="ip"] input', model); await pg.fill('#p-tieout tr[data-row="oc.AB"] input', '120.00'); await pg.waitForTimeout(150);
  const sum = await pg.textContent('#tieSum'); ok(/1 of 2/.test(sum) && /differ/.test(sum), 'summary: ' + sum.trim().slice(0, 110));
  ok((await pg.textContent('#tabs button[data-tab="tieout"]')).includes('1'), 'tab badge counts the difference');
  await pg.reload(); await pg.waitForTimeout(600); await pg.click('#tabs button[data-tab="tieout"]');
  ok((await pg.inputValue('#p-tieout tr[data-row="oc.AB"] input')) === '120.00', 'trustee figures survive a reload');
  const tpl = path.join(ROOT, 'sample_inputs', 'example-tieout-apr09.csv');
  if (fs.existsSync(tpl)) { await pg.click('#tieClear'); await pg.setInputFiles('#tieFile', tpl); await pg.waitForTimeout(300); ok(/tie within tolerance/.test(await pg.textContent('#tieSum')), 'sample trustee CSV imports: ' + (await pg.textContent('#tieSum')).trim().slice(0, 100)); }
  console.log('## projection');
  await pg.click('#tabs button[data-tab="projection"]'); await pg.click('#projRun');
  await pg.waitForSelector('#p-projection table.pres', { timeout: 30000 });
  ok(await pg.$$eval('#p-projection table.pflows tbody tr', r => r.length) > 10, 'projection cash flow table');
  ok(!!(await pg.$('#p-projection svg path.parea')), 'projection chart drawn');
  await pg.hover('#phit', { position: { x: 200, y: 60 } }); ok(!(await pg.$eval('#ptip', t => t.hidden)), 'chart tooltip on hover');
  await pg.click('[data-ps="severe"]'); await pg.waitForTimeout(150); ok((await pg.getAttribute('[data-ps="severe"]', 'aria-pressed')) === 'true', 'switch scenario');
  { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#projCsv')]); ok(/projection-severe/.test(d.suggestedFilename()), 'projection CSV download'); }
  console.log('## reading a document');
  await pg.click('#tabs button[data-tab="rules"]'); await pg.click('#trySample'); await pg.waitForSelector('#interpLoad', { timeout: 20000 });
  ok(/Example CLO I, Ltd\./.test(await pg.textContent('#interpBox')), 'the built-in sample indenture reads, with the deal name');
  await pg.click('#readList button.tl >> nth=0'); await pg.click('input[name=tvMode][value=value]'); await pg.fill('#tvValue', '2,850'); await pg.click('#tTry'); await pg.waitForTimeout(200);
  { const t = await pg.textContent('#tOut'); ok(/2850/.test(t) && !/no longer a gap/.test(t), 'lesson preview lists only the real change: ' + t.replace(/\s+/g, ' ').slice(0, 90)); }
  await pg.click('#tabs button[data-tab="rules"]');
  await pg.setInputFiles('#pdfFile', path.join(ROOT, 'sample_inputs', 'example-clo-indenture.txt'));
  await pg.waitForSelector('#interpLoad', { timeout: 20000 });
  const box = await pg.textContent('#interpBox'); ok(/read by text rules/.test(box), 'sample indenture read');
  ok(!!(await pg.$('#teachBox')), 'teach panel present');
  if (process.env.CLO_DOCS) for (const f of fs.readdirSync(process.env.CLO_DOCS).filter(f => /\.(html?|pdf)$/i.test(f))) {
    await pg.setInputFiles('#pdfFile', path.join(process.env.CLO_DOCS, f)); await pg.waitForSelector('#interpLoad', { timeout: 90000 });
    const t = await pg.textContent('#interpBox'); const m = t.match(/(\d+) rated classes, (\d+) interest, (\d+) principal and (\d+) post-acceleration clauses(?: \((\d+) not modelled\))?/);
    ok(!!m && +m[1] > 0, f + ': ' + (m ? m[0] : 'not read')); ok(!(await pg.isDisabled('#interpLoad')), f + ': spec valid, can load');
  }
  console.log('## phone width');
  const m = await ctx.newPage(); m.on('pageerror', e => errs.push(String(e))); await m.setViewportSize({ width: 390, height: 844 }); await m.goto(PAGE); await m.waitForTimeout(600);
  for (const tab of ['waterfall', 'tieout', 'projection', 'rules']) { await m.click('#tabs button[data-tab="' + tab + '"]'); await m.waitForTimeout(150); const ov = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(ov <= 0, tab + ': no sideways scroll (' + ov + 'px)'); }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
