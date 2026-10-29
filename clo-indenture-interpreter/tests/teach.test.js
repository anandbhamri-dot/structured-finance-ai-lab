// Lessons: taught on one document, used on the next; values entered for one document stay with it.
// Uses altered copies of the sample indenture so the reader meets wording it does not know.
const fs = require('fs'); const path = require('path'); const L = require('./load.js');
const base = fs.readFileSync(path.join(__dirname, '..', 'sample_inputs', 'example-clo-indenture.txt'), 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
// deal 1 calls the senior fee something new, has a clause and a concentration limit the reader has no rule for
const alter = (t, name) => t.replace(/Senior Collateral Management Fee/g, 'Base Advisory Fee')
  .replace(/\(N\) if a Rating Confirmation Failure[^;]*;/, '(N) to the payment of any rating agency surveillance charges not paid above;')
  .replace(/\(xvi\) not more than 20\.0% may consist of Synthetic Securities;/, '(xvi) not more than 20.0% may consist of Credit Linked Instruments;')
  .replace(/Example CLO I/g, name);
const doc1 = L.htmlToPages(alter(base, 'Example CLO II'), false), doc2 = L.htmlToPages(alter(base, 'Example CLO III').replace(/0\.30% per annum/, '0.25% per annum'), false);
const read = (pages, name, lessons) => L.readDealText(pages, name, lessons);
const r0 = read(doc1, 'deal-2.txt');
ok(!r0.spec.fees.seniorMgmt, 'without lessons the renamed senior fee is missed');
ok(r0.spec.waterfalls.interest.find(s => s.id === 'N').type === 'unsupported', 'and clause (N) is not modelled');
ok(r0.found.some(f => f.field === '(xvi) not modelled'), 'and limit (xvi) is not modelled');
const lessons = { values: [], clauses: [], conc: [] };
lessons.values.push({ id: 'v1', field: 'seniorFee', term: 'Base Advisory Fee', from: 'deal-2.txt' });
lessons.clauses.push({ id: 'c1', phrase: 'rating agency surveillance charges', type: 'manual', k: 'any' });
lessons.conc.push({ id: 'k1', phrase: 'Credit Linked Instruments', cat: 'synthetic' });
lessons.values.push({ id: 'v2', field: 'warf', value: '2,850', doc: r0.docKey });
lessons.values.push({ field: 'nope', term: 'x' }, { field: 'seniorFee', term: 'ab' }, { field: 'seniorFee', phrase: '((([' }); lessons.clauses.push({ phrase: 'abc', type: 'none' }, { phrase: 'Something', type: 'bogus' });
const r1 = read(doc1, 'deal-2.txt', lessons);
ok(JSON.stringify(r1.spec.fees.seniorMgmt && r1.spec.fees.seniorMgmt.schedule) === JSON.stringify(L.DATA.EXAMPLE_CLO.fees.seniorMgmt.schedule), 'senior fee read from the taught name, with its step-up');
ok(r1.found.find(f => f.field === 'Senior management fee').how === 'taught', 'marked Taught in the review list');
const N = r1.spec.waterfalls.interest.find(s => s.id === 'N'); ok(N.type === 'none' && N.manual, 'clause (N) read as an amount entered by hand');
ok(r1.spec.concentrations.some(c => c.id === '(xvi)' && c.filter[0].f === 'synthetic'), 'limit (xvi) read as synthetic securities');
ok((r1.spec.qualityTests.find(q => q.id === 'warf') || {}).limit === 2850, 'WARF entered for this document');
ok(['v1', 'c1', 'k1', 'v2'].every(id => r1.used.includes(id)), 'all four lessons reported as used');
// deal 3: the same wording, a different document
const r2 = read(doc2, 'deal-3.txt', lessons);
ok(!!r2.spec.fees.seniorMgmt && r2.found.find(f => f.field === 'Senior management fee').how === 'taught', 'the taught fee name carries to the next document');
ok(r2.spec.waterfalls.interest.find(s => s.id === 'N').type === 'none', 'so does the clause lesson');
ok(r2.spec.concentrations.some(c => c.id === '(xvi)'), 'and the concentration lesson');
ok(!r2.spec.qualityTests.some(q => q.id === 'warf' && q.limit === 2850) && !r2.used.includes('v2'), 'the value entered for deal 2 does not apply to deal 3');
ok(r2.spec.fees.subMgmt.bps === 25, 'deal 3 keeps its own figures (sub fee 0.25%)');
// lessons never change a reading they were not aimed at
const plain = read(L.htmlToPages(base, false), 'example.txt'), taught = read(L.htmlToPages(base, false), 'example.txt', lessons);
ok(JSON.stringify(plain.spec.waterfalls) === JSON.stringify(taught.spec.waterfalls) && JSON.stringify(plain.spec.concentrations) === JSON.stringify(taught.spec.concentrations), 'on the original sample the lessons change nothing');
// an override lesson replaces the reader's own reading only where its words appear
const over = read(doc1, 'deal-2.txt', { clauses: [{ phrase: 'surveillance charges', type: 'none', k: 'interest', override: true }, { phrase: 'Collateral Manager elects to defer', type: 'none', k: 'any', override: true }] });
ok(over.spec.waterfalls.interest.find(s => s.id === 'O').type === 'none', 'override lesson replaces the reader\'s reading of clause (O)');
ok(over.spec.waterfalls.interest.filter(s => s.type === 'none').length === 2, 'and nothing else');
// the engine runs a taught spec and pays a manual row at the taught step
L.fillDefaults(r1.spec); ok(!L.E.validateSpec(r1.spec).errs.length, 'taught spec validates');
const S = L.DATA.scenarios()[1]; const inp = Object.assign({}, S.inputs, { manual: [{ name: 'Surveillance', amount: 12000, wf: 'interest', step: 'N', rank: 'prorata' }] });
const res = L.E.run(r1.spec, S.tape, inp); const rowN = res.waterfalls.interest.find(x => x.id === 'N');
ok(Math.abs(rowN.paid - 12000) < 0.01 || res.waterfalls.interest.find(x => x.id === 'M').after < 12000, 'manual row paid at the taught step: ' + rowN.paid);
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
