#!/usr/bin/env node
// Writes the built-in sample export (src/demo.js) as real files, so you can try the reader on
// zips without a real export: the six zip parts plus the manifest, like a real download.
// All data is made up. No dependencies; Node 20+.
//
//   npm run demo                 write the files to ./demo/
//   npm run demo -- <folder>     write them somewhere else

import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'demo'));

// src/*.js are classic browser scripts that share one global scope. Run the two we need in
// a fresh context, the same way the page runs them, with the few web APIs they use.
const ctx = vm.createContext({ console, TextEncoder, TextDecoder, Blob, File });
vm.runInContext('globalThis.window = globalThis;', ctx);
for (const file of ['src/zip.js', 'src/demo.js']) {
  vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), ctx, { filename: join(ROOT, file) });
}

const files = await vm.runInContext('demoExportFiles()', ctx);

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const f of files) {
  const bytes = Buffer.from(await f.arrayBuffer());
  writeFileSync(join(OUT, f.name), bytes);
  total += bytes.length;
  console.log(`  ${(bytes.length / 1024).toFixed(1).padStart(6)} KB  ${f.name}`);
}
const where = relative(process.cwd(), OUT) || '.';
console.log(`Wrote ${files.length} files (${(total / 1024).toFixed(1)} KB) to ${where}/`);
console.log('Open dist/claude-export-reader.html and drop these files on it. Everything in them is made up.');
