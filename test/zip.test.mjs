// ZIP reading and writing (src/zip.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { loadApp, quietUi } from './harness.mjs';

const { api } = loadApp({ files: ['src/zip.js'] });
const { ZipArchive, ZipWriter } = api;

const enc = new TextEncoder();
const dec = new TextDecoder();

// Array.from copies into this realm, so deepStrictEqual compares values, not prototypes.
const names = zip => Array.from(zip.entries, e => e.name);

async function open(blob, name = 'test.zip') {
  return ZipArchive.open(new File([blob], name));
}

// CRC-32, written out here so the test does not trust the code it checks.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* Hand-written archive builder for cases ZipWriter cannot make (DEFLATE, data descriptors,
 * ZIP64, other methods). Each entry: { name, data, method = 8, descriptor, zip64 }.
 *   descriptor: local header has zero sizes and flag bit 3; sizes follow the data.
 *   zip64: 'all' puts sizes and offset in a 0x0001 extra field, 'offset' only the offset.
 * archiveZip64: also write an EOCD64 record and locator, with a classic EOCD full of 0xFF. */
function buildZip(entries, { archiveZip64 = false, prefix = new Uint8Array(0) } = {}) {
  const chunks = [prefix];
  let offset = prefix.length;
  const central = [];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const comp = method === 8 ? new Uint8Array(deflateRawSync(data)) : (e.raw || data);
    const crc = crc32(data);
    const flags = 0x0800 | (e.descriptor ? 0x0008 : 0);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, e.descriptor ? 0 : crc, true);
    local.setUint32(18, e.descriptor ? 0 : comp.length, true);
    local.setUint32(22, e.descriptor ? 0 : data.length, true);
    local.setUint16(26, name.length, true);
    const localOffset = offset;
    chunks.push(new Uint8Array(local.buffer), name, comp);
    offset += 30 + name.length + comp.length;
    if (e.descriptor) {
      const dd = new DataView(new ArrayBuffer(16));
      dd.setUint32(0, 0x08074b50, true);
      dd.setUint32(4, crc, true);
      dd.setUint32(8, comp.length, true);
      dd.setUint32(12, data.length, true);
      chunks.push(new Uint8Array(dd.buffer));
      offset += 16;
    }

    // ZIP64 extra field: only the values whose classic field is 0xFFFFFFFF, in fixed order.
    const big = [];
    if (e.zip64 === 'all') big.push(data.length, comp.length, localOffset);
    if (e.zip64 === 'offset') big.push(localOffset);
    const extra = new DataView(new ArrayBuffer(big.length ? 4 + 8 * big.length : 0));
    if (big.length) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 8 * big.length, true);
      big.forEach((v, i) => extra.setBigUint64(4 + 8 * i, BigInt(v), true));
    }
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 45, true);
    cen.setUint16(6, 45, true);
    cen.setUint16(8, flags, true);
    cen.setUint16(10, method, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, e.zip64 === 'all' ? 0xffffffff : comp.length, true);
    cen.setUint32(24, e.zip64 === 'all' ? 0xffffffff : data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint16(30, extra.byteLength, true);
    cen.setUint32(42, e.zip64 ? 0xffffffff : localOffset, true);
    central.push(new Uint8Array(cen.buffer), name, new Uint8Array(extra.buffer));
  }
  const cdOffset = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  chunks.push(...central);
  offset += cdSize;

  if (archiveZip64) {
    const rec = new DataView(new ArrayBuffer(56));
    rec.setUint32(0, 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);
    rec.setUint16(12, 45, true);
    rec.setUint16(14, 45, true);
    rec.setBigUint64(24, BigInt(entries.length), true);
    rec.setBigUint64(32, BigInt(entries.length), true);
    rec.setBigUint64(40, BigInt(cdSize), true);
    rec.setBigUint64(48, BigInt(cdOffset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(offset), true);
    loc.setUint32(16, 1, true);
    chunks.push(new Uint8Array(rec.buffer), new Uint8Array(loc.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, archiveZip64 ? 0xffff : entries.length, true);
  end.setUint16(10, archiveZip64 ? 0xffff : entries.length, true);
  end.setUint32(12, archiveZip64 ? 0xffffffff : cdSize, true);
  end.setUint32(16, archiveZip64 ? 0xffffffff : cdOffset, true);
  chunks.push(new Uint8Array(end.buffer));
  return new Blob(chunks);
}

const binary = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37 + 11) & 0xff);

test('ZipWriter output reads back with ZipArchive', async () => {
  const w = new ZipWriter();
  w.add('hello.txt', 'Hello, Northwind!');
  w.add('notes/ünïcødé 文件 🚀.md', '# Überschrift\n\nשלום 😀');
  w.add('empty.txt', '');
  w.add('data/blob.bin', binary);
  w.add('/leading/slash.txt', 'no leading slash in the archive');
  const zip = await open(w.blob());

  assert.deepEqual(names(zip), [
    'hello.txt', 'notes/ünïcødé 文件 🚀.md', 'empty.txt', 'data/blob.bin', 'leading/slash.txt',
  ]);
  const byName = new Map(zip.entries.map(e => [e.name, e]));
  assert.equal(await byName.get('hello.txt').text(), 'Hello, Northwind!');
  assert.equal(await byName.get('notes/ünïcødé 文件 🚀.md').text(), '# Überschrift\n\nשלום 😀');

  const empty = byName.get('empty.txt');
  assert.equal(empty.size, 0);
  assert.equal(await empty.text(), '');

  const bin = byName.get('data/blob.bin');
  assert.equal(bin.size, binary.length);
  assert.deepEqual(Array.from(await bin.bytes()), Array.from(binary));
  // The streaming path gives the same bytes.
  const streamed = new Uint8Array(await new Response(await bin.stream()).arrayBuffer());
  assert.deepEqual(Array.from(streamed), Array.from(binary));
  const blob = await bin.blob('application/octet-stream');
  assert.equal(blob.type, 'application/octet-stream');
  assert.equal(blob.size, binary.length);
});

test('ZipWriter gives duplicate names a " (n)" suffix', async () => {
  const w = new ZipWriter();
  w.add('report.md', 'one');
  w.add('report.md', 'two');
  w.add('report.md', 'three');
  w.add('README', 'a');
  w.add('README', 'b');
  w.add('v1.2/notes', 'x');        // the dot is in the folder, not in the file name
  w.add('v1.2/notes', 'y');
  w.add('archive.tar.gz', '1');
  w.add('archive.tar.gz', '2');
  const zip = await open(w.blob());
  assert.deepEqual(names(zip), [
    'report.md', 'report (2).md', 'report (3).md', 'README', 'README (2)',
    'v1.2/notes', 'v1.2/notes (2)', 'archive.tar.gz', 'archive.tar (2).gz',
  ]);
  assert.equal(await zip.entries[2].text(), 'three');
});

test('ZipWriter stores a correct CRC-32 for each file', async () => {
  const w = new ZipWriter();
  w.add('a.txt', 'The quick brown fox');
  w.add('b.bin', binary);
  const bytes = new Uint8Array(await w.blob().arrayBuffer());
  const dv = new DataView(bytes.buffer);
  // First local header starts at 0; its CRC sits at offset 14.
  assert.equal(dv.getUint32(14, true), crc32(enc.encode('The quick brown fox')));
  const second = 30 + 'a.txt'.length + 'The quick brown fox'.length;
  assert.equal(dv.getUint32(second, true), 0x04034b50);
  assert.equal(dv.getUint32(second + 14, true), crc32(binary));
});

test('reads DEFLATE entries from a hand-built archive', async () => {
  const text = 'Northwind Labs quarterly notes. '.repeat(200);
  const zip = await open(buildZip([
    { name: 'conversations.json', data: '[{"uuid":"x"}]' },
    { name: 'big.txt', data: text },
    { name: 'stored.txt', data: 'kept as is', method: 0 },
    { name: 'folder/', data: '', method: 0 },      // folders are skipped
    { name: 'bin.dat', data: binary },
  ]));
  assert.deepEqual(names(zip), ['conversations.json', 'big.txt', 'stored.txt', 'bin.dat']);
  const big = zip.entries[1];
  assert.equal(big.method, 8);
  assert.ok(big.compSize < big.size, 'the text really was compressed');
  assert.equal(await big.text(), text);
  assert.equal(dec.decode(new Uint8Array(await new Response(await big.stream()).arrayBuffer())), text);
  assert.equal(await zip.entries[2].text(), 'kept as is');
  assert.deepEqual(Array.from(await zip.entries[3].bytes()), Array.from(binary));
});

test('entry paths use forward slashes, also in a zip made on Windows', async () => {
  const zip = await open(buildZip([{ name: 'export\\users.json', data: '[]' }, { name: '/conversations.json', data: '[]' }]));
  assert.deepEqual(names(zip), ['export\\users.json', '/conversations.json']);
  assert.deepEqual(Array.from(zip.entries, e => e.path), ['export/users.json', 'conversations.json']);
});

test('the import finds artifacts in a zip made on Windows', async () => {
  const id = 'e0000000-0000-4000-8000-000000000001';
  const file = new File([buildZip([
    { name: `frames\\artifacts\\${id}\\artifact.json`, data: JSON.stringify({ versions: [{ id: 'v1', title: 'Chart' }] }) },
    { name: `frames\\artifacts\\${id}\\versions\\v1.html`, data: '<p>chart</p>' },
  ])], 'frames-000.zip');
  const { api: app } = loadApp();
  await app.importExport([file], quietUi);
  const a = app.DB.artifactById.get(id);
  assert.equal(a && a.title, 'Chart');
  assert.deepEqual(Array.from(a.files.keys()), ['artifact.json', 'versions/v1.html']);
});

test('reads entries written with a data descriptor (sizes after the data)', async () => {
  const zip = await open(buildZip([
    { name: 'a.json', data: '{"a":1}', descriptor: true },
    { name: 'b.txt', data: 'second entry', descriptor: true, method: 0 },
  ]));
  assert.equal(await zip.entries[0].text(), '{"a":1}');
  assert.equal(await zip.entries[1].text(), 'second entry');
});

test('finds the end record behind an archive comment', async () => {
  const blob = buildZip([{ name: 'x.txt', data: 'x' }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const comment = enc.encode('made by a fictional tool');
  const withComment = new Uint8Array(bytes.length + comment.length);
  withComment.set(bytes);
  new DataView(withComment.buffer).setUint16(bytes.length - 2, comment.length, true);
  withComment.set(comment, bytes.length);
  const zip = await open(new Blob([withComment]));
  assert.equal(await zip.entries[0].text(), 'x');
});

test('reads a ZIP64 archive (EOCD64 record, locator and 0x0001 extra field)', async () => {
  const zip = await open(buildZip([
    { name: 'first.txt', data: 'first entry', zip64: 'all' },
    { name: 'second.bin', data: binary, zip64: 'all', method: 0 },
    { name: 'third.txt', data: 'only the offset is 64-bit', zip64: 'offset' },
    { name: 'plain.txt', data: 'classic fields' },
  ], { archiveZip64: true, prefix: new Uint8Array(100) }));
  assert.deepEqual(names(zip), ['first.txt', 'second.bin', 'third.txt', 'plain.txt']);
  assert.equal(zip.entries[0].size, 'first entry'.length);
  assert.equal(zip.entries[0].localOffset, 100);
  assert.equal(await zip.entries[0].text(), 'first entry');
  assert.deepEqual(Array.from(await zip.entries[1].bytes()), Array.from(binary));
  assert.equal(await zip.entries[2].text(), 'only the offset is 64-bit');
  assert.equal(await zip.entries[3].text(), 'classic fields');
});

test('without deflate-raw, a DEFLATE zip fails at once with a clear message; a STORED zip still opens', async () => {
  // A browser before Chrome 103: DecompressionStream exists, but not for 'deflate-raw'.
  const old = loadApp({ files: ['src/zip.js'] });
  old.run(`globalThis.DecompressionStream = class { constructor(f) { if (f === 'deflate-raw') throw new TypeError('Unsupported compression format'); } }`);
  const deflated = new File([buildZip([{ name: 'conversations.json', data: '[]' }])], 'conversations-000.zip');
  await assert.rejects(old.api.ZipArchive.open(deflated), /cannot unpack zip files\. Use Chrome or Edge 103, Firefox 113 or Safari 16\.4 or newer, or unzip the files first/);
  const stored = await old.api.ZipArchive.open(new File([buildZip([{ name: 'users.json', data: '[]', method: 0 }])], 'light_metadata-000.zip'));
  assert.equal(await stored.entries[0].text(), '[]');
  // A browser before Firefox 113: no DecompressionStream at all.
  old.run('delete globalThis.DecompressionStream');
  await assert.rejects(old.api.ZipArchive.open(deflated), /cannot unpack zip files/);
});

test('a file that is not a zip fails with a clear error', async () => {
  await assert.rejects(ZipArchive.open(new File(['just some text, not a zip'], 'notes.zip')), /notes\.zip is not a ZIP file/);
  await assert.rejects(ZipArchive.open(new File([], 'empty.zip')), /empty\.zip is not a ZIP file/);
  await assert.rejects(ZipArchive.open(new File([binary], 'random.zip')), /not a ZIP file/);
});

test('a broken central directory fails with a clear error', async () => {
  const bytes = new Uint8Array(await buildZip([{ name: 'a.txt', data: 'a' }]).arrayBuffer());
  const dv = new DataView(bytes.buffer);
  const cdOffset = dv.getUint32(bytes.length - 22 + 16, true);
  bytes[cdOffset] = 0;  // break the central header signature
  await assert.rejects(ZipArchive.open(new File([bytes], 'broken.zip')), /Corrupt central directory in broken\.zip/);
});

test('an unsupported compression method is reported, not silently mis-read', async () => {
  const zip = await open(buildZip([{ name: 'old.bin', data: 'abc', method: 12, raw: enc.encode('BZh9 fake data') }]));
  await assert.rejects(zip.entries[0].stream(), /Unsupported ZIP compression method 12/);
});

test('bytes() rejects an unsupported compression method the same way stream() does', async () => {
  const zip = await open(buildZip([{ name: 'old.bin', data: 'abc', method: 12, raw: enc.encode('BZh9 fake data') }]));
  await assert.rejects(zip.entries[0].bytes(), /Unsupported ZIP compression method 12/);
});

test('ZipWriter makes every part of a path a name that works on every system', async () => {
  const z = new ZipWriter();
  z.add('docs/Q3: plan?/notes. ', 'a');
  z.add('con/aux.txt', 'b');
  z.add('a\\b/' + 'x'.repeat(120) + '.md', 'c');
  const zip = await ZipArchive.open(new File([await z.blob().arrayBuffer()], 'clean.zip'));
  assert.deepEqual(names(zip), ['docs/Q3 plan/notes', '_con/_aux.txt', 'a/b/' + 'x'.repeat(90) + '.md']);
});

test('ZipWriter keeps every path inside the zip (no "." or ".." segments)', async () => {
  const z = new ZipWriter();
  z.add('artifacts/x/../../../etc/passwd', 'a');
  z.add('./a//b/./c.txt', 'b');
  z.add('..', 'c');
  const zip = await ZipArchive.open(new File([await z.blob().arrayBuffer()], 'safe.zip'));
  assert.deepEqual(names(zip), ['artifacts/x/_/_/_/etc/passwd', 'a/b/c.txt', '_']);
});
