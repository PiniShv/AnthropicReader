/* Conversations: list, thread view (branches, blocks, tools), Markdown export. */
'use strict';

const CONV_OPTS = { hideEmpty: true, showThinking: true, showTools: true, showSystem: false };
try { Object.assign(CONV_OPTS, JSON.parse(localStorage.getItem('cer-conv-opts') || '{}')); } catch (e) { /* ignore */ }
function saveConvOpts() { try { localStorage.setItem('cer-conv-opts', JSON.stringify(CONV_OPTS)); } catch (e) { /* ignore */ } }

/* ---------- List ---------- */

function convBadges(c) {
  const b = [];
  if (c.empty) b.push('<span class="chip warn" title="The export has no message content for this chat">no content in export</span>');
  if (c.forks) b.push(`<span class="chip" title="Edited or regenerated messages">${c.forks} branch point${c.forks === 1 ? '' : 's'}</span>`);
  if (c.outputCount) b.push(`<span class="chip" title="Files, artifacts or widgets Claude produced">${c.outputCount} output${c.outputCount === 1 ? '' : 's'}</span>`);
  if (c.fileCount) b.push(`<span class="chip" title="Uploaded files">📎 ${c.fileCount}</span>`);
  return b.join(' ');
}

function convTable(list, key, showOwner) {
  const empties = list.filter(c => c.empty).length;
  const rows = CONV_OPTS.hideEmpty ? list.filter(c => !c.empty) : list;
  const columns = [
    {
      id: 'title', label: 'Conversation', cls: 'title', link: true, asc: true, sortVal: c => (c.title || '').toLowerCase(),
      html: c => `<div dir="auto">${c.title ? esc(c.title) : '<span class="faint">Untitled conversation</span>'}${c.titleIsDerived && c.title ? ' <span class="faint" title="No title in export; first message shown">·</span>' : ''}</div>
        ${c.summary ? `<div class="snip" dir="auto">${esc(truncate(oneLine(stripMd(c.summary.replace(/^\*\*Conversation Overview\*\*\s*/i, ''))), 240))}</div>` : ''}
        ${convBadges(c) ? `<div class="row wrap" style="margin-top:5px;gap:4px">${convBadges(c)}</div>` : ''}`,
    },
  ];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('msgs', 'Messages', c => c.msgCount));
  columns.push(Object.assign(COL.date('created', 'Started', c => c.created), { cls: 'date hide-sm' }));
  columns.push(COL.date('last', 'Last message', c => c.lastTs));
  return tableHtml({
    key, rows, columns, sort: 'last', dir: -1, noun: 'conversation',
    href: c => '#/c/' + encodeURIComponent(c.id),
    text: c => [c.title, c.summary, c.owner && c.owner.name, c.owner && c.owner.email, c.id].join(' '),
    placeholder: 'Filter by title, summary or person…',
    empty: 'No conversations.',
    extraToolbar: empties ? `<label class="row muted" style="font-size:14px"><input type="checkbox" data-action="toggle-empty"${CONV_OPTS.hideEmpty ? ' checked' : ''}> Hide ${empties} without content</label>` : '',
  });
}

function viewConversations() {
  const fp = focusPerson();
  const list = fp ? fp.conversations : DB.conversations;
  return `<div class="page">
    <div class="page-head"><div class="grow"><h1>Conversations</h1>
      <div class="sub">${fp ? `<span>Only ${personLink(fp)}’s</span>` : `<span>All people</span>`}<span>${plural(list.filter(c => !c.empty).length, 'conversation')}${list.some(c => c.empty) ? ` <span class="faint">+ ${fmtNum(list.filter(c => c.empty).length)} without content</span>` : ''}</span>
      <span>${fmtNum(list.reduce((a, c) => a + c.msgCount, 0))} messages</span></div></div></div>
    ${convTable(list, 'conv-' + (fp ? fp.id : 'all'), !fp)}
  </div>`;
}

/* ---------- Message tree & branches ---------- */

const BRANCH_CHOICE = new Map();   // convId -> Map(parentId -> chosen child id)

function buildTree(conv) {
  if (conv._tree) return conv._tree;
  const msgs = conv.raw.chat_messages || [];
  const byId = new Map();
  const children = new Map();
  const hasParents = msgs.some(m => m.parent_message_uuid);
  msgs.forEach((m, i) => { byId.set(m.uuid, { m, i }); });
  // newest[uuid] = highest array index anywhere in that message's subtree.
  const newest = new Map();
  if (hasParents) {
    for (const m of msgs) {
      let p = m.parent_message_uuid;
      if (!p || !byId.has(p)) p = ROOT_PARENT;
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(m);
    }
    // Children always come after their parent in the array, so a reverse pass is enough.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      let best = i;
      for (const k of (children.get(m.uuid) || [])) best = Math.max(best, newest.get(k.uuid) || 0);
      newest.set(m.uuid, best);
    }
  }
  conv._tree = { byId, children, linear: !hasParents, msgs, newest };
  return conv._tree;
}

// The visible path: from the root, at each fork take the chosen child, else the child whose
// branch holds the newest message (the last array element is always the current leaf).
function currentPath(conv) {
  const t = buildTree(conv);
  if (t.linear) return t.msgs.slice();
  const choice = BRANCH_CHOICE.get(conv.id) || new Map();
  const path = [];
  let cur = ROOT_PARENT;
  const seen = new Set();
  for (;;) {
    const kids = t.children.get(cur);
    if (!kids || !kids.length) break;
    const chosenId = choice.get(cur);
    const next = kids.find(k => k.uuid === chosenId) ||
      kids.reduce((a, b) => ((t.newest.get(b.uuid) || 0) > (t.newest.get(a.uuid) || 0) ? b : a));
    if (seen.has(next.uuid)) break;
    seen.add(next.uuid);
    path.push(next);
    cur = next.uuid;
  }
  return path;
}

// Make sure a message (e.g. a search hit on another branch) is on the visible path.
function selectBranchFor(conv, msgId) {
  const t = buildTree(conv);
  if (t.linear || !t.byId.has(msgId)) return;
  const choice = BRANCH_CHOICE.get(conv.id) || new Map();
  let cur = t.byId.get(msgId).m;
  const guard = new Set();
  while (cur && !guard.has(cur.uuid)) {
    guard.add(cur.uuid);
    const p = cur.parent_message_uuid && t.byId.has(cur.parent_message_uuid) ? cur.parent_message_uuid : ROOT_PARENT;
    choice.set(p, cur.uuid);
    if (p === ROOT_PARENT) break;
    cur = t.byId.get(p).m;
  }
  BRANCH_CHOICE.set(conv.id, choice);
}

function siblingsOf(conv, m) {
  const t = buildTree(conv);
  if (t.linear) return [m];
  const p = m.parent_message_uuid && t.byId.has(m.parent_message_uuid) ? m.parent_message_uuid : ROOT_PARENT;
  return t.children.get(p) || [m];
}

/* ---------- Conversation view ---------- */

function viewConversation(id) {
  const conv = DB.convById.get(id);
  if (!conv) return notFound('No conversation with this id in the loaded export.');
  const q = App.route.query.q || '';
  const target = App.route.query.m || '';
  if (target) selectBranchFor(conv, target);
  const p = conv.owner;
  const totalMsgs = conv.msgCount;
  const path = currentPath(conv);
  const offBranch = totalMsgs - path.length;
  const outputs = collectOutputs(conv);

  after(() => {
    drawThread(conv, { q, target });
    // drawThread runs again on branch switches, so the sticky toolbar is wired here, once.
    const main = $('#main'), tb = $('#conv-toolbar');
    if (tb) main.addEventListener('scroll', () => tb.classList.toggle('stuck', main.scrollTop > 120), { passive: true, signal: VIEW.ac.signal });
  });

  return `<div class="page narrow">
    <div class="crumbs"><a href="#/conversations">Conversations</a><span>›</span>${p && !p.system ? `${personLink(p)}<span>›</span>` : ''}<span class="ellipsis" style="max-width:420px" dir="auto">${esc(conv.title || 'Untitled')}</span></div>
    <div class="page-head">
      <div class="grow">
        <h1 dir="auto">${conv.title ? esc(conv.title) : '<span class="faint">Untitled conversation</span>'}</h1>
        <div class="sub">
          ${p ? `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)} ${unknownBadge(p)}</span>` : ''}
          <span title="${esc(fmtDateTime(conv.created))}">Started ${esc(fmtDateTime(conv.created))}</span>
          <span title="Last message">Last ${esc(fmtDateTime(conv.lastTs))}</span>
          <span>${plural(totalMsgs, 'message')} <span class="faint" id="off-branch">${offBranch > 0 ? `(${offBranch} on other branches)` : ''}</span></span>
          <a href="https://claude.ai/chat/${encodeURIComponent(conv.id)}" target="_blank" rel="noopener noreferrer" title="Opens on claude.ai (needs access)">claude.ai ↗</a>
        </div>
      </div>
      <div class="row wrap">
        <button class="btn small" type="button" data-action="conv-md" data-id="${esc(conv.id)}">Copy as Markdown</button>
        <button class="btn small" type="button" data-action="conv-dl-md" data-id="${esc(conv.id)}">Download .md</button>
        <button class="btn small" type="button" data-action="conv-dl-json" data-id="${esc(conv.id)}">.json</button>
        <button class="btn small ghost" type="button" data-action="print" title="Print or save as PDF">⎙</button>
      </div>
    </div>

    ${conv.summary && conv.summary.trim() ? `<details class="card summary-box"><summary>Summary written by Claude</summary>${mdBlock(conv.summary)}</details>` : ''}
    ${outputs.length ? outputsBox(outputs) : ''}

    <div class="conv-toolbar" id="conv-toolbar">
      <label class="chip${CONV_OPTS.showTools ? ' on' : ''}"><input type="checkbox" data-action="conv-opt" data-opt="showTools" ${CONV_OPTS.showTools ? 'checked' : ''} hidden>⚙ Tool calls</label>
      <label class="chip${CONV_OPTS.showThinking ? ' on' : ''}"><input type="checkbox" data-action="conv-opt" data-opt="showThinking" ${CONV_OPTS.showThinking ? 'checked' : ''} hidden>💭 Thinking</label>
      <label class="chip${CONV_OPTS.showSystem ? ' on' : ''}" title="Text the platform added to messages (memory snapshots, dates)"><input type="checkbox" data-action="conv-opt" data-opt="showSystem" ${CONV_OPTS.showSystem ? 'checked' : ''} hidden>⚑ System notes</label>
      <button class="chip" type="button" data-action="expand-all">Expand all</button>
      <button class="chip" type="button" data-action="collapse-all">Collapse all</button>
      ${q ? `<span class="chip on">Highlighting “${esc(q)}” <a href="#/c/${encodeURIComponent(conv.id)}" title="Clear">×</a></span><span class="muted" id="hit-count" style="font-size:13px"></span>` : ''}
    </div>

    ${conv.empty ? `<div class="notice warn">${totalMsgs
      ? `This conversation has ${plural(totalMsgs, 'message')}, but the export contains no text for them. Claude’s export sometimes leaves chats empty; nothing more can be shown.`
      : 'This conversation has no messages in the export.'}</div>` : ''}
    <div class="thread" id="thread"></div>
  </div>`;
}

// The first message whose bottom is below the top of the viewport, and where it sits now.
function threadAnchor() {
  const mainTop = $('#main').getBoundingClientRect().top;
  for (const el of $$('#thread > .msg')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > mainTop + 60) return { id: el.id.slice(2), top: r.top };
  }
  return null;
}

// Counts thread draws; a newer draw (branch switch, option change) stops the batches of an older one.
let threadSeq = 0;

/* opts: q (highlight), target (message to scroll to and flash),
 *       anchor {id, top} (keep this message at the same screen position after a redraw). */
function drawThread(conv, opts) {
  const thread = $('#thread');
  if (!thread) return;
  const tok = ++threadSeq;
  const path = currentPath(conv);
  const terms = opts.q ? searchTerms(opts.q) : [];
  const ctx = { conv, created: createdFilesIndex(conv) };
  thread.innerHTML = '';
  let i = 0;
  const want = opts.target || (opts.anchor && opts.anchor.id);
  const targetIdx = want ? path.findIndex(m => m.uuid === want) : -1;
  // Draw well past the target so there is enough page below it to scroll it into place.
  const firstBatch = Math.max(30, targetIdx + 20);
  const renderBatch = (n) => {
    const frag = document.createElement('div');
    frag.innerHTML = path.slice(i, i + n).map(m => messageHtml(m, ctx)).join('');
    if (terms.length) highlightIn(frag, terms);
    while (frag.firstChild) thread.appendChild(frag.firstChild);
    i += n;
    thread.querySelectorAll('details[data-lazy][open]:not([data-done])').forEach(d => d.dispatchEvent(new Event('toggle')));
    hydrateFrames(thread);
  };
  renderBatch(firstBatch);
  if (!path.length) thread.innerHTML = '<div class="empty">No messages.</div>';
  const off = $('#off-branch');
  if (off) off.textContent = conv.msgCount - path.length > 0 ? `(${conv.msgCount - path.length} on other branches)` : '';
  const finish = () => {
    if (terms.length) {
      const hits = thread.querySelectorAll('mark').length;
      const hc = $('#hit-count');
      if (hc) hc.textContent = hits ? `${hits} match${hits === 1 ? '' : 'es'} shown` : 'no visible matches (they may be inside collapsed blocks)';
    }
  };
  // Render the rest in small slices so long chats open instantly.
  const pump = () => {
    if (!thread.isConnected || threadSeq !== tok) return;
    if (i < path.length) { renderBatch(25); setTimeout(pump, 16); } else finish();
  };
  if (i < path.length) setTimeout(pump, 30); else finish();

  const main = $('#main');
  if (opts.anchor) {
    const el = document.getElementById('m-' + opts.anchor.id);
    if (el) main.scrollTop += el.getBoundingClientRect().top - opts.anchor.top;
  } else if (opts.target) {
    const el = document.getElementById('m-' + opts.target);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.classList.add('flash');
      const firstMark = el.querySelector('mark');
      if (firstMark) firstMark.scrollIntoView({ block: 'center' });
    }
  }
}

/* ---------- One message ---------- */

function messageHtml(m, ctx) {
  const conv = ctx.conv;
  const human = m.sender === 'human';
  const who = human ? conv.owner : null;
  const sibs = siblingsOf(conv, m);
  const idx = sibs.findIndex(s => s.uuid === m.uuid);
  const branch = sibs.length > 1
    ? `<span class="branch-nav" title="${human ? 'This message was edited' : 'This reply was regenerated'}: ${sibs.length} versions">
        <button type="button" data-action="branch" data-conv="${esc(conv.id)}" data-to="${esc(sibs[idx - 1] ? sibs[idx - 1].uuid : '')}" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous version">‹</button>
        ${idx + 1} / ${sibs.length}
        <button type="button" data-action="branch" data-conv="${esc(conv.id)}" data-to="${esc(sibs[idx + 1] ? sibs[idx + 1].uuid : '')}" ${idx >= sibs.length - 1 ? 'disabled' : ''} aria-label="Next version">›</button>
      </span>` : '';
  const blocks = Array.isArray(m.content) ? m.content : [];
  const firstStart = blocks.reduce((min, b) => { const t = parseTime(b && b.start_timestamp); return t && (!min || t < min) ? t : min; }, 0);
  const created = parseTime(m.created_at);
  const dur = !human && firstStart && created > firstStart ? fmtDuration(created - firstStart) : '';
  const body = human ? humanBody(m, ctx) : assistantBody(m, ctx);
  return `<article class="msg ${human ? 'human' : 'assistant'}" id="m-${esc(m.uuid)}">
    <div class="msg-head">
      ${human ? avatarHtml(who, 'sm') : '<span class="avatar sm" style="--h:20" aria-hidden="true">C</span>'}
      <span class="who">${human ? esc(who ? who.name.split(' · ')[0] : 'User') : 'Claude'}</span>
      <span title="${esc(fmtDateTime(created))}">${esc(fmtDateTime(created))}</span>
      ${dur ? `<span class="faint" title="Time to answer">· ${esc(dur)}</span>` : ''}
      ${branch}
      <span class="msg-actions">
        <button class="btn small ghost" type="button" data-action="copy-msg" data-conv="${esc(conv.id)}" data-msg="${esc(m.uuid)}" title="Copy message text">⧉</button>
        <button class="btn small ghost" type="button" data-action="link-msg" data-conv="${esc(conv.id)}" data-msg="${esc(m.uuid)}" title="Copy link to this message">#</button>
      </span>
    </div>
    <div class="msg-body">${body || '<span class="faint">(empty message)</span>'}</div>
  </article>`;
}

const HUMAN_FOLD = 3000;

function humanBody(m, ctx) {
  const parts = [];
  const blocks = Array.isArray(m.content) ? m.content : [];
  let texts = blocks.filter(b => b && b.type === 'text' && b.text && b.text.trim()).map(b => b.text);
  if (!blocks.length && m.text && m.text.trim()) texts = [m.text];
  for (const t of texts) {
    if (t.length > HUMAN_FOLD) {
      // The preview stays; opening the box adds only the rest of the text.
      const k = viewKey(() => `<div dir="auto" style="white-space:pre-wrap">${plainTextHtml(t.slice(HUMAN_FOLD))}</div>`);
      parts.push(`<div dir="auto" style="white-space:pre-wrap">${plainTextHtml(t.slice(0, HUMAN_FOLD))}</div>
        <details class="blk" data-lazy="${k}"><summary><span class="lbl">Show the rest of the message</span><span class="meta">${fmtBytes(t.length - HUMAN_FOLD)} more</span></summary><div class="blk-body"></div></details>`);
    } else {
      parts.push(`<div dir="auto" style="white-space:pre-wrap">${plainTextHtml(t)}</div>`);
    }
  }
  if (CONV_OPTS.showSystem) {
    for (const b of blocks) {
      if (b && b.type === 'injected_prompt_block') {
        const k = viewKey(() => preHtml(b.prompt || '', { wrap: true }));
        parts.push(`<details class="blk thinking" data-lazy="${k}"><summary><span class="lbl">System note</span><span class="desc">${esc(b.injection_source || '')} — added by the platform, not typed by the person</span><span class="meta">${fmtBytes((b.prompt || '').length)}</span></summary><div class="blk-body"></div></details>`);
      }
    }
  }
  const files = filesHtml(m);
  if (files) parts.push(files);
  return parts.join('');
}

// Uploads: attachments carry extracted text; files[] are references only (no bytes in export).
function filesHtml(m) {
  const atts = Array.isArray(m.attachments) ? m.attachments.slice() : [];
  const files = Array.isArray(m.files) ? m.files : [];
  const used = new Set();
  const out = [];
  for (const a of atts) {
    const name = a.file_name || 'Pasted text';
    const content = a.extracted_content || '';
    const k = viewKey(() => /\.(md|markdown)$/i.test(a.file_name || '') || /markdown/.test(a.file_type || '')
      ? `<div class="row" style="margin-bottom:6px"><span class="muted" style="font-size:12.5px">Rendered Markdown</span></div>${mdBlock(content)}`
      : preHtml(content, { wrap: true }));
    out.push(`<details class="blk attach" data-lazy="${k}"><summary><span class="lbl" dir="auto">${esc(name)}</span><span class="desc">${esc(a.file_type || '')}</span><span class="meta">${fmtBytes(a.file_size || content.length)}</span></summary><div class="blk-body"></div></details>`);
    // Pair with the same-named file entry so it is not listed twice.
    const fi = files.findIndex((f, i) => !used.has(i) && (f.file_name || '') === (a.file_name || ''));
    if (fi >= 0) used.add(fi);
  }
  const chips = files.filter((f, i) => !used.has(i)).map(f => {
    const n = f.file_name || 'Unnamed file';
    const img = /\.(png|jpe?g|gif|webp|heic)$/i.test(n);
    return `<span class="file-chip" title="The file itself is not included in the export">${img ? '🖼' : '📄'} <span dir="auto">${esc(n)}</span> <span class="sz">not in export</span></span>`;
  });
  if (chips.length) out.push(`<div class="files-row">${chips.join('')}</div>`);
  return out.join('');
}

function assistantBody(m, ctx) {
  const blocks = Array.isArray(m.content) ? m.content : [];
  if (!blocks.length) return m.text && m.text.trim() ? `<div class="md">${mdToHtml(m.text)}</div>` : '';
  const results = new Map();
  for (const b of blocks) if (b && b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, b);
  const knowledge = new Map();   // url -> {title, site} for citation labels
  for (const b of blocks) {
    if (b && b.type === 'tool_result') for (const it of (Array.isArray(b.content) ? b.content : [])) {
      if (it && it.type === 'knowledge' && it.url) knowledge.set(it.url, { title: it.title, site: it.metadata && it.metadata.site_name });
    }
  }
  const out = [];
  let group = [];
  // Runs of plain tool calls collapse into one "N tool calls" box; outputs the person
  // saw (files, artifacts, widgets, drafts) always stay at the top level.
  const flush = () => {
    if (!group.length) return;
    let run = [];
    const flushRun = () => {
      if (run.length > 3) {
        const errs = run.filter(g => g.error).length;
        out.push(`<details class="blk"><summary><span class="lbl">${run.length} tool calls</span><span class="desc">${esc(Array.from(new Set(run.map(g => toolLabel(g.use.name)))).slice(0, 6).join(', '))}</span>${errs ? `<span class="meta" style="color:var(--err)">${errs} failed</span>` : ''}</summary><div class="blk-body tool-group">${run.map(g => g.html).join('')}</div></details>`);
      } else out.push(...run.map(g => g.html));
      run = [];
    };
    for (const g of group) {
      if (g.special) { flushRun(); out.push(g.html); }
      else if (CONV_OPTS.showTools) run.push(g);
    }
    flushRun();
    group = [];
  };
  const usedResults = new Set();
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'tool_use') {
      const res = results.get(b.id);
      if (res) usedResults.add(res);
      const special = isOutputTool(b);
      group.push({ use: b, special, error: res && res.is_error, html: toolCallHtml(b, res, ctx) });
      continue;
    }
    if (b.type === 'tool_result') {
      if (usedResults.has(b)) continue;
      group.push({ use: { name: b.name || 'tool' }, html: toolCallHtml({ name: b.name, input: {} }, b, ctx) });
      continue;
    }
    flush();
    if (b.type === 'text') {
      if (!b.text || !b.text.trim()) continue;
      out.push(textBlockHtml(b, knowledge));
    } else if (b.type === 'thinking') {
      if (!CONV_OPTS.showThinking) continue;
      out.push(thinkingHtml(b));
    } else if (b.type === 'token_budget') {
      continue;
    } else if (b.type !== 'injected_prompt_block') {
      const k = viewKey(() => preHtml(jsonPretty(b)));
      out.push(`<details class="blk" data-lazy="${k}"><summary><span class="lbl">${esc(b.type || 'block')}</span></summary><div class="blk-body"></div></details>`);
    }
  }
  flush();
  const files = filesHtml(m);
  if (files) out.push(files);
  return out.join('');
}

function textBlockHtml(b, knowledge) {
  let text = b.text;
  const cites = Array.isArray(b.citations) ? b.citations.filter(c => c && c.details && c.details.url) : [];
  if (!cites.length) return `<div class="md">${mdToHtml(text)}</div>`;
  // Number sources by first appearance; insert [n] markers at each citation's end offset.
  const nums = new Map();
  for (const c of cites) if (!nums.has(c.details.url)) nums.set(c.details.url, nums.size + 1);
  const inserts = cites
    .map(c => ({ at: Math.min(text.length, cpToUnits(text, Math.max(0, c.end_index | 0))), n: nums.get(c.details.url), url: c.details.url }))
    .sort((a, b) => b.at - a.at);
  const seenAt = new Set();
  for (const ins of inserts) {
    const key = ins.at + ':' + ins.n;
    if (seenAt.has(key)) continue;
    seenAt.add(key);
    text = text.slice(0, ins.at) + `<sup>[${ins.n}](${ins.url.replace(/\)/g, '%29').replace(/ /g, '%20')})</sup>` + text.slice(ins.at);
  }
  const list = Array.from(nums.entries()).map(([url, n]) => {
    const k = knowledge.get(url);
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = url; }
    return `<li value="${n}"><a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer" dir="auto">${esc((k && k.title) || host)}</a> <span class="faint">${esc((k && k.site) || host)}</span></li>`;
  }).join('');
  return `<div class="md">${mdToHtml(text)}</div><ol class="cite-list">${list}</ol>`;
}

function thinkingHtml(b) {
  const sums = Array.isArray(b.summaries) ? b.summaries.map(s => s && s.summary).filter(Boolean) : [];
  const t0 = parseTime(b.start_timestamp), t1 = parseTime(b.stop_timestamp);
  const dur = t0 && t1 && t1 > t0 ? fmtDuration(t1 - t0) : '';
  const label = sums.length ? sums[sums.length - 1] : (b.thinking ? truncate(oneLine(b.thinking), 120) : 'Thinking');
  const hidden = b.thinking_hidden || !b.thinking;
  const k = viewKey(() => {
    let h = '';
    if (b.thinking) h += `<div class="md" dir="auto">${mdToHtml(b.thinking)}</div>`;
    else h += `<p class="faint">The thinking text itself is not in the export${sums.length ? '; only these summaries remain' : ''}.</p>`;
    if (sums.length) h += `<div class="blk-sub">Summaries</div><ul>${sums.map(s => `<li dir="auto">${esc(s)}</li>`).join('')}</ul>`;
    return h;
  });
  return `<details class="blk thinking" data-lazy="${k}"><summary><span class="lbl">💭 Thinking</span><span class="desc" dir="auto">${esc(label)}</span><span class="meta">${dur}${hidden ? ' · summary only' : ''}</span></summary><div class="blk-body"></div></details>`;
}

/* ---------- Tool calls ---------- */

function toolLabel(name) {
  const s = String(name || 'tool');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(i + 1) : s;
}

function isOutputTool(b) {
  return /^(create_file|artifacts|visualize:show_widget|message_compose_v1|ask_user_input_v0|chart_display_v0|places_map_display_v0|Artifact|present_files)$/.test(b.name || '');
}

function toolInputSummary(name, i) {
  if (!i || typeof i !== 'object') return '';
  const v = i.query || i.q || i.command || i.url || i.path || i.file_path || i.jql || i.title || i.summary_title || i.issueIdOrKey || i.summary || i.action || i.searchString || i.description || i.keywords || '';
  if (Array.isArray(v)) return v.join(', ');
  if (Array.isArray(i.filepaths)) return i.filepaths.map(p => String(p).split('/').pop()).join(', ');
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function toolCallHtml(use, res, ctx) {
  const name = use.name || (res && res.name) || 'tool';
  const input = use.input && typeof use.input === 'object' ? use.input : {};
  const error = res && res.is_error;
  const integ = use.integration_name || (name.includes(':') ? name.split(':')[0] : '');
  const t0 = parseTime(use.start_timestamp), t1 = parseTime(res && (res.stop_timestamp || res.start_timestamp));
  const dur = t0 && t1 && t1 > t0 ? fmtDuration(t1 - t0) : '';
  const errType = res && res.meta && res.meta.error_type;

  // Outputs the person actually saw: render as open, prominent cards.
  const special = specialToolHtml(name, input, res, ctx, use);
  if (special) return special;

  const desc = toolInputSummary(name, input) || use.message || '';
  const k = viewKey(() => toolBodyHtml(use, res, ctx));
  return `<details class="blk tool${error ? ' result error' : ''}" data-lazy="${k}" id="t-${esc(use.id || '')}">
    <summary><span class="lbl">${esc(toolLabel(name))}</span>${integ ? `<span class="faint" style="flex:none">${esc(integ)}</span>` : ''}<span class="desc" dir="auto">${esc(truncate(oneLine(desc), 160))}</span>
    <span class="meta">${error ? `<b style="color:var(--err)">failed${errType ? ' · ' + esc(errType) : ''}</b> ` : ''}${!res ? 'no result ' : ''}${dur}</span></summary>
    <div class="blk-body"></div></details>`;
}

function toolBodyHtml(use, res, ctx) {
  const name = use.name || '';
  const input = use.input && typeof use.input === 'object' ? use.input : {};
  let h = '';
  if (use.message) h += `<p class="muted" style="margin:0 0 8px" dir="auto">${esc(use.message)}</p>`;
  h += '<div class="blk-sub">Input</div>' + toolInputHtml(name, input, use.display_content);
  h += '<div class="blk-sub">Result' + (res && res.message ? ` · <span style="text-transform:none;font-weight:400">${esc(res.message)}</span>` : '') + '</div>';
  h += res ? toolResultHtml(res, ctx) : '<p class="faint">No result was recorded (the turn may have been stopped).</p>';
  return h;
}

function codeLangFromPath(p) {
  return fileExt(p || '') || '';
}

function toolInputHtml(name, input, dc) {
  if (name === 'bash_tool' && input.command) return preHtml(input.command);
  if (name === 'create_file' && input.file_text != null) return `<p class="mono faint" style="margin:0 0 6px">${esc(input.path || '')}</p>` + preHtml(input.file_text);
  if ((name === 'str_replace' || name === 'str_replace_edit') && (input.old_str != null || input.old_string != null)) {
    return `<p class="mono faint" style="margin:0 0 6px">${esc(input.path || '')}</p>` + diffHtml(input.old_str != null ? input.old_str : input.old_string, input.new_str != null ? input.new_str : input.new_string);
  }
  if (dc && typeof dc === 'object') {
    if (dc.type === 'code_block' && dc.code != null) return preHtml(dc.code);
    if (dc.type === 'table' && Array.isArray(dc.table)) return `<dl class="kvs">${dc.table.map(r => `<dt>${esc(r && r[0])}</dt><dd dir="auto">${esc(r && r[1])}</dd>`).join('')}</dl>`;
    if (dc.type === 'json_block' && typeof dc.json_block === 'string') {
      try {
        const v = JSON.parse(dc.json_block);
        if (v && typeof v === 'object' && typeof v.code === 'string') return (v.filename ? `<p class="mono faint" style="margin:0 0 6px">${esc(v.filename)}</p>` : '') + preHtml(v.code);
      } catch (e) { /* truncated JSON: fall through to the raw input */ }
    }
  }
  if (!Object.keys(input).length) return '<p class="faint">(no input)</p>';
  return kvOrJson(input);
}

// Short scalar inputs as a key/value list; anything nested as pretty JSON.
function kvOrJson(obj) {
  const entries = Object.entries(obj);
  const simple = entries.every(([, v]) => v == null || typeof v !== 'object');
  if (simple && entries.every(([, v]) => String(v).length < 400)) {
    return `<dl class="kvs">${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd>`).join('')}</dl>`;
  }
  return preHtml(jsonPretty(obj));
}

function diffHtml(a, b) {
  return `<div class="blk-sub" style="color:var(--err)">Removed</div>${preHtml(a == null ? '' : a)}<div class="blk-sub" style="color:var(--ok)">Added</div>${preHtml(b == null ? '' : b)}`;
}

function toolResultHtml(res, ctx) {
  const items = Array.isArray(res.content) ? res.content : [];
  const dc = res.display_content;
  const out = [];
  const stub = items.length === 1 && items[0].type === 'text' && /^Tool result too large for context/.test(items[0].text || '');
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'text') {
      const t = it.text || '';
      if (res.name === 'bash_tool' && /^\s*\{"returncode"/.test(t)) {
        try {
          const r = JSON.parse(t);
          out.push(`<p class="muted" style="margin:0 0 4px">Exit code ${esc(r.returncode)}</p>` +
            (r.stdout ? `<div class="blk-sub">stdout</div>${preHtml(r.stdout)}` : '') +
            (r.stderr ? `<div class="blk-sub" style="color:var(--err)">stderr</div>${preHtml(r.stderr)}` : ''));
          continue;
        } catch (e) { /* not JSON after all */ }
      }
      out.push(linkifyChats(preHtml(prettyMaybeJson(t), { wrap: true })));
    } else if (it.type === 'knowledge') {
      // The page text Claude read is in the export: show it on demand.
      const k = viewKey(() => `<p style="margin:0 0 6px"><a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.url || '')}</a></p>` + preHtml(it.text || '', { wrap: true }));
      out.push(`<details class="blk" data-lazy="${k}"><summary><span class="lbl" dir="auto">${esc(it.title || it.url || 'Web page')}</span>
        <span class="desc">${esc((it.metadata && (it.metadata.site_name || it.metadata.site_domain)) || '')}${it.prompt_context_metadata && it.prompt_context_metadata.age ? ' · ' + esc(it.prompt_context_metadata.age) : ''}</span>
        <span class="meta">${fmtBytes((it.text || '').length)} of page text</span></summary><div class="blk-body"></div></details>`);
    } else if (it.type === 'image') {
      out.push(`<span class="file-chip">🖼 Screenshot or image <span class="sz">not in export</span></span>`);
    } else if (it.type === 'local_resource') {
      const created = ctx.created.get(it.file_path);
      out.push(`<span class="file-chip">📄 <span dir="auto">${esc(it.name || it.file_path)}</span> <span class="sz">${esc(it.mime_type || '')}</span>${created ? ` <button class="btn small" type="button" data-action="scroll-to" data-target="t-${esc(created.id)}">show content</button>` : ' <span class="sz">bytes not in export</span>'}</span>`);
    } else if (it.type === 'image_gallery') {
      const imgs = Array.isArray(it.images) ? it.images : [];
      out.push(imgs.length ? `<div class="files-row">${imgs.map(g => `<a class="file-chip" href="${esc(safeUrl(g.page_url || g.url))}" target="_blank" rel="noopener noreferrer">🖼 ${esc(g.title || 'image')}</a>`).join('')}</div>` : '<p class="faint">Image results expired.</p>');
    } else {
      out.push(preHtml(jsonPretty(it)));
    }
  }
  if (dc && typeof dc === 'object') {
    if (dc.type === 'rich_link' && dc.link) out.push(`<p><a href="${esc(safeUrl(dc.link.url))}" target="_blank" rel="noopener noreferrer">${esc(dc.link.title || dc.link.url)}</a></p>`);
    if (dc.type === 'rich_content' && Array.isArray(dc.content)) {
      out.push(`<ul>${dc.content.map(x => `<li>${chatHref(x.url) ? `<a href="${chatHref(x.url)}">${esc(x.title || x.url)}</a>` : esc(x.title || '')}${Array.isArray(x.subtitles) && x.subtitles.length ? ` <span class="faint">${esc(x.subtitles.join(' · '))}</span>` : ''}</li>`).join('')}</ul>`);
    }
    if (dc.type === 'file' && dc.published_artifact_id) out.push(artifactLinkHtml(dc.published_artifact_id, dc.title, dc.published_action));
  }
  const sc = res.structured_content;
  if (sc && typeof sc === 'object' && Object.keys(sc).length) {
    if (sc.artifact_id) out.push(artifactLinkHtml(sc.artifact_id, sc.title));
    const k = 'sc-' + Math.random().toString(36).slice(2, 8);
    out.push(`<details class="blk"${stub ? ' open' : ''}><summary><span class="lbl">Structured data</span><span class="desc">${stub ? 'the full result (the text above is only a stub)' : 'raw JSON returned by the tool'}</span><span class="meta">${fmtBytes(JSON.stringify(sc).length)}</span></summary><div class="blk-body">${preHtml(jsonPretty(sc))}</div></details>`);
  }
  return out.join('') || '<p class="faint">(empty result)</p>';
}

function prettyMaybeJson(t) {
  if (t.length < 200000 && /^\s*[\[{]/.test(t)) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch (e) { return t; }
  }
  return t;
}

function chatHref(url) {
  const m = /claude\.ai\/chat\/([0-9a-f-]{36})/.exec(url || '');
  return m && DB.convById.has(m[1]) ? '#/c/' + m[1] : '';
}

// Turn claude.ai chat links inside escaped text into local links.
function linkifyChats(html) {
  return html.replace(/https:\/\/claude\.ai\/chat\/([0-9a-f-]{36})/g, (all, id) => DB.convById.has(id) ? `<a href="#/c/${id}">${all}</a>` : all);
}

function artifactLinkHtml(id, title, action) {
  const a = DB.artifactById.get(id);
  if (a) return `<p class="row wrap"><span class="chip on">◧ ${esc(action || 'artifact')}</span> <a href="#/a/${encodeURIComponent(id)}" dir="auto">${esc(a.title || title || id)}</a> <span class="faint">open the exported artifact</span></p>`;
  return `<p class="row wrap"><span class="chip">◧ ${esc(action || 'artifact')}</span> <span dir="auto">${esc(title || id)}</span> <span class="faint">not in the loaded files (load the frames zips to see it)</span></p>`;
}

/* ---------- Visible outputs: files, artifacts, widgets ---------- */

function sandboxFrame(html, height) {
  const k = stashText(withFrameShim(html));
  return `<iframe class="preview" sandbox="allow-scripts allow-popups allow-forms allow-modals" referrerpolicy="no-referrer" data-srcdoc-stash="${k}" style="height:${height || 420}px" title="Sandboxed preview"></iframe>`;
}

function hydrateFrames(root) {
  (root || document).querySelectorAll('iframe[data-srcdoc-stash]').forEach(f => {
    const html = TEXT_STASH.get(f.dataset.srcdocStash);
    if (html != null) f.srcdoc = html;
    delete f.dataset.srcdocStash;
  });
}

function specialToolHtml(name, input, res, ctx, use) {
  const id = esc(use.id || '');
  if (name === 'artifacts' && (input.content || input.command)) {
    const type = input.type || '';
    const title = input.title || input.id || 'Artifact';
    const content = input.content || '';
    const k = viewKey(() => {
      if (/markdown/.test(type)) return mdBlock(content);
      if (/html/.test(type)) return `${sandboxFrame(content, 520)}<details class="blk" style="margin-top:8px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(content)}</div></details>`;
      return `<p class="muted" style="margin:0 0 6px">${esc(type)} source (React components cannot run offline)</p>${preHtml(content)}`;
    });
    return `<details class="blk artifact" data-lazy="${k}" id="t-${id}" open><summary><span class="lbl">◧ Artifact</span><span class="desc" dir="auto">${esc(title)}</span><span class="meta">${esc(input.command || '')} · ${esc(type.replace('application/vnd.ant.', ''))}</span></summary><div class="blk-body"></div></details>`;
  }
  if (name === 'create_file' && input.file_text != null) {
    const path = input.path || '';
    const ext = codeLangFromPath(path);
    const k = viewKey(() => {
      if (ext === 'md' || ext === 'markdown') return `<div class="row" style="margin-bottom:8px"><span class="muted" style="font-size:12.5px">${esc(path)}</span><button class="btn small" type="button" data-action="dl-text" data-name="${esc(path.split('/').pop())}" data-stash="${stashText(input.file_text)}">Download</button></div>${mdBlock(input.file_text)}<details class="blk" style="margin-top:8px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(input.file_text)}</div></details>`;
      if (ext === 'html' || ext === 'htm' || ext === 'svg') return `<div class="row" style="margin-bottom:8px"><span class="muted" style="font-size:12.5px">${esc(path)}</span><button class="btn small" type="button" data-action="dl-text" data-name="${esc(path.split('/').pop())}" data-stash="${stashText(input.file_text)}">Download</button></div>${sandboxFrame(input.file_text, 520)}<details class="blk" style="margin-top:8px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(input.file_text)}</div></details>`;
      return `<div class="row" style="margin-bottom:8px"><span class="muted" style="font-size:12.5px">${esc(path)}</span><button class="btn small" type="button" data-action="dl-text" data-name="${esc(path.split('/').pop())}" data-stash="${stashText(input.file_text)}">Download</button></div>${preHtml(input.file_text)}`;
    });
    return `<details class="blk artifact" data-lazy="${k}" id="t-${id}"><summary><span class="lbl">📄 Created file</span><span class="desc mono" dir="auto">${esc(path.split('/').pop())}</span><span class="meta">${fmtBytes(input.file_text.length)}</span></summary><div class="blk-body"></div></details>`;
  }
  if (name === 'visualize:show_widget' && input.widget_code) {
    const k = viewKey(() => `${sandboxFrame(`<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_CSS}</style></head><body>${input.widget_code}</body></html>`, 460)}<details class="blk" style="margin-top:8px"><summary><span class="lbl">Source</span></summary><div class="blk-body">${preHtml(input.widget_code)}</div></details>`);
    return `<details class="blk artifact" data-lazy="${k}" id="t-${id}"><summary><span class="lbl">▦ Widget</span><span class="desc" dir="auto">${esc(input.title || 'Interactive widget')}</span><span class="meta">open to render</span></summary><div class="blk-body"></div></details>`;
  }
  if (name === 'message_compose_v1') {
    const variants = composeVariants(input);
    return `<div class="card card-pad" id="t-${id}"><div class="row wrap" style="margin-bottom:6px"><span class="chip on">✉ Draft ${esc(input.kind || '')}</span><b dir="auto">${esc(input.summary_title || '')}</b></div>
      ${variants.map(v => `<div style="margin-top:8px">${v.label ? `<div class="blk-sub">${esc(v.label)}</div>` : ''}${v.subject ? `<div><b>Subject:</b> <span dir="auto">${esc(v.subject)}</span></div>` : ''}<div class="md" dir="auto">${mdToHtml(v.body || '', { breaks: true })}</div></div>`).join('') || '<p class="faint">(no text)</p>'}</div>`;
  }
  if (name === 'ask_user_input_v0' && Array.isArray(input.questions)) {
    return `<div class="card card-pad" id="t-${id}"><div class="row" style="margin-bottom:6px"><span class="chip on">? Questions for the person</span></div>
      ${input.questions.map(q => `<div style="margin-top:6px"><div dir="auto"><b>${esc(q.question || '')}</b> ${q.type ? `<span class="faint">${esc(q.type)}</span>` : ''}</div><div class="files-row" style="margin-top:4px">${(Array.isArray(q.options) ? q.options : []).map(o => `<span class="chip" dir="auto">${esc(typeof o === 'string' ? o : JSON.stringify(o))}</span>`).join('')}</div></div>`).join('')}
      <p class="faint" style="font-size:13px;margin:8px 0 0">The answer is in the next message.</p></div>`;
  }
  if (name === 'chart_display_v0' && Array.isArray(input.series)) {
    return `<div class="card card-pad" id="t-${id}"><div class="row" style="margin-bottom:6px"><span class="chip on">📊 Chart</span><b dir="auto">${esc(input.title || '')}</b></div>${simpleBarTable(input)}</div>`;
  }
  if (name === 'places_map_display_v0' && (Array.isArray(input.days) || Array.isArray(input.locations))) {
    // Most calls put `locations` at the top level instead of inside `days`.
    const days = Array.isArray(input.days) ? input.days : [{ locations: input.locations }];
    return `<div class="card card-pad" id="t-${id}"><div class="row" style="margin-bottom:6px"><span class="chip on">🗺 ${Array.isArray(input.days) ? 'Itinerary' : 'Places'}</span><b dir="auto">${esc(input.title || '')}</b></div>
      ${input.narrative ? `<p dir="auto">${esc(input.narrative)}</p>` : ''}
      ${days.map(d => `${d.day_number || d.title ? `<div class="blk-sub">Day ${esc(d.day_number || '')} · ${esc(d.title || '')}</div>` : ''}<ul>${(Array.isArray(d.locations) ? d.locations : []).map(l => `<li dir="auto"><b>${esc((l && l.name) || '')}</b>${l && l.arrival_time ? ' · ' + esc(l.arrival_time) : ''}${l && l.notes ? ' — ' + esc(l.notes) : ''}</li>`).join('')}</ul>`).join('')}</div>`;
  }
  if (name === 'Artifact') {
    const dc = res && res.display_content;
    const sc = res && res.structured_content;
    const artId = (dc && dc.published_artifact_id) || (sc && sc.artifact_id) || ((/\/artifact\/([0-9a-f-]{36})/.exec(input.url || '') || [])[1]);
    if (artId) {
      return `<div id="t-${id}">${artifactLinkHtml(artId, (dc && dc.title) || input.title, input.action || (dc && dc.published_action))}</div>`;
    }
  }
  return '';
}

/* Stand-ins for the stylesheet claude.ai gives inline widgets. Most widget SVGs only use
 * these class names and color variables; without them every shape renders solid black. */
const WIDGET_CSS = `
:root{--color-text-primary:#1f1e1c;--color-text-secondary:#5f5b53;--color-text-tertiary:#8a857b;
--color-background-primary:#fff;--color-background-secondary:#f5f4f0;--color-background-tertiary:#ecebe6;
--color-border-primary:#b9b4a8;--color-border-secondary:#d6d2c8;--color-border-tertiary:#e6e3dc;
--color-text-info:#1f5fae;--color-background-info:#e7f0fb;--color-text-success:#2d7a46;--color-background-success:#e5f4ea;
--color-text-warning:#9a6200;--color-background-warning:#fdf1dc;--color-text-danger:#b3261e;--color-background-danger:#fbe7e5;
--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,Menlo,monospace;
--border-radius-md:8px;--border-radius-lg:12px}
html,body{margin:0;background:var(--color-background-primary);color:var(--color-text-primary);font-family:var(--font-sans);font-size:14px}
svg{max-width:100%;height:auto}
svg text{fill:var(--color-text-primary);font-family:var(--font-sans);font-size:13px}
.th{font-size:14px;font-weight:600;fill:var(--color-text-primary)}
.t{font-size:13px;fill:var(--color-text-primary)}
.ts{font-size:11px;fill:var(--color-text-secondary)}
.ti{font-size:12px;font-style:italic;fill:var(--color-text-secondary)}
.arr,.leader{fill:none;stroke:var(--color-text-secondary);stroke-width:1.5}
.leader{stroke-dasharray:3 3}
.node rect,.box,rect.box{fill:var(--color-background-secondary);stroke:var(--color-border-primary)}
.c-gray :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-gray{fill:#f1efe9;stroke:#a8a396}
.c-purple :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-purple{fill:#eeeafc;stroke:#7b68d9}
.c-teal :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-teal{fill:#e2f4f1;stroke:#2c8c7c}
.c-coral :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-coral{fill:#fde9e3;stroke:#d5694a}
.c-amber :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-amber{fill:#fdf2da;stroke:#c48a12}
.c-blue :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-blue{fill:#e6effc;stroke:#3a73c9}
.c-red :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-red{fill:#fbe6e4;stroke:#c8453b}
.c-green :is(rect,circle,ellipse,path,polygon),:is(rect,circle,ellipse,path,polygon).c-green{fill:#e5f4ea;stroke:#3a8f55}
`;

/* Draft variants. The model sometimes sends `variants` as a broken string (e.g. "label" or
 * '<parameter name="label">Warm'), while the real text sits in input.body. */
function composeVariants(input) {
  if (Array.isArray(input.variants)) return input.variants.filter(v => v && typeof v === 'object');
  const raw = typeof input.variants === 'string' ? input.variants : '';
  if (raw) {
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter(x => x && typeof x === 'object'); } catch (e) { /* not JSON */ }
  }
  if (typeof input.body === 'string' && input.body.trim()) {
    const label = oneLine(raw.replace(/<[^>]*>/g, ''));
    return [{ label: label && label !== 'label' && label.length < 60 ? label : '', subject: input.subject, body: input.body }];
  }
  return raw ? [{ body: raw }] : [];
}

// Citation offsets count Unicode code points; JS strings index UTF-16 units.
function cpToUnits(text, cp) {
  let units = 0, n = 0;
  for (const ch of text) { if (n >= cp) break; units += ch.length; n++; }
  return units;
}

function simpleBarTable(input) {
  const xs = (input.xAxis && input.xAxis.data) || [];
  const series = input.series || [];
  return `<div class="md"><table><thead><tr><th></th>${series.map(s => `<th>${esc(s.name || '')}</th>`).join('')}</tr></thead><tbody>${xs.map((x, i) => `<tr><td>${esc(x)}</td>${series.map(s => `<td>${esc((s.values || [])[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// path -> tool_use of the create_file that wrote it (to resolve present_files).
function createdFilesIndex(conv) {
  if (conv._created) return conv._created;
  const map = new Map();
  for (const m of conv.raw.chat_messages || []) {
    for (const b of (Array.isArray(m.content) ? m.content : [])) {
      if (b && b.type === 'tool_use' && b.name === 'create_file' && b.input && b.input.path) map.set(b.input.path, b);
    }
  }
  conv._created = map;
  return map;
}

function collectOutputs(conv) {
  const out = [];
  for (const m of conv.raw.chat_messages || []) {
    for (const b of (Array.isArray(m.content) ? m.content : [])) {
      if (!b || b.type !== 'tool_use') continue;
      const i = b.input || {};
      if (b.name === 'create_file' && i.path) out.push({ id: b.id, msg: m.uuid, ico: '📄', label: i.path.split('/').pop(), kind: 'file' });
      else if (b.name === 'artifacts') out.push({ id: b.id, msg: m.uuid, ico: '◧', label: i.title || i.id || 'Artifact', kind: 'artifact' });
      else if (b.name === 'visualize:show_widget') out.push({ id: b.id, msg: m.uuid, ico: '▦', label: i.title || 'Widget', kind: 'widget' });
      else if (b.name === 'message_compose_v1') out.push({ id: b.id, msg: m.uuid, ico: '✉', label: i.summary_title || 'Draft', kind: 'draft' });
    }
  }
  for (const id of conv.artRefs || []) {
    const a = DB.artifactById.get(id);
    out.push({ art: id, ico: '◧', label: a ? a.title : 'Published artifact ' + id.slice(0, 8), kind: 'published' });
  }
  return out;
}

function outputsBox(outputs) {
  return `<details class="card summary-box"${outputs.length <= 6 ? ' open' : ''}><summary>What Claude produced here <span class="badge">${outputs.length}</span></summary>
    <div style="padding:0 16px 14px" class="files-row">${outputs.map(o => o.art
      ? `<a class="file-chip" href="#/a/${encodeURIComponent(o.art)}">${o.ico} <span dir="auto">${esc(truncate(o.label, 60))}</span> <span class="sz">published</span></a>`
      : `<button class="file-chip" type="button" data-action="goto-block" data-msg="${esc(o.msg)}" data-target="t-${esc(o.id)}" style="cursor:pointer">${o.ico} <span dir="auto">${esc(truncate(o.label, 60))}</span> <span class="sz">${esc(o.kind)}</span></button>`).join('')}</div></details>`;
}

/* ---------- Markdown export ---------- */

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
      if (b.name === 'create_file' && i.file_text != null) out.push(fence(i.file_text, codeLangFromPath(i.path)), '');
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

// Open a block and every collapsed group around it, then scroll to it.
function revealBlock(id) {
  const t = document.getElementById(id);
  if (!t) { toast('Could not find that item in the conversation'); return false; }
  for (let d = t.parentElement && t.parentElement.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  if (t.tagName === 'DETAILS') t.open = true;
  t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  t.classList.add('flash');
  return true;
}

/* ---------- Conversation actions ---------- */

function convAction(action, el) {
  const conv = DB.convById.get(el.dataset.conv || el.dataset.id);
  switch (action) {
    case 'toggle-empty':
      CONV_OPTS.hideEmpty = el.checked; saveConvOpts(); onRoute(); return true;
    case 'conv-opt': {
      CONV_OPTS[el.dataset.opt] = el.checked; saveConvOpts();
      const label = el.closest('.chip');
      if (label) label.classList.toggle('on', el.checked);
      const cur = App.route.path[0] === 'c' ? DB.convById.get(App.route.path[1]) : null;
      if (cur) drawThread(cur, { q: App.route.query.q || '', anchor: threadAnchor() });
      return true;
    }
    case 'branch': {
      if (!conv || !el.dataset.to) return true;
      // Keep the switched message where it is on screen; its sibling takes its place.
      const msgEl = el.closest('.msg');
      const anchor = msgEl ? { id: el.dataset.to, top: msgEl.getBoundingClientRect().top } : threadAnchor();
      selectBranchFor(conv, el.dataset.to);
      drawThread(conv, { q: App.route.query.q || '', anchor });
      return true;
    }
    case 'conv-md': copyText(convToMarkdown(conv)); return true;
    case 'conv-dl-md': downloadBlob(new Blob([convToMarkdown(conv)], { type: 'text/markdown' }), safeFilename(conv.title, 'conversation') + '.md'); return true;
    case 'conv-dl-json': downloadBlob(new Blob([JSON.stringify(conv.raw, null, 2)], { type: 'application/json' }), safeFilename(conv.title, 'conversation') + '.json'); return true;
    case 'copy-msg': {
      const m = buildTree(conv).byId.get(el.dataset.msg);
      if (m) copyText(messageToMarkdown(conv, m.m));
      return true;
    }
    case 'link-msg': {
      const url = location.href.split('#')[0] + '#/c/' + conv.id + '?m=' + el.dataset.msg;
      copyText(url);
      return true;
    }
    case 'goto-block': {
      const cur = DB.convById.get(App.route.path[1]);
      const msgId = el.dataset.msg;
      if (!document.getElementById(el.dataset.target) && cur && msgId) {
        // The output may be on another branch, or not drawn yet: show its message first.
        if (!currentPath(cur).some(m => m.uuid === msgId)) selectBranchFor(cur, msgId);
        drawThread(cur, { q: App.route.query.q || '', target: msgId });
      }
      revealBlock(el.dataset.target);
      return true;
    }
    case 'expand-all': $$('#thread details.blk').forEach(d => { d.open = true; }); return true;
    case 'collapse-all': $$('#thread details.blk').forEach(d => { d.open = false; }); return true;
    case 'print': window.print(); return true;
    case 'dl-text': {
      const t = TEXT_STASH.get(el.dataset.stash);
      if (t != null) downloadBlob(new Blob([t], { type: mimeFor(el.dataset.name) }), el.dataset.name || 'file.txt');
      return true;
    }
  }
  return false;
}
