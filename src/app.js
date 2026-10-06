/* App bootstrap: loading screen, routing, global events. */
'use strict';

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
// ◐ is a toggle: "Dark theme", pressed or not.
function syncThemeButton() { $('#theme-btn').setAttribute('aria-pressed', String(currentTheme() === 'dark')); }
try { applyTheme(localStorage.getItem('cer-theme')); } catch (e) { /* storage blocked */ }

/* ---------- Browser storage ---------- */

/* Chromium gives every page opened from disk (file://) one storage origin, so any other local
 * HTML file can read what this page stores. Older builds kept handles to the export's files in
 * IndexedDB ("Reopen last export"); delete them. The reader now stores only the theme and the
 * conversation view options. */
try { indexedDB.deleteDatabase('claude-export-reader'); } catch (e) { /* storage blocked */ }

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

// A note and a button under the loading rows, for the person to decide what comes next.
function loaderAction(note, label, action) {
  const row = document.createElement('div');
  row.className = 'row wrap';
  row.style.marginTop = '12px';
  row.innerHTML = `<span class="grow muted" style="font-size:14px">${esc(note)}</span><button class="btn primary" type="button">${esc(label)}</button>`;
  Loader.box().appendChild(row);
  const btn = row.querySelector('button');
  btn.addEventListener('click', action);
  btn.focus();
}

// One import at a time: a second one would write into the same DB while the first still runs.
function loadBusy() {
  if (App.loading) toast('Still reading the files from before. Try again when that is done.');
  return App.loading;
}

async function startLoad(files) {
  if (!files || !files.length || loadBusy()) return;
  $('#landing').hidden = false;
  $('#shell').hidden = true;
  Loader.reset();
  announce('Reading the export…');
  $$('#dropzone button').forEach(b => (b.disabled = true));
  App.loading = true;
  try {
    const before = DB.warnings.length;
    await importExport(files, Loader);
    const problems = DB.warnings.slice(before);
    if (problems.length) {
      // Do not hide failures behind the app: say what is missing and let the person decide.
      problems.slice(0, 8).forEach((w, i) => Loader.set('warn' + i, w, 1, '', 'error'));
      if (problems.length > 8) Loader.set('warn-more', `…and ${problems.length - 8} more (see “About this export”).`, 1, '', 'error');
      const note = 'Some files or records could not be read, so part of the data is missing.';
      loaderAction(note, 'Continue anyway', showApp);
      announce(note);
      return;
    }
    if (!hasRecords() && DB.manifests.length) { showManifestOnly(); return; }
    showApp();
  } catch (err) {
    console.error(err);
    const msg = 'Could not read the export: ' + (err && err.message ? err.message : err);
    Loader.set('fatal', msg, 1, '', 'error');
    announce(msg);
    // A failed import leaves DB as it was, so an export that was open is still there.
    if (hasRecords()) loaderAction('The export that was open is not changed.', 'Back to the open export', showApp);
  } finally {
    App.loading = false;
    $$('#dropzone button').forEach(b => (b.disabled = false));
  }
}

// Only the manifest was given: offer its download links, then wait for the zips.
function showManifestOnly() {
  const m = latestManifest();
  const box = Loader.box();
  Loader.rows.clear();
  box.hidden = false;
  box.innerHTML = `<h2 style="font-size:17px;margin:0 0 6px" tabindex="-1">This is your export’s file list</h2>
    <p class="muted" style="margin:0 0 12px;font-size:14px">${m.createdAt ? `Exported ${esc(fmtDateTime(m.createdAt))}. ` : ''}Download the ${plural(m.files.length, 'part')} below, then drop the zip files onto this page.</p>
    ${manifestDownloadsHtml(m, m.files)}`;
  box.querySelector('h2').focus();
}

function showApp() {
  $('#landing').hidden = true;
  $('#shell').hidden = false;
  // Keep the focus if that person is still loaded.
  writeFocus(App.focus);
  updateFocusButton();
  renderSidebar();
  if (!location.hash || location.hash === '#' || location.hash === '#/') navigate('#/', true);
  else onRoute();
}

function setupLanding() {
  const dz = $('#dropzone');
  $('#pick-files').addEventListener('click', () => $('#file-input').click());
  $('#try-demo').addEventListener('click', async () => startLoad(await demoExportFiles()));
  $('#pick-folder').addEventListener('click', () => $('#folder-input').click());
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
    if (!dt || !dt.files || (!dt.files.length && !(dt.items && dt.items.length)) || loadBusy()) return;
    if (!$('#shell').hidden && !confirm('Add the dropped files to the export that is open now?')) return;
    startLoad(await filesFromDataTransfer(dt));
  });
}

/* ---------- Routing ---------- */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  // fromEntries defines own properties, so a key such as "__proto__" in a link stays a key.
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path, query };
}

// replace: the same page with other options (a tab, a version, a board). The URL changes in
// place, and the focus goes back to the control that made the change.
function navigate(hash, replace) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  onRoute(!!replace);
}

// inPlace: see navigate(). Without it, the focus goes to the new page's heading.
function onRoute(inPlace) {
  if ($('#shell').hidden) return;
  const main = $('#main');
  const was = document.activeElement;
  const refocusId = inPlace === true && was && main.contains(was) ? was.id : '';
  App.route = parseHash();
  App.lastHash = location.hash;
  VIEW.ac.abort();
  VIEW = newView();
  toggleNav(false);
  closePicker();
  main.innerHTML = renderRoute(App.route);
  main.scrollTop = 0;
  VIEW.refocus = refocusId;
  focusPage();
  mountView(VIEW);
  // A page with no control of its own (About) is still scrolled from the keyboard: then the
  // main area itself takes Tab.
  main.tabIndex = main.querySelector('a[href], button, input, select, summary, [tabindex="0"], iframe') ? -1 : 0;
  renderSidebar();
  const q = App.route.path[0] === 'search' ? (App.route.query.q || '') : '';
  if (document.activeElement !== $('#q')) $('#q').value = q;
}

/* The focus after a route change: back on the control that redrew the page in place, or on
 * the page's heading, so a screen reader reads it and Tab goes on from the top of the page.
 * Someone typing in the search box keeps the focus there. scroll: bring the heading into view
 * (the skip link, which also works on the start screen). */
function focusPage(scroll) {
  if (document.activeElement === $('#q') || refocus()) return;
  const root = $('#shell').hidden ? $('#landing') : $('#main');
  const h = $('h1', root);
  if (h) h.setAttribute('tabindex', '-1');
  (h || root).focus({ preventScroll: !scroll });
}

// Link clicks fire both popstate and hashchange; draw once per new hash.
const onNav = () => { if (location.hash !== App.lastHash) onRoute(); };
window.addEventListener('popstate', onNav);
window.addEventListener('hashchange', onNav);

/* ---------- Focus (person scope) ---------- */

// The one writer of App.focus: a person of the loaded export, or null. It is kept in memory
// only, like the export (see the storage note at the top of this file).
function writeFocus(id) {
  App.focus = id && DB.people.has(id) ? id : null;
}

// Changes the focus, then opens `go`, or draws the current page again.
function setFocus(id, go) {
  writeFocus(id);
  updateFocusButton();
  if (go) navigate(go); else onRoute();
}

function updateFocusButton() {
  const p = focusPerson();
  $('#person-btn-label').textContent = p ? p.name : 'Focus on a person';
  $('#person-btn').setAttribute('aria-label', p ? 'Focused on ' + p.name + '. Change person' : 'Focus on a person');
  $('#person-btn').classList.toggle('primary', !!p);
}

// focusButton: give the focus back to the button that opened the picker (Escape).
function closePicker(focusButton) {
  const pk = $('#picker');
  if (!pk || pk.hidden) return;
  pk.hidden = true;
  $('#person-btn').setAttribute('aria-expanded', 'false');
  if (focusButton) $('#person-btn').focus();
}

/* A combobox: the focus stays in the text box, and the arrow keys move the highlighted option
 * (aria-activedescendant). */
function openPicker() {
  const pk = $('#picker');
  pk.hidden = false;
  $('#person-btn').setAttribute('aria-expanded', 'true');
  pk.innerHTML = `<input class="input" id="picker-q" role="combobox" aria-expanded="true" aria-controls="picker-list" aria-autocomplete="list" placeholder="Type a name or email…" aria-label="Find a person">
    <div id="picker-list" role="listbox" aria-label="People"></div><div class="empty" id="picker-none" hidden>No match</div>`;
  const input = $('#picker-q');
  let hl = 0;
  const draw = () => {
    const rows = (App.focus ? [{ id: '', html: '<span class="avatar sm unknown" aria-hidden="true">×</span><span>Show everyone</span>' }] : [])
      .concat(peopleMatching(input.value).slice(0, 60).map(p => ({ id: p.id, html: `${avatarHtml(p, 'sm')}
          <span class="grow"><span>${esc(p.name)}</span> <span class="em">${esc(p.email || '')}</span></span>
          <span class="badge" title="items">${fmtNum(p.total)}<span class="sr-only"> items</span></span>` })));
    hl = Math.min(hl, Math.max(0, rows.length - 1));
    $('#picker-list').innerHTML = rows.map((r, i) =>
      `<div class="picker-item${i === hl ? ' hl' : ''}" id="pick-${i}" role="option" aria-selected="${i === hl}" data-pick="${esc(r.id)}">${r.html}</div>`).join('');
    $('#picker-none').hidden = rows.length > 0;
    if (rows.length) input.setAttribute('aria-activedescendant', 'pick-' + hl);
    else input.removeAttribute('aria-activedescendant');
    const cur = $('#pick-' + hl);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { hl = 0; draw(); });
  input.addEventListener('keydown', e => {
    const items = $$('#picker-list .picker-item');
    if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = items[hl]; if (it) pickPerson(it.dataset.pick); e.preventDefault(); }
    else if (e.key === 'Escape') { closePicker(true); e.preventDefault(); e.stopPropagation(); }
  });
  draw();
  input.focus();
}

// A person from the picker opens their page; the empty choice shows everyone again.
function pickPerson(id) {
  closePicker();
  setFocus(id, id ? '#/person/' + encodeURIComponent(id) : null);
}

/* ---------- Global events ---------- */

// The menu on narrow screens.
function toggleNav(open) {
  const shell = $('#shell');
  const on = open == null ? !shell.classList.contains('nav-open') : open;
  shell.classList.toggle('nav-open', on);
  $('#menu-btn').setAttribute('aria-expanded', String(on));
}

function setupShell() {
  syncThemeButton();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeButton);
  $('#theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    syncThemeButton();
    try { localStorage.setItem('cer-theme', next); } catch (e) { /* ignore */ }
  });
  $('#load-btn').addEventListener('click', () => {
    if (!confirm('Open another export? The current one will be closed.')) return;
    location.hash = '';
    location.reload();
  });
  $('#menu-btn').addEventListener('click', () => toggleNav());
  $('#person-btn').addEventListener('click', e => {
    e.stopPropagation();
    if ($('#picker').hidden) openPicker(); else closePicker();
  });
  $('#picker').addEventListener('click', e => {
    e.stopPropagation();
    const it = e.target.closest('[data-pick]');
    if (it) pickPerson(it.dataset.pick);
  });
  // Tabbing out of the picker closes it. (A click on an option moves the focus nowhere.)
  $('#picker').addEventListener('focusout', e => {
    const to = e.relatedTarget;
    if (to && !$('#picker').contains(to) && to !== $('#person-btn')) closePicker();
  });
  document.addEventListener('click', () => closePicker());

  $('#topsearch').addEventListener('submit', e => {
    e.preventDefault();
    navigate(searchHref({ q: $('#q').value.trim() }));
  });
  let searchTimer = null;
  $('#q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = $('#q').value.trim();
      if (q.length >= 2 || (q === '' && App.route.path[0] === 'search')) {
        const hash = searchHref({ q, t: App.route.query.t });
        if (App.route.path[0] === 'search') navigate(hash, true); else navigate(hash);
      }
    }, 280);
  });

  // Ctrl+K (⌘K on a Mac) jumps to the search box. A one-key shortcut such as "/" can fire by
  // accident for people who use speech input (WCAG 2.1.4), so it needs the modifier.
  $('#q-kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘ K' : 'Ctrl K';
  document.addEventListener('keydown', e => {
    const key = String(e.key || '');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'k' && !$('#shell').hidden) {
      e.preventDefault();
      $('#q').focus();
      $('#q').select();
    }
    if (key !== 'Escape') return;
    // Escape closes the top-most thing that is open.
    const full = $('.frame-box.full');
    if (!$('#picker').hidden) closePicker(true);
    else if (full) setFull(full, false);
    else if ($('#shell').classList.contains('nav-open')) { toggleNav(false); $('#menu-btn').focus(); }
  });

  // Controls in the view run the function bound in their markup with on() (ui.js).
  document.addEventListener('click', e => {
    // The skip link: to the page's heading (a real #main would be read as a route).
    if (e.target.closest('.skip-link')) { e.preventDefault(); focusPage(true); return; }
    // The Copy button of a code block in Markdown (finishMarkdown in render.js).
    const copy = e.target.closest('button.copy-code');
    if (copy) { copyPre(copy); return; }
    const el = e.target.closest('[data-on]');
    if (el) {
      // Action links are buttons in disguise: never also follow their href.
      if (el.tagName === 'A') e.preventDefault();
      const fn = VIEW.fns.get(el.dataset.on);
      if (fn) fn(el, e);
      return;
    }
    // A new tab would not have the export loaded, so rows always open here.
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button,input,label')) navigate(row.dataset.href);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-on-change]');
    const fn = el && VIEW.fns.get(el.dataset.onChange);
    if (fn) fn(el, e);
  });
  // A collapsed blk() draws its body the first time it opens.
  document.addEventListener('toggle', e => {
    const d = e.target;
    const key = d.tagName === 'DETAILS' && d.open ? d.dataset.lazy : '';
    const fn = key && VIEW.fns.get(key);
    if (!fn) return;
    const body = d.querySelector(':scope > .blk-body');
    body.insertAdjacentHTML('beforeend', fn());
    // The body is drawn once, so the key is not needed again.
    delete d.dataset.lazy;
    VIEW.fns.delete(key);
    if (VIEW.terms.length) highlightIn(body, VIEW.terms);
  }, true);
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', () => {
  setupLanding();
  setupShell();
  // Exposed for scripted use / testing: ExportReader.load([File, ...])
  window.ExportReader = { load: files => startLoad(files), DB: () => DB };
  // "?demo" opens the made-up sample export right away (shareable demo links, screenshots).
  if (new URLSearchParams(location.search).has('demo')) demoExportFiles().then(startLoad);
});
