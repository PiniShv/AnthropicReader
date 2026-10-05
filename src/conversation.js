/* Conversations as data: the message tree and its branches, tool names and inputs, and the
 * outputs Claude produced. No DOM. */
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
 * fork count (addConversation in model.js) both use it, so the "branch points" chip always
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
  const msgs = conv.raw.chat_messages || [];
  const children = childrenByParent(msgs);
  t = { msgs, byId: new Map(), children: children || new Map(), newest: new Map(), linear: !children, created: new Map() };
  for (const m of msgs) {
    t.byId.set(m.uuid, m);
    for (const b of (Array.isArray(m.content) ? m.content : [])) {
      if (b && b.type === 'tool_use' && b.name === 'create_file' && b.input && b.input.path) t.created.set(b.input.path, b);
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

// The visible path: from the root, at each fork take the chosen child, else the child whose
// branch holds the newest message (the last array element is always the current leaf).
function currentPath(conv) {
  const t = buildTree(conv);
  if (t.linear) return t.msgs.slice();
  const choice = BRANCH_CHOICE.get(conv.id) || new Map();
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

function toolLabel(name) {
  const s = String(name || 'tool');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(i + 1) : s;
}

function toolInputSummary(name, i) {
  if (!i || typeof i !== 'object') return '';
  const v = i.query || i.q || i.command || i.url || i.path || i.file_path || i.jql || i.title || i.summary_title || i.issueIdOrKey || i.summary || i.action || i.searchString || i.description || i.keywords || '';
  if (Array.isArray(v)) return v.join(', ');
  if (Array.isArray(i.filepaths)) return i.filepaths.map(p => String(p).split('/').pop()).join(', ');
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

// The files, artifacts, widgets and drafts Claude produced, then the published artifacts the
// chat links to: the "What Claude produced here" box.
function collectOutputs(conv) {
  const out = [];
  for (const m of conv.raw.chat_messages || []) {
    for (const b of (Array.isArray(m.content) ? m.content : [])) {
      const o = b && b.type === 'tool_use' && outputOf(b);
      if (o) out.push({ id: b.id, msg: m.uuid, ...o });
    }
  }
  for (const id of conv.artRefs || []) {
    const a = DB.artifactById.get(id);
    out.push({ art: id, ico: '◧', label: a ? a.title : 'Published artifact ' + id.slice(0, 8), kind: 'published' });
  }
  return out;
}
