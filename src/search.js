/* Search: the searchable text of each record, an index of it, and the engine (runSearch).
 * No DOM: the search page in views-misc.js draws the results. */
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

function msgProse(m) {
  const blocks = Array.isArray(m.content) ? m.content : [];
  let s = '';
  for (const b of blocks) if (b && b.type === 'text' && b.text) s += b.text + '\n';
  if (!blocks.length && m.text) s += m.text + '\n';
  for (const a of (m.attachments || [])) if (a.file_name) s += a.file_name + '\n';
  for (const f of (m.files || [])) if (f.file_name) s += f.file_name + '\n';
  return s;
}

function msgDeep(m) {
  let s = '';
  for (const b of (Array.isArray(m.content) ? m.content : [])) {
    if (!b) continue;
    if (b.type === 'thinking') { s += (b.thinking || '') + '\n'; for (const x of (b.summaries || [])) s += (x && x.summary || '') + '\n'; }
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
  for (const a of (m.attachments || [])) s += (a.extracted_content || '') + '\n';
  return s;
}

function countHits(hay, terms) {
  let n = 0;
  for (const t of terms) {
    let i = hay.indexOf(t);
    if (i < 0) return -1;
    let k = 0;
    while (i >= 0 && k < 50) { k++; i = hay.indexOf(t, i + t.length); }
    n += k;
  }
  return n;
}

// Text of a design chat: prompts, replies and comments on the design.
function designSearchText(d) {
  const commentText = atts => (Array.isArray(atts) ? atts : []).filter(a => a && a.type === 'comment').map(a => String(a.content || '')).join('\n');
  return [d.title, d.project.name, ...d.messages.map(m => {
    const c = m.content || {};
    const parts = [typeof c.content === 'string' ? c.content : '', commentText(c.attachments)];
    for (const b of (Array.isArray(c.contentBlocks) ? c.contentBlocks : [])) {
      if (!b) continue;
      if (b.type === 'text') parts.push(b.text || '');
      // Messages typed while Claude was working exist only inside these blocks.
      else if (b.type === 'user_interjection' && b.message) parts.push(String(b.message.content || ''), commentText(b.message.attachments));
    }
    return parts.join('\n');
  })].join('\n');
}

/* The search index: text per record, made the first time a search needs it, so later searches
 * are fast. Adding files to an open export changes some records in place (merged memory,
 * artifact metadata, owner names), so the index is dropped whenever finalize() runs again. */
let INDEX = new WeakMap(), INDEX_GEN = -1;

function searchEntry(x) {
  if (INDEX_GEN !== DB.generation) { INDEX = new WeakMap(); INDEX_GEN = DB.generation; }
  let e = INDEX.get(x);
  if (!e) INDEX.set(x, e = {});
  return e;
}

// The items whose text holds every term, as hits { item }. keepText adds the text itself
// (hit.text), for the snippet under the result.
function findByText(items, terms, textOf, keepText) {
  const hits = [];
  for (const item of items) {
    const e = searchEntry(item);
    if (!e.lc) {
      const text = textOf(item);
      e.lc = text.toLowerCase();
      if (keepText) e.text = text;
    }
    if (terms.every(t => e.lc.includes(t))) hits.push(keepText ? { item, text: e.text } : { item });
  }
  return hits;
}

/* Every hit is { item, … }. scope (scopeOf()) holds the records to search: one person's or
 * everyone's. People are always searched in full. Returns null when `signal` aborts (the page
 * changed) before the search ends. */
async function runSearch(q, { deep, scope, signal, onProgress }) {
  const terms = searchTerms(q);
  const res = { conversations: [], artifacts: [], projects: [], design: [], memory: [], people: [], terms };
  if (!terms.length) return res;
  const has = s => { const l = String(s || '').toLowerCase(); return terms.every(t => l.includes(t)); };

  // People
  for (const p of DB.people.values()) if (!p.system && has(p.name + ' ' + p.email + ' ' + p.id)) res.people.push({ item: p });

  // Conversations (chunked to keep the tab responsive)
  const convs = scope.conversations;
  for (let ci = 0; ci < convs.length; ci++) {
    const c = convs[ci];
    const e = searchEntry(c);
    if (!e.lcMsgs) e.lcMsgs = (c.raw.chat_messages || []).map(m => msgProse(m).toLowerCase());
    if (deep && !e.lcDeep) e.lcDeep = (c.raw.chat_messages || []).map(m => msgDeep(m).toLowerCase());
    const head = (c.title + '\n' + c.summary).toLowerCase();
    const msgs = e.lcMsgs;
    const joined = head + '\n' + msgs.join('\n') + (deep ? '\n' + e.lcDeep.join('\n') : '');
    const score = countHits(joined, terms);
    if (score >= 0) {
      let hitIdx = msgs.findIndex(x => x.includes(terms[0]));
      let hitDeep = false;
      if (hitIdx < 0 && deep) { hitIdx = e.lcDeep.findIndex(x => x.includes(terms[0])); hitDeep = hitIdx >= 0; }
      res.conversations.push({ item: c, score: score + (countHits(head, terms) >= 0 ? 20 : 0), hitIdx, hitDeep });
    }
    if (ci % 40 === 39) {
      onProgress && onProgress(`Searching conversations… ${ci + 1} / ${convs.length}`);
      await new Promise(r => setTimeout(r, 0));
      if (signal.aborted) return null;
    }
  }
  res.conversations.sort((a, b) => b.score - a.score || b.item.lastTs - a.item.lastTs);

  res.projects = findByText(scope.projects, terms, x => [x.name, x.description, x.promptTemplate, ...x.docs.map(d => d.filename + '\n' + d.content)].join('\n'));
  res.design = findByText(scope.designChats, terms, designSearchText, true);
  res.memory = findByText(scope.memories, terms, mem => [mem.conversationsMemory, ...mem.projectMemories.map(x => x.text), ...mem.files.map(f => f.content)].join('\n'), true);

  // Artifacts: titles, descriptions, docs text, comments
  onProgress && onProgress('Searching artifacts…');
  const arts = scope.artifacts;
  const needPages = arts.filter(a => a.pageNode && searchEntry(a).pageText == null);
  await mapLimit(needPages, 8, async a => { const e = searchEntry(a); try { e.pageText = await a.pageNode.text(); } catch (err) { e.pageText = ''; } });
  if (signal.aborted) return null;
  if (deep) {
    // Read each artifact's current version once (text only) so its content is searchable too.
    const todo = arts.filter(a => searchEntry(a).contentLc == null);
    let done = 0;
    await mapLimit(todo, 6, async a => {
      const e = searchEntry(a);
      try { e.contentText = await artifactPlainText(a); } catch (err) { e.contentText = ''; }
      e.contentLc = e.contentText.toLowerCase();
      if (++done % 25 === 0) onProgress && onProgress(`Reading artifact content… ${done} / ${todo.length}`);
    });
    if (signal.aborted) return null;
  }
  for (const a of arts) {
    const e = searchEntry(a);
    if (!e.lc) {
      e.lc = [a.title, a.description, a.contentType, ...a.versions.map(v => v.title + ' ' + v.description), e.pageText || '',
        ...(a.comments || []).flatMap(t => [t.quoted_text, ...(t.comments || []).map(c => c.body)]),
        ...(a.threads || []).flatMap(t => (t.comments || []).map(c => c.text))].join('\n').toLowerCase();
    }
    if (terms.every(t => e.lc.includes(t))) res.artifacts.push({ item: a, text: [a.title, a.description, e.pageText].join(' — ') });
    else if (deep && e.contentLc && terms.every(t => e.lc.includes(t) || e.contentLc.includes(t))) res.artifacts.push({ item: a, text: e.contentText, inContent: true });
  }
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
    out += ' ' + html
      .replace(/data:[a-z0-9.+\/-]+;base64,[A-Za-z0-9+\/=]+/gi, ' ')   // embedded images and fonts
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ');
  }
  return out.slice(0, ARTIFACT_TEXT_CAP);
}
