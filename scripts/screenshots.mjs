#!/usr/bin/env node
// Regenerates the README screenshots from the made-up sample data (never real exports).
// Drives a local headless Chrome over the DevTools protocol; no dependencies (Node 22+).
//
//   npm run build && node scripts/screenshots.mjs [path-to-chrome]

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = pathToFileURL(join(ROOT, 'dist', 'claude-export-reader.html')).href + '?demo';
const OUT = join(ROOT, 'docs', 'screenshots');
const CHROME = process.argv[2] || process.env.CHROME ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const WIDTH = 1280, HEIGHT = 800, SCALE = 2;

// Each shot: a route, plus an optional page script that sets it up (expand a block, scroll…).
const SHOTS = [
  { name: 'home', route: '#/' },
  { name: 'person', route: () => `#/person/${encodeURIComponent(pick('busiest-person'))}` },
  { name: 'conversation', route: () => `#/c/${encodeURIComponent(pick('rich-conversation'))}` },
  { name: 'artifact', route: () => `#/a/${encodeURIComponent(pick('slides-artifact'))}`, settle: 2500 },
];

let ids = {};
const pick = key => ids[key];

const profile = mkdtempSync(join(tmpdir(), 'cer-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', code => reject(new Error('Chrome exited early (' + code + '). Pass its path as the first argument.')));
});

const browser = new WebSocket(wsUrl);
await new Promise(r => browser.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
browser.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  browser.send(JSON.stringify({ id, method, params, sessionId }));
});

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expr => (await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expr, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 150))) {
      if (await evaluate(expr)) return;
    }
    throw new Error('Timed out waiting for: ' + expr);
  };

  await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page('Page.navigate', { url: PAGE });
  await waitFor(`!!(window.ExportReader && document.querySelector('#shell') && !document.querySelector('#shell').hidden)`);

  // Choose showcase items from the sample data itself, so the script survives demo changes.
  ids = await evaluate(`(() => {
    const DB = ExportReader.DB();
    const people = [...DB.people.values()].filter(p => !p.system).sort((a, b) => b.total() - a.total());
    const conv = DB.conversations.filter(c => !c.empty).sort((a, b) => (b.toolCount + b.forks * 5) - (a.toolCount + a.forks * 5))[0];
    const slides = DB.artifacts.find(a => a.contentType === 'Slides') || DB.artifacts[0];
    return { 'busiest-person': people[0].id, 'rich-conversation': conv.id, 'slides-artifact': slides.id };
  })()`);

  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    const route = typeof shot.route === 'function' ? shot.route() : shot.route;
    await evaluate(`location.hash = ${JSON.stringify(route)}`);
    await new Promise(r => setTimeout(r, shot.settle || 1200));
    const { data } = await page('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, shot.name + '.png'), Buffer.from(data, 'base64'));
    console.log('wrote docs/screenshots/' + shot.name + '.png');
  }
} finally {
  browser.close();
  // Chrome keeps writing to its profile while it shuts down: wait before deleting it.
  await new Promise(r => { chrome.once('exit', r); chrome.kill(); });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
