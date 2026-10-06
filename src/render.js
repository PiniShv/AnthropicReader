/* Rendering helpers: escaping, markdown, formatting, highlighting. Pure formatting and
 * sanitizing: nothing here keeps state for a drawn page or binds a handler (that is ui.js). */
'use strict';

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]); }

/* ---------- Formatting ---------- */

const DATE_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short' });
const NUM_FMT = new Intl.NumberFormat();

// A time in ms, or 0 when unknown. Takes Unix seconds or ms, and ISO strings with 0-9
// fraction digits and either Z or +00:00. Safari rejects more than 3 fraction digits
// ("…58.888842Z"), so they are cut first.
function parseTime(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).replace(/(\.\d{3})\d+/, '$1');
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
// Same rule as parseTime, so an unknown time (0) shows as nothing, not as 1 Jan 1970.
function toDate(v) {
  const d = v instanceof Date ? v : new Date(parseTime(v) || NaN);
  return isNaN(d) ? null : d;
}
function fmtDate(v) { const d = toDate(v); return d ? DATE_FMT.format(d) : ''; }
function fmtDateTime(v) { const d = toDate(v); return d ? DATETIME_FMT.format(d) : ''; }
function fmtNum(n) { return NUM_FMT.format(n || 0); }
function fmtBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}
function plural(n, one, many) { return fmtNum(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
function fmtDuration(ms) {
  if (!(ms >= 0)) return '';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
  const m = Math.floor(s / 60);
  return m + ' min ' + Math.round(s % 60) + ' s';
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function initials(name) {
  const parts = String(name || '?').trim().split(/[\s._@-]+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = Array.from(parts[0])[0] || '';
  const b = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] || '') : '';
  return (a + b).toUpperCase();
}
function avatarHtml(person, size) {
  const cls = 'avatar' + (size ? ' ' + size : '') + (person && person.known ? '' : ' unknown');
  const name = person ? person.name : '?';
  const hue = person ? hashHue(person.id || name) : 0;
  return `<span class="${cls}" style="--h:${hue}" aria-hidden="true">${esc(initials(name))}</span>`;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/* ---------- Markdown ---------- */

if (window.marked) {
  marked.use({ gfm: true, breaks: false });
}

// Split YAML-style front matter (--- ... ---) off a markdown string.
function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || '');
  if (!m) return { front: '', body: text || '' };
  return { front: m[1], body: text.slice(m[0].length) };
}

/* What Markdown from the export may hold: an allow-list of HTML only. SVG and MathML are left
 * out because their attributes load files (mask="url(…)", fill, filter, marker-end), and CSS
 * escapes and image-set() get past any check of the value. On top of that, everything that
 * loads, runs or posts on its own is forbidden. id and name could take over the reader's own
 * element ids, and tabindex its Tab order. <img> keeps its src for one step: finishMarkdown()
 * turns a remote one into a link. */
const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source', 'track', 'picture', 'image', 'object', 'embed', 'iframe', 'link', 'meta', 'template'],
  FORBID_ATTR: ['style', 'srcset', 'ping', 'background', 'id', 'name', 'tabindex'],
  ALLOW_DATA_ATTR: false,
};

// The words inside an <svg> or <math>, without its styles and scripts.
function foreignText(node) {
  node.querySelectorAll('style, script').forEach(n => n.remove());
  const words = [];
  const walk = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) words.push(walk.currentNode.nodeValue);
  return oneLine(words.join(' '));
}

if (window.DOMPurify && typeof DOMPurify.addHook === 'function') {
  // DOMPurify drops an <svg> or <math> with everything in it. Keep its text readable instead.
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'svg' || data.tagName === 'math') node.replaceWith(node.ownerDocument.createTextNode(foreignText(node)));
  });
}

// Fails closed: a DOMPurify that cannot work in this browser returns the HTML unchanged, so
// then the HTML is shown as text.
function sanitize(html) {
  if (!window.DOMPurify || !DOMPurify.isSupported) return esc(html);
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

// Only web links from export data become clickable; anything else (javascript:, file:) does not.
function safeUrl(u) {
  return /^(https?:\/\/|mailto:)/i.test(String(u || '').trim()) ? String(u).trim() : '#';
}

// Post-process sanitized markdown HTML: links open in new tabs, blocks get dir=auto
// (Hebrew/Arabic paragraphs render right-to-left), code blocks get a Copy button. The click
// listener in app.js handles every .copy-code button, so the HTML holds no per-page key.
function finishMarkdown(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  // The reader works offline and must not call home: remote images become plain links.
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (/^(data:|blob:)/i.test(src)) return;
    const a = document.createElement('a');
    a.setAttribute('href', src);
    a.textContent = '🖼 ' + (img.getAttribute('alt') || 'image') + ' (online image, not loaded)';
    img.replaceWith(a);
  });
  // In-app links (#/…) stay in this tab, and web and mail links open a new one. Any other link
  // (relative, "//host", tel:) is not clickable: from a file:// page it opens a path on the
  // computer, or on Windows a network share.
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href.trim().startsWith('#')) { a.removeAttribute('target'); return; }
    if (safeUrl(href) === '#') { a.removeAttribute('href'); a.removeAttribute('target'); return; }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  root.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th').forEach(el => el.setAttribute('dir', 'auto'));
  root.querySelectorAll('pre').forEach(pre => {
    const b = document.createElement('button');
    b.className = 'btn small copy-code';
    b.type = 'button';
    b.textContent = 'Copy';
    b.setAttribute('aria-label', 'Copy code');
    pre.appendChild(b);
  });
  const div = document.createElement('div');
  div.appendChild(root);
  return div.innerHTML;
}

// The Copy button of a code block: copy the code without the button's own label.
function copyPre(el) {
  const pre = el.closest('pre');
  const code = pre && pre.querySelector('code');
  copyText((code || pre).innerText.replace(/\nCopy$/, ''));
}

const MD_LIMIT = 400000;

function mdToHtml(text, opts) {
  text = String(text == null ? '' : text);
  if (!text.trim()) return '';
  if (text.length > MD_LIMIT) {
    // Very long text: markdown parsing would stall the tab; show it as plain text.
    return `<pre class="code wrap">${esc(text)}</pre>`;
  }
  let html;
  try {
    html = window.marked ? marked.parse(text, { breaks: !!(opts && opts.breaks) }) : `<p>${esc(text)}</p>`;
  } catch (e) {
    return `<pre class="code wrap">${esc(text)}</pre>`;
  }
  return finishMarkdown(sanitize(html));
}

function mdBlock(text, opts) {
  const { front, body } = (opts && opts.frontmatter) ? splitFrontmatter(text) : { front: '', body: text };
  return (front ? `<div class="frontmatter">${esc(front)}</div>` : '') + `<div class="md">${mdToHtml(body, opts)}</div>`;
}

// Plain text with preserved newlines and clickable URLs (used for human messages).
function plainTextHtml(text) {
  const s = esc(text);
  return s.replace(/\bhttps?:\/\/[^\s<>"')\]]+/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

/* ---------- JSON display ---------- */

function jsonPretty(v) {
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

/* ---------- Search highlighting ---------- */

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function termsRegex(terms) {
  const list = (terms || []).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegex);
  return list.length ? new RegExp('(' + list.join('|') + ')', 'gi') : null;
}

// Wrap matches in <mark> inside a DOM subtree (text nodes only; skips code-copy buttons).
// opts.firstOnly: mark only the first match of each term.
function highlightIn(root, terms, opts) {
  if (opts && opts.firstOnly) {
    let n = 0;
    for (const t of (terms || [])) n += highlightIn(root, [t], { limit: 1 });
    return n;
  }
  const limit = opts && opts.limit ? opts.limit : Infinity;
  const re = termsRegex(terms);
  if (!re || !root) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode;
      if (!p || p.nodeName === 'MARK' || p.nodeName === 'BUTTON' || p.nodeName === 'SCRIPT') return NodeFilter.FILTER_REJECT;
      re.lastIndex = 0;
      return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const n of nodes) {
    if (count >= limit) break;
    const frag = document.createDocumentFragment();
    const s = n.nodeValue;
    let last = 0;
    re.lastIndex = 0;
    let m;
    while (count < limit && (m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const mk = document.createElement('mark');
      mk.textContent = m[0];
      frag.appendChild(mk);
      last = m.index + m[0].length;
      count++;
      if (!m[0].length) re.lastIndex++;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    n.parentNode.replaceChild(frag, n);
  }
  return count;
}

// Escaped snippet around the first match, with <mark> on every match inside it.
function snippetHtml(text, terms, radius) {
  text = String(text || '');
  radius = radius || 90;
  const re = termsRegex(terms);
  let idx = -1;
  if (re) { re.lastIndex = 0; const m = re.exec(text); if (m) idx = m.index; }
  let start = Math.max(0, idx - radius);
  let end = Math.min(text.length, (idx < 0 ? 0 : idx) + radius * 2);
  const s = oneLine(text.slice(start, end));
  // Split the raw text on matches and escape each piece; never run the regex over escaped HTML.
  let body = '';
  if (re) {
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      body += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
      if (!m[0].length) re.lastIndex++;
    }
    body += esc(s.slice(last));
  } else body = esc(s);
  return (start > 0 ? '…' : '') + body + (end < text.length ? '…' : '');
}

/* ---------- Sandboxed previews ---------- */

/* A srcdoc frame inherits the reader's URL as its base, so "#section" links would load the
 * reader itself and blank the preview. This script makes them scroll inside the frame. */
const FRAME_SHIM = '<script>/* Claude Export Reader: in-page links */(function(){document.addEventListener("click",function(e){' +
  'if(e.defaultPrevented)return;var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;' +
  'var h=a.getAttribute("href")||"";if(h.charAt(0)!=="#")return;e.preventDefault();var id=h.slice(1);' +
  'var b=matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";' +
  'if(!id||id==="top"){scrollTo({top:0,behavior:b});return;}try{id=decodeURIComponent(id)}catch(x){}' +
  'var t=document.getElementById(id)||document.getElementsByName(id)[0];if(t){t.scrollIntoView({behavior:b});}' +
  'else{try{location.hash=h}catch(x){}}});})();<\/script>';

// Insert helper scripts right after <head> (or the doctype), never before the doctype:
// that would switch the page into quirks mode.
function withFrameShim(html, extra) {
  const shim = FRAME_SHIM + (extra || '');
  const s = String(html == null ? '' : html);
  const head = /<head(\s[^>]*)?>/i.exec(s);
  if (head) return s.slice(0, head.index + head[0].length) + shim + s.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(s);
  if (doctype) return s.slice(0, doctype[0].length) + shim + s.slice(doctype[0].length);
  return shim + s;
}

// The sandbox of every frame that shows export content (the artifact viewer adds
// allow-downloads). Never allow-same-origin: the frame runs in an opaque origin, so it cannot
// reach the reader.
const FRAME_SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals';

// HTML from the export in a sandboxed frame. The HTML goes into the srcdoc attribute, escaped,
// and the browser decodes it back. The frame loads when its block is put into the page.
function sandboxFrame(html, height) {
  return `<iframe class="preview" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer" style="height:${height || 420}px" title="Sandboxed preview" srcdoc="${esc(withFrameShim(html))}"></iframe>`;
}

/* ---------- Misc ---------- */

// Says msg to screen readers, through the polite live region in the page (#sr-status).
function announce(msg) {
  const el = document.getElementById('sr-status');
  if (!el) return;
  // Empty first, so the same message twice in a row is said twice.
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.setAttribute('aria-hidden', 'true');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
  announce(msg);
}

/* Callers copy inside the click: Safari allows clipboard writes only there. The fallback
 * reports what execCommand says (it returns false when blocked; it does not throw), and puts
 * the focus back where it was. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) {
    const back = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    if (back && back.focus) back.focus();
    toast(ok ? 'Copied' : 'Copy failed');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Text the export holds (created files, project docs), saved as a file with a type from its name.
function downloadText(name, text) {
  downloadBlob(new Blob([text], { type: mimeFor(name) }), name || 'file.txt');
}

/* A file name that works on every system: none of the characters Windows, macOS or Linux
 * reject, no dot or space at the end (Windows drops them), and not a name Windows keeps for a
 * device (CON, NUL, COM1, LPT1, …, also with an extension such as "con.txt"). */
function safeFilename(s, fallback) {
  let v = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(v)) v = '_' + v;
  return v || fallback || 'untitled';
}

function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
};
function mimeFor(name) { return MIME[fileExt(name)] || 'application/octet-stream'; }
function isTextExt(ext) { return /^(html?|css|m?js|jsx|tsx?|json|md|markdown|txt|csv|svg|xml|ya?ml|py|sh|sql|java|go|rb|rs|c|h|cpp|cs|kt|swift|php|toml|ini|log|tsv)$/.test(ext); }
