/* The in-memory model of a Claude export: people (Person) and the DB of everything they own,
 * finalize() (links and derived data), and the small queries the views use. ingest.js fills
 * DB from the files. */
'use strict';

/* ---------- People and the DB ---------- */

const NO_OWNER = '__none__';

// Lists in an export can hold null or other junk where an object should be: read objects only.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const objects = list => (Array.isArray(list) ? list.filter(isObj) : []);
const hasText = v => typeof v === 'string' && v.trim() !== '';

// The chats that have content. Chats the export left empty are listed, but never counted as
// conversations: every count, badge and timeline goes through this one rule.
const withContent = convs => convs.filter(c => !c.empty);

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
  convCount() { return withContent(this.conversations).length; }
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

// Everything an import fills in, empty. An import writes only the id Maps; finalize() builds
// the sorted lists from them.
function emptyDB() {
  return {
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
  };
}
const DB = Object.assign(emptyDB(), {
  generation: 0,   // goes up on every finalize(), so caches of derived data know to start again
});

function personFor(id, hint) {
  id = id ? String(id) : NO_OWNER;   // an id of another type would break the name fallbacks
  let p = DB.people.get(id);
  if (!p) { p = new Person(id); DB.people.set(id, p); }
  if (hint && typeof hint === 'string' && hint.trim() && !p.hints.includes(hint.trim())) p.hints.push(hint.trim());
  return p;
}

/* ---------- Undo for a failed import ---------- */

// A copy of what an import can change: DB's maps and lists, and the people, memories and
// artifacts it changes in place (one level deep). finalize() works the rest out again.
function saveDB() {
  const copy = v => (Array.isArray(v) ? v.slice() : v instanceof Map ? new Map(v) : v instanceof Set ? new Set(v) : v);
  const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, copy(v)]));
  const records = new Map();
  for (const map of [DB.people, DB.memoryByPerson, DB.artifactById]) for (const x of map.values()) records.set(x, fields(x));
  const top = fields(DB);
  delete top.generation;   // keeps counting up, so no cache from the failed import is used
  return { top, records };
}

function restoreDB(saved) {
  for (const [x, o] of saved.records) {
    for (const k of Object.keys(x)) if (!(k in o)) delete x[k];
    Object.assign(x, o);
  }
  Object.assign(DB, saved.top);
  finalize();
}

/* ---------- Artifact versions ---------- */

// Created is the oldest version. Updated is the newest version, or `updated` (artifact.json's
// updated_at, which can be older than the newest version) when that is later.
function setArtifactDates(a, updated) {
  a.updated = Math.max(updated, ...a.versions.map(v => v.created || 0));
  a.created = a.versions.reduce((min, v) => (v.created && (!min || v.created < min) ? v.created : min), 0) || updated;
}

// A version file's place: a single versions/<vid>.html, or a folder versions/<vid>/<sub>
// (entry index.html) with a versions/<vid>.files.json manifest. Null for any other path.
function parseVersionRel(rel) {
  let m = /^versions\/([^/]+)\.files\.json$/.exec(rel);
  if (m) return { vid: m[1], part: 'manifest' };
  m = /^versions\/([^/]+)\/(.+)$/.exec(rel);
  if (m) return { vid: m[1], part: 'folder', sub: m[2] };
  m = /^versions\/([^/]+)\.html?$/i.exec(rel);
  if (m) return { vid: m[1], part: 'single' };
  return null;
}

// Group an artifact's files per version (see parseVersionRel).
function indexArtifactVersions(a) {
  a.vfiles = new Map();
  for (const [rel, node] of a.files) {
    const v = parseVersionRel(rel);
    if (!v) continue;
    if (!a.vfiles.has(v.vid)) a.vfiles.set(v.vid, { single: null, manifest: null, folder: new Map() });
    const s = a.vfiles.get(v.vid);
    if (v.part === 'folder') s.folder.set(v.sub, node); else s[v.part] = node;
  }
}

// Files of a typed app's runtime (Slides, Design) and its instructions for Claude, not user content.
function isPlumbing(p) { return /^(SKILL\.md$|artifact-type\/)/.test(p); }

// What a version contains and how to show it.
function versionInfo(a, vid) {
  const s = a.vfiles.get(vid);
  if (!s) return { type: a.kind === 'page' ? 'Doc' : 'No files', slot: null };
  if (s.single) return { type: 'HTML', slot: s };
  const f = s.folder;
  if (f.has('project/deck.json') || Array.from(f.keys()).some(k => k.startsWith('project/slides/'))) return { type: 'Slides', slot: s };
  if (f.has('project/canvas.json')) return { type: 'Design', slot: s };
  if (Array.from(f.keys()).some(isPlumbing)) return { type: 'App (data not exported)', slot: s, typedEmpty: true };
  if (f.has('index.html')) return { type: 'HTML + files', slot: s };
  return { type: f.size ? 'Files' : 'No files', slot: s };
}

/* ---------- What was loaded ---------- */

// Any record or person loaded? A manifest alone does not count.
function hasRecords() {
  return !!(DB.conversations.length || DB.projects.length || DB.artifacts.length ||
    DB.designChats.length || DB.memories.length || DB.people.size);
}

// The newest manifest that was loaded, or null.
function latestManifest() {
  return DB.manifests.slice().sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

// Manifest parts whose data is not loaded. A part counts as loaded if its zip opened, or (for
// unzipped folders) if its kind of data is present. A zip that failed to open does not count.
function missingFiles(m) {
  const okZips = new Set(DB.sources.filter(s => s.kind === 'zip' && !s.error).map(s => s.name));
  const framesZips = DB.sources.some(s => s.kind === 'zip' && !s.error && /^frames-/i.test(s.name));
  const has = {
    conversations: DB.conversations.length > 0,
    design_chats: DB.designChats.length > 0,
    memories: DB.memories.length > 0,
    projects: DB.projects.length > 0,
    light_metadata: Array.from(DB.people.values()).some(p => p.known),
    frames: DB.artifacts.length > 0 && !framesZips,
  };
  return m.files.filter(f => !okZips.has(f.filename) && !has[f.category]);
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
    indexArtifactVersions(a);
    if (!a.meta) {
      // Files without artifact.json (partial export): still show them, dated by their version ids.
      a.versions = Array.from(a.vfiles.keys()).sort().reverse().map(id => ({ id, title: '', description: '', created: parseTime(Number(id.split('-')[0]) || 0), raw: {} }));
      a.activeVersion = a.versions[0] ? a.versions[0].id : '';
      setArtifactDates(a, 0);
      if (a.files.has('page.md')) a.kind = 'page';
    }
    a.pageNode = a.files.get('page.md') || null;
    a.contentType = a.kind === 'page' ? 'Doc' : versionInfo(a, a.activeVersion).type;
    a.owner = personFor(a.ownerId);
    a.owner.artifacts.push(a);
    a.owner.touch(a.updated);
    // Page comments carry real author uuids.
    for (const th of objects(a.comments)) {
      for (const cm of objects(th.comments)) {
        const au = cm.author;
        const who = au && au.uuid ? personFor(au.uuid, au.full_name) : null;
        if (who) { who.comments.push({ artifact: a, thread: th, comment: cm, byAgent: !!cm.posted_by_agent, source: 'page' }); who.touch(parseTime(cm.created_at)); }
      }
    }
    // Threads with the comments that do not repeat a doc comment; threads with none are left out.
    a.threadView = [];
    for (const th of objects(a.threads)) {
      const comments = [];
      for (const cm of objects(th.comments)) if (!isDuplicateThreadComment(a, cm)) comments.push(cm);
      if (comments.length) a.threadView.push({ th, comments });
    }
    a.commentCount = objects(a.comments).reduce((n, t) => n + objects(t.comments).length, 0) +
      a.threadView.reduce((n, x) => n + x.comments.length, 0);
    // Thread comments are anonymous; only the owner's own (non-Claude) comments are attributable.
    for (const { th, comments } of a.threadView) {
      for (const cm of comments) {
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
  // Memory about each project, newest memory first: its project_memories summary, then its
  // memory files under /projects/<id>/.
  for (const pr of DB.projects) pr.memoryRefs = [];
  for (const mem of DB.memories) {
    for (const pm of mem.projectMemories) {
      const pr = DB.projectById.get(pm.projectId);
      if (pr) pr.memoryRefs.push({ mem, kind: 'summary', text: pm.text });
    }
    for (const f of mem.files) {
      const m = /^\/projects\/([^/]+)\//.exec(f.path);
      const pr = m && DB.projectById.get(m[1]);
      if (pr) pr.memoryRefs.push({ mem, kind: 'file', file: f });
    }
  }
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

// q is lower case and trimmed: part of the name or email, or the start of the id.
function personMatches(p, q) {
  return p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || p.id.startsWith(q);
}

function peopleMatching(q) {
  q = (q || '').toLowerCase().trim();
  const all = peopleSorted().filter(p => !p.system);
  if (!q) return all;
  return all.filter(p => personMatches(p, q));
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

// An artifact's title, or a fallback by kind. Worked out when shown, not stored in a.title:
// that field belongs to the import, and page.md can come in a later load.
function artifactTitle(a) {
  return a.title || (a.pageNode ? 'Untitled page' : 'Untitled artifact');
}
