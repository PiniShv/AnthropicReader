// Test harness: runs the browser scripts from src/ inside a fresh node:vm context.
//
// The app is plain classic scripts that share one global scope, so we run each file as its
// own vm.Script in the same context, in build order, just like the <script> tags in the
// built page. Top-level const/let/class names are not properties of the global object, so
// tests reach them through `api` (a proxy that looks names up inside the context).
//
// Only small stubs are provided: enough for the scripts to load and for the pure functions
// and the import pipeline to run. There is no real DOM; tests should not need one.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SCRIPTS } from '../scripts/build.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Everything except the boot script: app.js wires up the page and is rarely needed.
export const DEFAULT_FILES = APP_SCRIPTS.filter(f => f !== 'src/app.js');

// Compiled scripts are cached, so a fresh context per test stays cheap.
const compiled = new Map();
function script(path) {
  let s = compiled.get(path);
  if (!s) {
    s = new vm.Script(readFileSync(join(ROOT, path), 'utf8'), { filename: join(ROOT, path) });
    compiled.set(path, s);
  }
  return s;
}

// In-memory Web Storage. `blocked: true` makes every call throw, like a locked-down browser.
class MemoryStorage {
  constructor(blocked) { this._m = new Map(); this._blocked = !!blocked; }
  _check() { if (this._blocked) throw new Error('SecurityError: storage is blocked'); }
  get length() { this._check(); return this._m.size; }
  key(i) { this._check(); return Array.from(this._m.keys())[i] ?? null; }
  getItem(k) { this._check(); return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) { this._check(); this._m.set(String(k), String(v)); }
  removeItem(k) { this._check(); this._m.delete(String(k)); }
  clear() { this._check(); this._m.clear(); }
}

const noop = () => {};

function classListStub() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, force) => { const on = force ?? !set.has(c); if (on) set.add(c); else set.delete(c); return on; },
    contains: c => set.has(c),
  };
}

// A document that answers "nothing here" to every query. createElement fails loudly, so a
// test that wanders into DOM code says so instead of failing somewhere confusing.
function documentStub() {
  const el = () => ({ dataset: {}, style: {}, classList: classListStub(), setAttribute: noop, removeAttribute: noop, appendChild: noop, addEventListener: noop });
  return {
    readyState: 'complete',
    documentElement: el(),
    body: el(),
    head: el(),
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByName: () => [],
    createElement(tag) {
      throw new Error(`document.createElement('${tag}') is not available in the test harness. Test a function that does not need the DOM.`);
    },
  };
}

// Small, spec-shaped CSS.escape (enough for ids and attribute values in selectors).
function cssEscape(value) {
  const s = String(value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) out += '�';
    else if ((c >= 0x1 && c <= 0x1f) || c === 0x7f || (i === 0 && c >= 0x30 && c <= 0x39) ||
      (i === 1 && c >= 0x30 && c <= 0x39 && s.charCodeAt(0) === 0x2d)) out += '\\' + c.toString(16) + ' ';
    else if (i === 0 && s.length === 1 && c === 0x2d) out += '\\' + s[i];
    else if (c >= 0x80 || c === 0x2d || c === 0x5f || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) out += s[i];
    else out += '\\' + s[i];
  }
  return out;
}

/**
 * Load src files into a fresh context.
 *
 *   const { api } = loadApp();                       // every file except app.js
 *   const { api } = loadApp({ files: ['src/zip.js'] });
 *   const { DB, importExport } = api;
 *
 * Options:
 *   files          which src files to run (always run in build order)
 *   vendor         also run vendor/marked.min.js and vendor/purify.min.js first
 *   blockStorage   localStorage/sessionStorage throw on every call
 *
 * Returns { ctx, api, run, window }. `run(code)` evaluates code inside the context.
 */
export function loadApp(opts = {}) {
  const wanted = new Set(opts.files || DEFAULT_FILES);
  for (const f of wanted) if (!APP_SCRIPTS.includes(f)) throw new Error('Unknown src file: ' + f);
  const files = APP_SCRIPTS.filter(f => wanted.has(f));

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    requestAnimationFrame: cb => setTimeout(() => cb(performance.now()), 0),
    cancelAnimationFrame: id => clearTimeout(id),
    performance,
    TextEncoder, TextDecoder,
    Blob, File,
    ReadableStream, WritableStream, TransformStream, DecompressionStream, CompressionStream,
    URL, URLSearchParams, AbortController, Event, EventTarget,
    atob, btoa, crypto: globalThis.crypto,
    localStorage: new MemoryStorage(opts.blockStorage),
    sessionStorage: new MemoryStorage(opts.blockStorage),
    matchMedia: media => ({ media, matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    document: documentStub(),
    CSS: { escape: cssEscape, supports: () => false },
    navigator: { userAgent: 'node-test', language: 'en-US', clipboard: { writeText: async () => {} } },
    location: { href: 'file:///claude-export-reader.html', protocol: 'file:', hash: '', search: '', pathname: '/claude-export-reader.html' },
    history: { pushState: noop, replaceState: noop, back: noop },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    scrollTo: noop,
  };
  // Node loads its whole fetch implementation the first time Response is touched, so hand
  // it over lazily: only tests that inflate DEFLATE data pay for that.
  Object.defineProperty(sandbox, 'Response', { get: () => globalThis.Response, configurable: true });
  const ctx = vm.createContext(sandbox, { name: 'claude-export-reader test' });
  // window/self must be the context's own global, not the sandbox object we passed in.
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', ctx);

  if (opts.vendor) {
    for (const v of ['vendor/marked.min.js', 'vendor/purify.min.js']) {
      new vm.Script(readFileSync(join(ROOT, v), 'utf8'), { filename: join(ROOT, v) }).runInContext(ctx);
    }
  }
  for (const f of files) script(f).runInContext(ctx);

  const run = code => vm.runInContext(code, ctx);
  const api = new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name)) return undefined;
      return run(`typeof ${name} === 'undefined' ? undefined : ${name}`);
    },
  });
  return { ctx, api, run, window: run('globalThis') };
}

/* ---------- Helpers shared by the tests ---------- */

// Values made inside the context have that context's Array/Object prototypes, which
// assert.deepStrictEqual treats as different. Copy them into this realm first.
export function plain(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// A progress reporter that ignores everything (importExport's `ui` argument).
export const quietUi = { set: noop };

// A File and its path inside a picked folder, as drag and drop and saved folders give them.
export function looseFile(path, content) {
  const data = typeof content === 'string' || content instanceof Uint8Array ? content : JSON.stringify(content);
  return { file: new File([data], path.split('/').pop()), path };
}

// Build a .zip File with the app's own ZipWriter. `entries` maps path -> string | object | bytes.
export async function zipFile(api, name, entries) {
  const w = new api.ZipWriter();
  for (const [path, content] of Object.entries(entries)) {
    w.add(path, typeof content === 'string' || content instanceof Uint8Array ? content : JSON.stringify(content));
  }
  return new File([w.blob()], name, { type: 'application/zip' });
}

// Load files through the real import pipeline in a fresh context; returns the context api.
export async function importFiles(files, opts = {}) {
  const app = loadApp(opts);
  await app.api.importExport(files, quietUi);
  return app;
}

// Deterministic PRNG (mulberry32), so a failing fuzz case can be replayed.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A ReadableStream that delivers `bytes` in chunks whose sizes come from `nextSize()`.
export function chunkedStream(bytes, nextSize) {
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) { controller.close(); return; }
      const n = Math.max(1, nextSize());
      controller.enqueue(bytes.slice(pos, pos + n));
      pos += n;
    },
  });
}
