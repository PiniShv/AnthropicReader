// Small pure helpers from src/render.js, src/model.js, src/ingest.js and the view scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadApp, plain, BUILD_ORDER } from './harness.mjs';

const { api } = loadApp();

test('every script loads without a DOM, with app.js, the vendored libraries and blocked storage', () => {
  const full = loadApp({ files: BUILD_ORDER, vendor: true, blockStorage: true });
  assert.equal(typeof full.api.App, 'object');
  assert.equal(typeof full.window.marked, 'object');
  assert.equal(typeof full.window.DOMPurify, 'function');
  assert.equal(typeof full.api.importExport, 'function');
});
test('sanitize fails closed when DOMPurify cannot work', () => {
  // Without a real DOM, DOMPurify says it is not supported and would return its input as it is.
  const full = loadApp({ vendor: true });
  assert.equal(full.window.DOMPurify.isSupported, false);
  assert.equal(full.api.sanitize('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(api.sanitize('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;', 'no DOMPurify at all');
});
const {
  decodeEntities, searchTerms, snippetHtml, safeUrl, withFrameShim, composeVariants, cpToUnits,
  splitTabs, parseFrontmatter, classify, parseTime, toDate, fmtDate, fmtDateTime, esc, truncate, fmtBytes,
} = api;

/* ---------- Text ---------- */

test('decodeEntities', () => {
  assert.equal(decodeEntities('Sales &amp; ops'), 'Sales & ops');
  assert.equal(decodeEntities('&lt;b&gt; &quot;x&quot; &apos;y&#39;'), '<b> "x" \'y\'');
  assert.equal(decodeEntities('&#x1F680; &#128512; &mdash; &hellip; &NBSP;'), '🚀 😀 — …  ');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;', 'decodes one level only');
  assert.equal(decodeEntities('&unknown; & alone &#xZZ;'), '&unknown; & alone &#xZZ;');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;', 'out-of-range code points stay as written');
  assert.equal(decodeEntities('no entities'), 'no entities');
  assert.equal(decodeEntities(''), '');
  assert.equal(decodeEntities(null), null);
});

test('names from the export never find something on Object.prototype', () => {
  assert.equal(decodeEntities('&constructor; &toString; &hasOwnProperty;'), '&constructor; &toString; &hasOwnProperty;');
  assert.equal(api.mimeFor('x.constructor'), 'application/octet-stream');
  assert.equal(api.mimeFor('x.valueof'), 'application/octet-stream');
  assert.equal(api.mimeFor('x.PNG'), 'image/png');
  assert.match(api.visChip({ visibility: 'constructor' }), /title="Visibility">constructor</);
  const manifest = { files: ['constructor', 'toString', 'conversations'].map(category => ({ category, filename: category + '-000.zip' })) };
  assert.deepEqual(plain(api.missingFiles(manifest).map(f => f.category)), ['constructor', 'toString', 'conversations']);
  // An in-app link from the export can put any key into the route's query.
  const app = loadApp({ files: BUILD_ORDER });
  app.window.location.hash = '#/search?q=a&__proto__=x&constructor=y';
  const { query } = app.api.parseHash();
  assert.deepEqual(Object.keys(query), ['q', '__proto__', 'constructor']);
  assert.equal(Object.getPrototypeOf(query), app.run('Object.prototype'));
});

test('esc escapes the five HTML characters', () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('truncate and fmtBytes', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('a long sentence here', 8), 'a long…');
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(1536), '1.5 KB');
  assert.equal(fmtBytes(5 * 1024 ** 3), '5.0 GB');
  assert.equal(fmtBytes(null), '');
});

test('parseTime accepts long fractions, offsets and Unix seconds', () => {
  assert.equal(parseTime('2026-03-01T09:00:00.123456Z'), Date.parse('2026-03-01T09:00:00.123Z'));
  assert.equal(parseTime('2026-03-01T09:00:00+00:00'), Date.parse('2026-03-01T09:00:00Z'));
  assert.equal(parseTime(1767225600), 1767225600 * 1000);
  assert.equal(parseTime(1767225600000), 1767225600000);
  assert.equal(parseTime(''), 0);
  assert.equal(parseTime(null), 0);
  assert.equal(parseTime('not a date'), 0);
  // Outside what a Date can hold, a time is unknown: formatting it would throw.
  for (const v of [1e20, -1e20, 8.64e15 + 1, NaN, Infinity]) assert.equal(parseTime(v), 0, String(v));
  assert.equal(parseTime(8.64e15), 8.64e15);
});

test('toDate reads times like parseTime, and an unknown time (0) is no date, not 1 Jan 1970', () => {
  assert.equal(toDate('2026-03-01T09:00:00.123456Z').getTime(), Date.parse('2026-03-01T09:00:00.123Z'));
  assert.equal(toDate(1767225600).getTime(), 1767225600 * 1000);
  assert.equal(toDate(1767225600000).getTime(), 1767225600000);
  for (const v of [0, '', null, undefined, 'not a date', 1e20]) {
    assert.equal(toDate(v), null, String(v));
    assert.equal(fmtDate(v), '', String(v));
    assert.equal(fmtDateTime(v), '', String(v));
  }
  const d = new api.Date(5000);
  assert.equal(toDate(d), d, 'a Date is used as it is');
  assert.equal(toDate(new api.Date(NaN)), null);
});

/* ---------- Search ---------- */

test('searchTerms: words, quoted phrases, unbalanced quotes', () => {
  assert.deepEqual(plain(searchTerms('Quarterly Plan')), ['quarterly', 'plan']);
  assert.deepEqual(plain(searchTerms('"exact phrase" other')), ['exact phrase', 'other']);
  assert.deepEqual(plain(searchTerms('  "  spaced  "  ')), ['spaced']);
  assert.deepEqual(plain(searchTerms('say "hi')), ['say', 'hi'], 'an unmatched quote is dropped');
  assert.deepEqual(plain(searchTerms('it"s fine')), ['its', 'fine']);
  assert.deepEqual(plain(searchTerms('""')), []);
  assert.deepEqual(plain(searchTerms('')), []);
  assert.deepEqual(plain(searchTerms(null)), []);
});

test('snippetHtml escapes HTML and marks every match', () => {
  assert.equal(
    snippetHtml('Use <b>bold</b> for the plan & the PLAN', ['plan']),
    'Use &lt;b&gt;bold&lt;/b&gt; for the <mark>plan</mark> &amp; the <mark>PLAN</mark>',
  );
  // The longest term wins where terms overlap.
  assert.equal(snippetHtml('warehouse ware', ['ware', 'warehouse']), '<mark>warehouse</mark> <mark>ware</mark>');
  // Regex characters in terms are literal.
  assert.equal(snippetHtml('C++ and C#', ['c++']), '<mark>C++</mark> and C#');
  // No terms, or no match: plain escaped text.
  assert.equal(snippetHtml('a < b', []), 'a &lt; b');
  assert.equal(snippetHtml('a < b', ['zzz']), 'a &lt; b');
});

test('snippetHtml never breaks an HTML entity', () => {
  // "amp", "lt" and "39" appear only inside the escaped forms, never in the text itself.
  for (const term of ['amp', 'lt', '39', '&amp;', ';']) {
    const html = snippetHtml(`AT&T <tag> it's`, [term]);
    assert.ok(!/&[a-z0-9#]*<mark>/i.test(html), `term "${term}" split an entity: ${html}`);
    assert.ok(!/<mark>[a-z0-9#]*;/i.test(html) || term === ';', `term "${term}" split an entity: ${html}`);
  }
  assert.equal(snippetHtml('AT&T', ['t']), 'A<mark>T</mark>&amp;<mark>T</mark>');
  assert.equal(snippetHtml('x & y', ['&']), 'x <mark>&amp;</mark> y');
});

test('snippetHtml cuts long text around the first match', () => {
  const text = 'a'.repeat(300) + ' target ' + 'b'.repeat(300);
  const html = snippetHtml(text, ['target'], 20);
  assert.ok(html.startsWith('…') && html.endsWith('…'), html);
  assert.ok(html.includes('<mark>target</mark>'));
  assert.ok(html.length < 120, 'only about 3 × radius characters are kept');
  assert.ok(!snippetHtml('x'.repeat(500), ['nomatch'], 20).startsWith('…'), 'no match: starts at the beginning');
});

/* ---------- Links and previews ---------- */

test('safeFilename makes names that work on every system', () => {
  const { safeFilename } = api;
  assert.equal(safeFilename('Q3: plan / draft?'), 'Q3 plan draft');
  assert.equal(safeFilename('notes. . '), 'notes', 'Windows drops dots and spaces at the end');
  for (const n of ['CON', 'nul', 'Com1', 'LPT9', 'aux.txt', 'con.tar.gz', 'COM¹']) assert.equal(safeFilename(n), '_' + n, n);
  for (const n of ['console', 'NULL', 'com10', 'lpt', 'prn-notes']) assert.equal(safeFilename(n), n, n);
  assert.equal(safeFilename('..'), 'untitled');
  assert.equal(safeFilename('...', 'file'), 'file');
  assert.equal(safeFilename('Q3: plan / draft?.md'), 'Q3 plan draft.md', 'the name is cleaned before its extension');
  assert.equal(safeFilename('y'.repeat(200) + '.json'), 'y'.repeat(90) + '.json', 'a long name keeps its extension');
  assert.equal(safeFilename('.gitignore'), '.gitignore', 'a name that starts with a dot is not an extension');
  assert.equal(safeFilename('', 'download'), 'download');
});

test('searchHref encodes every value it puts in the URL', () => {
  const { searchHref } = api;
  assert.equal(searchHref({ q: 'week 4', t: 'conversations' }), '#/search?q=week%204&t=conversations');
  assert.equal(searchHref({ q: '"a&b"', deep: true, t: 'x&deep=0"><b>' }), '#/search?q=%22a%26b%22&deep=1&t=x%26deep%3D0%22%3E%3Cb%3E');
  assert.equal(searchHref({ q: '' }), '#/search?q=');
});

test('safeUrl allows only web and mail links', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('  http://example.com  '), 'http://example.com');
  assert.equal(safeUrl('MAILTO:team@northwind.example'), 'MAILTO:team@northwind.example');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>1</script>',
    'vbscript:x', 'file:///etc/hosts', '//evil.example', '/relative', '', null, undefined]) {
    assert.equal(safeUrl(bad), '#', String(bad));
  }
});

test('withFrameShim puts the helper right after <head>', () => {
  const doc = '<!doctype html><html><head><title>T</title></head><body>x</body></html>';
  const out = withFrameShim(doc);
  const shimAt = out.indexOf('<script>/* Claude Export Reader: in-page links */');
  assert.equal(shimAt, doc.indexOf('<head>') + '<head>'.length);
  assert.ok(out.startsWith('<!doctype html>'));
  assert.equal(out.replace(/<script>[\s\S]*?<\/script>/, ''), doc, 'nothing else changes');
});

test('withFrameShim: attributes on <head>, extra scripts', () => {
  const out = withFrameShim('<!DOCTYPE html><HEAD lang="en"><title>T</title>', '<script>/*extra*/</script>');
  assert.match(out, /^<!DOCTYPE html><HEAD lang="en"><script>\/\* Claude Export Reader[\s\S]*?<\/script><script>\/\*extra\*\/<\/script><title>T<\/title>$/);
});

test('withFrameShim never goes before <!doctype> and does not match <header>', () => {
  // No <head>: right after the doctype, so the page keeps standards mode.
  const out = withFrameShim('  <!doctype html>\n<header>Top</header><p>x</p>');
  assert.match(out, /^ {2}<!doctype html><script>/);
  assert.ok(out.endsWith('\n<header>Top</header><p>x</p>'));
  // No head, no doctype: at the very start.
  const frag = withFrameShim('<header>Top</header>');
  assert.ok(frag.startsWith('<script>'));
  assert.ok(frag.endsWith('</script><header>Top</header>'));
  assert.ok(withFrameShim(null).startsWith('<script>'));
});

/* ---------- Tool inputs ---------- */

test('composeVariants: array input', () => {
  const v = composeVariants({ variants: [{ label: 'Warm', body: 'Hi team' }, null, 'junk', { label: 'Short', body: 'Hi' }] });
  assert.deepEqual(plain(v), [{ label: 'Warm', body: 'Hi team' }, { label: 'Short', body: 'Hi' }]);
});

test('composeVariants: JSON string input', () => {
  const v = composeVariants({ variants: JSON.stringify([{ label: 'A', body: 'x' }, 3]) });
  assert.deepEqual(plain(v), [{ label: 'A', body: 'x' }]);
});

test('composeVariants: broken string with the text in input.body', () => {
  assert.deepEqual(plain(composeVariants({ variants: '<parameter name="label">Warm', subject: 'Hello', body: 'Dear team,' })),
    [{ label: 'Warm', subject: 'Hello', body: 'Dear team,' }]);
  assert.deepEqual(plain(composeVariants({ variants: 'label', body: 'Dear team,' })),
    [{ label: '', body: 'Dear team,' }], 'the bare word "label" is not a real label');
  assert.deepEqual(plain(composeVariants({ variants: 'x'.repeat(80), body: 'Text' })),
    [{ label: '', body: 'Text' }], 'a long string is not a label');
  assert.deepEqual(plain(composeVariants({ variants: 'Just the draft text' })), [{ body: 'Just the draft text' }]);
  assert.deepEqual(plain(composeVariants({})), []);
});

test('cpToUnits converts code points to UTF-16 offsets', () => {
  assert.equal(cpToUnits('abc', 2), 2);
  assert.equal(cpToUnits('😀a', 1), 2);
  assert.equal(cpToUnits('a😀b', 2), 3);
  assert.equal(cpToUnits('👍🏽 ok', 2), 4, 'a skin-tone emoji is two code points, four units');
  assert.equal(cpToUnits('ab', 10), 2, 'past the end: the whole string');
  assert.equal(cpToUnits('', 3), 0);
});

/* ---------- Pages and memory ---------- */

test('splitTabs', () => {
  assert.deepEqual(plain(splitTabs('# Title\n\nNo tabs here.')), [{ title: '', body: '# Title\n\nNo tabs here.' }]);
  const md = '# Handbook\n\n<!-- tab: Welcome -->\n# Handbook\nHello.\n\n<!--tab:Second tab-->  \nMore.\n<!-- tab: Untitled -->\n';
  assert.deepEqual(plain(splitTabs(md)), [
    { title: 'Welcome', body: '# Handbook\nHello.' },
    { title: 'Second tab', body: 'More.' },
    { title: 'Untitled', body: '' },
  ]);
  // A marker inside a line is not a tab.
  assert.equal(splitTabs('Text <!-- tab: Not one --> more').length, 1);
});

test('parseFrontmatter', () => {
  const r = parseFrontmatter('---\nname: Ops notes\ndescription: Weekly: what changed\nempty:\nlist: [a, "b, c" ]\nquoted: "x: y"\n# a comment line\n---\nBody line\n');
  assert.deepEqual(plain(r.meta), {
    name: 'Ops notes', description: 'Weekly: what changed', empty: '', list: ['a', 'b, c'], quoted: 'x: y',
  });
  assert.equal(r.body, 'Body line\n');
  assert.ok(r.front.startsWith('name: Ops notes'));
  const crlf = parseFrontmatter('---\r\nname: Windows\r\n---\r\nBody');
  assert.equal(crlf.meta.name, 'Windows');
  assert.equal(crlf.body, 'Body');
  const none = parseFrontmatter('Just text\n---\nnot: frontmatter');
  assert.deepEqual(plain(none.meta), {});
  assert.equal(none.body, 'Just text\n---\nnot: frontmatter');
  assert.deepEqual(plain(parseFrontmatter(null).meta), {});
});

/* ---------- File classification ---------- */

test('classify recognises each kind of export file', () => {
  const kind = (path, size = 100) => classify({ path, size }).kind;
  const id = '0a1b2c3d-0000-4000-8000-00000000abcd';
  assert.equal(kind('conversations.json'), 'conversations');
  assert.equal(kind('export/users.json'), 'users');
  // One kind per record type: a file may hold one record or a list (old projects.json, memories.json).
  assert.equal(kind('projects.json'), 'projects');
  assert.equal(kind('memories.json'), 'memories');
  assert.equal(kind('manifest-2026-10-01.json'), 'manifest');
  assert.equal(kind('design_chats/x.json'), 'design');
  assert.equal(kind('projects/x.json'), 'projects');
  assert.equal(kind('memories/x.json'), 'memories');
  assert.equal(kind(`artifacts/${id}/artifact.json`), 'artifact');
  assert.equal(kind(`artifacts/${id}/versions/1767225600-0a1b/index.html`), 'artifact');
  assert.equal(kind(`artifacts/${id.toUpperCase()}/page.md`), 'artifact');
  assert.equal(classify({ path: `artifacts/${id.toUpperCase()}/page.md`, size: 1 }).id, id, 'ids are lower-cased');
  assert.equal(kind('stray.json'), 'sniff');
  assert.equal(kind('huge.json', 65 * 1024 * 1024), 'other', 'very large unknown JSON is not sniffed');
  assert.equal(kind('photo.png'), 'other');
  assert.equal(kind('folder/'), 'junk');
  assert.equal(kind('__MACOSX/conversations.json'), 'junk');
  assert.equal(kind('a/._users.json'), 'junk');
});

test('parseVersionRel reads the three kinds of version path', () => {
  const vid = '1767225600-0a1b';
  const parse = rel => plain(api.parseVersionRel(rel));
  assert.deepEqual(parse(`versions/${vid}.html`), { vid, part: 'single' });
  assert.deepEqual(parse(`versions/${vid}.HTM`), { vid, part: 'single' });
  assert.deepEqual(parse(`versions/${vid}.files.json`), { vid, part: 'manifest' });
  assert.deepEqual(parse(`versions/${vid}/assets/app.js`), { vid, part: 'folder', sub: 'assets/app.js' });
  assert.deepEqual(parse('versions/v.2.html'), { vid: 'v.2', part: 'single' });
  assert.equal(parse('versions/readme.txt'), null);
  assert.equal(parse('page.md'), null);
});

test('genCache gives the same store until finalize() runs again', () => {
  const { api: app } = loadApp();
  const store = app.genCache(() => new Map());
  const first = store();
  first.set('k', 1);
  assert.equal(store(), first);
  app.finalize();
  assert.notEqual(store(), first);
  assert.equal(store().size, 0);
});

test('artifact ids in chat JSON and chat links use the shared UUID pattern', () => {
  const id = '5ec00000-0000-4000-8000-0000000000aa';
  const text = `see https://claude.ai/artifact/${id} and {\\"artifact_id\\": \\"${id.replace('aa', 'bb')}\\"} and /artifact/not-a-uuid`;
  api.RE_ART_REF.lastIndex = 0;
  assert.deepEqual(Array.from(text.matchAll(api.RE_ART_REF), m => m[1]), [id, id.replace('aa', 'bb')]);
  assert.equal(api.RE_CHAT_URL.exec(`https://claude.ai/chat/${id}`)[1], id);
  assert.equal(api.RE_CHAT_URL.exec('https://claude.ai/chat/------------------------------------'), null);
});

/* ---------- Previews ---------- */

test('a stylesheet gets only its own url() paths inlined, never the same text elsewhere', async () => {
  const file = text => ({ size: text.length, bytes: async () => new TextEncoder().encode(text) });
  const css = '.a{background:url(a.png)} .b{background:url("data.png")} .c{content:"a.png"} .d{background:url( \'a.png\' )} .e{background:url(a.png?v=1)}';
  const files = new Map([['styles/site.css', file(css)], ['styles/a.png', file('PNG-A')], ['styles/data.png', file('PNG-D')]]);
  const e = await api.encodeCss(files.get('styles/site.css'), 'styles/site.css', files, api.newEncoding());
  assert.ok(e.url.startsWith('data:text/css;base64,'));
  const out = Buffer.from(e.url.split(',')[1], 'base64').toString();
  const png = s => 'data:image/png;base64,' + Buffer.from(s).toString('base64');
  assert.equal(out, `.a{background:url(${png('PNG-A')})} .b{background:url("${png('PNG-D')}")} .c{content:"a.png"} .d{background:url( '${png('PNG-A')}' )} .e{background:url(a.png?v=1)}`);
});

test('the lookup script swaps a path set from a script before the browser loads it', () => {
  const html = api.assetLookupScript({ 'icons/a.png': 'data:image/png;base64,QQ==' });
  const code = html.slice('<script>'.length, -'</script>'.length);
  // A stand-in for the frame: every src the "browser" sees is a load it would start.
  const loads = [];
  class Element { setAttribute(n, v) { loads.push(n + '=' + v); } getAttribute() { return null; } }
  class HTMLImageElement extends Element {}
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get() { return this.s; }, set(v) { loads.push('src=' + v); this.s = v; } });
  const frame = { Element, HTMLImageElement, XMLHttpRequest: class { open() {} }, MutationObserver: class { observe() {} }, document: { documentElement: {} } };
  frame.window = frame;
  vm.runInNewContext(code, frame);
  const img = new HTMLImageElement();
  img.src = './icons/a.png?v=2';
  img.setAttribute('src', 'icons/a.png');
  img.setAttribute('alt', 'icons/a.png');
  img.src = 'https://example.com/other.png';
  assert.deepEqual(loads, ['src=data:image/png;base64,QQ==', 'src=data:image/png;base64,QQ==', 'alt=icons/a.png', 'src=https://example.com/other.png']);
});

/* ---------- Conversation branches ---------- */

// m1 → m2 → m3 → m4 is the first try; m3b is an edit of m3 with its own answer m4b.
function forkedConversation(id, extra = []) {
  const m = (uuid, parent, sender) => ({ uuid, parent_message_uuid: parent, sender, content: [{ type: 'text', text: uuid }] });
  const root = api.ROOT_PARENT;
  return {
    id,
    raw: {
      chat_messages: [
        m('m1', root, 'human'),
        m('m2', 'm1', 'assistant'),
        m('m3', 'm2', 'human'),
        m('m4', 'm3', 'assistant'),
        m('m3b', 'm2', 'human'),
        m('m4b', 'm3b', 'assistant'),
        ...extra.map(([uuid, parent, sender]) => m(uuid, parent, sender)),
      ],
    },
  };
}

const pathOf = c => Array.from(api.currentPath(c), m => m.uuid);

test('branches: the default path follows the newest message', () => {
  const c = forkedConversation('conv-a');
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3b', 'm4b']);
  assert.deepEqual(Array.from(api.siblingsOf(c, c.raw.chat_messages[2]), m => m.uuid), ['m3', 'm3b']);
});

test('branches: a later reply on the old branch makes it the default again', () => {
  const c = forkedConversation('conv-b', [['m5', 'm4', 'human']]);
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3', 'm4', 'm5']);
});

test('branches: selectBranchFor makes an off-branch message visible', () => {
  const c = forkedConversation('conv-c');
  api.selectBranchFor(c, 'm4');
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3', 'm4']);
  api.selectBranchFor(c, 'm4b');
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3b', 'm4b']);
  api.selectBranchFor(c, 'no-such-message');
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3b', 'm4b'], 'an unknown id changes nothing');
});

test('branches: a parent missing from the export starts a root branch', () => {
  const c = forkedConversation('conv-d');
  c.raw.chat_messages[0].parent_message_uuid = 'deleted-message';
  assert.deepEqual(pathOf(c), ['m1', 'm2', 'm3b', 'm4b']);
});

test('branches: messages without parents are one straight line', () => {
  // As the import leaves them (cleanMessages): every message has its list of blocks.
  const c = { id: 'conv-e', raw: { chat_messages: ['x1', 'x2', 'x3'].map(uuid => ({ uuid, content: [] })) } };
  assert.equal(api.buildTree(c).linear, true);
  assert.deepEqual(pathOf(c), ['x1', 'x2', 'x3']);
  api.selectBranchFor(c, 'x2');
  assert.deepEqual(pathOf(c), ['x1', 'x2', 'x3']);
});
