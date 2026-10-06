/* Reading an export into the model (DB in model.js): classify() sorts the files, one add…()
 * function per record type reads a record, and importExport() runs the whole import, then
 * finalize(). */
'use strict';

const UUID_PAT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_ARTIFACT = new RegExp('(?:^|/)(' + UUID_PAT + ')/(artifact\\.json|comments\\.json|artifact_comments\\.json|page\\.md|versions/.+)$', 'i');
const RE_DESIGN = /(?:^|\/)design_chats[^/]*\/[^/]+\.json$/i;
const RE_PROJECT = /(?:^|\/)projects[^/]*\/[^/]+\.json$/i;
const RE_MEMORY = /(?:^|\/)memories[^/]*\/[^/]+\.json$/i;
const RE_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._)|Thumbs\.db$/i;

/* ---------- Classification ---------- */

function classify(node) {
  const path = node.path;
  if (RE_JUNK.test(path) || path.endsWith('/')) return { kind: 'junk' };
  const base = path.split('/').pop().toLowerCase();
  const m = RE_ARTIFACT.exec(path);
  if (m) return { kind: 'artifact', id: m[1].toLowerCase(), rel: m[2] };
  if (base === 'conversations.json') return { kind: 'conversations' };
  if (base === 'users.json') return { kind: 'users' };
  if (base === 'projects.json') return { kind: 'projects' };
  if (base === 'memories.json') return { kind: 'memories' };
  if (/^manifest.*\.json$/.test(base)) return { kind: 'manifest' };
  if (RE_DESIGN.test(path)) return { kind: 'design' };
  if (RE_PROJECT.test(path)) return { kind: 'projects' };
  if (RE_MEMORY.test(path)) return { kind: 'memories' };
  if (base.endsWith('.json') && node.size < 64 * 1024 * 1024) return { kind: 'sniff' };
  return { kind: 'other' };
}

// Classify a parsed JSON value by its shape (for files with unexpected names). Like classify(),
// it gives one kind per record type: a file may hold one record or a list of them.
function sniffShape(v) {
  const first = Array.isArray(v) ? v.find(x => x && typeof x === 'object') : v;
  if (!first || typeof first !== 'object') return null;
  if ('chat_messages' in first) return 'conversations';
  if ('email_address' in first && 'uuid' in first) return 'users';
  if ('docs' in first && 'creator' in first) return 'projects';
  if ('account_uuid' in first && ('memory_files' in first || 'conversations_memory' in first || 'project_memories' in first)) return 'memories';
  if ('messages' in first && 'project' in first) return 'design';
  if ('data_files' in first) return 'manifest';
  return null;
}

/* ---------- Ingest: each record type ---------- */

function addUser(u) {
  if (!u.uuid) return;
  const p = personFor(u.uuid);
  p.known = true;
  if (u.full_name && String(u.full_name).trim()) p.fullName = String(u.full_name).trim();
  if (u.email_address) p.email = String(u.email_address);
  if (u.verified_phone_number) p.phone = String(u.verified_phone_number);
}

// Artifact ids referenced from chat JSON: published links and tool result ids.
const RE_ART_REF = new RegExp('(?:/artifact/|artifact_id\\\\?"\\s*:\\s*\\\\?")(' + UUID_PAT + ')', 'g');

// A chat's messages as the views read them (from raw): objects only, and their lists of blocks,
// attachments and files hold objects only. The list itself comes back when it is clean already.
function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const out = [];
  for (const m of list) {
    if (!isObj(m)) { changed = true; continue; }
    const fix = {};
    for (const k of ['content', 'attachments', 'files']) if (Array.isArray(m[k]) && !m[k].every(isObj)) fix[k] = objects(m[k]);
    if (Object.keys(fix).length) changed = true;
    out.push(Object.keys(fix).length ? Object.assign({}, m, fix) : m);
  }
  return changed ? out : list;
}

function addConversation(c, source, rawText) {
  if (!c.uuid) return;
  const msgs = cleanMessages(c.chat_messages);
  const updated = parseTime(c.updated_at);
  const prev = DB.convById.get(c.uuid);
  // Same chat in two exports: keep the newer / longer copy. It moves to the end, like a new chat.
  if (prev && (updated < prev.updated || (updated === prev.updated && msgs.length <= prev.msgCount))) return;
  let firstTs = 0, lastTs = 0, contentful = 0, files = 0, outputs = 0, tools = 0, firstHuman = '', firstReply = '';
  for (const m of msgs) {
    const t = parseTime(m.created_at);
    if (t && (!firstTs || t < firstTs)) firstTs = t;
    if (t > lastTs) lastTs = t;
    const blocks = Array.isArray(m.content) ? m.content : [];
    const mfiles = objects(m.files);
    if (blocks.length || hasText(m.text) || mfiles.length || objects(m.attachments).length) contentful++;
    if (m.sender === 'human') files += mfiles.length;   // assistant files are tool screenshots
    for (const b of blocks) {
      // isOutput (TOOLS in conversation.js) is the rule the outputs box uses too.
      if (b.type === 'tool_use') { tools++; if (isOutput(b)) outputs++; }
      else if (!firstHuman && m.sender === 'human' && b.type === 'text' && hasText(b.text)) firstHuman = b.text;
      else if (!firstReply && m.sender === 'assistant' && b.type === 'text' && hasText(b.text)) firstReply = b.text;
    }
    if (!firstHuman && m.sender === 'human' && hasText(m.text)) firstHuman = m.text;
  }
  // Branch points as the thread shows them: the same rule as buildTree (conversation.js).
  let forks = 0;
  const children = childrenByParent(msgs);
  if (children) for (const kids of children.values()) if (kids.length > 1) forks++;
  const artRefs = new Set();
  if (rawText && rawText.indexOf('artifact') >= 0) {
    RE_ART_REF.lastIndex = 0;
    let m;
    while ((m = RE_ART_REF.exec(rawText))) artRefs.add(m[1]);
  }
  const name = String(c.name || '').trim();
  const conv = {
    type: 'conversation',
    id: c.uuid,
    // No name: first prompt, else Claude's first reply, else what was uploaded.
    title: name || truncate(oneLine(firstHuman || firstReply), 70) || (files ? plural(files, 'uploaded file') + ' (not in export)' : ''),
    titleIsDerived: !name,
    summary: String(c.summary || ''),
    created: parseTime(c.created_at),
    updated,
    ownerId: (c.account && c.account.uuid) || null,
    msgCount: msgs.length,
    lastTs: lastTs || updated,
    empty: contentful === 0,
    fileCount: files,
    outputCount: outputs + artRefs.size,
    toolCount: tools,
    forks,
    artRefs,
    raw: msgs === c.chat_messages || c.chat_messages == null ? c : Object.assign({}, c, { chat_messages: msgs }),
    source,
  };
  if (prev) DB.convById.delete(conv.id);
  DB.convById.set(conv.id, conv);
}

function addProject(p, source) {
  if (!p.uuid) return;
  const updated = parseTime(p.updated_at);
  const prev = DB.projectById.get(p.uuid);
  if (prev && prev.updated >= updated) return;
  const creator = isObj(p.creator) ? p.creator : {};
  const proj = {
    type: 'project',
    id: p.uuid,
    name: String(p.name || '').trim(),
    description: p.description || '',
    isPrivate: p.is_private !== false,
    isStarter: !!p.is_starter_project,
    promptTemplate: p.prompt_template || '',
    created: parseTime(p.created_at),
    updated,
    ownerId: creator.uuid || null,
    ownerHint: creator.full_name || '',
    docs: objects(p.docs).map(d => ({
      id: d.uuid || '',
      filename: String(d.filename || '(unnamed)'),
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

function addMemory(m) {
  if (!m.account_uuid) return;
  const files = objects(m.memory_files).map(f => {
    const content = String(f.content || ''), path = String(f.path || '');
    const fm = parseFrontmatter(content);
    return {
      path,
      content,
      updated: parseTime(f.updated_at),
      meta: fm.meta,
      body: fm.body,
      stem: path.split('/').pop().replace(/\.md$/i, ''),
    };
  });
  const projectMemories = Object.entries(isObj(m.project_memories) ? m.project_memories : {}).map(([projectId, text]) => ({ projectId, text: String(text || '') }));
  const prev = DB.memoryByPerson.get(m.account_uuid);
  const mem = prev || { type: 'memory', id: m.account_uuid, ownerId: m.account_uuid, conversationsMemory: '', projectMemories: [], files: [], updated: 0 };
  // Merge across exports. The summaries have no timestamp, so the copy whose memory files
  // are newest counts as the newer export: its newest file is at least mem.updated, the
  // newest file merged so far (old memories.json has no files: 0). Nothing is dropped:
  // older text only fills gaps.
  const newer = files.reduce((mx, f) => Math.max(mx, f.updated || 0), 0) >= mem.updated;
  if (m.conversations_memory && (newer || !mem.conversationsMemory)) mem.conversationsMemory = String(m.conversations_memory);
  for (const pm of projectMemories) {
    const i = mem.projectMemories.findIndex(x => x.projectId === pm.projectId);
    if (i < 0) mem.projectMemories.push(pm); else if (newer) mem.projectMemories[i] = pm;
  }
  for (const f of files) {
    const i = mem.files.findIndex(x => x.path === f.path);
    if (i < 0) mem.files.push(f); else if (f.updated > mem.files[i].updated) mem.files[i] = f;
    if (f.updated > mem.updated) mem.updated = f.updated;
  }
  mem.files.sort((a, b) => a.path.localeCompare(b.path));
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
  if (!d.uuid) return;
  const updated = parseTime(d.updated_at);
  const prev = DB.designById.get(d.uuid);
  if (prev && prev.updated >= updated) return;
  const msgs = dedupeDesignMessages(objects(d.messages));
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
  const rawTitle = String(d.title || '').trim();
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
      // comments and threads stay null until a file gives them (see importExport, step 4).
      title: '', description: '', files: new Map(), meta: null, comments: null, threads: null, pageNode: null,
    };
    DB.artifactById.set(id, a);
  }
  return a;
}

// The artifact fields that one artifact.json gives, or null when it is not an object.
function artifactMeta(j) {
  if (!isObj(j)) return null;
  const versions = objects(j.versions).map(v => ({
    id: String(v.id || ''), title: decodeEntities(String(v.title || '')), description: String(v.description || ''), created: parseTime(v.created_at), raw: v,
  }));
  const activeVersion = j.active_version || (versions[0] && versions[0].id) || '';
  const active = versions.find(v => v.id === activeVersion) || versions[0];
  const m = {
    meta: j, kind: j.kind || 'artifact', visibility: j.visibility || '', versions, activeVersion,
    ownerId: j.owner_account || null, createdByAgent: !!j.created_by_agent, sharedWith: j.shared_with || null,
    title: (active && active.title) || '', description: decodeEntities((active && active.description) || ''),
  };
  setArtifactDates(m, parseTime(j.updated_at));
  return m;
}

// Descriptions arrive HTML-escaped (e.g. "&amp;"); decode for display as text (views-art.js and
// the search use it too).
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

async function readJson(node) {
  const text = await node.text();
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

// An artifact's files that a newer export can change (a version's files never change).
const BUNDLE_FILES = new Set(['artifact.json', 'comments.json', 'artifact_comments.json', 'page.md']);

// Many small files: how to add one record of each kind (a file holds one record or a list).
const SMALL_INGEST = new Map([
  ['projects', addProject],
  ['memories', addMemory],
  ['design', addDesignChat],
  ['manifest', addManifest],
]);

// How many skipped records of one file get a warning of their own; the rest are counted.
const SKIP_WARNINGS = 5;

/* Calls add(record, text) for each record of a file that holds one record or a list of them.
 * A list is streamed, one record at a time: conversations.json, or an old-format projects.json,
 * can be bigger than the longest string Chrome allows (about 512 MB). A record that is not an
 * object, or that add() cannot read, is skipped with a warning: it never costs the rest of
 * the file. */
async function readEach(node, add, onProgress) {
  let n = 0, skipped = 0;
  const skip = why => { if (++skipped <= SKIP_WARNINGS) DB.warnings.push(`${node.path}: record ${n} was skipped: ${why}`); };
  try {
    await parseJsonArrayStream(await node.stream(), (v, text) => {
      n++;
      if (!isObj(v)) skip('it is not an object');
      else try { add(v, text); } catch (e) { skip(e.message); }
    }, onProgress);
  } finally {
    if (skipped > SKIP_WARNINGS) DB.warnings.push(`${node.path}: ${skipped - SKIP_WARNINGS} more records were skipped`);
  }
  if (!n && !node.size) throw new Error('The file is empty.');
}

// Comment threads, and the comments in them, as objects only (finalize() and the views read them).
const cleanThreads = list => objects(list).map(th => (Array.isArray(th.comments) && th.comments.every(isObj) ? th : Object.assign({}, th, { comments: objects(th.comments) })));

/* Reads the files into DB and runs finalize(). All or nothing: when it fails, DB goes back to
 * what it was, so an export that was open before stays as it was. */
async function importExport(files, ui) {
  const saved = saveDB();
  try {
    await readExport(files, ui);
  } catch (e) {
    restoreDB(saved);
    throw e;
  }
}

async function readExport(files, ui) {
  const t0 = performance.now();
  ui.set('scan', 'Reading ' + plural(files.length, 'file') + '…', 0.02, '');
  const { nodes, sources } = await nodesFromFiles(files, msg => ui.set('scan', msg, 0.05, ''));
  DB.sources.push(...sources);
  for (const s of sources) if (s.error) DB.warnings.push(s.name + ': ' + s.error);

  const groups = { users: [], conversations: [], projects: [], memories: [], design: [], manifest: [], sniff: [] };
  const artifactNodes = [];
  for (const n of nodes) {
    const c = classify(n);
    if (c.kind === 'artifact') artifactNodes.push({ n, id: c.id, rel: c.rel });
    else if (groups[c.kind]) groups[c.kind].push(n);
    else if (c.kind === 'other') DB.ignored.push(n.path);
  }
  ui.set('scan', 'Found ' + plural(nodes.length, 'file') + ' in ' + plural(sources.length, 'source'), 1, '', 'done');

  // Shape-sniff stray JSON files. Each one joins the group of its kind, after the named files,
  // and is read again there like any other file of that kind.
  const sniffed = [];
  await mapLimit(groups.sniff, 6, async (n, i) => {
    try { sniffed[i] = sniffShape(await readJson(n)); } catch (e) { sniffed[i] = null; }
  });
  groups.sniff.forEach((n, i) => (sniffed[i] ? groups[sniffed[i]].push(n) : DB.ignored.push(n.path)));

  // 1. People. Only finalize() has to come last: no add…() function reads another kind.
  for (const n of groups.users) {
    try { await readEach(n, addUser); } catch (e) { DB.warnings.push(n.path + ': ' + e.message); }
  }
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
      await readEach(n, (c, text) => addConversation(c, n.container, text), bytes => {
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
  if (convNodes.length || DB.convById.size) ui.set('conv', 'Conversations', 1, fmtNum(DB.convById.size) + ' chats', 'done');

  // 3. Projects, memories, design chats: many small files.
  const small = [...SMALL_INGEST.keys()].flatMap(kind => groups[kind].map(n => [kind, n]));
  let smallDone = 0;
  await mapLimit(small, 8, async ([kind, n]) => {
    try { await readEach(n, x => SMALL_INGEST.get(kind)(x, n.container)); }
    catch (e) { DB.warnings.push(n.path + ': ' + e.message); }
    smallDone++;
    if (smallDone % 10 === 0 || smallDone === small.length) {
      ui.set('small', 'Projects, memories, design chats', smallDone / small.length, smallDone + ' / ' + small.length + ' files');
    }
  });
  if (small.length) ui.set('small', 'Projects, memories, design chats', 1,
    `${DB.projectById.size} projects · ${DB.memoryByPerson.size} memories · ${DB.designById.size} design chats`, 'done');

  // 4. Artifacts: index files, read the small metadata files only. A version's files never
  // change, so the first copy of each path is kept. The files a newer export can change
  // (BUNDLE_FILES) form one bundle per artifact folder and container: the bundle with the
  // newest artifact.json gives all of them, and the others only fill gaps.
  const bundles = new Map();
  for (const { n, id, rel } of artifactNodes) {
    const a = artifactFor(id);
    if (!a.files.has(rel)) a.files.set(rel, n);
    if (!BUNDLE_FILES.has(rel)) continue;
    const key = n.container + '\n' + n.path.slice(0, -rel.length);
    if (!bundles.has(key)) bundles.set(key, { a, files: new Map(), meta: null, comments: null, threads: null });
    const b = bundles.get(key);
    if (!b.files.has(rel)) b.files.set(rel, n);
  }
  const reads = [...bundles.values()].flatMap(b => [...b.files].filter(([rel]) => rel !== 'page.md').map(([rel, n]) => ({ b, rel, n })));
  let metaDone = 0;
  await mapLimit(reads, 16, async ({ b, rel, n }) => {
    try {
      const v = await readJson(n);
      if (rel === 'artifact.json') b.meta = artifactMeta(v);
      else if (rel === 'comments.json') { if (Array.isArray(v)) b.comments = cleanThreads(v); }
      else if (v && Array.isArray(v.threads)) b.threads = cleanThreads(v.threads);
    } catch (e) { DB.warnings.push(n.container + ': ' + n.path + ': ' + e.message); }
    metaDone++;
    if (metaDone % 50 === 0 || metaDone === reads.length) ui.set('art', 'Artifacts', metaDone / reads.length, fmtNum(metaDone) + ' / ' + fmtNum(reads.length) + ' metadata files');
  });
  // Bundles in node order. On a tie (one export split across two zips) the later one wins.
  for (const b of bundles.values()) {
    const a = b.a;
    const wins = !!b.meta && (!a.meta || b.meta.updated >= a.updated);
    if (wins) {
      Object.assign(a, b.meta);
      for (const [rel, n] of b.files) a.files.set(rel, n);
    }
    if (b.comments && (wins || a.comments === null)) a.comments = b.comments;
    if (b.threads && (wins || a.threads === null)) a.threads = b.threads;
  }
  if (artifactNodes.length) ui.set('art', 'Artifacts', 1, fmtNum(DB.artifactById.size) + ' artifacts · ' + fmtNum(artifactNodes.length) + ' files indexed', 'done');

  finalize();
  ui.set('done', 'Ready in ' + fmtDuration(performance.now() - t0), 1, '', 'done');
  if (!hasRecords() && !DB.manifests.length) {
    // Records are never removed, so nothing was loaded before this attempt either. The throw
    // puts DB back (importExport), so the attempt leaves no sources, warnings or ignored files
    // behind. When files failed, say why: the reason may be the browser, not the files.
    const failed = DB.warnings.slice();
    throw new Error(failed.length
      ? `Nothing could be read from what you picked. ${failed[0]}${failed.length > 1 ? ` (${plural(failed.length - 1, 'more problem')})` : ''}`
      : 'No Claude export data found in what you picked. Choose the .zip files from the export, or the folder they were unpacked into.');
  }
}

function addManifest(v, source) {
  // export_url values are single-use download links. They stay in this tab's memory only,
  // are offered as "Download" links for parts that are not loaded, and are never stored,
  // logged or shown as text. Only https://claude.ai/export/… links are accepted.
  DB.manifests.push({
    createdAt: parseTime(v.created_at),
    totalFiles: v.total_files,
    files: objects(v.data_files).map(f => ({
      category: f.category, part: f.part, filename: f.filename,
      url: typeof f.export_url === 'string' && /^https:\/\/claude\.ai\/export\//.test(f.export_url) ? f.export_url : '',
    })),
    source,
  });
}
