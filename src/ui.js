/* App state, DOM shortcuts, and the lifetime of one drawn page (a "view"), with the view
 * helpers that bind behaviour: on(), blk(), preHtml(). */
'use strict';

const App = {
  focus: null,          // Person id that scopes every list, or null
  route: { path: [], query: {} },
  lastHash: '',
  canReopen: false,     // a load in this tab saved file handles for "Reopen last export"
  loading: false,       // an import is running (startLoad): there is only one at a time
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const focusPerson = () => (App.focus ? DB.people.get(App.focus) || null : null);
// What lists show: the focused person's records, or everyone's.
const focusScope = () => scopeOf(focusPerson());

/* Everything that lives exactly as long as one drawn page. onRoute() aborts the old view and
 * starts a new one: listeners added with its signal go away, and async drawers stop at their
 * next `if (signal.aborted) return;`. terms: the search words the page highlights. The view
 * that owns them sets them, and every lazy block marks them in the body it draws later.
 * refocus: the id of the control that had the focus before the page was drawn again in place
 * (see refocus()). */
const newView = () => ({ ac: new AbortController(), fns: new Map(), mounts: [], terms: [], refocus: '' });
let VIEW = newView();

// One counter for every view, so a key or a generated id never means two things: an element
// left over from an old page can never call a function of the new one.
let KEY_SEQ = 0;

// Runs fn once, right after the view's HTML is in the page.
const after = fn => VIEW.mounts.push(fn);

// Keeps fn for this view only and returns a short key to put into the markup.
const viewKey = fn => { const k = 'v' + ++KEY_SEQ; VIEW.fns.set(k, fn); return k; };

// Forgets the keys inside root, before that part of the page is drawn again in place (the
// conversation thread). Otherwise every redraw would add its keys on top of the old ones.
function dropKeys(root) {
  for (const el of root.querySelectorAll('[data-on],[data-on-change],[data-lazy]')) {
    VIEW.fns.delete(el.dataset.on);
    VIEW.fns.delete(el.dataset.onChange);
    VIEW.fns.delete(el.dataset.lazy);
  }
}

/* Behaviour bound where the markup is made: `<button ${on(() => save(conv))}>`. The listeners in
 * app.js call fn(el, event) on click (or on change for on.change). Never put a key into a string
 * that outlives the view, such as a cache: the key means nothing on the next page. */
const on = fn => `data-on="${viewKey(fn)}"`;
on.change = fn => `data-on-change="${viewKey(fn)}"`;

/* A collapsible block. summary and body are HTML; id is escaped here; style is CSS from the
 * code, never from the export. render() draws the rest of the body after `body`: the first time
 * the block opens (the toggle listener in app.js), or right away when it starts open. Big
 * content stays out of the page until someone asks for it. */
function blk({ cls = '', id = '', style = '', open = false, summary, body = '' }, render) {
  const lazy = render && !open ? ` data-lazy="${viewKey(render)}"` : '';
  return `<details class="blk${cls ? ' ' + cls : ''}"${id ? ` id="${esc(id)}"` : ''}${style ? ` style="${style}"` : ''}${open ? ' open' : ''}${lazy}>` +
    `<summary>${summary}</summary><div class="blk-body">${body}${render && open ? render() : ''}</div></details>`;
}

const PRE_LIMIT = 60000;

// <pre> with large content cut to PRE_LIMIT and a "Show all" button that expands in place.
// The button keeps the full text, so it is not put into the page twice.
// tabindex: long lines scroll sideways, and a keyboard can only scroll what it can focus.
function preHtml(text, opts) {
  text = String(text == null ? '' : text);
  const wrap = opts && opts.wrap ? ' wrap' : '';
  if (text.length <= PRE_LIMIT) return `<pre class="code${wrap}" tabindex="0">${esc(text)}</pre>`;
  // Show all: the full text replaces the cut one in the <pre> right before the button's row.
  const showAll = el => {
    const row = el.closest('.row');
    const pre = row && row.previousElementSibling;
    if (pre) { pre.textContent = text; row.remove(); pre.focus(); }
  };
  return `<pre class="code${wrap}" tabindex="0">${esc(text.slice(0, PRE_LIMIT))}</pre>
    <div class="row" style="margin-top:6px"><span class="muted" style="font-size:13px">Showing ${fmtBytes(PRE_LIMIT)} of ${fmtBytes(text.length)}.</span>
    <button class="btn small" type="button" ${on(showAll)}>Show all</button></div>`;
}

/* The raw text behind a preview or rendered Markdown, folded away below it. opts: label, desc
 * (HTML after the label), wrap (long lines wrap), gap (px above the block). */
function sourceBlk(text, { label = 'Source', desc = '', wrap = false, gap = 8 } = {}) {
  return blk({ style: `margin-top:${gap}px`, summary: `<span class="lbl">${label}</span>${desc}`, body: preHtml(text, { wrap }) });
}

/* Puts the focus back on the control with the id in VIEW.refocus, once it is in the page (an
 * async drawer calls this again after it adds its controls). Only while the focus is nowhere
 * or on the page heading, so it never takes the focus away from where someone moved it. */
function refocus() {
  const el = VIEW.refocus && document.getElementById(VIEW.refocus);
  const a = document.activeElement;
  if (!el || (a && a !== document.body && a.tagName !== 'H1')) return false;
  VIEW.refocus = '';
  el.focus();
  return true;
}

/* Makes everything outside el inert, as a modal dialog does: no focus, no clicks, hidden from
 * screen readers. The live region (#sr-status) stays. Returns the function that undoes it. */
function isolate(el) {
  const done = [];
  for (let n = el; n.parentElement && n !== document.body; n = n.parentElement) {
    for (const sib of n.parentElement.children) {
      if (sib === n || sib.inert || sib.id === 'sr-status' || sib.tagName === 'SCRIPT') continue;
      sib.inert = true;
      done.push(sib);
    }
  }
  return () => done.splice(0).forEach(x => { x.inert = false; });
}

// Smooth scrolling, unless the system asks for less motion.
const scrollMotion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function mountView(v) {
  while (v.mounts.length) {
    const fn = v.mounts.shift();
    try { const r = fn(); if (r && r.catch) r.catch(e => console.error(e)); } catch (e) { console.error(e); }
  }
}
