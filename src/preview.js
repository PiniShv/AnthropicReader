/* Artifact previews: turns a version's files into one HTML document for a sandboxed srcdoc
 * frame (multi-file HTML, Slides, Design). The artifact page in views-art.js shows it. */
'use strict';

// Built previews, keyed by artifact + version + board. Building can take seconds for big
// versions, so switching between Preview / Source / Files must not redo it.
// Files added later can complete a version (one version can be split across two zips), so
// the cache starts again whenever finalize() runs, like the search index.
const BUILD_CACHE = new Map();
const BUILD_CACHE_MAX = 4;
let BUILD_GEN = -1;

async function getBuilt(a, vid, info, board) {
  if (BUILD_GEN !== DB.generation) { BUILD_CACHE.clear(); BUILD_GEN = DB.generation; }
  const key = a.id + '|' + vid + '|' + (board || '');
  if (BUILD_CACHE.has(key)) return BUILD_CACHE.get(key);
  const p = buildVersionHtml(a, vid, info, board);
  BUILD_CACHE.set(key, p);
  // A build that fails after the cache started again must not remove a newer entry.
  p.catch(() => { if (BUILD_CACHE.get(key) === p) BUILD_CACHE.delete(key); });
  while (BUILD_CACHE.size > BUILD_CACHE_MAX) BUILD_CACHE.delete(BUILD_CACHE.keys().next().value);
  return p;
}

// Raw source of a version's entry file, without inlining anything.
async function versionSource(info) {
  const s = info.slot;
  if (s.single) return s.single.text();
  for (const k of ['index.html', 'project/deck.json', 'project/canvas.json']) if (s.folder.has(k)) return s.folder.get(k).text();
  return null;
}

function platformNotes(html) {
  const n = [];
  if (/\/_blob\/|\/_runtime\/|\/_f\/|\/_cas\//.test(html)) n.push('Some images, fonts or scripts are hosted on claude.ai and are not in the export, so parts may look broken.');
  if (/window\.claude/.test(html)) n.push('This artifact uses live claude.ai features (shared data, the viewer’s identity…). They do not work offline.');
  return n;
}

/* ---------- Inlining files ---------- */

const INLINE_TOTAL_CAP = 120 * 1024 * 1024;   // all data: URLs in one preview
const INLINE_MEDIA_CAP = 2 * 1024 * 1024;     // larger videos/audio stay out (open them from Files)
const LOOKUP_TOTAL_CAP = 30 * 1024 * 1024;    // files offered to the in-frame lookup
const LOOKUP_FILE_CAP = 4 * 1024 * 1024;
const isMedia = p => /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)$/i.test(p);

// The files under baseDir, with paths relative to it.
function subFolder(folder, baseDir) {
  const files = new Map();
  for (const [p, node] of folder) if (p.startsWith(baseDir)) files.set(p.slice(baseDir.length), node);
  return files;
}

// The files one build has encoded, so each is read and encoded once, even when every slide
// uses it: node -> { url, len }. Stylesheets with their url()s resolved are kept apart.
const newEncoding = () => ({ raw: new Map(), css: new Map() });

async function encodeFile(node, name, enc) {
  let e = enc.raw.get(node);
  if (!e) {
    const bytes = await node.bytes();
    e = { url: dataUrl(name, bytes), len: bytes.length };
    enc.raw.set(node, e);
  }
  return e;
}

// A stylesheet, with the url()s inside it resolved relative to the stylesheet's folder.
async function encodeCss(node, ref, files, enc) {
  let e = enc.css.get(node);
  if (!e) {
    const dir = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : '';
    let css = new TextDecoder().decode(await node.bytes());
    const urls = new Set();
    css.replace(/url\(\s*["']?([^"')#?]+)["']?\s*\)/g, (all, u) => { urls.add(u); return all; });
    for (const u of urls) {
      const full = dir + u.replace(/^\.\//, '');
      if (files.has(full) && !(isMedia(full) && files.get(full).size > INLINE_MEDIA_CAP)) css = css.split(u).join((await encodeFile(files.get(full), full, enc)).url);
    }
    const bytes = new TextEncoder().encode(css);
    e = { url: dataUrl(ref, bytes), len: bytes.length };
    enc.css.set(node, e);
  }
  return e;
}

/* Inline sibling files as data: URLs so relative references work inside a sandboxed srcdoc
 * frame (it cannot load the reader's blob: URLs). Literal src/href/url()/fetch() references
 * are replaced in the text. files: paths relative to the html (subFolder). opts.skip(path)
 * leaves a file alone. inlined maps each inlined path to its data: URL. */
async function inlineRefs(html, files, enc, opts) {
  const skip = (opts && opts.skip) || (() => false);
  const refs = new Set();
  const re = /(?:src|href|poster|data-src)\s*=\s*["']([^"'#?]+)[^"']*["']|url\(\s*["']?([^"')#?]+)[^"')]*["']?\s*\)|fetch\(\s*["'`]([^"'`]+)["'`]/gi;
  let m;
  while ((m = re.exec(html))) {
    const ref = (m[1] || m[2] || m[3] || '').trim().replace(/^\.\//, '');
    if (ref && !/^(https?:|data:|blob:|mailto:|javascript:|\/)/i.test(ref) && files.has(ref) && !skip(ref)) refs.add(ref);
  }
  const inlined = {};
  let total = 0, skippedMedia = 0, skippedBig = false;
  for (const ref of refs) {
    const node = files.get(ref);
    if (isMedia(ref) && node.size > INLINE_MEDIA_CAP) { skippedMedia++; continue; }
    if (total + node.size > INLINE_TOTAL_CAP) { skippedBig = true; continue; }
    const e = fileExt(ref) === 'css' ? await encodeCss(node, ref, files, enc) : await encodeFile(node, ref, enc);
    total += e.len;
    inlined[ref] = e.url;
  }
  let out = html;
  for (const ref of Object.keys(inlined).sort((x, y) => y.length - x.length)) {
    const url = inlined[ref];
    out = out.split('"' + ref + '"').join('"' + url + '"')
      .split("'" + ref + "'").join("'" + url + "'")
      .split('"./' + ref + '"').join('"' + url + '"')
      .split("'./" + ref + "'").join("'" + url + "'")
      .split('(' + ref + ')').join('(' + url + ')');
  }
  const notes = [];
  if (skippedMedia) notes.push(`${skippedMedia} large video or audio file(s) are not embedded in the preview. Open them from the Files tab.`);
  if (skippedBig) notes.push('Some large assets were left out to keep the page responsive.');
  return { html: out, notes, inlined };
}

// Everything else in the folder that a script might ask for (e.g. 'icons/' + name + '.png').
// assetLookupScript() serves these to fetch, XHR and src/href attributes in the frame.
async function assetLookup(files, inlined, enc, opts) {
  const skip = (opts && opts.skip) || (() => false);
  const lookup = {};
  let total = 0;
  for (const [p, node] of files) {
    if (inlined[p] || skip(p) || isPlumbing(p) || /\.(md|dc\.html)$/i.test(p) || isMedia(p)) continue;
    if (node.size > LOOKUP_FILE_CAP || total + node.size > LOOKUP_TOTAL_CAP) continue;
    lookup[p] = (await encodeFile(node, p, enc)).url;
    total += node.size;
  }
  return lookup;
}

// In-frame lookup for files whose paths are only known at run time.
function assetLookupScript(lookup) {
  if (!lookup || !Object.keys(lookup).length) return '';
  const json = JSON.stringify(lookup).replace(/</g, '\\u003c');
  return '<script>/* Claude Export Reader: local files */(function(){var M=' + json + ';' +
    'function k(u){if(typeof u!=="string"||/^(data:|blob:|https?:|\\/\\/|#|mailto:|javascript:)/i.test(u))return null;' +
    'u=u.replace(/^\\.\\//,"").split("#")[0].split("?")[0];return Object.prototype.hasOwnProperty.call(M,u)?M[u]:null}' +
    'var F=window.fetch;if(F)window.fetch=function(u,o){var d=k(typeof u==="string"?u:(u&&u.url));return d?F.call(this,d,o):F.apply(this,arguments)};' +
    'var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var d=k(u);if(d)arguments[1]=d;return O.apply(this,arguments)};' +
    'function fix(el){if(!el.getAttribute)return;["src","href","poster"].forEach(function(a){var d=k(el.getAttribute(a));if(d)el.setAttribute(a,d)})}' +
    'new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==="attributes")fix(m.target);else m.addedNodes.forEach(function(n){if(n.nodeType===1){fix(n);if(n.querySelectorAll)n.querySelectorAll("[src],[href],[poster]").forEach(fix)}})})})' +
    '.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["src","href","poster"]});})();<\/script>';
}

// A file's bytes as a data: URL, with the type from its name.
function dataUrl(name, bytes) {
  return 'data:' + mimeFor(name) + ';base64,' + b64(bytes);
}

function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/* ---------- Builders ---------- */

async function buildVersionHtml(a, vid, info, board) {
  const s = info.slot;
  if (s.single) {
    const html = await s.single.text();
    return { html: withFrameShim(html), source: html, notes: platformNotes(html) };
  }
  const f = s.folder;
  if (info.type === 'Slides') return buildSlides(f);
  if (info.type === 'Design') return buildDesign(f, board);
  if (info.typedEmpty) {
    return { html: null, source: null, notes: [], empty: 'This version is an app (Slides or Design type) whose content lived in claude.ai’s database. That data is not part of the export. Use the Files tab to see what is there.' };
  }
  if (f.has('index.html')) {
    const raw = await f.get('index.html').text();
    const enc = newEncoding();
    const r = await inlineRefs(raw, f, enc);
    const lookup = await assetLookup(f, r.inlined, enc);
    return { html: withFrameShim(r.html, assetLookupScript(lookup)), source: raw, notes: platformNotes(raw).concat(r.notes) };
  }
  return { html: null, source: null, notes: [], empty: 'No index.html in this version. See the Files tab.' };
}

async function buildSlides(f) {
  let deck = null;
  try { if (f.has('project/deck.json')) deck = JSON.parse(await f.get('project/deck.json').text()); } catch (e) { deck = null; }
  const slideFiles = Array.from(f.keys()).filter(k => /^project\/slides\/[^/]+\.html$/.test(k)).sort();
  const ids = deck && Array.isArray(deck.order) ? deck.order : slideFiles.map(k => k.replace(/^project\/slides\//, '').replace(/\.html$/, ''));
  const sectionAt = new Map();
  if (deck && deck.sections) for (const s of Object.values(deck.sections)) if (s && s.start) sectionAt.set(s.start, s.description || '');
  const faces = deck && deck.faces ? Object.values(deck.faces).map(x => x && x.href).filter(Boolean) : [];
  // Slides refer to files next to them first, then to the project folder. They share images.
  const slideDir = subFolder(f, 'project/slides/'), projectDir = subFolder(f, 'project/');
  const enc = newEncoding();
  const parts = [];
  let missing = 0, n = 0;
  for (const id of ids) {
    const node = f.get('project/slides/' + id + '.html');
    if (sectionAt.has(id) && sectionAt.get(id)) parts.push(`<h2 class="sec" dir="auto">${esc(sectionAt.get(id))}</h2>`);
    n++;
    if (!node) { missing++; parts.push(`<div class="wrap"><div class="slide missing">Slide “${esc(id)}” is listed but its file is not in the export.</div></div>`); continue; }
    let html = await node.text();
    html = (await inlineRefs(html, slideDir, enc)).html;
    html = (await inlineRefs(html, projectDir, enc)).html;
    // Speaker notes live in <aside>; claude.ai hides them on the slide. Show them below instead.
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const notes = Array.from(tpl.content.querySelectorAll('aside')).map(x => x.textContent.trim()).filter(Boolean).join('\n\n');
    parts.push(`<div class="wrap"><div class="num">${n}</div><div class="slide">${html}</div></div>` +
      (notes ? `<details class="notes"><summary>Speaker notes</summary><div dir="auto">${esc(notes)}</div></details>` : ''));
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
${faces.map(h => `<link rel="stylesheet" href="${esc(h)}">`).join('\n')}
<style>
 html,body{margin:0;background:#2b2a2e;font-family:system-ui,sans-serif}
 .deck{padding:24px 16px 48px;display:flex;flex-direction:column;align-items:center;gap:22px}
 h1{color:#fff;font-size:20px;margin:0 0 4px}
 .sec{color:#ddd;font-size:15px;font-weight:600;margin:14px 0 -8px;align-self:flex-start;max-width:100%}
 .wrap{position:relative;width:100%;max-width:1100px;aspect-ratio:16/9;overflow:hidden;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.4);background:#fff}
 .num{position:absolute;right:8px;bottom:6px;z-index:5;font-size:11px;color:#888;background:rgba(255,255,255,.8);padding:1px 6px;border-radius:8px}
 .slide{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden}
 /* What the claude.ai slide runtime normally provides: a full-size section, no stray margins, hidden notes. */
 .slide>section{box-sizing:border-box;width:1920px;height:1080px;overflow:hidden;margin:0}
 .slide section *{margin:0}
 .slide aside{display:none}
 .slide.missing{display:flex;align-items:center;justify-content:center;font-size:40px;color:#999}
 .notes{width:100%;max-width:1100px;margin-top:-12px;color:#ccc;font-size:14px}
 .notes summary{cursor:pointer;color:#aaa}
 .notes div{white-space:pre-wrap;padding:6px 2px}
</style></head><body><div class="deck">
<h1 dir="auto">${esc((deck && deck.title) || 'Slides')}</h1>
${parts.join('\n')}
</div><script>
 function fit(){document.querySelectorAll('.wrap').forEach(function(w){var s=w.clientWidth/1920;w.querySelector('.slide').style.transform='scale('+s+')';});}
 addEventListener('resize',fit);fit();
<\/script></body></html>`;
  const notes = ['Slides are drawn from the exported slide files. Animations and claude.ai-hosted images may be missing.'];
  if (missing) notes.push(missing + ' slide(s) are listed in the deck but missing from the export.');
  return { html: withFrameShim(doc), source: deck ? JSON.stringify(deck, null, 2) : null, notes };
}

// Links between boards ("Queue.dc.html") ask the reader to switch boards instead of loading raw HTML.
const BOARD_LINK_SCRIPT = '<script>/* Claude Export Reader: board links */document.addEventListener("click",function(e){' +
  'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a||e.defaultPrevented)return;' +
  'var h=(a.getAttribute("href")||"").replace(/^\\.\\//,"");if(!/^[^:\\/?#]+\\.dc\\.html$/i.test(h))return;' +
  'e.preventDefault();parent.postMessage({cerBoard:decodeURIComponent(h)},"*");});<\/script>';

async function buildDesign(f, boardWanted) {
  let canvas = null;
  try { canvas = JSON.parse(await f.get('project/canvas.json').text()); } catch (e) { canvas = null; }
  const order = canvas && Array.isArray(canvas.order) ? canvas.order : Array.from(f.keys()).filter(k => /^project\/[^/]+\.dc\.html$/.test(k)).map(k => k.slice(8));
  const boards = (canvas && canvas.boards) || {};
  const launch = canvas && canvas.launch && canvas.launch.file;
  const present = order.filter(b => f.has('project/' + b));
  // Without a launch file, skip near-empty placeholder boards (a few hundred bytes).
  const firstReal = present.find(b => f.get('project/' + b).size > 1024) || present[0];
  const board = present.includes(boardWanted) ? boardWanted : (present.includes(launch) ? launch : firstReal);
  const notesList = canvas && canvas.notes ? Object.values(canvas.notes).filter(x => x && x.text) : [];
  // Plain data, not markup: the result is cached across pages, and the picker's handler is not.
  const picker = present.length > 1 ? { list: present.map(b => ({ file: b, title: (boards[b] && boards[b].title) || b })), current: board } : null;
  if (!board) return { html: null, source: canvas ? JSON.stringify(canvas, null, 2) : null, notes: [], empty: 'The design’s board files are not in the export.' };
  let html = await f.get('project/' + board).text();
  // Boards load ./support.js from the platform; it is not exported, so give them an empty stub.
  html = html.replace(/<script[^>]+src=["']\.?\/?support\.js["'][^>]*>\s*<\/script>/gi, '<script>/* support.js not in export */<\/script>');
  const files = subFolder(f, 'project/');
  const opts = { skip: p => /\.dc\.html$/i.test(p) };
  const enc = newEncoding();
  const r = await inlineRefs(html, files, enc, opts);
  const lookup = await assetLookup(files, r.inlined, enc, opts);
  const notes = ['Design boards are shown one at a time. Some interactive parts need claude.ai and may not work.'];
  if (order.length > present.length) notes.push((order.length - present.length) + ' board(s) are listed but missing from the export.');
  if (notesList.length) notes.push('Canvas notes: ' + notesList.map(n => oneLine(n.text)).join(' · ').slice(0, 600));
  return { html: withFrameShim(r.html, assetLookupScript(lookup) + BOARD_LINK_SCRIPT), source: canvas ? JSON.stringify(canvas, null, 2) : null, notes: notes.concat(r.notes, platformNotes(html)), boards: picker };
}
