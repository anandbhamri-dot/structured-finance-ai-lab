// The engine's results on the built-in deal and scenarios must match the golden file exactly.
// After an intended change, review the difference and regenerate it: node tests/regress.js > tests/golden/regress.txt
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const now = execFileSync(process.execPath, [path.join(__dirname, 'regress.js')], { encoding: 'utf8' }); const gold = fs.readFileSync(path.join(__dirname, 'golden', 'regress.txt'), 'utf8');
if (now === gold) { console.log('identical to the golden file (' + now.trim().split('\n').length + ' scenarios)'); process.exit(0); }
const a = gold.split('\n'), b = now.split('\n'); a.forEach((l, i) => { if (l !== b[i]) console.log('- ' + l + '\n+ ' + b[i]); }); console.log('differs from the golden file'); process.exit(1);
