// The built-in sample export (demoExportFiles in src/demo.js) must load cleanly through the
// real import pipeline and show every kind of data the reader supports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, quietUi, plain } from './harness.mjs';

const { api } = loadApp();

let files = null;
let demoError = null;
try {
  files = await api.demoExportFiles();
} catch (e) {
  demoError = e;
}
// While src/demo.js is still the placeholder, skip instead of failing. Any other error fails.
const skip = demoError && demoError.message === 'demo data not implemented yet' ? 'demo data not implemented' : false;

let loading = null;
function loaded() {
  if (demoError) throw demoError;
  loading ||= api.importExport(files, quietUi).then(() => api.DB);
  return loading;
}

// Content types the sample must show, one artifact (at least) of each.
const CONTENT_TYPES = ['HTML', 'HTML + files', 'Slides', 'Design', 'Doc'];

test('demoExportFiles returns the zip parts and the manifest as files', { skip }, async () => {
  if (demoError) throw demoError;
  assert.ok(files && typeof files.length === 'number' && files.length > 0, 'a non-empty list of files');
  for (const f of files) {
    assert.ok(f instanceof Blob, `${f && f.name} is a File`);
    assert.ok(typeof f.name === 'string' && f.name, 'every file has a name');
  }
  const names = Array.from(files, f => f.name);
  assert.ok(names.some(n => /\.zip$/i.test(n)), 'at least one zip part');
  assert.ok(names.some(n => /^manifest.*\.json$/i.test(n)), 'a manifest');
});

test('the sample export loads without warnings', { skip }, async () => {
  const DB = await loaded();
  assert.deepEqual(plain(DB.warnings), []);
});

test('the sample export has every kind of data', { skip }, async () => {
  const DB = await loaded();
  const people = Array.from(DB.people.values()).filter(p => !p.system);
  assert.ok(people.filter(p => p.known).length >= 2, 'people from users.json');
  assert.ok(DB.conversations.filter(c => !c.empty).length >= 1, 'conversations');
  assert.ok(DB.projects.length >= 1, 'projects');
  assert.ok(DB.memories.length >= 1, 'memories');
  assert.ok(DB.designChats.length >= 1, 'design chats');
  assert.ok(DB.manifests.length >= 1, 'the manifest');
  const types = new Set(Array.from(DB.artifacts, a => a.contentType));
  for (const t of CONTENT_TYPES) assert.ok(types.has(t), `an artifact of type "${t}" (found: ${Array.from(types).join(', ')})`);
});

test('the sample export uses only reserved example domains for email addresses', { skip }, async () => {
  const DB = await loaded();
  // RFC 2606 / 6761 names cannot belong to a real person or company.
  const reserved = /@([\w-]+\.)*(example|test|invalid|localhost|example\.(com|org|net))$/i;
  for (const p of DB.people.values()) {
    if (p.email) assert.match(p.email, reserved, `${p.email} is not a reserved example address`);
  }
});
