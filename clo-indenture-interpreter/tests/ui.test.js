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
  console.log('## tab bar');
  { const top = await pg.evaluate(() => Math.round(document.querySelector('#tabsAnchor').getBoundingClientRect().top + scrollY));
    await pg.evaluate(t => scrollTo(0, t + 1200), top); await pg.waitForTimeout(100);
    ok(await pg.evaluate(() => Math.abs(document.querySelector('#tabs').getBoundingClientRect().top) < 1), 'the tab bar stays at the top while the page scrolls');
    const y = await pg.evaluate(() => scrollY); await pg.$eval('#tabs button[data-tab="tests"]', b => b.click()); await pg.waitForTimeout(50);
    ok(await pg.evaluate(t => Math.abs(scrollY - t) < 2, top), 'a tab not yet scrolled opens at its top, under the bar');
    await pg.$eval('#tabs button[data-tab="waterfall"]', b => b.click()); await pg.waitForTimeout(50); ok(await pg.evaluate(y => Math.abs(scrollY - y) < 2, y), 'switching back returns to where you were');
    ok(await pg.evaluate(() => getComputedStyle(document.querySelector('#rail')).position === 'sticky'), 'the inputs stay beside the page');
    await pg.evaluate(() => scrollTo(0, 0)); }
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
  console.log('## calculations');
  await pg.click('#tabs button[data-tab="calcs"]'); await pg.waitForTimeout(150);
  await pg.selectOption('#cvEx', '0'); await pg.waitForTimeout(400);
  const fbv = await pg.textContent('#p-calcs .cv .cv-res'); ok(/Value\s*[\d,]+\.\d\d/.test(fbv) && /Interpreter's Fee Basis Amount/.test(fbv), 'a deal figure replaces the Fee Basis Amount: ' + fbv.replace(/\s+/g, ' ').slice(0, 90));
  await pg.click('#p-calcs .cv .cv-res button.calc'); await pg.waitForTimeout(200);
  ok(/Loans in SUM\(par, NOT defaulted\)/.test(await pg.textContent('#calcd')), 'its working lists the loans behind each SUM'); await pg.keyboard.press('Escape');
  await pg.click('#tabs button[data-tab="waterfall"]'); ok(/replace the interpreter's Fee Basis Amount/.test(await pg.textContent('#p-waterfall .notice')), 'the waterfall says which figure is replaced');
  { const i = await pg.$$eval('#p-waterfall table.ledger tbody tr', rs => rs.findIndex(r => /Senior (collateral )?management/i.test(r.textContent))); ok(i >= 0, 'the senior fee step is listed');
    if (i >= 0) { await pg.click('#p-waterfall button.calc[data-i="' + i + '"][data-part="due"]'); await pg.waitForTimeout(150); ok(/calculation Fee_Basis_Amount_2/.test(await pg.textContent('#calcd')), 'the fee working names the calculation'); await pg.keyboard.press('Escape'); } }
  await pg.click('#tabs button[data-tab="calcs"]'); await pg.selectOption('#cvEx', '1'); await pg.waitForTimeout(400);
  ok(/5 of 152 loans changed/.test(await pg.textContent('#p-calcs .cv:last-child .cv-res')), 'the example puts the tape\'s Principal Balance in place of par: ' + (await pg.textContent('#p-calcs .cv:last-child .cv-res')).replace(/\s+/g, ' ').slice(0, 120));
  await pg.click('#p-calcs .cv:last-child [data-cdel]'); await pg.waitForTimeout(300);
  await pg.click('#cvAddLoan'); await pg.waitForTimeout(200);
  await pg.fill('#p-calcs .cv:last-child .cvname', 'Principal_Balance_2'); await pg.press('#p-calcs .cv:last-child .cvname', 'Tab'); await pg.waitForTimeout(250);
  await pg.fill('#p-calcs .cv:last-child .cvf', 'IF(asset_type = "2L", par * 0.98, par)'); await pg.press('#p-calcs .cv:last-child .cvf', 'Tab'); await pg.waitForTimeout(300);
  await pg.selectOption('#p-calcs .cv:last-child select[data-cf="use"]', 'par'); await pg.waitForTimeout(400);
  ok(/Par: [\d,.]+ on the tape, [\d,.]+ with this column; \d+ of \d+ loans changed/.test(await pg.textContent('#p-calcs .cv:last-child .cv-res')), 'a loan column replaces par: ' + (await pg.textContent('#p-calcs .cv:last-child .cv-res')).replace(/\s+/g, ' ').slice(0, 90));
  await pg.click('#tabs button[data-tab="portfolio"]'); ok(/comes from your calculation/.test(await pg.textContent('#p-portfolio')), 'the portfolio says par comes from the calculation');
  await pg.click('#tabs button[data-tab="calcs"]'); await pg.click('#cvAddDeal'); await pg.waitForTimeout(200);
  await pg.fill('#p-calcs .cv:last-child .cvname', 'Broken'); await pg.fill('#p-calcs .cv:last-child .cvf', 'Fee_Basis * 2'); await pg.press('#p-calcs .cv:last-child .cvf', 'Tab'); await pg.waitForTimeout(400);
  ok(/Did you mean/.test(await pg.textContent('#p-calcs .cv:last-child .cv-err')), 'an unknown name suggests one: ' + (await pg.textContent('#p-calcs .cv:last-child .cv-err')).slice(0, 80));
  ok((await pg.textContent('#tabs button[data-tab="calcs"]')).includes('1'), 'the tab counts the error');
  await pg.fill('#p-calcs .cv:last-child .cvf', 'ROUND(Fee_Basis_Amount_2 * 0.02% * Day_Count_Fraction, 2)'); await pg.press('#p-calcs .cv:last-child .cvf', 'Tab'); await pg.waitForTimeout(400);
  ok(!(await pg.$('#p-calcs .cv-err')), 'fixed: no errors left');
  { const ta = '#p-calcs .cv:last-child .cvf'; await pg.fill(ta, ''); await pg.click(ta); await pg.keyboard.type('Cla'); await pg.waitForTimeout(150);
    const names = await pg.$$eval('#acList li[data-ai] b', x => x.map(e => e.textContent)); ok(!(await pg.$eval('#acList', u => u.hidden)) && names[0] === 'Class_A_Balance' && names.includes('Class_A_Rate'), 'typing "Cla" lists the class figures: ' + names.slice(0, 4).join(', '));
    await pg.keyboard.type('ss_a_r'); await pg.keyboard.press('Enter'); ok((await pg.inputValue(ta)) === 'Class_A_Rate', 'Enter puts the chosen name in');
    await pg.keyboard.type(' * matur'); await pg.waitForTimeout(100); ok((await pg.$$eval('#acList li[data-ai] b', x => x.map(e => e.textContent))).includes('Stated_Maturity_Date'), 'part of a name finds it too');
    await pg.keyboard.press('Escape'); ok(await pg.$eval('#acList', u => u.hidden), 'Esc closes the list');
    await pg.fill(ta, 'ROUND(Fee_Basis_Amount_2 * 0.02% * Day_Count_Fraction, 2)'); await pg.press(ta, 'Tab'); await pg.waitForTimeout(400); }
  { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }), pg.click('#cvExport')]); const fp = await d.path(); const J = JSON.parse(fs.readFileSync(fp, 'utf8')); ok(J.calculations.length === 3 && J.format === 'clo-interpreter-calculations', 'calculations download as JSON'); }
  await pg.click('#tabs button[data-tab="manual"]'); await pg.click('#manAdd'); await pg.waitForTimeout(250);
  await pg.click('#manBody input[data-f="amount"]'); await pg.keyboard.type('=Brok'); await pg.waitForTimeout(150); ok((await pg.$$eval('#acList li[data-ai] b', x => x.map(e => e.textContent))).includes('Broken'), 'a manual formula suggests your calculations');
  await pg.keyboard.press('Enter'); await pg.press('#manBody input[data-f="amount"]', 'Tab'); await pg.waitForTimeout(400);
  ok(/Comes to [\d,]+\.\d\d/.test(await pg.textContent('#manBody')), 'a manual amount from a formula: ' + ((await pg.textContent('#manBody .fxn')) || '').slice(0, 60));
  await pg.reload(); await pg.waitForTimeout(700); await pg.click('#tabs button[data-tab="calcs"]');
  ok((await pg.$$eval('#p-calcs .cv', x => x.length)) === 3, 'calculations survive a reload');
  console.log('## groups of steps');
  { await pg.selectOption('#cvEx', { label: 'Principal Balance in steps (a group)' }); await pg.waitForTimeout(400);
    ok((await pg.$$eval('.cvgroup', x => x.length)) === 1 && (await pg.$$eval('.cvgroup .cv', x => x.length)) === 3, 'an example group adds three steps under one name');
    ok((await pg.$$eval('.cvgroup .cvstep', x => x.map(e => e.textContent))).join() === 'Step 1,Step 2,Step 3', 'the steps are numbered');
    await pg.click('.cvgroup [data-gwork]'); await pg.waitForTimeout(200); const head = await pg.$$eval('#calcd .cl-table thead th', x => x.map(e => e.textContent)); ok(['PB_From_Tape', 'PB_Not_Above_Par', 'Principal_Balance_Final'].every(n => head.includes(n)), 'the group working shows each step for every loan'); await pg.keyboard.press('Escape');
    await pg.fill('.cvgroup .cvgname', 'Final Principal Balance'); await pg.press('.cvgroup .cvgname', 'Tab'); await pg.waitForTimeout(300);
    ok((await pg.$$eval('.cvgroup select[data-cf="group"]', x => x.map(e => e.selectedOptions[0].textContent))).every(t => t === 'In Final Principal Balance'), 'renaming the group renames it for every step');
    await pg.click('.cvgroup [data-gadd]'); await pg.waitForTimeout(300); ok((await pg.$$eval('.cvgroup .cv', x => x.length)) === 4, 'a step is added to the group');
    await pg.uncheck('.cvgroup [data-gon]'); await pg.waitForTimeout(300); ok((await pg.$$eval('.cvgroup .cv.off', x => x.length)) === 4, 'the group switches off as a whole');
    await pg.click('.cvgroup [data-gtog]'); ok(await pg.$eval('.cvgroup .cvg-body', x => x.hidden), 'and its steps can be hidden');
    await pg.click('.cvgroup [data-gdel]'); await pg.click('.cvgroup [data-gdel]'); await pg.waitForTimeout(300); ok(!(await pg.$('.cvgroup')) && (await pg.$$eval('#p-calcs .cv', x => x.length)) === 3, 'deleting the group removes its steps only'); }
  await pg.click('#tabs button[data-tab="projection"]'); ok(/Your calculations apply here/.test(await pg.textContent('#p-projection')), 'the projection says which calculations it uses');
  await pg.click('#projRun'); await pg.waitForSelector('#p-projection table.pres', { timeout: 60000 }); ok(true, 'the projection runs with calculations');
  console.log('## several documents');
  await pg.click('#tabs button[data-tab="rules"]'); await pg.click('#trySample'); await pg.waitForSelector('#interpLoad', { timeout: 20000 });
  ok(/Example CLO I, Ltd\./.test(await pg.textContent('#interpBox')), 'the built-in sample indenture reads, with the deal name');
  await pg.click('#readList button.tl >> nth=0'); await pg.click('input[name=tvMode][value=value]'); await pg.fill('#tvValue', '2,850'); await pg.click('#tTry'); await pg.waitForTimeout(200);
  { const t = await pg.textContent('#tOut'); ok(/2850/.test(t) && !/no longer a gap/.test(t), 'lesson preview lists only the real change: ' + t.replace(/\s+/g, ' ').slice(0, 90)); }
  await pg.click('#tabs button[data-tab="rules"]');
  await pg.click('#trySupp'); await pg.waitForTimeout(300);
  ok((await pg.$$eval('.doclist li', x => x.length)) === 2 && /^example-clo-supplemental/.test(await pg.textContent('.doclist li .dn')), 'the supplemental indenture is added above the indenture');
  { const t = await pg.textContent('#readList'); ok(/Minimum Weighted Average Spread[\s\S]{0,40}2(\.00?)?%?[\s\S]{0,60}example-clo-supplemental-indenture page 1/.test(t), 'its amendment is read, with its document and page'); }
  await pg.click('[data-ddown="0"]'); await pg.waitForTimeout(300);
  ok(/^example-clo-indenture/.test(await pg.textContent('.doclist li .dn')), 'documents can be reordered');
  await pg.click('[data-ddel="1"]'); await pg.waitForTimeout(300); ok((await pg.$$eval('.doclist li', x => x.length)) === 1, 'and removed');
  await pg.setInputFiles('#addDocFile', path.join(ROOT, 'sample_inputs', 'example-clo-supplemental-indenture.txt')); await pg.waitForTimeout(400);
  ok((await pg.$$eval('.doclist li', x => x.length)) === 2, 'a document can be added from a file');
  console.log('## a tape with more columns');
  { const lines = fs.readFileSync(path.join(ROOT, 'sample_inputs', 'example-tape-apr09.csv'), 'utf8').trim().split('\n'); const tmp = path.join(require('os').tmpdir(), 'tape-extra-' + process.pid + '.csv');
    fs.writeFileSync(tmp, [lines[0] + ',Capitalised Interest'].concat(lines.slice(1).map((l, i) => l + ',' + (i % 7 ? '' : '25000'))).join('\n'));
    await pg.click('#tabs button[data-tab="portfolio"]'); await pg.setInputFiles('#tapeFile', tmp); await pg.waitForTimeout(500); fs.unlinkSync(tmp);
    ok(/2 more kept for calculations \(principal_balance, capitalised_interest\)/.test(await pg.textContent('#p-portfolio')), 'extra columns are kept: ' + (await pg.textContent('#p-portfolio .src')).slice(-60));
    await pg.click('#tabs button[data-tab="calcs"]'); ok(/capitalised_interest\s*From your tape/.test(await pg.textContent('#p-calcs .refs')), 'and listed as names for formulas'); }
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
  for (const tab of ['waterfall', 'manual', 'calcs', 'tieout', 'projection', 'rules']) { await m.click('#tabs button[data-tab="' + tab + '"]'); await m.waitForTimeout(150); const ov = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(ov <= 0, tab + ': no sideways scroll (' + ov + 'px)'); }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
