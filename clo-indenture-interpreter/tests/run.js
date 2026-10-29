#!/usr/bin/env node
// Runs every Node test against the committed sources and sample data. No network, no documents needed.
const { spawnSync } = require('child_process'); const path = require('path');
const T = [['engine audit: every figure in the working re-evaluates and ties', 'audit.js'], ['engine regression against the golden file', 'regress.test.js'],
  ['reader on the sample indenture reproduces the built-in spec', 'sample-doc.test.js'], ['lessons carry between documents', 'teach.test.js'],
  ['projection conserves par and cash', 'projection.test.js'], ['random lessons never break the reader', 'lesson-fuzz.test.js'], ['deleting any part of the spec never crashes the engine', 'spec-fuzz.test.js']];
let failed = 0;
for (const [name, file] of T) {
  const t0 = Date.now(); const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', env: Object.assign({ FUZZ_STEP: '4' }, process.env) });
  const out = (r.stdout + r.stderr).trim().split('\n'); const pass = r.status === 0;
  console.log((pass ? 'PASS ' : 'FAIL ') + name + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)  ' + out[out.length - 1]);
  if (!pass) { failed++; console.log(out.slice(-25).map(l => '     ' + l).join('\n')); }
}
console.log(failed ? '\n' + failed + ' test file(s) failed' : '\nAll tests passed'); process.exit(failed ? 1 : 0);
