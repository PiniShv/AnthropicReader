/* Artifacts & pages: list, version viewer, multi-file / Slides / Design / Docs rendering. */
'use strict';

const VIS_LABEL = { private: 'Private', organization: 'Whole team', invited: 'Shared with invited', agent: 'Agent' };
// Descriptions that are the artifact type's own blurb, not something the author wrote.
const TYPE_BLURB = /^(Living docs —|Design canvas for websites|Presentation decks: 16:9 slides)/;

function visChip(a) {
  const v = a.visibility || 'private';
  const sw = a.sharedWith;
  const extra = sw ? ` · ${sw.viewers || 0} viewer${sw.viewers === 1 ? '' : 's'}${sw.editors ? `, ${sw.editors} editor${sw.editors === 1 ? '' : 's'}` : ''}` : '';
  return `<span class="chip${v === 'private' ? '' : ' on'}" title="Visibility">${esc(VIS_LABEL[v] || v)}${esc(extra)}</span>`;
}

function artifactCommentCount(a) {
  let n = 0;
  for (const t of a.comments || []) n += (t && t.comments ? t.comments.length : 0);
  for (const t of a.threads || []) n += (t && t.comments ? t.comments.filter(c => !isDuplicateThreadComment(a, c)).length : 0);
  return n;
}

function artifactTable(list, key, showOwner, facet) {
  const columns = [
    {
      id: 'title', label: 'Title', cls: 'title', link: true, asc: true, sortVal: a => a.title.toLowerCase(),
      html: a => `<div dir="auto">${esc(a.title)}</div>${a.description && !TYPE_BLURB.test(a.description) && a.description !== a.title ? `<div class="snip" dir="auto">${esc(truncate(a.description, 200))}</div>` : ''}
        <div class="row wrap" style="margin-top:5px;gap:4px"><span class="chip">${esc(a.contentType)}</span>${visChip(a)}${artifactCommentCount(a) ? `<span class="chip">🗨 ${artifactCommentCount(a)}</span>` : ''}${a.mentionedIn && a.mentionedIn.length ? `<span class="chip" title="Linked from conversations">💬 ${a.mentionedIn.length}</span>` : ''}</div>`,
    },
  ];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('versions', 'Versions', a => a.versions.length));
  columns.push(COL.date('updated', 'Updated', a => a.updated));
  return tableHtml({
    key, rows: list, columns, sort: 'updated', dir: -1, noun: 'artifact', facet,
    href: a => '#/a/' + encodeURIComponent(a.id),
    text: a => [a.title, a.description, a.contentType, a.kind, a.visibility, VIS_LABEL[a.visibility], a.owner && a.owner.name, a.owner && a.owner.email, a.id, ...a.versions.map(v => v.title)].join(' '),
    placeholder: 'Filter: title, type (slides, doc, html), visibility, person…',
    empty: 'No artifacts.',
  });
}

function viewArtifacts() {
  const fp = focusPerson();
  const list = fp ? fp.artifacts : DB.artifacts;
  return `<div class="page">
    <div class="page-head"><div class="grow"><h1>Artifacts & pages</h1>
      <div class="sub">${fp ? `<span>Only ${personLink(fp)}’s</span>` : ''}<span>${plural(list.length, 'artifact')}</span>${!DB.artifacts.length ? '<span>Load the <b>frames-*.zip</b> files to see artifacts.</span>' : ''}</div></div></div>
    ${artifactTable(list, 'art-' + (fp ? fp.id : 'all'), !fp, { of: a => a.contentType })}
  </div>`;
}

/* ---------- Artifact page ---------- */

function viewArtifact(id, vid) {
  const a = DB.artifactById.get(id);
  if (!a) return notFound('No artifact with this id in the loaded files.');
  const p = a.owner;
  const versions = a.versions;
  const selected = vid && versions.some(v => v.id === vid) ? vid : a.activeVersion;
  const sel = versions.find(v => v.id === selected);
  const isPage = a.kind === 'page';
  const nComments = artifactCommentCount(a);

  after(() => {
    if (isPage) return drawPage(a);
    // A Design board link clicked inside the preview: switch the board picker to it.
    addEventListener('message', e => {
      const f = document.getElementById('art-frame');
      if (!f || e.source !== f.contentWindow || !e.data || typeof e.data.cerBoard !== 'string') return;
      navigate('#/a/' + encodeURIComponent(id) + (vid ? '/' + encodeURIComponent(vid) : '') + '?board=' + encodeURIComponent(e.data.cerBoard), true);
    }, { signal: VIEW.ac.signal });
    return drawVersion(a, selected, App.route.query.view || 'preview');
  });

  const versionList = versions.map(v => {
    const has = isPage || (a.vfiles && a.vfiles.has(v.id));
    const desc = v.description && !TYPE_BLURB.test(v.description) && v.description !== v.title ? decodeEntities(v.description) : '';
    return `<li class="${v.id === selected ? 'sel' : ''}${has ? '' : ' missing'}" ${has && !isPage ? `data-action="pick-version" data-art="${esc(a.id)}" data-vid="${esc(v.id)}"` : ''} title="${esc(v.id)}">
      <div class="vt" dir="auto">${esc(v.title || 'Untitled')}${v.id === a.activeVersion ? ' <span class="chip ok" style="font-size:11px">current</span>' : ''}</div>
      <div class="vd">${esc(fmtDateTime(v.created))}${!isPage ? ' · ' + esc(versionInfo(a, v.id).type) : ''}</div>
      ${desc ? `<div class="vd" dir="auto">${esc(truncate(desc, 140))}</div>` : ''}
    </li>`;
  }).join('');

  return `<div class="page">
    <div class="crumbs"><a href="#/artifacts">Artifacts</a><span>›</span>${p && !p.system ? `${personLink(p)}<span>›</span>` : ''}<span class="ellipsis" style="max-width:420px" dir="auto">${esc(a.title)}</span></div>
    <div class="page-head">
      <div class="grow">
        <h1 dir="auto">${esc(a.title)}</h1>
        <div class="sub">
          ${p && !p.system ? `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)} ${unknownBadge(p)}</span>` : (a.createdByAgent ? '<span class="chip">Made by an agent (no owner)</span>' : '')}
          <span class="chip">${esc(a.contentType)}</span>${visChip(a)}
          <span>Updated ${esc(fmtDateTime(a.updated))}</span>
          <span>${plural(versions.length, 'version')}${versions.length >= 20 ? ' <span class="faint" title="The export seems to keep only the latest 20 versions">(older ones may be cut)</span>' : ''}</span>
          <a href="https://claude.ai/code/artifact/${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer" title="Opens on claude.ai (needs access)">claude.ai ↗</a>
        </div>
        ${sel && sel.description && !TYPE_BLURB.test(sel.description) && sel.description !== sel.title ? `<p class="muted" dir="auto" style="margin:8px 0 0">${esc(decodeEntities(sel.description))}</p>` : ''}
      </div>
    </div>
    <div class="viewer">
      <div id="art-main">${isPage ? '' : `<div class="frame-box"><div class="frame-bar"><span class="muted">Loading…</span></div></div>`}</div>
      <aside>
        ${versions.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Versions</h2><ul class="version-list">${versionList}</ul>${isPage ? '<p class="faint" style="font-size:12.5px;margin:8px 0 0">Docs keep only the current text in the export; older versions are listed for reference.</p>' : ''}</div>` : ''}
        ${a.mentionedIn && a.mentionedIn.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Mentioned in</h2>${a.mentionedIn.map(c => `<div style="padding:4px 0"><a href="#/c/${encodeURIComponent(c.id)}" dir="auto">${esc(c.title || 'Untitled conversation')}</a> <span class="faint" style="font-size:12.5px">${esc(fmtDate(c.lastTs))}</span></div>`).join('')}</div>` : ''}
        ${!isPage && a.threads && a.threads.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Comments <span class="badge">${nComments}</span></h2>${threadCommentsHtml(a)}</div>` : ''}
        <div class="card card-pad side-card"><dl class="kv" style="font-size:13px"><dt>Id</dt><dd class="mono">${esc(a.id)}</dd><dt>Kind</dt><dd>${esc(a.kind)}</dd><dt>Files</dt><dd>${fmtNum(a.files.size)}</dd></dl></div>
      </aside>
    </div>
  </div>`;
}

/* ---------- Versions ---------- */

// Built previews, keyed by artifact + version + board. Building can take seconds for big
// versions, so switching between Preview / Source / Files must not redo it.
const BUILD_CACHE = new Map();
const BUILD_CACHE_MAX = 4;

async function getBuilt(a, vid, info, board) {
  const key = a.id + '|' + vid + '|' + (board || '');
  if (BUILD_CACHE.has(key)) return BUILD_CACHE.get(key);
  const p = buildVersionHtml(a, vid, info, board);
  BUILD_CACHE.set(key, p);
  p.catch(() => BUILD_CACHE.delete(key));
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

async function drawVersion(a, vid, view) {
  const box = $('#art-main');
  if (!box) return;
  const info = versionInfo(a, vid);
  const board = App.route.query.board || '';
  const tabs = [['preview', 'Preview'], ['source', 'Source'], ['files', 'Files']];
  const bar = (extra) => `<div class="frame-bar">
      ${tabs.map(([k, l]) => `<button class="btn small${view === k ? ' primary' : ''}" type="button" data-action="art-view" data-art="${esc(a.id)}" data-vid="${esc(vid)}" data-view="${k}">${l}</button>`).join('')}
      <span class="grow"></span>${extra || ''}
      <button class="btn small" type="button" data-action="art-newtab" data-art="${esc(a.id)}" data-vid="${esc(vid)}" title="Open the preview in a new tab">↗ New tab</button>
      <button class="btn small" type="button" data-action="art-full" title="Full screen (Esc to leave)">⤢</button>
      <button class="btn small" type="button" data-action="art-download" data-art="${esc(a.id)}" data-vid="${esc(vid)}" title="Download this version">⇩</button>
    </div>`;
  box.innerHTML = `<div class="frame-box">${bar()}<div class="empty">Opening ${esc(info.type)}…</div></div>`;
  const { signal } = VIEW.ac;
  try {
    if (!info.slot) { box.innerHTML = `<div class="frame-box">${bar()}<div class="empty">This version has no files in the loaded export.</div></div>`; return; }
    if (view === 'files') {
      box.innerHTML = `<div class="frame-box">${bar()}<div class="card-pad">${versionFilesHtml(a, vid, info)}</div></div>`;
      return;
    }
    if (view === 'source') {
      const src = await versionSource(info);
      if (signal.aborted) return;
      box.innerHTML = `<div class="frame-box">${bar()}<div class="card-pad">${src != null ? preHtml(src) : '<p class="faint">No single source file. See the Files tab.</p>'}</div></div>`;
      return;
    }
    const built = await getBuilt(a, vid, info, board);
    if (signal.aborted) return;
    const notes = built.notes.length ? `<div class="notice" style="border-radius:0;border-width:0 0 1px">${built.notes.map(esc).join('<br>')}</div>` : '';
    if (built.html == null) {
      box.innerHTML = `<div class="frame-box">${bar()}${notes}<div class="empty">${esc(built.empty || 'Nothing to preview.')}</div></div>`;
      return;
    }
    box.innerHTML = `<div class="frame-box" id="art-frame-box">${bar(built.extra)}${notes}<iframe class="preview" id="art-frame" sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer" title="${esc(a.title)}"></iframe></div>`;
    box.querySelector('iframe').srcdoc = built.html;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="frame-box">${bar()}<div class="notice warn">Could not open this version: ${esc(err.message || err)}</div></div>`;
  }
}

function platformNotes(html) {
  const n = [];
  if (/\/_blob\/|\/_runtime\/|\/_f\/|\/_cas\//.test(html)) n.push('Some images, fonts or scripts are hosted on claude.ai and are not in the export, so parts may look broken.');
  if (/window\.claude/.test(html)) n.push('This artifact uses live claude.ai features (shared data, the viewer’s identity…). They do not work offline.');
  return n;
}

const INLINE_TOTAL_CAP = 120 * 1024 * 1024;   // all data: URLs in one preview
const INLINE_MEDIA_CAP = 2 * 1024 * 1024;     // larger videos/audio stay out (open them from Files)
const LOOKUP_TOTAL_CAP = 30 * 1024 * 1024;    // files offered to the in-frame lookup
const LOOKUP_FILE_CAP = 4 * 1024 * 1024;
const isMedia = p => /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)$/i.test(p);
const isPlumbing = p => /^(SKILL\.md$|artifact-type\/)/.test(p);

/* Inline sibling files as data: URLs so relative references work inside a sandboxed srcdoc
 * frame (it cannot load the reader's blob: URLs). Literal src/href/url()/fetch() references
 * are replaced in the text; files whose paths are built in JavaScript are served by a small
 * lookup script (fetch, XHR and src/href attributes). opts.skip(path) leaves a file alone. */
async function inlineAssets(html, folder, baseDir, opts) {
  const skip = (opts && opts.skip) || (() => false);
  const notes = [];
  const files = new Map();
  for (const [p, node] of folder) {
    if (baseDir && !p.startsWith(baseDir)) continue;
    files.set(baseDir ? p.slice(baseDir.length) : p, node);
  }
  const refs = new Set();
  const re = /(?:src|href|poster|data-src)\s*=\s*["']([^"'#?]+)[^"']*["']|url\(\s*["']?([^"')#?]+)[^"')]*["']?\s*\)|fetch\(\s*["'`]([^"'`]+)["'`]/gi;
  let m;
  while ((m = re.exec(html))) {
    const ref = (m[1] || m[2] || m[3] || '').trim().replace(/^\.\//, '');
    if (ref && !/^(https?:|data:|blob:|mailto:|javascript:|\/)/i.test(ref) && files.has(ref) && !skip(ref)) refs.add(ref);
  }
  const map = {};
  let total = 0, skippedMedia = 0, skippedBig = false;
  for (const ref of refs) {
    const node = files.get(ref);
    if (isMedia(ref) && node.size > INLINE_MEDIA_CAP) { skippedMedia++; continue; }
    if (total + node.size > INLINE_TOTAL_CAP) { skippedBig = true; continue; }
    let bytes = await node.bytes();
    if (fileExt(ref) === 'css') {
      // Resolve url() inside stylesheets relative to the stylesheet's folder.
      const dir = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : '';
      let css = new TextDecoder().decode(bytes);
      const urls = new Set();
      css.replace(/url\(\s*["']?([^"')#?]+)["']?\s*\)/g, (all, u) => { urls.add(u); return all; });
      for (const u of urls) {
        const full = dir + u.replace(/^\.\//, '');
        if (files.has(full) && !(isMedia(full) && files.get(full).size > INLINE_MEDIA_CAP)) css = css.split(u).join(await dataUrl(files.get(full), full));
      }
      bytes = new TextEncoder().encode(css);
    }
    total += bytes.length;
    map[ref] = 'data:' + mimeFor(ref) + ';base64,' + b64(bytes);
  }
  let out = html;
  for (const ref of Object.keys(map).sort((x, y) => y.length - x.length)) {
    out = out.split('"' + ref + '"').join('"' + map[ref] + '"')
      .split("'" + ref + "'").join("'" + map[ref] + "'")
      .split('"./' + ref + '"').join('"' + map[ref] + '"')
      .split("'./" + ref + "'").join("'" + map[ref] + "'")
      .split('(' + ref + ')').join('(' + map[ref] + ')');
  }
  // Everything else in the folder that a script might ask for (e.g. 'icons/' + name + '.png').
  const lookup = {};
  let lookupTotal = 0;
  for (const [p, node] of files) {
    if (map[p] || skip(p) || isPlumbing(p) || /\.(md|dc\.html)$/i.test(p) || isMedia(p)) continue;
    if (node.size > LOOKUP_FILE_CAP || lookupTotal + node.size > LOOKUP_TOTAL_CAP) continue;
    lookup[p] = await dataUrl(node, p);
    lookupTotal += node.size;
  }
  if (skippedMedia) notes.push(`${skippedMedia} large video or audio file(s) are not embedded in the preview. Open them from the Files tab.`);
  if (skippedBig) notes.push('Some large assets were left out to keep the page responsive.');
  return { html: out, notes, count: refs.size, lookup };
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

async function dataUrl(node, name) {
  return 'data:' + mimeFor(name) + ';base64,' + b64(await node.bytes());
}

function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

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
    const r = await inlineAssets(raw, f, '');
    return { html: withFrameShim(r.html, assetLookupScript(r.lookup)), source: raw, notes: platformNotes(raw).concat(r.notes) };
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
  const parts = [];
  let missing = 0, n = 0;
  for (const id of ids) {
    const node = f.get('project/slides/' + id + '.html');
    if (sectionAt.has(id) && sectionAt.get(id)) parts.push(`<h2 class="sec" dir="auto">${esc(sectionAt.get(id))}</h2>`);
    n++;
    if (!node) { missing++; parts.push(`<div class="wrap"><div class="slide missing">Slide “${esc(id)}” is listed but its file is not in the export.</div></div>`); continue; }
    let html = await node.text();
    html = (await inlineAssets(html, f, 'project/slides/')).html;
    html = (await inlineAssets(html, f, 'project/')).html;
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
  const extra = present.length > 1 ? `<select class="input" style="padding:3px 8px;font-size:13px" data-action-change="pick-board" aria-label="Board">${present.map(b => `<option value="${esc(b)}"${b === board ? ' selected' : ''}>${esc((boards[b] && boards[b].title) || b)}</option>`).join('')}</select>` : '';
  if (!board) return { html: null, source: canvas ? JSON.stringify(canvas, null, 2) : null, notes: [], empty: 'The design’s board files are not in the export.' };
  let html = await f.get('project/' + board).text();
  // Boards load ./support.js from the platform; it is not exported, so give them an empty stub.
  html = html.replace(/<script[^>]+src=["']\.?\/?support\.js["'][^>]*>\s*<\/script>/gi, '<script>/* support.js not in export */<\/script>');
  const r = await inlineAssets(html, f, 'project/', { skip: p => /\.dc\.html$/i.test(p) });
  const notes = ['Design boards are shown one at a time. Some interactive parts need claude.ai and may not work.'];
  if (order.length > present.length) notes.push((order.length - present.length) + ' board(s) are listed but missing from the export.');
  if (notesList.length) notes.push('Canvas notes: ' + notesList.map(n => oneLine(n.text)).join(' · ').slice(0, 600));
  return { html: withFrameShim(r.html, assetLookupScript(r.lookup) + BOARD_LINK_SCRIPT), source: canvas ? JSON.stringify(canvas, null, 2) : null, notes: notes.concat(r.notes, platformNotes(html)), extra };
}

function versionFilesHtml(a, vid, info) {
  const s = info.slot;
  const rows = [];
  if (s.single) rows.push(['versions/' + vid + '.html', s.single]);
  for (const [p, node] of s.folder) rows.push([p, node]);
  if (s.manifest) rows.push(['versions/' + vid + '.files.json', s.manifest]);
  const plumbing = p => /^(SKILL\.md|artifact-type\/)/.test(p);
  const shown = rows.filter(([p]) => !plumbing(p));
  const hidden = rows.length - shown.length;
  const li = ([p, node]) => `<tr><td class="mono" dir="auto">${esc(p)}</td><td class="num">${fmtBytes(node.size)}</td><td class="right"><button class="btn small" type="button" data-action="art-file" data-art="${esc(a.id)}" data-vid="${esc(vid)}" data-path="${esc(p)}">Open</button></td></tr>`;
  return `<table class="list" style="font-size:13px"><tbody>${shown.map(li).join('')}</tbody></table>
    ${hidden ? `<details class="blk" style="margin-top:10px"><summary><span class="lbl">${hidden} platform files</span><span class="desc">the app runtime and instructions for Claude, not user content</span></summary><div class="blk-body"><table class="list" style="font-size:13px"><tbody>${rows.filter(([p]) => plumbing(p)).map(li).join('')}</tbody></table></div></details>` : ''}
    <div id="art-file-view" style="margin-top:12px"></div>`;
}

async function openArtifactFile(a, vid, path) {
  const info = versionInfo(a, vid);
  const s = info.slot;
  let node = null;
  if (path === 'versions/' + vid + '.html') node = s.single;
  else if (path === 'versions/' + vid + '.files.json') node = s.manifest;
  else node = s.folder.get(path);
  const box = $('#art-file-view');
  if (!node || !box) return;
  const { signal } = VIEW.ac;
  const ext = fileExt(path);
  box.innerHTML = '<p class="muted">Opening…</p>';
  const head = `<div class="row" style="margin-bottom:8px"><b class="mono" dir="auto">${esc(path)}</b><span class="grow"></span><button class="btn small" type="button" data-action="art-file-dl" data-art="${esc(a.id)}" data-vid="${esc(vid)}" data-path="${esc(path)}">Download</button></div>`;
  if (/^(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/.test(ext)) {
    const src = await dataUrl(node, path);
    if (signal.aborted) return;
    box.innerHTML = head + `<img alt="" style="max-width:100%;border:1px solid var(--border);border-radius:6px" src="${src}">`;
  } else if (/^(mp4|webm)$/.test(ext)) {
    const blob = await node.blob(mimeFor(path));
    if (signal.aborted) return;
    box.innerHTML = head + `<video controls style="max-width:100%" src="${URL.createObjectURL(blob)}"></video>`;
  } else if (isTextExt(ext) || node.size < 2e6) {
    const t = await node.text();
    if (signal.aborted) return;
    box.innerHTML = head + (ext === 'md' ? mdBlock(t, { frontmatter: true }) : preHtml(ext === 'json' ? prettyMaybeJson(t) : t));
  } else {
    box.innerHTML = head + '<p class="muted">Binary file; use Download.</p>';
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- Pages (Claude Docs) ---------- */

async function drawPage(a) {
  const box = $('#art-main');
  if (!box) return;
  if (!a.pageNode) { box.innerHTML = '<div class="card empty">This doc has no page.md in the loaded files.</div>'; return; }
  const { signal } = VIEW.ac;
  const md = await a.pageNode.text();
  if (signal.aborted) return;
  const tabs = splitTabs(md);
  const want = App.route.query.tab;
  const idx = Math.max(0, tabs.findIndex(t => t.title === want));
  const tab = tabs[idx] || { title: '', body: md };
  const threads = (a.comments || []).filter(t => !t.tab || t.tab === tab.title || tabs.length === 1);
  const body = tab.body.replace(/!\[([^\]]*)\]\(attachment\)/g, (all, alt) => `*[image not in export${alt ? ': ' + alt : ''}]*`);
  box.innerHTML = `<div class="card">
    ${tabs.length > 1 ? `<div class="tabs" style="margin:0;padding:0 12px">${tabs.map((t, i) => `<button class="tab${i === idx ? ' active' : ''}" type="button" data-action="page-tab" data-art="${esc(a.id)}" data-tab="${esc(t.title)}" dir="auto">${esc(t.title || 'Untitled')}</button>`).join('')}</div>` : ''}
    <div class="card-pad" id="page-body">${mdBlock(body)}</div>
    <div class="frame-bar" style="border-top:1px solid var(--border);border-bottom:0">
      <button class="btn small" type="button" data-action="page-dl" data-art="${esc(a.id)}">Download page.md</button>
      <button class="btn small" type="button" data-action="page-copy" data-art="${esc(a.id)}">Copy Markdown</button>
    </div>
  </div>
  ${(a.comments || []).length ? `<h2 class="section-title">Comments${tabs.length > 1 ? ' on this tab' : ''} <span class="badge">${threads.reduce((n, t) => n + (t.comments || []).length, 0)}</span></h2><div class="card card-pad">${threads.length ? pageCommentsHtml(a, threads) : '<p class="faint">No comments on this tab.</p>'}</div>` : ''}`;
  // Highlight the text each comment thread points at.
  const quotes = threads.map(t => t.quoted_text).filter(q => q && q.replace(/\s/g, '').length >= 3);
  if (quotes.length) highlightIn(box.querySelector('#page-body'), quotes, { firstOnly: true });
}

function splitTabs(md) {
  const re = /^<!--\s*tab:\s*(.*?)\s*-->\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(md))) marks.push({ title: m[1], start: m.index, end: m.index + m[0].length });
  if (!marks.length) return [{ title: '', body: md }];
  return marks.map((mk, i) => ({ title: mk.title, body: md.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : md.length).trim() }));
}

function pageCommentsHtml(a, threads) {
  return threads.map(t => `<div class="comment">
    <div class="row wrap" style="font-size:12.5px;color:var(--muted)">${t.tab ? `<span class="chip" dir="auto">${esc(t.tab)}</span>` : ''}${t.resolved ? '<span class="chip ok">resolved</span>' : ''}</div>
    ${t.quoted_text ? `<div class="quote" dir="auto">“${esc(t.quoted_text)}”</div>` : ''}
    ${(t.comments || []).map(c => {
      const au = c.author && c.author.uuid ? DB.people.get(c.author.uuid) : null;
      const who = c.posted_by_agent ? `Claude <span class="faint">for ${au ? esc(au.name) : 'the owner'}</span>` : (au ? personLink(au) : '<span class="faint">Unknown</span>');
      return `<div class="reply"><div style="font-size:13px"><b>${who}</b> <span class="faint">${esc(fmtDateTime(c.created_at))}</span></div><div dir="auto">${mdToHtml(c.body || '')}</div></div>`;
    }).join('')}
  </div>`).join('') || '<p class="faint">No comments.</p>';
}

function threadCommentsHtml(a) {
  return (a.threads || []).filter(t => (t.comments || []).some(c => !isDuplicateThreadComment(a, c))).map(t => `<div class="comment">
    <div style="font-size:12.5px" class="row wrap">${t.resolved ? '<span class="chip ok">resolved</span>' : '<span class="chip">open</span>'}<span class="faint">${esc(fmtDateTime(t.created_at))}</span></div>
    ${(t.comments || []).filter(c => !isDuplicateThreadComment(a, c)).map(c => {
      const who = c.author_role === 'assistant' ? 'Claude'
        : c.author_role === 'page' ? 'Doc comment'
        : c.author_is_artifact_owner ? (a.owner && !a.owner.system ? esc(a.owner.name) : 'Owner')
        : 'Commenter #' + esc(c.author_index);
      const text = String(c.text || '').replace(/<mention:[^>]+>/g, '@someone');
      return `<div class="reply"><div style="font-size:13px"><b>${who}</b> <span class="faint">${esc(fmtDateTime(c.created_at))}</span>${c.to_claude_at ? ' <span class="chip" style="font-size:11px">sent to Claude</span>' : ''}</div><div dir="auto">${mdToHtml(text)}</div></div>`;
    }).join('')}
  </div>`).join('');
}

/* ---------- Artifact actions ---------- */

// Open the window first (inside the click, so pop-up blockers allow it), then fill it.
// The artifact runs inside a sandboxed frame there too, so it cannot reach this reader.
async function openPreviewTab(a, vid) {
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked. Allow pop-ups for this page, or use Download.'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.title || 'Artifact')}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block;font-family:system-ui,sans-serif}</style></head><body><p style="padding:20px">Opening ${esc(a.title || 'artifact')}…</p></body></html>`);
  w.document.close();
  try {
    const built = await getBuilt(a, vid, versionInfo(a, vid), App.route.query.board || '');
    if (built.html == null) { w.document.body.innerHTML = '<p style="padding:20px">Nothing to preview for this version.</p>'; return; }
    w.document.body.innerHTML = '<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe>';
    w.document.querySelector('iframe').srcdoc = built.html;
  } catch (err) {
    w.document.body.textContent = 'Could not open: ' + (err.message || err);
  }
}

async function downloadVersion(a, vid) {
  const info = versionInfo(a, vid);
  const s = info.slot;
  if (!s) return;
  if (s.single) { downloadBlob(await s.single.blob('text/html'), safeFilename(a.title, 'artifact') + '.html'); return; }
  const zip = new ZipWriter();
  for (const [p, node] of s.folder) zip.add(p, await node.bytes());
  if (s.manifest) zip.add('files.json', await s.manifest.bytes());
  downloadBlob(zip.blob(), safeFilename(a.title, 'artifact') + ' (' + vid + ').zip');
}

function artAction(action, el) {
  const a = el.dataset.art ? DB.artifactById.get(el.dataset.art) : null;
  switch (action) {
    case 'pick-version': navigate('#/a/' + encodeURIComponent(el.dataset.art) + '/' + encodeURIComponent(el.dataset.vid), true); return true;
    case 'art-view': navigate('#/a/' + encodeURIComponent(el.dataset.art) + '/' + encodeURIComponent(el.dataset.vid) + '?view=' + el.dataset.view, true); return true;
    case 'art-full': { const b = $('#art-frame-box') || el.closest('.frame-box'); if (b) b.classList.toggle('full'); return true; }
    case 'art-newtab': if (a) openPreviewTab(a, el.dataset.vid); return true;
    case 'art-download': if (a) downloadVersion(a, el.dataset.vid); return true;
    case 'art-file': if (a) openArtifactFile(a, el.dataset.vid, el.dataset.path); return true;
    case 'art-file-dl': {
      if (!a) return true;
      const s = versionInfo(a, el.dataset.vid).slot;
      const p = el.dataset.path;
      const node = p.startsWith('versions/') ? (p.endsWith('.files.json') ? s.manifest : s.single) : s.folder.get(p);
      if (node) node.blob(mimeFor(p)).then(b => downloadBlob(b, p.split('/').pop()));
      return true;
    }
    case 'page-tab': navigate('#/a/' + encodeURIComponent(el.dataset.art) + '?tab=' + encodeURIComponent(el.dataset.tab), true); return true;
    case 'page-dl': if (a && a.pageNode) a.pageNode.blob('text/markdown').then(b => downloadBlob(b, safeFilename(a.title, 'page') + '.md')); return true;
    case 'page-copy': if (a && a.pageNode) a.pageNode.text().then(copyText); return true;
  }
  return false;
}

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action-change="pick-board"]');
  if (!el) return;
  const r = App.route;
  navigate('#/a/' + encodeURIComponent(r.path[1]) + (r.path[2] ? '/' + encodeURIComponent(r.path[2]) : '') + '?board=' + encodeURIComponent(el.value), true);
});
