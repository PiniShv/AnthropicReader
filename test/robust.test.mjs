// Broken records: one bad record must never cost the rest of its file or the whole load, and a
// load that fails anyway must leave the export that was open as it was. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importFiles, looseFile, plain, quietUi, zipFile, BUILD_ORDER } from './harness.mjs';

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERSON = U(100);
const T = '2026-03-01T09:00:00.000000Z';
const users = (name = 'Ada Fernsby') => looseFile('x/users.json', [{ uuid: PERSON, full_name: name, email_address: 'ada@northwind.example' }]);
const message = (n, text) => ({ uuid: U(n), sender: 'human', text, content: [{ type: 'text', text }], created_at: T });
const conversation = (n, name, msgs) => ({ uuid: U(n), name, created_at: T, updated_at: T, account: { uuid: PERSON }, chat_messages: msgs });

test('a null message does not cost the rest of conversations.json', async () => {
  const { api } = await importFiles([looseFile('x/conversations.json', [
    conversation(1, 'first', [message(11, 'hi')]),
    conversation(2, 'bad', [null, message(21, 'still here'), 7]),
    conversation(3, 'third', [message(31, 'yo')]),
  ])]);
  assert.deepEqual(plain(api.DB.warnings), []);
  assert.deepEqual(plain(api.DB.conversations.map(c => c.title).sort()), ['bad', 'first', 'third']);
  // The views read the messages from raw, so raw holds the readable ones only.
  const bad = api.DB.convById.get(U(2));
  assert.equal(bad.msgCount, 1);
  assert.deepEqual(plain(bad.raw.chat_messages.map(m => m.uuid)), [U(21)]);
  // A clean chat keeps its original JSON object.
  const first = api.DB.convById.get(U(1));
  assert.equal(first.raw.chat_messages.length, 1);
});

test('records that are not objects are skipped with one warning each, and the rest load', async () => {
  const { api } = await importFiles([looseFile('x/conversations.json', [conversation(1, 'a', [message(11, 'hi')]), null, 5, 'text', conversation(2, 'b', [])])]);
  assert.equal(api.DB.conversations.length, 2);
  assert.deepEqual(plain(api.DB.warnings), [2, 3, 4].map(n => `x/conversations.json: record ${n} was skipped: it is not an object`));
});

test('after five skipped records of a file, one warning counts the rest', async () => {
  const { api } = await importFiles([users(), looseFile('x/conversations.json', [null, null, null, null, null, null, null, conversation(1, 'ok', [])])]);
  assert.equal(api.DB.conversations.length, 1);
  assert.equal(api.DB.warnings.length, 6);
  assert.equal(api.DB.warnings[5], 'x/conversations.json: 2 more records were skipped');
});

test('a record that cannot be read is skipped with a warning, and the rest of the file loads', async () => {
  const app = loadApp();
  // Stands in for any bug in an add…() function.
  app.run(`{ const add = addConversation; addConversation = (c, s, t) => { if (c.name === 'boom') throw new Error('cannot read it'); add(c, s, t); }; }`);
  await app.api.importExport([looseFile('x/conversations.json', [conversation(1, 'a', []), conversation(2, 'boom', []), conversation(3, 'c', [])])], quietUi);
  assert.deepEqual(plain(app.api.DB.conversations.map(c => c.title).sort()), ['a', 'c']);
  assert.deepEqual(plain(app.api.DB.warnings), ['x/conversations.json: record 2 was skipped: cannot read it']);
});

test('null where an object should be, in every kind of file, loads without throwing', async () => {
  const art = U(9), doc = U(10);
  const { api } = await importFiles([
    users(),
    looseFile('x/conversations.json', [{ uuid: U(1), chat_messages: [{ uuid: U(2), sender: 'assistant', content: [null, { type: 'tool_use', name: 'x', input: null }, 3] }], account: { uuid: PERSON } }]),
    looseFile('x/design_chats/d.json', { uuid: U(5), messages: [null, { role: 'user', content: { content: 'x', authorAccountUuid: PERSON } }] }),
    looseFile('x/projects/p.json', { uuid: U(6), name: 'p', docs: [null, { filename: 'a.md', content: 'A' }], creator: null }),
    looseFile('x/memories/m.json', { account_uuid: U(7), memory_files: [null, { path: '/a.md', content: 'A' }], project_memories: 'not a map' }),
    looseFile(`x/${art}/artifact.json`, { versions: [null, { id: 'v1', title: 'Chart' }], owner_account: PERSON }),
    looseFile(`x/${doc}/artifact.json`, { kind: 'page', versions: [], owner_account: PERSON }),
    looseFile(`x/${doc}/comments.json`, [null, { comments: [null, { body: 'hi', author: null }, { body: 'yo', author: { uuid: PERSON } }] }, { comments: 'none' }]),
    looseFile(`x/${doc}/artifact_comments.json`, { threads: [null, { comments: [null, { text: 'mine', author_is_artifact_owner: true }] }] }),
    looseFile('x/manifest-1.json', { created_at: T, data_files: [null, { category: 'conversations', filename: 'conversations-000.zip' }] }),
  ]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  assert.equal(DB.convById.get(U(1)).toolCount, 1);
  assert.equal(DB.designById.get(U(5)).msgCount, 1);
  assert.deepEqual(plain(DB.projectById.get(U(6)).docs.map(d => d.filename)), ['a.md']);
  assert.deepEqual(plain(DB.memoryByPerson.get(U(7)).files.map(f => f.path)), ['/a.md']);
  assert.deepEqual(plain(DB.artifactById.get(art).versions.map(v => v.title)), ['Chart']);
  const page = DB.artifactById.get(doc);
  assert.equal(page.commentCount, 3);   // two in comments.json, one in the thread
  assert.equal(DB.people.get(PERSON).comments.length, 2);   // "yo", and "mine" as the owner
  assert.equal(DB.manifests[0].files.length, 1);
});

test('numbers where the export has strings load, and names still fall back', async () => {
  const { api } = await importFiles([
    looseFile('x/conversations.json', [{ uuid: U(1), name: 5, summary: 6, account: { uuid: 42 }, chat_messages: [] }]),
    looseFile('x/projects/p.json', { uuid: U(2), name: 7, creator: { uuid: 42 }, docs: [{ filename: 8, content: 9 }] }),
    looseFile('x/memories/m.json', { account_uuid: 42, memory_files: [{ path: 10, content: 11 }] }),
  ]);
  const { DB } = api;
  assert.deepEqual(plain(DB.warnings), []);
  assert.equal(DB.convById.get(U(1)).title, '5');
  assert.equal(DB.projectById.get(U(2)).name, '7');
  const p = DB.people.get('42');
  assert.ok(p, 'a numeric account id becomes the string id of one person');
  assert.equal(p.name, 'Unknown user · 42');
  assert.equal(p.conversations.length + p.projects.length, 2);
  assert.equal(DB.memoryByPerson.get(42).files[0].path, '10');
});

test('finalize() works through comment threads of any shape', () => {
  const { api } = loadApp();
  const a = api.artifactFor(U(1));
  a.comments = [null, { comments: [null, { author: 'x' }, { author: { uuid: 5 } }] }, { comments: { not: 'a list' } }];
  a.threads = [7, { comments: [null, { author_is_artifact_owner: true }] }];
  a.ownerId = U(2);
  assert.doesNotThrow(() => api.finalize());
  assert.equal(a.commentCount, 3);
});

test('a load that fails leaves the export that was open as it was', async () => {
  const app = loadApp();
  const { DB, importExport } = app.api;
  const art = U(9);
  await importExport([
    users(), looseFile('x/conversations.json', [conversation(1, 'kept', [message(11, 'hi')])]),
    looseFile('x/memories/m.json', { account_uuid: PERSON, memory_files: [{ path: '/a.md', content: 'A', updated_at: T }] }),
    looseFile(`x/${art}/artifact.json`, { versions: [{ id: 'v1', title: 'Old' }], owner_account: PERSON, updated_at: T }),
  ], quietUi);
  const before = JSON.stringify({
    convs: DB.conversations.map(c => c.id), people: Array.from(DB.people.values(), p => [p.id, p.name, p.conversations.length]),
    memory: DB.memories.map(m => m.files.map(f => f.path)), art: DB.artifacts.map(a => [a.title, Array.from(a.files.keys())]),
    lists: [DB.sources.length, DB.warnings.length, DB.ignored.length],
  });
  const generation = DB.generation;
  // Any failure after the files were read: here the first finalize() of the second load.
  app.run(`{ const real = finalize; let fail = true; finalize = () => { real(); if (fail) { fail = false; throw new Error('boom'); } }; }`);
  await assert.rejects(importExport([
    users('Someone Else'), looseFile('y/conversations.json', [conversation(2, 'new', [])]), looseFile('y/notes.txt', 'x'),
    looseFile('y/memories/m.json', { account_uuid: PERSON, memory_files: [{ path: '/b.md', content: 'B', updated_at: '2026-04-01T00:00:00Z' }] }),
    looseFile(`y/${art}/artifact.json`, { versions: [{ id: 'v2', title: 'New' }], owner_account: U(200), updated_at: '2026-04-01T00:00:00Z' }),
    looseFile(`y/${art}/versions/v2.html`, '<p>x</p>'),
  ], quietUi), /boom/);
  const after = JSON.stringify({
    convs: DB.conversations.map(c => c.id), people: Array.from(DB.people.values(), p => [p.id, p.name, p.conversations.length]),
    memory: DB.memories.map(m => m.files.map(f => f.path)), art: DB.artifacts.map(a => [a.title, Array.from(a.files.keys())]),
    lists: [DB.sources.length, DB.warnings.length, DB.ignored.length],
  });
  assert.equal(after, before);
  assert.ok(DB.generation > generation + 1, 'caches made during the failed load are not used');
  assert.equal(DB.people.get(PERSON).conversations[0], DB.convById.get(U(1)), 'links are drawn again');
});

test('a second load while one runs is refused, with a message', async () => {
  const app = loadApp({ files: BUILD_ORDER });
  app.run(`globalThis.__calls = []; toast = msg => __calls.push('toast: ' + msg); importExport = async () => __calls.push('import');`);
  app.api.App.loading = true;
  await app.api.startLoad([looseFile('x/users.json', [])]);
  assert.deepEqual(plain(app.run('__calls')), ['toast: Still reading the files from before. Try again when that is done.']);
});

test('artifact files get safe names in the per-person zip', async () => {
  const tools = loadApp({ files: ['src/zip.js'] }).api;
  const id = U(50), vid = '1790000000-a1b2';
  const file = await zipFile(tools, 'frames-000.zip', {
    [`artifacts/${id}/artifact.json`]: { versions: [{ id: vid, title: 'Kit' }], owner_account: PERSON, active_version: vid },
    [`artifacts/${id}/versions/${vid}/con.js`]: 'x',
    [`artifacts/${id}/versions/${vid}/img/a:b?.png`]: 'y',
    [`artifacts/${id}/versions/${vid}/notes. `]: 'z',
  });
  const { api } = await importFiles([users(), file]);
  const blob = await api.buildPersonZip(api.DB.people.get(PERSON), { allVersions: true }, () => {}, () => false);
  const out = await api.ZipArchive.open(new File([blob], 'person.zip'));
  const names = Array.from(out.entries, e => e.name.split(`/versions/${vid}/`)[1]).filter(Boolean).sort();
  assert.deepEqual(names, ['_con.js', 'img/a b .png', 'notes']);
});
