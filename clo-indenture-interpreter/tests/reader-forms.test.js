// The reader on text as PDFs give it, and on wordings found in real indentures, using the fictional sample indenture
// rewritten in those forms. Also the two Weighted Average Life limits by Payment Date the engine now understands.
const fs = require('fs'); const path = require('path'); const L = require('./load.js');
const X = L.DATA.EXAMPLE_CLO; const E = L.E;
const RAW = fs.readFileSync(path.join(__dirname, '..', 'sample_inputs', 'example-clo-indenture.txt'), 'utf8');
let n = 0, bad = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = text => L.readDealText(L.htmlToPages(text, false), 'form-test.txt');

// 1. PDF-style text: lines hard-wrapped mid-phrase, the notes table a row per line, "18 th day", spaces inside quotes
const wrapAt = (text, W) => text.split('\n').map(line => { if (line.length <= W || /^Page \d+$/.test(line)) return line; const out = []; let cur = ''; for (const w of line.split(' ')) { if (cur && (cur + ' ' + w).length > W) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } if (cur) out.push(cur); return out.join('\n'); }).join('\n');
let pdf = RAW.replace('Designation\nClass A Senior Notes\nClass B Senior Notes\nClass C Deferrable Mezzanine Notes\nClass D Deferrable Mezzanine Notes\nClass E Deferrable Junior Notes\nSubordinated Notes\n', 'Designation Class A Class B Class C Class D Class E Subordinated Notes\n')
  .replace(/(\d)(st|nd|rd|th) day/g, '$1 $2 day').replace(/"([^"\n]+)"/g, '" $1 "');
ok(pdf !== RAW && /Designation Class A Class B/.test(pdf), 'the PDF-style rewrite applies');
for (const W of [90, 64]) {
  const text = wrapAt(wrapAt(pdf, 1000).replace(/([^\n])\n(?=[a-z0-9])/g, '$1 '), W);
  const { spec } = read(text); const q = id => (spec.qualityTests.find(t => t.id === id) || {}).limit; const qx = id => (X.qualityTests.find(t => t.id === id) || {}).limit;
  const tag = 'PDF-style text wrapped at ' + W + ': ';
  ok(same(['closingDate', 'firstPaymentDate', 'paymentDay', 'statedMaturity', 'reinvestmentPeriodEnd', 'nonCallEnd', 'targetPar'].map(k => spec.meta[k]), ['closingDate', 'firstPaymentDate', 'paymentDay', 'statedMaturity', 'reinvestmentPeriodEnd', 'nonCallEnd', 'targetPar'].map(k => X.meta[k])), tag + 'dates and Target Par');
  ok(same(spec.classes.map(c => [c.id, c.balance, c.spread, c.deferrable]), X.classes.map(c => [c.id, c.balance, c.spread, c.deferrable])), tag + 'classes from a row-per-line notes table');
  ok(same(spec.fees.seniorMgmt && spec.fees.seniorMgmt.schedule, X.fees.seniorMgmt.schedule) && spec.fees.subMgmt && spec.fees.subMgmt.bps === X.fees.subMgmt.bps, tag + 'fees');
  ok(same(spec.coverage.tests.map(t => [t.oc.trigger, t.ic && t.ic.trigger]), X.coverage.tests.map(t => [t.oc.trigger, t.ic && t.ic.trigger])), tag + 'coverage tests');
  ok(spec.coverage.reinvestmentTest && spec.coverage.reinvestmentTest.trigger === X.coverage.reinvestmentTest.trigger && spec.coverage.eodTest && spec.coverage.eodTest.trigger === X.coverage.eodTest.trigger, tag + 'diversion and Event of Default tests');
  ok(spec.haircuts.ccc && spec.haircuts.ccc.limitPct === X.haircuts.ccc.limitPct, tag + 'CCC limit');
  ok(['interest', 'principal', 'liquidation'].every(k => same((spec.waterfalls[k] || []).map(s => s.type), X.waterfalls[k].map(s => s.type))), tag + 'every waterfall clause');
  ok(same(q('was'), qx('mwas')) && ['wac', 'div', 'mwarr', 'wal'].every(id => same(q(id), qx(id))), tag + 'quality tests');
  ok(spec.concentrations.length >= 18, tag + 'concentration limits');
}

// 2. wordings from real indentures, written into the sample
const swap = (from, to) => { ok(RAW.includes(from), 'sample has: ' + from.slice(0, 50)); return RAW.replace(from, to); };
{ // a limit given in a second definition, and "equals or exceeds"
  const t = swap('"Minimum Weighted Average Coupon Test": A test that is satisfied on any Measurement Date if the\nWeighted Average Coupon of the fixed rate Collateral Obligations is at least 8.00%.',
    '"Minimum Weighted Average Coupon": With respect to Collateral Obligations that are fixed rate obligations, 7.25%.\n\n"Minimum Weighted Average Coupon Test": A test that is satisfied on any Measurement Date if the\nWeighted Average Coupon equals or\nexceeds the Minimum Weighted Average Coupon.');
  const q = read(t).spec.qualityTests.find(x => x.id === 'wac'); ok(q && q.limit === 7.25, 'a coupon limit given in a second definition: ' + (q && q.limit));
}
{ // a WAL table by Payment Date
  const i = RAW.indexOf('"Weighted Average Life Test"'); const j = RAW.indexOf('\n\n', i);
  const t = RAW.slice(0, i) + '"Weighted Average Life Test": A test satisfied on any date of determination if the Weighted Average Life is less than\nor equal to the number of years set forth in the table below for the most recent Payment Date:\nPayment Date Number of Years\nClosing Date 9.50\nJanuary 2008 9.25\nApril 2008 9.00\nJuly 2008 8.75\nOctober 2008 8.50\nJanuary 2009 8.25\nApril 2009 8.00' + RAW.slice(j);
  const q = read(t).spec.qualityTests.find(x => x.id === 'wal');
  ok(q && q.limit.type === 'table' && q.limit.rows.length === 7 && same(q.limit.rows[1], { from: '2008-01-18', value: 9.25 }), 'a WAL table by Payment Date: ' + JSON.stringify(q && q.limit).slice(0, 80));
  const r = E.run(Object.assign({}, X, { qualityTests: [q] }), L.DATA.scenarios()[1].tape, L.DATA.scenarios()[1].inputs); const w = r.quality.find(x => x.id === 'wal');
  ok(w.limit === 8.0 && /from 2009-04-18/.test(w.note), 'the engine uses the row for the Payment Date: ' + w.limit + ' (' + w.note + ')');
}
{ // a base plus a step for each Payment Date left in the Reinvestment Period
  const i = RAW.indexOf('"Weighted Average Life Test"'); const j = RAW.indexOf('\n\n', i);
  const t = RAW.slice(0, i) + '"Weighted Average Life Test": A test satisfied on any Measurement Date if the Weighted Average Life is (A) before\nthe end of the Reinvestment Period, less than or equal to (i) 4.5 plus (ii) (x) 0.25 multiplied by (y) the aggregate number\nof Determination Dates remaining until the end of the Reinvestment Period and (B) after it, less than or equal to (i) 4.5\nminus (ii) (x) 0.25 multiplied by (y) the number of Determination Dates elapsed since then.' + RAW.slice(j);
  const q = read(t).spec.qualityTests.find(x => x.id === 'wal'); ok(q && same(q.limit, { type: 'stepped', base: 4.5, step: 0.25, pivot: 'reinvestmentPeriodEnd' }), 'a stepped WAL limit: ' + JSON.stringify(q && q.limit));
  const S = L.DATA.scenarios(); const run = sc => E.run(Object.assign({}, X, { qualityTests: [q] }), sc.tape, sc.inputs).quality.find(x => x.id === 'wal');
  const a = run(S[1]), b = run(S[2]); // April 2009: 21 dates left to July 2014; October 2016: 9 dates since
  ok(a.limit === 4.5 + 0.25 * 21 && b.limit === 4.5 - 0.25 * 9, 'the engine steps it each Payment Date: ' + a.limit + ' and ' + b.limit);
}
{ // Event of Default wordings
  const t1 = swap('(e) on any Measurement Date that the Class A Overcollateralization Ratio is less than 101.00%.', '(e) on any Measurement Date, failure of the Overcollateralization Ratio to equal or exceed 100.5%.');
  const e1 = read(t1).spec.coverage.eodTest; ok(e1 && e1.trigger === 100.5 && same(e1.ocClasses, ['A']), 'Event of Default: "failure of the Overcollateralization Ratio to equal or exceed"');
  const t2 = swap('(e) on any Measurement Date that the Class A Overcollateralization Ratio is less than 101.00%.', '(e) on any Measurement Date, failure of the percentage equivalent of a fraction, (i) the numerator of which is the\nCollateral Principal Amount and (ii) the denominator of which is the Aggregate Outstanding Amount of the Class A Debt, to\nequal or exceed 102.0%.');
  const e2 = read(t2).spec.coverage.eodTest; ok(e2 && e2.trigger === 102 && same(e2.ocClasses, ['A']), 'Event of Default on the "Class A Debt"');
}
{ // equity principal until repaid is cash to the equity, not a gap
  const t = swap('(I) after all the Rated Notes have been paid in full, to the Holders of the Subordinated Notes until\nthey have received an Internal Rate of Return of 11%; and', '(I) after all the Rated Notes have been paid in full, to the Holders of the Subordinated Notes, until\nthe aggregate principal amount of the Subordinated Notes is reduced to zero; and');
  const st = (read(t).spec.waterfalls.principal || []).find(s => s.id === 'I'); ok(st && st.type === 'equityHurdle', 'a clause repaying the Subordinated Notes\' principal: ' + (st && st.type));
}
// 3. terms printed differently in two real indentures (both public SEC filings), written into the sample
{ // fees that are zero while a named manager serves; the rate for a successor is in the management agreement
  let t = RAW.replace(/"Senior Collateral Management Fee":[\s\S]*?\n\n/, '"Senior Collateral Management Fee": A fee, if any, payable to the Collateral Manager equal to the percentage per\nannum specified in Section 8(b) of the Collateral Management Agreement of the Fee Basis Amount;\nprovided that, so long as Example Credit Partners LLC is the Collateral Manager, the Senior Collateral\nManagement Fee shall be zero.\n\n')
    .replace(/"Subordinated Collateral Management Fee":[\s\S]*?\n\n/, '"Subordinated Collateral Management Fee": A fee, if any, payable to the Collateral Manager equal to a\npercentage per annum specified in the Collateral Management Agreement; provided that for so long as\nExample Credit Partners LLC is the Collateral Manager, the Subordinated Collateral Management Fee shall be zero.\n\n');
  ok(t !== RAW && !/0\.075% per annum/.test(t), 'the fee definitions are replaced');
  const r = read(t); const f = r.spec.fees; const lg = r.found.filter(x => /management fee/i.test(x.field));
  ok(f.seniorMgmt && same(f.seniorMgmt.schedule, [{ bps: 0 }]) && f.subMgmt && f.subMgmt.bps === 0, 'fees that "shall be zero" while the manager serves are read as 0%');
  ok(lg.length === 2 && lg.every(x => x.how === 'found' && /while Example Credit Partners LLC is the manager/.test(x.value)), 'and the list says why: ' + (lg[0] && lg[0].value));
}
{ // equity issued as a number of shares, with the notional amount per share given elsewhere
  let t = RAW.replace('Subordinated Notes\nOriginal Principal Amount', 'Original Principal Amount').replace(' U.S.$30,500,000\nStated Maturity', '\nStated Maturity').replace('LIBOR + 5.25% N/A', 'LIBOR + 5.25%').replace('No No Yes Yes Yes N/A', 'No No Yes Yes Yes').replace('Ba2 / BB Not rated', 'Ba2 / BB')
    .replace('U.S.$30,500,000 Subordinated Notes Due 2021\n', '')
    .replace('(c) Interest on each Class of Notes', '(c) The Issuer shall issue 30,500,000 Preferred Shares on the Closing Date. Each Preferred Share is counted at\nits notional amount of U.S.$1.00 per share.\n\n(d) Interest on each Class of Notes');
  ok(!/U\.S\.\$30,500,000/.test(t), 'the equity amount is taken out of the notes table');
  const r = read(t); const e = r.spec.equity; const lg = r.found.find(x => x.field === 'Preferred Shares');
  ok(e && e.name === 'Preferred Shares' && e.balance === 30500000 && lg && lg.how === 'found', 'Preferred Shares from the number issued and the amount per share: ' + JSON.stringify(e));
  ok(same(r.spec.classes.map(c => c.id), ['A', 'B', 'C', 'D', 'E']), 'the rated classes are unchanged');
}
{ // a table of limits by country: the aggregate limit outside the United States
  const t = swap('(xvii) not more than 20.0% may be issued by obligors Domiciled outside the United States;', '(xvii) no more than the percentage listed below may be issued by Obligors Domiciled in the country or\ncountries set forth opposite such percentage: % Limit Country or Countries 15.0% All countries (in the\naggregate) other than the United States; 10.0% Canada; 2.5% any individual Group I Country;');
  const c = read(t).spec.concentrations.find(x => x.id === '(xvii)'); ok(c && c.limit === 15 && same(c.filter, [{ f: 'country', notIn: ['US'] }]) && /aggregate/.test(c.label), 'a country table gives the aggregate non-US limit: ' + JSON.stringify(c));
}
{ // a printed quality matrix: spreads by diversity scores, giving the maximum rating factor
  const mx = '"Collateral Quality Matrix": The chart below, used to determine the row and column combination that applies to\nthe Maximum Weighted Average Rating Factor Test, as set out in Section 7.18.\nMinimum Weighted Average Spread Minimum Diversity Score\n40 45 50\n2.00% 2100 2200 2300\n2.50% 2400 2500 2600\n3.00% 2700 2800 2900\nMaximum Weighted Average Rating Factor\n\n';
  const t = RAW.replace('"Coverage Tests": The Overcollateralization', mx + '"Coverage Tests": The Overcollateralization');
  const r = read(t); const w = r.spec.qualityTests.find(x => x.id === 'warf'); const lg = r.found.find(x => /Rating Factor/.test(x.field) && x.group === 'Quality tests');
  ok(w && same(w.limit.main, { rows: [2, 2.5, 3], cols: [40, 45, 50], values: [[2100, 2200, 2300], [2400, 2500, 2600], [2700, 2800, 2900]] }), 'the matrix is read: ' + JSON.stringify(w && w.limit));
  ok(lg && lg.how === 'estimated' && /recovery adjustment/.test(lg.value), 'the recovery adjustment the definition adds is flagged, not applied');
  ok(same(r.spec.qualityTests.find(x => x.id === 'was').limit, X.qualityTests.find(x => x.id === 'mwas').limit), 'a spread limit the document states is still read as stated');
  const S = L.DATA.scenarios()[1]; const q = E.run(Object.assign({}, X, { qualityTests: [w] }), S.tape, S.inputs).quality.find(x => x.id === 'warf');
  ok(q && q.limit > 2100 && q.limit <= 2900 && /Matrix/.test(q.note), 'the engine looks the limit up at the portfolio\'s spread and diversity: ' + (q && q.limit));
}
console.log(bad ? bad + ' of ' + n + ' checks FAILED' : 'all ' + n + ' checks passed'); process.exit(bad ? 1 : 0);
