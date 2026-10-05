/* App bootstrap: loading screen, routing, global events. */
'use strict';

const App = {
  focus: null,          // Person id that scopes every list, or null
  route: { path: [], query: {} },
  lazy: new Map(),      // per-view lazy renderers for collapsed blocks
  cleanup: [],          // per-view teardown callbacks
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ---------- Theme ---------- */

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
try { applyTheme(localStorage.getItem('cer-theme')); } catch (e) { /* storage blocked */ }

/* ---------- Loading ---------- */

const Loader = {
  rows: new Map(),
  box() { return $('#load-progress'); },
  reset() { this.rows.clear(); this.box().innerHTML = ''; this.box().hidden = false; },
  row(key, label) {
    let r = this.rows.get(key);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'lp-row';
      el.innerHTML = `<span class="lbl"></span><span class="val muted"></span><div class="lp-bar"><i></i></div>`;
      this.box().appendChild(el);
      r = { el };
      this.rows.set(key, r);
    }
    if (label != null) r.el.querySelector('.lbl').textContent = label;
    return r;
  },
  set(key, label, frac, value, state) {
    const r = this.row(key, label);
    if (frac != null) r.el.querySelector('.lp-bar > i').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    if (value != null) r.el.querySelector('.val').textContent = value;
    r.el.classList.toggle('done', state === 'done');
    r.el.classList.toggle('error', state === 'error');
  },
};

async function startLoad(files, handles) {
  if (!files || !files.length) return;
  $('#landing').hidden = false;
  $('#shell').hidden = true;
  Loader.reset();
  $$('#dropzone button').forEach(b => (b.disabled = true));
  try {
    const before = DB.warnings.length;
    await importExport(files, Loader);
    if (handles && handles.length) HandleStore.save(handles);
    const problems = DB.warnings.slice(before);
    if (problems.length) {
      // Do not hide failures behind the app: say what is missing and let the person decide.
      problems.slice(0, 8).forEach((w, i) => Loader.set('warn' + i, w, 1, '', 'error'));
      if (problems.length > 8) Loader.set('warn-more', `…and ${problems.length - 8} more (see “About this export”).`, 1, '', 'error');
      const row = document.createElement('div');
      row.className = 'row wrap';
      row.style.marginTop = '12px';
      row.innerHTML = `<span class="grow muted" style="font-size:14px">Some files could not be read, so part of the data is missing.</span><button class="btn primary" type="button" id="continue-anyway">Continue anyway</button>`;
      Loader.box().appendChild(row);
      $('#continue-anyway').addEventListener('click', showApp);
      return;
    }
    const hasData = DB.conversations.length || DB.projects.length || DB.artifacts.length ||
      DB.designChats.length || DB.memories.length || DB.people.size;
    if (!hasData && DB.manifests.length) { showManifestOnly(); return; }
    showApp();
  } catch (err) {
    console.error(err);
    Loader.set('fatal', 'Could not read the export: ' + (err && err.message ? err.message : err), 1, '', 'error');
  } finally {
    $$('#dropzone button').forEach(b => (b.disabled = false));
  }
}

// Only the manifest was given: offer its download links, then wait for the zips.
function showManifestOnly() {
  const m = latestManifest();
  const box = Loader.box();
  Loader.rows.clear();
  box.hidden = false;
  box.innerHTML = `<h2 style="font-size:17px;margin:0 0 6px">This is your export’s file list</h2>
    <p class="muted" style="margin:0 0 12px;font-size:14px">Exported ${esc(fmtDateTime(m.createdAt))}. Download the ${plural(m.files.length, 'part')} below, then drop the zip files onto this page.</p>
    ${manifestDownloadsHtml(m, m.files)}`;
}

function showApp() {
  $('#landing').hidden = true;
  $('#shell').hidden = false;
  if (App.focus && !DB.people.has(App.focus)) App.focus = null;
  updateFocusButton();
  renderSidebar();
  if (!location.hash || location.hash === '#' || location.hash === '#/') navigate(defaultRoute(), true);
  else onRoute();
}

function defaultRoute() {
  return '#/';
}

async function pickFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      const files = await filesFromHandles(handles);
      return startLoad(files, handles);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      // Fall back to the classic input if the picker is blocked (e.g. some file:// setups).
    }
  }
  $('#file-input').click();
}

async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      Loader.reset();
      Loader.set('scan', 'Listing files in ' + dir.name + '…', 0.05, '');
      const files = await filesFromHandles([dir]);
      return startLoad(files, [dir]);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  $('#folder-input').click();
}

async function setupLanding() {
  const dz = $('#dropzone');
  $('#pick-files').addEventListener('click', pickFiles);
  $('#try-demo').addEventListener('click', async () => startLoad(await demoExportFiles()));
  $('#pick-folder').addEventListener('click', pickFolder);
  $('#file-input').addEventListener('change', e => { const f = Array.from(e.target.files); e.target.value = ''; startLoad(f); });
  $('#folder-input').addEventListener('change', e => { const f = Array.from(e.target.files); e.target.value = ''; startLoad(f); });

  const prevent = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => {
    prevent(e);
    if (!$('#landing').hidden) dz.classList.add('over');
  }));
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) dz.classList.remove('over'); });
  document.addEventListener('drop', async e => {
    prevent(e);
    dz.classList.remove('over');
    const dt = e.dataTransfer;
    if (!dt || !dt.files || (!dt.files.length && !(dt.items && dt.items.length))) return;
    if (!$('#shell').hidden && !confirm('Add the dropped files to the export that is open now?')) return;
    // Grab persistent handles synchronously (Chrome) so "Reopen last export" works later.
    let handlePromises = [];
    try {
      handlePromises = Array.from(dt.items || [])
        .filter(i => i.kind === 'file' && i.getAsFileSystemHandle)
        .map(i => i.getAsFileSystemHandle());
    } catch (err) { handlePromises = []; }
    const files = await filesFromDataTransfer(dt);
    let handles = [];
    try { handles = (await Promise.all(handlePromises)).filter(Boolean); } catch (err) { handles = []; }
    startLoad(files, handles);
  });

  const last = await HandleStore.load();
  if (last && last.handles && last.handles.length && last.handles[0].queryPermission) {
    const btn = $('#reopen');
    const names = last.handles.map(h => h.name);
    btn.hidden = false;
    btn.textContent = `Reopen last export (${names.length} item${names.length === 1 ? '' : 's'})`;
    btn.title = names.join('\n');
    btn.addEventListener('click', async () => {
      try {
        for (const h of last.handles) {
          let p = await h.queryPermission({ mode: 'read' });
          if (p !== 'granted') p = await h.requestPermission({ mode: 'read' });
          if (p !== 'granted') throw new Error('Permission denied for ' + h.name);
        }
        const files = await filesFromHandles(last.handles);
        startLoad(files, last.handles);
      } catch (err) {
        Loader.reset();
        Loader.set('reopen', 'Could not reopen: ' + (err.message || err) + '. The files may have moved; choose them again.', 1, '', 'error');
        HandleStore.clear();
        btn.hidden = true;
      }
    });
  }
}

/* ---------- Routing ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = {};
  new URLSearchParams(queryPart || '').forEach((v, k) => { query[k] = v; });
  return { path, query };
}

function navigate(hash, replace) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  onRoute();
}

function onRoute() {
  if ($('#shell').hidden) return;
  App.route = parseHash();
  App.lastHash = location.hash;
  App.lazy.clear();
  App.cleanup.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  App.cleanup = [];
  $('#shell').classList.remove('nav-open');
  closePicker();
  const main = $('#main');
  const html = renderRoute(App.route);
  if (typeof html === 'string') main.innerHTML = html;
  main.scrollTop = 0;
  afterRender(App.route);
  hydrateFrames(main);
  // Lazy blocks that start open (e.g. artifacts in a chat) render right away.
  main.querySelectorAll('details[data-lazy][open]').forEach(d => d.dispatchEvent(new Event('toggle')));
  renderSidebar();
  const q = App.route.path[0] === 'search' ? (App.route.query.q || '') : '';
  if (document.activeElement !== $('#q')) $('#q').value = q;
}

// Link clicks fire both popstate and hashchange; draw once per new hash.
const onNav = () => { if (location.hash !== App.lastHash) onRoute(); };
window.addEventListener('popstate', onNav);
window.addEventListener('hashchange', onNav);

/* ---------- Focus (person scope) ---------- */

function setFocus(id) {
  App.focus = id && DB.people.has(id) ? id : null;
  try { sessionStorage.setItem('cer-focus', App.focus || ''); } catch (e) { /* ignore */ }
  updateFocusButton();
  onRoute();
}

function updateFocusButton() {
  const p = App.focus ? DB.people.get(App.focus) : null;
  $('#person-btn-label').textContent = p ? p.name : 'Focus on a person';
  $('#person-btn').setAttribute('aria-label', p ? 'Focused on ' + p.name + '. Change person' : 'Focus on a person');
  $('#person-btn').classList.toggle('primary', !!p);
}

function closePicker() { const pk = $('#picker'); if (pk) pk.hidden = true; }

function openPicker() {
  const pk = $('#picker');
  pk.hidden = false;
  pk.innerHTML = `<input class="input" id="picker-q" placeholder="Type a name or email…" aria-label="Filter people">
    <div id="picker-list" role="listbox"></div>`;
  const input = $('#picker-q');
  let hl = 0;
  const draw = () => {
    const list = peopleMatching(input.value).slice(0, 60);
    hl = Math.min(hl, Math.max(0, list.length));
    $('#picker-list').innerHTML =
      (App.focus ? `<div class="picker-item${hl === 0 ? ' hl' : ''}" data-pick=""><span class="avatar sm unknown">×</span><span>Show everyone</span></div>` : '') +
      list.map((p, i) => {
        const idx = i + (App.focus ? 1 : 0);
        return `<div class="picker-item${idx === hl ? ' hl' : ''}" data-pick="${esc(p.id)}" role="option">${avatarHtml(p, 'sm')}
          <span class="grow"><span>${esc(p.name)}</span> <span class="em">${esc(p.email || '')}</span></span>
          <span class="badge" title="items">${fmtNum(p.total())}</span></div>`;
      }).join('') || '<div class="empty">No match</div>';
  };
  input.addEventListener('input', () => { hl = 0; draw(); });
  input.addEventListener('keydown', e => {
    const items = $$('#picker-list .picker-item');
    if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = items[hl]; if (it) pickPerson(it.dataset.pick); e.preventDefault(); }
    else if (e.key === 'Escape') closePicker();
  });
  draw();
  input.focus();
}

function pickPerson(id) {
  closePicker();
  if (!id) { setFocus(null); return; }
  App.focus = id;
  try { sessionStorage.setItem('cer-focus', id); } catch (e) { /* ignore */ }
  updateFocusButton();
  navigate('#/person/' + encodeURIComponent(id));
}

/* ---------- Global events ---------- */

function setupShell() {
  $('#theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('cer-theme', next); } catch (e) { /* ignore */ }
  });
  $('#load-btn').addEventListener('click', () => {
    if (!confirm('Open another export? The current one will be closed.')) return;
    location.hash = '';
    location.reload();
  });
  $('#menu-btn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#person-btn').addEventListener('click', e => {
    e.stopPropagation();
    if ($('#picker').hidden) openPicker(); else closePicker();
  });
  $('#picker').addEventListener('click', e => {
    e.stopPropagation();
    const it = e.target.closest('[data-pick]');
    if (it) pickPerson(it.dataset.pick);
  });
  document.addEventListener('click', () => closePicker());

  $('#topsearch').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    navigate('#/search?q=' + encodeURIComponent(q));
  });
  let searchTimer = null;
  $('#q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = $('#q').value.trim();
      if (q.length >= 2 || (q === '' && App.route.path[0] === 'search')) {
        const hash = '#/search?q=' + encodeURIComponent(q) + (App.route.query.t ? '&t=' + App.route.query.t : '');
        if (App.route.path[0] === 'search') navigate(hash, true); else navigate(hash);
      }
    }, 280);
  });

  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !typing && !$('#shell').hidden) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    if (e.key === 'Escape') {
      closePicker();
      const full = $('.frame-box.full');
      if (full) full.classList.remove('full');
    }
  });

  // Delegated actions inside the main view.
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) {
      // Action links are buttons in disguise: never also follow their href.
      if (el.tagName === 'A') e.preventDefault();
      handleAction(el.dataset.action, el, e);
      return;
    }
    // A new tab would not have the export loaded, so rows always open here.
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button,input,label')) navigate(row.dataset.href);
  });
  // Lazy bodies for collapsed blocks.
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.tagName === 'DETAILS' && d.open && d.dataset.lazy && !d.dataset.done) {
      const fn = App.lazy.get(d.dataset.lazy);
      if (fn) {
        const body = d.querySelector(':scope > .blk-body');
        body.insertAdjacentHTML('beforeend', fn());
        d.dataset.done = '1';
        hydrateFrames(body);
        if (App.route.query.q) highlightIn(body, searchTerms(App.route.query.q));
      }
    }
  }, true);
}

function lazyKey(fn) {
  const k = 'L' + App.lazy.size + '_' + Math.random().toString(36).slice(2, 7);
  App.lazy.set(k, fn);
  return k;
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', () => {
  setupLanding();
  setupShell();
  try { App.focus = sessionStorage.getItem('cer-focus') || null; } catch (e) { App.focus = null; }
  // Exposed for scripted use / testing: ExportReader.load([File, ...])
  window.ExportReader = { load: files => startLoad(files), DB: () => DB };
  // "?demo" opens the made-up sample export right away (shareable demo links, screenshots).
  if (new URLSearchParams(location.search).has('demo')) demoExportFiles().then(startLoad);
});
