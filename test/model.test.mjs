// The import pipeline (importExport in src/ingest.js) and the model it fills, on small, made-up exports.
// Everything here is fictional: the company "Northwind Labs" and its people do not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importFiles, zipFile, looseFile, plain } from './harness.mjs';

const tools = loadApp({ files: ['src/zip.js'] }).api;
const zip = (name, entries) => zipFile(tools, name, entries);

/* ---------- Fictional ids and records ---------- */

const ADA = 'a0000000-0000-4000-8000-000000000001';
const BRAM = 'b0000000-0000-4000-8000-000000000002';
const GONE = 'c0000000-0000-4000-8000-000000000003';   // has data, missing from users.json
const IRIS = 'c0000000-0000-4000-8000-000000000004';   // only known from a project's creator

const conv = n => 'd0000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const art = n => 'e0000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const design = n => 'f0000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const proj = n => '90000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');

const USERS = [
  { uuid: ADA, full_name: 'Ada Fernsby', email_address: 'ada.fernsby@northwind.example', verified_phone_number: '+1 555 0100' },
  { uuid: BRAM, full_name: 'Bram Okafor', email_address: 'bram@northwind.example', verified_phone_number: null },
];

function message(uuid, sender, text, extra = {}) {
  return {
    uuid, sender, text: '', created_at: extra.at || '2026-03-01T09:00:00.000000Z',
    content: text ? [{ type: 'text', text }] : [], files: [], attachments: [], ...extra,
  };
}

function conversation(uuid, owner, name, messages, updated = '2026-03-02T10:00:00.000000Z') {
  return { uuid, name, summary: '', created_at: '2026-03-01T09:00:00.000000Z', updated_at: updated, account: { uuid: owner }, chat_messages: messages };
}

function chat(uuid, owner, name, n, updated) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    msgs.push(message(uuid.slice(0, 8) + '-m' + i, i % 2 ? 'assistant' : 'human', 'Message ' + i, { parent_message_uuid: i ? uuid.slice(0, 8) + '-m' + (i - 1) : undefined }));
  }
  return conversation(uuid, owner, name, msgs, updated);
}

const person = (api, id) => api.DB.people.get(id);

/* ---------- People and conversations ---------- */

test('links conversations to people from users.json', async () => {
  const longPrompt = 'Can you help me compare three options for the new warehouse region names and pick one?';
  const file = await zip('northwind-export-000.zip', {
    'users.json': USERS,
    'conversations.json': [
      chat(conv(1), ADA, 'Launch checklist', 2),
      chat(conv(2), GONE, 'Old vendor notes', 4),
      conversation(conv(3), ADA, '', []),
      conversation(conv(4), BRAM, '', [message('m4a', 'human', longPrompt), message('m4b', 'assistant', 'Sure.')]),
      conversation(conv(5), BRAM, '', [message('m5a', 'human', '', { files: [{ file_name: 'floorplan.png' }] })]),
      conversation(conv(6), BRAM, '  ', [message('m6a', 'human', ''), message('m6b', 'assistant', 'Here is a short summary of the plan.')]),
    ],
  });
  const { api } = await importFiles([file]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  assert.equal(DB.people.size, 3);
  assert.equal(DB.conversations.length, 6);

  const ada = person(api, ADA);
  assert.equal(ada.known, true);
  assert.equal(ada.name, 'Ada Fernsby');
  assert.equal(ada.email, 'ada.fernsby@northwind.example');
  assert.equal(ada.phone, '+1 555 0100');
  assert.equal(ada.conversations.length, 2);
  assert.equal(ada.convCount, 1, 'the empty chat is not counted');
  assert.equal(ada.emptyConvCount, 1);
  assert.equal(ada.messageCount, 2);

  // An account that is not in users.json still gets a person, marked unknown.
  const gone = person(api, GONE);
  assert.equal(gone.known, false);
  assert.equal(gone.name, 'Unknown user · c0000000');
  assert.equal(gone.conversations.length, 1);
  assert.equal(gone.conversations[0].owner, gone);

  const byId = id => DB.convById.get(id);
  const title = id => api.convTitle(byId(id));
  assert.equal(byId(conv(1)).name, 'Launch checklist');
  assert.equal(title(conv(1)), 'Launch checklist');
  assert.equal(byId(conv(3)).empty, true);
  assert.equal(byId(conv(1)).empty, false);

  // No name: the first prompt (cut to 70 characters), then Claude's first reply, then uploads.
  // The record keeps the raw name; the title is worked out when shown.
  const c4 = byId(conv(4));
  assert.equal(c4.name, '');
  assert.ok(title(conv(4)).length <= 70 && title(conv(4)).endsWith('…'), title(conv(4)));
  assert.ok(longPrompt.startsWith(title(conv(4)).slice(0, -1)));
  assert.equal(title(conv(5)), '1 uploaded file (not in export)');
  assert.equal(byId(conv(5)).empty, false, 'an upload counts as content');
  assert.equal(title(conv(6)), 'Here is a short summary of the plan.');
  assert.equal(title(conv(3)), 'Untitled conversation');

  // Newest first.
  const times = Array.from(DB.conversations, c => c.lastTs);
  assert.deepEqual(times, times.slice().sort((a, b) => b - a));
});

test('the same conversation in two exports: the newer copy wins', async () => {
  const older = await zip('export-january.zip', { 'conversations.json': [chat(conv(1), ADA, 'Draft plan', 2, '2026-01-10T10:00:00Z')] });
  const newer = await zip('export-february.zip', { 'conversations.json': [chat(conv(1), ADA, 'Final plan', 4, '2026-02-10T10:00:00Z')] });
  for (const order of [[older, newer], [newer, older]]) {
    const { api } = await importFiles([...order, looseFile('users.json', USERS)]);
    const { DB } = api;
    assert.equal(DB.conversations.length, 1);
    const c = DB.conversations[0];
    assert.equal(c.name, 'Final plan');
    assert.equal(c.msgCount, 4);
    assert.equal(c.source, 'export-february.zip');
    assert.equal(person(api, ADA).conversations.length, 1);
    assert.equal(person(api, ADA).messageCount, 4);
  }
});

test('same update time: the copy with more messages wins', async () => {
  const a = await zip('a.zip', { 'conversations.json': [chat(conv(1), ADA, 'Short copy', 2)] });
  const b = await zip('b.zip', { 'conversations.json': [chat(conv(1), ADA, 'Long copy', 3)] });
  for (const order of [[a, b], [b, a]]) {
    const { api } = await importFiles(order);
    assert.equal(api.DB.conversations.length, 1);
    assert.equal(api.DB.conversations[0].name, 'Long copy');
  }
});

/* ---------- Older export formats ---------- */

test('record files are read one record at a time: a broken record keeps the ones before it', async () => {
  // Streamed like conversations.json, so a huge old-format projects.json never becomes one string.
  const good = JSON.stringify({ uuid: proj(1), name: 'Brand refresh', creator: { uuid: BRAM }, docs: [], created_at: '2026-02-01T10:00:00Z' });
  const { api } = await importFiles([
    looseFile('old-export/users.json', USERS),
    looseFile('old-export/projects.json', `[${good}, {"uuid": "broken`),
    looseFile('old-export/memories.json', ''),
  ]);
  assert.deepEqual(plain(api.DB.projects.map(x => x.name)), ['Brand refresh']);
  // The files are read side by side, so the order of the warnings is not fixed.
  const warnings = plain(api.DB.warnings).sort();
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^old-export\/memories\.json: The file is empty\.$/);
  assert.match(warnings[1], /^old-export\/projects\.json: /);
});

test('old formats: projects.json, memories.json and messages without parents', async () => {
  const files = [
    looseFile('old-export/users.json', USERS),
    looseFile('old-export/projects.json', [
      {
        uuid: proj(1), name: 'Brand refresh', description: 'Colours and tone for 2026', is_private: false, is_starter_project: false,
        prompt_template: 'Write in plain English.', created_at: '2026-02-01T10:00:00Z', updated_at: '2026-02-03T10:00:00Z',
        creator: { uuid: BRAM, full_name: 'Bram Okafor' },
        docs: [{ uuid: 'doc-1', filename: 'tone.md', content: '# Tone\nShort sentences.', created_at: '2026-02-01T10:00:00Z' }],
      },
      { uuid: proj(2), name: 'Supplier review', creator: { uuid: IRIS, full_name: 'Iris Vale' }, docs: [], created_at: '2026-02-05T10:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
    ]),
    looseFile('old-export/memories.json', [
      { account_uuid: ADA, conversations_memory: 'Ada runs operations at Northwind Labs.', project_memories: { [proj(1)]: 'Use the blue palette.' } },
    ]),
    looseFile('old-export/conversations.json', [
      conversation(conv(1), ADA, 'Linear chat', [
        { uuid: 'old-1', sender: 'human', text: 'First question', content: [], created_at: '2026-01-05T10:00:00Z' },
        { uuid: 'old-2', sender: 'assistant', text: 'First answer', content: [], created_at: '2026-01-05T10:00:05Z' },
        { uuid: 'old-3', sender: 'human', text: 'Follow-up', content: [], created_at: '2026-01-05T10:01:00Z' },
      ]),
    ]),
  ];
  const { api } = await importFiles(files);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);

  assert.equal(DB.projects.length, 2);
  const brand = DB.projectById.get(proj(1));
  assert.equal(brand.owner, person(api, BRAM));
  assert.equal(brand.isPrivate, false);
  assert.equal(brand.docs.length, 1);
  assert.equal(brand.docs[0].filename, 'tone.md');
  // A creator missing from users.json is named from the project data.
  const iris = person(api, IRIS);
  assert.equal(iris.known, false);
  assert.equal(iris.name, 'Iris Vale');
  assert.equal(iris.projects.length, 1);

  const ada = person(api, ADA);
  assert.equal(DB.memories.length, 1);
  assert.equal(ada.memory.conversationsMemory, 'Ada runs operations at Northwind Labs.');
  assert.deepEqual(plain(ada.memory.projectMemories), [{ projectId: proj(1), text: 'Use the blue palette.' }]);
  assert.equal(ada.memory.files.length, 0);
  assert.equal(ada.memoryCount, 2);

  // Messages without parent_message_uuid are one straight line, in array order.
  const c = DB.convById.get(conv(1));
  assert.equal(c.forks, 0);
  assert.equal(c.name, 'Linear chat');
  assert.equal(api.buildTree(c).linear, true);
  assert.deepEqual(Array.from(api.currentPath(c), m => m.uuid), ['old-1', 'old-2', 'old-3']);
});

test('memory from two exports: the newer copy wins, the older one only fills gaps', async () => {
  const oldMem = looseFile('old/memories.json', [
    { account_uuid: ADA, conversations_memory: 'Old summary.', project_memories: { [proj(1)]: 'Old note.', [proj(2)]: 'Only in the old export.' } },
  ]);
  const newMem = looseFile('new/memories/' + ADA + '.json', {
    account_uuid: ADA, conversations_memory: 'New summary.', project_memories: { [proj(1)]: 'New note.' },
    memory_files: [{ path: 'profile.md', content: 'Ada prefers tables.', updated_at: '2026-05-01T08:00:00Z' }],
  });
  // Two separate loads, in both orders, as if the user added the second export later.
  for (const [first, second] of [[oldMem, newMem], [newMem, oldMem]]) {
    const { api } = await importFiles([first]);
    await api.importExport([second], { set() {} });
    const mem = person(api, ADA).memory;
    assert.equal(mem.conversationsMemory, 'New summary.');
    const notes = Object.fromEntries(Array.from(mem.projectMemories, m => [m.projectId, m.text]));
    assert.deepEqual(notes, { [proj(1)]: 'New note.', [proj(2)]: 'Only in the old export.' });
    assert.equal(mem.files.length, 1);
    assert.equal(api.DB.memories.length, 1);
  }
});

test('search finds text from files added to an open export', async () => {
  const first = looseFile('old/memories.json', [{ account_uuid: ADA, conversations_memory: 'Ada runs operations.', project_memories: {} }]);
  const second = looseFile('new/memories/' + ADA + '.json', {
    account_uuid: ADA, conversations_memory: '', project_memories: {},
    memory_files: [{ path: '/topics/zebra.md', content: 'The zebra crossing project.', updated_at: '2026-05-01T08:00:00Z' }],
  });
  const { api } = await importFiles([first]);
  const search = q => api.runSearch(q, { scope: api.scopeOf(null), signal: new AbortController().signal });
  assert.equal((await search('operations')).memory.length, 1, 'the first search fills the index');
  assert.equal((await search('zebra')).memory.length, 0);
  // The second file is merged into the same memory object, so the index must start again.
  await api.importExport([second], { set() {} });
  const res = await search('zebra');
  assert.equal(res.memory.length, 1);
  assert.match(api.memoryResult(res.memory[0], res.terms), /<mark>zebra<\/mark> crossing/);
});

test('every kind is a full search contract: a list of hits and a result renderer', async () => {
  const { api } = await importFiles([looseFile('users.json', USERS)]);
  const fields = ['key', 'list', 'item', 'icon', 'label', 'noun', 'title', 'allCount', 'personCount', 'listView', 'itemView', 'personTab', 'searchResult'];
  for (const k of api.KINDS) for (const f of fields) assert.ok(k[f], `KINDS.${k.key} has no ${f}`);
  // A new kind that the engine does not search yet still gets an (empty) list, so the search
  // page can draw its tab. Both with and without hits.
  api.KINDS.push({ key: 'notes' });
  for (const q of ['nothing-matches-this', 'Ada']) {
    const res = await api.runSearch(q, { scope: api.scopeOf(null), signal: new AbortController().signal });
    for (const k of api.KINDS) assert.ok(Array.isArray(res[k.key]), `no ${k.key} list for "${q}"`);
    assert.equal(res.notes.length, 0);
    assert.equal(res.people.length, q === 'Ada' ? 1 : 0);
  }
});

/* ---------- Paths, junk, shape sniffing ---------- */

test('Finder-style folder names ("artifacts 2", "design_chats 2") are recognised', async () => {
  const vid = '1767225600-0a1b';
  const files = [
    looseFile('Northwind export/users.json', USERS),
    looseFile(`artifacts 2/${art(1)}/artifact.json`, {
      kind: 'artifact', visibility: 'organization', owner_account: ADA, created_by_agent: false,
      active_version: vid, versions: [{ id: vid, title: 'Stock levels', description: '', created_at: '2026-01-01T00:00:00Z' }],
      updated_at: '2026-01-01T00:00:00Z',
    }),
    looseFile(`artifacts 2/${art(1)}/versions/${vid}.html`, '<!doctype html><title>Stock levels</title><p>Fictional data</p>'),
    looseFile(`design_chats 2/${design(1)}.json`, {
      uuid: design(1), title: 'Packaging mock-up', created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T11:00:00Z',
      project: { uuid: proj(9), name: 'Packaging' },
      messages: [{ role: 'user', created_at: '2026-04-01T10:00:00Z', content: { id: 'x1', content: 'Draw a box', authorAccountUuid: BRAM, authorName: 'Bram Okafor' } }],
    }),
    looseFile(`projects 3/${proj(3)}.json`, { uuid: proj(3), name: 'Hiring plan', creator: { uuid: ADA }, docs: [], updated_at: '2026-02-01T00:00:00Z' }),
    looseFile(`memories 2/${BRAM}.json`, { account_uuid: BRAM, conversations_memory: 'Bram designs packaging.', project_memories: {}, memory_files: [] }),
  ];
  const { api } = await importFiles(files);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  assert.deepEqual(plain(DB.ignored), []);
  assert.equal(DB.artifacts.length, 1);
  assert.equal(DB.artifacts[0].contentType, 'HTML');
  assert.equal(DB.artifacts[0].owner, person(api, ADA));
  assert.equal(DB.artifacts[0].title, 'Stock levels');
  assert.equal(DB.designChats.length, 1);
  assert.equal(DB.designChats[0].owner, person(api, BRAM));
  assert.equal(DB.projects.length, 1);
  assert.equal(person(api, BRAM).memory.conversationsMemory, 'Bram designs packaging.');
});

test('junk files (.DS_Store, __MACOSX, ._*) are skipped without warnings', async () => {
  const garbage = new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0, 0x4d, 0x61, 0x63]);
  const file = await zip('export.zip', {
    'users.json': USERS,
    '.DS_Store': garbage,
    'artifacts/.DS_Store': garbage,
    '__MACOSX/._conversations.json': garbage,
    [`__MACOSX/artifacts/${art(1)}/._artifact.json`]: garbage,
    '._users.json': garbage,
    'Thumbs.db': garbage,
    'README.txt': 'Not export data.',
  });
  const { api } = await importFiles([file, looseFile('picked/.DS_Store', garbage)]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  assert.equal(DB.people.size, 2);
  assert.equal(DB.artifacts.length, 0);
  assert.equal(DB.conversations.length, 0);
  assert.deepEqual(plain(DB.ignored), ['README.txt'], 'only real but unknown files are listed as ignored');
});

test('JSON files with unexpected names are recognised by their shape', async () => {
  const linked = id => conversation(id, BRAM, 'Recovered chat', [message(id.slice(-2) + '-m', 'human', `See https://claude.ai/artifact/${art(1)}`)]);
  const files = [
    looseFile('backup/team-members.json', USERS),
    looseFile('backup/chats-copy.json', [linked(conv(1))]),
    looseFile('backup/one-chat.json', linked(conv(2))),
    // A conversations.json that holds one chat, not a list.
    looseFile('other/conversations.json', linked(conv(3))),
    looseFile('backup/notes.json', { hello: 'world' }),
  ];
  const { api } = await importFiles(files);
  const { DB } = api;
  assert.equal(person(api, BRAM).name, 'Bram Okafor');
  assert.equal(DB.conversations.length, 3);
  // Every chat is read the same way as one in conversations.json: links to artifacts count.
  for (const [n, folder] of [[1, 'backup'], [2, 'backup'], [3, 'other']]) {
    const c = DB.convById.get(conv(n));
    assert.equal(c.owner, person(api, BRAM));
    assert.deepEqual(Array.from(c.artRefs), [art(1)], 'chat ' + n);
    assert.equal(c.outputCount, 1, 'chat ' + n);
    assert.equal(c.source, folder, 'chat ' + n);
  }
  assert.deepEqual(plain(DB.ignored), ['backup/notes.json']);
});

test('a broken zip becomes a warning and the rest still loads', async () => {
  const good = await zip('good.zip', { 'users.json': USERS });
  const bad = new File(['this is not a zip'], 'export-002.zip');
  const { api } = await importFiles([good, bad]);
  assert.equal(api.DB.people.size, 2);
  assert.equal(api.DB.warnings.length, 1);
  assert.match(api.DB.warnings[0], /^export-002\.zip: .*not a ZIP file/);
});

test('nothing recognisable gives a clear error and leaves nothing behind', async () => {
  const app = loadApp();
  const { DB, importExport } = app.api;
  await assert.rejects(importExport([looseFile('holiday.txt', 'photos')], { set() {} }), /No Claude export data found/);
  // When files failed, the error says why (the reason may be the browser, not the files).
  const broken = new File(['this is not a zip'], 'export-002.zip');
  const other = new File(['not one either'], 'export-003.zip');
  await assert.rejects(importExport([looseFile('holiday.txt', 'photos'), broken, other], { set() {} }),
    /^Error: Nothing could be read from what you picked\. export-002\.zip: export-002\.zip is not a ZIP file .* \(1 more problem\)$/);
  // The failed attempt adds no rows to "About this export".
  assert.deepEqual([DB.sources.length, DB.warnings.length, DB.ignored.length], [0, 0, 0]);
  await importExport([looseFile('users.json', USERS)], { set() {} });
  assert.deepEqual(plain(DB.sources).map(s => s.name), ['1 loose file']);
  assert.deepEqual(plain(DB.ignored), []);
  assert.deepEqual(plain(DB.warnings), []);
});

/* ---------- Design chats ---------- */

function designMsg(role, content, at = '2026-04-01T10:00:00Z') {
  return { role, created_at: at, content };
}

test('design chats: duplicate rows are merged and the owner typed the most', async () => {
  const d1 = {
    uuid: design(1), title: 'Chat', created_at: '2026-04-01T09:59:00Z', updated_at: '2026-04-01T12:00:00Z',
    project: { uuid: proj(5), name: 'Spring landing page' },
    messages: [
      // An automatic "pill" message: Ada appears first, but it is not typed by her.
      designMsg('user', { id: 'm1', content: 'Apply drawing', authorAccountUuid: ADA, authorName: 'Ada Fernsby', pill: true }),
      // The same message saved twice: server copy (with author) and client copy (with the attachment).
      designMsg('user', { id: 'm2', content: 'Make a hero section for the spring sale', authorAccountUuid: BRAM, authorName: 'Bram Okafor' }),
      designMsg('user', { id: 'm2', content: 'Make a hero section for the spring sale', attachments: [{ id: 'att-1', name: 'logo.svg' }] }),
      designMsg('assistant', { id: 'm3', content: 'Here is a first version.' }),
      // Name only: resolved to Ada through the other messages in this chat.
      designMsg('user', { id: 'm4', content: 'Use the brand blue', authorName: 'ada fernsby' }),
      designMsg('user', { id: 'm5', content: 'Make the button larger', authorAccountUuid: BRAM, authorName: 'Bram Okafor' }, '2026-04-01T11:30:00Z'),
    ],
  };
  const d2 = {
    uuid: design(2), title: 'Footer ideas', created_at: '2026-04-02T10:00:00Z', updated_at: '2026-04-02T10:30:00Z', project: null,
    messages: [
      designMsg('user', { id: 'n1', content: 'Three footer layouts please', authorAccountUuid: ADA, authorName: 'Ada Fernsby' }),
      designMsg('user', { id: 'n2', content: 'Add a newsletter box', authorAccountUuid: BRAM, authorName: 'Bram Okafor' }),
    ],
  };
  const d3 = { uuid: design(3), title: '', created_at: '2026-04-03T10:00:00Z', updated_at: '2026-04-03T10:00:00Z', project: { uuid: proj(6), name: 'Empty board' }, messages: [] };
  const file = await zip('design.zip', {
    'users.json': USERS,
    [`design_chats/${design(1)}.json`]: d1,
    [`design_chats/${design(2)}.json`]: d2,
    [`design_chats/${design(3)}.json`]: d3,
  });
  const { api } = await importFiles([file]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  const ada = person(api, ADA), bram = person(api, BRAM);

  const c1 = DB.designById.get(design(1));
  assert.equal(c1.msgCount, 5, 'the two copies of m2 are one message');
  const merged = c1.messages[1].content;
  assert.equal(merged.authorAccountUuid, BRAM);
  assert.deepEqual(Array.from(merged.attachments, a => a.id), ['att-1']);
  assert.equal(c1.owner, bram, 'Bram typed two messages, Ada one (the pill does not count)');
  assert.deepEqual(Array.from(c1.authors, p => p.id), [BRAM, ADA]);
  assert.equal(c1.name, 'Chat', 'the record keeps the raw name');
  assert.equal(api.designTitle(c1), 'Make a hero section for the spring sale', '"Chat" is replaced by the first typed prompt');
  assert.equal(c1.project.name, 'Spring landing page');
  assert.ok(ada.designChats.includes(c1) && bram.designChats.includes(c1));

  // A tie goes to whoever wrote first.
  const c2 = DB.designById.get(design(2));
  assert.equal(c2.owner, ada);
  assert.equal(api.designTitle(c2), 'Footer ideas');

  // No authors at all: owned by the "No owner" placeholder, titled after the project.
  const c3 = DB.designById.get(design(3));
  assert.equal(c3.owner.system, true);
  assert.equal(c3.owner.name, 'No owner');
  assert.equal(api.designTitle(c3), 'Empty board');
});

/* ---------- Memory files ---------- */

test('memory file frontmatter: values with ": " and quoted aliases', async () => {
  const content = [
    '---',
    'name: Bram Okafor',
    'description: Design lead: owns the brand kit, reviews: all launches',
    'aliases: ["Bram", "B. Okafor, design"]',
    'tags: [design, brand ]',
    'nickname: "Bram O."',
    'source: chat',
    '---',
    '# Bram',
    '',
    'Prefers short briefs.',
    '',
  ].join('\n');
  const file = looseFile(`memories/${ADA}.json`, {
    account_uuid: ADA, conversations_memory: '', project_memories: {},
    memory_files: [
      { path: 'people/bram-okafor.md', content, updated_at: '2026-05-01T08:00:00Z' },
      { path: 'profile.md', content: 'No frontmatter here.', updated_at: '2026-05-02T08:00:00Z' },
    ],
  });
  const { api } = await importFiles([file]);
  const mem = person(api, ADA).memory;
  assert.deepEqual(Array.from(mem.files, f => f.path), ['people/bram-okafor.md', 'profile.md']);
  const bram = mem.files[0];
  assert.equal(bram.stem, 'bram-okafor');
  assert.deepEqual(plain(bram.meta), {
    name: 'Bram Okafor',
    description: 'Design lead: owns the brand kit, reviews: all launches',
    aliases: ['Bram', 'B. Okafor, design'],
    tags: ['design', 'brand'],
    nickname: 'Bram O.',
    source: 'chat',
  });
  assert.equal(bram.body, '# Bram\n\nPrefers short briefs.\n');
  assert.deepEqual(plain(mem.files[1].meta), {});
  assert.equal(mem.files[1].body, 'No frontmatter here.');
  assert.equal(mem.updated, Date.parse('2026-05-02T08:00:00Z'));
  assert.equal(person(api, ADA).memoryCount, 2);
});

/* ---------- Artifacts ---------- */

const V = n => '17672256' + String(n).padStart(2, '0') + '-0a1b';

function artifactJson(owner, versions, extra = {}) {
  return {
    kind: 'artifact', visibility: 'private', owner_account: owner, created_by_agent: false, shared_with: null,
    active_version: versions[versions.length - 1].id,
    versions: versions.map(v => ({ title: '', description: '', created_at: '2026-01-01T00:00:00Z', ...v })),
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

const typedRuntime = name => ({
  'SKILL.md': `---\nname: ${name}\ndescription: How to fill a fictional ${name} type.\n---\nInstructions.`,
  'artifact-type/app.js': 'console.log("runtime")',
  'artifact-type/app.css': 'body{}',
});

function versionFolder(id, vid, files) {
  const out = { [`artifacts/${id}/versions/${vid}.files.json`]: Object.keys(files).map(path => ({ path })) };
  for (const [path, content] of Object.entries(files)) out[`artifacts/${id}/versions/${vid}/${path}`] = content;
  return out;
}

test('artifact content type is detected from the active version', async () => {
  const entries = {
    'users.json': USERS,
    // Single HTML file; titles arrive HTML-escaped.
    [`artifacts/${art(1)}/artifact.json`]: artifactJson(ADA, [{ id: V(1), title: 'Sales &amp; ops dashboard', description: 'Weekly numbers &amp; trends' }]),
    [`artifacts/${art(1)}/versions/${V(1)}.html`]: '<!doctype html><title>Dashboard</title>',
    // Folder with index.html and assets.
    [`artifacts/${art(2)}/artifact.json`]: artifactJson(ADA, [{ id: V(2), title: 'Route planner' }]),
    ...versionFolder(art(2), V(2), { 'index.html': '<!doctype html><script src="assets/app.js"></script>', 'assets/app.js': 'void 0' }),
    // Typed Slides deck.
    [`artifacts/${art(3)}/artifact.json`]: artifactJson(BRAM, [{ id: V(3), title: 'Quarterly review' }]),
    ...versionFolder(art(3), V(3), { ...typedRuntime('slides'), 'project/deck.json': { v: 4, title: 'Quarterly review', order: ['cover'] }, 'project/slides/cover.html': '<section id="cover"></section>' }),
    // Typed Design canvas.
    [`artifacts/${art(4)}/artifact.json`]: artifactJson(BRAM, [{ id: V(4), title: 'Shelf labels' }]),
    ...versionFolder(art(4), V(4), { ...typedRuntime('design'), 'project/canvas.json': { boards: [] } }),
    // Typed, but the content lived in claude.ai's database and was not exported.
    [`artifacts/${art(5)}/artifact.json`]: artifactJson(ADA, [{ id: V(5), title: 'Empty deck' }]),
    ...versionFolder(art(5), V(5), typedRuntime('slides')),
    // A page (Claude Docs): page.md, no version files.
    [`artifacts/${art(6)}/artifact.json`]: artifactJson(ADA, [{ id: V(6), title: 'Team handbook' }], { kind: 'page' }),
    [`artifacts/${art(6)}/page.md`]: '# Team handbook\n\n<!-- tab: Welcome -->\nHello.',
    [`artifacts/${art(6)}/comments.json`]: [],
    // Older single-file version, newer folder version: the active (newest) one decides.
    [`artifacts/${art(7)}/artifact.json`]: artifactJson(ADA, [{ id: V(7), title: 'Old' }, { id: V(8), title: 'Price list', created_at: '2026-01-05T00:00:00Z' }]),
    [`artifacts/${art(7)}/versions/${V(7)}.html`]: '<!doctype html><p>v1</p>',
    ...versionFolder(art(7), V(8), { 'index.html': '<!doctype html><p>v2</p>' }),
    // Files only, no artifact.json (a partial export). A stray file under versions/ is not a version.
    [`artifacts/${art(8)}/versions/1767225600-aaaa.html`]: '<p>first</p>',
    [`artifacts/${art(8)}/versions/1767312000-bbbb.html`]: '<p>second</p>',
    [`artifacts/${art(8)}/versions/readme.txt`]: 'Fictional notes',
  };
  const { api } = await importFiles([await zip('artifacts.zip', entries)]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  const a = n => DB.artifactById.get(art(n));
  const types = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, a(n).contentType]));
  assert.deepEqual(types, {
    1: 'HTML', 2: 'HTML + files', 3: 'Slides', 4: 'Design', 5: 'App (data not exported)', 6: 'Doc', 7: 'HTML + files', 8: 'HTML',
  });

  assert.equal(a(1).title, 'Sales & ops dashboard');
  assert.equal(a(1).description, 'Weekly numbers & trends');
  assert.equal(a(1).owner, person(api, ADA));
  assert.equal(api.versionInfo(a(5), V(5)).typedEmpty, true);
  assert.equal(api.versionInfo(a(3), V(3)).typedEmpty, undefined);
  assert.ok(a(6).pageNode, 'the page keeps a handle to page.md');
  assert.equal(api.versionInfo(a(7), V(7)).type, 'HTML', 'each version is classified on its own');
  assert.equal(a(7).title, 'Price list');
  assert.equal(a(7).updated, Date.parse('2026-01-05T00:00:00Z'), 'the newest version counts as the last update');

  // Without artifact.json: versions come from the file names, newest first; no owner.
  const partial = a(8);
  assert.deepEqual(Array.from(partial.versions, v => v.id), ['1767312000-bbbb', '1767225600-aaaa']);
  assert.equal(partial.activeVersion, '1767312000-bbbb');
  assert.equal(partial.versions[0].created, 1767312000 * 1000);
  assert.equal(partial.title, '');
  assert.equal(api.artifactTitle(partial), 'Untitled artifact');
  assert.equal(partial.owner.system, true);
  // Its dates come from its versions, so it sorts in its real place (second), not last.
  assert.equal(partial.created, 1767225600 * 1000);
  assert.equal(partial.updated, 1767312000 * 1000);
  assert.deepEqual(plain(DB.artifacts.slice(0, 2).map(x => x.id)), [art(7), art(8)]);

  assert.equal(person(api, ADA).artifacts.length, 5);
  assert.equal(person(api, BRAM).artifacts.length, 2);
});

test('platform files: one rule for the Files tab and the person zip', async () => {
  const entries = {
    'users.json': USERS,
    [`artifacts/${art(5)}/artifact.json`]: artifactJson(ADA, [{ id: V(5), title: 'Skill kit' }]),
    ...versionFolder(art(5), V(5), {
      ...typedRuntime('slides'),   // SKILL.md and artifact-type/ at the top: the app's runtime
      'index.html': '<!doctype html>',
      'docs/SKILL.md': '# A skill the person wrote',
      'SKILL.md.bak': 'Old notes',
    }),
  };
  const { api } = await importFiles([await zip('skills.zip', entries)]);
  const a = api.DB.artifactById.get(art(5));
  // Files tab: platform files sit in the folded "platform files" block, the rest above it.
  const [shown, folded] = api.versionFilesHtml(V(5), api.versionInfo(a, V(5))).split('platform files');
  for (const p of ['index.html', 'docs/SKILL.md', 'SKILL.md.bak']) assert.ok(shown.includes('>' + p + '<'), p);
  for (const p of ['SKILL.md', 'artifact-type/app.js', 'artifact-type/app.css']) assert.ok(folded.includes('>' + p + '<'), p);
  // Person zip: the same platform files are left out.
  const blob = await api.buildPersonZip(person(api, ADA), { allVersions: false }, () => {}, () => false);
  const out = await api.ZipArchive.open(new File([blob], 'ada.zip'));
  const files = Array.from(out.entries, e => e.name.split(`/versions/${V(5)}/`)[1]).filter(Boolean).sort();
  assert.deepEqual(files, ['SKILL.md.bak', 'docs/SKILL.md', 'index.html']);
});

test('an artifact split across two zips is merged by path', async () => {
  const meta = artifactJson(ADA, [{ id: V(1), title: 'Split report' }]);
  const first = await zip('frames-000.zip', {
    [`artifacts/${art(1)}/artifact.json`]: meta,
    [`artifacts/${art(1)}/versions/${V(1)}.files.json`]: [],
    [`artifacts/${art(1)}/versions/${V(1)}/index.html`]: '<!doctype html>',
  });
  const second = await zip('frames-001.zip', {
    [`artifacts/${art(1)}/artifact.json`]: meta,
    [`artifacts/${art(1)}/versions/${V(1)}/index.html`]: '<!doctype html>',
    [`artifacts/${art(1)}/versions/${V(1)}/img/chart.svg`]: '<svg></svg>',
  });
  const { api } = await importFiles([first, second]);
  assert.equal(api.DB.artifacts.length, 1);
  const a = api.DB.artifacts[0];
  assert.deepEqual(Array.from(a.files.keys()).sort(), [
    'artifact.json', `versions/${V(1)}.files.json`, `versions/${V(1)}/img/chart.svg`, `versions/${V(1)}/index.html`,
  ]);
  assert.equal(a.contentType, 'HTML + files');
});

test('a preview is built again when a later load adds files to its version', async () => {
  // One version split across two zips, loaded one after the other: the second zip brings
  // the image that index.html uses, so the build cached before it must not come back.
  const first = await zip('frames-000.zip', {
    [`artifacts/${art(1)}/artifact.json`]: artifactJson(ADA, [{ id: V(1), title: 'Split chart' }]),
    [`artifacts/${art(1)}/versions/${V(1)}/index.html`]: '<!doctype html><html><head></head><body><img src="chart.svg"></body></html>',
  });
  const second = await zip('frames-001.zip', {
    [`artifacts/${art(1)}/versions/${V(1)}/chart.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  });
  const { api } = await importFiles([first]);
  const build = () => {
    const a = api.DB.artifactById.get(art(1));
    return api.getBuilt(a, V(1), api.versionInfo(a, V(1)), '');
  };
  const before = await build();
  assert.doesNotMatch(before.html, /data:image\/svg/);
  assert.equal(await build(), before, 'switching tabs reuses the build');
  await api.importExport([second], { set() {} });
  const after = await build();
  assert.notEqual(after, before);
  assert.match(after.html, /<img src="data:image\/svg\+xml;base64,/);
});

test('a newer export of an artifact brings its title, versions, page and comments, in any order', async () => {
  const doc = (title, versions, updated, page, comment) => zip(`export-${title}.zip`, {
    [`artifacts/${art(1)}/artifact.json`]: artifactJson(ADA, versions.map(([id, at]) => ({ id, title, created_at: at })), { kind: 'page', updated_at: updated }),
    [`artifacts/${art(1)}/page.md`]: page,
    [`artifacts/${art(1)}/comments.json`]: [{ comments: [{ author: { uuid: BRAM }, body: comment, created_at: updated }] }],
  });
  // The old artifact.json has an updated_at older than its own version, so the newest time
  // of each copy (its version or its updated_at) decides which copy is newer.
  const older = await doc('Old', [[V(1), '2026-03-01T00:00:00Z']], '2026-01-10T00:00:00Z', 'OLD PAGE', 'Old comment');
  const newer = await doc('New', [[V(1), '2026-03-01T00:00:00Z'], [V(2), '2026-04-01T00:00:00Z']], '2026-02-10T00:00:00Z', 'NEW PAGE', 'New comment');
  const check = async (api, how) => {
    const a = api.DB.artifactById.get(art(1));
    assert.equal(a.title, 'New', how);
    assert.deepEqual(Array.from(a.versions, v => v.id), [V(1), V(2)], how);
    assert.equal(await a.pageNode.text(), 'NEW PAGE', how);
    assert.deepEqual(Array.from(a.comments, t => t.comments[0].body), ['New comment'], how);
    assert.deepEqual(Array.from(person(api, BRAM).comments, c => c.comment.body), ['New comment'], how);
  };
  for (const [first, second] of [[older, newer], [newer, older]]) {
    const how = first === older ? 'old first' : 'new first';
    const { api } = await importFiles([first]);
    await api.importExport([second], { set() {} });
    await check(api, how + ', two loads');
    await check((await importFiles([first, second])).api, how + ', one load');
  }
});

test('an untitled artifact gets the same fallback title in any load order', async () => {
  // No artifact.json: the versions come first, and page.md arrives in a later load.
  const versions = await zip('frames-000.zip', { [`artifacts/${art(1)}/versions/${V(1)}.html`]: '<p>Fictional</p>' });
  const page = await zip('frames-001.zip', { [`artifacts/${art(1)}/page.md`]: '# Notes' });
  const { api } = await importFiles([versions]);
  const a = () => api.DB.artifactById.get(art(1));
  assert.equal(api.artifactTitle(a()), 'Untitled artifact');
  await api.importExport([page], { set() {} });
  assert.equal(api.artifactTitle(a()), 'Untitled page', 'two loads');
  assert.equal(a().title, '', 'the fallback is not stored in the imported title');
  const both = (await importFiles([versions, page])).api;
  assert.equal(both.artifactTitle(both.DB.artifactById.get(art(1))), 'Untitled page', 'one load');
});

/* ---------- Comments ---------- */

function pageWithComments() {
  return {
    'users.json': USERS,
    [`artifacts/${art(1)}/artifact.json`]: artifactJson(ADA, [{ id: V(1), title: 'Launch plan' }], { kind: 'page' }),
    [`artifacts/${art(1)}/page.md`]: '# Launch plan\n\n<!-- tab: Overview -->\nThe ship date is in May.',
    [`artifacts/${art(1)}/comments.json`]: [{
      resolved: false, tab: 'Overview', quoted_text: 'ship date',
      comments: [
        { author: { uuid: BRAM, full_name: 'Bram Okafor' }, body: 'Is this date fixed?', created_at: '2026-05-01T10:00:00Z', posted_by_agent: false },
        { author: { uuid: ADA, full_name: 'Ada Fernsby' }, body: 'Yes.', created_at: '2026-05-01T11:00:00Z', posted_by_agent: false },
        { author: { uuid: ADA, full_name: 'Ada Fernsby' }, body: 'Summary of the thread.', created_at: '2026-05-01T12:00:00Z', posted_by_agent: true },
      ],
    }],
    // The same doc question again (author_role "page"), plus comments only this file has.
    [`artifacts/${art(1)}/artifact_comments.json`]: {
      threads: [{
        created_at: '2026-05-01T10:00:00Z', resolved: true, carried: true,
        comments: [
          { author_role: 'page', author_is_artifact_owner: true, text: 'Is this date fixed?', created_at: '2026-05-01T10:00:00Z' },
          { author_role: '', author_is_artifact_owner: true, text: 'Owner note to Claude', created_at: '2026-05-02T10:00:00Z' },
          { author_role: 'assistant', author_is_artifact_owner: true, text: 'Claude reply', created_at: '2026-05-02T10:01:00Z' },
          { author_role: '', author_is_artifact_owner: false, text: 'Someone else', created_at: '2026-05-02T10:02:00Z' },
        ],
      }],
    },
    // An artifact with no comments.json: nothing to repeat, so "page" comments count.
    [`artifacts/${art(2)}/artifact.json`]: artifactJson(BRAM, [{ id: V(2), title: 'Map' }]),
    [`artifacts/${art(2)}/versions/${V(2)}.html`]: '<!doctype html>',
    [`artifacts/${art(2)}/artifact_comments.json`]: {
      threads: [{ comments: [{ author_role: 'page', author_is_artifact_owner: true, text: 'Move the legend', created_at: '2026-05-03T10:00:00Z' }] }],
    },
  };
}

test('comments: thread copies of page comments are not counted twice', async () => {
  const { api } = await importFiles([await zip('pages.zip', pageWithComments())]);
  const ada = person(api, ADA), bram = person(api, BRAM);
  const texts = p => Array.from(p.comments, c => c.comment.body || c.comment.text).sort();

  assert.deepEqual(texts(ada), ['Owner note to Claude', 'Summary of the thread.', 'Yes.']);
  assert.deepEqual(texts(bram), ['Is this date fixed?', 'Move the legend']);
  assert.equal(ada.comments.find(c => c.comment.posted_by_agent).byAgent, true);
  // total: 1 artifact + 2 comments typed by Ada (the agent's one is not hers).
  assert.equal(ada.total, 3);
  // Newest first.
  assert.equal(ada.comments[0].comment.text, 'Owner note to Claude');
});

/* ---------- Reloading ---------- */

test('finalize() is idempotent: loading more files never double-counts', async () => {
  const people = [
    ...USERS,
    { uuid: 'a1000000-0000-4000-8000-000000000011', full_name: 'Sam Lee', email_address: 'sam.lee@northwind.example' },
    { uuid: 'a1000000-0000-4000-8000-000000000012', full_name: 'Sam Lee', email_address: 'samuel@northwind.example' },
  ];
  const first = await zip('export-000.zip', {
    ...pageWithComments(),
    'users.json': people,
    'conversations.json': [chat(conv(1), ADA, 'One', 2), chat(conv(2), ADA, 'Two', 3), chat(conv(3), BRAM, 'Three', 2)],
  });
  const second = await zip('export-001.zip', {
    [`projects/${proj(1)}.json`]: { uuid: proj(1), name: 'Brand refresh', creator: { uuid: ADA }, docs: [], updated_at: '2026-02-01T00:00:00Z' },
    [`memories/${ADA}.json`]: { account_uuid: ADA, conversations_memory: 'Summary.', project_memories: {}, memory_files: [] },
  });

  const app = loadApp();
  const { DB, importExport, finalize } = app.api;
  const snapshot = () => {
    const ada = DB.people.get(ADA);
    return {
      conversations: DB.conversations.length, artifacts: DB.artifacts.length, people: DB.people.size,
      adaConvs: ada.conversations.length, adaMsgs: ada.messageCount, adaComments: ada.comments.length,
      adaArtifacts: ada.artifacts.length, bramComments: DB.people.get(BRAM).comments.length,
      names: Array.from(DB.people.values(), p => p.name).sort(),
    };
  };

  await importExport([first], { set() {} });
  const before = snapshot();
  assert.deepEqual(before.names, ['Ada Fernsby', 'Bram Okafor', 'Sam Lee · sam.lee', 'Sam Lee · samuel']);
  assert.equal(before.adaConvs, 2);
  assert.equal(before.adaMsgs, 5);

  await importExport([second], { set() {} });
  assert.deepEqual(snapshot(), before, 'new projects and memory do not change existing counts');
  assert.equal(DB.people.get(ADA).projects.length, 1);
  assert.ok(DB.people.get(ADA).memory);
  const total = DB.people.get(ADA).total;

  finalize();
  finalize();
  assert.deepEqual(snapshot(), before);
  assert.equal(DB.people.get(ADA).total, total);

  // The very same zip again: everything is already known.
  await importExport([first], { set() {} });
  assert.deepEqual(snapshot(), before);
  assert.equal(DB.people.get(ADA).total, total);
});

/* ---------- Display names ---------- */

test('display names: email fallback and duplicate names', async () => {
  const DANA = 'a2000000-0000-4000-8000-000000000021';
  const SAM1 = 'a2000000-0000-4000-8000-000000000022';
  const SAM2 = 'a2000000-0000-4000-8000-000000000023';
  const LEE = 'a2000000-0000-4000-8000-000000000024';
  const { api } = await importFiles([looseFile('users.json', [
    { uuid: DANA, full_name: null, email_address: 'dana.whitfield@northwind.example' },
    { uuid: SAM1, full_name: 'Sam Lee', email_address: 'sam.lee@northwind.example' },
    { uuid: SAM2, full_name: 'sam lee ', email_address: 'samuel.lee@northwind.example' },
    { uuid: LEE, full_name: 'Lee Park', email_address: 'lee@northwind.example' },
  ])]);
  const name = id => person(api, id).name;
  assert.equal(name(DANA), 'dana.whitfield');
  assert.equal(name(SAM1), 'Sam Lee · sam.lee');
  assert.equal(name(SAM2), 'sam lee · samuel.lee', 'names are compared without case or outer spaces');
  assert.equal(name(LEE), 'Lee Park');
});

/* ---------- Encoding and the manifest ---------- */

test('files that start with a UTF-8 byte order mark load', async () => {
  const bom = s => '﻿' + JSON.stringify(s);
  const file = await zip('bom.zip', {
    'users.json': bom(USERS),
    'conversations.json': bom([chat(conv(1), ADA, 'With BOM', 2)]),
    [`projects/${proj(1)}.json`]: bom({ uuid: proj(1), name: 'BOM project', creator: { uuid: ADA }, docs: [] }),
  });
  const { api } = await importFiles([file]);
  assert.deepEqual(plain(api.DB.warnings), []);
  assert.equal(person(api, ADA).name, 'Ada Fernsby');
  assert.equal(api.DB.conversations[0].name, 'With BOM');
  assert.equal(api.DB.projects[0].name, 'BOM project');
});

test('manifest download links: only https://claude.ai/export/ links are kept', async () => {
  const manifest = {
    created_at: '2026-10-01T10:00:00Z', total_files: 4, version: 1,
    data_files: [
      { category: 'conversations', part: 0, filename: 'conversations-000.zip', export_url: 'https://claude.ai/export/fictional-token-1' },
      { category: 'artifacts', part: 0, filename: 'frames-000.zip', export_url: 'javascript:alert(1)' },
      { category: 'artifacts', part: 1, filename: 'frames-001.zip', export_url: 'https://evil.example/claude.ai/export/x' },
      { category: 'design', part: 0, filename: 'design-000.zip', export_url: 'http://claude.ai/export/not-https' },
    ],
  };
  const { api } = await importFiles([looseFile('manifest-2026-10-01.json', manifest)]);
  const m = api.latestManifest();
  assert.equal(m.totalFiles, 4);
  assert.deepEqual(Array.from(m.files, f => f.url), ['https://claude.ai/export/fictional-token-1', '', '', '']);
  assert.deepEqual(Array.from(m.files, f => f.filename), ['conversations-000.zip', 'frames-000.zip', 'frames-001.zip', 'design-000.zip']);
});

test('conversation stats: branch points, tool calls, outputs and links to artifacts', async () => {
  const root = '00000000-0000-4000-8000-000000000000';
  const link = `https://claude.ai/artifact/${art(1)}`;
  const c = conversation(conv(1), ADA, 'Build a tracker', [
    message('k1', 'human', 'Make a stock tracker', { parent_message_uuid: root, files: [{ file_name: 'stock.csv' }] }),
    message('k2', 'assistant', '', {
      parent_message_uuid: 'k1',
      content: [
        { type: 'text', text: 'Here it is.' },
        { type: 'tool_use', name: 'create_file', input: { path: '/tmp/out/tracker.html' } },
        { type: 'tool_use', name: 'web_search', input: { query: 'fictional query' } },
      ],
    }),
    message('k3', 'human', 'Publish it', { parent_message_uuid: 'k2' }),
    message('k4', 'assistant', `Published: ${link}`, { parent_message_uuid: 'k3' }),
    message('k3b', 'human', 'Actually, make it blue', { parent_message_uuid: 'k2' }),
  ]);
  const file = await zip('stats.zip', {
    'users.json': USERS,
    'conversations.json': [c],
    [`artifacts/${art(1)}/artifact.json`]: artifactJson(ADA, [{ id: V(1), title: 'Stock tracker' }]),
    [`artifacts/${art(1)}/versions/${V(1)}.html`]: '<!doctype html>',
  });
  const { api } = await importFiles([file]);
  const got = api.DB.convById.get(conv(1));
  assert.equal(got.msgCount, 5);
  assert.equal(got.fileCount, 1);
  assert.equal(got.toolCount, 2);
  assert.equal(got.forks, 1, 'k2 has two replies');
  assert.equal(got.outputCount, 2, 'one created file and one published artifact link');
  assert.deepEqual(Array.from(got.artRefs), [art(1)]);
  const a = api.DB.artifactById.get(art(1));
  assert.deepEqual(Array.from(a.mentionedIn, x => x.id), [conv(1)]);
});

test('the person zip has the newest branch of a chat, whatever branch this tab shows', async () => {
  const root = '00000000-0000-4000-8000-000000000000';
  const c = conversation(conv(7), ADA, 'Two tries', [
    message('t1', 'human', 'First question', { parent_message_uuid: root }),
    message('t2', 'assistant', 'First answer', { parent_message_uuid: 't1' }),
    message('t1b', 'human', 'Edited question', { parent_message_uuid: root }),
    message('t2b', 'assistant', 'Newest answer', { parent_message_uuid: 't1b' }),
  ]);
  const { api } = await importFiles([looseFile('users.json', USERS), looseFile('conversations.json', [c])]);
  const got = api.DB.convById.get(conv(7));
  api.selectBranchFor(got, 't2');   // the older branch is open in the thread
  assert.match(api.convToMarkdown(got, api.currentPath(got)), /First answer/);
  const blob = await api.buildPersonZip(person(api, ADA), { allVersions: false }, () => {}, () => false);
  const out = await api.ZipArchive.open(new File([blob], 'ada.zip'));
  const md = await out.entries.find(e => /^conversations\/.*\.md$/.test(e.name)).text();
  assert.match(md, /Newest answer/);
  assert.doesNotMatch(md, /First answer/);
});

test('the branch and output badges count what the thread and the outputs box show', async () => {
  const c = conversation(conv(2), ADA, 'Odd chat', [
    // No parent, and a parent that is not in the export: the thread shows both as branches of the start.
    message('o1', 'human', 'First try', { parent_message_uuid: null }),
    message('o2', 'assistant', '', {
      parent_message_uuid: 'o1',
      content: [
        { type: 'tool_use', name: 'create_file', input: { path: '/tmp/out/plan.md' } },
        { type: 'tool_use', name: 'create_file', input: {} },   // no path: the box leaves it out
      ],
    }),
    message('o3', 'human', 'Second try', { parent_message_uuid: 'deleted-message' }),
    message('o4', 'assistant', 'Answer', { parent_message_uuid: 'o3' }),
  ]);
  const { api } = await importFiles([looseFile('conversations.json', [c])]);
  const got = api.DB.convById.get(conv(2));
  const t = api.buildTree(got);
  assert.equal(got.forks, Array.from(t.children.values()).filter(kids => kids.length > 1).length);
  assert.equal(got.forks, 1);
  assert.equal(got.outputCount, api.collectOutputs(got).length);
  assert.equal(got.outputCount, 1);
});

test('each output tool counts in the badge, shows in the outputs box and is written to Markdown', async () => {
  const c = conversation(conv(8), ADA, 'Outputs', [
    message('u1', 'human', 'Make the launch kit'),
    message('u2', 'assistant', '', {
      content: [
        { type: 'tool_use', id: 't1', name: 'create_file', input: { path: '/tmp/out/plan.md', file_text: '# Plan\n```js\nx\n```' } },
        { type: 'tool_use', id: 't2', name: 'artifacts', input: { title: 'Board', content: 'Board text', type: 'text/markdown' } },
        { type: 'tool_use', id: 't3', name: 'visualize:show_widget', input: { title: 'Sales chart', widget_code: '<svg></svg>' } },
        { type: 'tool_use', id: 't4', name: 'message_compose_v1', input: { summary_title: 'Reply to Bram', variants: [{ label: 'Warm', subject: 'Hello', body: 'Thanks, Bram.' }] } },
        { type: 'tool_use', id: 't5', name: 'present_files', input: { filepaths: ['/tmp/out/plan.md'] } },
        { type: 'tool_use', id: 't6', name: 'web_search', input: { query: 'fictional query' } },
      ],
    }),
  ]);
  const { api } = await importFiles([looseFile('users.json', USERS), looseFile('conversations.json', [c])]);
  const got = api.DB.convById.get(conv(8));
  assert.equal(got.outputCount, 4, 'the file, the artifact, the widget and the draft');
  assert.deepEqual(plain(api.collectOutputs(got).map(o => api.TOOLS.get(o.use.name).chip(o.use.input))), [
    { ico: '📄', label: 'plan.md', kind: 'file' },
    { ico: '◧', label: 'Board', kind: 'artifact' },
    { ico: '▦', label: 'Sales chart', kind: 'widget' },
    { ico: '✉', label: 'Reply to Bram', kind: 'draft' },
  ]);
  const md = api.convToMarkdown(got, api.currentPath(got));
  assert.ok(md.includes('> ⚙ present_files: plan.md\n'), 'present_files names its files');
  assert.ok(md.includes('````md\n# Plan\n```js\nx\n```\n````'), 'the file, in a fence longer than any inside it');
  assert.ok(md.includes('**Artifact: Board**\n\nBoard text'));
  assert.ok(md.includes('_Interactive widget: Sales chart_'));
  assert.ok(md.includes('**Draft — Warm: Reply to Bram**\n\nSubject: Hello\n\nThanks, Bram.'));
  assert.ok(md.includes('> ⚙ web_search: fictional query\n'));
});
