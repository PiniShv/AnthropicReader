/* Projects, memory, the search page, about, the per-person download dialog. */
'use strict';

/* ======================= Projects ======================= */

function projectTable(list, key, showOwner) {
  const columns = [{
    id: 'name', label: 'Project', cls: 'title', link: true, asc: true, sortVal: x => (x.name || '').toLowerCase(),
    html: x => `<div dir="auto">${x.name ? esc(x.name) : '<i class="faint">Untitled project</i>'}</div>
      ${x.description ? `<div class="snip" dir="auto">${esc(truncate(x.description, 200))}</div>` : ''}
      <div class="row wrap" style="margin-top:5px;gap:4px">${x.isStarter ? '<span class="chip">Starter</span>' : ''}${!x.isPrivate ? '<span class="chip on">Shared</span>' : ''}${x.memoryRefs.length ? '<span class="chip">🧠 memory</span>' : ''}</div>`,
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
  const s = focusScope();
  const list = s.projects;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Projects</h1>
    <div class="sub">${s.person ? `<span>Only ${personLink(s.person)}’s</span>` : ''}<span>${plural(list.length, 'project')}</span><span>${fmtNum(list.reduce((a, x) => a + x.docs.length, 0))} docs</span></div></div></div>
    <p class="muted" style="font-size:13.5px;margin:-6px 0 14px">The export does not say which conversations belong to a project, so chats are not listed here.</p>
    ${projectTable(list, 'proj-' + s.key, !s.person)}</div>`;
}

function viewProject(id) {
  const x = DB.projectById.get(id);
  if (!x) return notFound('No project with this id in the loaded export.');
  const p = x.owner;
  const pm = x.memoryRefs;
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
  const parts = d.filename.split('/');
  const file = parts.pop();
  return blk({ summary: `<span class="lbl" dir="auto">${esc(file)}</span>${parts.length ? `<span class="desc faint mono">${esc(parts.join('/'))}/</span>` : ''}<span class="meta">${fmtBytes(d.content.length)}</span>` }, () => {
    const dl = `<div class="row" style="margin-bottom:8px"><span class="faint" style="font-size:12.5px">Added ${esc(fmtDateTime(d.created))}</span><span class="grow"></span><button class="btn small" type="button" ${on(() => downloadText(d.filename.split('/').pop(), d.content))}>Download</button></div>`;
    if (ext === 'md' || ext === 'markdown' || ext === 'pptx' || ext === 'docx' || ext === 'pdf') {
      return dl + (ext !== 'md' && ext !== 'markdown' ? `<p class="notice" style="margin:0 0 8px">Text extracted from the ${esc(ext)} file. The original file is not in the export.</p>` : '') + mdBlock(d.content) +
        `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Raw text</span></summary><div class="blk-body">${preHtml(d.content, { wrap: true })}</div></details>`;
    }
    if (ext === 'html' || ext === 'htm') {
      return dl + sandboxFrame(d.content, 520) + `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(d.content)}</div></details>`;
    }
    return dl + preHtml(d.content);
  });
}

/* ======================= Memory ======================= */

function viewMemories() {
  const fp = focusPerson();
  if (fp) {
    return `<div class="page narrow"><div class="page-head"><div class="grow"><h1>Memory</h1><div class="sub"><span>Only ${personLink(fp)}</span></div></div></div>
      ${KIND.memory.personTab(fp)}</div>`;
  }
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Memory</h1>
    <div class="sub"><span>What Claude remembers about each person: ${plural(DB.memories.length, 'person', 'people')}</span></div></div></div>
    ${tableHtml({
      key: 'mem-all', rows: DB.memories, sort: 'updated', dir: -1, noun: 'person', nounPlural: 'people', placeholder: 'Filter by person or memory text…', empty: 'No memory in this export.',
      href: m => '#/memory/' + encodeURIComponent(m.id),
      text: m => [m.owner && m.owner.name, m.owner && m.owner.email, m.conversationsMemory, ...m.projectMemories.map(x => x.text), ...m.files.map(f => f.path + ' ' + f.content)].join(' '),
      columns: [
        { id: 'owner', label: 'Person', asc: true, sortVal: m => m.owner.name.toLowerCase(), html: m => whoCell(m.owner) },
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
  const groupsHtml = keys.map(g => `<h3 class="section-title" style="font-size:14.5px">${esc(label(g))} <span class="badge">${groups.get(g).length}</span></h3>
    <div class="doc-list">${groups.get(g).map(f => memoryFileCard(f, mem, i++)).join('')}</div>`).join('');
  return `
    ${mem.files.length ? `<div class="row wrap" style="margin:4px 0 0"><span class="muted" style="font-size:13.5px">Memory files Claude keeps. Each fact is tagged with where it came from.</span><span class="grow"></span><button class="btn small" type="button" ${on(() => $$('.mem-file').forEach(d => { d.open = true; }))}>Expand all</button></div>${groupsHtml}` : ''}
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
  return blk({
    cls: 'mem-file', id: memSlugId(mem, f.path),
    summary: `<span class="lbl" dir="auto">${esc(title)}</span><span class="desc" dir="auto">${esc(f.meta.description || '')}</span>
      <span class="meta">${sources.map(s => `<span class="chip" style="font-size:11px" title="${esc(SOURCE_HELP[s] || '')}">${esc(s)}</span>`).join(' ')} ${f.updated ? esc(fmtDate(f.updated)) : ''}</span>`,
    body: aliases.length ? `<p class="faint" style="font-size:12.5px;margin:0 0 6px">Also called: ${aliases.map(esc).join(', ')}</p>` : '',
  }, () => (f.body.trim() ? memoryText(f.body, mem) : '<p class="faint">(empty)</p>') + `<details class="blk" style="margin-top:10px"><summary><span class="lbl">Raw file</span><span class="desc mono">${esc(f.path)}</span></summary><div class="blk-body">${preHtml(f.content, { wrap: true })}</div></details>`);
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

/* ======================= Search page ======================= */

// Every search URL is made here, with its parameters in this order. t is not encoded: the app
// writes only type names, and a t typed into the URL is passed on as it is.
const searchHref = ({ q, deep, t }) => '#/search?q=' + encodeURIComponent(q) + (deep ? '&deep=1' : '') + (t ? '&t=' + t : '');

function viewSearch(q, t) {
  const deep = App.route.query.deep === '1';
  // The type as it is in the URL: the default 'all' must not be added to it.
  const urlType = App.route.query.t;
  const s = focusScope();
  after(async () => {
    const box = $('#search-results');
    if (!q.trim()) { box.innerHTML = '<div class="empty">Type in the search box above. Use quotes for exact phrases, e.g. <code>"design system"</code>.</div>'; return; }
    box.innerHTML = '<div class="empty" id="search-progress">Searching…</div>';
    const onProgress = msg => { const p = $('#search-progress'); if (p) p.textContent = msg; };
    const res = await runSearch(q, { deep, scope: s, signal: VIEW.ac.signal, onProgress });
    if (!res) return;
    drawSearchResults(res, q, t, deep);
  });
  return `<div class="page narrow">
    <div class="page-head"><div class="grow"><h1>Search</h1>
      <div class="sub">${s.person ? `<span>Only ${personLink(s.person)}’s data · <a href="#" ${on(() => setFocus(null))}>search everyone</a></span>` : '<span>All people</span>'}</div></div></div>
    <div class="toolbar">
      <label class="row muted" style="font-size:14px"><input type="checkbox" ${on(el => navigate(searchHref({ q, deep: el.checked, t: urlType }), true))}${deep ? ' checked' : ''}> Deep search: also look inside tool calls, thinking, attached files and artifact content (slower the first time)</label>
    </div>
    <div id="search-tabs" class="search-tabs"></div>
    <div id="search-results"></div>
  </div>`;
}

function drawSearchResults(res, q, t, deep) {
  const terms = res.terms;
  // Result lists are keyed like the kinds (res.conversations … res.memory), plus res.people.
  const total = KINDS.reduce((n, k) => n + res[k.key].length, res.people.length);
  const tab = (k, label, n) => `<a class="chip${t === k ? ' on' : ''}" href="${searchHref({ q, deep, t: k })}">${label} <b>${fmtNum(n)}</b></a>`;
  $('#search-tabs').innerHTML = tab('all', 'Everything', total) + KINDS.map(k => tab(k.key, esc(k.searchTab || k.label), res[k.key].length)).join('') + tab('people', 'People', res.people.length);
  const limit = t === 'all' ? 5 : 200;
  const qs = '?q=' + encodeURIComponent(q);
  const sec = (k, title, items, fn) => {
    if (t !== 'all' && t !== k) return '';
    if (!items.length) return t === k ? '<div class="card empty">No matches.</div>' : '';
    return `${t === 'all' ? `<h2 class="section-title">${title} <span class="badge">${fmtNum(items.length)}</span>${items.length > limit ? ` <a class="chip" href="${searchHref({ q, deep, t: k })}">see all</a>` : ''}</h2>` : ''}
      <div class="card">${items.slice(0, limit).map(fn).join('')}</div>
      ${t !== 'all' && items.length > limit ? `<p class="muted">Showing the first ${limit}. Add more words to narrow it down.</p>` : ''}`;
  };
  // Each renderer reads only its hit: { item } plus what runSearch found (see search.js).
  const conv = ({ item: c, hitIdx, hitDeep }) => {
    const msgs = c.raw.chat_messages || [];
    const m = hitIdx >= 0 ? msgs[hitIdx] : null;
    const text = m ? (hitDeep ? msgDeep(m) : msgProse(m)) : (c.summary || '');
    return `<a class="result" href="#/c/${encodeURIComponent(c.id)}${qs}${m ? '&m=' + encodeURIComponent(m.uuid) : ''}">
      <div class="r-title"><span dir="auto">${esc(c.title || 'Untitled conversation')}</span></div>
      <div class="r-snip" dir="auto">${snippetHtml(text, terms)}</div>
      <div class="r-meta">${avatarHtml(c.owner, 'sm')}<span>${esc(c.owner.name)}</span><span>${esc(fmtDate(c.lastTs))}</span><span>${plural(c.msgCount, 'message')}</span>${hitDeep ? '<span class="chip">in a tool call or file</span>' : ''}</div></a>`;
  };
  const art = ({ item: a, text, inContent }) => `<a class="result" href="#/a/${encodeURIComponent(a.id)}"><div class="r-title"><span dir="auto">${esc(artifactTitle(a))}</span><span class="chip">${esc(a.contentType)}</span></div>
    <div class="r-snip" dir="auto">${snippetHtml(text, terms)}</div>
    <div class="r-meta">${avatarHtml(a.owner, 'sm')}<span>${esc(a.owner.name)}</span><span>${esc(fmtDate(a.updated))}</span>${inContent ? '<span class="chip">inside the artifact</span>' : ''}</div></a>`;
  const proj = ({ item: x }) => {
    const d = x.docs.find(dd => terms.every(tt => (dd.filename + dd.content).toLowerCase().includes(tt)));
    return `<a class="result" href="#/p/${encodeURIComponent(x.id)}"><div class="r-title"><span dir="auto">${esc(x.name || 'Untitled project')}</span></div>
      <div class="r-snip" dir="auto">${d ? '<b>' + esc(d.filename) + ':</b> ' + snippetHtml(d.content, terms) : snippetHtml(x.description || x.name, terms)}</div>
      <div class="r-meta">${avatarHtml(x.owner, 'sm')}<span>${esc(x.owner.name)}</span></div></a>`;
  };
  const des = ({ item: d, text }) => `<a class="result" href="#/d/${encodeURIComponent(d.id)}${qs}"><div class="r-title"><span dir="auto">${esc(d.title)}</span><span class="chip">✎ ${esc(d.project.name || 'design project')}</span></div>
    <div class="r-snip" dir="auto">${snippetHtml(text, terms)}</div>
    <div class="r-meta">${avatarHtml(d.owner, 'sm')}<span>${esc(d.owner.name)}</span><span>${esc(fmtDate(d.lastTs))}</span></div></a>`;
  const mem = ({ item: m, text }) => {
    const f = m.files.find(ff => terms.every(tt => ff.content.toLowerCase().includes(tt)));
    return `<a class="result" href="#/memory/${encodeURIComponent(m.id)}"><div class="r-title">${avatarHtml(m.owner, 'sm')}<span>${esc(m.owner.name)}</span>${f ? `<span class="chip mono">${esc(f.path)}</span>` : ''}</div>
      <div class="r-snip" dir="auto">${snippetHtml(f ? f.body : text, terms)}</div></a>`;
  };
  const ppl = ({ item: p }) => `<a class="result" href="#/person/${encodeURIComponent(p.id)}"><div class="r-title">${avatarHtml(p, 'sm')}<span>${esc(p.name)}</span></div><div class="r-meta"><span>${esc(p.email || '')}</span><span>${plural(p.total(), 'item')}</span></div></a>`;
  const resultHtml = { conversations: conv, artifacts: art, projects: proj, design: des, memory: mem };
  $('#search-results').innerHTML = (total ? '' : `<div class="card empty">Nothing found for “${esc(q)}”.${deep ? '' : ' Try ticking “Deep search”.'}</div>`) +
    sec('people', 'People', res.people, ppl) + KINDS.map(k => sec(k.key, esc(k.label), res[k.key], resultHtml[k.key])).join('');
}

/* ======================= About ======================= */

function viewAbout() {
  const m = latestManifest();
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
      <dt>Conversations</dt><dd>${fmtNum(DB.conversations.length)} · ${fmtNum(DB.conversations.reduce((a, c) => a + c.msgCount, 0))} messages · ${fmtNum(DB.conversations.length - withContent(DB.conversations).length)} without content</dd>
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

async function exportPerson(p) {
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
