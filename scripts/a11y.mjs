#!/usr/bin/env node
// Accessibility check (WCAG 2.2 AA). It opens the built reader with the made-up sample data
// (never real exports) in headless Chrome and:
//   1. runs axe-core on every page and state listed in STATES, in light and dark mode, at
//      desktop and phone width;
//   2. checks the keyboard rules axe cannot see (KEYBOARD): the skip link, where the focus
//      goes, the dialog and full screen, the focus ring, less motion.
// Exit code 1 when anything fails. Node 22+ and Chrome; no dependencies.
//
//   npm run build && npm run a11y
//   node scripts/a11y.mjs [--axe <axe.min.js>] [--chrome <path>]
//
// axe-core is not in the repository: the pinned version below is downloaded at run time
// into a temp folder (once), and its SHA-256 is checked before it runs. Pass --axe to use a
// local copy instead (it is checked the same way).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { launchChrome, DEFAULT_CHROME } from './lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'claude-export-reader.html');
const PAGE = pathToFileURL(DIST).href;

// The official npm build (axe-core@4.13.0/axe.min.js, MPL-2.0). To update: change both
// lines, run the script, and check that it still passes (or fix what the new rules find).
const AXE_VERSION = '4.13.0';
const AXE_SHA256 = 'c24f097bd2f451d4f933e8bc7d8d539f8672a2ebcb5cc9f9f3eec8ca9470a0c1';
const AXE_URL = `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`;
// WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices (landmarks, heading order…).
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const THEMES = ['light', 'dark'];
const SIZES = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 375, height: 760 }];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Arguments and axe-core ---------- */

function parseArgs(argv) {
  const opts = { chrome: DEFAULT_CHROME, axe: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--axe' || a === '--chrome') && argv[i + 1]) opts[a.slice(2)] = argv[++i];
    else {
      console.error('Usage: node scripts/a11y.mjs [--axe <axe.min.js>] [--chrome <path>]');
      process.exit(2);
    }
  }
  return opts;
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// The axe-core source, from --axe or the cache in the temp folder (downloaded if missing).
async function axeSource(local) {
  const file = local || join(tmpdir(), 'cer-axe-' + AXE_VERSION, 'axe.min.js');
  if (!existsSync(file)) {
    if (local) throw new Error('No such file: ' + local);
    console.log(`Downloading axe-core ${AXE_VERSION} into ${dirname(file)} …`);
    const res = await fetch(AXE_URL);
    if (!res.ok) throw new Error(`Could not download ${AXE_URL} (HTTP ${res.status}). Download it yourself and pass --axe <file>.`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Check before saving, so a bad download is never cached.
    if (sha256(buf) !== AXE_SHA256) throw new Error(`${AXE_URL} does not have the expected SHA-256. Not running it.`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
  }
  const buf = readFileSync(file);
  if (sha256(buf) !== AXE_SHA256) throw new Error(`${file} is not axe-core ${AXE_VERSION} (SHA-256 differs). Delete it, or pass the right file with --axe.`);
  return buf.toString('utf8');
}

/* ---------- The pages and states axe checks ---------- */

// Items of the sample data that show the most: chosen from the data, so the list survives
// changes to the sample export.
const PICK = `(() => {
  const DB = ExportReader.DB();
  const by = (list, score) => list.slice().sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1))[0];
  const art = DB.artifacts.filter(a => a.kind !== 'page');
  const html = art.find(a => a.contentType !== 'Slides' && a.contentType !== 'Design') || art[0];
  return {
    person: by(realPeople(), p => p.total()).id,
    conv: by(DB.conversations.filter(c => !c.empty), c => c.toolCount + c.forks * 5).id,
    html: html.id, htmlVersion: html.activeVersion,
    slides: (DB.artifacts.find(a => a.contentType === 'Slides') || html).id,
    design: (DB.artifacts.find(a => a.contentType === 'Design') || html).id,
    page: (DB.artifacts.find(a => a.kind === 'page') || html).id,
    project: by(DB.projects, x => x.docs.length).id,
    memory: [...DB.memoryByPerson.keys()].sort()[0],
    designChat: by(DB.designChats, d => d.msgCount).id,
  };
})()`;

/* Each state: a route, and an optional setup that runs in the page after it is drawn.
 * open: open every collapsed block first (tool calls, thinking, files…). */
function states(ids) {
  const e = encodeURIComponent;
  const click = sel => `document.querySelector(${JSON.stringify(sel)}).click()`;
  return [
    { name: 'start', route: '#/' },
    { name: 'people', route: '#/people' },
    { name: 'people, with those who have no data', route: '#/people', setup: click('#people-empty') },
    { name: 'person overview', route: '#/person/' + e(ids.person) },
    ...['conversations', 'artifacts', 'projects', 'design', 'memory', 'comments']
      .map(t => ({ name: 'person tab ' + t, route: `#/person/${e(ids.person)}/${t}` })),
    { name: 'conversation list', route: '#/conversations' },
    { name: 'conversation, every block open', route: '#/c/' + e(ids.conv), open: true },
    { name: 'artifact list', route: '#/artifacts' },
    { name: 'HTML artifact', route: '#/a/' + e(ids.html) },
    { name: 'artifact source', route: `#/a/${e(ids.html)}/${e(ids.htmlVersion)}?view=source` },
    { name: 'artifact files', route: `#/a/${e(ids.html)}/${e(ids.htmlVersion)}?view=files` },
    { name: 'artifact in full screen', route: '#/a/' + e(ids.html), setup: click('[aria-label="Full screen"]') },
    { name: 'Slides artifact', route: '#/a/' + e(ids.slides) },
    { name: 'Design artifact', route: '#/a/' + e(ids.design) },
    { name: 'Docs page', route: '#/a/' + e(ids.page) },
    { name: 'project list', route: '#/projects' },
    { name: 'project, every block open', route: '#/p/' + e(ids.project), open: true },
    { name: 'design chat list', route: '#/design' },
    { name: 'design chat, every block open', route: '#/d/' + e(ids.designChat), open: true },
    { name: 'memory list', route: '#/memories' },
    { name: 'memory, every block open', route: '#/memory/' + e(ids.memory), open: true },
    { name: 'search results', route: '#/search?q=onboarding&t=all' },
    { name: 'deep search results', route: '#/search?q=campaign&deep=1&t=all' },
    { name: 'about this export', route: '#/about' },
    { name: 'person picker open', route: '#/', setup: click('#person-btn') },
    { name: 'download dialog open', route: '#/person/' + e(ids.person), setup: `[...document.querySelectorAll('#main button')].find(b => /Download their data/.test(b.textContent)).click()` },
    { name: 'menu open (phone)', route: '#/', setup: click('#menu-btn'), phone: true },
  ];
}

/* ---------- Driving the page ---------- */

const KEYS = {
  Tab: { code: 'Tab', vk: 9 }, Enter: { code: 'Enter', vk: 13, text: '\r' }, Escape: { code: 'Escape', vk: 27 },
};

async function openReader(chrome, { theme = 'light', size = SIZES[0], motion = 'no-preference', demo = true } = {}) {
  const tab = await chrome.openPage();
  await tab.send('Page.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: motion }] });
  await tab.send('Page.navigate', { url: PAGE + (demo ? '?demo' : '') });
  await tab.waitFor(demo ? `!!(window.ExportReader && !document.getElementById('shell').hidden)` : '!!window.ExportReader');
  // Real key presses, so the browser moves the focus and clicks as it does for a person.
  tab.press = async key => {
    const k = KEYS[key];
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: k.code, windowsVirtualKeyCode: k.vk });
    await sleep(150);
  };
  // Opens a route (drawn again when it is the current one) and waits until the page is quiet.
  tab.go = async route => {
    await tab.evaluate(`(r => { window.__a11yQuiet(); if (location.hash === r) onRoute(); else location.hash = r; })(${JSON.stringify(route)})`);
    await tab.settle();
  };
  // Quiet: the page has not changed for 300 ms (previews built, searches done), or 8 s passed.
  tab.settle = () => tab.evaluate(`new Promise(done => {
    const end = Date.now() + 8000;
    const tick = () => (Date.now() - window.__a11yLast > 300 || Date.now() > end ? done() : setTimeout(tick, 50));
    tick();
  })`);
  await tab.evaluate(`(() => {
    window.__a11yQuiet = () => { window.__a11yLast = Date.now(); };
    window.__a11yQuiet();
    new MutationObserver(window.__a11yQuiet).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  })()`);
  return tab;
}

// Opens every collapsed block, then the blocks that appear inside them, and so on.
async function openAll(tab) {
  for (let i = 0; i < 8; i++) {
    const n = await tab.evaluate(`(() => { const l = document.querySelectorAll('#main details:not([open])'); l.forEach(d => { d.open = true; }); return l.length; })()`);
    if (!n) break;
    await tab.settle();
  }
}

// axe on the current page. Export content runs in sandboxed frames: that is the artifact's
// own HTML, not the reader's, so the frames are left out.
async function axe(tab, source) {
  if (!(await tab.evaluate('!!window.axe'))) await tab.evaluate(source + '\n;0');
  return tab.evaluate(`axe.run({ exclude: [['iframe']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
    .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.map(n => n.target.join(' ') + ' (' + n.failureSummary.split('\\n').slice(1).join(' ').trim() + ')') })))`);
}

/* ---------- Keyboard checks ---------- */

// Each check gets a fresh reader and returns a list of problems (empty when it passes).
const describe = `(() => { const a = document.activeElement;
  if (!a || a === document.body) return 'nothing';
  return a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"'; })()`;

const KEYBOARD = [
  ['the skip link is the first Tab stop', async tab => {
    await tab.press('Tab');
    return (await tab.evaluate(`document.activeElement.className`)) === 'skip-link' ? [] : ['the first Tab stop is ' + await tab.evaluate(describe)];
  }, { demo: false }],
  ['the skip link leads to the page heading', async tab => {
    await tab.evaluate(`document.querySelector('.skip-link').focus()`);
    await tab.press('Enter');
    return (await tab.evaluate(`document.activeElement === document.querySelector('#main h1')`)) ? [] : ['the skip link moved the focus to ' + await tab.evaluate(describe)];
  }],
  ['a route change moves the focus to the new page heading', async tab => {
    await tab.evaluate(`document.querySelector('#sidebar a[href="#/conversations"]').focus()`);
    await tab.press('Enter');
    await tab.settle();
    return (await tab.evaluate(`document.activeElement === document.querySelector('#main h1')`)) ? [] : ['after a sidebar link the focus is on ' + await tab.evaluate(describe)];
  }],
  ['a change in place keeps the focus on its control', async (tab, ids) => {
    await tab.go('#/a/' + encodeURIComponent(ids.html));
    await tab.evaluate(`document.getElementById('art-view-source').focus()`);
    await tab.press('Enter');
    await tab.settle();
    return (await tab.evaluate(`document.activeElement.id`)) === 'art-view-source' ? [] : ['after Source the focus is on ' + await tab.evaluate(describe)];
  }],
  ['the person picker opens with the focus inside and Escape closes it', async tab => {
    await tab.evaluate(`document.getElementById('person-btn').focus()`);
    await tab.press('Enter');
    const out = [];
    if (await tab.evaluate(`document.activeElement.id`) !== 'picker-q') out.push('opened, but the focus is on ' + await tab.evaluate(describe));
    await tab.press('Escape');
    if (!(await tab.evaluate(`document.getElementById('picker').hidden`))) out.push('Escape did not close it');
    if (await tab.evaluate(`document.activeElement.id`) !== 'person-btn') out.push('after Escape the focus is on ' + await tab.evaluate(describe));
    return out;
  }],
  ['the download dialog keeps the focus inside and gives it back', async (tab, ids) => {
    await tab.go('#/person/' + encodeURIComponent(ids.person));
    await tab.evaluate(`[...document.querySelectorAll('#main button')].find(b => /Download their data/.test(b.textContent)).focus()`);
    await tab.press('Enter');
    const out = [];
    for (let i = 0; i < 6; i++) {
      if (!(await tab.evaluate(`!!document.activeElement.closest('[role=dialog]') || document.activeElement === document.body`))) out.push('Tab left the dialog, to ' + await tab.evaluate(describe));
      await tab.press('Tab');
    }
    await tab.press('Escape');
    if (await tab.evaluate(`!!document.querySelector('.modal-back')`)) out.push('Escape did not close it');
    if (!/Download their data/.test(await tab.evaluate(describe))) out.push('after Escape the focus is on ' + await tab.evaluate(describe));
    return [...new Set(out)];
  }],
  ['full screen keeps the focus inside and Escape gives it back', async (tab, ids) => {
    await tab.go('#/a/' + encodeURIComponent(ids.html));
    await tab.evaluate(`document.querySelector('[aria-label="Full screen"]').focus()`);
    await tab.press('Enter');
    const out = [];
    for (let i = 0; i < 10; i++) {
      await tab.press('Tab');
      if (!(await tab.evaluate(`!!document.activeElement.closest('.frame-box.full') || document.activeElement === document.body`))) out.push('Tab left the full-screen preview, to ' + await tab.evaluate(describe));
    }
    await tab.evaluate(`document.querySelector('[aria-label="Full screen"]').focus()`);
    await tab.press('Escape');
    if (await tab.evaluate(`!!document.querySelector('.frame-box.full')`)) out.push('Escape did not leave full screen');
    if (await tab.evaluate(`document.getElementById('sidebar').inert`)) out.push('the page stayed inert');
    return [...new Set(out)];
  }],
  ['every Tab stop shows a focus ring', async (tab, ids) => {
    const out = [];
    for (const route of ['#/', '#/c/' + encodeURIComponent(ids.conv)]) {
      await tab.go(route);
      for (let i = 0; i < 60; i++) {
        await tab.press('Tab');
        const ring = await tab.evaluate(`(() => { const a = document.activeElement;
          if (!a || a === document.body || a.tagName === 'IFRAME') return true;
          const s = getComputedStyle(a);
          return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; })()`);
        if (!ring) out.push(route + ': no focus ring on ' + await tab.evaluate(describe));
      }
    }
    return out;
  }],
  ['less motion turns off animations', async tab => {
    const d = await tab.evaluate(`(() => { const el = document.createElement('div'); el.className = 'flash'; document.body.appendChild(el);
      const v = parseFloat(getComputedStyle(el).animationDuration); el.remove(); return v; })()`);
    return d < 0.01 ? [] : ['the flash animation still lasts ' + d + ' s'];
  }, { motion: 'reduce' }],
];

/* ---------- Main ---------- */

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(DIST) || readFileSync(DIST, 'utf8') !== build()) {
  console.error('dist/claude-export-reader.html is missing or out of date. Run "npm run build" first.');
  process.exit(2);
}
const source = await axeSource(opts.axe);
const t0 = Date.now();
let problems = 0, runs = 0;
const report = (label, list) => {
  runs++;
  if (!list.length) return;
  problems += list.length;
  console.log(`\nFAIL ${label}`);
  for (const p of list) console.log('  ' + p);
};

const chrome = await launchChrome(opts.chrome);
try {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      // The start screen, before any data is loaded.
      const landing = await openReader(chrome, { theme, size, demo: false });
      await landing.evaluate(`document.querySelector('.help').open = true`);
      report(`[${size.name}, ${theme}] start screen`, (await axe(landing, source)).map(fmt));

      const tab = await openReader(chrome, { theme, size });
      const ids = await tab.evaluate(PICK);
      for (const st of states(ids)) {
        if (st.phone && size.name !== 'phone') continue;
        // Leaving a page also closes its dialog, picker, menu or full screen.
        await tab.go(st.route);
        if (st.open) await openAll(tab);
        if (st.setup) { await tab.evaluate(st.setup); await tab.settle(); }
        report(`[${size.name}, ${theme}] ${st.name}`, (await axe(tab, source)).map(fmt));
      }
    }
  }
  for (const [name, check, o] of KEYBOARD) {
    const tab = await openReader(chrome, o);
    report('keyboard: ' + name, await check(tab, o && o.demo === false ? {} : await tab.evaluate(PICK)));
  }
} finally {
  await chrome.close();
}

function fmt(v) {
  return `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 5).join('\n    ')}${v.nodes.length > 5 ? `\n    … and ${v.nodes.length - 5} more` : ''}`;
}

console.log(`\n${problems ? 'FAILED' : 'PASSED'}: ${runs} checks (axe-core ${AXE_VERSION}, ${AXE_TAGS.join(', ')}), ` +
  `${problems} problem${problems === 1 ? '' : 's'} (${Math.round((Date.now() - t0) / 1000)} s).`);
process.exit(problems ? 1 : 0);
