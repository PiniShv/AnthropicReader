// Gathering input in src/load.js: dropped folders (drag and drop).
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

