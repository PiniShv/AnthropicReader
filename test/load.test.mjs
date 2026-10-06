// Gathering input in src/load.js: dropped folders (drag and drop) and saved handles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const { api } = loadApp({ files: ['src/zip.js', 'src/load.js'] });

// A fake drag-and-drop entry tree (the webkitGetAsEntry API). Each file answers after its own
// delay, so the callbacks finish in a different order than the files sit in the folder.
function fileEntry(fullPath, delay) {
  return {
    isFile: true, isDirectory: false, fullPath,
    file(ok) { setTimeout(() => ok(new File(['{}'], fullPath.split('/').pop())), delay); },
  };
}
function dirEntry(fullPath, children) {
  return {
    isFile: false, isDirectory: true, fullPath,
    createReader() {
      let i = 0;
      // Like Chrome, readEntries gives a few entries per call and [] at the end.
      return { readEntries(ok) { setTimeout(() => { ok(children.slice(i, i + 2)); i += 2; }, 0); } };
    },
  };
}
const dropOf = (...entries) => ({ items: entries.map(e => ({ kind: 'file', webkitGetAsEntry: () => e })) });

test('a dropped folder gives its files in folder order, however fast each file answers', async () => {
  const tree = dirEntry('/export', [
    fileEntry('/export/users.json', 30),
    dirEntry('/export/artifacts', [
      fileEntry('/export/artifacts/a.json', 5),
      fileEntry('/export/artifacts/b.json', 20),
      fileEntry('/export/artifacts/c.json', 1),
    ]),
    fileEntry('/export/conversations.json', 10),
  ]);
  const files = await api.filesFromDataTransfer(dropOf(tree, fileEntry('/manifest.json', 0)));
  assert.deepEqual(Array.from(files, f => f.path), [
    '/export/users.json',
    '/export/artifacts/a.json', '/export/artifacts/b.json', '/export/artifacts/c.json',
    '/export/conversations.json',
    '/manifest.json',
  ]);
});

/* ---------- Saved handles (File System Access API) ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fake handles. Each file answers after its own delay; `busy` counts the reads running at once.
function handleKit() {
  const busy = { now: 0, max: 0 };
  const track = async (ms, fn) => {
    busy.max = Math.max(busy.max, ++busy.now);
    await sleep(ms);
    busy.now--;
    return fn();
  };
  const file = (name, delay) => ({ kind: 'file', name, getFile: () => track(delay, () => new File(['{}'], name)) });
  const dir = (name, children) => ({
    kind: 'directory', name,
    async *values() { await track(1, () => {}); for (const c of children) yield c; },
  });
  return { busy, file, dir };
}

test('saved handles give their files in folder order, however fast each read is', async () => {
  const { file, dir } = handleKit();
  const tree = dir('export', [
    file('users.json', 30),
    dir('artifacts', [file('a.json', 5), dir('v', [file('x.html', 25), file('y.html', 0)]), file('b.json', 20)]),
    file('conversations.json', 10),
  ]);
  const files = await api.filesFromHandles([tree, file('manifest.json', 0)]);
  assert.deepEqual(Array.from(files, f => f.path), [
    'export/users.json',
    'export/artifacts/a.json', 'export/artifacts/v/x.html', 'export/artifacts/v/y.html', 'export/artifacts/b.json',
    'export/conversations.json',
    'manifest.json',
  ]);
});

test('saved handles are read a few at a time, not one by one and not all at once', async () => {
  const { busy, file, dir } = handleKit();
  const many = n => Array.from({ length: n }, (_, i) => file(`f${String(i).padStart(3, '0')}.json`, 3));
  const tree = dir('big', [...many(60), ...Array.from({ length: 40 }, (_, i) => dir('d' + i, many(2)))]);
  const files = await api.filesFromHandles([tree]);
  assert.equal(files.length, 140);
  assert.equal(files[0].path, 'big/f000.json');
  assert.equal(files[139].path, 'big/d39/f001.json');
  assert.ok(files.every(f => f.file instanceof File && !('relPath' in f.file)), 'the File objects are left as they are');
  assert.ok(busy.max > 1, 'reads run in parallel');
  assert.ok(busy.max <= api.HANDLE_READS, `at most ${api.HANDLE_READS} reads at once, saw ${busy.max}`);
});
