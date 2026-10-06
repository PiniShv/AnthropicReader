/* Artifacts & pages: list, artifact page, version viewer and Docs pages. Previews are built in preview.js. */
'use strict';

const VIS_LABEL = { private: 'Private', organization: 'Whole team', invited: 'Shared with invited', agent: 'Agent' };
// Descriptions that are the artifact type's own blurb, not something the author wrote.
const TYPE_BLURB = /^(Living docs —|Design canvas for websites|Presentation decks: 16:9 slides)/;

function visChip(a) {
  const v = a.visibility || 'private';
  const sw = a.sharedWith;
  const extra = sw ? ` · ${sw.viewers || 0} viewer${sw.viewers === 1 ? '' : 's'}${sw.editors ? `, ${sw.editors} editor${sw.editors === 1 ? '' : 's'}` : ''}` : '';
  return `<span class="chip${v === 'private' ? '' : ' on'}" title="Visibility">${esc(VIS_LABEL[v] || v)}${esc(extra)}</span>`;
}

function artifactTable(list, key, showOwner, facet) {
  const columns = [
    {
      id: 'title', label: 'Title', cls: 'title', link: true, asc: true, sortVal: a => artifactTitle(a).toLowerCase(),
      html: a => `<div dir="auto">${esc(artifactTitle(a))}</div>${a.description && !TYPE_BLURB.test(a.description) && a.description !== artifactTitle(a) ? `<div class="snip" dir="auto">${esc(truncate(a.description, 200))}</div>` : ''}
        <div class="row wrap" style="margin-top:5px;gap:4px"><span class="chip">${esc(a.contentType)}</span>${visChip(a)}${a.commentCount ? `<span class="chip">🗨 ${a.commentCount}</span>` : ''}${a.mentionedIn && a.mentionedIn.length ? `<span class="chip" title="Linked from conversations">💬 ${a.mentionedIn.length}</span>` : ''}</div>`,
    },
  ];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('versions', 'Versions', a => a.versions.length));
  columns.push(COL.date('updated', 'Updated', a => a.updated));
  return tableHtml({
    key, rows: list, columns, sort: 'updated', dir: -1, noun: 'artifact', facet,
    href: a => '#/a/' + encodeURIComponent(a.id),
    text: a => [artifactTitle(a), a.description, a.contentType, a.kind, a.visibility, VIS_LABEL[a.visibility], a.owner && a.owner.name, a.owner && a.owner.email, a.id, ...a.versions.map(v => v.title)].join(' '),
    placeholder: 'Filter: title, type (slides, doc, html), visibility, person…',
    empty: 'No artifacts.',
  });
}

function viewArtifacts() {
  const s = focusScope();
  const list = s.artifacts;
  return `<div class="page">
    <div class="page-head"><div class="grow"><h1>Artifacts & pages</h1>
      <div class="sub">${s.person ? `<span>Only ${personLink(s.person)}’s</span>` : ''}<span>${plural(list.length, 'artifact')}</span>${!DB.artifacts.length ? '<span>Load the <b>frames-*.zip</b> files to see artifacts.</span>' : ''}</div></div></div>
    ${artifactTable(list, 'art-' + s.key, !s.person, { of: a => a.contentType })}
  </div>`;
}

/* ---------- Artifact page ---------- */

function viewArtifact(id, vid) {
  const a = DB.artifactById.get(id);
  if (!a) return notFound('No artifact with this id in the loaded files.');
  const p = a.owner;
  const versions = a.versions;
  const selected = vid && versions.some(v => v.id === vid) ? vid : a.activeVersion;
  const sel = versions.find(v => v.id === selected);
  const isPage = a.kind === 'page';

  // Design boards: the board picker and links between boards. The URL keeps its version part as is.
  const pickBoard = board => navigate('#/a/' + encodeURIComponent(id) + (vid ? '/' + encodeURIComponent(vid) : '') + '?board=' + encodeURIComponent(board), true);
  after(() => {
    if (isPage) return drawPage(a);
    addEventListener('message', e => {
      const f = document.getElementById('art-frame');
      if (!f || e.source !== f.contentWindow || !e.data || typeof e.data.cerBoard !== 'string') return;
      pickBoard(e.data.cerBoard);
    }, { signal: VIEW.ac.signal });
    return drawVersion(a, selected, App.route.query.view || 'preview', pickBoard);
  });

  const versionList = versions.map(v => {
    const has = isPage || (a.vfiles && a.vfiles.has(v.id));
    const desc = v.description && !TYPE_BLURB.test(v.description) && v.description !== v.title ? decodeEntities(v.description) : '';
    return `<li class="${v.id === selected ? 'sel' : ''}${has ? '' : ' missing'}" ${has && !isPage ? on(() => navigate('#/a/' + encodeURIComponent(a.id) + '/' + encodeURIComponent(v.id), true)) : ''} title="${esc(v.id)}">
      <div class="vt" dir="auto">${esc(v.title || 'Untitled')}${v.id === a.activeVersion ? ' <span class="chip ok" style="font-size:11px">current</span>' : ''}</div>
      <div class="vd">${esc(fmtDateTime(v.created))}${!isPage ? ' · ' + esc(versionInfo(a, v.id).type) : ''}</div>
      ${desc ? `<div class="vd" dir="auto">${esc(truncate(desc, 140))}</div>` : ''}
    </li>`;
  }).join('');

  return `<div class="page">
    <div class="crumbs"><a href="#/artifacts">Artifacts</a><span>›</span>${p && !p.system ? `${personLink(p)}<span>›</span>` : ''}<span class="ellipsis" style="max-width:420px" dir="auto">${esc(artifactTitle(a))}</span></div>
    <div class="page-head">
      <div class="grow">
        <h1 dir="auto">${esc(artifactTitle(a))}</h1>
        <div class="sub">
          ${p && !p.system ? `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)} ${unknownBadge(p)}</span>` : (a.createdByAgent ? '<span class="chip">Made by an agent (no owner)</span>' : '')}
          <span class="chip">${esc(a.contentType)}</span>${visChip(a)}
          <span>Updated ${esc(fmtDateTime(a.updated))}</span>
          <span>${plural(versions.length, 'version')}${versions.length >= 20 ? ' <span class="faint" title="The export seems to keep only the latest 20 versions">(older ones may be cut)</span>' : ''}</span>
          <a href="https://claude.ai/code/artifact/${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer" title="Opens on claude.ai (needs access)">claude.ai ↗</a>
        </div>
        ${sel && sel.description && !TYPE_BLURB.test(sel.description) && sel.description !== sel.title ? `<p class="muted" dir="auto" style="margin:8px 0 0">${esc(decodeEntities(sel.description))}</p>` : ''}
      </div>
    </div>
    <div class="viewer">
      <div id="art-main">${isPage ? '' : `<div class="frame-box"><div class="frame-bar"><span class="muted">Loading…</span></div></div>`}</div>
      <aside>
        ${versions.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Versions</h2><ul class="version-list">${versionList}</ul>${isPage ? '<p class="faint" style="font-size:12.5px;margin:8px 0 0">Docs keep only the current text in the export; older versions are listed for reference.</p>' : ''}</div>` : ''}
        ${a.mentionedIn && a.mentionedIn.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Mentioned in</h2>${a.mentionedIn.map(c => `<div style="padding:4px 0"><a href="#/c/${encodeURIComponent(c.id)}" dir="auto">${esc(c.title || 'Untitled conversation')}</a> <span class="faint" style="font-size:12.5px">${esc(fmtDate(c.lastTs))}</span></div>`).join('')}</div>` : ''}
        ${!isPage && a.threads && a.threads.length ? `<div class="card card-pad side-card"><h2 style="margin-bottom:8px">Comments <span class="badge">${a.commentCount}</span></h2>${threadCommentsHtml(a)}</div>` : ''}
        <div class="card card-pad side-card"><dl class="kv" style="font-size:13px"><dt>Id</dt><dd class="mono">${esc(a.id)}</dd><dt>Kind</dt><dd>${esc(a.kind)}</dd><dt>Files</dt><dd>${fmtNum(a.files.size)}</dd></dl></div>
      </aside>
    </div>
  </div>`;
}

/* ---------- Versions ---------- */

async function drawVersion(a, vid, view, pickBoard) {
  const box = $('#art-main');
  const info = versionInfo(a, vid);
  const board = App.route.query.board || '';
  const tabs = [['preview', 'Preview'], ['source', 'Source'], ['files', 'Files']];
  const bar = (extra) => `<div class="frame-bar">
      ${tabs.map(([k, l]) => `<button class="btn small${view === k ? ' primary' : ''}" type="button" ${on(() => navigate('#/a/' + encodeURIComponent(a.id) + '/' + encodeURIComponent(vid) + '?view=' + k, true))}>${l}</button>`).join('')}
      <span class="grow"></span>${extra || ''}
      <button class="btn small" type="button" ${on(() => openPreviewTab(a, vid))} title="Open the preview in a new tab">↗ New tab</button>
      <button class="btn small" type="button" ${on(el => el.closest('.frame-box').classList.toggle('full'))} title="Full screen (Esc to leave)">⤢</button>
      <button class="btn small" type="button" ${on(() => downloadVersion(a, vid))} title="Download this version">⇩</button>
    </div>`;
  box.innerHTML = `<div class="frame-box">${bar()}<div class="empty">Opening ${esc(info.type)}…</div></div>`;
  const { signal } = VIEW.ac;
  try {
    if (!info.slot) { box.innerHTML = `<div class="frame-box">${bar()}<div class="empty">This version has no files in the loaded export.</div></div>`; return; }
    if (view === 'files') {
      box.innerHTML = `<div class="frame-box">${bar()}<div class="card-pad">${versionFilesHtml(vid, info)}</div></div>`;
      return;
    }
    if (view === 'source') {
      const src = await versionSource(info);
      if (signal.aborted) return;
      box.innerHTML = `<div class="frame-box">${bar()}<div class="card-pad">${src != null ? preHtml(src) : '<p class="faint">No single source file. See the Files tab.</p>'}</div></div>`;
      return;
    }
    const built = await getBuilt(a, vid, info, board);
    if (signal.aborted) return;
    const notes = built.notes.length ? `<div class="notice" style="border-radius:0;border-width:0 0 1px">${built.notes.map(esc).join('<br>')}</div>` : '';
    if (built.html == null) {
      box.innerHTML = `<div class="frame-box">${bar()}${notes}<div class="empty">${esc(built.empty || 'Nothing to preview.')}</div></div>`;
      return;
    }
    const picker = built.boards ? `<select class="input" style="padding:3px 8px;font-size:13px" ${on.change(el => pickBoard(el.value))} aria-label="Board">${built.boards.list.map(b => `<option value="${esc(b.file)}"${b.file === built.boards.current ? ' selected' : ''}>${esc(b.title)}</option>`).join('')}</select>` : '';
    box.innerHTML = `<div class="frame-box" id="art-frame-box">${bar(picker)}${notes}<iframe class="preview" id="art-frame" sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer" title="${esc(artifactTitle(a))}"></iframe></div>`;
    box.querySelector('iframe').srcdoc = built.html;
  } catch (err) {
    console.error(err);
    if (signal.aborted) return;
    box.innerHTML = `<div class="frame-box">${bar()}<div class="notice warn">Could not open this version: ${esc(err.message || err)}</div></div>`;
  }
}

function versionFilesHtml(vid, info) {
  const s = info.slot;
  const rows = [];
  if (s.single) rows.push(['versions/' + vid + '.html', s.single]);
  for (const [p, node] of s.folder) rows.push([p, node]);
  if (s.manifest) rows.push(['versions/' + vid + '.files.json', s.manifest]);
  const shown = rows.filter(([p]) => !isPlumbing(p));
  const hidden = rows.length - shown.length;
  const li = ([p, node]) => `<tr><td class="mono" dir="auto">${esc(p)}</td><td class="num">${fmtBytes(node.size)}</td><td class="right"><button class="btn small" type="button" ${on(() => openArtifactFile(p, node))}>Open</button></td></tr>`;
  return `<table class="list" style="font-size:13px"><tbody>${shown.map(li).join('')}</tbody></table>
    ${hidden ? `<details class="blk" style="margin-top:10px"><summary><span class="lbl">${hidden} platform files</span><span class="desc">the app runtime and instructions for Claude, not user content</span></summary><div class="blk-body"><table class="list" style="font-size:13px"><tbody>${rows.filter(([p]) => isPlumbing(p)).map(li).join('')}</tbody></table></div></details>` : ''}
    <div id="art-file-view" style="margin-top:12px"></div>`;
}

// One file of a version, shown below the Files list.
async function openArtifactFile(path, node) {
  const box = $('#art-file-view');
  if (!box) return;
  const { signal } = VIEW.ac;
  const ext = fileExt(path);
  box.innerHTML = '<p class="muted">Opening…</p>';
  const head = `<div class="row" style="margin-bottom:8px"><b class="mono" dir="auto">${esc(path)}</b><span class="grow"></span><button class="btn small" type="button" ${on(() => node.blob(mimeFor(path)).then(b => downloadBlob(b, path.split('/').pop())))}>Download</button></div>`;
  if (/^(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/.test(ext)) {
    const src = await dataUrl(node, path);
    if (signal.aborted) return;
    box.innerHTML = head + `<img alt="" style="max-width:100%;border:1px solid var(--border);border-radius:6px" src="${src}">`;
  } else if (/^(mp4|webm)$/.test(ext)) {
    const blob = await node.blob(mimeFor(path));
    if (signal.aborted) return;
    box.innerHTML = head + `<video controls style="max-width:100%" src="${URL.createObjectURL(blob)}"></video>`;
  } else if (isTextExt(ext) || node.size < 2e6) {
    const t = await node.text();
    if (signal.aborted) return;
    box.innerHTML = head + (ext === 'md' ? mdBlock(t, { frontmatter: true }) : preHtml(ext === 'json' ? prettyMaybeJson(t) : t));
  } else {
    box.innerHTML = head + '<p class="muted">Binary file; use Download.</p>';
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- Pages (Claude Docs) ---------- */

async function drawPage(a) {
  const box = $('#art-main');
  if (!a.pageNode) { box.innerHTML = '<div class="card empty">This doc has no page.md in the loaded files.</div>'; return; }
  const { signal } = VIEW.ac;
  let md;
  try {
    md = await a.pageNode.text();
  } catch (err) {
    // For example a damaged zip entry: say so, instead of leaving the panel empty.
    console.error(err);
    if (!signal.aborted) box.innerHTML = `<div class="notice warn">Could not open this doc: ${esc(err.message || err)}</div>`;
    return;
  }
  if (signal.aborted) return;
  const tabs = splitTabs(md);
  const want = App.route.query.tab;
  const idx = Math.max(0, tabs.findIndex(t => t.title === want));
  const tab = tabs[idx] || { title: '', body: md };
  const threads = (a.comments || []).filter(t => !t.tab || t.tab === tab.title || tabs.length === 1);
  const body = tab.body.replace(/!\[([^\]]*)\]\(attachment\)/g, (all, alt) => `*[image not in export${alt ? ': ' + alt : ''}]*`);
  box.innerHTML = `<div class="card">
    ${tabs.length > 1 ? `<div class="tabs" style="margin:0;padding:0 12px">${tabs.map((t, i) => `<button class="tab${i === idx ? ' active' : ''}" type="button" ${on(() => navigate('#/a/' + encodeURIComponent(a.id) + '?tab=' + encodeURIComponent(t.title), true))} dir="auto">${esc(t.title || 'Untitled')}</button>`).join('')}</div>` : ''}
    <div class="card-pad" id="page-body">${mdBlock(body)}</div>
    <div class="frame-bar" style="border-top:1px solid var(--border);border-bottom:0">
      <button class="btn small" type="button" ${on(() => a.pageNode.blob('text/markdown').then(b => downloadBlob(b, safeFilename(artifactTitle(a), 'page') + '.md')))}>Download page.md</button>
      <button class="btn small" type="button" ${on(() => a.pageNode.text().then(copyText))}>Copy Markdown</button>
    </div>
  </div>
  ${(a.comments || []).length ? `<h2 class="section-title">Comments${tabs.length > 1 ? ' on this tab' : ''} <span class="badge">${threads.reduce((n, t) => n + (t.comments || []).length, 0)}</span></h2><div class="card card-pad">${threads.length ? pageCommentsHtml(a, threads) : '<p class="faint">No comments on this tab.</p>'}</div>` : ''}`;
  // Highlight the text each comment thread points at.
  const quotes = threads.map(t => t.quoted_text).filter(q => q && q.replace(/\s/g, '').length >= 3);
  if (quotes.length) highlightIn(box.querySelector('#page-body'), quotes, { firstOnly: true });
}

function splitTabs(md) {
  const re = /^<!--\s*tab:\s*(.*?)\s*-->\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(md))) marks.push({ title: m[1], start: m.index, end: m.index + m[0].length });
  if (!marks.length) return [{ title: '', body: md }];
  return marks.map((mk, i) => ({ title: mk.title, body: md.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : md.length).trim() }));
}

function pageCommentsHtml(a, threads) {
  return threads.map(t => `<div class="comment">
    <div class="row wrap" style="font-size:12.5px;color:var(--muted)">${t.tab ? `<span class="chip" dir="auto">${esc(t.tab)}</span>` : ''}${t.resolved ? '<span class="chip ok">resolved</span>' : ''}</div>
    ${t.quoted_text ? `<div class="quote" dir="auto">“${esc(t.quoted_text)}”</div>` : ''}
    ${(t.comments || []).map(c => {
      const au = c.author && c.author.uuid ? DB.people.get(c.author.uuid) : null;
      const who = c.posted_by_agent ? `Claude <span class="faint">for ${au ? esc(au.name) : 'the owner'}</span>` : (au ? personLink(au) : '<span class="faint">Unknown</span>');
      return `<div class="reply"><div style="font-size:13px"><b>${who}</b> <span class="faint">${esc(fmtDateTime(c.created_at))}</span></div><div dir="auto">${mdToHtml(c.body || '')}</div></div>`;
    }).join('')}
  </div>`).join('') || '<p class="faint">No comments.</p>';
}

function threadCommentsHtml(a) {
  return a.threadView.map(({ th: t, comments }) => `<div class="comment">
    <div style="font-size:12.5px" class="row wrap">${t.resolved ? '<span class="chip ok">resolved</span>' : '<span class="chip">open</span>'}<span class="faint">${esc(fmtDateTime(t.created_at))}</span></div>
    ${comments.map(c => {
      const who = c.author_role === 'assistant' ? 'Claude'
        : c.author_role === 'page' ? 'Doc comment'
        : c.author_is_artifact_owner ? (a.owner && !a.owner.system ? esc(a.owner.name) : 'Owner')
        : 'Commenter #' + esc(c.author_index);
      const text = String(c.text || '').replace(/<mention:[^>]+>/g, '@someone');
      return `<div class="reply"><div style="font-size:13px"><b>${who}</b> <span class="faint">${esc(fmtDateTime(c.created_at))}</span>${c.to_claude_at ? ' <span class="chip" style="font-size:11px">sent to Claude</span>' : ''}</div><div dir="auto">${mdToHtml(text)}</div></div>`;
    }).join('')}
  </div>`).join('');
}

/* ---------- Artifact actions ---------- */

// Open the window first (inside the click, so pop-up blockers allow it), then fill it.
// The artifact runs inside a sandboxed frame there too, so it cannot reach this reader.
async function openPreviewTab(a, vid) {
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked. Allow pop-ups for this page, or use Download.'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(artifactTitle(a))}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block;font-family:system-ui,sans-serif}</style></head><body><p style="padding:20px">Opening ${esc(artifactTitle(a))}…</p></body></html>`);
  w.document.close();
  try {
    const built = await getBuilt(a, vid, versionInfo(a, vid), App.route.query.board || '');
    if (built.html == null) { w.document.body.innerHTML = '<p style="padding:20px">Nothing to preview for this version.</p>'; return; }
    w.document.body.innerHTML = '<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe>';
    w.document.querySelector('iframe').srcdoc = built.html;
  } catch (err) {
    w.document.body.textContent = 'Could not open: ' + (err.message || err);
  }
}

async function downloadVersion(a, vid) {
  const info = versionInfo(a, vid);
  const s = info.slot;
  if (!s) return;
  if (s.single) { downloadBlob(await s.single.blob('text/html'), safeFilename(artifactTitle(a), 'artifact') + '.html'); return; }
  const zip = new ZipWriter();
  for (const [p, node] of s.folder) zip.add(p, await node.bytes());
  if (s.manifest) zip.add('files.json', await s.manifest.bytes());
  downloadBlob(zip.blob(), safeFilename(artifactTitle(a), 'artifact') + ' (' + vid + ').zip');
}
