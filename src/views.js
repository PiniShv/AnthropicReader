/* Views: the kind registry, router dispatch, sidebar, shared table component, home, people, person. */
'use strict';

const ICONS = { home: '⌂', people: '👥', search: '⌕', about: 'ⓘ' };

/* The five kinds of records, in the order every list of them uses (sidebar, person tabs and
 * card, search tabs and sections). key: person tab and search type. list / item: the route
 * names of the list page and of one item. allCount / personCount: the sidebar badge without
 * and with focus; personCount is also the person page's number. The view functions live in
 * later files, so they are called through arrows. */
const KINDS = [
  {
    key: 'conversations', list: 'conversations', item: 'c', icon: '💬', label: 'Conversations', noun: ['chat', 'chats'],
    allCount: () => withContent(DB.conversations).length, personCount: p => p.convCount(),
    listView: () => viewConversations(), itemView: b => viewConversation(b), personTab: p => convTable(p.conversations, 'pc-' + p.id, false),
  },
  {
    key: 'artifacts', list: 'artifacts', item: 'a', icon: '◧', label: 'Artifacts & pages', searchTab: 'Artifacts', noun: ['artifact', 'artifacts'],
    allCount: () => DB.artifacts.length, personCount: p => p.artifacts.length,
    listView: () => viewArtifacts(), itemView: (b, c) => viewArtifact(b, c), personTab: p => artifactTable(p.artifacts, 'pa-' + p.id, false),
  },
  {
    key: 'projects', list: 'projects', item: 'p', icon: '📁', label: 'Projects', noun: ['project', 'projects'],
    allCount: () => DB.projects.length, personCount: p => p.projects.length,
    listView: () => viewProjects(), itemView: b => viewProject(b), personTab: p => projectTable(p.projects, 'pp-' + p.id, false),
  },
  {
    key: 'design', list: 'design', item: 'd', icon: '✎', label: 'Design chats', noun: ['design chat', 'design chats'],
    allCount: () => DB.designChats.length, personCount: p => p.designChats.length,
    listView: () => viewDesignChats(), itemView: b => viewDesignChat(b), personTab: p => designTable(p.designChats, 'pd-' + p.id, false),
  },
  {
    // Without focus the badge counts people with memory; with focus, that person's memory items.
    key: 'memory', list: 'memories', item: 'memory', icon: '🧠', label: 'Memory', noun: ['memory item', 'memory items'],
    allCount: () => DB.memories.length, personCount: p => p.memoryCount(),
    listView: () => viewMemories(), itemView: b => viewMemory(b),
    personTab: p => (p.memory ? memoryBody(p.memory) : '<div class="card empty">No memory for this person in this export.</div>'),
  },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.key, k]));

// What a person's page and card show: every kind, plus the comments they wrote.
const PERSON_SECTIONS = [...KINDS, { key: 'comments', label: 'Comments', noun: ['comment', 'comments'], personCount: p => p.comments.length, personTab: personComments }];

function personLink(p, opts) {
  if (!p) return '<span class="faint">—</span>';
  if (p.system) return '<span class="faint">No owner</span>';
  const cls = p.known ? '' : ' class="faint"';
  const title = esc(p.email || (p.known ? '' : 'Not in users.json (former member?) · ' + p.id));
  return `<a href="#/person/${encodeURIComponent(p.id)}"${cls} title="${title}">${opts && opts.avatar ? avatarHtml(p, 'sm') + ' ' : ''}${esc(p.name)}</a>`;
}

function whoCell(p) {
  if (!p || p.system) return '<span class="faint">—</span>';
  return `<span class="who-cell">${avatarHtml(p, 'sm')}${personLink(p)}</span>`;
}

function unknownBadge(p) {
  if (!p || p.known || p.system) return '';
  return '<span class="chip warn" title="This account is not in users.json. Usually a person who left the team.">not in users.json</span>';
}

/* ---------- Router ---------- */

function renderRoute(r) {
  const [a, b, c] = r.path;
  try {
    const k = KINDS.find(x => x.list === a || x.item === a);
    if (k) return a === k.list ? k.listView() : k.itemView(b, c);
    switch (a) {
      case undefined: case '': return viewHome();
      case 'people': return viewPeople();
      case 'person': return viewPerson(b, c || 'overview');
      case 'search': return viewSearch(r.query.q || '', r.query.t || 'all');
      case 'about': return viewAbout();
      default: return notFound('That page does not exist.');
    }
  } catch (err) {
    console.error(err);
    // The page was not drawn, so the hooks it queued have nothing to work on.
    VIEW.mounts.length = 0;
    return `<div class="page"><div class="notice warn">Something went wrong while drawing this page: ${esc(err.message)}</div></div>`;
  }
}

function notFound(msg) {
  return `<div class="page narrow"><div class="empty"><h2>Not found</h2><p>${esc(msg)}</p><p><a href="#/">Go to the start page</a></p></div></div>`;
}

/* ---------- Sidebar ---------- */

function renderSidebar() {
  const r = App.route.path;
  const sec = r[0] || '';
  const fp = focusPerson();
  const link = (href, ico, label, count, active) =>
    `<a class="nav-link${active ? ' active' : ''}" href="${href}"><span class="ico">${ico}</span>${esc(label)}${count != null ? `<span class="badge">${fmtNum(count)}</span>` : ''}</a>`;
  const activeFor = (...names) => names.includes(sec);
  const peopleCount = Array.from(DB.people.values()).filter(p => !p.system).length;
  $('#sidebar').innerHTML = `
    ${fp ? `<div class="focus-box">
      <div class="lbl">Showing only</div>
      <div class="who">${avatarHtml(fp, 'sm')}<a href="#/person/${encodeURIComponent(fp.id)}">${esc(fp.name)}</a></div>
      <button class="btn small" ${on(() => setFocus(null))} type="button">Show everyone</button>
    </div>` : ''}
    <div class="nav-group">
      ${link('#/', ICONS.home, 'Start', null, sec === '')}
      ${link('#/people', ICONS.people, 'People', peopleCount, activeFor('people', 'person') && !(sec === 'person' && fp && r[1] === fp.id))}
      ${fp ? link('#/person/' + encodeURIComponent(fp.id), '★', fp.name.split(' · ')[0] + '’s profile', null, sec === 'person' && r[1] === fp.id) : ''}
    </div>
    <div class="nav-group">
      <div class="nav-title">${fp ? 'Their data' : 'Everything'}</div>
      ${KINDS.map(k => link('#/' + k.list, k.icon, k.label, fp ? k.personCount(fp) : k.allCount(), activeFor(k.list, k.item))).join('')}
    </div>
    <div class="nav-group">
      ${link('#/search', ICONS.search, 'Search', null, sec === 'search')}
      ${link('#/about', ICONS.about, 'About this export', null, sec === 'about')}
    </div>`;
}

/* ---------- Generic sortable / filterable table ---------- */

// Sort, filter, type chip and page size of each table (by spec.key), kept across visits.
const TABLE_STATE = new Map();

/* spec: { key, rows, columns:[{id,label,cls,thCls,sortVal,html,link,asc}], href(row), text(row),
 *         sort:'id', dir:-1|1, page:200, empty:'…', placeholder:'Filter…', extraToolbar:'', facet:{of(row)} }
 * link: the cell is a real link, so rows open from the keyboard and screen readers.
 * asc: the first click sorts A to Z. facet: chips above the toolbar, one per value of of(row). */
function tableHtml(spec) {
  const st = TABLE_STATE.get(spec.key) || { sort: spec.sort, dir: spec.dir || -1, filter: '', facet: '', limit: spec.page || 200 };
  TABLE_STATE.set(spec.key, st);
  // Each part gets a generated id, so it is found by id once it is in the page.
  const [id, barId, chipsId] = ['tbl' + ++KEY_SEQ, 'tbl' + ++KEY_SEQ, 'tbl' + ++KEY_SEQ];
  const chips = spec.facet ? facetChipsHtml(spec, st, chipsId) : '';
  after(() => {
    // Filter text per row, made again on each page draw, so names changed by a later import match.
    mountTable({ spec, st, wrap: document.getElementById(id), bar: document.getElementById(barId), chips: document.getElementById(chipsId), ft: new WeakMap() });
  });
  return `${chips}<div class="toolbar" id="${barId}">
      <input class="input filter" type="search" placeholder="${esc(spec.placeholder || 'Filter…')}" value="${esc(st.filter)}" aria-label="Filter">
      ${spec.extraToolbar || ''}
      <span class="count-note"></span>
    </div>
    <div class="table-wrap" id="${id}"></div>`;
}

// One chip per facet value with its count, most common first.
function facetChipsHtml(spec, st, id) {
  const counts = new Map();
  for (const r of spec.rows) { const v = spec.facet.of(r); counts.set(v, (counts.get(v) || 0) + 1); }
  if (!counts.size) return '';
  return `<div class="search-tabs" id="${id}">${Array.from(counts).sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `<button class="chip${st.facet === v ? ' on' : ''}" type="button" data-facet="${esc(v)}" title="Show only this type (click again for all)">${esc(v)} <b>${n}</b></button>`).join(' ')}</div>`;
}

function mountTable(t) {
  const { spec, st, wrap, bar, chips } = t;
  const input = bar.querySelector('input.filter');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { st.filter = input.value; st.limit = spec.page || 200; drawTable(t); }, 120);
  });
  wrap.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const id = th.dataset.sort;
      if (st.sort === id) st.dir = -st.dir;
      else { st.sort = id; st.dir = spec.columns.find(c => c.id === id).asc ? 1 : -1; }
      drawTable(t);
      return;
    }
    if (e.target.closest('[data-more]')) { st.limit += spec.page || 200; drawTable(t); }
  });
  if (chips) {
    chips.addEventListener('click', e => {
      const c = e.target.closest('[data-facet]');
      if (!c) return;
      st.facet = st.facet === c.dataset.facet ? '' : c.dataset.facet;
      st.limit = spec.page || 200;
      drawTable(t);
    });
  }
  drawTable(t);
}

function tableRows({ spec, st, ft }) {
  let rows = spec.rows;
  const f = st.filter.trim().toLowerCase();
  if (f) {
    const terms = f.split(/\s+/);
    const text = r => { let s = ft.get(r); if (s == null) ft.set(r, s = spec.text(r).toLowerCase()); return s; };
    rows = rows.filter(r => { const s = text(r); return terms.every(x => s.includes(x)); });
  }
  // Exact-match facet (e.g. artifact type chips), separate from the free-text filter.
  if (spec.facet && st.facet) rows = rows.filter(r => spec.facet.of(r) === st.facet);
  const col = spec.columns.find(c => c.id === st.sort);
  if (col && col.sortVal) {
    const dir = st.dir;
    rows = rows.slice().sort((a, b) => {
      const x = col.sortVal(a), y = col.sortVal(b);
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x || '').localeCompare(String(y || ''));
      return dir * ((x || 0) - (y || 0));
    });
  }
  return rows;
}

function drawTable(t) {
  const { spec, st, wrap, bar, chips } = t;
  const rows = tableRows(t);
  const shown = rows.slice(0, st.limit);
  const head = spec.columns.map(c => {
    const sortable = !!c.sortVal;
    const arrow = st.sort === c.id ? `<span class="arrow">${st.dir < 0 ? '▼' : '▲'}</span>` : '';
    return `<th class="${sortable ? 'sortable ' : ''}${c.thCls || c.cls || ''}" ${sortable ? `data-sort="${c.id}"` : ''}>${esc(c.label)}${arrow}</th>`;
  }).join('');
  const cell = (c, r) => c.link ? `<a class="cell-link" href="${esc(spec.href(r))}">${c.html(r)}</a>` : c.html(r);
  const body = shown.map(r => `<tr data-href="${esc(spec.href(r))}">${spec.columns.map(c => `<td class="${c.cls || ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('');
  wrap.innerHTML = rows.length
    ? `<table class="list"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
      (rows.length > shown.length ? `<div class="more-row"><button class="btn small" type="button" data-more>Show ${fmtNum(Math.min(spec.page || 200, rows.length - shown.length))} more (${fmtNum(rows.length - shown.length)} left)</button></div>` : '')
    : `<div class="empty">${st.filter || st.facet ? 'Nothing matches the filter.' : esc(spec.empty || 'Nothing here.')}</div>`;
  bar.querySelector('.count-note').textContent = st.filter || st.facet ? `${fmtNum(rows.length)} of ${fmtNum(spec.rows.length)}` : plural(spec.rows.length, spec.noun || 'item', spec.nounPlural);
  if (chips) chips.querySelectorAll('[data-facet]').forEach(c => c.classList.toggle('on', c.dataset.facet === st.facet));
}

/* Column helpers */
const COL = {
  owner: { id: 'owner', label: 'Person', asc: true, sortVal: r => (r.owner ? r.owner.name.toLowerCase() : ''), html: r => whoCell(r.owner), cls: 'hide-sm' },
  date: (id, label, get) => ({ id, label, sortVal: get, html: r => `<span title="${esc(fmtDateTime(get(r)))}">${esc(fmtDate(get(r)))}</span>`, cls: 'date' }),
  num: (id, label, get) => ({ id, label, sortVal: get, html: r => fmtNum(get(r)), cls: 'num' }),
};

/* ---------- Home ---------- */

function viewHome() {
  const fp = focusPerson();
  if (fp) return viewPerson(fp.id, 'overview');
  const people = peopleSorted().filter(p => !p.system);
  const active = people.filter(p => p.total() > 0);
  const totalMsgs = DB.conversations.reduce((a, c) => a + c.msgCount, 0);
  const convs = KIND.conversations.allCount(), emptyConvs = DB.conversations.length - convs;
  const manifest = latestManifest();
  const missing = manifest ? missingFiles(manifest) : [];
  const dates = DB.conversations.map(c => c.created).filter(Boolean);
  const first = dates.length ? Math.min(...dates) : 0;
  const last = DB.conversations.length ? Math.max(...DB.conversations.map(c => c.lastTs || 0)) : 0;
  after(() => {
    const inp = $('#home-person-q');
    const draw = () => {
      const list = peopleMatching(inp.value).filter(p => p.total() > 0 || inp.value).slice(0, 12);
      $('#home-people').innerHTML = list.map(personCardHtml).join('') || '<div class="empty">No one matches.</div>';
    };
    inp.addEventListener('input', draw);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = peopleMatching(inp.value)[0]; if (first) navigate('#/person/' + encodeURIComponent(first.id)); }
    });
    draw();
  });
  return `<div class="page">
    <div class="page-head"><div class="grow">
      <h1>Your Claude export</h1>
      <div class="sub">
        ${manifest ? `<span>Exported ${esc(fmtDateTime(manifest.createdAt))}</span>` : ''}
        ${first ? `<span>Chats from ${esc(fmtDate(first))} to ${esc(fmtDate(last))}</span>` : ''}
      </div>
    </div></div>

    ${missing.length ? `<div class="notice warn" style="margin-bottom:14px">${plural(missing.length, 'part')} of this export ${missing.length === 1 ? 'is' : 'are'} not loaded (${missing.map(f => esc(f.filename)).join(', ')}). <a href="#/about">Download or add them</a>.</div>` : ''}
    ${DB.warnings.length ? `<div class="notice warn" style="margin-bottom:14px">${plural(DB.warnings.length, 'file')} could not be read, so some data is missing. <a href="#/about">See which</a>.</div>` : ''}
    <div class="tiles">
      <a class="tile" href="#/people"><div class="num">${fmtNum(active.length)}</div><div class="lbl">people with data <span class="faint">of ${fmtNum(people.length)}</span></div></a>
      <a class="tile" href="#/conversations"><div class="num">${fmtNum(convs)}</div><div class="lbl">conversations · ${fmtNum(totalMsgs)} messages${emptyConvs ? ` <span class="faint">· ${fmtNum(emptyConvs)} more without content</span>` : ''}</div></a>
      <a class="tile" href="#/artifacts"><div class="num">${fmtNum(DB.artifacts.length)}</div><div class="lbl">artifacts & pages</div></a>
      <a class="tile" href="#/projects"><div class="num">${fmtNum(DB.projects.length)}</div><div class="lbl">projects</div></a>
      <a class="tile" href="#/design"><div class="num">${fmtNum(DB.designChats.length)}</div><div class="lbl">design chats</div></a>
      <a class="tile" href="#/memories"><div class="num">${fmtNum(DB.memories.length)}</div><div class="lbl">people with memory</div></a>
    </div>

    <h2 class="section-title">Find a person</h2>
    <p class="muted" style="margin:-4px 0 12px;font-size:14px">Open anyone to see all their conversations, artifacts, projects, design chats, memory and comments in one place.</p>
    <div class="toolbar"><input class="input filter" id="home-person-q" type="search" placeholder="Type a name or email, then press Enter…" aria-label="Find a person" style="max-width:420px"><a class="count-note" href="#/people">All people →</a></div>
    <div class="people-grid" id="home-people"></div>

    <h2 class="section-title">Latest conversations</h2>
    ${miniConvList(DB.conversations.slice(0, 8))}
    <p><a href="#/conversations">All conversations →</a></p>
  </div>`;
}

function miniConvList(list) {
  if (!list.length) return '<div class="card empty">No conversations.</div>';
  return `<div class="table-wrap"><table class="list"><tbody>${list.map(c => `
    <tr data-href="#/c/${encodeURIComponent(c.id)}">
      <td class="title"><div dir="auto">${esc(c.title || 'Untitled conversation')}</div>${c.summary ? `<div class="snip" dir="auto">${esc(truncate(oneLine(stripMd(c.summary)), 220))}</div>` : ''}</td>
      <td class="hide-sm">${whoCell(c.owner)}</td>
      <td class="num">${fmtNum(c.msgCount)} msgs</td>
      <td class="date">${esc(fmtDate(c.lastTs))}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function stripMd(s) {
  return String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/[#>*_`]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/* ---------- People ---------- */

function personCardHtml(p) {
  const counts = PERSON_SECTIONS.map(s => [s.personCount(p), ...s.noun]).filter(x => x[0]);
  return `<a class="person-card${p.total() ? '' : ' inactive'}" href="#/person/${encodeURIComponent(p.id)}">
    ${avatarHtml(p)}
    <div class="grow">
      <div class="name ellipsis">${esc(p.name)}</div>
      <div class="email ellipsis">${esc(p.email || (p.known ? '' : 'Not in users.json · ' + p.id.slice(0, 8)))}</div>
      <div class="counts">${counts.length ? counts.map(([n, one, many]) => `<span><b>${fmtNum(n)}</b> ${n === 1 ? one : many}</span>`).join('') : '<span>No data in this export</span>'}${p.last ? `<span>· last ${esc(fmtDate(p.last))}</span>` : ''}</div>
    </div>
  </a>`;
}

const PEOPLE_SORTS = {
  total: ['Most data', (a, b) => b.total() - a.total()],
  recent: ['Recently active', (a, b) => b.last - a.last],
  name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
  conv: ['Most conversations', (a, b) => b.convCount() - a.convCount()],
  msgs: ['Most messages', (a, b) => b.messageCount - a.messageCount],
  art: ['Most artifacts', (a, b) => b.artifacts.length - a.artifacts.length],
  proj: ['Most projects', (a, b) => b.projects.length - a.projects.length],
};
const PEOPLE_STATE = { q: '', sort: 'total', showEmpty: false };

function viewPeople() {
  const all = Array.from(DB.people.values()).filter(p => !p.system);
  const empty = all.filter(p => !p.total()).length;
  const unknown = all.filter(p => !p.known).length;
  const none = DB.people.get(NO_OWNER);
  after(() => {
    const draw = () => {
      const q = PEOPLE_STATE.q.toLowerCase().trim();
      let list = all.filter(p => (PEOPLE_STATE.showEmpty || p.total() > 0 || q) && (!q || personMatches(p, q)));
      list.sort((a, b) => PEOPLE_SORTS[PEOPLE_STATE.sort][1](a, b) || a.name.localeCompare(b.name));
      $('#people-grid').innerHTML = list.map(personCardHtml).join('') || '<div class="empty">No one matches.</div>';
      $('#people-count').textContent = `${fmtNum(list.length)} shown`;
    };
    const q = $('#people-q');
    q.addEventListener('input', () => { PEOPLE_STATE.q = q.value; draw(); });
    $('#people-sort').addEventListener('change', e => { PEOPLE_STATE.sort = e.target.value; draw(); });
    $('#people-empty').addEventListener('change', e => { PEOPLE_STATE.showEmpty = e.target.checked; draw(); });
    draw();
    q.focus();
  });
  return `<div class="page">
    <div class="page-head"><div class="grow"><h1>People</h1>
      <div class="sub"><span>${plural(all.length, 'person', 'people')}</span>${unknown ? `<span>${unknown} not in users.json (former members)</span>` : ''}${empty ? `<span>${empty} with no data</span>` : ''}</div>
    </div></div>
    <div class="toolbar">
      <input class="input filter" id="people-q" type="search" placeholder="Filter by name or email…" value="${esc(PEOPLE_STATE.q)}" aria-label="Filter people">
      <select class="input" id="people-sort" aria-label="Sort people">${Object.entries(PEOPLE_SORTS).map(([k, [l]]) => `<option value="${k}"${PEOPLE_STATE.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <label class="row muted" style="font-size:14px"><input type="checkbox" id="people-empty"${PEOPLE_STATE.showEmpty ? ' checked' : ''}> Show people with no data (${empty})</label>
      <span class="count-note" id="people-count"></span>
    </div>
    <div class="people-grid" id="people-grid"></div>
    ${none && none.total() ? `<p class="muted" style="margin-top:18px;font-size:14px">${plural(none.total(), 'item')} have no owner (agent-made artifacts, empty design chats). <a href="#/person/${NO_OWNER}">See them</a>.</p>` : ''}
  </div>`;
}

/* ---------- Person ---------- */

function viewPerson(id, tab) {
  const p = DB.people.get(id);
  if (!p) return notFound('No person with this id in the loaded export.');
  const counts = Object.fromEntries(PERSON_SECTIONS.map(s => [s.key, s.personCount(p)]));
  const isFocus = App.focus === p.id;
  const base = '#/person/' + encodeURIComponent(p.id);
  const tabs = `<a class="tab${tab === 'overview' ? ' active' : ''}" href="${base}">Overview</a>` +
    PERSON_SECTIONS.map(s => `<a class="tab${tab === s.key ? ' active' : ''}" href="${base}/${s.key}">${esc(s.label)} <span class="badge">${fmtNum(counts[s.key])}</span></a>`).join('');
  const sec = PERSON_SECTIONS.find(s => s.key === tab);
  if (tab !== 'overview' && !sec) return notFound('Unknown tab.');
  const body = sec ? sec.personTab(p) : personOverview(p, counts);

  const firstLast = p.first ? `Active ${esc(fmtDate(p.first))} – ${esc(fmtDate(p.last))}` : 'No dated activity';
  return `<div class="page">
    <div class="crumbs"><a href="#/people">People</a><span>›</span><span>${esc(p.name)}</span></div>
    <div class="page-head">
      ${avatarHtml(p, 'lg')}
      <div class="grow">
        <h1 class="row wrap">${esc(p.name)} ${unknownBadge(p)}</h1>
        <div class="sub">
          ${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}
          ${p.phone ? `<span class="row" style="gap:4px">📞 <span>${esc(maskPhone(p.phone))}</span> <button class="btn small ghost" type="button" ${on(el => { el.previousElementSibling.textContent = p.phone; el.remove(); })}>show</button></span>` : ''}
          <span>${firstLast}</span>
          ${p.system ? '' : `<span class="mono faint" title="Account id">${esc(p.id)}</span> <button class="btn small ghost" type="button" ${on(() => copyText(p.id))} title="Copy id">⧉</button>`}
        </div>
      </div>
      <div class="row wrap">
        ${p.system ? '' : (isFocus
          ? `<button class="btn small" type="button" ${on(() => setFocus(null))}>Show everyone</button>`
          : `<button class="btn small" type="button" ${on(() => setFocus(p.id))} title="Scope every list and search to this person">Focus on ${esc(p.name.split(' · ')[0])}</button>`)}
        <button class="btn small primary" type="button" ${on(() => exportPerson(p))} title="Download everything about this person as a .zip">Download their data</button>
      </div>
    </div>
    <div class="tabs" role="tablist">${tabs}</div>
    ${body}
  </div>`;
}

function maskPhone(ph) {
  const s = String(ph);
  return s.length > 6 ? s.slice(0, 6) + '•'.repeat(Math.max(0, s.length - 8)) + s.slice(-2) : '••••';
}

function personOverview(p, counts) {
  const base = '#/person/' + encodeURIComponent(p.id);
  const shared = p.artifacts.filter(a => a.visibility === 'organization' || a.visibility === 'invited').length;
  const docs = p.projects.reduce((a, x) => a + x.docs.length, 0);
  const tiles = [
    ['conversations', counts.conversations, 'conversations', plural(p.messageCount, 'message') + (p.emptyConvCount() ? ` · ${fmtNum(p.emptyConvCount())} more without content` : '')],
    ['artifacts', counts.artifacts, 'artifacts & pages', shared ? `${fmtNum(shared)} shared` : ''],
    ['projects', counts.projects, 'projects', docs ? plural(docs, 'doc') : ''],
    ['design', counts.design, 'design chats', ''],
    ['memory', counts.memory, 'memory items', p.memory ? plural(p.memory.files.length, 'file') + (p.memory.conversationsMemory ? ' + chat summary' : '') : ''],
    ['comments', counts.comments, 'comments', p.comments.some(c => c.byAgent) ? `${fmtNum(p.comments.filter(c => c.byAgent).length)} posted by Claude for them` : ''],
  ].map(([k, n, l, s]) => `<a class="tile" href="${base}/${k}"><div class="num">${fmtNum(n)}</div><div class="lbl">${l}${s ? ` <span class="faint">· ${esc(s)}</span>` : ''}</div></a>`).join('');

  // Activity by month across all item types.
  const stamps = [];
  withContent(p.conversations).forEach(c => stamps.push(c.created));
  p.artifacts.forEach(a => stamps.push(a.created || a.updated));
  p.projects.forEach(x => stamps.push(x.created));
  p.designChats.forEach(d => stamps.push(d.created));
  const chart = activityChart(stamps.filter(Boolean));

  // Recent activity timeline.
  const events = [];
  withContent(p.conversations).forEach(c => events.push({ t: c.lastTs, ico: KIND.conversations.icon, html: `<a href="#/c/${encodeURIComponent(c.id)}" dir="auto">${esc(c.title || 'Untitled conversation')}</a> <span class="faint">· ${plural(c.msgCount, 'message')}</span>` }));
  p.artifacts.forEach(a => events.push({ t: a.updated, ico: KIND.artifacts.icon, html: `<a href="#/a/${encodeURIComponent(a.id)}" dir="auto">${esc(artifactTitle(a))}</a> <span class="faint">· ${a.kind === 'page' ? 'page' : 'artifact'}, ${plural(a.versions.length, 'version')}</span>` }));
  p.projects.forEach(x => events.push({ t: x.updated, ico: KIND.projects.icon, html: `<a href="#/p/${encodeURIComponent(x.id)}" dir="auto">${esc(x.name || 'Untitled project')}</a> <span class="faint">· project</span>` }));
  p.designChats.forEach(d => events.push({ t: d.lastTs, ico: KIND.design.icon, html: `<a href="#/d/${encodeURIComponent(d.id)}" dir="auto">${esc(d.title)}</a> <span class="faint">· design chat in ${esc(d.project.name || 'a design project')}</span>` }));
  events.sort((a, b) => b.t - a.t);

  const profile = p.memory && p.memory.files.find(f => /^\/profile\.md$/i.test(f.path));
  const cm = p.memory && p.memory.conversationsMemory;

  return `<div class="tiles">${tiles}</div>
    ${chart ? `<h2 class="section-title">Activity by month</h2><div class="card card-pad">${chart}</div>` : ''}
    ${profile || cm ? `<h2 class="section-title">What Claude remembers <a class="chip" href="${base}/memory">open memory</a></h2>
      <div class="card card-pad">${profile ? memoryText(profile.body, p.memory) : mdBlock(truncate(cm, 1800))}</div>` : ''}
    <h2 class="section-title">Recent activity</h2>
    ${events.length ? `<div class="card card-pad"><ul class="timeline">${events.slice(0, 40).map(e => `<li><span class="when" title="${esc(fmtDateTime(e.t))}">${esc(fmtDate(e.t))}</span><span class="kind">${e.ico}</span><span>${e.html}</span></li>`).join('')}</ul>
      ${events.length > 40 ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Showing the latest 40 of ${fmtNum(events.length)}. Use the tabs above for everything.</p>` : ''}</div>`
      : '<div class="card empty">No activity in this export.</div>'}`;
}

function activityChart(stamps) {
  if (!stamps.length) return '';
  const months = new Map();
  for (const t of stamps) {
    const d = new Date(t);
    const k = d.getFullYear() * 12 + d.getMonth();
    months.set(k, (months.get(k) || 0) + 1);
  }
  const keys = Array.from(months.keys());
  let lo = Math.min(...keys), hi = Math.max(...keys);
  if (hi - lo > 35) lo = hi - 35;
  const max = Math.max(...Array.from(months.values()));
  const label = k => MONTH_FMT.format(new Date(Math.floor(k / 12), k % 12, 1));
  const bars = [];
  for (let k = lo; k <= hi; k++) {
    const v = months.get(k) || 0;
    bars.push(`<div class="bar" style="height:${v ? Math.max(4, (v / max) * 100) : 0}%" title="${esc(label(k))}: ${v}"></div>`);
  }
  return `<div class="activity">${bars.join('')}</div><div class="activity-labels"><span>${esc(label(lo))}</span><span>${esc(label(hi))}</span></div>`;
}

function personComments(p) {
  if (!p.comments.length) return '<div class="card empty">No comments by this person in this export.</div>';
  return `<div class="card card-pad">${p.comments.map(c => {
    const cm = c.comment;
    const text = cm.body || cm.text || '';
    const quote = c.thread && c.thread.quoted_text;
    return `<div class="comment">
      <div class="row wrap" style="font-size:13px;color:var(--muted)">
        <span>On <a href="#/a/${encodeURIComponent(c.artifact.id)}" dir="auto">${esc(artifactTitle(c.artifact))}</a></span>
        ${c.thread && c.thread.tab ? `<span class="chip">tab: ${esc(c.thread.tab)}</span>` : ''}
        ${c.byAgent ? '<span class="chip" title="Claude posted this comment for the person">posted by Claude for them</span>' : ''}
        ${c.thread && c.thread.resolved ? '<span class="chip ok">resolved</span>' : ''}
        <span class="faint">${esc(fmtDateTime(cm.created_at))}</span>
      </div>
      ${quote ? `<div class="quote" dir="auto">“${esc(quote)}”</div>` : ''}
      <div dir="auto">${mdToHtml(text)}</div>
    </div>`;
  }).join('')}</div>`;
}
