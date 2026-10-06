#!/usr/bin/env node
// Security check. It opens the built reader in headless Chrome with the network cut off (a dead
// proxy and no DNS) and feeds hostile, made-up export text to it. It fails on:
//   - any script that runs in the reader's own page
//   - any network request, from the page or from any frame in it
//   - any tag or attribute outside the allow-list in what the renderers return
//   - any dangerous element or attribute left in a drawn page
//   - any iframe without a sandbox, or with a token that is not on the list (never
//     allow-same-origin)
//   - anything in browser storage beyond the reader's two settings
//   - a record of the wrong shape that hides a message or stops a page, and a part that fails
//     without a notice in the page
// Part 1 calls the renderers directly (mdToHtml, mdBlock, plainTextHtml, snippetHtml,
// memoryText). Part 2 loads a hostile export built here and visits every kind of page with
// every block opened. Exit code 1 on any problem. Node 22+ and Chrome; no dependencies.
//
//   npm run build && npm run security
//   node scripts/security.mjs [--chrome <path>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { launchChrome, DEFAULT_CHROME } from './lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'claude-export-reader.html');
const PAGE = pathToFileURL(DIST).href;

// Every request goes to a proxy that is not there, and no host name resolves. File pages share
// one origin here, as a page from a web server would: a frame without its sandbox could then
// reach the reader, and the frame probe below would show it.
const CHROME_ARGS = ['--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND',
  '--allow-file-access-from-files'];
const LOCAL_URL = /^(file:|data:|blob:|about:|chrome-error:)/;
// The only sandbox tokens a preview frame may have.
const FRAME_SANDBOX = ['allow-scripts', 'allow-popups', 'allow-forms', 'allow-modals', 'allow-downloads'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- The hostile corpus ---------- */

// Every script payload calls __xss(<name>). Only the reader's own window has that function, so
// a call from a sandboxed frame fails, and a call that lands names the hole.
const X = name => `__xss('${name}')`;
const LEAK = 'https://leak.invalid';

const CORPUS = [
  // A plain fragment would send the reader's router to a page that does not exist
  '[jump](#section) and [ok](#/people)',
  // Event handlers
  `<img src=x onerror="${X('img-onerror')}">`,
  `<p onclick="${X('p-onclick')}" onmouseover="${X('p-onmouseover')}">hover me</p>`,
  `<details open ontoggle="${X('details-ontoggle')}"><summary>s</summary>body</details>`,
  `<body onload="${X('body-onload')}"><div onpointerenter="${X('div-pointer')}">x</div>`,
  `<a href="#" onfocus="${X('a-onfocus')}" autofocus tabindex="1">focus</a>`,
  `<marquee onstart="${X('marquee-onstart')}">m</marquee>`,
  `<video><source onerror="${X('source-onerror')}"></video>`,
  // Script URLs
  `<a href="javascript:${X('a-javascript')}">js</a> <a href="JaVaScRiPt:${X('a-js-case')}">js</a>`,
  `<a href="&#106;avascript:${X('a-js-entity')}">js</a> <a href=" javascript:${X('a-js-space')}">js</a>`,
  '<a href="vbscript:msgbox(1)">vb</a> <a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">data</a>',
  `<a href="//leak.invalid/share">protocol-relative</a> <a href="file:///etc/hosts">file</a> <a href="tel:+100">tel</a> <a href="relative/page.html">relative</a>`,
  `[md js](javascript:${X('md-javascript')}) [md vb](vbscript:msgbox) [md data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)`,
  `[ref link][r] and [unc][u]\n\n[r]: javascript:${X('md-ref')}\n[u]: //leak.invalid/unc`,
  '<http://leak.invalid/autolink> and https://leak.invalid/bare-url and mailto:someone@example.invalid',
  // Remote loads
  `![remote image](${LEAK}/md-img.png) ![ref image][i]\n\n[i]: ${LEAK}/md-ref.png`,
  `<img src="${LEAK}/img.png" srcset="${LEAK}/srcset.png 2x"><img src="//leak.invalid/pr.png"><img src=" ${LEAK}/space.png">`,
  `<picture><source srcset="${LEAK}/picture.webp"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></picture>`,
  `<video src="${LEAK}/v.mp4" poster="${LEAK}/poster.png" autoplay></video><audio src="${LEAK}/a.mp3" autoplay></audio>`,
  `<video><track src="${LEAK}/t.vtt"></video><object data="${LEAK}/o.swf"></object><embed src="${LEAK}/e.swf">`,
  `<iframe src="${LEAK}/frame"></iframe><iframe srcdoc="<script>parent.${X('iframe-srcdoc')}</script>"></iframe>`,
  `<base href="${LEAK}/base/"><meta http-equiv="refresh" content="0;url=${LEAK}/meta">`,
  `<link rel="stylesheet" href="${LEAK}/l.css"><link rel="prefetch" href="${LEAK}/prefetch"><link rel="preload" as="image" href="${LEAK}/preload.png">`,
  `<table background="${LEAK}/bg.png"><tr><td background="${LEAK}/td.png">cell</td></tr></table>`,
  `<input type="image" src="${LEAK}/input.png"><a href="https://example.invalid/" ping="${LEAK}/ping">ping</a><img src=x attributionsrc="${LEAK}/attribution">`,
  // SVG and MathML
  ...['mask', 'filter', 'fill', 'stroke', 'clip-path', 'marker-start', 'marker-mid', 'marker-end', 'cursor']
    .map(a => `<svg width="20" height="20"><path d="M0 0L9 9L0 9z" ${a}="url(${LEAK}/svg-${a}.svg#x)"/><text>svg ${a}</text></svg>`),
  `<svg><rect width="9" height="9" mask="\\75 rl(${LEAK}/css-escape.svg#m)"/></svg>`,
  `<svg><rect width="9" height="9" mask="image-set('${LEAK}/image-set.png' 1x)"/></svg>`,
  `<svg><image href="${LEAK}/svg-image.png"/><use href="${LEAK}/use.svg#a"/><feImage xlink:href="${LEAK}/feimage.png"/></svg>`,
  `<svg><style>rect{fill:url(${LEAK}/svg-style.svg#p)}</style><rect width="9" height="9"/></svg>`,
  `<svg><a href="javascript:${X('svg-a')}"><text>svg link</text></a><animate attributeName="href" values="javascript:${X('svg-animate')}"/></svg>`,
  `<svg onload="${X('svg-onload')}"><script>${X('svg-script')}</script></svg>`,
  `<math><mi xlink:href="javascript:${X('math-href')}">x</mi><mo>=</mo><mn>2</mn></math>`,
  `<math><maction actiontype="statusline" href="${LEAK}/maction">m</maction></math>`,
  // CSS
  `<div style="background:url(${LEAK}/style-attr.png)">style url</div>`,
  `<p style="background-image:image-set('${LEAK}/style-image-set.png' 1x)">image-set</p>`,
  `<span style="b\\61 ckground:\\75 rl(${LEAK}/style-escape.png)">css escape</span>`,
  `<style>@import url(${LEAK}/import.css); body{background:url(${LEAK}/style-tag.png)}</style>`,
  `<style>@font-face{font-family:x;src:url(${LEAK}/font.woff)} p{font-family:x}</style><p>font</p>`,
  // Forms
  `<form action="${LEAK}/form"><input name="q" value="v" autofocus onfocus="${X('input-onfocus')}"><button formaction="${LEAK}/formaction">go</button><textarea>t</textarea><select><option>o</option></select></form>`,
  // Mutation XSS samples (DOMPurify history)
  `<math><mtext><table><mglyph><style><img src=x onerror="${X('mxss-mglyph')}">`,
  `<svg></p><style><a id="</style><img src=x onerror=${X('mxss-svg-style')}>">`,
  `<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=${X('mxss-form')} src=x>">`,
  `<noscript><p title="</noscript><img src=x onerror=${X('mxss-noscript')}>">`,
  `<xmp><p title="</xmp><img src=x onerror=${X('mxss-xmp')}>">`,
  // The reader's own hooks: forged click keys and element ids
  '<a data-on="FORGED-1" data-href="#/FORGED" data-lazy="FORGED-2" data-pick="FORGED" href="#/about">forged data-on</a>',
  '<div id="main" name="q">forged id</div><a id="sr-status" name="shell" href="#">x</a><details data-lazy="FORGED-3"><summary>lazy</summary></details>',
  // The reader's own look: a fake dialog over the page, a toast, full screen, ARIA
  '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><h2>Your session expired</h2><p><a href="https://example.invalid/login">Sign in to claude.ai</a></p></div></div>',
  '<div class="toast">Copied</div><div class="frame-box full">full screen</div><span class="mtag">tag</span><a href="#/about" class="btn primary">a button</a>',
  '<dialog open>Fake dialog</dialog><p aria-hidden="true" aria-label="forged" role="alert" tabindex="0">aria</p>',
  `<map name="m"><area shape="rect" coords="0,0,99,99" href="//leak.invalid/share"></map><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m">`,
  '<font color="red" face="x">font</font><span src="https://leak.invalid/span.png" lowsrc="https://leak.invalid/low.png">src on a span</span>',
  // Plain script and templates
  `<script>${X('script')}</script><template><img src=x onerror=${X('template')}></template>`,
  '<a href="https://example.invalid/" target="_self">target self</a> <a href="https://example.invalid/" rel="opener">opener</a>',
  // Ordinary Markdown, so the allow-list sees the normal output too
  '# Heading\n\nSome **bold** and `code`.\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- item\n\n> quote',
];
const ALL = CORPUS.join('\n\n');

// HTML that runs in a preview frame. If the sandbox ever allowed same-origin, these calls would
// reach the reader and show up as a script hit.
const FRAME_PROBE = '<!doctype html><html><head><title>Frame probe</title></head><body><p>Frame probe</p><script>' +
  `for (const w of [parent, top, opener]) { try { w && w.${X('frame-escape')}; } catch (e) {} }` +
  `try { parent.document.title = 'reached'; parent.${X('frame-dom')}; } catch (e) {}` +
  '</script></body></html>';

/* ---------- The allow-list for what renderers return ---------- */

// The tags Markdown output needs, and the Copy button of a code block. No class anywhere: only
// the reader's own elements have one (see READER_CLASSES in pageKit).
const TAGS = ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'a',
  'img', 'sup', 'sub', 'span', 'div', 'details', 'summary', 'kbd', 'mark', 'abbr', 'dl', 'dt', 'dd', 'small', 'cite', 'q',
  'button'];
const ATTRS = {
  '*': ['dir', 'title'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt'],
  ol: ['start'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  details: ['open'],
  button: ['type', 'aria-label'],
};

/* ---------- The hostile export (made-up data only) ---------- */

const uuid = n => `5ec00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-09-20T10:00:00.000Z';
const VID = '1790000000-a1b2';

function hostileExport() {
  const ids = { person: uuid(1), conv: uuid(2), project: uuid(3), design: uuid(4), doc: uuid(5), art: uuid(6), odd: uuid(7), oddDesign: uuid(8) };
  const files = {};
  files['light_metadata/users.json'] = [{ uuid: ids.person, full_name: `Tester <img src=x onerror="${X('user-name')}">`, email_address: 'tester@example.invalid' }];

  const msgs = [];
  const msg = (sender, content, extra) => {
    const parent = msgs.length ? msgs[msgs.length - 1].uuid : null;
    msgs.push({ uuid: uuid(1000 + msgs.length), sender, text: '', content, created_at: T, updated_at: T, attachments: [], files: [], parent_message_uuid: parent, ...extra });
  };
  CORPUS.forEach((t, i) => {
    msg('human', [{ type: 'text', text: t }, { type: 'injected_prompt_block', prompt: t, injection_source: 'memory_block_head' }]);
    msg('assistant', [
      { type: 'thinking', thinking: t, summaries: [{ summary: t }] },
      { type: 'text', text: t, citations: [{ start_index: 0, end_index: 1, details: { type: 'web_search_citation', url: `javascript:${X('citation')}` } }] },
      { type: 'tool_use', id: 'toolu_' + i, name: 'web_search', input: { query: t } },
      { type: 'tool_result', tool_use_id: 'toolu_' + i, name: 'web_search', content: [{ type: 'knowledge', title: t, url: `javascript:${X('knowledge')}`, text: t, metadata: { site_domain: t } }] },
    ]);
  });
  msg('human', [{ type: 'text', text: 'attached' }], {
    attachments: [{ file_name: 'notes.md', file_size: ALL.length, file_type: 'text/markdown', extracted_content: ALL }],
    files: [{ file_uuid: uuid(9), file_name: 'notes.md' }],
  });
  // The tools drawn as their own card: created files, a widget, a draft, an old artifact, a shell.
  msg('assistant', [
    { type: 'tool_use', id: 'toolu_md', name: 'create_file', input: { path: '/mnt/user-data/outputs/notes.md', file_text: ALL } },
    { type: 'tool_use', id: 'toolu_html', name: 'create_file', input: { path: '/mnt/user-data/outputs/page.html', file_text: FRAME_PROBE } },
    { type: 'tool_use', id: 'toolu_widget', name: 'visualize:show_widget', input: { title: 'widget', widget_code: FRAME_PROBE } },
    { type: 'tool_use', id: 'toolu_mail', name: 'message_compose_v1', input: { kind: 'email', summary_title: 'draft', variants: [{ label: 'one', subject: ALL, body: ALL }] } },
    { type: 'tool_use', id: 'toolu_art', name: 'artifacts', input: { command: 'create', id: 'a', type: 'text/markdown', title: 'md', content: ALL } },
    { type: 'tool_use', id: 'toolu_bash', name: 'bash_tool', input: { command: ALL } },
    { type: 'tool_result', tool_use_id: 'toolu_bash', name: 'bash_tool', content: [{ type: 'text', text: JSON.stringify({ returncode: 0, stdout: ALL, stderr: ALL }) }] },
  ]);
  files['conversations/conversations.json'] = [{ uuid: ids.conv, name: 'Hostile conversation', summary: ALL, created_at: T, updated_at: T, account: { uuid: ids.person }, chat_messages: msgs }];

  files[`projects/${ids.project}.json`] = {
    uuid: ids.project, name: 'Hostile project', description: ALL, prompt_template: ALL, created_at: T, updated_at: T,
    creator: { uuid: ids.person, full_name: 'Tester' },
    docs: CORPUS.map((t, i) => ({ uuid: uuid(2000 + i), filename: `docs/item-${i}.md`, content: t, created_at: T }))
      .concat([{ uuid: uuid(2999), filename: 'probe.html', content: FRAME_PROBE, created_at: T }]),
  };

  files[`memories/${ids.person}.json`] = {
    account_uuid: ids.person, conversations_memory: ALL, project_memories: { [ids.project]: ALL },
    memory_files: CORPUS.map((t, i) => ({
      path: `/topics/item-${i}.md`, updated_at: T,
      content: `---\nname: item-${i}\ndescription: ${t.replace(/\n/g, ' ')}\nsources: [chat, <img src=x onerror=${X('memory-source')}>]\naliases: [x]\n---\n- [stated] ${t}\n- see [[item-${(i + 1) % CORPUS.length}]]`,
    })),
  };

  const dmsgs = [];
  CORPUS.forEach((t, i) => {
    dmsgs.push({ uuid: uuid(3000 + 2 * i), role: 'user', created_at: T, content: {
      id: 'u' + i, role: 'user', kind: 'chat', content: t, authorAccountUuid: ids.person, authorName: 'Tester',
      attachments: [{ type: 'comment', name: 'comment', content: 'File: index.html\nFeedback: ' + t }, { type: 'text', name: 'pasted.md', content: t }],
    } });
    dmsgs.push({ uuid: uuid(3001 + 2 * i), role: 'assistant', created_at: T, content: { role: 'assistant', contentBlocks: [
      { type: 'text', text: t },
      { type: 'tool_call', toolCall: { id: 'c' + i, type: 'edit', name: 'write_file', input: { path: 'a.md', content: t }, output: t } },
      { type: 'error', message: t },
    ] } });
  });
  dmsgs.push({ uuid: uuid(3999), role: 'assistant', created_at: T, content: { role: 'assistant', kind: 'chat-summary', content: ALL } });
  files[`design_chats/${ids.design}.json`] = { uuid: ids.design, title: 'Chat', project: { uuid: uuid(7), name: 'Hostile design' }, created_at: T, updated_at: T, messages: dmsgs };

  const meta = (id, kind) => ({ id, kind, visibility: 'organization', owner_account: ids.person, updated_at: T, active_version: VID,
    versions: [{ id: VID, title: 'Hostile ' + kind, description: CORPUS[0], created_at: T }] });
  files[`frames/artifacts/${ids.doc}/artifact.json`] = meta(ids.doc, 'page');
  files[`frames/artifacts/${ids.doc}/page.md`] = '<!-- tab: One -->\n' + ALL + '\n\n<!-- tab: Two -->\n' + ALL;
  files[`frames/artifacts/${ids.doc}/comments.json`] = [{ resolved: false, tab: 'One', quoted_text: 'bold',
    comments: CORPUS.map(t => ({ body: t, author: { uuid: ids.person, full_name: 'Tester' }, created_at: T })) }];
  files[`frames/artifacts/${ids.doc}/artifact_comments.json`] = { threads: [{ created_at: T,
    comments: CORPUS.map(t => ({ author_index: 1, author_role: '', author_is_artifact_owner: true, text: t, created_at: T })) }] };
  files[`frames/artifacts/${ids.art}/artifact.json`] = meta(ids.art, 'artifact');
  files[`frames/artifacts/${ids.art}/versions/${VID}.html`] = FRAME_PROBE;
  Object.assign(files, malformed(ids));
  return { files, ids };
}

/* Records of the wrong shape, as models and older product versions write them (made up). Each
 * one used to hide its whole chat or stop a page; every message must still be drawn. */
function malformed(ids) {
  const msgs = [];
  const msg = (sender, content, extra) => msgs.push({ uuid: uuid(4000 + msgs.length), sender, text: '', content, created_at: T,
    parent_message_uuid: msgs.length ? msgs[msgs.length - 1].uuid : null, ...extra });
  const tool = (name, input, result) => [{ type: 'tool_use', id: 'toolu_' + name, name, input },
    ...(result ? [{ type: 'tool_result', tool_use_id: 'toolu_' + name, name, ...result }] : [])];
  msg('human', [{ type: 'text', text: 'odd shapes' }], { attachments: {}, files: 5 });
  msg('assistant', [
    { type: 'thinking', thinking: 'odd', summaries: {} },
    { type: 'text', text: 'cited', citations: [{ end_index: 2, details: { url: 7 } }] },
    ...tool('chart_display_v0', { series: [null, { name: 'a', values: [1] }], xAxis: { data: 'Jan' } }),
    ...tool('ask_user_input_v0', { questions: [null] }),
    ...tool('places_map_display_v0', { days: [null, { day_number: 1, locations: [null] }] }),
    ...tool('artifacts', { command: 'create', type: 5, content: 'x' }),
    ...tool('create_file', { path: 7, file_text: 'x' }),
    ...tool('web_search', { query: 'x' }, { content: [null] }),
    ...tool('image_search', { query: 'x' }, { content: [{ type: 'image_gallery', images: [null] }] }),
    ...tool('conversation_search', { query: 'x' }, { content: [], display_content: { type: 'rich_content', content: [null] } }),
    { type: 'tool_use', id: 'toolu_num', name: 5, input: 'not an object' },
  ]);
  const files = {};
  files['conversations/odd.json'] = [{ uuid: ids.odd, name: 'Odd shapes', created_at: T, updated_at: T, account: { uuid: ids.person }, chat_messages: msgs }];
  const call = (name, input) => ({ type: 'tool_call', toolCall: { id: name, name, input, output: 'ok' } });
  files[`design_chats/${ids.oddDesign}.json`] = { uuid: ids.oddDesign, title: 'Odd design', project: { uuid: uuid(9), name: 'Odd' }, created_at: T, updated_at: T, messages: [
    { uuid: uuid(5000), role: 'user', created_at: T, content: { content: 'start', authorAccountUuid: ids.person, attachments: {} } },
    { uuid: uuid(5001), role: 'assistant', created_at: T, content: { contentBlocks: [call('questions_v2', { questions: [null] }), call('str_replace_edit', { edits: [null] }), null] } },
    { uuid: uuid(5002), role: 'assistant', created_at: T, content: { kind: 'question-record', questionRecord: { questionId: 'q', spec: { questions: [null, { id: 'goal', title: 'Goal?' }] } } } },
    { uuid: uuid(5003), role: 'user', created_at: T, content: { kind: 'question-receipt', questionReceipt: { questionId: 'q', payload: { goal: { choices: [null, 'A'] } } } } },
  ] };
  return files;
}

function routes(ids) {
  const p = ids.person;
  return [
    '#/', '#/people', `#/person/${p}`, ...['conversations', 'artifacts', 'projects', 'design', 'memory', 'comments'].map(t => `#/person/${p}/${t}`),
    '#/conversations', `#/c/${ids.conv}`, '#/artifacts', `#/a/${ids.doc}`, `#/a/${ids.doc}?tab=Two`,
    `#/a/${ids.art}`, `#/a/${ids.art}?view=source`, `#/a/${ids.art}?view=files`,
    '#/projects', `#/p/${ids.project}`, '#/design', `#/d/${ids.design}`, '#/memories', `#/memory/${p}`,
    '#/search?q=leak', '#/search?q=xss&deep=1', '#/about', `#/c/${ids.odd}`, `#/d/${ids.oddDesign}`, '#/search?q=odd&deep=1',
  ];
}

/* ---------- In the page ---------- */

// Installed in the reader's page. Everything it finds comes back as a list of problem lines.
function pageKit(cfg) {
  const allowTags = new Set(cfg.tags);
  const initial = new WeakSet(document.body.querySelectorAll('*'));
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const BAD_TAGS = new Set(['svg', 'math', 'script', 'style', 'link', 'meta', 'base', 'object', 'embed', 'form', 'picture',
    'frame', 'frameset', 'applet', 'noscript', 'template', 'portal', 'fencedframe', 'image', 'dialog', 'map', 'area',
    'marquee', 'font']);
  // The classes the reader puts on what a renderer returns: the copy button of a code block,
  // and the wrappers of mdBlock() and memoryText() with its tags. Each renderer names its own.
  const READER_CLASSES = { button: ['btn small copy-code'] };
  // Classes that make a box float over the page. Only the reader's dialog and toasts, outside
  // #main, have them; inside #main they can only come from the export.
  const OVERLAY = '#main .modal-back, #main .modal, #main .toast, #main .full';
  const BAD_ATTRS = new Set(['srcset', 'background', 'poster', 'action', 'formaction', 'xlink:href', 'ping', 'attributionsrc']);
  const show = el => '<' + el.localName + (el.id ? '#' + el.id : '') + '>';

  function sandbox(el, where, out) {
    const s = el.getAttribute('sandbox');
    if (s == null) { out.push(`${where}: ${show(el)} iframe without a sandbox`); return; }
    for (const t of s.split(/\s+/).filter(Boolean)) {
      if (!cfg.sandbox.includes(t)) out.push(`${where}: iframe sandbox has "${t}"`);
    }
  }

  // The strict check of one renderer's output, parsed where nothing can load or run. classes:
  // the class values this renderer itself writes (its wrapper), on top of READER_CLASSES.
  function checkOutput(html, where, roundTrip, classes) {
    const out = [];
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    if (roundTrip && tpl.innerHTML !== html) out.push(`${where}: the output changes when it is parsed again (mutation XSS?)`);
    for (const el of tpl.content.querySelectorAll('*')) {
      const tag = el.localName;
      if (el.namespaceURI !== HTML_NS || !allowTags.has(tag)) { out.push(`${where}: <${tag}> is not on the allow-list`); continue; }
      for (const { name, value } of Array.from(el.attributes)) {
        const v = value.trim();
        if (name === 'class') { if (!classes.includes(v) && !(READER_CLASSES[tag] || []).includes(v)) out.push(`${where}: <${tag} class="${v.slice(0, 60)}"> uses a class`); }
        else if (!cfg.attrs['*'].includes(name) && !(cfg.attrs[tag] || []).includes(name)) out.push(`${where}: <${tag} ${name}="${v.slice(0, 60)}"> is not on the allow-list`);
        else if (name === 'href' && !/^(https?:\/\/|mailto:|#\/)/i.test(v)) out.push(`${where}: <a href="${v.slice(0, 60)}"> is not a web, mail or in-app (#/…) link`);
        else if (name === 'src' && !/^(data:|blob:)/i.test(v)) out.push(`${where}: <img src="${v.slice(0, 60)}"> would load`);
        else if (name === 'target' && v !== '_blank') out.push(`${where}: target="${v}"`);
      }
      if (tag === 'a' && el.hasAttribute('target') && !/\bnoopener\b.*\bnoreferrer\b/.test(el.getAttribute('rel') || '')) out.push(`${where}: a new-tab link without rel="noopener noreferrer"`);
      if (tag === 'button' && el.className !== 'btn small copy-code') out.push(`${where}: a <button> the reader did not make`);
    }
    return out;
  }

  // Part 1: every renderer that takes export text, on every corpus item.
  function renderAll(corpus) {
    const out = [];
    const mem = { id: '5ec00000-0000-4000-8000-000000000001' };
    const renderers = [
      ['mdToHtml', t => mdToHtml(t), true, []],
      ['mdToHtml breaks', t => mdToHtml(t, { breaks: true }), true, []],
      ['mdBlock', t => mdBlock('---\nname: ' + t.replace(/\n/g, ' ') + '\n---\n' + t, { frontmatter: true }), false, ['frontmatter', 'md']],
      ['plainTextHtml', t => plainTextHtml(t), false, []],
      ['snippetHtml', t => snippetHtml(t, ['xss', 'leak', 'a']), false, []],
      ['memoryText', t => memoryText('- [stated] ' + t + ' [[item-1]]', mem), false, ['md', 'mtag']],
    ];
    const live = document.createElement('div');
    live.id = 'security-live';
    document.body.appendChild(live);
    corpus.forEach((t, i) => {
      for (const [name, fn, roundTrip, classes] of renderers) {
        let html;
        try { html = fn(t); } catch (e) { out.push(`${name} #${i}: threw ${e.message}`); continue; }
        out.push(...checkOutput(html, `${name} #${i}`, roundTrip, classes));
        // Into the live page too, so anything that would load or run gets its chance.
        live.insertAdjacentHTML('beforeend', html);
      }
    });
    return out;
  }

  // Part 2: the drawn page. The reader's own markup is checked too, apart from the elements
  // the page started with (its scripts and the search form).
  function scanPage(where) {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const tag = el.localName;
      if (BAD_TAGS.has(tag) && !initial.has(el)) out.push(`${where}: ${show(el)} in the page`);
      for (const { name, value } of Array.from(el.attributes)) {
        const v = value.trim();
        if (/^on/i.test(name)) out.push(`${where}: ${show(el)} has the event handler ${name}`);
        else if (BAD_ATTRS.has(name)) out.push(`${where}: ${show(el)} has ${name}="${v.slice(0, 60)}"`);
        else if (name === 'style' && /url\(|image-set|\\/i.test(v)) out.push(`${where}: ${show(el)} style="${v.slice(0, 60)}"`);
        else if (name === 'href' && !/^(#|https?:|mailto:|blob:)/i.test(v)) out.push(`${where}: ${show(el)} href="${v.slice(0, 60)}"`);
        else if (name === 'src' && !/^(data:|blob:)/i.test(v)) out.push(`${where}: ${show(el)} src="${v.slice(0, 60)}"`);
        else if (/FORGED/.test(v) && (name.startsWith('data-') || name === 'id' || name === 'name')) out.push(`${where}: forged ${name}="${v}" kept`);
        else if (name === 'srcdoc' && tag !== 'iframe') out.push(`${where}: ${show(el)} has srcdoc`);
      }
      if (tag === 'iframe') sandbox(el, where, out);
    }
    for (const el of document.querySelectorAll(OVERLAY)) out.push(`${where}: ${show(el)} with the reader's class "${el.className}" in #main`);
    for (const id of cfg.appIds) {
      const n = document.querySelectorAll(`[id="${id}"]`).length + document.getElementsByName(id).length;
      if (n > 1) out.push(`${where}: ${n} elements use the reader's id or name "${id}"`);
    }
    return out;
  }

  // Waits until the page has not changed for 300 ms (or 10 s passed).
  let last = Date.now();
  new MutationObserver(() => { last = Date.now(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const settle = () => new Promise(done => {
    const end = Date.now() + 10000;
    const tick = () => (Date.now() - last > 300 || Date.now() > end ? done() : setTimeout(tick, 50));
    tick();
  });
  async function go(route) {
    last = Date.now();
    if (location.hash === route) onRoute(); else location.hash = route;
    await settle();
    // Opening a block can draw more blocks inside it.
    for (let i = 0; i < 8; i++) {
      const closed = document.querySelectorAll('details:not([open])');
      if (!closed.length) break;
      closed.forEach(d => { d.open = true; });
      await settle();
    }
  }

  async function load(files) {
    const w = new ZipWriter();
    for (const [path, v] of Object.entries(files)) w.add(path, typeof v === 'string' ? v : JSON.stringify(v));
    await ExportReader.load([new File([w.blob()], 'hostile-export.zip')]);
    await settle();
    return { shown: !document.getElementById('shell').hidden, warnings: ExportReader.DB().warnings.slice() };
  }

  // The messages with these ids are all in the page, and nothing in it failed (drawPart() and
  // mountView() notices, or a page that could not be drawn).
  function drawn(ids, where) {
    const out = ids.filter(id => !document.getElementById('m-' + id)).map(id => `${where}: message ${id} is not drawn`);
    for (const el of document.querySelectorAll('#main .notice')) {
      if (/could not be (shown|drawn)|went wrong/.test(el.textContent)) out.push(`${where}: ${el.textContent.trim().slice(0, 120)}`);
    }
    if (/Searching…/.test(document.getElementById('main').textContent)) out.push(`${where}: still "Searching…"`);
    return out;
  }

  window.__sec = { renderAll, scanPage, go, settle, load, drawn };
}

// Runs in every frame before its own scripts: the hit counter (top window only) and the
// conversation options that show tool calls, thinking and system notes.
const BEFORE_LOAD = `(() => {
  if (window !== window.top) return;
  window.__xssHits = [];
  window.__xss = name => { window.__xssHits.push(String(name)); };
  try { localStorage.setItem('cer-conv-opts', JSON.stringify({ hideEmpty: false, showThinking: true, showTools: true, showSystem: true })); } catch (e) {}
})()`;

/* ---------- Static check: every iframe in the source has a sandbox from the list ---------- */

// The frames write their sandbox as "${FRAME_SANDBOX}…", so the constant's value (render.js) is
// put in before the tokens are read.
function sourceFrames() {
  const out = [];
  const dir = join(ROOT, 'src');
  const shared = /\nconst FRAME_SANDBOX = '([^']*)';/.exec(readFileSync(join(dir, 'render.js'), 'utf8'));
  if (!shared) out.push('src/render.js: no FRAME_SANDBOX constant');
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js') && !n.startsWith('demo'))) {
    const code = readFileSync(join(dir, f), 'utf8');
    if (/createElement\(\s*['"]iframe/.test(code)) out.push(`src/${f}: makes an iframe with createElement; use markup with a sandbox`);
    for (const m of code.matchAll(/<iframe\b[^>]*>/g)) {
      const s = /\bsandbox="([^"]*)"/.exec(m[0]);
      if (!s) { out.push(`src/${f}: ${m[0].slice(0, 80)} has no sandbox`); continue; }
      const tokens = s[1].replaceAll('${FRAME_SANDBOX}', shared ? shared[1] : '');
      for (const t of tokens.split(/\s+/).filter(Boolean)) if (!FRAME_SANDBOX.includes(t)) out.push(`src/${f}: iframe sandbox has "${t}"`);
    }
  }
  return out;
}

/* ---------- Main ---------- */

function parseArgs(argv) {
  const opts = { chrome: DEFAULT_CHROME };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--chrome' && argv[i + 1]) opts.chrome = argv[++i];
    else { console.error('Usage: node scripts/security.mjs [--chrome <path>]'); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(DIST) || readFileSync(DIST, 'utf8') !== build()) {
  console.error('dist/claude-export-reader.html is missing or out of date. Run "npm run build" first.');
  process.exit(2);
}

const t0 = Date.now();
const problems = [];
const report = (label, list) => {
  console.log(`${list.length ? 'FAIL' : 'ok  '} ${label}`);
  for (const p of list.slice(0, 40)) console.log('     ' + p);
  if (list.length > 40) console.log(`     … and ${list.length - 40} more`);
  problems.push(...list);
};

report('every iframe in src/ has a sandbox from the list', sourceFrames());

const chrome = await launchChrome(opts.chrome, { args: CHROME_ARGS });
try {
  const requests = [];
  const dialogs = [];
  // Requests and dialogs from the page and from every frame in it (sandboxed frames can run in
  // their own process, so each one is attached and watched too).
  chrome.on(async ({ method, params, sessionId }) => {
    if (method === 'Network.requestWillBeSent' && !LOCAL_URL.test(params.request.url)) requests.push(params.request.url);
    else if (method === 'Page.javascriptDialogOpening') {
      dialogs.push(`${params.type}: ${params.message}`);
      chrome.send('Page.handleJavaScriptDialog', { accept: false }, sessionId).catch(() => {});
    } else if (method === 'Target.attachedToTarget') {
      const s = params.sessionId;
      await Promise.all([
        chrome.send('Network.enable', {}, s),
        chrome.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s),
      ]).catch(() => {});
      chrome.send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
    }
  });

  const tab = await chrome.openPage();
  await tab.send('Page.enable');
  await tab.send('Network.enable');
  await tab.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { identifier: beforeLoad } = await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: BEFORE_LOAD });
  await tab.send('Page.navigate', { url: PAGE });
  await tab.waitFor('!!window.ExportReader');
  await tab.evaluate(`(${pageKit})(${JSON.stringify({ tags: TAGS, attrs: ATTRS, sandbox: FRAME_SANDBOX, appIds: ['main', 'q', 'sr-status', 'shell', 'landing', 'sidebar'] })}); 0`);

  // Part 1: the renderers.
  report(`renderers: ${CORPUS.length} hostile inputs × 6 renderers stay inside the allow-list`, await tab.evaluate(`__sec.renderAll(${JSON.stringify(CORPUS)})`));
  await sleep(1500);   // time for anything inserted to load or run
  await tab.evaluate(`document.getElementById('security-live').remove(); 0`);

  // Part 2: a hostile export, every page, every block open.
  const { files, ids } = hostileExport();
  const loaded = await tab.evaluate(`__sec.load(${JSON.stringify(files)})`);
  report('the hostile export loads without warnings', [
    ...(loaded.shown ? [] : ['the app did not open']), ...loaded.warnings.map(w => 'warning: ' + w)]);
  for (const route of routes(ids)) {
    await tab.evaluate(`__sec.go(${JSON.stringify(route)})`);
    report('page ' + route, await tab.evaluate(`__sec.scanPage(${JSON.stringify(route)})`));
  }

  // Records of the wrong shape: every message is drawn, and nothing fails.
  const odd = [];
  for (const [route, list] of [[`#/c/${ids.odd}`, files['conversations/odd.json'][0].chat_messages],
    [`#/d/${ids.oddDesign}`, files[`design_chats/${ids.oddDesign}.json`].messages.filter(m => m.content.kind !== 'question-receipt')],
    ['#/search?q=odd&deep=1', []]]) {
    await tab.evaluate(`__sec.go(${JSON.stringify(route)})`);
    odd.push(...await tab.evaluate(`__sec.drawn(${JSON.stringify(list.map(m => m.uuid))}, ${JSON.stringify(route)})`));
  }
  report('records of the wrong shape draw every message, and nothing fails', odd);

  // The safety nets: a part that throws becomes a notice and its message stays, and a failed
  // after() hook (here the search) says so in the page instead of hanging.
  const nets = [];
  await tab.evaluate(`window.__real = [thinkingHtml, runSearch]; thinkingHtml = () => { throw new Error('probe') }; runSearch = async () => { throw new Error('probe') }; 0`);
  await tab.evaluate(`__sec.go(${JSON.stringify(`#/c/${ids.odd}`)})`);
  const part = await tab.evaluate(id => { const m = document.getElementById(id);
    return !!m && /This block could not be shown: probe/.test(m.textContent) && !!m.querySelector('details pre'); }, 'm-' + uuid(4001));
  if (!part) nets.push('a block that throws does not become a notice with its data inside its message');
  await tab.evaluate(`__sec.go('#/search?q=probe')`);
  const hook = await tab.evaluate(`(() => { const t = document.getElementById('main').textContent; return /could not be drawn: probe/.test(t) && !/Searching…/.test(t); })()`);
  if (!hook) nets.push('a failed search is not shown in the page, or "Searching…" stays');
  await tab.evaluate(`[thinkingHtml, runSearch] = window.__real; 0`);
  report('a part that fails shows a notice, and the rest of the page still draws', nets);

  // "Open in new tab" puts the preview into a new window: its frame needs the sandbox too.
  await tab.evaluate(`__sec.go(${JSON.stringify(`#/a/${ids.art}`)})`);
  await tab.evaluate(`(() => { const open = window.open; window.__popups = [];
    window.open = function (...a) { const w = open.apply(this, a); window.__popups.push(w); return w; }; })()`);
  await tab.send('Runtime.evaluate', { expression: `document.querySelector('button[title="Open the preview in a new tab"]').click()`, userGesture: true });
  await sleep(1500);
  const popup = await tab.evaluate(`window.__popups.map(w => w && w.document ? Array.from(w.document.querySelectorAll('iframe'), f => f.getAttribute('sandbox')) : null)`);
  const popupProblems = [];
  // Its title is fixed: the browser keeps titles in its history, so they hold no export data.
  const popupTitle = await tab.evaluate(`window.__popups.map(w => w && w.document && w.document.title).join()`);
  if (popupTitle !== 'Artifact preview') popupProblems.push(`new tab: the title is "${popupTitle}", not "Artifact preview"`);
  if (popup.length !== 1 || !popup[0] || popup[0].length !== 1) popupProblems.push('expected one new window with one iframe, got ' + JSON.stringify(popup));
  for (const s of (popup[0] || [])) {
    if (s == null) popupProblems.push('new tab: iframe without a sandbox');
    else for (const t of s.split(/\s+/).filter(Boolean)) if (!FRAME_SANDBOX.includes(t)) popupProblems.push(`new tab: iframe sandbox has "${t}"`);
  }
  report('the "Open in new tab" frame is sandboxed, and its title is fixed', popupProblems);

  await sleep(1000);
  const hits = await tab.evaluate('window.__xssHits.slice()');
  report('no script ran in the reader', [...hits.map(h => 'script ran: ' + h), ...dialogs.map(d => 'dialog: ' + d)]);
  report('no network request', [...new Set(requests)].map(u => 'request: ' + u));

  // Saved view options live in storage that every local HTML file can write (Chromium gives all
  // file:// pages one origin). Plant hostile keys and values the way such a file would, then
  // open a chat: nothing may run, and the option buttons may only say true or false.
  const hostileKey = `"><img src=x onerror="${X('conv-opts-key')}">`;
  const hostileOpts = JSON.stringify({ showTools: `"><img src=x onerror="${X('conv-opts-value')}">`, hideEmpty: 'false',
    [hostileKey]: true, showThinking: { toString: 1 } });
  // The next page gets the hooks again, but not BEFORE_LOAD: its own options would replace the
  // hostile ones. The hooks also note what storage holds before any of the reader's code runs.
  await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: beforeLoad });
  const { identifier: hooks } = await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if (window !== window.top) return;
    window.__xssHits = [];
    window.__xss = name => { window.__xssHits.push(String(name)); };
    try { window.__optsAtStart = localStorage.getItem('cer-conv-opts'); } catch (e) {}
  })()` });
  // This page is a file:// page too, so it writes them as another local file would. The reader
  // saves its options only when a person changes one, so they wait in storage for its next start.
  await tab.evaluate((key, value) => localStorage.setItem(key, value), 'cer-conv-opts', hostileOpts);
  await tab.send('Page.reload');
  await tab.waitFor('!!window.ExportReader');
  await tab.evaluate(`(${pageKit})(${JSON.stringify({ tags: TAGS, attrs: ATTRS, sandbox: FRAME_SANDBOX, appIds: ['main', 'q', 'sr-status', 'shell', 'landing', 'sidebar'] })}); 0`);
  await tab.evaluate(`__sec.load(${JSON.stringify(files)})`);
  await tab.evaluate(`__sec.go(${JSON.stringify(`#/c/${ids.conv}`)})`);
  await sleep(1000);
  const optHits = await tab.evaluate('window.__xssHits.slice()');
  const planted = await tab.evaluate('window.__optsAtStart');
  const pressed = await tab.evaluate(`Array.from(document.querySelectorAll('#conv-toolbar [aria-pressed]'), b => b.getAttribute('aria-pressed'))`);
  // The options the reader took from storage: not the planted key, and each one true or false.
  const taken = Object.entries(await tab.evaluate('({ ...CONV_OPTS })'));
  report('hostile saved view options are ignored', [
    ...(planted === hostileOpts ? [] : ['the hostile options were not in storage when the reader started']),
    ...taken.filter(([k, v]) => k === hostileKey || typeof v !== 'boolean').map(([k]) => `option taken from storage: ${k.slice(0, 60)}`),
    ...optHits.map(h => 'script ran: ' + h),
    ...pressed.filter(v => v !== 'true' && v !== 'false').map(v => `aria-pressed="${String(v).slice(0, 60)}"`),
    ...(pressed.length ? [] : ['no option buttons found on the conversation page']),
  ]);
  await tab.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hooks });

  // Browser storage, last, because the reload starts the page again. Chromium gives every
  // file:// page one storage origin, so any local HTML file can read what the reader stores:
  // only its two settings. The database an older build kept file handles in is deleted at start.
  await tab.evaluate(`new Promise(done => { const r = indexedDB.open('claude-export-reader', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { r.result.close(); done(); }; r.onerror = () => done(); })`);
  await tab.send('Page.reload');
  await tab.waitFor('!!window.ExportReader');
  await tab.waitFor('indexedDB.databases().then(l => !l.length)', 5000).catch(() => {});
  const stored = await tab.evaluate(`indexedDB.databases().then(l => ({ idb: l.map(d => d.name), local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))`);
  report('browser storage holds only the theme and view options, and an old database is deleted', [
    ...stored.idb.map(n => 'IndexedDB database: ' + n),
    ...stored.local.filter(k => k !== 'cer-theme' && k !== 'cer-conv-opts').map(k => 'localStorage: ' + k),
    ...stored.session.map(k => 'sessionStorage: ' + k),
  ]);
} finally {
  await chrome.close();
}

console.log(`\n${problems.length ? 'FAILED' : 'PASSED'}: ${problems.length} problem${problems.length === 1 ? '' : 's'} (${Math.round((Date.now() - t0) / 1000)} s).`);
process.exit(problems.length ? 1 : 0);
