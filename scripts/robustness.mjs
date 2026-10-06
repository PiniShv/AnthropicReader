#!/usr/bin/env node
// Wrong-type check. Exports are written by models and by several product versions, so any field
// can arrive as the wrong type. This builds a made-up export from well-formed tool calls and
// design-chat rows, then gives every field the views read each wrong type in turn (null, a
// number, a string, true, [], [null], {}). Each field gets its own conversation or design chat,
// with one message per wrong value, so a problem names the exact field and value.
// It opens every page in headless Chrome with every block open, and also runs the Markdown
// export, the per-person zip and a deep search. It fails when a page breaks, a message is
// missing, the page logs an error, an export throws, or a message falls back to the reader's
// "could not be shown" notice. That notice is the safety net for shapes nobody has seen yet;
// for these known fields every wrong type must draw as real content. --allow-fallback only
// counts fallbacks (useful while working on a field). Node 22+ and Chrome; no dependencies.
//
//   npm run build && npm run robustness
//   node scripts/robustness.mjs [--chrome <path>] [--only <field-substring>] [--allow-fallback]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, DEFAULT_CHROME } from './lib/chrome.mjs';
import { build } from './build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'claude-export-reader.html');
const T = '2026-09-20T10:00:00.000Z';
const WRONG = [null, 7, 'x', true, [], [null], {}];
const show = v => JSON.stringify(v);

/* ---------- Well-formed templates (all made up) ---------- */

const knowledge = { type: 'knowledge', title: 'Page', url: 'https://example.invalid/a', text: 'Page text', metadata: { site_domain: 'example.invalid', site_name: 'Example' }, prompt_context_metadata: { age: '2 days ago' } };

// [tool_use input, tool_result fields] per tool. The result is optional.
const TOOL_TEMPLATES = {
  create_file: [{ path: '/mnt/user-data/outputs/notes.md', file_text: '# Notes\n\nHello', description: 'Write notes' }],
  present_files: [{ filepaths: ['/mnt/user-data/outputs/notes.md'] },
    { content: [{ type: 'local_resource', file_path: '/mnt/user-data/outputs/notes.md', name: 'notes.md', mime_type: 'text/markdown' }] }],
  str_replace: [{ path: '/home/claude/a.py', old_str: 'a = 1', new_str: 'a = 2', description: 'Fix a' },
    { content: [{ type: 'text', text: 'Successfully replaced string' }] }],
  bash_tool: [{ command: 'ls -la', description: 'List files' },
    { content: [{ type: 'text', text: JSON.stringify({ returncode: 0, stdout: 'a\nb', stderr: '' }) }] }],
  web_search: [{ query: 'northwind labs' }, { content: [knowledge] }],
  web_fetch: [{ url: 'https://example.invalid/a' },
    { content: [knowledge], display_content: { type: 'rich_link', link: { title: 'Page', url: 'https://example.invalid/a' } } }],
  'visualize:show_widget': [{ title: 'Chart', widget_code: '<svg viewBox="0 0 10 10"><rect class="c-teal" width="5" height="5"/></svg>' }],
  message_compose_v1: [{ kind: 'email', summary_title: 'Recap', variants: [{ label: 'Short', subject: 'Recap', body: 'Hi all' }] }],
  ask_user_input_v0: [{ questions: [{ question: 'Which plan?', options: ['A', 'B'], type: 'single_select' }] }],
  chart_display_v0: [{ title: 'Sales', style: 'bar', series: [{ name: 'Q1', values: [1, 2], color: '#888' }], xAxis: { data: ['Jan', 'Feb'] }, yAxis: { title: 'Units' } }],
  places_map_display_v0: [{ title: 'Trip', narrative: 'Two days', days: [{ day_number: 1, title: 'Day one', locations: [{ name: 'Museum', arrival_time: '10:00', notes: 'Open late' }] }] }],
  artifacts: [{ command: 'create', id: 'report', type: 'text/markdown', title: 'Report', content: '# Report' }, { content: [{ type: 'text', text: 'OK' }] }],
  Artifact: [{ action: 'publish', url: 'https://claude.ai/code/artifact/00000000-0000-4000-8000-0000000000aa', title: 'Report' },
    { content: [{ type: 'text', text: 'Published' }], display_content: { type: 'file', published_artifact_id: '00000000-0000-4000-8000-0000000000aa', title: 'Report', published_action: 'published' }, structured_content: { artifact_id: '00000000-0000-4000-8000-0000000000aa', title: 'Report' } }],
  conversation_search: [{ query: 'recap' },
    { content: [{ type: 'text', text: '<chat url="https://claude.ai/chat/00000000-0000-4000-8000-000000000001">x</chat>' }], display_content: { type: 'rich_content', content: [{ title: 'Earlier chat', url: 'https://claude.ai/chat/00000000-0000-4000-8000-000000000001', subtitles: ['Sep 1'] }] } }],
  image_search: [{ query: 'lighthouse' },
    { content: [{ type: 'image_gallery', images: [{ title: 'Lighthouse', url: 'https://example.invalid/i.jpg', page_url: 'https://example.invalid/p', thumbnail_url: 'https://example.invalid/t.jpg' }] }] }],
  'Northwind:query': [{ sql: 'select 1' },
    { content: [{ type: 'text', text: 'Tool result too large for context, stored at /mnt/x.json' }], structured_content: { rows: [[1]] }, is_error: true, meta: { error_type: 'tool_error' } }],
  code_display: [{ x: 1 }, { content: [{ type: 'text', text: 'ok' }], display_content: { type: 'code_block', code: 'print(1)', language: 'python', filename: 'a.py' } }],
  json_display: [{ x: 1 }, { content: [{ type: 'text', text: 'ok' }], display_content: { type: 'json_block', json_block: '{"language":"bash","code":"ls"}' } }],
  table_display: [{ x: 1 }, { content: [{ type: 'text', text: 'ok' }], display_content: { type: 'table', table: [['key', 'value']] } }],
};

// Message-level fields: blocks and uploads.
const MESSAGE_TEMPLATES = {
  'text+citations': { sender: 'assistant', content: [{ type: 'text', text: 'Northwind sells tea.', citations: [{ start_index: 0, end_index: 9, details: { type: 'web_search_citation', url: 'https://example.invalid/a' } }] }] },
  thinking: { sender: 'assistant', content: [{ type: 'thinking', thinking: 'Considering the plan', summaries: [{ summary: 'Weighed options' }], start_timestamp: T, stop_timestamp: T }] },
  injected: { sender: 'human', content: [{ type: 'text', text: 'Hi' }, { type: 'injected_prompt_block', prompt: 'The current date is Monday.', injection_source: 'date_note' }] },
  uploads: { sender: 'human', content: [{ type: 'text', text: 'See file' }], attachments: [{ file_name: 'notes.md', file_size: 10, file_type: 'text/markdown', extracted_content: '# Notes' }], files: [{ file_uuid: '00000000-0000-4000-8000-0000000000ff', file_name: 'notes.md' }, { file_uuid: '00000000-0000-4000-8000-0000000000fe', file_name: 'pic.png' }] },
};

// Design-chat rows (the content object of one message).
// Rows the reader draws without a message of their own: a pill notice, a question receipt
// (shown inside its question card) and a summary carried over from an earlier chat. For these
// the whole page is checked instead of one message.
const UNANCHORED = new Set(['pill-row', 'question-receipt', 'chat-summary']);

const DESIGN_TEMPLATES = {
  'user-row': { role: 'user', content: { role: 'user', kind: 'chat', content: 'Make the header blue', authorAccountUuid: 'PERSON', authorName: 'Ada',
    attachments: [{ type: 'skill', name: 'Hi-fi design', content: 'Skill text' }, { type: 'comment', name: 'div.header', filePath: 'Main.dc.html', content: 'File: Main.dc.html\nElement: <mentioned-element>x</mentioned-element>\nFeedback: bigger' },
      { type: 'image', name: 'shot.png', path: 'uploads/shot.png', aspectRatio: 1.5 }, { type: 'fig-file', name: 'App.fig', selectedFrames: ['/Page/Frame'], figOutline: 'Pages: 1' }, { type: 'folder', name: 'src' }] } },
  'pill-row': { role: 'user', content: { role: 'user', content: 'Verifier agent check completed', pill: true, authorAccountUuid: 'PERSON', attachments: [{ type: 'text', name: 'result', hidden: true, content: '<verifier-result verdict="done">ok</verifier-result>' }] } },
  'assistant-row': { role: 'assistant', content: { role: 'assistant', turnInputTokens: 1000, turnChanges: { created: ['a.html'], edited: ['b.css'], deleted: [], moved: [], copied: [] },
    contentBlocks: [
      { type: 'text', text: 'Updated the header.' },
      { type: 'tool_call', toolCall: { id: 't1', type: 'edit', name: 'write_file', input: { path: 'a.html', content: '<h1>Hi</h1>' }, output: 'Wrote 11 characters' } },
      { type: 'tool_call', toolCall: { id: 't2', type: 'edit', name: 'str_replace_edit', input: { path: 'b.css', old_string: 'red', new_string: 'blue', edits: [{ old_string: 'a', new_string: 'b' }] }, output: 'Edited b.css' } },
      { type: 'tool_call', toolCall: { id: 't3', type: 'edit', name: 'questions_v2', input: { title: 'Pick', questions: [{ id: 'q', title: 'Style?', options: ['A', 'B'] }] }, output: 'Shown' } },
      { type: 'tool_call', toolCall: { id: 't4', type: 'edit', name: 'run_script', input: { code: 'print(1)', purpose: 'check' }, output: '1' } },
      { type: 'error', message: 'Stream ended without a final message' },
      { type: 'user_interjection', message: { id: 'ui1', role: 'user', content: 'Also the footer', attachments: [{ type: 'text', name: 'pasted', content: 'note' }], timestamp: T, kind: 'chat' } },
    ] } },
  'question-record': { role: 'assistant', content: { role: 'assistant', kind: 'question-record', content: '', questionRecord: { v: 1, event: 'asked', questionId: 'q_1', round: 1,
    spec: { title: 'A few questions', prompt: 'Skip any', questions: [{ id: 'goal', kind: 'text-options', title: 'Goal?', options: ['Audit', 'Redesign'], multi: true }] } } } },
  'question-receipt': { role: 'user', content: { role: 'user', kind: 'question-receipt', content: 'Answered — goal: Audit', questionReceipt: { path: '', questionId: 'q_1', payload: { goal: { choices: ['Audit'] } } } } },
  'chat-summary': { role: 'assistant', content: { role: 'assistant', kind: 'chat-summary', content: 'We built a dashboard.' } },
};

/* ---------- Mutations ---------- */

// Every path to a value inside obj (objects and arrays, depth-limited), as arrays of keys.
function paths(obj, max = 5, prefix = []) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prefix.length >= max) return out;
  for (const k of Object.keys(obj)) {
    const p = [...prefix, Array.isArray(obj) ? Number(k) : k];
    out.push(p);
    out.push(...paths(obj[k], max, p));
  }
  return out;
}
const clone = v => JSON.parse(JSON.stringify(v));
function setAt(obj, path, value) {
  const copy = clone(obj);
  let o = copy;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
  return copy;
}
const pathName = p => p.map(k => (typeof k === 'number' ? `[${k}]` : '.' + k)).join('').replace(/^\./, '');

/* ---------- The export ---------- */

const PERSON = '00000000-0000-4000-8000-000000000100';
const uuid = (a, b) => `00000000-0000-4000-${String(8000 + (a % 1000)).padStart(4, '0')}-${String(b).padStart(12, '0')}`;

function buildExport(only) {
  const files = { 'light_metadata/users.json': [{ uuid: PERSON, full_name: 'Ada Fernsby', email_address: 'ada@northwind.example' }] };
  const convs = [], design = [], cases = [];
  let n = 0;

  const addConv = (label, mkMessages) => {
    if (only && !label.includes(only)) return;
    const id = uuid(1, ++n);
    const msgs = [];
    const expect = [];
    mkMessages().forEach(([valueLabel, m]) => {
      const mid = uuid(2, n * 100 + msgs.length);
      const parent = msgs.length ? msgs[msgs.length - 1].uuid : '00000000-0000-4000-8000-000000000000';
      msgs.push({ uuid: mid, text: '', attachments: [], files: [], created_at: T, updated_at: T, parent_message_uuid: parent, ...m });
      expect.push({ id: mid, value: valueLabel });
    });
    convs.push({ uuid: id, name: label, summary: '', created_at: T, updated_at: T, account: { uuid: PERSON }, chat_messages: msgs });
    cases.push({ kind: 'conversation', id, label, expect, anchored: true });
  };

  for (const [tool, [input, result]] of Object.entries(TOOL_TEMPLATES)) {
    const blocks = (inp, res) => {
      const b = [{ type: 'tool_use', id: 'toolu_1', name: tool, input: inp }];
      if (res) b.push({ type: 'tool_result', tool_use_id: 'toolu_1', name: tool, content: [{ type: 'text', text: 'ok' }], ...res });
      return b;
    };
    const base = { input, result: result || null };
    for (const p of paths(base)) {
      if (p[0] === 'result' && !result) continue;
      addConv(`${tool} ${pathName(p)}`, () => WRONG.map(v => {
        const m = setAt(base, p, v);
        return [show(v), { sender: 'assistant', content: blocks(m.input, m.result) }];
      }));
    }
  }
  for (const [name, tpl] of Object.entries(MESSAGE_TEMPLATES)) {
    for (const p of paths(tpl)) {
      if (p[0] === 'sender') continue;
      addConv(`message ${name} ${pathName(p)}`, () => WRONG.map(v => [show(v), setAt(tpl, p, v)]));
    }
  }

  const addDesign = (label, mkRows, anchored) => {
    if (only && !label.includes(only)) return;
    const id = uuid(3, ++n);
    const rows = [];
    const expect = [];
    // A well-formed first prompt, so the chat has an owner and a title.
    rows.push({ uuid: uuid(4, n * 100), role: 'user', created_at: T, content: { id: 'first', role: 'user', content: 'Start', authorAccountUuid: PERSON, authorName: 'Ada' } });
    mkRows().forEach(([valueLabel, row]) => {
      const rid = uuid(4, n * 100 + rows.length);
      rows.push({ uuid: rid, created_at: T, ...row });
      expect.push({ id: rid, value: valueLabel });
    });
    design.push({ uuid: id, title: 'Chat', project: { uuid: uuid(5, n), name: label }, created_at: T, updated_at: T, messages: rows });
    cases.push({ kind: 'design', id, label, expect, anchored });
  };
  for (const [name, tpl0] of Object.entries(DESIGN_TEMPLATES)) {
    const tpl = JSON.parse(JSON.stringify(tpl0).replaceAll('PERSON', PERSON));
    for (const p of paths(tpl)) {
      if (p[0] === 'role') continue;
      addDesign(`design ${name} ${pathName(p)}`, () => WRONG.map(v => [show(v), setAt(tpl, p, v)]), !UNANCHORED.has(name));
    }
  }

  files['conversations/conversations.json'] = convs;
  design.forEach(d => { files[`design_chats/${d.uuid}.json`] = d; });
  return { files, cases };
}

/* ---------- In the page ---------- */

function pageKit() {
  let last = Date.now();
  new MutationObserver(() => { last = Date.now(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const settle = (quiet = 150) => new Promise(done => {
    const end = Date.now() + 8000;
    const tick = () => (Date.now() - last > quiet || Date.now() > end ? done() : setTimeout(tick, 30));
    tick();
  });
  async function go(route) {
    last = Date.now();
    if (location.hash === route) onRoute(); else location.hash = route;
    await settle();
    for (let i = 0; i < 6; i++) {
      const closed = document.querySelectorAll('#main details:not([open])');
      if (!closed.length) break;
      closed.forEach(d => { d.open = true; });
      await settle();
    }
  }
  // What happened to each expected message on the page: drawn, drawn with a fallback, or missing.
  function check(c) {
    const main = document.getElementById('main');
    const text = main.innerText;
    const out = { broken: /Something went wrong|could not draw this page|Not found/i.test(text) ? text.slice(0, 160) : '', missing: [], fallback: [] };
    if (!c.anchored) {
      const n = (text.match(/could not be shown/gi) || []).length;
      if (n) out.fallback.push(`${n} part${n === 1 ? '' : 's'} on the page`);
      return out;
    }
    for (const e of c.expect) {
      const el = document.getElementById('m-' + e.id);
      if (!el) { out.missing.push(e.value); continue; }
      if (/could not be shown|could not show|not shown because/i.test(el.innerText)) out.fallback.push(e.value);
    }
    return out;
  }
  async function load(files) {
    const w = new ZipWriter();
    for (const [path, v] of Object.entries(files)) w.add(path, JSON.stringify(v));
    await ExportReader.load([new File([w.blob()], 'wrong-types.zip')]);
    await settle(300);
    return { shown: !document.getElementById('shell').hidden, warnings: ExportReader.DB().warnings.slice() };
  }
  // The exports that read the same records: Markdown per chat, the per-person zip, deep search.
  async function exports(ids) {
    const out = [];
    for (const id of ids) {
      const c = ExportReader.DB().convById.get(id);
      if (!c) { out.push('conversation not loaded: ' + id); continue; }
      try { convToMarkdown(c, currentPath(c)); convToMarkdown(c, branchPath(c)); } catch (e) { out.push(`Markdown export of "${c.raw.name}": ${e.message}`); }
    }
    const p = ExportReader.DB().people.get(PERSON_ID);
    try { await buildPersonZip(p, { allVersions: true }, () => {}, () => false); } catch (e) { out.push('per-person zip: ' + e.message); }
    return out;
  }
  window.__rob = { go, check, load, exports, settle };
}

/* ---------- Main ---------- */

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (!existsSync(DIST) || readFileSync(DIST, 'utf8') !== build()) {
  console.error('dist/claude-export-reader.html is missing or out of date. Run "npm run build" first.');
  process.exit(2);
}
const t0 = Date.now();
const { files, cases } = buildExport(opt('--only'));
const fields = cases.length, values = cases.reduce((a, c) => a + c.expect.length, 0);
console.log(`${fields} fields × wrong types = ${values} messages, in ${cases.filter(c => c.kind === 'conversation').length} conversations and ${cases.filter(c => c.kind === 'design').length} design chats`);

const chrome = await launchChrome(opt('--chrome') || DEFAULT_CHROME);
const problems = [];
let fallbacks = 0;
try {
  const tab = await chrome.openPage();
  const errors = [];
  chrome.on(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception ? params.exceptionDetails.exception.description : params.exceptionDetails.text);
    else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) errors.push(params.args.map(a => a.value || a.description || '').join(' '));
  });
  await tab.send('Runtime.enable');
  await tab.send('Page.enable');
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('cer-conv-opts', JSON.stringify({ hideEmpty: false, showThinking: true, showTools: true, showSystem: true })); } catch (e) {}` });
  await tab.send('Page.navigate', { url: pathToFileURL(DIST).href });
  await tab.waitFor('!!window.ExportReader');
  await tab.evaluate(`const PERSON_ID = ${JSON.stringify(PERSON)}; (${pageKit})(); 0`);
  const loaded = await tab.evaluate(`__rob.load(${JSON.stringify(files)})`);
  if (!loaded.shown) problems.push('the export did not open');
  // Warnings name skipped records: a wrong type must not cost a whole record.
  for (const w of loaded.warnings) problems.push('load warning: ' + w);

  for (const c of cases) {
    errors.length = 0;
    await tab.evaluate(`__rob.go(${JSON.stringify((c.kind === 'design' ? '#/d/' : '#/c/') + c.id)})`);
    const r = await tab.evaluate(`__rob.check(${JSON.stringify(c)})`);
    const where = `${c.label}`;
    if (r.broken) problems.push(`${where}: page broke: ${r.broken}`);
    if (r.missing.length) problems.push(`${where}: message missing for ${r.missing.join(', ')}`);
    for (const e of errors) problems.push(`${where}: error logged: ${String(e).split('\n')[0].slice(0, 160)}`);
    fallbacks += r.fallback.length;
    if (r.fallback.length) {
      if (argv.includes('--allow-fallback')) console.log(`  fallback ${where}: ${r.fallback.join(', ')}`);
      else problems.push(`${where}: drawn with the "could not be shown" fallback for ${r.fallback.join(', ')}`);
    }
  }
  for (const route of ['#/', '#/conversations', '#/design', `#/person/${PERSON}`, `#/person/${PERSON}/conversations`, `#/person/${PERSON}/design`, '#/search?q=northwind&deep=1']) {
    errors.length = 0;
    await tab.evaluate(`__rob.go(${JSON.stringify(route)})`);
    await tab.evaluate('__rob.settle(400)');
    const broken = await tab.evaluate(`/Something went wrong|Searching…/.test(document.getElementById('main').innerText)`);
    if (broken) problems.push(`${route}: page broke or did not finish`);
    for (const e of errors) problems.push(`${route}: error logged: ${String(e).split('\n')[0].slice(0, 160)}`);
  }
  const convIds = cases.filter(c => c.kind === 'conversation').map(c => c.id);
  for (const p of await tab.evaluate(`__rob.exports(${JSON.stringify(convIds)})`)) problems.push(p);
} finally {
  await chrome.close();
}

for (const p of problems.slice(0, 200)) console.log('FAIL ' + p);
if (problems.length > 200) console.log(`… and ${problems.length - 200} more`);
console.log(`\n${problems.length ? 'FAILED' : 'PASSED'}: ${problems.length} problem${problems.length === 1 ? '' : 's'}, ${fallbacks} message${fallbacks === 1 ? '' : 's'} drawn with the fallback (${Math.round((Date.now() - t0) / 1000)} s).`);
process.exit(problems.length ? 1 : 0);
