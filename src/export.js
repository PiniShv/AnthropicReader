/* Files made from the model for download: a conversation as Markdown, and one person's zip. */
'use strict';

/* ---------- Markdown ---------- */

function convToMarkdown(conv) {
  const p = conv.owner;
  const lines = [];
  lines.push('# ' + (conv.title || 'Untitled conversation'));
  lines.push('');
  lines.push(`- Person: ${p ? p.name : 'unknown'}${p && p.email ? ' <' + p.email + '>' : ''}`);
  lines.push(`- Started: ${fmtDateTime(conv.created)} · Last message: ${fmtDateTime(conv.lastTs)}`);
  lines.push(`- Messages: ${conv.msgCount} · Link: https://claude.ai/chat/${conv.id}`);
  lines.push('');
  if (conv.summary) { lines.push('## Summary', '', conv.summary.trim(), ''); }
  lines.push('---', '');
  const path = currentPath(conv);
  for (const m of path) lines.push(messageToMarkdown(conv, m), '');
  const off = conv.msgCount - path.length;
  if (off > 0) lines.push('---', '', `_${off} message${off === 1 ? '' : 's'} on other branches (edited or regenerated) are not shown here; they are in the .json file._`);
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
  const blocks = Array.isArray(m.content) ? m.content : [];
  if (!blocks.length && m.text) out.push(m.text);
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'text' && b.text && b.text.trim()) out.push(b.text, '');
    else if (b.type === 'tool_use') {
      const i = b.input || {};
      const s = toolInputSummary(b.name, i);
      out.push(`> ⚙ ${b.name}${s ? ': ' + oneLine(s).slice(0, 200) : ''}`, '');
      if (b.name === 'create_file' && i.file_text != null) out.push(fence(i.file_text, fileExt(i.path)), '');
      if (b.name === 'artifacts' && i.content) out.push(`**Artifact: ${i.title || ''}**`, '', i.content, '');
      if (b.name === 'message_compose_v1') {
        for (const v of composeVariants(i)) {
          out.push(`**Draft${v.label ? ' — ' + v.label : ''}${i.summary_title ? ': ' + i.summary_title : ''}**`, '');
          if (v.subject) out.push('Subject: ' + v.subject, '');
          out.push(String(v.body || ''), '');
        }
      }
      if (b.name === 'ask_user_input_v0' && Array.isArray(i.questions)) {
        for (const q of i.questions) out.push(`- **${q.question || ''}** ${(Array.isArray(q.options) ? q.options : []).map(o => '`' + (typeof o === 'string' ? o : JSON.stringify(o)) + '`').join(' · ')}`);
        out.push('');
      }
      if (b.name === 'visualize:show_widget' && i.title) out.push(`_Interactive widget: ${i.title}_`, '');
    }
  }
  for (const a of (m.attachments || [])) {
    const text = a.extracted_content || '';
    out.push(`> 📎 ${a.file_name || 'Pasted text'} (${fmtBytes(a.file_size || text.length)})`, '');
    if (text) {
      out.push(fence(text.length > MD_ATTACH_CAP ? text.slice(0, MD_ATTACH_CAP) : text), '');
      if (text.length > MD_ATTACH_CAP) out.push(`_Cut at ${fmtBytes(MD_ATTACH_CAP)}; the full text is in the .json file._`, '');
    }
  }
  for (const f of (m.files || [])) if (!(m.attachments || []).some(a => a.file_name === f.file_name)) out.push(`> 📄 ${f.file_name || 'file'} (not in export)`);
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
  // "<date> <title> (<id8>)" with the title cut first, so the id is never lost.
  const nameOf = (t, title, id) => datePrefix(t) + safeFilename(title, 'Untitled').slice(0, 70).trim() + ' (' + short(id) + ')';
  // Keep in-zip paths inside their folder: "." and ".." segments become "_".
  const cleanPath = p => String(p).split('/').filter(Boolean).map(x => (x === '.' || x === '..') ? '_' : safeFilename(x, 'file')).join('/');
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
    counts: { conversations: p.conversations.length, messages: p.messageCount, artifacts: p.artifacts.length, projects: p.projects.length, designChats: p.designChats.length, memoryFiles: p.memory ? p.memory.files.length : 0, comments: p.comments.length },
    firstActivity: p.first ? new Date(p.first).toISOString() : null, lastActivity: p.last ? new Date(p.last).toISOString() : null,
  }, null, 2));

  let i = 0;
  for (const c of p.conversations) {
    if (isCancelled()) return null;
    const base = 'conversations/' + nameOf(c.created, c.title, c.id);
    z.add(base + '.md', convToMarkdown(c));
    z.add(base + '.json', JSON.stringify(c.raw, null, 2));
    if (++i % 20 === 0) { progress(`Conversations ${i} / ${p.conversations.length}`); await new Promise(r => setTimeout(r, 0)); }
  }
  for (const x of p.projects) {
    const base = 'projects/' + nameOf(0, x.name, x.id) + '/';
    z.add(base + 'project.json', JSON.stringify(x.raw, null, 2));
    for (const d of x.docs) z.add(base + 'docs/' + cleanPath(d.filename), d.content);
  }
  for (const d of p.designChats) {
    z.add('design_chats/' + nameOf(d.created, (d.project.name ? d.project.name + ' - ' : '') + d.title, d.id) + '.json', JSON.stringify(d.raw, null, 2));
  }
  if (p.memory) {
    const m = p.memory;
    if (m.conversationsMemory) z.add('memory/chat-memory.md', m.conversationsMemory);
    for (const pm of m.projectMemories) z.add('memory/project-memories/' + safeFilename(projectName(pm.projectId) || pm.projectId, 'project') + '.md', pm.text);
    for (const f of m.files) z.add('memory/files/' + cleanPath(f.path), f.content);
  }
  if (p.comments.length) {
    z.add('comments.json', JSON.stringify(p.comments.map(c => ({ artifactId: c.artifact.id, artifactTitle: c.artifact.title, tab: c.thread && c.thread.tab, quoted: c.thread && c.thread.quoted_text, postedByClaude: c.byAgent, comment: c.comment })), null, 2));
  }
  i = 0;
  for (const a of p.artifacts) {
    if (isCancelled()) return null;
    const base = 'artifacts/' + nameOf(0, a.title, a.id) + '/';
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
