/* Search: the searchable text of each record, an index of it, and the engine (runSearch).
 * No DOM: the search page in views-misc.js draws the results, each with the searchResult()
 * of its kind (KINDS). */
'use strict';

function searchTerms(q) {
  const terms = [];
  String(q || '').replace(/"([^"]+)"|(\S+)/g, (all, phrase, word) => {
    // An unmatched quote is not part of the word.
    const t = (phrase != null ? phrase : String(word || '').replace(/"/g, '')).trim().toLowerCase();
    if (t) terms.push(t);
    return all;
  });
  return terms;
}

// A message's lists of blocks, attachments and files are lists of objects (cleanMessages() in
// ingest.js).
function msgProse(m) {
  let s = '';
  for (const b of m.content) if (b.type === 'text' && b.text) s += b.text + '\n';
  if (!m.content.length && m.text) s += m.text + '\n';
  for (const a of m.attachments) if (a.file_name) s += a.file_name + '\n';
  for (const f of m.files) if (f.file_name) s += f.file_name + '\n';
  return s;
}

function msgDeep(m) {
  let s = '';
  for (const b of m.content) {
    if (b.type === 'thinking') { s += (b.thinking || '') + '\n'; for (const x of objects(b.summaries)) s += (x.summary || '') + '\n'; }
    else if (b.type === 'tool_use') { try { s += JSON.stringify(b.input || {}) + '\n'; } catch (e) { /* ignore */ } }
    else if (b.type === 'tool_result') {
      for (const it of (Array.isArray(b.content) ? b.content : [])) if (it) s += (it.text || '') + ' ' + (it.title || '') + '\n';
      // Oversized results keep their real payload only in structured_content.
      const sc = b.structured_content;
      if (sc && typeof sc === 'object' && Object.keys(sc).length) {
        try { s += JSON.stringify(sc).slice(0, 2000000) + '\n'; } catch (e) { /* ignore */ }
      }
    }
  }
  for (const a of m.attachments) s += (a.extracted_content || '') + '\n';
  return s;
}

// How often the terms are in the texts together (at most 50 times each), or -1 when a term is
// in none of them.
function countHits(texts, terms) {
  let n = 0;
  for (const t of terms) {
    let k = 0;
    for (const text of texts) {
      for (let i = text.indexOf(t); i >= 0 && k < 50; i = text.indexOf(t, i + t.length)) k++;
    }
    if (!k) return -1;
    n += k;
  }
  return n;
}

/* Parts of a record's text, in lower case, joined with "\n" into one string (text), and where
 * each part starts in it (starts). One string per record: a search runs over it without
 * building anything, and finds the part of a match with partOf(). */
function joinLower(parts) {
  const lower = parts.map(p => p.toLowerCase());
  const starts = new Uint32Array(lower.length);
  for (let i = 1; i < lower.length; i++) starts[i] = starts[i - 1] + lower[i - 1].length + 1;
  return { text: lower.join('\n'), starts };
}

// The first part, from part `from` on, that holds t; -1 when none does.
function partOf(joined, t, from) {
  if (from >= joined.starts.length) return -1;
  const at = joined.text.indexOf(t, joined.starts[from]);
  if (at < 0) return -1;
  let lo = from, hi = joined.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (joined.starts[mid] <= at) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// The part of a long text that a result's snippet can show (snippetHtml() cuts 90 characters
// before the first match and 180 after it), so a hit does not keep a whole file's text.
function snippetWindow(text, terms) {
  const re = termsRegex(terms);
  const m = re && re.exec(text);
  const at = m ? m.index : 0;
  return text.slice(Math.max(0, at - 200), at + 400);
}

// Text of a person's memory: the chat summary, project memories and memory files.
function memorySearchText(mem) {
  return [mem.conversationsMemory, ...mem.projectMemories.map(x => x.text), ...mem.files.map(f => f.content)].join('\n');
}

// Text of an artifact, without its files: title, descriptions, doc page and comments. Comment
// lists are null until a file gives them; a thread's comments are a list (cleanThreads()).
function artifactSearchText(a, page) {
  return [artifactTitle(a), a.description, a.contentType, ...a.versions.map(v => v.title + ' ' + v.description), page,
    ...(a.comments || []).flatMap(t => [t.quoted_text, ...t.comments.map(c => c.body)]),
    ...(a.threads || []).flatMap(t => t.comments.map(c => c.text))].join('\n');
}

// Text of a design chat: prompts, replies and comments on the design.
function designSearchText(d) {
  const commentText = atts => (Array.isArray(atts) ? atts : []).filter(a => a && a.type === 'comment').map(a => String(a.content || '')).join('\n');
  return [designTitle(d), d.project.name, ...d.messages.map(m => {
    const c = m.content || {};
    const parts = [typeof c.content === 'string' ? c.content : '', commentText(c.attachments)];
    for (const b of (c.contentBlocks || [])) {
      if (b.type === 'text') parts.push(b.text || '');
      // Messages typed while Claude was working exist only inside these blocks.
      else if (b.type === 'user_interjection' && b.message) parts.push(String(b.message.content || ''), commentText(b.message.attachments));
    }
    return parts.join('\n');
  })].join('\n');
}

/* The search index: the lower-case text of each record, made the first time a search needs
 * it, so later searches are fast. It keeps no original text: a result cuts its snippet from
 * the record when it is drawn. Adding files to an open export changes some records in place
 * (merged memory, artifact metadata, owner names), so the index starts again whenever
 * finalize() runs. */
const searchIndex = genCache(() => new WeakMap());

function searchEntry(x) {
  const index = searchIndex();
  let e = index.get(x);
  if (!e) index.set(x, e = {});
  return e;
}

// The items whose text holds every term, as hits { item }.
function findByText(items, terms, textOf) {
  const hits = [];
  for (const item of items) {
    const e = searchEntry(item);
    if (e.lc == null) e.lc = textOf(item).toLowerCase();
    if (terms.every(t => e.lc.includes(t))) hits.push({ item });
  }
  return hits;
}

/* Every hit is { item, … }. scope (scopeOf()) holds the records to search: one person's or
 * everyone's. People are always searched in full. shown: how many hits of a kind the page
 * draws; the artifact hits among them get their snippet text (hit.text). Returns null when
 * `signal` aborts (the page changed) before the search ends. */
async function runSearch(q, { deep, scope, signal, onProgress, shown = 200 }) {
  const terms = searchTerms(q);
  // One list of hits per kind of record (KINDS in views.js, by key), plus people. Every kind
  // gets a list, even one this engine does not search yet, so the search page can draw it.
  const res = { terms, people: [] };
  for (const k of KINDS) res[k.key] = [];
  if (!terms.length) return res;
  const has = s => { const l = String(s || '').toLowerCase(); return terms.every(t => l.includes(t)); };

  // People
  for (const p of realPeople()) if (has(p.name + ' ' + p.email + ' ' + p.id)) res.people.push({ item: p });

  // Conversations (chunked to keep the tab responsive). Part 0 of e.prose is the title and
  // summary, part i + 1 is message i; part i of e.deep is message i.
  const convs = scope.conversations;
  for (let ci = 0; ci < convs.length; ci++) {
    const c = convs[ci];
    const e = searchEntry(c);
    const msgs = c.raw.chat_messages;
    if (!e.prose) e.prose = joinLower([convTitle(c) + '\n' + c.summary, ...msgs.map(msgProse)]);
    if (deep && !e.deep) e.deep = joinLower(msgs.map(msgDeep));
    const score = countHits(deep ? [e.prose.text, e.deep.text] : [e.prose.text], terms);
    if (score >= 0) {
      const inHead = terms.every(t => partOf(e.prose, t, 0) === 0);
      let hitIdx = partOf(e.prose, terms[0], 1);
      if (hitIdx > 0) hitIdx--;
      let hitDeep = false;
      if (hitIdx < 0 && deep) { hitIdx = partOf(e.deep, terms[0], 0); hitDeep = hitIdx >= 0; }
      res.conversations.push({ item: c, score: score + (inHead ? 20 : 0), hitIdx, hitDeep });
    }
    if (ci % 40 === 39) {
      onProgress && onProgress(`Searching conversations… ${ci + 1} / ${convs.length}`);
      await new Promise(r => setTimeout(r, 0));
      if (signal.aborted) return null;
    }
  }
  res.conversations.sort((a, b) => b.score - a.score || b.item.lastTs - a.item.lastTs);

  res.projects = findByText(scope.projects, terms, x => [x.name, x.description, x.promptTemplate, ...x.docs.map(d => d.filename + '\n' + d.content)].join('\n'));
  res.design = findByText(scope.designChats, terms, designSearchText);
  res.memory = findByText(scope.memories, terms, memorySearchText);

  // Artifacts: titles, descriptions, docs text, comments. The doc page is read once.
  onProgress && onProgress('Searching artifacts…');
  const arts = scope.artifacts;
  const readText = async node => { try { return await node.text(); } catch (err) { return ''; } };
  await mapLimit(arts.filter(a => searchEntry(a).lc == null), 8, async a => {
    searchEntry(a).lc = artifactSearchText(a, a.pageNode ? await readText(a.pageNode) : '').toLowerCase();
  });
  if (signal.aborted) return null;
  if (deep) {
    // Read each artifact's current version once (text only) so its content is searchable too.
    const todo = arts.filter(a => searchEntry(a).content == null);
    let done = 0;
    await mapLimit(todo, 6, async a => {
      let text = '';
      try { text = await artifactPlainText(a); } catch (err) { /* unreadable: no content */ }
      searchEntry(a).content = text.toLowerCase();
      if (++done % 25 === 0) onProgress && onProgress(`Reading artifact content… ${done} / ${todo.length}`);
    });
    if (signal.aborted) return null;
  }
  for (const a of arts) {
    const e = searchEntry(a);
    if (terms.every(t => e.lc.includes(t))) res.artifacts.push({ item: a });
    else if (deep && e.content && terms.every(t => e.lc.includes(t) || e.content.includes(t))) res.artifacts.push({ item: a, inContent: true });
  }
  // The text of the hits the page shows is read again, because the index keeps lower case only.
  await mapLimit(res.artifacts.slice(0, shown), 6, async hit => {
    const a = hit.item;
    let text = '';
    try {
      text = hit.inContent ? await artifactPlainText(a) : [artifactTitle(a), a.description, a.pageNode ? await readText(a.pageNode) : ''].join(' — ');
    } catch (err) { /* unreadable: no snippet */ }
    hit.text = snippetWindow(text, terms);
  });
  if (signal.aborted) return null;
  return res;
}

const ARTIFACT_TEXT_CAP = 2 * 1024 * 1024;

// Visible text (plus inline script data) of an artifact's current version, without markup.
async function artifactPlainText(a) {
  const info = versionInfo(a, a.activeVersion);
  const s = info.slot;
  if (!s) return '';
  const nodes = [];
  if (s.single) nodes.push(s.single);
  else {
    for (const [p, node] of s.folder) {
      if (p === 'index.html' && !info.typedEmpty) nodes.push(node);
      else if (/^project\/(slides\/[^/]+\.html|[^/]+\.dc\.html|deck\.json|canvas\.json)$/.test(p)) nodes.push(node);
    }
  }
  let out = '';
  for (const node of nodes) {
    if (out.length > ARTIFACT_TEXT_CAP) break;
    const html = await node.text();
    const text = html
      .replace(/data:[a-z0-9.+\/-]+;base64,[A-Za-z0-9+\/=]+/gi, ' ')   // embedded images and fonts
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    out += ' ' + decodeEntities(text).replace(/\s+/g, ' ');
  }
  return out.slice(0, ARTIFACT_TEXT_CAP);
}
