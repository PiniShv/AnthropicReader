#!/usr/bin/env node
// Regenerates the README screenshots from the made-up sample data (never real exports).
// Drives a local headless Chrome over the DevTools protocol; no dependencies (Node 22+).
//
//   npm run build && node scripts/screenshots.mjs [path-to-chrome]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, DEFAULT_CHROME } from './lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = pathToFileURL(join(ROOT, 'dist', 'claude-export-reader.html')).href + '?demo';
const OUT = join(ROOT, 'docs', 'screenshots');
const CHROME = process.argv[2] || DEFAULT_CHROME;
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

const chrome = await launchChrome(CHROME);
try {
  const tab = await chrome.openPage();
  const page = (method, params) => tab.send(method, params);
  const { evaluate, waitFor } = tab;

  await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page('Page.navigate', { url: PAGE });
  await waitFor(`!!(window.ExportReader && document.querySelector('#shell') && !document.querySelector('#shell').hidden)`);

  // Choose showcase items from the sample data itself, so the script survives demo changes.
  ids = await evaluate(`(() => {
    const DB = ExportReader.DB();
    const people = realPeople().sort((a, b) => b.total - a.total);
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
  await chrome.close();
}
