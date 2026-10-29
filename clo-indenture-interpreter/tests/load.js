// Loads the browser modules in Node for the tests: engine and data are UMD files; the reader,
// clause finder and defaults filler are fragments of app.js, so they are wrapped here with the
// few helpers they expect from it.
const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/^if \(typeof module !== 'undefined'\)[^\n]*\n?/gm, '');
const E = require(path.join(SRC, 'engine.js'));
const DATA = require(path.join(SRC, 'data.js'));
const src = 'const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);\nconst clone = x => JSON.parse(JSON.stringify(x));\n' +
  read('docpages.js') + '\n' + read('docclauses.js') + '\n' + read('rulereader.js') + '\n' + read('filldefaults.js') +
  '\nreturn { htmlToPages, readDealText, locateWaterfall, clauseTexts, fillDefaults, rrLessons, rrParseValue, RR_FIELDS, RR_CLAUSE_TYPES, RR_CONC, RR_DONE };';
const M = new Function('DATA', src)(DATA);
module.exports = Object.assign({ E, DATA }, M);
