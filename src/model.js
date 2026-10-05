/* In-memory model of a Claude export: people and everything they own.
 * importExport() classifies files, parses them, and links every item to a Person. */
'use strict';

const UUID_PAT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_ARTIFACT = new RegExp('(?:^|/)(' + UUID_PAT + ')/(artifact\\.json|comments\\.json|artifact_comments\\.json|page\\.md|versions/.+)$', 'i');
const RE_DESIGN = /(?:^|\/)design_chats[^/]*\/[^/]+\.json$/i;
const RE_PROJECT = /(?:^|\/)projects[^/]*\/[^/]+\.json$/i;
const RE_MEMORY = /(?:^|\/)memories[^/]*\/[^/]+\.json$/i;
const RE_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._)|Thumbs\.db$/i;
const NO_OWNER = '__none__';

// Accepts ISO strings with 0-9 fraction digits and either Z or +00:00.
function parseTime(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).replace(/(\.\d{3})\d+/, '$1');
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

class Person {
  constructor(id) {
    this.id = id;
    this.known = false;          // present in users.json
    this.system = id === NO_OWNER;
    this.fullName = null;
    this.email = '';
    this.phone = '';
    this.hints = [];             // names seen in the data (creator.full_name, authorName, …)
    this.name = '';              // display name, set in finalize()
    this.resetLinks();
  }
  // Everything finalize() links to a person. It runs again on every load, so it starts here.
  resetLinks() {
    this.conversations = [];
    this.projects = [];
    this.designChats = [];
    this.artifacts = [];
    this.memory = null;
    this.comments = [];          // {artifact, thread, comment, byAgent, source}
    this.messageCount = 0;
    this.first = 0;
    this.last = 0;
  }
  touch(t) {
    if (!t) return;
    if (!this.first || t < this.first) this.first = t;
    if (t > this.last) this.last = t;
  }
  // One definition of each count, used by every card, tile, tab and sidebar badge.
  convCount() { return this.conversations.reduce((n, c) => n + (c.empty ? 0 : 1), 0); }
  emptyConvCount() { return this.conversations.length - this.convCount(); }
  memoryCount() {
    const m = this.memory;
    return m ? m.files.length + (m.conversationsMemory ? 1 : 0) + m.projectMemories.length : 0;
  }
  total() {
    return this.convCount() + this.projects.length + this.designChats.length +
      this.artifacts.length + (this.memory ? 1 : 0) + this.comments.filter(c => !c.byAgent).length;
  }
  emailLocal() { return (this.email || '').split('@')[0]; }
}

// An import writes only the id Maps. finalize() builds the sorted lists from them.
const DB = {
  people: new Map(),
  conversations: [], convById: new Map(),
  projects: [], projectById: new Map(),
  designChats: [], designById: new Map(),
  memories: [], memoryByPerson: new Map(),
  artifacts: [], artifactById: new Map(),
  manifests: [],
  sources: [],
  warnings: [],
  ignored: [],
  generation: 0,   // goes up on every finalize(), so caches of derived data know to start again
};

function personFor(id, hint) {
  if (!id) id = NO_OWNER;
  let p = DB.people.get(id);
  if (!p) { p = new Person(id); DB.people.set(id, p); }
  if (hint && typeof hint === 'string' && hint.trim() && !p.hints.includes(hint.trim())) p.hints.push(hint.trim());
  return p;
}

/* ---------- Classification ---------- */

function classify(node) {
  const path = node.path;
  if (RE_JUNK.test(path) || path.endsWith('/')) return { kind: 'junk' };
  const base = path.split('/').pop().toLowerCase();
  const m = RE_ARTIFACT.exec(path);
  if (m) return { kind: 'artifact', id: m[1].toLowerCase(), rel: m[2] };
  if (base === 'conversations.json') return { kind: 'conversations' };
  if (base === 'users.json') return { kind: 'users' };
  if (base === 'projects.json') return { kind: 'projects-array' };
  if (base === 'memories.json') return { kind: 'memories-array' };
  if (/^manifest.*\.json$/.test(base)) return { kind: 'manifest' };
  if (RE_DESIGN.test(path)) return { kind: 'design' };
  if (RE_PROJECT.test(path)) return { kind: 'project' };
  if (RE_MEMORY.test(path)) return { kind: 'memory' };
  if (base.endsWith('.json') && node.size < 64 * 1024 * 1024) return { kind: 'sniff' };
  return { kind: 'other' };
}

// Classify a parsed JSON value by its shape (for files with unexpected names).
function sniffShape(v) {
  const first = Array.isArray(v) ? v.find(x => x && typeof x === 'object') : v;
  if (!first || typeof first !== 'object') return null;
  if ('chat_messages' in first) return Array.isArray(v) ? 'conversations' : 'conversation';
  if ('email_address' in first && 'uuid' in first) return 'users';
  if ('docs' in first && 'creator' in first) return Array.isArray(v) ? 'projects-array' : 'project';
  if ('account_uuid' in first && ('memory_files' in first || 'conversations_memory' in first || 'project_memories' in first)) return Array.isArray(v) ? 'memories-array' : 'memory';
  if ('messages' in first && 'project' in first) return 'design';
  if ('data_files' in first) return 'manifest';
  return null;
}

/* ---------- Ingest: each record type ---------- */

function addUsers(list) {
  if (!Array.isArray(list)) return;
  for (const u of list) {
    if (!u || !u.uuid) continue;
    const p = personFor(u.uuid);
    p.known = true;
    if (u.full_name && String(u.full_name).trim()) p.fullName = String(u.full_name).trim();
    if (u.email_address) p.email = u.email_address;
    if (u.verified_phone_number) p.phone = u.verified_phone_number;
  }
}

/* Tools whose output the person saw: name -> a function that gives the output's chip in the
 * "What Claude produced here" box (collectOutputs), or null. The list badge counts every call
 * of these tools, so it also counts a create_file without a path, which the box leaves out. */
const OUTPUTS = new Map([
  ['create_file', i => (i.path ? { ico: '📄', label: i.path.split('/').pop(), kind: 'file' } : null)],
  ['artifacts', i => ({ ico: '◧', label: i.title || i.id || 'Artifact', kind: 'artifact' })],
  ['visualize:show_widget', i => ({ ico: '▦', label: i.title || 'Widget', kind: 'widget' })],
  ['message_compose_v1', i => ({ ico: '✉', label: i.summary_title || 'Draft', kind: 'draft' })],
]);
// Artifact ids referenced from chat JSON: published links and tool result ids.
const RE_ART_REF = /(?:\/artifact\/|artifact_id\\?"\s*:\s*\\?")([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

function addConversation(c, source, rawText) {
  if (!c || !c.uuid) return;
  const msgs = Array.isArray(c.chat_messages) ? c.chat_messages : [];
  const updated = parseTime(c.updated_at);
  const prev = DB.convById.get(c.uuid);
  if (prev) {
    // Same chat in two exports: keep the newer / longer copy. It moves to the end, like a new chat.
    if (updated < prev.updated || (updated === prev.updated && msgs.length <= prev.msgCount)) return;
    DB.convById.delete(c.uuid);
  }
  let human = 0, firstTs = 0, lastTs = 0, contentful = 0, files = 0, outputs = 0, tools = 0, firstHuman = '', firstReply = '';
  const childCount = new Map();
  for (const m of msgs) {
    if (m.sender === 'human') human++;
    const t = parseTime(m.created_at);
    if (t && (!firstTs || t < firstTs)) firstTs = t;
    if (t > lastTs) lastTs = t;
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (blocks.length || (m.text && m.text.trim()) || (m.files && m.files.length) || (m.attachments && m.attachments.length)) contentful++;
    if (m.sender === 'human') files += (m.files ? m.files.length : 0);   // assistant files are tool screenshots
    for (const b of blocks) {
      if (b && b.type === 'tool_use') { tools++; if (OUTPUTS.has(String(b.name || ''))) outputs++; }
      else if (!firstHuman && m.sender === 'human' && b && b.type === 'text' && b.text && b.text.trim()) firstHuman = b.text;
      else if (!firstReply && m.sender === 'assistant' && b && b.type === 'text' && b.text && b.text.trim()) firstReply = b.text;
    }
    if (!firstHuman && m.sender === 'human' && m.text && m.text.trim()) firstHuman = m.text;
    const pu = m.parent_message_uuid;
    if (pu) childCount.set(pu, (childCount.get(pu) || 0) + 1);
  }
  let forks = 0;
  for (const n of childCount.values()) if (n > 1) forks++;
  const artRefs = new Set();
  if (rawText && rawText.indexOf('artifact') >= 0) {
    RE_ART_REF.lastIndex = 0;
    let m;
    while ((m = RE_ART_REF.exec(rawText))) artRefs.add(m[1]);
  }
  const name = (c.name || '').trim();
  const conv = {
    type: 'conversation',
    id: c.uuid,
    // No name: first prompt, else Claude's first reply, else what was uploaded.
    title: name || truncate(oneLine(firstHuman || firstReply), 70) || (files ? plural(files, 'uploaded file') + ' (not in export)' : ''),
    titleIsDerived: !name,
    summary: c.summary || '',
    created: parseTime(c.created_at),
    updated,
    ownerId: (c.account && c.account.uuid) || null,
    msgCount: msgs.length,
    humanCount: human,
    lastTs: lastTs || updated,
    empty: contentful === 0,
    fileCount: files,
    outputCount: outputs + artRefs.size,
    toolCount: tools,
    forks,
    artRefs,
    raw: c,
    source,
  };
  DB.convById.set(conv.id, conv);
}

function addProject(p, source) {
  if (!p || !p.uuid) return;
  const updated = parseTime(p.updated_at);
  const prev = DB.projectById.get(p.uuid);
  if (prev && prev.updated >= updated) return;
  const creator = p.creator || {};
  const proj = {
    type: 'project',
    id: p.uuid,
    name: (p.name || '').trim(),
    description: p.description || '',
    isPrivate: p.is_private !== false,
    isStarter: !!p.is_starter_project,
    promptTemplate: p.prompt_template || '',
    created: parseTime(p.created_at),
    updated,
    ownerId: creator.uuid || null,
    ownerHint: creator.full_name || '',
    docs: (Array.isArray(p.docs) ? p.docs : []).map(d => ({
      id: d.uuid || '',
      filename: d.filename || '(unnamed)',
      content: d.content == null ? '' : String(d.content),
      created: parseTime(d.created_at),
    })),
    raw: p,
    source,
  };
  DB.projectById.set(proj.id, proj);   // a newer copy keeps the old one's place
}

// Frontmatter is parsed line by line: some values contain ": " which breaks strict YAML.
function parseFrontmatter(text) {
  const { front, body } = splitFrontmatter(text || '');
  const meta = {};
  if (front) {
    for (const line of front.split(/\r?\n/)) {
      const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if (/^\[.*\]$/.test(v)) {
        const items = [];
        const re = /\s*(?:"((?:[^"\\]|\\.)*)"|([^,\[\]]+))/g;
        let t;
        while ((t = re.exec(v.slice(1, -1)))) {
          const val = (t[1] != null ? t[1].replace(/\\(["\\])/g, '$1') : t[2]).trim();
          if (val) items.push(val);
        }
        meta[m[1]] = items;
      } else {
        meta[m[1]] = v.replace(/^"(.*)"$/, '$1');
      }
    }
  }
  return { meta, body, front };
}

function addMemory(m, source) {
  if (!m || !m.account_uuid) return;
  const files = (Array.isArray(m.memory_files) ? m.memory_files : []).map(f => {
    const fm = parseFrontmatter(f.content || '');
    return {
      path: f.path || '',
      content: f.content || '',
      updated: parseTime(f.updated_at),
      meta: fm.meta,
      body: fm.body,
      stem: (f.path || '').split('/').pop().replace(/\.md$/i, ''),
    };
  });
  const projectMemories = Object.entries(m.project_memories || {}).map(([projectId, text]) => ({ projectId, text: String(text || '') }));
  const prev = DB.memoryByPerson.get(m.account_uuid);
  const mem = prev || { type: 'memory', id: m.account_uuid, ownerId: m.account_uuid, conversationsMemory: '', projectMemories: [], files: [], updated: 0, sources: [], rank: -1 };
  // Merge across exports. The summaries have no timestamp, so the copy whose memory files
  // are newest counts as the newer export (old memories.json has no files: rank 0).
  // Nothing is dropped: older text only fills gaps.
  const rank = files.reduce((mx, f) => Math.max(mx, f.updated || 0), 0);
  const newer = rank >= mem.rank;
  if (m.conversations_memory && (newer || !mem.conversationsMemory)) mem.conversationsMemory = m.conversations_memory;
  for (const pm of projectMemories) {
    const i = mem.projectMemories.findIndex(x => x.projectId === pm.projectId);
    if (i < 0) mem.projectMemories.push(pm); else if (newer) mem.projectMemories[i] = pm;
  }
  mem.rank = Math.max(mem.rank, rank);
  for (const f of files) {
    const i = mem.files.findIndex(x => x.path === f.path);
    if (i < 0) mem.files.push(f); else if (f.updated > mem.files[i].updated) mem.files[i] = f;
    if (f.updated > mem.updated) mem.updated = f.updated;
  }
  mem.files.sort((a, b) => a.path.localeCompare(b.path));
  mem.sources.push(source);
  if (!prev) DB.memoryByPerson.set(mem.id, mem);
}

// Strip platform-injected context blocks from a design-chat prompt.
function cleanDesignPrompt(s) {
  return String(s || '')
    .replace(/<system-info[\s\S]*?<\/system-info>/g, '')
    .replace(/<attached_files>[\s\S]*?<\/attached_files>/g, '')
    .replace(/<attached[^>]*>[\s\S]*?<\/attached[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

// Adjacent user rows with the same content.id are one message saved twice (server + client copy).
function dedupeDesignMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    const c = m && m.content && typeof m.content === 'object' ? m.content : null;
    const prev = out[out.length - 1];
    const pc = prev && prev.content && typeof prev.content === 'object' ? prev.content : null;
    if (c && pc && m.role === 'user' && prev.role === 'user' && c.id && c.id === pc.id) {
      const better = c.authorAccountUuid && !pc.authorAccountUuid ? m
        : (!c.authorAccountUuid && pc.authorAccountUuid ? prev : (Object.keys(c).length > Object.keys(pc).length ? m : prev));
      const other = better === m ? prev : m;
      const bc = better.content, oc = other.content;
      const atts = Array.isArray(bc.attachments) ? bc.attachments.slice() : [];
      for (const a of (Array.isArray(oc.attachments) ? oc.attachments : [])) if (a && !atts.some(x => x && x.id === a.id)) atts.push(a);
      out[out.length - 1] = Object.assign({}, better, { content: Object.assign({}, oc, bc, { attachments: atts }) });
      continue;
    }
    out.push(m);
  }
  return out;
}

function addDesignChat(d, source) {
  if (!d || !d.uuid) return;
  const updated = parseTime(d.updated_at);
  const prev = DB.designById.get(d.uuid);
  if (prev && prev.updated >= updated) return;
  const msgs = dedupeDesignMessages(Array.isArray(d.messages) ? d.messages : []);
  // Attribution: uuid authors, plus name-only messages resolved inside this chat.
  const nameToId = new Map();
  const hints = new Map();
  const realCounts = new Map();   // typed (non-pill) messages per author
  const authorOrder = [];
  for (const m of msgs) {
    const c = m && m.content && typeof m.content === 'object' ? m.content : {};
    if (c.authorAccountUuid) {
      if (!authorOrder.includes(c.authorAccountUuid)) authorOrder.push(c.authorAccountUuid);
      if (c.authorName) { nameToId.set(String(c.authorName).toLowerCase(), c.authorAccountUuid); hints.set(c.authorAccountUuid, c.authorName); }
    }
  }
  let firstPrompt = '', lastTs = 0;
  for (const m of msgs) {
    const c = m && m.content && typeof m.content === 'object' ? m.content : {};
    const id = c.authorAccountUuid || (c.authorName ? nameToId.get(String(c.authorName).toLowerCase()) : null);
    if (id && !authorOrder.includes(id)) authorOrder.push(id);
    if (m.role === 'user' && id && c.pill !== true) realCounts.set(id, (realCounts.get(id) || 0) + 1);
    if (!firstPrompt && m.role === 'user' && c.pill !== true && c.kind !== 'question-receipt') {
      const t = cleanDesignPrompt(c.content);
      // Skip short messages the app writes for the person ("Apply drawing", "Questions answered: …").
      if (t && !/^(Apply (comment|drawing)s?|Questions (timed out|answered)\b.*)$/is.test(t)) firstPrompt = t;
    }
    lastTs = Math.max(lastTs, parseTime(m.created_at));
  }
  // Owner = most typed messages; ties go to whoever wrote first.
  let ownerId = null, best = -1;
  for (const id of authorOrder) { const n = realCounts.get(id) || 0; if (n > best) { best = n; ownerId = id; } }
  const projectName = d.project && d.project.name ? String(d.project.name) : '';
  const rawTitle = (d.title || '').trim();
  const chat = {
    type: 'design',
    id: d.uuid,
    title: rawTitle && rawTitle !== 'Chat' ? rawTitle : (firstPrompt ? truncate(oneLine(firstPrompt), 80) : (projectName || 'Empty design chat')),
    firstPrompt,
    project: d.project && typeof d.project === 'object' ? { id: d.project.uuid || '', name: projectName } : { id: '', name: '' },
    created: parseTime(d.created_at),
    updated,
    lastTs: lastTs || updated,
    msgCount: msgs.length,
    messages: msgs,
    authorIds: ownerId ? [ownerId, ...authorOrder.filter(x => x !== ownerId)] : [],
    authorHints: hints,
    nameToId,
    raw: d,
    source,
  };
  chat.ownerId = ownerId;
  DB.designById.set(chat.id, chat);   // a newer copy keeps the old one's place
}

function artifactFor(id) {
  let a = DB.artifactById.get(id);
  if (!a) {
    a = {
      type: 'artifact', id, kind: 'artifact', visibility: '', versions: [], activeVersion: '',
      ownerId: null, createdByAgent: false, sharedWith: null, updated: 0, created: 0,
      // comments and threads stay null until a file gives them: the first file read wins.
      title: '', description: '', files: new Map(), meta: null, comments: null, threads: null, pageNode: null,
    };
    DB.artifactById.set(id, a);
  }
  return a;
}

function applyArtifactMeta(a, j) {
  if (!j || typeof j !== 'object') return;
  const updated = parseTime(j.updated_at);
  if (a.meta && updated < a.updated) return;
  a.meta = j;
  a.kind = j.kind || 'artifact';
  a.visibility = j.visibility || '';
  a.versions = (Array.isArray(j.versions) ? j.versions : []).map(v => ({
    id: v.id || '', title: decodeEntities(v.title || ''), description: v.description || '', created: parseTime(v.created_at), raw: v,
  }));
  a.activeVersion = j.active_version || (a.versions[0] && a.versions[0].id) || '';
  a.ownerId = j.owner_account || null;
  a.createdByAgent = !!j.created_by_agent;
  a.sharedWith = j.shared_with || null;
  // updated_at can be older than the newest version, so take the later of the two.
  a.updated = Math.max(updated, ...a.versions.map(v => v.created || 0));
  const active = a.versions.find(v => v.id === a.activeVersion) || a.versions[0];
  a.title = (active && active.title) || '';
  a.description = decodeEntities((active && active.description) || '');
  a.created = a.versions.reduce((min, v) => (v.created && (!min || v.created < min) ? v.created : min), 0) || updated;
}

// Group an artifact's files per version: a single versions/<vid>.html, or a folder
// versions/<vid>/... (entry index.html) with a versions/<vid>.files.json manifest.
function indexArtifactVersions(a) {
  a.vfiles = new Map();
  const slot = vid => {
    let s = a.vfiles.get(vid);
    if (!s) { s = { single: null, manifest: null, folder: new Map() }; a.vfiles.set(vid, s); }
    return s;
  };
  for (const [rel, node] of a.files) {
    let m = /^versions\/([^/]+)\.files\.json$/.exec(rel);
    if (m) { slot(m[1]).manifest = node; continue; }
    m = /^versions\/([^/]+)\/(.+)$/.exec(rel);
    if (m) { slot(m[1]).folder.set(m[2], node); continue; }
    m = /^versions\/([^/]+)\.(html?)$/i.exec(rel);
    if (m) { slot(m[1]).single = node; continue; }
  }
}

// Files of a typed app's runtime (Slides, Design) and its instructions for Claude, not user content.
function isPlumbing(p) { return /^(SKILL\.md$|artifact-type\/)/.test(p); }

// What a version contains and how to show it.
function versionInfo(a, vid) {
  const s = a.vfiles && a.vfiles.get(vid);
  if (!s) return { type: a.kind === 'page' ? 'Doc' : 'No files', slot: null };
  if (s.single) return { type: 'HTML', slot: s };
  const f = s.folder;
  if (f.has('project/deck.json') || Array.from(f.keys()).some(k => k.startsWith('project/slides/'))) return { type: 'Slides', slot: s };
  if (f.has('project/canvas.json')) return { type: 'Design', slot: s };
  if (Array.from(f.keys()).some(isPlumbing)) return { type: 'App (data not exported)', slot: s, typedEmpty: true };
  if (f.has('index.html')) return { type: 'HTML + files', slot: s };
  return { type: f.size ? 'Files' : 'No files', slot: s };
}

// Descriptions arrive HTML-escaped (e.g. "&amp;"); decode for display as text.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (err) { return all; }
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v != null ? v : all;
  });
}

/* ---------- Import pipeline ---------- */

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

async function readJson(node) {
  const text = await node.text();
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

// Many small files: how to add one parsed file of each kind, in the order they are read.
const SMALL_INGEST = new Map([
  ['project', addProject],
  ['projects-array', (v, src) => (Array.isArray(v) ? v : [v]).forEach(p => addProject(p, src))],
  ['memory', addMemory],
  ['memories-array', (v, src) => (Array.isArray(v) ? v : [v]).forEach(m => addMemory(m, src))],
  ['design', addDesignChat],
  ['manifest', addManifest],
]);

async function importExport(files, ui) {
  const t0 = performance.now();
  ui.set('scan', 'Reading ' + plural(files.length, 'file') + '…', 0.02, '');
  const { nodes, sources } = await nodesFromFiles(files, msg => ui.set('scan', msg, 0.05, ''));
  DB.sources.push(...sources);
  for (const s of sources) if (s.error) DB.warnings.push(s.name + ': ' + s.error);

  const groups = { conversations: [], users: [], 'projects-array': [], 'memories-array': [], manifest: [], design: [], project: [], memory: [], sniff: [] };
  const artifactNodes = [];
  for (const n of nodes) {
    const c = classify(n);
    if (c.kind === 'artifact') { n.artId = c.id; n.rel = c.rel; artifactNodes.push(n); }
    else if (groups[c.kind]) groups[c.kind].push(n);
    else if (c.kind === 'other') DB.ignored.push(n.path);
  }
  ui.set('scan', 'Found ' + plural(nodes.length, 'file') + ' in ' + plural(sources.length, 'source'), 1, '', 'done');

  // Shape-sniff stray JSON files and fold them into the right group.
  const sniffed = new Map();
  await mapLimit(groups.sniff, 6, async n => {
    try {
      const v = await readJson(n);
      const kind = sniffShape(v);
      if (kind) sniffed.set(n, { kind, value: v }); else DB.ignored.push(n.path);
    } catch (e) { DB.ignored.push(n.path); }
  });

  // 1. People first, so later records can attach to them.
  for (const n of groups.users) {
    try { addUsers(await readJson(n)); } catch (e) { DB.warnings.push(n.path + ': ' + e.message); }
  }
  for (const [, s] of sniffed) if (s.kind === 'users') addUsers(s.value);
  ui.set('users', 'People', 1, plural(DB.people.size, 'person', 'people'), 'done');

  // 2. Conversations: streamed, one chat at a time.
  const convNodes = groups.conversations;
  const totalConvBytes = convNodes.reduce((a, n) => a + (n.size || 0), 0) || 1;
  let doneBytes = 0;
  for (const n of convNodes) {
    const label = 'Conversations' + (convNodes.length > 1 ? ' (' + n.container + ')' : '');
    try {
      const base = doneBytes;
      let lastPaint = 0;
      await parseJsonArrayStream(await n.stream(), (c, text) => addConversation(c, n.container, text), bytes => {
        const now = performance.now();
        if (now - lastPaint > 80) {
          lastPaint = now;
          ui.set('conv', label, (base + bytes) / totalConvBytes, fmtNum(DB.convById.size) + ' chats · ' + fmtBytes(base + bytes) + ' / ' + fmtBytes(totalConvBytes));
        }
      });
      doneBytes += n.size || 0;
    } catch (e) {
      DB.warnings.push(n.path + ': ' + e.message);
      ui.set('conv', label + ': ' + e.message, 1, '', 'error');
    }
  }
  for (const [, s] of sniffed) {
    if (s.kind === 'conversations') s.value.forEach(c => addConversation(c, 'loose file'));
    if (s.kind === 'conversation') addConversation(s.value, 'loose file');
  }
  if (convNodes.length || DB.convById.size) ui.set('conv', 'Conversations', 1, fmtNum(DB.convById.size) + ' chats', 'done');

  // 3. Projects, memories, design chats: many small files.
  const small = [...SMALL_INGEST.keys()].flatMap(kind => groups[kind].map(n => [kind, n]));
  let smallDone = 0;
  await mapLimit(small, 8, async ([kind, n]) => {
    try { SMALL_INGEST.get(kind)(await readJson(n), n.container); }
    catch (e) { DB.warnings.push(n.path + ': ' + e.message); }
    smallDone++;
    if (smallDone % 10 === 0 || smallDone === small.length) {
      ui.set('small', 'Projects, memories, design chats', smallDone / small.length, smallDone + ' / ' + small.length + ' files');
    }
  });
  for (const [n, s] of sniffed) {
    const add = SMALL_INGEST.get(s.kind);   // users and conversations were added above
    if (add) add(s.value, n.container);
  }
  if (small.length) ui.set('small', 'Projects, memories, design chats', 1,
    `${DB.projectById.size} projects · ${DB.memoryByPerson.size} memories · ${DB.designById.size} design chats`, 'done');

  // 4. Artifacts: index files, read the small metadata files only.
  for (const n of artifactNodes) {
    const a = artifactFor(n.artId);
    if (!a.files.has(n.rel)) a.files.set(n.rel, n);
  }
  const metaNodes = artifactNodes.filter(n => n.rel === 'artifact.json' || n.rel === 'comments.json' || n.rel === 'artifact_comments.json');
  let metaDone = 0;
  await mapLimit(metaNodes, 16, async n => {
    const a = DB.artifactById.get(n.artId);
    try {
      const v = await readJson(n);
      if (n.rel === 'artifact.json') applyArtifactMeta(a, v);
      else if (n.rel === 'comments.json') { if (a.comments === null && Array.isArray(v)) a.comments = v; }
      else if (n.rel === 'artifact_comments.json') { if (a.threads === null && v && Array.isArray(v.threads)) a.threads = v.threads; }
    } catch (e) { DB.warnings.push(n.container + ': ' + n.path + ': ' + e.message); }
    metaDone++;
    if (metaDone % 50 === 0 || metaDone === metaNodes.length) ui.set('art', 'Artifacts', metaDone / metaNodes.length, fmtNum(metaDone) + ' / ' + fmtNum(metaNodes.length) + ' metadata files');
  });
  if (artifactNodes.length) ui.set('art', 'Artifacts', 1, fmtNum(DB.artifactById.size) + ' artifacts · ' + fmtNum(artifactNodes.length) + ' files indexed', 'done');

  finalize();
  ui.set('done', 'Ready in ' + fmtDuration(performance.now() - t0), 1, '', 'done');
  if (!hasRecords() && !DB.manifests.length) {
    throw new Error('No Claude export data found in what you picked. Choose the .zip files from the export, or the folder they were unpacked into.');
  }
}

function addManifest(v, source) {
  if (!v || typeof v !== 'object') return;
  // export_url values are single-use download links. They stay in this tab's memory only,
  // are offered as "Download" links for parts that are not loaded, and are never stored,
  // logged or shown as text. Only https://claude.ai/export/… links are accepted.
  DB.manifests.push({
    createdAt: parseTime(v.created_at),
    totalFiles: v.total_files,
    version: v.version,
    files: (Array.isArray(v.data_files) ? v.data_files : []).map(f => ({
      category: f.category, part: f.part, filename: f.filename,
      url: typeof f.export_url === 'string' && /^https:\/\/claude\.ai\/export\//.test(f.export_url) ? f.export_url : '',
    })),
    source,
  });
}

// Any record or person loaded? A manifest alone does not count.
function hasRecords() {
  return !!(DB.conversations.length || DB.projects.length || DB.artifacts.length ||
    DB.designChats.length || DB.memories.length || DB.people.size);
}

// The newest manifest that was loaded, or null.
function latestManifest() {
  return DB.manifests.slice().sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

/* ---------- Linking & derived data ---------- */

function finalize() {
  DB.conversations = Array.from(DB.convById.values());
  DB.projects = Array.from(DB.projectById.values());
  DB.designChats = Array.from(DB.designById.values());
  DB.memories = Array.from(DB.memoryByPerson.values());
  DB.artifacts = Array.from(DB.artifactById.values());
  // Rebuild every link from scratch, so loading more files later never double-counts.
  for (const p of DB.people.values()) p.resetLinks();

  for (const c of DB.conversations) {
    const p = personFor(c.ownerId);
    c.owner = p;
    p.conversations.push(c);
    p.messageCount += c.msgCount;
    p.touch(c.created); p.touch(c.lastTs);
  }
  for (const pr of DB.projects) {
    const p = personFor(pr.ownerId, pr.ownerHint);
    pr.owner = p;
    p.projects.push(pr);
    p.touch(pr.created); p.touch(pr.updated);
  }
  for (const m of DB.memories) {
    const p = personFor(m.ownerId);
    m.owner = p;
    p.memory = m;
    p.touch(m.updated);
  }
  for (const d of DB.designChats) {
    d.authors = d.authorIds.map(id => personFor(id, d.authorHints.get(id)));
    d.owner = d.authors[0] || personFor(NO_OWNER);
    if (!d.authors.length) { d.owner.designChats.push(d); d.owner.touch(d.created); d.owner.touch(d.lastTs); }
    for (const p of d.authors) { p.designChats.push(d); p.touch(d.created); p.touch(d.lastTs); }
  }
  for (const a of DB.artifacts) {
    if (!a.meta) {
      // Files without artifact.json (partial export): still show them.
      const vids = new Set();
      for (const rel of a.files.keys()) { const m = /^versions\/([^/]+?)(?:\.files\.json|\.[a-z0-9]+|\/.*)$/i.exec(rel); if (m) vids.add(m[1]); }
      a.versions = Array.from(vids).sort().reverse().map(id => ({ id, title: '', description: '', created: parseTime(Number(id.split('-')[0]) || 0), raw: {} }));
      a.activeVersion = a.versions[0] ? a.versions[0].id : '';
      if (a.files.has('page.md')) a.kind = 'page';
    }
    a.pageNode = a.files.get('page.md') || null;
    indexArtifactVersions(a);
    a.contentType = a.kind === 'page' ? 'Doc' : versionInfo(a, a.activeVersion).type;
    a.owner = personFor(a.ownerId);
    if (!a.title) a.title = a.pageNode ? 'Untitled page' : 'Untitled artifact';
    a.owner.artifacts.push(a);
    a.owner.touch(a.updated);
    // Page comments carry real author uuids.
    for (const th of a.comments || []) {
      for (const cm of (th && th.comments) || []) {
        const au = cm.author || null;
        const who = au && au.uuid ? personFor(au.uuid, au.full_name) : null;
        if (who) { who.comments.push({ artifact: a, thread: th, comment: cm, byAgent: !!cm.posted_by_agent, source: 'page' }); who.touch(parseTime(cm.created_at)); }
      }
    }
    // Thread comments are anonymous; only the owner's own (non-Claude) comments are attributable.
    for (const th of a.threads || []) {
      for (const cm of (th && th.comments) || []) {
        if (isDuplicateThreadComment(a, cm)) continue;
        if (cm.author_is_artifact_owner && cm.author_role !== 'assistant' && a.ownerId) {
          a.owner.comments.push({ artifact: a, thread: th, comment: cm, byAgent: false, source: 'thread' });
        }
      }
    }
  }

  // Reverse links: which conversations mention a published artifact (artRefs is a Set).
  for (const a of DB.artifacts) a.mentionedIn = [];
  for (const c of DB.conversations) {
    for (const id of c.artRefs) {
      const a = DB.artifactById.get(id);
      if (a) a.mentionedIn.push(c);
    }
  }

  // Display names: users.json name → name seen in data → email local part → short id.
  for (const p of DB.people.values()) {
    if (p.system) { p.name = 'No owner'; continue; }
    p.name = p.fullName || p.hints[0] || p.emailLocal() || ('Unknown user · ' + p.id.slice(0, 8));
    p.nameIsFallback = !p.fullName;
  }
  // Disambiguate repeated names everywhere by appending the email local part.
  const groups = new Map();
  for (const p of DB.people.values()) {
    const k = p.name.toLowerCase().trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const p of list) p.name += ' · ' + (p.emailLocal() || p.id.slice(0, 8));
  }

  const byNewest = (a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0);
  DB.conversations.sort((a, b) => b.lastTs - a.lastTs);
  const byLast = (a, b) => b.lastTs - a.lastTs;
  DB.projects.sort(byNewest);
  DB.designChats.sort(byLast);
  DB.artifacts.sort(byNewest);
  DB.memories.sort((a, b) => b.updated - a.updated);
  for (const p of DB.people.values()) {
    p.conversations.sort(byLast);
    p.projects.sort(byNewest);
    p.designChats.sort(byLast);
    p.artifacts.sort(byNewest);
    p.comments.sort((a, b) => parseTime(b.comment.created_at) - parseTime(a.comment.created_at));
  }
  // Put each id Map in list order, so the next load starts from the order the lists have now.
  // artifactById keeps first-seen order: the artifact list was always built from it.
  for (const [byId, list] of [[DB.convById, DB.conversations], [DB.projectById, DB.projects], [DB.designById, DB.designChats], [DB.memoryByPerson, DB.memories]]) {
    byId.clear();
    for (const x of list) byId.set(x.id, x);
  }
  DB.generation++;
}

// artifact_comments.json repeats doc questions (author_role "page") that comments.json already has.
function isDuplicateThreadComment(a, cm) {
  return cm && cm.author_role === 'page' && Array.isArray(a.comments) && a.comments.length > 0;
}

/* ---------- Queries ---------- */

function peopleSorted() {
  return Array.from(DB.people.values()).sort((a, b) => (b.total() - a.total()) || a.name.localeCompare(b.name));
}

function peopleMatching(q) {
  q = (q || '').toLowerCase().trim();
  const all = peopleSorted().filter(p => !p.system);
  if (!q) return all;
  return all.filter(p => p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || p.id.startsWith(q));
}

// The records in view: one person's (finalize() linked them), or everyone's when p is null.
// key names the scope in table state keys ('conv-all', 'conv-<person id>').
function scopeOf(p) {
  return p
    ? { person: p, key: p.id, conversations: p.conversations, projects: p.projects, artifacts: p.artifacts, designChats: p.designChats, memories: p.memory ? [p.memory] : [] }
    : { person: null, key: 'all', conversations: DB.conversations, projects: DB.projects, artifacts: DB.artifacts, designChats: DB.designChats, memories: DB.memories };
}

function projectName(id) {
  const p = DB.projectById.get(id);
  return p ? (p.name || 'Untitled project') : '';
}
