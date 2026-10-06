/* Files made from the model for download: a conversation as Markdown, and one person's zip. */
'use strict';

/* ---------- Markdown ---------- */

// path: the messages to write, in order (currentPath() or branchPath()).
function convToMarkdown(conv, path) {
  const p = conv.owner;
  const lines = [];
  lines.push('# ' + convTitle(conv));
  lines.push('');
  lines.push(`- Person: ${p ? p.name : 'unknown'}${p && p.email ? ' <' + p.email + '>' : ''}`);
  lines.push(`- Started: ${fmtDateTime(conv.created)} · Last message: ${fmtDateTime(conv.lastTs)}`);
  lines.push(`- Messages: ${conv.msgCount} · Link: https://claude.ai/chat/${conv.id}`);
  lines.push('');
  if (conv.summary) { lines.push('## Summary', '', conv.summary.trim(), ''); }
  lines.push('---', '');
  for (const m of path) lines.push(messageToMarkdown(conv, m), '');
  const off = conv.msgCount - path.length;
  if (off > 0) lines.push('---', '', `_${plural(off, 'message')} on other branches (edited or regenerated) are not shown here; they are in the .json file._`);
  return lines.join('\n');
}

const MD_ATTACH_CAP = 100000;

function fence(text, lang) {
  // Use a fence longer than any backtick run inside the text.
  const longest = (String(text).match(/`+/g) || []).reduce((a, s) => Math.max(a, s.length), 0);
  const f = '`'.repeat(Math.max(3, longest + 1));
  return f + (lang || '') + '\n' + text + '\n' + f;
}

function messageToMarkdown(conv, m) {
  const human = m.sender === 'human';
  const who = human ? (conv.owner ? conv.owner.name : 'User') : 'Claude';
  const out = [`### ${human ? '👤' : '🤖'} ${who} — ${fmtDateTime(m.created_at)}`, ''];
  if (!m.content.length && m.text) out.push(m.text);
  for (const b of m.content) {
    if (b.type === 'text' && hasText(b.text)) out.push(b.text, '');
    else if (b.type === 'tool_use') {
      const i = b.input || {};
      const s = toolInputSummary(b.name, i);
      out.push(`> ⚙ ${b.name}${s ? ': ' + oneLine(s).slice(0, 200) : ''}`, '');
      const t = TOOLS.get(b.name);
      if (t && t.markdown) out.push(...t.markdown(i));
    }
  }
  for (const a of m.attachments) {
    const text = a.extracted_content || '';
    out.push(`> 📎 ${a.file_name || 'Pasted text'} (${fmtBytes(a.file_size || text.length)})`, '');
    if (text) {
      out.push(fence(text.length > MD_ATTACH_CAP ? text.slice(0, MD_ATTACH_CAP) : text), '');
      if (text.length > MD_ATTACH_CAP) out.push(`_Cut at ${fmtBytes(MD_ATTACH_CAP)}; the full text is in the .json file._`, '');
    }
  }
  for (const f of filesWithoutText(m)) out.push(`> 📄 ${f.file_name || 'file'} (not in export)`);
  return out.join('\n');
}

/* ---------- Per-person zip ---------- */

function datePrefix(t) {
  if (!t) return '';
  const d = toDate(t);
  if (!d) return '';
  return d.toISOString().slice(0, 10) + ' ';
}

async function buildPersonZip(p, opts, progress, isCancelled) {
  const z = new ZipWriter();
  const short = id => String(id || '').slice(0, 8);
  // "<date> <title> (<id8>)": one path part (a "/" in the title is not a folder), with the
  // title cut first, so the name stays within safeFilename's 90 characters and keeps the id.
  // ZipWriter cleans every part of every path.
  const nameOf = (t, title, id) => datePrefix(t) + safeFilename(title, 'Untitled').slice(0, 68).trim() + ' (' + short(id) + ')';
  z.add('README.txt', [
    `Claude data for ${p.name}${p.email ? ' <' + p.email + '>' : ''}`,
    `Account id: ${p.id}`,
    `Made with Claude Export Reader on ${new Date().toISOString()}`,
    '',
    'conversations/  one .md (readable) and one .json (original) per chat',
    'artifacts/      artifact metadata, comments and version files',
    'projects/       project settings and knowledge files',
    'design_chats/   Claude Design chats (original JSON)',
    'memory/         what Claude remembers about this person',
    'comments.json   comments this person made on artifacts',
  ].join('\n'));
  z.add('person.json', JSON.stringify({
    id: p.id, name: p.name, email: p.email, phone: p.phone || null, inUsersJson: p.known,
    counts: { conversations: p.convCount, conversationsWithoutContent: p.emptyConvCount, messages: p.messageCount, artifacts: p.artifacts.length, projects: p.projects.length, designChats: p.designChats.length, memoryFiles: p.memory ? p.memory.files.length : 0, comments: p.comments.length },
    firstActivity: p.first ? new Date(p.first).toISOString() : null, lastActivity: p.last ? new Date(p.last).toISOString() : null,
  }, null, 2));

  let i = 0;
  for (const c of p.conversations) {
    if (isCancelled()) return null;
    const base = 'conversations/' + nameOf(c.created, convTitle(c), c.id);
    // The newest branch, whatever branches were opened in this tab.
    z.add(base + '.md', convToMarkdown(c, branchPath(c)));
    z.add(base + '.json', JSON.stringify(c.raw, null, 2));
    if (++i % 20 === 0) { progress(`Conversations ${i} / ${p.conversations.length}`); await new Promise(r => setTimeout(r, 0)); }
  }
  for (const x of p.projects) {
    const base = 'projects/' + nameOf(0, projectTitle(x), x.id) + '/';
    z.add(base + 'project.json', JSON.stringify(x.raw, null, 2));
    for (const d of x.docs) z.add(base + 'docs/' + d.filename, d.content);
  }
  for (const d of p.designChats) {
    z.add('design_chats/' + nameOf(d.created, (d.project.name ? d.project.name + ' - ' : '') + designTitle(d), d.id) + '.json', JSON.stringify(d.raw, null, 2));
  }
  if (p.memory) {
    const m = p.memory;
    if (m.conversationsMemory) z.add('memory/chat-memory.md', m.conversationsMemory);
    for (const pm of m.projectMemories) z.add('memory/project-memories/' + safeFilename(projectName(pm.projectId) || pm.projectId, 'project') + '.md', pm.text);
    for (const f of m.files) z.add('memory/files/' + f.path, f.content);
  }
  if (p.comments.length) {
    z.add('comments.json', JSON.stringify(p.comments.map(c => ({ artifactId: c.artifact.id, artifactTitle: artifactTitle(c.artifact), tab: c.thread && c.thread.tab, quoted: c.thread && c.thread.quoted_text, postedByClaude: c.byAgent, comment: c.comment })), null, 2));
  }
  i = 0;
  for (const a of p.artifacts) {
    if (isCancelled()) return null;
    const base = 'artifacts/' + nameOf(0, artifactTitle(a), a.id) + '/';
    for (const [rel, node] of a.files) {
      const v = parseVersionRel(rel);
      if (v && v.part === 'folder' && isPlumbing(v.sub)) continue;   // the app's runtime, like the Files tab
      // Only the current version's files, unless every version was asked for.
      if (!opts.allVersions && rel.startsWith('versions/') && !(v && v.vid === a.activeVersion)) continue;
      z.add(base + rel, await node.bytes());
    }
    progress(`Artifacts ${++i} / ${p.artifacts.length}`);
  }
  progress('Packing…');
  return z.blob();
}
