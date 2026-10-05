/* Projects, memory, design chats, search, about, per-person export. */
'use strict';

/* ======================= Projects ======================= */

function projectTable(list, key, showOwner) {
  const columns = [{
    id: 'name', label: 'Project', cls: 'title', sortVal: x => (x.name || '').toLowerCase(),
    html: x => `<div dir="auto">${x.name ? esc(x.name) : '<i class="faint">Untitled project</i>'}</div>
      ${x.description ? `<div class="snip" dir="auto">${esc(truncate(x.description, 200))}</div>` : ''}
      <div class="row wrap" style="margin-top:5px;gap:4px">${x.isStarter ? '<span class="chip">Starter</span>' : ''}${!x.isPrivate ? '<span class="chip on">Shared</span>' : ''}${projectMemoryOf(x).length ? '<span class="chip">🧠 memory</span>' : ''}</div>`,
  }];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('docs', 'Docs', x => x.docs.length));
  columns.push(Object.assign(COL.date('created', 'Created', x => x.created), { cls: 'date hide-sm' }));
  columns.push(COL.date('updated', 'Updated', x => x.updated));
  return tableHtml({
    key, rows: list, columns, sort: 'updated', dir: -1, noun: 'project',
    href: x => '#/p/' + encodeURIComponent(x.id),
    text: x => [x.name, x.description, x.owner && x.owner.name, x.owner && x.owner.email, ...x.docs.map(d => d.filename)].join(' '),
    placeholder: 'Filter by name, doc name or person…', empty: 'No projects.',
  });
}

function viewProjects() {
  const fp = App.focus ? DB.people.get(App.focus) : null;
  const list = fp ? fp.projects : DB.projects;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Projects</h1>
    <div class="sub">${fp ? `<span>Only ${personLink(fp)}’s</span>` : ''}<span>${plural(list.length, 'project')}</span><span>${fmtNum(list.reduce((a, x) => a + x.docs.length, 0))} docs</span></div></div></div>
    <p class="muted" style="font-size:13.5px;margin:-6px 0 14px">The export does not say which conversations belong to a project, so chats are not listed here.</p>
    ${projectTable(list, 'proj-' + (fp ? fp.id : 'all'), !fp)}</div>`;
}

// Memory about a project: the owner's project_memories entry and /projects/<id>/ memory files.
function projectMemoryOf(x) {
  const out = [];
  for (const mem of DB.memories) {
    for (const pm of mem.projectMemories) if (pm.projectId === x.id) out.push({ mem, kind: 'summary', text: pm.text });
    for (const f of mem.files) if (f.path.startsWith('/projects/' + x.id + '/')) out.push({ mem, kind: 'file', file: f });
  }
  return out;
}

function viewProject(id) {
  const x = DB.projectById.get(id);
  if (!x) return notFound('No project with this id in the loaded export.');
  const p = x.owner;
  const pm = projectMemoryOf(x);
  return `<div class="page narrow">
    <div class="crumbs"><a href="#/projects">Projects</a><span>›</span>${p && !p.system ? `${personLink(p)}<span>›</span>` : ''}<span dir="auto">${esc(x.name || 'Untitled project')}</span></div>
    <div class="page-head"><div class="grow">
      <h1 dir="auto">${x.name ? esc(x.name) : '<i class="faint">Untitled project</i>'}</h1>
      <div class="sub">${p ? `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)}</span>` : ''}
        <span>Created ${esc(fmtDateTime(x.created))}</span><span>Updated ${esc(fmtDateTime(x.updated))}</span>
        ${x.isStarter ? '<span class="chip">Starter project</span>' : ''}<span class="chip${x.isPrivate ? '' : ' on'}">${x.isPrivate ? 'Private' : 'Shared'}</span>
        <a href="https://claude.ai/project/${encodeURIComponent(x.id)}" target="_blank" rel="noopener noreferrer">claude.ai ↗</a></div>
      ${x.description ? `<p dir="auto" style="margin:10px 0 0">${esc(x.description)}</p>` : ''}
    </div></div>
    ${x.promptTemplate ? `<h2 class="section-title">Project instructions</h2><div class="card card-pad">${mdBlock(x.promptTemplate)}</div>` : ''}
    <h2 class="section-title">Knowledge files <span class="badge">${x.docs.length}</span></h2>
    ${x.docs.length ? `<div class="doc-list">${x.docs.map(docHtml).join('')}</div>` : '<div class="card empty">No files in this project.</div>'}
    ${pm.length ? `<h2 class="section-title">What Claude remembers about this project</h2>${pm.map(e => e.kind === 'summary'
      ? `<div class="card card-pad" style="margin-bottom:10px">${memoryText(e.text, e.mem)}</div>`
      : memoryFileCard(e.file, e.mem, 0)).join('')}` : ''}
  </div>`;
}

function docHtml(d) {
  const ext = fileExt(d.filename);
  const k = lazyKey(() => {
    const dl = `<div class="row" style="margin-bottom:8px"><span class="faint" style="font-size:12.5px">Added ${esc(fmtDateTime(d.created))}</span><span class="grow"></span><button class="btn small" type="button" data-action="dl-text" data-name="${esc(d.filename.split('/').pop())}" data-stash="${stashText(d.content)}">Download</button></div>`;
    if (ext === 'md' || ext === 'markdown' || ext === 'pptx' || ext === 'docx' || ext === 'pdf') {
      return dl + (ext !== 'md' && ext !== 'markdown' ? `<p class="notice" style="margin:0 0 8px">Text extracted from the ${esc(ext)} file. The original file is not in the export.</p>` : '') + mdBlock(d.content) +
        `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Raw text</span></summary><div class="blk-body">${preHtml(d.content, { wrap: true })}</div></details>`;
    }
    if (ext === 'html' || ext === 'htm') {
      return dl + sandboxFrame(d.content, 520) + `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(d.content)}</div></details>`;
    }
    return dl + preHtml(d.content);
  });
  const parts = d.filename.split('/');
  const file = parts.pop();
  return `<details class="blk" data-lazy="${k}"><summary><span class="lbl" dir="auto">${esc(file)}</span>${parts.length ? `<span class="desc faint mono">${esc(parts.join('/'))}/</span>` : ''}<span class="meta">${fmtBytes(d.content.length)}</span></summary><div class="blk-body"></div></details>`;
}

/* ======================= Memory ======================= */

function viewMemories() {
  const fp = App.focus ? DB.people.get(App.focus) : null;
  if (fp) {
    return `<div class="page narrow"><div class="page-head"><div class="grow"><h1>Memory</h1><div class="sub"><span>Only ${personLink(fp)}</span></div></div></div>
      ${fp.memory ? memoryBody(fp.memory) : '<div class="card empty">No memory for this person in this export.</div>'}</div>`;
  }
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Memory</h1>
    <div class="sub"><span>What Claude remembers about each person: ${plural(DB.memories.length, 'person', 'people')}</span></div></div></div>
    ${tableHtml({
      key: 'mem-all', rows: DB.memories, sort: 'updated', dir: -1, noun: 'person', nounPlural: 'people', placeholder: 'Filter by person or memory text…', empty: 'No memory in this export.',
      href: m => '#/memory/' + encodeURIComponent(m.id),
      text: m => [m.owner && m.owner.name, m.owner && m.owner.email, m.conversationsMemory, ...m.projectMemories.map(x => x.text), ...m.files.map(f => f.path + ' ' + f.content)].join(' '),
      columns: [
        { id: 'owner', label: 'Person', sortVal: m => m.owner.name.toLowerCase(), html: m => whoCell(m.owner) },
        { id: 'profile', label: 'Profile', cls: 'title', html: m => { const pf = m.files.find(f => f.path === '/profile.md'); const t = pf ? pf.body : m.conversationsMemory; return `<div class="snip" dir="auto" style="font-weight:400">${esc(truncate(oneLine(stripMd(String(t || '').replace(/- \[stated\]/g, ''))), 220))}</div>`; } },
        COL.num('files', 'Files', m => m.files.length),
        { id: 'chat', label: 'Chat memory', html: m => m.conversationsMemory ? '✓' : '<span class="faint">—</span>', sortVal: m => (m.conversationsMemory ? 1 : 0), cls: 'num' },
        COL.date('updated', 'Updated', m => m.updated),
      ],
    })}</div>`;
}

function viewMemory(personId) {
  const mem = DB.memoryByPerson.get(personId);
  const p = DB.people.get(personId);
  if (!mem || !p) return notFound('No memory for this person.');
  const want = App.route.query.f;
  if (want) {
    after(() => {
      const f = mem.files.find(x => x.stem === want || x.meta.name === want || (Array.isArray(x.meta.aliases) && x.meta.aliases.includes(want)));
      const el = f && document.getElementById(memSlugId(mem, f.path));
      if (!el) { toast('No memory file named “' + want + '”'); return; }
      el.open = true;
      el.scrollIntoView({ block: 'start' });
      el.classList.add('flash');
    });
  }
  return `<div class="page narrow">
    <div class="crumbs"><a href="#/memories">Memory</a><span>›</span>${personLink(p)}</div>
    <div class="page-head">${avatarHtml(p, 'lg')}<div class="grow"><h1>What Claude remembers about ${esc(p.name)}</h1>
      <div class="sub"><span>${plural(mem.files.length, 'memory file')}</span>${mem.updated ? `<span>Updated ${esc(fmtDateTime(mem.updated))}</span>` : ''}<a href="#/person/${encodeURIComponent(p.id)}">Open profile</a></div></div></div>
    ${memoryBody(mem)}
  </div>`;
}

const MEM_FOLDERS = { '': 'Profile', people: 'People', areas: 'Work areas', topics: 'Topics', projects: 'Projects' };

function memoryBody(mem) {
  const groups = new Map();
  for (const f of mem.files) {
    const segs = f.path.replace(/^\//, '').split('/');
    let g = segs.length > 1 ? segs[0] : '';
    if (g === 'projects' && segs[1]) g = 'projects/' + segs[1];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const order = ['', 'people', 'areas', 'topics'];
  const keys = Array.from(groups.keys()).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.localeCompare(b);
  });
  const label = g => {
    if (g.startsWith('projects/')) {
      const pid = g.slice(9);
      const idx = mem.files.find(f => f.path === '/projects/' + pid + '/index.md');
      return 'Project: ' + (projectName(pid) || (idx && idx.meta.name) || pid.slice(0, 8));
    }
    return MEM_FOLDERS[g] || g;
  };
  let i = 0;
  const filesHtml = keys.map(g => `<h3 class="section-title" style="font-size:14.5px">${esc(label(g))} <span class="badge">${groups.get(g).length}</span></h3>
    <div class="doc-list">${groups.get(g).map(f => memoryFileCard(f, mem, i++)).join('')}</div>`).join('');
  return `
    ${mem.files.length ? `<div class="row wrap" style="margin:4px 0 0"><span class="muted" style="font-size:13.5px">Memory files Claude keeps. Each fact is tagged with where it came from.</span><span class="grow"></span><button class="btn small" type="button" data-action="mem-expand">Expand all</button></div>${filesHtml}` : ''}
    ${mem.conversationsMemory ? `<h2 class="section-title">Chat memory summary</h2><div class="card card-pad">${memoryText(mem.conversationsMemory, mem)}</div>` : ''}
    ${mem.projectMemories.length ? `<h2 class="section-title">Project memories</h2>${mem.projectMemories.map(pm => `<div class="card card-pad" style="margin-bottom:10px"><h3 style="margin-bottom:8px">${DB.projectById.has(pm.projectId) ? `<a href="#/p/${encodeURIComponent(pm.projectId)}">${esc(projectName(pm.projectId))}</a>` : esc(pm.projectId)}</h3>${memoryText(pm.text, mem)}</div>`).join('')}` : ''}
    ${!mem.files.length && !mem.conversationsMemory && !mem.projectMemories.length ? '<div class="card empty">Empty memory.</div>' : ''}`;
}

// DOM id for a memory file, unique per path (same file name can sit in two folders).
function memSlugId(mem, path) { return 'mf-' + hashHue(mem.id) + '-' + String(path).replace(/[^a-z0-9_-]/gi, '_'); }

function memoryFileCard(f, mem, i) {
  const name = f.meta.name || f.stem;
  const title = String(name).replace(/[-_]+/g, ' ');
  const sources = Array.isArray(f.meta.sources) ? f.meta.sources : [];
  const aliases = Array.isArray(f.meta.aliases) ? f.meta.aliases : [];
  const k = lazyKey(() => (f.body.trim() ? memoryText(f.body, mem) : '<p class="faint">(empty)</p>') + `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Raw file</span><span class="desc mono">${esc(f.path)}</span></summary><div class="blk-body">${preHtml(f.content, { wrap: true })}</div></details>`);
  return `<details class="blk mem-file" data-lazy="${k}" id="${memSlugId(mem, f.path)}"><summary>
    <span class="lbl" dir="auto">${esc(title)}</span><span class="desc" dir="auto">${esc(f.meta.description || '')}</span>
    <span class="meta">${sources.map(s => `<span class="chip" style="font-size:11px" title="${esc(SOURCE_HELP[s] || '')}">${esc(s)}</span>`).join(' ')} ${f.updated ? esc(fmtDate(f.updated)) : ''}</span></summary>
    <div class="blk-body">${aliases.length ? `<p class="faint" style="font-size:12.5px;margin:0 0 6px">Also called: ${aliases.map(esc).join(', ')}</p>` : ''}</div></details>`;
}

const SOURCE_HELP = { backfill: 'Seeded from older chat history', chat: 'Learned in a claude.ai chat', cowork: 'Learned in Cowork' };

// Memory markdown: "[stated]" becomes a small tag, [[slug]] becomes a link to that memory file.
function memoryText(text, mem) {
  let t = String(text || '');
  t = t.replace(/^(\s*[-*]\s+)\[(stated|inferred|observed|[a-z]+)\]\s*/gim, (all, lead, tag) => `${lead}<span class="mtag">${tag}</span> `);
  // Plain in-app links: the sanitizer keeps href, and the memory page opens the file named in ?f=.
  t = t.replace(/\[\[([^\]\n]+)\]\]/g, (all, slug) => `[${slug.trim().replace(/[[\]]/g, '')}](#/memory/${encodeURIComponent(mem.id)}?f=${encodeURIComponent(slug.trim())})`);
  return `<div class="md">${mdToHtml(t)}</div>`;
}

/* ======================= Design chats ======================= */

function designTable(list, key, showOwner) {
  const columns = [{
    id: 'title', label: 'Design chat', cls: 'title', sortVal: d => d.title.toLowerCase(),
    html: d => `<div dir="auto">${esc(d.title)}</div><div class="row wrap" style="margin-top:5px;gap:4px"><span class="chip" dir="auto">✎ ${esc(d.project.name || 'design project')}</span>${d.msgCount ? '' : '<span class="chip warn">empty</span>'}${d.authors && d.authors.length > 1 ? `<span class="chip">${d.authors.length} people</span>` : ''}</div>`,
  }];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('msgs', 'Messages', d => d.msgCount));
  columns.push(COL.date('last', 'Last message', d => d.lastTs));
  return tableHtml({
    key, rows: list, columns, sort: 'last', dir: -1, noun: 'design chat',
    href: d => '#/d/' + encodeURIComponent(d.id),
    text: d => [d.title, d.project.name, d.firstPrompt, ...(d.authors || []).map(p => p.name + ' ' + p.email)].join(' '),
    placeholder: 'Filter by prompt, design project or person…', empty: 'No design chats.',
  });
}

function viewDesignChats() {
  const fp = App.focus ? DB.people.get(App.focus) : null;
  const list = fp ? fp.designChats : DB.designChats;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Design chats</h1>
    <div class="sub">${fp ? `<span>Only ${personLink(fp)}’s</span>` : ''}<span>${plural(list.length, 'chat')} from Claude Design</span><span>${new Set(list.map(d => d.project.id)).size} design projects</span></div></div></div>
    ${designTable(list, 'design-' + (fp ? fp.id : 'all'), !fp)}</div>`;
}

const DESIGN_NOISE = /^(<i><\/i>|<details>|<ant\w*)$/;

function viewDesignChat(id) {
  const d = DB.designById.get(id);
  if (!d) return notFound('No design chat with this id.');
  const msgs = d.messages;
  const receipts = new Map();
  for (const m of msgs) { const c = m.content || {}; if (c.questionReceipt && c.questionReceipt.questionId) receipts.set(c.questionReceipt.questionId, c.questionReceipt); }
  const tokens = msgs.reduce((a, m) => a + ((m.content && m.content.turnInputTokens) || 0), 0);
  const q = App.route.query.q;
  if (q) after(() => highlightIn($('#thread'), searchTerms(q)));
  return `<div class="page narrow">
    <div class="crumbs"><a href="#/design">Design chats</a><span>›</span>${d.owner && !d.owner.system ? `${personLink(d.owner)}<span>›</span>` : ''}<span dir="auto">${esc(d.project.name)}</span></div>
    <div class="page-head"><div class="grow">
      <h1 dir="auto">${esc(d.title)}</h1>
      <div class="sub"><span class="chip on" dir="auto">✎ ${esc(d.project.name || 'design project')}</span>
        ${(d.authors || []).map(p => `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)}</span>`).join('') || '<span class="faint">No author (empty chat)</span>'}
        <span>Started ${esc(fmtDateTime(d.created))}</span><span>Last ${esc(fmtDateTime(d.lastTs))}</span><span>${plural(d.msgCount, 'message')}</span>
        ${tokens ? `<span class="faint" title="Sum of input context over all turns">${fmtNum(Math.round(tokens / 1000))}k context tokens</span>` : ''}</div>
    </div><div class="row"><button class="btn small" type="button" data-action="design-dl" data-id="${esc(d.id)}">Download .json</button></div></div>
    <div class="conv-toolbar"><button class="chip" type="button" data-action="expand-all">Expand all</button><button class="chip" type="button" data-action="collapse-all">Collapse all</button></div>
    <div class="thread" id="thread">${msgs.length ? msgs.map(m => designMessageHtml(m, d, receipts)).join('') : '<div class="empty">This design chat has no messages in the export.</div>'}</div>
  </div>`;
}

function designAuthor(c, d) {
  const id = c.authorAccountUuid || (c.authorName && d.nameToId.get(String(c.authorName).toLowerCase())) || d.ownerId;
  return id ? DB.people.get(id) : null;
}

function designUserContent(text) {
  const raw = String(text || '');
  const cleaned = cleanDesignPrompt(raw);
  const injected = raw.length - cleaned.length > 20;
  let h = cleaned ? `<div class="md" dir="auto">${mdToHtml(cleaned, { breaks: true })}</div>` : '';
  if (injected) {
    const k = lazyKey(() => preHtml(raw, { wrap: true }));
    h += `<details class="blk thinking" data-lazy="${k}"><summary><span class="lbl">Context added by the app</span></summary><div class="blk-body"></div></details>`;
  }
  return h;
}

function designAttachments(atts, showHidden) {
  if (!Array.isArray(atts) || !atts.length) return '';
  const out = [];
  for (const a of atts) {
    if (!a) continue;
    if (a.hidden && !showHidden) continue;
    const name = a.name || a.type || 'attachment';
    if (a.type === 'skill' || a.type === 'text' || (a.type === 'image' && a.content)) {
      const k = lazyKey(() => preHtml(a.content || '', { wrap: true }));
      out.push(`<details class="blk attach" data-lazy="${k}"><summary><span class="lbl" dir="auto">${a.type === 'skill' ? 'skill: ' : ''}${esc(name)}</span><span class="meta">${fmtBytes((a.content || '').length)}</span></summary><div class="blk-body"></div></details>`);
    } else if (a.type === 'comment') {
      const content = String(a.content || '');
      const fb = content.includes('</mentioned-element>') ? content.split('</mentioned-element>').pop() : content.replace(/^File:[^\n]*\n?/, '');
      const onFile = a.filePath || ((/^File:\s*(.+)$/m.exec(content) || [])[1] || '').trim();
      out.push(`<div class="card card-pad" style="padding:8px 12px"><div class="row wrap" style="font-size:12.5px;color:var(--muted)"><span class="chip">🗨 comment on the design</span>${onFile ? `<span class="mono">${esc(onFile)}</span>` : ''}</div><div class="md" dir="auto">${mdToHtml(fb.replace(/^\s*Feedback:\s*/, '').trim())}</div></div>`);
    } else if (a.type === 'fig-file') {
      const k = lazyKey(() => (Array.isArray(a.selectedFrames) ? `<ul>${a.selectedFrames.map(f => `<li class="mono">${esc(f)}</li>`).join('')}</ul>` : '') + (a.figOutline ? preHtml(a.figOutline, { wrap: true }) : ''));
      out.push(`<details class="blk attach" data-lazy="${k}"><summary><span class="lbl">Figma: ${esc(name)}</span></summary><div class="blk-body"></div></details>`);
    } else {
      const ico = a.type === 'image' ? '🖼' : a.type === 'folder' ? '📁' : '📄';
      out.push(`<span class="file-chip" title="${esc(a.path || '')}">${ico} <span dir="auto">${esc(name)}</span> <span class="sz">${a.type === 'folder' ? 'local folder' : 'not in export'}</span></span>`);
    }
  }
  return out.length ? `<div class="files-row" style="flex-direction:column;align-items:stretch">${out.join('')}</div>` : '';
}

function designQuestionCard(spec, receipt) {
  const qs = spec && Array.isArray(spec.questions) ? spec.questions : [];
  const ans = receipt && receipt.payload ? receipt.payload : null;
  const fmtAns = v => {
    if (!v) return '<span class="faint">skipped</span>';
    const x = v.choice != null ? v.choice : v.choices || v.selected || v.text || v.file || v.localFolders;
    if (x == null || (Array.isArray(x) && !x.length) || x === '') return '<span class="faint">skipped</span>';
    if (Array.isArray(x)) return x.map(y => `<span class="chip on" dir="auto">${esc(typeof y === 'string' ? y : (y.name || JSON.stringify(y)))}</span>`).join(' ');
    return `<span class="chip on" dir="auto">${esc(x)}</span>`;
  };
  return `<div class="card card-pad"><div class="row wrap" style="margin-bottom:6px"><span class="chip on">? Questions</span><b dir="auto">${esc((spec && spec.title) || '')}</b></div>
    ${spec && spec.prompt ? `<p class="muted" dir="auto" style="margin:0 0 6px">${esc(spec.prompt)}</p>` : ''}
    ${qs.map(q => `<div style="margin-top:8px"><div dir="auto"><b>${esc(q.title || q.question || q.id)}</b></div>
      ${Array.isArray(q.options) && q.options.length ? `<div class="faint" style="font-size:12.5px" dir="auto">Options: ${q.options.map(o => esc(typeof o === 'string' ? o : JSON.stringify(o))).join(' · ')}</div>` : ''}
      ${ans ? `<div style="margin-top:3px">Answer: ${fmtAns(ans[q.id])}</div>` : ''}</div>`).join('')}
    ${!ans ? '<p class="faint" style="margin:8px 0 0;font-size:13px">No answer recorded.</p>' : ''}</div>`;
}

function designMessageHtml(m, d, receipts) {
  const c = m.content && typeof m.content === 'object' ? m.content : { content: String(m.content || '') };
  const time = fmtDateTime(m.created_at);
  const snip = c.snipState ? ` <span class="faint" title="Later trimmed from Claude’s working context; still shown here">· trimmed</span>` : '';
  if (m.role === 'user') {
    if (c.kind === 'question-receipt') return '';   // shown inside its question card
    if (c.pill === true) {
      const att = designAttachments(c.attachments, true);
      return `<div class="row" style="justify-content:center"><details class="blk" style="max-width:640px;width:100%"><summary><span class="lbl">⚑ ${esc(oneLine(c.content || 'Notice'))}</span><span class="meta">${esc(time)}</span></summary><div class="blk-body">${att || '<p class="faint">No details.</p>'}</div></details></div>`;
    }
    const who = designAuthor(c, d);
    return `<article class="msg human" id="m-${esc(m.uuid)}"><div class="msg-head">${avatarHtml(who, 'sm')}<span class="who">${who ? personLink(who) : esc(c.authorName || 'User')}</span><span>${esc(time)}</span>${snip}</div>
      <div class="msg-body">${designUserContent(c.content)}${designAttachments(c.attachments, false)}</div></article>`;
  }
  // assistant
  if (c.kind === 'question-record' && c.questionRecord) {
    return `<article class="msg assistant" id="m-${esc(m.uuid)}"><div class="msg-head"><span class="avatar sm" style="--h:20">C</span><span class="who">Claude</span><span>${esc(time)}</span></div>
      <div class="msg-body">${designQuestionCard(c.questionRecord.spec, receipts.get(c.questionRecord.questionId))}</div></article>`;
  }
  if (c.kind === 'chat-summary') {
    return `<details class="card summary-box"><summary>Summary carried over from an earlier chat</summary>${mdBlock(c.content || '')}</details>`;
  }
  const blocks = Array.isArray(c.contentBlocks) ? c.contentBlocks : null;
  const out = [];
  if (!blocks) {
    if (c.content) out.push(`<div class="md" dir="auto">${mdToHtml(c.content)}</div>`);
  } else {
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const items = group.map(designToolHtml).join('');
      out.push(group.length > 2
        ? `<details class="blk"><summary><span class="lbl">${group.length} tool calls</span><span class="desc">${esc(Array.from(new Set(group.map(g => g.name))).slice(0, 6).join(', '))}</span></summary><div class="blk-body tool-group">${items}</div></details>`
        : items);
      group = [];
    };
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'tool_call' && b.toolCall) { group.push(b.toolCall); continue; }
      flush();
      if (b.type === 'text') { const t = (b.text || '').trim(); if (t && !DESIGN_NOISE.test(t)) out.push(`<div class="md" dir="auto">${mdToHtml(t)}</div>`); }
      else if (b.type === 'error') out.push(`<div class="notice warn" style="color:var(--err)">Error: ${esc(typeof b.message === 'string' ? b.message : JSON.stringify(b.message))}</div>`);
      else if (b.type === 'user_interjection' && b.message && b.message.pill === true) {
        // An automation notice that arrived mid-turn, not something the person typed.
        out.push(`<details class="blk"><summary><span class="lbl">⚑ ${esc(oneLine(b.message.content || 'Notice'))}</span><span class="meta">${esc(fmtDateTime(b.message.timestamp))}</span></summary><div class="blk-body">${designAttachments(b.message.attachments, true) || '<p class="faint">No details.</p>'}</div></details>`);
      } else if (b.type === 'user_interjection' && b.message) {
        const who = DB.people.get(d.ownerId);
        out.push(`<div class="msg human" style="margin-left:24px"><div class="msg-head">${avatarHtml(who, 'sm')}<span class="who">${who ? esc(who.name) : 'User'}</span><span class="faint">added while Claude was working · ${esc(fmtDateTime(b.message.timestamp))}</span></div><div class="msg-body">${designUserContent(b.message.content)}${designAttachments(b.message.attachments, false)}</div></div>`);
      }
      // thinking blocks are always empty in the export
    }
    flush();
  }
  const tc = c.turnChanges;
  if (tc && typeof tc === 'object') {
    const rows = ['created', 'edited', 'deleted', 'moved', 'copied'].filter(k => Array.isArray(tc[k]) && tc[k].length)
      .map(k => `<span class="faint">${k}:</span> ${tc[k].map(p => `<span class="file-chip mono" style="padding:1px 7px">${esc(p)}</span>`).join(' ')}`);
    if (rows.length) out.push(`<div class="files-row" style="font-size:12.5px">${rows.join(' ')}</div>`);
  }
  const failed = !c.turnInputTokens && blocks && blocks.length && blocks[blocks.length - 1].type === 'error';
  return `<article class="msg assistant" id="m-${esc(m.uuid)}"><div class="msg-head"><span class="avatar sm" style="--h:20">C</span><span class="who">Claude</span><span>${esc(time)}</span>${c.turnInputTokens ? `<span class="faint">· ${fmtNum(Math.round(c.turnInputTokens / 1000))}k context</span>` : ''}${failed ? ' <span class="chip err">turn failed</span>' : ''}${snip}</div>
    <div class="msg-body">${out.join('') || '<span class="faint">(no text)</span>'}</div></article>`;
}

function designToolHtml(t) {
  const i = t.input && typeof t.input === 'object' ? t.input : {};
  const desc = i.path || i.a_filename || i.query || i.purpose || i.title || i.pattern || i.label || i.filename || (i.from_id ? i.from_id + '→' + i.to_id : '') || '';
  const out = typeof t.output === 'string' ? t.output : null;
  const k = lazyKey(() => {
    let h = '<div class="blk-sub">Input</div>';
    if ((t.name === 'questions_v2' || t.name === 'ask_user') && Array.isArray(i.questions)) {
      h += designQuestionCard(i, null).replace(/<p class="faint"[^>]*>No answer recorded\.<\/p>/, '') + '<p class="faint" style="font-size:12.5px">The answers are in the next message from the person.</p>';
    } else if (i.content != null && typeof i.content === 'string') h += (i.path ? `<p class="mono faint" style="margin:0 0 6px">${esc(i.path)}</p>` : '') + preHtml(i.content);
    else if (i.b_dc_html) h += preHtml(i.b_dc_html) + (i.c_dc_js ? `<div class="blk-sub">Logic</div>${preHtml(i.c_dc_js)}` : '');
    else if (i.old_string != null || i.c_find != null) h += diffHtml(i.old_string != null ? i.old_string : i.c_find, i.new_string != null ? i.new_string : i.d_replace);
    else if (Array.isArray(i.edits)) h += i.edits.map(e => diffHtml(e.old_string, e.new_string)).join('<hr>');
    else if (i.code) h += preHtml(i.code);
    else h += Object.keys(i).length ? kvOrJson(i) : '<p class="faint">(no input)</p>';
    h += '<div class="blk-sub">Output</div>';
    if (out == null) h += '<p class="faint">No result (turn interrupted).</p>';
    else if (/^\[elided\]$|^\(\d* ?images?\)$/.test(out)) h += '<p class="faint">Visual output (screenshot or preview), not in the export.</p>';
    else h += preHtml(out, { wrap: true }) + (out.length === 200 ? '<p class="faint" style="font-size:12.5px">The export cuts tool output at 200 characters.</p>' : '');
    return h;
  });
  return `<details class="blk tool" data-lazy="${k}"><summary><span class="lbl">${esc(t.name || 'tool')}</span>${t.serverSide ? '<span class="chip" style="font-size:11px">server</span>' : ''}<span class="desc" dir="auto">${esc(truncate(oneLine(String(desc)), 140))}</span></summary><div class="blk-body"></div></details>`;
}

/* ======================= Search ======================= */

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

const SEARCH_STATE = { token: 0, cache: null };

async function runSearch(q, deep, onProgress) {
  const terms = searchTerms(q);
  const token = ++SEARCH_STATE.token;
  const res = { conversations: [], artifacts: [], projects: [], design: [], memory: [], people: [], terms };
  if (!terms.length) return res;
  const fp = App.focus ? DB.people.get(App.focus) : null;
  const inScope = x => !fp || x.ownerId === fp.id || (x.authorIds && x.authorIds.includes(fp.id)) || (x.owner && x.owner.id === fp.id);
  const all = terms;
  const has = s => { const l = String(s || '').toLowerCase(); return all.every(t => l.includes(t)); };

  // People
  for (const p of DB.people.values()) if (!p.system && has(p.name + ' ' + p.email + ' ' + p.id)) res.people.push({ p });

  // Conversations (chunked to keep the tab responsive)
  const convs = fp ? fp.conversations : DB.conversations;
  for (let ci = 0; ci < convs.length; ci++) {
    const c = convs[ci];
    if (!c._lcMsgs) c._lcMsgs = (c.raw.chat_messages || []).map(m => msgProse(m).toLowerCase());
    if (deep && !c._lcDeep) c._lcDeep = (c.raw.chat_messages || []).map(m => msgDeep(m).toLowerCase());
    const head = (c.title + '\n' + c.summary).toLowerCase();
    let msgs = c._lcMsgs;
    const joined = head + '\n' + msgs.join('\n') + (deep ? '\n' + c._lcDeep.join('\n') : '');
    const score = countHits(joined, terms);
    if (score >= 0) {
      let hitIdx = msgs.findIndex(x => x.includes(terms[0]));
      let hitDeep = false;
      if (hitIdx < 0 && deep) { hitIdx = c._lcDeep.findIndex(x => x.includes(terms[0])); hitDeep = hitIdx >= 0; }
      res.conversations.push({ c, score: score + (countHits(head, terms) >= 0 ? 20 : 0), hitIdx, hitDeep });
    }
    if (ci % 40 === 39) {
      onProgress && onProgress(`Searching conversations… ${ci + 1} / ${convs.length}`);
      await new Promise(r => setTimeout(r, 0));
      if (token !== SEARCH_STATE.token) return null;
    }
  }
  res.conversations.sort((a, b) => b.score - a.score || b.c.lastTs - a.c.lastTs);

  // Projects
  for (const x of DB.projects) {
    if (!inScope(x)) continue;
    if (!x._lc) x._lc = [x.name, x.description, x.promptTemplate, ...x.docs.map(d => d.filename + '\n' + d.content)].join('\n').toLowerCase();
    if (all.every(t => x._lc.includes(t))) res.projects.push({ x });
  }
  // Design chats
  for (const d of DB.designChats) {
    if (!inScope(d)) continue;
    if (!d._lc) {
      const commentText = atts => (Array.isArray(atts) ? atts : []).filter(a => a && a.type === 'comment').map(a => String(a.content || '')).join('\n');
      d._text = [d.title, d.project.name, ...d.messages.map(m => {
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
      d._lc = d._text.toLowerCase();
    }
    if (all.every(t => d._lc.includes(t))) res.design.push({ d });
  }
  // Memory
  for (const mem of DB.memories) {
    if (fp && mem.id !== fp.id) continue;
    if (!mem._lc) {
      mem._text = [mem.conversationsMemory, ...mem.projectMemories.map(x => x.text), ...mem.files.map(f => f.content)].join('\n');
      mem._lc = mem._text.toLowerCase();
    }
    if (all.every(t => mem._lc.includes(t))) res.memory.push({ mem });
  }
  // Artifacts: titles, descriptions, docs text, comments
  onProgress && onProgress('Searching artifacts…');
  const arts = fp ? fp.artifacts : DB.artifacts;
  const needPages = arts.filter(a => a.pageNode && a._pageText == null);
  await mapLimit(needPages, 8, async a => { try { a._pageText = await a.pageNode.text(); } catch (e) { a._pageText = ''; } });
  if (token !== SEARCH_STATE.token) return null;
  if (deep) {
    // Read each artifact's current version once (text only) so its content is searchable too.
    const todo = arts.filter(a => a._contentLc == null);
    let done = 0;
    await mapLimit(todo, 6, async a => {
      try { a._contentText = await artifactPlainText(a); } catch (e) { a._contentText = ''; }
      a._contentLc = a._contentText.toLowerCase();
      if (++done % 25 === 0) onProgress && onProgress(`Reading artifact content… ${done} / ${todo.length}`);
    });
    if (token !== SEARCH_STATE.token) return null;
  }
  for (const a of arts) {
    if (!a._lc) {
      a._lc = [a.title, a.description, a.contentType, ...a.versions.map(v => v.title + ' ' + v.description), a._pageText || '',
        ...(a.comments || []).flatMap(t => [t.quoted_text, ...(t.comments || []).map(c => c.body)]),
        ...(a.threads || []).flatMap(t => (t.comments || []).map(c => c.text))].join('\n').toLowerCase();
    }
    if (all.every(t => a._lc.includes(t))) res.artifacts.push({ a });
    else if (deep && a._contentLc && all.every(t => a._lc.includes(t) || a._contentLc.includes(t))) res.artifacts.push({ a, inContent: true });
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

const SEARCH_TYPES = [
  ['all', 'Everything'], ['conversations', 'Conversations'], ['artifacts', 'Artifacts'], ['projects', 'Projects'],
  ['design', 'Design chats'], ['memory', 'Memory'], ['people', 'People'],
];

function viewSearch(q, t) {
  const deep = App.route.query.deep === '1';
  const fp = App.focus ? DB.people.get(App.focus) : null;
  after(async () => {
    const box = $('#search-results');
    if (!box) return;
    if (!q.trim()) { box.innerHTML = '<div class="empty">Type in the search box above. Use quotes for exact phrases, e.g. <code>"design system"</code>.</div>'; return; }
    box.innerHTML = '<div class="empty" id="search-progress">Searching…</div>';
    const res = await runSearch(q, deep, msg => { const p = $('#search-progress'); if (p) p.textContent = msg; });
    if (!res || !$('#search-results')) return;
    drawSearchResults(res, q, t, deep);
  });
  return `<div class="page narrow">
    <div class="page-head"><div class="grow"><h1>Search</h1>
      <div class="sub">${fp ? `<span>Only ${personLink(fp)}’s data · <a href="#" data-action="clear-focus">search everyone</a></span>` : '<span>All people</span>'}</div></div></div>
    <div class="toolbar">
      <label class="row muted" style="font-size:14px"><input type="checkbox" data-action="search-deep"${deep ? ' checked' : ''}> Deep search: also look inside tool calls, thinking, attached files and artifact content (slower the first time)</label>
    </div>
    <div id="search-tabs" class="search-tabs"></div>
    <div id="search-results"></div>
  </div>`;
}

function drawSearchResults(res, q, t, deep) {
  const terms = res.terms;
  const counts = {
    conversations: res.conversations.length, artifacts: res.artifacts.length, projects: res.projects.length,
    design: res.design.length, memory: res.memory.length, people: res.people.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const base = '#/search?q=' + encodeURIComponent(q) + (deep ? '&deep=1' : '');
  $('#search-tabs').innerHTML = SEARCH_TYPES.map(([k, l]) => `<a class="chip${t === k ? ' on' : ''}" href="${base}&t=${k}">${l} <b>${fmtNum(k === 'all' ? total : counts[k])}</b></a>`).join('');
  const limit = t === 'all' ? 5 : 200;
  const qs = '?q=' + encodeURIComponent(q);
  const sec = (k, title, items, fn) => {
    if (t !== 'all' && t !== k) return '';
    if (!items.length) return t === k ? '<div class="card empty">No matches.</div>' : '';
    return `${t === 'all' ? `<h2 class="section-title">${title} <span class="badge">${fmtNum(items.length)}</span>${items.length > limit ? ` <a class="chip" href="${base}&t=${k}">see all</a>` : ''}</h2>` : ''}
      <div class="card">${items.slice(0, limit).map(fn).join('')}</div>
      ${t !== 'all' && items.length > limit ? `<p class="muted">Showing the first ${limit}. Add more words to narrow it down.</p>` : ''}`;
  };
  const conv = r => {
    const c = r.c;
    const msgs = c.raw.chat_messages || [];
    const m = r.hitIdx >= 0 ? msgs[r.hitIdx] : null;
    const text = m ? (r.hitDeep ? msgDeep(m) : msgProse(m)) : (c.summary || '');
    return `<a class="result" href="#/c/${encodeURIComponent(c.id)}${qs}${m ? '&m=' + encodeURIComponent(m.uuid) : ''}">
      <div class="r-title"><span dir="auto">${esc(c.title || 'Untitled conversation')}</span></div>
      <div class="r-snip" dir="auto">${snippetHtml(text, terms)}</div>
      <div class="r-meta">${avatarHtml(c.owner, 'sm')}<span>${esc(c.owner.name)}</span><span>${esc(fmtDate(c.lastTs))}</span><span>${plural(c.msgCount, 'message')}</span>${r.hitDeep ? '<span class="chip">in a tool call or file</span>' : ''}</div></a>`;
  };
  const art = r => `<a class="result" href="#/a/${encodeURIComponent(r.a.id)}"><div class="r-title"><span dir="auto">${esc(r.a.title)}</span><span class="chip">${esc(r.a.contentType)}</span></div>
    <div class="r-snip" dir="auto">${snippetHtml(r.inContent ? r.a._contentText : [r.a.title, r.a.description, r.a._pageText].join(' — '), terms)}</div>
    <div class="r-meta">${avatarHtml(r.a.owner, 'sm')}<span>${esc(r.a.owner.name)}</span><span>${esc(fmtDate(r.a.updated))}</span>${r.inContent ? '<span class="chip">inside the artifact</span>' : ''}</div></a>`;
  const proj = r => {
    const d = r.x.docs.find(dd => terms.every(tt => (dd.filename + dd.content).toLowerCase().includes(tt)));
    return `<a class="result" href="#/p/${encodeURIComponent(r.x.id)}"><div class="r-title"><span dir="auto">${esc(r.x.name || 'Untitled project')}</span></div>
      <div class="r-snip" dir="auto">${d ? '<b>' + esc(d.filename) + ':</b> ' + snippetHtml(d.content, terms) : snippetHtml(r.x.description || r.x.name, terms)}</div>
      <div class="r-meta">${avatarHtml(r.x.owner, 'sm')}<span>${esc(r.x.owner.name)}</span></div></a>`;
  };
  const des = r => `<a class="result" href="#/d/${encodeURIComponent(r.d.id)}${qs}"><div class="r-title"><span dir="auto">${esc(r.d.title)}</span><span class="chip">✎ ${esc(r.d.project.name)}</span></div>
    <div class="r-snip" dir="auto">${snippetHtml(r.d._text, terms)}</div>
    <div class="r-meta">${avatarHtml(r.d.owner, 'sm')}<span>${esc(r.d.owner.name)}</span><span>${esc(fmtDate(r.d.lastTs))}</span></div></a>`;
  const mem = r => {
    const f = r.mem.files.find(ff => terms.every(tt => ff.content.toLowerCase().includes(tt)));
    return `<a class="result" href="#/memory/${encodeURIComponent(r.mem.id)}"><div class="r-title">${avatarHtml(r.mem.owner, 'sm')}<span>${esc(r.mem.owner.name)}</span>${f ? `<span class="chip mono">${esc(f.path)}</span>` : ''}</div>
      <div class="r-snip" dir="auto">${snippetHtml(f ? f.body : r.mem._text, terms)}</div></a>`;
  };
  const ppl = r => `<a class="result" href="#/person/${encodeURIComponent(r.p.id)}"><div class="r-title">${avatarHtml(r.p, 'sm')}<span>${esc(r.p.name)}</span></div><div class="r-meta"><span>${esc(r.p.email || '')}</span><span>${plural(r.p.total(), 'item')}</span></div></a>`;
  $('#search-results').innerHTML = (total ? '' : `<div class="card empty">Nothing found for “${esc(q)}”.${deep ? '' : ' Try ticking “Deep search”.'}</div>`) +
    sec('people', 'People', res.people, ppl) +
    sec('conversations', 'Conversations', res.conversations, conv) +
    sec('artifacts', 'Artifacts & pages', res.artifacts, art) +
    sec('projects', 'Projects', res.projects, proj) +
    sec('design', 'Design chats', res.design, des) +
    sec('memory', 'Memory', res.memory, mem);
}

/* ======================= About ======================= */

function viewAbout() {
  const m = DB.manifests.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
  const people = Array.from(DB.people.values()).filter(p => !p.system);
  return `<div class="page narrow"><div class="page-head"><div class="grow"><h1>About this export</h1></div></div>
    ${m ? `<div class="card card-pad"><dl class="kv"><dt>Exported</dt><dd>${esc(fmtDateTime(m.createdAt))}</dd><dt>Files in export</dt><dd>${esc(m.totalFiles)} (${m.files.map(f => esc(f.filename)).join(', ')})</dd></dl></div>` : ''}
    <h2 class="section-title">What was loaded</h2>
    <div class="table-wrap"><table class="list"><thead><tr><th>Source</th><th class="num">Size</th><th class="num">Entries</th><th>Status</th></tr></thead><tbody>
      ${DB.sources.map(s => `<tr><td class="mono">${esc(s.name)}</td><td class="num">${s.size ? fmtBytes(s.size) : ''}</td><td class="num">${fmtNum(s.entries || 0)}</td><td>${s.error ? `<span class="chip err">${esc(s.error)}</span>` : '<span class="chip ok">ok</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    ${m ? missingParts(m) : ''}
    <h2 class="section-title">Counts</h2>
    <div class="card card-pad"><dl class="kv">
      <dt>People</dt><dd>${fmtNum(people.length)} (${fmtNum(people.filter(p => p.known).length)} in users.json, ${fmtNum(people.filter(p => !p.known).length)} only seen in data)</dd>
      <dt>Conversations</dt><dd>${fmtNum(DB.conversations.length)} · ${fmtNum(DB.conversations.reduce((a, c) => a + c.msgCount, 0))} messages · ${fmtNum(DB.conversations.filter(c => c.empty).length)} without content</dd>
      <dt>Artifacts</dt><dd>${fmtNum(DB.artifacts.length)} · ${fmtNum(DB.artifacts.reduce((a, x) => a + x.versions.length, 0))} versions</dd>
      <dt>Projects</dt><dd>${fmtNum(DB.projects.length)}</dd>
      <dt>Design chats</dt><dd>${fmtNum(DB.designChats.length)}</dd>
      <dt>Memory</dt><dd>${fmtNum(DB.memories.length)} people</dd>
    </dl></div>
    ${DB.warnings.length ? `<h2 class="section-title">Problems</h2><div class="card card-pad"><ul>${DB.warnings.map(w => `<li class="mono" style="font-size:12.5px">${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${DB.ignored.length ? `<details class="card summary-box" style="margin-top:18px"><summary>${fmtNum(DB.ignored.length)} files were not recognised and were skipped</summary><div style="padding:0 16px 14px"><ul class="mono" style="font-size:12px">${DB.ignored.slice(0, 200).map(p => `<li>${esc(p)}</li>`).join('')}</ul>${DB.ignored.length > 200 ? '<p class="faint">…</p>' : ''}</div></details>` : ''}
    <h2 class="section-title">Good to know</h2>
    <div class="card card-pad md"><ul>
      <li>The export contains text only. Uploaded images, PDFs and screenshots appear as names, not files.</li>
      <li>Conversations are not linked to projects in the export, so a project page cannot list its chats.</li>
      <li>Artifacts may keep only their latest 20 versions. Some artifacts use claude.ai features (shared data, hosted images) that do not work offline.</li>
      <li>Everything stays in this tab. Reloading the page forgets the data${window.showOpenFilePicker ? '; use “Reopen last export” on the start screen to load it again quickly' : ', so you pick the files again'}.</li>
    </ul></div>
  </div>`;
}

// A manifest part counts as loaded if its zip opened, or (for unzipped folders) if its kind of
// data is present. A zip that failed to open does not count.
// Manifest parts whose data is not loaded.
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

const LINK_LIFETIME = 24 * 3600 * 1000;

/* Download links for export parts, from the manifest. Each link opens in a new tab and uses
 * the person's claude.ai sign-in in this browser; the reader never fetches them itself. */
function manifestDownloadsHtml(m, files) {
  const expires = m.createdAt ? m.createdAt + LINK_LIFETIME : 0;
  const expired = expires && Date.now() > expires;
  return `<div class="notice${expired ? ' warn' : ''}" style="margin:0 0 10px">
      ${expired
        ? `These download links expired on ${esc(fmtDateTime(expires))} (24 hours after the export was made). Ask for a new export in claude.ai settings to get fresh links.`
        : `Links work until <b>${esc(fmtDateTime(expires))}</b> and may work <b>only once</b>. Be signed in to claude.ai in this browser. When the downloads finish, drop the zips onto this page.`}
    </div>
    <div class="table-wrap"><table class="list"><tbody>${files.map(f => `<tr>
      <td class="mono">${esc(f.filename)}</td><td class="muted">${esc(f.category || '')}</td>
      <td class="right">${f.url && !expired
        ? `<a class="btn small primary" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Download</a>`
        : `<span class="chip">${expired ? 'expired' : 'no link'}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
}

function missingParts(m) {
  const missing = missingFiles(m);
  if (!missing.length) return '';
  return `<div class="notice warn" style="margin-top:12px">Not loaded: ${missing.map(f => `<b>${esc(f.filename)}</b>`).join(', ')}. Their data is missing from this view. Download them below, then drop them in with the other files.</div>
    <h2 class="section-title">Download the missing parts</h2>${manifestDownloadsHtml(m, missing)}`;
}

/* ======================= Per-person export ======================= */

async function exportPerson(id, btn) {
  const p = DB.people.get(id);
  if (!p) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  const versionsTotal = p.artifacts.reduce((a, x) => a + x.versions.length, 0);
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Download data">
    <h2>Download ${esc(p.name)}’s data</h2>
    <p class="muted" style="margin:0 0 10px;font-size:14px">One .zip with everything linked to this person: conversations as readable Markdown plus the original JSON, and the original files for everything else.</p>
    <ul style="margin:0 0 10px;padding-left:20px;font-size:14px">
      <li>${plural(p.conversations.length, 'conversation')}</li><li>${plural(p.artifacts.length, 'artifact')}</li>
      <li>${plural(p.projects.length, 'project')}</li><li>${plural(p.designChats.length, 'design chat')}</li>
      <li>${p.memory ? 'Memory (' + plural(p.memory.files.length, 'file') + ')' : 'No memory'}</li><li>${plural(p.comments.length, 'comment')}</li>
    </ul>
    <label class="check"><input type="checkbox" id="exp-allv"> Include every artifact version (${fmtNum(versionsTotal)} in total; can be large). Otherwise only the current version.</label>
    <div id="exp-progress" class="muted" style="font-size:13.5px;margin-top:8px"></div>
    <div class="actions"><button class="btn" type="button" id="exp-cancel">Cancel</button><button class="btn primary" type="button" id="exp-go">Download .zip</button></div>
  </div>`;
  document.body.appendChild(back);
  let cancelled = false;
  const close = () => { cancelled = true; back.remove(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  $('#exp-cancel', back).addEventListener('click', close);
  $('#exp-go', back).addEventListener('click', async () => {
    const go = $('#exp-go', back);
    go.disabled = true;
    const prog = $('#exp-progress', back);
    try {
      const blob = await buildPersonZip(p, { allVersions: $('#exp-allv', back).checked }, msg => { prog.textContent = msg; }, () => cancelled);
      if (cancelled) return;
      downloadBlob(blob, safeFilename(p.name, 'person') + ' - Claude data.zip');
      close();
    } catch (err) {
      console.error(err);
      prog.textContent = 'Failed: ' + (err.message || err);
      go.disabled = false;
    }
  });
}

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
    const skip = rel => /\/artifact-type\/|\/SKILL\.md$/.test(rel);
    for (const [rel, node] of a.files) {
      if (skip(rel)) continue;
      const vm = /^versions\/([^/.]+(?:-[0-9a-f]+)?)/.exec(rel);
      if (vm && !opts.allVersions && vm[1] !== a.activeVersion) continue;
      z.add(base + rel, await node.bytes());
    }
    progress(`Artifacts ${++i} / ${p.artifacts.length}`);
  }
  progress('Packing…');
  return z.blob();
}

/* ======================= Shared actions ======================= */

function handleViewAction(action, el, e) {
  if (typeof convAction === 'function' && convAction(action, el, e)) return;
  if (typeof artAction === 'function' && artAction(action, el, e)) return;
  switch (action) {
    case 'search-deep': {
      const q = App.route.query.q || '';
      navigate('#/search?q=' + encodeURIComponent(q) + (el.checked ? '&deep=1' : '') + (App.route.query.t ? '&t=' + App.route.query.t : ''), true);
      break;
    }
    case 'design-dl': {
      const d = DB.designById.get(el.dataset.id);
      if (d) downloadBlob(new Blob([JSON.stringify(d.raw, null, 2)], { type: 'application/json' }), safeFilename(d.project.name + ' ' + d.id.slice(0, 8), 'design-chat') + '.json');
      break;
    }
    case 'mem-expand': $$('.mem-file').forEach(d => { d.open = true; }); break;
  }
}
