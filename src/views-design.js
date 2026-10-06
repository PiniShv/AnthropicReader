/* Claude Design chats: list and thread (prompts, tool calls, questions, attachments). */
'use strict';

function designTable(list, key, showOwner) {
  const columns = [{
    id: 'title', label: 'Design chat', cls: 'title', link: true, asc: true, sortVal: d => designTitle(d).toLowerCase(),
    html: d => `<div dir="auto">${esc(designTitle(d))}</div><div class="row wrap" style="margin-top:5px;gap:4px"><span class="chip" dir="auto">✎ ${esc(d.project.name || 'design project')}</span>${d.msgCount ? '' : '<span class="chip warn">empty</span>'}${d.authors.length > 1 ? `<span class="chip">${d.authors.length} people</span>` : ''}</div>`,
  }];
  if (showOwner) columns.push(COL.owner);
  columns.push(COL.num('msgs', 'Messages', d => d.msgCount));
  columns.push(COL.date('last', 'Last message', d => d.lastTs));
  return tableHtml({
    key, rows: list, columns, sort: 'last', dir: -1, noun: 'design chat',
    href: d => '#/d/' + encodeURIComponent(d.id),
    text: d => [designTitle(d), d.project.name, d.firstPrompt, ...d.authors.map(p => p.name + ' ' + p.email)].join(' '),
    placeholder: 'Filter by prompt, design project or person…', empty: 'No design chats.',
  });
}

function viewDesignChats() {
  const s = focusScope();
  const list = s.designChats;
  return `<div class="page"><div class="page-head"><div class="grow"><h1>Design chats</h1>
    <div class="sub">${s.person ? `<span>Only ${personLink(s.person)}’s</span>` : ''}<span>${plural(list.length, 'chat')} from Claude Design</span><span>${new Set(list.map(d => d.project.id)).size} design projects</span></div></div></div>
    ${designTable(list, 'design-' + s.key, !s.person)}</div>`;
}

// One design chat in the search results; it opens with the words highlighted (qs).
function designResult({ item: d, text }, terms, qs) {
  return `<a class="result" href="#/d/${encodeURIComponent(d.id)}${qs}"><div class="r-title"><span dir="auto">${esc(designTitle(d))}</span><span class="chip">✎ ${esc(d.project.name || 'design project')}</span></div>
    <div class="r-snip" dir="auto">${snippetHtml(text, terms)}</div>
    <div class="r-meta">${avatarHtml(d.owner, 'sm')}<span>${esc(d.owner.name)}</span><span>${esc(fmtDate(d.lastTs))}</span></div></a>`;
}

const DESIGN_NOISE = /^(<i><\/i>|<details>|<ant\w*)$/;

function viewDesignChat(id) {
  const d = DB.designById.get(id);
  if (!d) return notFound('No design chat with this id.');
  const msgs = d.messages;
  const receipts = new Map();
  for (const m of msgs) { const c = m.content || {}; if (c.questionReceipt && c.questionReceipt.questionId) receipts.set(c.questionReceipt.questionId, c.questionReceipt); }
  const tokens = msgs.reduce((a, m) => a + ((m.content && m.content.turnInputTokens) || 0), 0);
  // Opened from a search: mark the words, in the thread now and in blocks opened later.
  VIEW.terms = searchTerms(App.route.query.q);
  if (VIEW.terms.length) after(() => highlightIn($('#thread'), VIEW.terms));
  return `<div class="page narrow">
    <div class="crumbs"><a href="#/design">Design chats</a><span>›</span>${d.owner && !d.owner.system ? `${personLink(d.owner)}<span>›</span>` : ''}<span dir="auto">${esc(d.project.name)}</span></div>
    <div class="page-head"><div class="grow">
      <h1 dir="auto">${esc(designTitle(d))}</h1>
      <div class="sub"><span class="chip on" dir="auto">✎ ${esc(d.project.name || 'design project')}</span>
        ${d.authors.map(p => `<span class="row" style="gap:6px">${avatarHtml(p, 'sm')}${personLink(p)}</span>`).join('') || '<span class="faint">No author (empty chat)</span>'}
        <span>Started ${esc(fmtDateTime(d.created))}</span><span>Last ${esc(fmtDateTime(d.lastTs))}</span><span>${plural(d.msgCount, 'message')}</span>
        ${tokens ? `<span class="faint" title="Sum of input context over all turns">${fmtNum(Math.round(tokens / 1000))}k context tokens</span>` : ''}</div>
    </div><div class="row"><button class="btn small" type="button" ${on(() => downloadText(safeFilename(d.project.name + ' ' + d.id.slice(0, 8), 'design-chat') + '.json', jsonPretty(d.raw)))}>Download .json</button></div></div>
    <div class="conv-toolbar"><button class="chip" type="button" ${on(expandAll)}>Expand all</button><button class="chip" type="button" ${on(collapseAll)}>Collapse all</button></div>
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
  if (injected) h += blk({ cls: 'thinking', summary: '<span class="lbl">Context added by the app</span>' }, () => preHtml(raw, { wrap: true }));
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
      out.push(blk({ cls: 'attach', summary: `<span class="lbl" dir="auto">${a.type === 'skill' ? 'skill: ' : ''}${esc(name)}</span><span class="meta">${fmtBytes((a.content || '').length)}</span>` },
        () => preHtml(a.content || '', { wrap: true })));
    } else if (a.type === 'comment') {
      const content = String(a.content || '');
      const fb = content.includes('</mentioned-element>') ? content.split('</mentioned-element>').pop() : content.replace(/^File:[^\n]*\n?/, '');
      const onFile = a.filePath || ((/^File:\s*(.+)$/m.exec(content) || [])[1] || '').trim();
      out.push(`<div class="card card-pad" style="padding:8px 12px"><div class="row wrap" style="font-size:12.5px;color:var(--muted)"><span class="chip">🗨 comment on the design</span>${onFile ? `<span class="mono">${esc(onFile)}</span>` : ''}</div><div class="md" dir="auto">${mdToHtml(fb.replace(/^\s*Feedback:\s*/, '').trim())}</div></div>`);
    } else if (a.type === 'fig-file') {
      out.push(blk({ cls: 'attach', summary: `<span class="lbl">Figma: ${esc(name)}</span>` },
        () => (Array.isArray(a.selectedFrames) ? `<ul>${a.selectedFrames.map(f => `<li class="mono">${esc(f)}</li>`).join('')}</ul>` : '') + (a.figOutline ? preHtml(a.figOutline, { wrap: true }) : '')));
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
      return `<div class="row" style="justify-content:center">${blk({ style: 'max-width:640px;width:100%', summary: `<span class="lbl">⚑ ${esc(oneLine(c.content || 'Notice'))}</span><span class="meta">${esc(time)}</span>`, body: att || '<p class="faint">No details.</p>' })}</div>`;
    }
    const who = designAuthor(c, d);
    return `<article class="msg human" id="m-${esc(m.uuid)}"><div class="msg-head">${avatarHtml(who, 'sm')}<span class="who">${who ? personLink(who) : esc(c.authorName || 'User')}</span><span>${esc(time)}</span>${snip}</div>
      <div class="msg-body">${designUserContent(c.content)}${designAttachments(c.attachments, false)}</div></article>`;
  }
  // assistant
  if (c.kind === 'question-record' && c.questionRecord) {
    return `<article class="msg assistant" id="m-${esc(m.uuid)}"><div class="msg-head"><span class="avatar sm" style="--h:20" aria-hidden="true">C</span><span class="who">Claude</span><span>${esc(time)}</span></div>
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
      const items = group.map(designToolHtml);
      out.push(group.length > 2 ? toolGroupHtml(items, group.map(g => g.name), 0) : items.join(''));
      group = [];
    };
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'tool_call' && b.toolCall) { group.push(b.toolCall); continue; }
      flush();
      if (b.type === 'text') { const t = String(b.text || '').trim(); if (t && !DESIGN_NOISE.test(t)) out.push(`<div class="md" dir="auto">${mdToHtml(t)}</div>`); }
      else if (b.type === 'error') out.push(`<div class="notice warn" style="color:var(--err)">Error: ${esc(typeof b.message === 'string' ? b.message : JSON.stringify(b.message))}</div>`);
      else if (b.type === 'user_interjection' && b.message && b.message.pill === true) {
        // An automation notice that arrived mid-turn, not something the person typed.
        out.push(blk({ summary: `<span class="lbl">⚑ ${esc(oneLine(b.message.content || 'Notice'))}</span><span class="meta">${esc(fmtDateTime(b.message.timestamp))}</span>`, body: designAttachments(b.message.attachments, true) || '<p class="faint">No details.</p>' }));
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
  return `<article class="msg assistant" id="m-${esc(m.uuid)}"><div class="msg-head"><span class="avatar sm" style="--h:20" aria-hidden="true">C</span><span class="who">Claude</span><span>${esc(time)}</span>${c.turnInputTokens ? `<span class="faint">· ${fmtNum(Math.round(c.turnInputTokens / 1000))}k context</span>` : ''}${failed ? ' <span class="chip err">turn failed</span>' : ''}${snip}</div>
    <div class="msg-body">${out.join('') || '<span class="faint">(no text)</span>'}</div></article>`;
}

function designToolHtml(t) {
  const i = t.input && typeof t.input === 'object' ? t.input : {};
  const desc = i.path || i.a_filename || i.query || i.purpose || i.title || i.pattern || i.label || i.filename || (i.from_id ? i.from_id + '→' + i.to_id : '') || '';
  const out = typeof t.output === 'string' ? t.output : null;
  return blk({ cls: 'tool', summary: `<span class="lbl">${esc(t.name || 'tool')}</span>${t.serverSide ? '<span class="chip" style="font-size:11px">server</span>' : ''}<span class="desc" dir="auto">${esc(truncate(oneLine(String(desc)), 140))}</span>` }, () => {
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
}
