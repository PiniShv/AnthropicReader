/* Conversations as data: the message tree and its branches, what the reader knows about each
 * tool (TOOLS), and the outputs Claude produced. No DOM. */
'use strict';

// The parent of a chat's first message.
const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';

const BRANCH_CHOICE = new Map();   // convId -> Map(parentId -> chosen child id)

// The tree of each conversation, made once. A newer copy of a chat is a new object, so a tree
// never goes stale.
const TREE = new WeakMap();

// A message's parent, or ROOT_PARENT when it has none or its parent is not in the export.
// ids: anything with has(uuid), such as a tree's byId.
const parentKey = (ids, m) => (m.parent_message_uuid && ids.has(m.parent_message_uuid) ? m.parent_message_uuid : ROOT_PARENT);

/* The branch rule: parent key -> child messages, in array order. null when no message has a
 * parent, because then the array order is the conversation. The thread (buildTree) and the
 * fork count (addConversation in ingest.js) both use it, so the "branch points" chip always
 * matches the branch arrows. */
function childrenByParent(msgs) {
  if (!msgs.some(m => m.parent_message_uuid)) return null;
  const ids = new Set(msgs.map(m => m.uuid));
  const children = new Map();
  for (const m of msgs) {
    const p = parentKey(ids, m);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(m);
  }
  return children;
}

/* msgs: the raw messages. byId: uuid -> message. children: childrenByParent(), or empty.
 * newest: uuid -> highest array index anywhere in that message's subtree. linear: no message
 * has a parent, so the array order is the conversation. created: path -> the create_file
 * tool_use that wrote it (to resolve present_files). */
function buildTree(conv) {
  let t = TREE.get(conv);
  if (t) return t;
  const msgs = conv.raw.chat_messages;
  const children = childrenByParent(msgs);
  t = { msgs, byId: new Map(), children: children || new Map(), newest: new Map(), linear: !children, created: new Map() };
  for (const m of msgs) {
    t.byId.set(m.uuid, m);
    for (const b of m.content) {
      if (b.type === 'tool_use' && b.name === 'create_file' && b.input && b.input.path) t.created.set(b.input.path, b);
    }
  }
  if (!t.linear) {
    // Children always come after their parent in the array, so a reverse pass is enough.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      let best = i;
      for (const k of (t.children.get(m.uuid) || [])) best = Math.max(best, t.newest.get(k.uuid) || 0);
      t.newest.set(m.uuid, best);
    }
  }
  TREE.set(conv, t);
  return t;
}

/* A path through the branches: from the root, at each fork take the chosen child (choice:
 * parent id -> child id), else the child whose branch holds the newest message (the last
 * array element is always the current leaf). Without a choice, the newest path. */
function branchPath(conv, choice) {
  const t = buildTree(conv);
  if (t.linear) return t.msgs.slice();
  choice = choice || new Map();
  const path = [];
  let cur = ROOT_PARENT;
  const seen = new Set();
  for (;;) {
    const kids = t.children.get(cur);
    if (!kids || !kids.length) break;
    const chosenId = choice.get(cur);
    const next = kids.find(k => k.uuid === chosenId) ||
      kids.reduce((a, b) => ((t.newest.get(b.uuid) || 0) > (t.newest.get(a.uuid) || 0) ? b : a));
    if (seen.has(next.uuid)) break;
    seen.add(next.uuid);
    path.push(next);
    cur = next.uuid;
  }
  return path;
}

// The path the thread shows: the branches picked in this tab (branch arrows, search hits).
const currentPath = conv => branchPath(conv, BRANCH_CHOICE.get(conv.id));

// Make sure a message (e.g. a search hit on another branch) is on the visible path.
function selectBranchFor(conv, msgId) {
  const t = buildTree(conv);
  if (t.linear || !t.byId.has(msgId)) return;
  const choice = BRANCH_CHOICE.get(conv.id) || new Map();
  let cur = t.byId.get(msgId);
  const guard = new Set();
  while (cur && !guard.has(cur.uuid)) {
    guard.add(cur.uuid);
    const p = parentKey(t.byId, cur);
    choice.set(p, cur.uuid);
    if (p === ROOT_PARENT) break;
    cur = t.byId.get(p);
  }
  BRANCH_CHOICE.set(conv.id, choice);
}

function siblingsOf(conv, m) {
  const t = buildTree(conv);
  if (t.linear) return [m];
  return t.children.get(parentKey(t.byId, m)) || [m];
}

/* ---------- Tools ---------- */

/* What the reader knows about each tool, by name. The data facts are here (no DOM):
 *   shown: the person saw the call in the chat (a card, a file list), so a reply keeps it at
 *     the top level, even with tool calls hidden, instead of folding it into "N tool calls".
 *   output(input): the call made something the person got (a file, artifact, widget, draft).
 *     The list badge counts these calls and the "What Claude produced here" box lists them.
 *   chip(input): { ico, label, kind }, the call in that box. Every tool with output has one.
 *   summary(input): the short text after the tool's name, when the general rule does not fit.
 *   markdown(input): the lines the Markdown export writes after the call's "⚙" line.
 * views-conv.js adds how a call is drawn to the same entries (card, input, resultText). */
const TOOLS = new Map([
  ['artifacts', {
    shown: true, output: () => true,
    chip: i => ({ ico: '◧', label: i.title || i.id || 'Artifact', kind: 'artifact' }),
    markdown: i => (i.content ? [`**Artifact: ${i.title || ''}**`, '', i.content, ''] : []),
  }],
  ['create_file', {
    shown: true, output: i => !!i.path,
    chip: i => ({ ico: '📄', label: String(i.path).split('/').pop(), kind: 'file' }),
    markdown: i => (i.file_text != null ? [fence(i.file_text, fileExt(i.path)), ''] : []),
  }],
  ['visualize:show_widget', {
    shown: true, output: () => true,
    chip: i => ({ ico: '▦', label: i.title || 'Widget', kind: 'widget' }),
    markdown: i => (i.title ? [`_Interactive widget: ${i.title}_`, ''] : []),
  }],
  ['message_compose_v1', {
    shown: true, output: () => true,
    chip: i => ({ ico: '✉', label: i.summary_title || 'Draft', kind: 'draft' }),
    markdown: i => composeVariants(i).flatMap(v => [
      `**Draft${v.label ? ' — ' + v.label : ''}${i.summary_title ? ': ' + i.summary_title : ''}**`, '',
      ...(v.subject ? ['Subject: ' + v.subject, ''] : []),
      String(v.body || ''), '',
    ]),
  }],
  ['ask_user_input_v0', {
    shown: true,
    markdown: i => (!Array.isArray(i.questions) ? [] : [
      ...i.questions.map(q => `- **${q.question || ''}** ${(Array.isArray(q.options) ? q.options : []).map(o => '`' + (typeof o === 'string' ? o : JSON.stringify(o)) + '`').join(' · ')}`), '',
    ]),
  }],
  ['chart_display_v0', { shown: true }],
  ['places_map_display_v0', { shown: true }],
  ['Artifact', { shown: true }],
  ['present_files', {
    shown: true,
    summary: i => (Array.isArray(i.filepaths) ? i.filepaths.map(p => String(p).split('/').pop()).join(', ') : ''),
  }],
  ['bash_tool', {}],
  ['str_replace', {}],
  ['str_replace_edit', {}],
]);

// Did this tool call make an output (TOOLS: output)?
function isOutput(b) {
  const t = TOOLS.get(b.name);
  return !!(t && t.output) && t.output(b.input || {});
}

function toolLabel(name) {
  const s = String(name || 'tool');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(i + 1) : s;
}

// The short text after a tool's name: its own summary (TOOLS), else the first common input field.
function toolInputSummary(name, i) {
  if (!i || typeof i !== 'object') return '';
  const t = TOOLS.get(name);
  const own = t && t.summary ? t.summary(i) : '';
  if (own) return own;
  const v = i.query || i.q || i.command || i.url || i.path || i.file_path || i.jql || i.title || i.summary_title || i.issueIdOrKey || i.summary || i.action || i.searchString || i.description || i.keywords || '';
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/* Draft variants. The model sometimes sends `variants` as a broken string (e.g. "label" or
 * '<parameter name="label">Warm'), while the real text sits in input.body. */
function composeVariants(input) {
  if (Array.isArray(input.variants)) return input.variants.filter(v => v && typeof v === 'object');
  const raw = typeof input.variants === 'string' ? input.variants : '';
  if (raw) {
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object'); } catch (e) { /* not JSON */ }
  }
  if (typeof input.body === 'string' && input.body.trim()) {
    const label = oneLine(raw.replace(/<[^>]*>/g, ''));
    return [{ label: label && label !== 'label' && label.length < 60 ? label : '', subject: input.subject, body: input.body }];
  }
  return raw ? [{ body: raw }] : [];
}

// Citation offsets count Unicode code points; JS strings index UTF-16 units.
function cpToUnits(text, cp) {
  let units = 0, n = 0;
  for (const ch of text) { if (n >= cp) break; units += ch.length; n++; }
  return units;
}

/* ---------- Outputs ---------- */

// What the "What Claude produced here" box lists: the tool calls that made an output (isOutput),
// as { use, msg }, then the published artifacts the chat links to, as { art: id }.
function collectOutputs(conv) {
  const out = [];
  for (const m of conv.raw.chat_messages) {
    for (const b of m.content) {
      if (b.type === 'tool_use' && isOutput(b)) out.push({ use: b, msg: m.uuid });
    }
  }
  for (const id of conv.artRefs) out.push({ art: id });
  return out;
}
