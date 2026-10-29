#!/usr/bin/env node
// Builds index.html: one self-contained page from src/. No dependencies.
// shell.html holds the page and three slots; app.js pulls in the reader, panels and helpers with /*@include file*/.
const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const forBrowser = s => s.replace(/^if \(typeof module !== 'undefined'\)[^\n]*\n?/gm, ''); // node exports are for the tests only
// /*@include file*/ pastes a source file; /*@text path*/ embeds a sample file (relative to the project) as a string
const inline = s => s.replace(/\/\*@include ([\w.-]+)\*\//g, (m, f) => forBrowser(read(f)).replace(/\n$/, ''))
  .replace(/\/\*@text ([\w./-]+)\*\//g, (m, f) => JSON.stringify(fs.readFileSync(path.join(__dirname, f), 'utf8')).replace(/<\/(script)/gi, '<\\/$1'));
let page = read('shell.html');
for (const [slot, file] of [['/*__ENGINE__*/', 'engine.js'], ['/*__DATA__*/', 'data.js'], ['/*__APP__*/', 'app.js']]) {
  if (page.split(slot).length !== 2) throw new Error('shell.html needs exactly one ' + slot);
  const body = inline(file === 'app.js' ? read(file) : read(file));
  page = page.replace(slot, () => body);
}
if (/\/\*@(include|text) /.test(page)) throw new Error('unresolved include');
const out = process.argv[2] || path.join(__dirname, 'index.html');
fs.writeFileSync(out, page); console.log('built', path.relative(process.cwd(), out) || out, (page.length / 1024).toFixed(0) + ' KB');
