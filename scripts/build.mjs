#!/usr/bin/env node
// Builds the single-file reader: inlines the stylesheet, the vendored libraries and the
// app scripts into dist/claude-export-reader.html. No dependencies; Node 20+.
//
//   npm run build            write the file
//   npm run build -- --check fail if the committed file is out of date (used by CI)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'claude-export-reader.html');

// Order matters: later scripts use globals defined by earlier ones.
const VENDOR = ['vendor/marked.min.js', 'vendor/purify.min.js'];
export const APP_SCRIPTS = [
  'src/zip.js', 'src/load.js', 'src/render.js', 'src/ui.js', 'src/model.js',
  'src/conversation.js', 'src/search.js', 'src/export.js',
  'src/views.js', 'src/views-conv.js', 'src/views-art.js', 'src/views-design.js', 'src/views-misc.js',
  'src/demo.js', 'src/app.js',
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function inlineScript(path) {
  // A literal "</script" inside inlined code would end the tag early.
  const code = read(path).replace(/<\/script/gi, '<\\/script');
  // "<!--" followed by "<script" before the next "-->" switches the HTML parser into a
  // mode where "</script>" no longer ends the block, which silently breaks the page.
  for (const m of code.matchAll(/<!--/g)) {
    const rest = code.slice(m.index + 4);
    const close = rest.indexOf('-->');
    const opener = rest.search(/<script/i);
    if (opener !== -1 && (close === -1 || opener < close)) {
      throw new Error(`${path}: "<!--" followed by "<script" would break the inlined page`);
    }
  }
  return `<script>/* ${path} */\n${code}\n</script>`;
}

export function build() {
  const pkg = JSON.parse(read('package.json'));
  let html = read('src/template.html');
  html = html.replace('/*__STYLES__*/', () => read('src/styles.css'));
  html = html.replace('<!--__SCRIPTS__-->', () => [...VENDOR, ...APP_SCRIPTS].map(inlineScript).join('\n'));
  html = html.replaceAll('__VERSION__', pkg.version);
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = build();
  if (process.argv.includes('--check')) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== html) {
      console.error('dist/claude-export-reader.html is out of date. Run "npm run build" and commit the result.');
      process.exit(1);
    }
    console.log('dist/claude-export-reader.html is up to date.');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, html);
    console.log(`wrote dist/claude-export-reader.html (${Math.round(html.length / 1024)} KB)`);
  }
}
