#!/usr/bin/env node
// HTML snapshot gate for refactors. It opens the built reader with the made-up sample data
// (never real exports), visits every page, opens every collapsed block, and records the
// normalised HTML of the main area and the sidebar, plus the srcdoc of every preview frame.
// A refactor should leave every file the same. Drives a local headless Chrome over the
// DevTools protocol; no dependencies (Node 22+).
//
//   npm run build && node scripts/snapshot.mjs --out <dir>       write a baseline
//   npm run build && node scripts/snapshot.mjs --compare <dir>   compare with it; exit 1 on any change
//
// Options: --chrome <path> (or the CHROME environment variable).
//
// Two passes run side by side, each in its own Chrome: "all" (no focus) and "focus" (the
// busiest person, focused with the "Focus on …" button). Each pass starts from a fresh load.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { launchChrome, DEFAULT_CHROME } from './lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'claude-export-reader.html');
const PAGE = pathToFileURL(DIST).href + '?demo';

const QUIET_MS = 400;          // a page is settled when #main and #sidebar have not changed for this long
const SETTLE_TIMEOUT = 20000;
// One query that finds conversations, one that finds artifacts and design chats, one with quotes.
const QUERIES = ['onboarding', 'campaign', '"week 4"'];

// Every other data-* attribute only carries click payloads (ids, keys, stash ids), which
// refactors rename freely. Export content cannot add data-* attributes: sanitize() drops them.
const KEEP_DATA = ['data-href', 'data-sort'];
// Ids made up per render (table and view keys), not taken from the data.
const GENERATED_ID = '^(tbl|v)\\d+$';

/* ---------- Arguments ---------- */

function parseArgs(argv) {
  const opts = { chrome: DEFAULT_CHROME };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') opts.keep = true;
    else if (a === '--out' || a === '--compare' || a === '--chrome') {
      if (!argv[i + 1]) usage('Missing value for ' + a);
      opts[a.slice(2)] = argv[++i];
    } else usage('Unknown argument: ' + a);
  }
  if (!opts.out === !opts.compare) usage('Pass exactly one of --out <dir> or --compare <dir>.');
  return opts;
}

function usage(msg) {
  console.error(msg + '\nUsage: node scripts/snapshot.mjs (--out <dir> | --compare <dir>) [--keep] [--chrome <path>]');
  process.exit(2);
}

/* ---------- In the page ---------- */

// Counts pending file reads and short timers, so "settled" also means "no async work left".
// Runs before the app's own scripts, in the top window only (not in preview frames).
const BUSY_TRACKER = `(() => {
  if (window !== window.top) return;
  let reads = 0;
  const timers = new Set();
  const track = (proto, name) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      reads++;
      let p;
      try { p = orig.apply(this, args); } catch (e) { reads--; throw e; }
      return Promise.resolve(p).finally(() => { reads--; });
    };
  };
  for (const n of ['text', 'arrayBuffer', 'bytes']) track(Blob.prototype, n);
  for (const n of ['text', 'arrayBuffer', 'json', 'blob', 'bytes']) track(Response.prototype, n);
  track(ReadableStreamDefaultReader.prototype, 'read');
  const st = window.setTimeout, ct = window.clearTimeout;
  window.__cerTimer = st.bind(window);
  // Long timers (toasts, URL clean-up) are not work the page waits for.
  window.setTimeout = function (fn, ms, ...args) {
    if (typeof fn !== 'function' || Number(ms) > 500) return st.call(window, fn, ms, ...args);
    const id = st.call(window, function () { timers.delete(id); return fn.apply(this, args); }, ms);
    timers.add(id);
    return id;
  };
  window.clearTimeout = function (id) { timers.delete(id); return ct.call(window, id); };
  window.__cerBusy = () => reads + timers.size;
})();`;

// Installed with Runtime.evaluate after each load, as window.__snap.
function pageHelpers(cfg) {
  const KEEP = new Set(cfg.keepData);
  const GEN_ID = new RegExp(cfg.generatedId);
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const wait = ms => new Promise(r => window.__cerTimer(r, ms));
  let last = performance.now();
  const mo = new MutationObserver(() => { last = performance.now(); });
  for (const id of ['main', 'sidebar']) {
    mo.observe(document.getElementById(id), { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const closed = () => Array.from(document.querySelectorAll('#main details:not([open]), #sidebar details:not([open])'));

  // One node per line. Whitespace-only text between tags is dropped and other whitespace
  // runs become one space, except where CSS keeps whitespace (pre, pre-wrap…).
  function serialize(root, frames) {
    const out = [];
    const preCache = new Map();
    const isPre = el => {
      if (!el) return false;
      if (!preCache.has(el)) preCache.set(el, /^(pre|break-spaces)/.test(getComputedStyle(el).whiteSpace));
      return preCache.get(el);
    };
    const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    const text = n => (isPre(n.parentElement) ? n.data : n.data.replace(/\s+/g, ' '));
    const keep = n => n.nodeType === 1 || n.nodeType === 8 || (n.nodeType === 3 && (isPre(n.parentElement) || /\S/.test(n.data)));
    const attrs = el => {
      const list = [];
      const all = Array.from(el.attributes).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      for (const a of all) {
        const name = a.name;
        let value = a.value;
        if (name.startsWith('data-') && !KEEP.has(name)) continue;
        if (name === 'id' && GEN_ID.test(value)) continue;
        if (name === 'class') value = value.split(/\s+/).filter(Boolean).sort().join(' ');
        else if (name === 'style') value = el.style ? el.style.cssText : value;
        else if (name === 'srcdoc') value = 'frame ' + frames.push(el.srcdoc);
        if ((name === 'class' || name === 'style') && !value) continue;
        list.push(value === '' ? name : `${name}="${escText(value).replace(/"/g, '&quot;')}"`);
      }
      return list.length ? ' ' + list.join(' ') : '';
    };
    const walk = (n, depth) => {
      const ind = '  '.repeat(depth);
      if (n.nodeType === 3) { out.push(ind + escText(text(n))); return; }
      if (n.nodeType === 8) { out.push(ind + '<!--' + n.data + '-->'); return; }
      const tag = n.localName;
      const open = '<' + tag + attrs(n) + '>';
      if (VOID.has(tag)) { out.push(ind + open); return; }
      const kids = Array.from(n.childNodes).filter(keep);
      const close = '</' + tag + '>';
      if (!kids.length) out.push(ind + open + close);
      else if (kids.length === 1 && kids[0].nodeType === 3) out.push(ind + open + escText(text(kids[0])) + close);
      else { out.push(ind + open); kids.forEach(k => walk(k, depth + 1)); out.push(ind + close); }
    };
    Array.from(root.childNodes).filter(keep).forEach(k => walk(k, 0));
    return out.join('\n');
  }

  window.__snap = {
    go(route) {
      last = performance.now();
      if (location.hash === route) return false;
      location.hash = route;
      return true;
    },
    state() {
      const pending = Array.from(document.querySelectorAll('#main iframe')).filter(f => !f.getAttribute('srcdoc')).length;
      return { quiet: Math.round(performance.now() - last), busy: window.__cerBusy(), frames: pending };
    },
    closedCount: () => closed().length,
    // Opens every collapsed block, then the blocks that appear inside them, and so on.
    async openAll() {
      let n = 0;
      for (let round = 0; round < 50; round++) {
        const list = closed();
        if (!list.length) break;
        list.forEach(d => { d.open = true; });
        n += list.length;
        await wait(20);
      }
      last = performance.now();
      return n;
    },
    capture() {
      const frames = [];
      const main = serialize(document.getElementById('main'), frames);
      const sidebar = serialize(document.getElementById('sidebar'), frames);
      const shell = [
        'q: ' + JSON.stringify(document.getElementById('q').value),
        'shell: ' + JSON.stringify(document.getElementById('shell').className),
        'picker hidden: ' + document.getElementById('picker').hidden,
        'scroll: ' + Math.round(document.getElementById('main').scrollTop),
        serialize({ childNodes: [document.getElementById('person-btn')] }, frames),
      ].join('\n');
      return { main, sidebar, shell, frames };
    },
    // Pages reached only from links or controls on this page.
    discover(route) {
      const found = [];
      const base = route.split('?')[0];
      if (/^#\/a\//.test(route) && !route.includes('?')) {
        document.querySelectorAll('#art-main select option').forEach(o => found.push(base + '?board=' + encodeURIComponent(o.value)));
        document.querySelectorAll('#art-main .tabs button').forEach(b => found.push(base + '?tab=' + encodeURIComponent(b.textContent.trim())));
      }
      if (/^#\/search\?.*&t=all$/.test(route)) {
        document.querySelectorAll('#main a.result[href*="?"]').forEach(a => found.push(a.getAttribute('href')));
      }
      document.querySelectorAll('#main a[href^="#/memory/"][href*="?f="]').forEach(a => found.push(a.getAttribute('href')));
      return found;
    },
  };
}

// Every page of the sample data, in a fixed order (ids sorted, not model order). The list
// pages, person tabs and search types come from the page's own lists (KINDS), so a new kind
// is visited too.
const ROUTES_EXPR = `(() => {
  const DB = ExportReader.DB();
  const personTabs = ['', ...PERSON_SECTIONS.map(s => s.key)];
  const searchTypes = ['all', ...KINDS.map(k => k.key), 'people'];
  const enc = encodeURIComponent;
  const ids = list => list.map(x => x.id).sort();
  const routes = ['#/', '#/people', ...KINDS.map(k => '#/' + k.list)];
  for (const id of [...DB.people.keys()].sort()) {
    for (const tab of personTabs) routes.push('#/person/' + enc(id) + (tab ? '/' + tab : ''));
  }
  for (const id of ids(DB.conversations)) routes.push('#/c/' + enc(id));
  for (const a of DB.artifacts.slice().sort((x, y) => (x.id < y.id ? -1 : 1))) {
    routes.push('#/a/' + enc(a.id));
    for (const vid of ids(a.versions)) {
      const v = '#/a/' + enc(a.id) + '/' + enc(vid);
      routes.push(v);
      if (a.kind !== 'page') routes.push(v + '?view=source', v + '?view=files');
    }
  }
  for (const id of ids(DB.projects)) routes.push('#/p/' + enc(id));
  for (const id of ids(DB.designChats)) routes.push('#/d/' + enc(id));
  for (const id of [...DB.memoryByPerson.keys()].sort()) routes.push('#/memory/' + enc(id));
  routes.push('#/search');
  for (const q of ${JSON.stringify(QUERIES)}) {
    for (const deep of [false, true]) {
      for (const t of searchTypes) routes.push('#/search?q=' + enc(q) + (deep ? '&deep=1' : '') + '&t=' + t);
    }
  }
  routes.push('#/about');
  const busiest = realPeople()
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1))[0];
  return { routes, focus: { id: busiest.id, name: busiest.name } };
})()`;

/* ---------- One pass ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const firstLine = s => String(s == null ? '' : s).split('\n')[0];

async function openReader(chrome) {
  const tab = await chrome.openPage();
  // Same viewport, colours, time zone and locale on every machine, so dates and layout match.
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await tab.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await tab.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await tab.send('Page.enable');
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: BUSY_TRACKER });

  // Errors and warnings logged by the reader itself (not by previews) go into the snapshot.
  const { frameTree } = await tab.send('Page.getFrameTree');
  const contexts = new Set();
  const log = [];
  tab.on(({ method, params }) => {
    if (method === 'Runtime.executionContextCreated') {
      const aux = params.context.auxData || {};
      if (aux.isDefault && aux.frameId === frameTree.frame.id) contexts.add(params.context.id);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      if (contexts.has(d.executionContextId)) log.push('exception: ' + firstLine((d.exception && d.exception.description) || d.text));
    } else if (method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(params.type)) {
      if (contexts.has(params.executionContextId)) {
        log.push(params.type + ': ' + params.args.map(a => firstLine(a.description != null ? a.description : a.value)).join(' '));
      }
    }
  });
  await tab.send('Runtime.enable');

  await tab.send('Page.navigate', { url: PAGE });
  await tab.waitFor(`!!(window.ExportReader && document.querySelector('#shell') && !document.querySelector('#shell').hidden)`);
  await tab.evaluate(`(${pageHelpers})(${JSON.stringify({ keepData: KEEP_DATA, generatedId: GENERATED_ID })})`);
  return { tab, log };
}

// Waits until the page has been quiet for QUIET_MS with no reads, timers or empty frames.
async function settle(tab) {
  const end = Date.now() + SETTLE_TIMEOUT;
  for (;;) {
    const s = await tab.evaluate('window.__snap.state()');
    if (s.quiet >= QUIET_MS && !s.busy && !s.frames) return '';
    if (Date.now() > end) return 'did not settle: ' + JSON.stringify(s);
    await sleep(Math.max(40, QUIET_MS - s.quiet));
  }
}

async function visit(tab, log, route) {
  await tab.evaluate(`window.__snap.go(${JSON.stringify(route)})`);
  const problems = [];
  let p = await settle(tab);
  if (p) problems.push(p);
  // Opening a block can draw more blocks inside it: repeat until none are left closed.
  for (let round = 0; round < 10 && (await tab.evaluate('window.__snap.closedCount()')); round++) {
    await tab.evaluate('window.__snap.openAll()');
    p = await settle(tab);
    if (p) problems.push(p);
  }
  const snap = await tab.evaluate('window.__snap.capture()');
  const found = await tab.evaluate(`window.__snap.discover(${JSON.stringify(route)})`);
  snap.log = log.splice(0);
  snap.problems = problems;
  return { snap, found };
}

async function runPass(name, chromePath, write) {
  const chrome = await launchChrome(chromePath);
  try {
    const { tab, log } = await openReader(chrome);
    const { routes, focus } = await tab.evaluate(ROUTES_EXPR);
    if (name === 'focus') {
      // Focus the way a person does: the "Focus on …" button on their page.
      await visit(tab, log, '#/person/' + encodeURIComponent(focus.id));
      const clicked = await tab.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('#main button')).find(x => /^Focus on /.test(x.textContent.trim()));
        if (b) b.click();
        return !!b;
      })()`);
      await settle(tab);
      const label = await tab.evaluate(`document.getElementById('person-btn-label').textContent`);
      if (!clicked || label !== focus.name) throw new Error('Could not focus on ' + focus.name + ' (button label: ' + label + ')');
      log.splice(0);
    }
    const seen = new Set(routes);
    const queue = routes.slice();
    for (let i = 0; i < queue.length; i++) {
      const route = queue[i];
      const { snap, found } = await visit(tab, log, route);
      write(name, route, snap, name === 'focus' ? focus.id : '');
      for (const r of found) if (!seen.has(r)) { seen.add(r); queue.push(r); }
      if ((i + 1) % 50 === 0) console.error(`  ${name}: ${i + 1} pages…`);
    }
    return queue.length;
  } finally {
    await chrome.close();
  }
}

/* ---------- Files ---------- */

const sha = s => createHash('sha256').update(s).digest('hex');

function fileFor(route) {
  const slug = (route.replace(/^#\/?/, '') || 'home').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return (slug || 'route') + '.' + sha(route).slice(0, 8) + '.txt';
}

async function snapshot(dir, chromePath) {
  const index = [];
  const write = (pass, route, snap, focusId) => {
    const frames = snap.frames.map((html, i) => {
      const h = sha(html).slice(0, 16);
      const p = join(dir, 'srcdoc', h + '.html');
      if (!existsSync(p)) writeFileSync(p, html);
      return `frame ${i + 1}: srcdoc ${h} (${html.length} chars)`;
    });
    const text = [
      'route: ' + route,
      'focus: ' + (focusId || 'none'),
      ...snap.problems.map(p => 'problem: ' + p),
      '', '== shell', snap.shell,
      '', '== sidebar', snap.sidebar,
      '', '== main', snap.main,
      ...(frames.length ? ['', '== frames', ...frames] : []),
      ...(snap.log.length ? ['', '== console', ...snap.log] : []),
    ].join('\n') + '\n';
    const file = fileFor(route);
    writeFileSync(join(dir, pass, file), text);
    index.push(`${pass}\t${route}\t${pass}/${file}`);
    if (snap.problems.length) console.error(`  ${pass} ${route}: ${snap.problems.join('; ')}`);
  };
  for (const sub of ['all', 'focus', 'srcdoc']) mkdirSync(join(dir, sub), { recursive: true });
  const counts = await Promise.all(['all', 'focus'].map(pass => runPass(pass, chromePath, write)));
  // Sorted so that the two passes running side by side always give the same file.
  writeFileSync(join(dir, 'routes.txt'), index.sort().join('\n') + '\n');
  return counts;
}

/* ---------- Compare ---------- */

// Unified diff of two line arrays (3 lines of context). Empty when equal.
function unifiedDiff(a, b, nameA, nameB) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  if (pre === a.length && pre === b.length) return [];
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const ops = [];
  if (A.length * B.length > 4e6) {
    // Too big to align line by line: show it as one replaced block.
    A.forEach(l => ops.push(['-', l]));
    B.forEach(l => ops.push(['+', l]));
  } else {
    const w = B.length + 1;
    const L = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; }
      else if (i < A.length && (j === B.length || L[(i + 1) * w + j] >= L[i * w + j + 1])) ops.push(['-', A[i++]]);
      else ops.push(['+', B[j++]]);
    }
  }
  const all = [...a.slice(0, pre).map(l => [' ', l]), ...ops, ...a.slice(a.length - suf).map(l => [' ', l])];
  const out = ['--- ' + nameA, '+++ ' + nameB];
  const changed = all.map((op, k) => (op[0] !== ' ' ? k : -1)).filter(k => k >= 0);
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - 3);
    let end = changed[k];
    while (k < changed.length && changed[k] <= end + 7) end = changed[k++];
    end = Math.min(all.length, end + 4);
    let la = 1, lb = 1;
    for (let x = 0; x < start; x++) { if (all[x][0] !== '+') la++; if (all[x][0] !== '-') lb++; }
    const hunk = all.slice(start, end);
    const na = hunk.filter(o => o[0] !== '+').length, nb = hunk.filter(o => o[0] !== '-').length;
    out.push(`@@ -${la},${na} +${lb},${nb} @@`, ...hunk.map(o => o[0] + o[1]));
  }
  return out;
}

function readLines(p) { return existsSync(p) ? readFileSync(p, 'utf8').split('\n') : null; }

function compare(baseDir, curDir) {
  const routesOf = d => new Map((readLines(join(d, 'routes.txt')) || []).filter(Boolean).map(l => {
    const [pass, route, file] = l.split('\t');
    return [pass + '\t' + route, file];
  }));
  const base = routesOf(baseDir), cur = routesOf(curDir);
  if (!base.size) throw new Error('No snapshot in ' + baseDir + ' (routes.txt is missing or empty).');
  const diffs = [];
  const missing = [...base.keys()].filter(k => !cur.has(k));
  const added = [...cur.keys()].filter(k => !base.has(k));
  let same = 0;
  for (const [key, file] of base) {
    if (!cur.has(key)) continue;
    const d = unifiedDiff(readLines(join(baseDir, file)), readLines(join(curDir, cur.get(key))), 'baseline/' + file, 'current/' + cur.get(key));
    if (d.length) diffs.push({ key, lines: d }); else same++;
  }
  return { diffs, missing, added, same, total: base.size };
}

/* ---------- Main ---------- */

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(DIST) || readFileSync(DIST, 'utf8') !== build()) {
  console.error('dist/claude-export-reader.html is missing or out of date. Run "npm run build" first.');
  process.exit(2);
}

if (opts.out) {
  const dir = resolve(opts.out);
  if (existsSync(dir) && readdirSync(dir).length && !existsSync(join(dir, 'routes.txt'))) {
    console.error(dir + ' is not empty and holds no snapshot. Choose an empty or new folder.');
    process.exit(2);
  }
  for (const sub of ['all', 'focus', 'srcdoc', 'routes.txt']) rmSync(join(dir, sub), { recursive: true, force: true });
  const t0 = Date.now();
  const [all, focus] = await snapshot(dir, opts.chrome);
  console.log(`Wrote ${all + focus} pages (${all} without focus, ${focus} with focus) to ${dir} in ${Math.round((Date.now() - t0) / 1000)} s.`);
} else {
  const baseDir = resolve(opts.compare);
  const curDir = mkdtempSync(join(tmpdir(), 'cer-snapshot-'));
  const t0 = Date.now();
  await snapshot(curDir, opts.chrome);
  const r = compare(baseDir, curDir);
  const MAX = 60;
  const report = [];
  for (const d of r.diffs) {
    report.push(...d.lines);
    console.log(`\n${d.key.replace('\t', ' ')}: ${d.lines.slice(2).filter(l => /^[-+]/.test(l)).length} changed lines`);
    console.log(d.lines.slice(0, MAX).join('\n') + (d.lines.length > MAX ? `\n… ${d.lines.length - MAX} more lines in the full diff` : ''));
    // A changed frame shows only as a new hash: say where both versions of the srcdoc are.
    for (const l of d.lines.slice(2)) {
      const m = /^([-+])frame \d+: srcdoc (\w+)/.exec(l);
      if (m) console.log(`  srcdoc ${m[1] === '-' ? 'before' : 'after '}: ${join(m[1] === '-' ? baseDir : curDir, 'srcdoc', m[2] + '.html')}`);
    }
  }
  for (const k of r.missing) console.log('\nmissing now: ' + k.replace('\t', ' '));
  for (const k of r.added) console.log('\nnew page: ' + k.replace('\t', ' '));
  writeFileSync(join(curDir, 'snapshot.diff'), report.join('\n') + '\n');
  const bad = r.diffs.length + r.missing.length + r.added.length;
  console.log(`\n${bad ? 'DIFFERENT' : 'IDENTICAL'}: ${r.same} of ${r.total} pages identical, ${r.diffs.length} changed, ` +
    `${r.missing.length} missing, ${r.added.length} new (${Math.round((Date.now() - t0) / 1000)} s). ` +
    (bad || opts.keep ? `This run: ${curDir}${r.diffs.length ? ' (full diff in snapshot.diff)' : ''}` : 'The run folder was deleted (--keep keeps it).'));
  // A run is about 5 MB of pages: keep it only when it is needed to read a difference.
  if (!bad && !opts.keep) rmSync(curDir, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
