// The single-file build (scripts/build.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, APP_SCRIPTS } from '../scripts/build.mjs';
import { ROOT } from './harness.mjs';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const html = build();

// Every <script> block in the page, with its opening tag. Inlined code never contains a
// raw "</script", so a lazy match ends each block at its real end. Like a browser, it also
// ends a block at "</script >" or "</script foo>", but not at "</script-x>".
const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script(?:[\t\n\f\r /][^>]*)?>/gi), m => ({ attrs: m[1], code: m[2] }));

test('the page inlines every src file, in build order', () => {
  let last = -1;
  for (const file of APP_SCRIPTS) {
    const at = html.indexOf(`<script>/* ${file} */\n`);
    assert.ok(at >= 0, `${file} is missing from the build`);
    assert.ok(at > last, `${file} is out of order`);
    last = at;
    // The file's own code is there (apart from the "</script" escaping).
    const src = readFileSync(join(ROOT, file), 'utf8').replace(/<\/script/gi, '<\\/script').replaceAll('__VERSION__', pkg.version);
    assert.ok(html.includes(src), `${file} is not inlined as-is`);
  }
  for (const vendor of ['vendor/marked.min.js', 'vendor/purify.min.js']) {
    assert.ok(html.indexOf(`<script>/* ${vendor} */`) >= 0, `${vendor} is missing`);
    assert.ok(html.indexOf(`<script>/* ${vendor} */`) < html.indexOf(`<script>/* ${APP_SCRIPTS[0]} */`), `${vendor} must load before the app`);
  }
});

test('the page carries the package version and no placeholders', () => {
  assert.ok(html.includes('v' + pkg.version), 'version string from package.json');
  for (const placeholder of ['__STYLES__', '__SCRIPTS__', '__VERSION__']) {
    assert.ok(!html.includes(placeholder), `placeholder ${placeholder} left in the page`);
  }
  assert.ok(html.includes(readFileSync(join(ROOT, 'src/styles.css'), 'utf8').trim().slice(0, 200)), 'the stylesheet is inlined');
});

test('every inlined script block parses', () => {
  // JavaScript blocks only: no type, or a JavaScript type (not JSON data blocks).
  const inline = scripts.filter(s => {
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(s.attrs) || [])[1];
    return !type || /^(text\/javascript|application\/javascript)$/i.test(type);
  });
  assert.ok(inline.length >= APP_SCRIPTS.length + 2, `found only ${inline.length} script blocks`);
  for (const s of inline) {
    const name = (/^\/\* (\S+) \*\//.exec(s.code) || [])[1] || s.code.slice(0, 40);
    assert.doesNotThrow(() => new vm.Script(s.code, { filename: name }), `${name} does not parse`);
  }
});

// Only the static page. What it loads at run time, also from hostile export text, is checked
// in a browser by npm run security (scripts/security.mjs).
test('the page has no external scripts or stylesheets', () => {
  assert.equal(scripts.filter(s => /\bsrc\s*=/.test(s.attrs)).length, 0, 'no external scripts');
  assert.ok(!/<link\b[^>]*rel=["']?stylesheet[^>]*href=["']?https?:/i.test(html), 'no external stylesheets');
});

test('build() is deterministic', () => {
  assert.equal(build(), html);
});
