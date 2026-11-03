// A deal whose terms are spread over several documents: read together, in order, with each page labelled by its document.
const fs = require('fs'); const path = require('path'); const L = require('./load.js');
const X = L.DATA.EXAMPLE_CLO; const dir = path.join(__dirname, '..', 'sample_inputs');
const raw = fs.readFileSync(path.join(dir, 'example-clo-indenture.txt'), 'utf8');
const sup = fs.readFileSync(path.join(dir, 'example-clo-supplemental-indenture.txt'), 'utf8');
let n = 0, bad = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('  FAIL ' + m); } };
const doc = (name, text) => ({ name, pages: L.htmlToPages(text, false), unit: 'page' });
const readAll = (docs, lessons) => { const set = L.docSet(docs); return Object.assign(L.readDealText(set.pages, set.name, lessons || null, set.multi ? set.keys : []), { set }); };
const q = (r, id) => (r.spec.qualityTests.find(x => x.id === id) || {}).limit;

// 1. an amendment listed first takes priority; listed after, the original definition is used
const A = doc('example-clo-indenture.txt', raw), S = doc('example-clo-supplemental-indenture.txt', sup);
const r0 = readAll([A]), r1 = readAll([S, A]), r2 = readAll([A, S]);
ok(q(r0, 'was') === 2.1 && q(r0, 'div') === 48, 'the indenture alone: spread 2.10%, diversity 48');
ok(q(r1, 'was') === 2 && q(r1, 'div') === 45, 'with the supplemental indenture above it: spread 2.00%, diversity 45');
ok(q(r2, 'was') === 2.1 && q(r2, 'div') === 48, 'with it below: the indenture\'s own definitions');
const f1 = r1.found.find(f => /Spread/.test(f.field)); ok(f1 && r1.set.label(f1.page) === 'example-clo-supplemental-indenture page 1', 'the page names its document: ' + (f1 && r1.set.label(f1.page)));
const fOC = r1.found.find(f => f.group === 'Coverage tests' && f.page); ok(fOC && /^example-clo-indenture page \d+$/.test(r1.set.label(fOC.page)), 'and pages of the indenture name it: ' + (fOC && r1.set.label(fOC.page)));
ok(r1.spec.meta.name === X.meta.name && r1.spec.meta.closingDate === X.meta.closingDate, 'name and dates still come from the indenture');
const sig = r => JSON.stringify(['interest', 'principal', 'liquidation'].map(k => r.spec.waterfalls[k].map(st => [st.id, st.type])));
ok(sig(r1) === sig(r0) && r1.spec.waterfalls.interest.length === X.waterfalls.interest.length, 'the waterfall is read as before');
ok(r1.set.range(1, r1.set.pages.length) === 'example-clo-supplemental-indenture page 1 to example-clo-indenture page ' + A.pages.length, 'a range across documents: ' + r1.set.range(1, r1.set.pages.length));
ok(L.docSet([A]).label(3) === 'page 3', 'one document: plain page numbers');

// 2. fees in a separate collateral management agreement: missing from the indenture, found when both are read
const FEES = /"(Incentive Management Fee|Senior Collateral Management Fee|Senior Deferred Structuring Fee|Subordinated Collateral Management Fee)":[\s\S]*?(?=\n\n|$)/g;
const moved = raw.match(FEES); const ind = raw.replace(FEES, '');
ok(moved && moved.length === 4, 'four fee definitions taken out of the indenture');
const cmaText = 'Page 1\nFICTIONAL SAMPLE DOCUMENT\n\nCOLLATERAL MANAGEMENT AGREEMENT\n\nmade on August 14, 2007 between Example CLO I, Ltd., as Issuer, and Example Credit Partners LLC, as Collateral Manager\n\nPage 2\nSection 1. Definitions. The following terms have these meanings.\n\n' + moved.join('\n\n') + '\n';
const I2 = doc('indenture-without-fees.txt', ind), CMA = doc('collateral-management-agreement.txt', cmaText);
const a = readAll([I2]), b = readAll([I2, CMA]);
ok(!a.spec.fees.seniorMgmt && !a.spec.fees.subMgmt, 'the indenture alone has no management fees');
ok(JSON.stringify(b.spec.fees.seniorMgmt && b.spec.fees.seniorMgmt.schedule) === JSON.stringify(X.fees.seniorMgmt.schedule), 'senior fee read from the agreement');
ok(b.spec.fees.subMgmt && b.spec.fees.subMgmt.bps === X.fees.subMgmt.bps, 'subordinated fee read from the agreement');
ok(JSON.stringify(b.spec.fees.structuring && b.spec.fees.structuring.schedule) === JSON.stringify(X.fees.structuring.schedule), 'structuring fee read from the agreement');
ok(b.spec.fees.incentive && b.spec.fees.incentive.hurdleIRR === X.fees.incentive.hurdleIRR && b.spec.fees.incentive.managerShare === X.fees.incentive.managerShare, 'incentive fee read from the agreement');
const ff = b.found.find(f => /Senior management fee/i.test(f.field) && f.page); ok(ff && /^collateral-management-agreement page/.test(b.set.label(ff.page)), 'its page names the agreement: ' + (ff && b.set.label(ff.page)));
L.fillDefaults(b.spec); ok(!L.E.validateSpec(b.spec).errs.length, 'the combined reading is a valid spec');

// 3. a value entered for one document still applies when another is added to the reading
const key = L.docSet([A]).keys[0];
const lessons = { values: [{ id: 'w', field: 'warf', value: '2,850', doc: key }], clauses: [], conc: [] };
ok(q(readAll([A], lessons), 'warf') === 2850, 'entered for the indenture');
ok(q(readAll([S, A], lessons), 'warf') === 2850, 'and still applied with the supplemental indenture added');
ok(q(readAll([S], lessons), 'warf') !== 2850, 'but not to a reading without that document');
console.log(bad ? bad + ' of ' + n + ' checks FAILED' : 'all ' + n + ' checks passed'); process.exit(bad ? 1 : 0);
