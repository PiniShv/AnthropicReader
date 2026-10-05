/* App state, DOM shortcuts, and the lifetime of one drawn page (a "view"). */
'use strict';

const App = {
  focus: null,          // Person id that scopes every list, or null
  route: { path: [], query: {} },
  lastHash: '',
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const focusPerson = () => (App.focus ? DB.people.get(App.focus) || null : null);

/* Everything that lives exactly as long as one drawn page. onRoute() aborts the old view and
 * starts a new one: listeners added with its signal go away, and async drawers stop at their
 * next `if (signal.aborted) return;`. */
const newView = () => ({ ac: new AbortController(), fns: new Map(), n: 0, mounts: [] });
let VIEW = newView();

// Runs fn once, right after the view's HTML is in the page.
const after = fn => VIEW.mounts.push(fn);

// Keeps fn for this view only and returns a short key to put into the markup.
const viewKey = fn => { const k = 'v' + ++VIEW.n; VIEW.fns.set(k, fn); return k; };

/* Behaviour bound where the markup is made: `<button ${on(() => save(conv))}>`. The listeners in
 * app.js call fn(el, event) on click (or on change for on.change). Never put a key into a string
 * that outlives the view, such as a cache: the key means nothing on the next page. */
const on = fn => `data-on="${viewKey(fn)}"`;
on.change = fn => `data-on-change="${viewKey(fn)}"`;

/* A collapsible block. summary is HTML; id is escaped here. render() draws the rest of the body
 * after `body`: the first time the block opens (the toggle listener in app.js), or right away
 * when it starts open. Big content stays out of the page until someone asks for it. */
function blk({ cls = '', id = '', open = false, summary, body = '' }, render) {
  const lazy = render && !open ? ` data-lazy="${viewKey(render)}"` : '';
  return `<details class="blk${cls ? ' ' + cls : ''}"${id ? ` id="${esc(id)}"` : ''}${open ? ' open' : ''}${lazy}>` +
    `<summary>${summary}</summary><div class="blk-body">${body}${render && open ? render() : ''}</div></details>`;
}

function mountView(v) {
  while (v.mounts.length) {
    const fn = v.mounts.shift();
    try { const r = fn(); if (r && r.catch) r.catch(e => console.error(e)); } catch (e) { console.error(e); }
  }
}
