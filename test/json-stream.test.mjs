// Streaming parse of a top-level JSON array (parseJsonArrayStream in src/load.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, rng, chunkedStream } from './harness.mjs';

const { api } = loadApp({ files: ['src/zip.js', 'src/load.js'] });
const { parseJsonArrayStream } = api;

const enc = new TextEncoder();

// Parse `input` (string or bytes) delivered in chunks of `size` bytes (a number or a
// function). Items come back as JSON text, so values made in the vm context compare
// cleanly with values made here.
async function parse(input, size = 1 << 16) {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  const items = [];
  const progress = [];
  await parseJsonArrayStream(
    chunkedStream(bytes, typeof size === 'function' ? size : () => size),
    v => items.push(JSON.stringify(v)),
    n => progress.push(n),
  );
  return { items, progress };
}

const asText = list => list.map(v => JSON.stringify(v));

test('empty array gives no items', async () => {
  assert.deepEqual((await parse('[]')).items, []);
  assert.deepEqual((await parse('  [ \n\t ]  ')).items, []);
  assert.deepEqual((await parse('[]', 1)).items, []);
});

test('empty input gives no items and no error', async () => {
  assert.deepEqual((await parse('')).items, []);
  assert.deepEqual((await parse('  \n ')).items, []);
});

test('a UTF-8 byte order mark before the array is skipped', async () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('[1,{"a":"b"}]')]);
  assert.deepEqual((await parse(withBom)).items, asText([1, { a: 'b' }]));
  assert.deepEqual((await parse(withBom, 1)).items, asText([1, { a: 'b' }]));
});

test('primitive items', async () => {
  const doc = '[1, -2.5e3, 0, true, false, null, "s", "", 1E-7 ,\n42\n]';
  const expected = asText(JSON.parse(doc));
  for (const size of [1, 2, 3, 7, 1000]) assert.deepEqual((await parse(doc, size)).items, expected, 'chunk size ' + size);
});

test('nested arrays and objects stay whole', async () => {
  const doc = '[{"a":[1,{"b":[]}],"c":{}},[[]],[1,[2,[3]]],{},[]]';
  const expected = asText(JSON.parse(doc));
  for (const size of [1, 5, 1000]) assert.deepEqual((await parse(doc, size)).items, expected, 'chunk size ' + size);
});

test('strings with escaped quotes, backslashes and brackets', async () => {
  const values = ['a"b', 'c\\', ']', '[', '{', '}', ',', '\\"', '"]', 'x\\\\"y', '\n\t\u0001', '\\u005d', { k: '"}]' }, ['\\', '"']];
  const doc = JSON.stringify(values);
  const expected = asText(values);
  for (const size of [1, 2, 3, 4, 1000]) assert.deepEqual((await parse(doc, size)).items, expected, 'chunk size ' + size);
});

test('multi-byte UTF-8 split across chunks', async () => {
  const values = ['héllo', 'שלום עולם', '日本語', '😀🚀👩‍💻', { 'ключ': 'значение', emoji: '🎉' }];
  const doc = JSON.stringify(values);
  const expected = asText(values);
  // Size 1 splits every multi-byte character; 2 and 3 split them in different places.
  for (const size of [1, 2, 3, 5]) assert.deepEqual((await parse(doc, size)).items, expected, 'chunk size ' + size);
});

test('a document that is not an array is passed as one item', async () => {
  assert.deepEqual((await parse('{"uuid":"x","list":[1,2]}')).items, asText([{ uuid: 'x', list: [1, 2] }]));
  assert.deepEqual((await parse('{"a":1}', 1)).items, asText([{ a: 1 }]));
  assert.deepEqual((await parse('42')).items, ['42']);
  assert.deepEqual((await parse('"just a string"')).items, ['"just a string"']);
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('{"b":2}')]);
  assert.deepEqual((await parse(withBom, 2)).items, asText([{ b: 2 }]));
});

test('items after the closing bracket are ignored', async () => {
  assert.deepEqual((await parse('[1,2]\n[3]')).items, ['1', '2']);
});

test('truncated input throws a clear error', async () => {
  for (const doc of ['[1,2', '[{"a":1', '["abc', '[{"a":[1,2]}', '[[[]']) {
    await assert.rejects(parse(doc), /truncated/, doc);
    await assert.rejects(parse(doc, 1), /truncated/, doc + ' (1-byte chunks)');
  }
  // Not an array, so JSON.parse reports it (the error comes from the vm context's realm).
  await assert.rejects(parse('{"a":'), { name: 'SyntaxError' });
});

test('progress reports the bytes read so far', async () => {
  const doc = JSON.stringify([{ a: 'x'.repeat(50) }, 2, 3]);
  const { progress } = await parse(doc, 10);
  assert.ok(progress.length >= Math.floor(doc.length / 10));
  assert.equal(progress[progress.length - 1], enc.encode(doc).length);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] > progress[i - 1]);
});

test('passes each item\'s own JSON text to the callback', async () => {
  const texts = [];
  await parseJsonArrayStream(chunkedStream(enc.encode('[ {"a" : 1} , "b" ]'), () => 4), (v, text) => texts.push(text));
  assert.deepEqual(texts, ['{"a" : 1}', '"b"']);
});

/* ---------- Fuzz: random documents in random chunk sizes, compared with JSON.parse ---------- */

const ALPHABET = ['a', 'Z', '0', ' ', '"', '\\', '[', ']', '{', '}', ',', ':', '\n', '\t', '/', 'é', 'ש', '日', '😀', '\u0000', '\u001f', ' '];

function randomValue(r, depth) {
  const pick = r();
  if (depth > 0 && pick < 0.2) {
    return Array.from({ length: Math.floor(r() * 6) }, () => randomValue(r, depth - 1));
  }
  if (depth > 0 && pick < 0.4) {
    const o = {};
    // Keys are wrapped in "k…k" to avoid a V8 bug (seen in Node 24.14, V8 13.6): once
    // JSON.parse has read a key that ends in an escaped backslash, such as {"k\\":1}, it can
    // return that key again for a later key of the same length that also ends in an escape,
    // such as {"k\n":2}. JSON.parse itself is wrong there, not our parser.
    for (let i = Math.floor(r() * 5); i > 0; i--) o['k' + randomString(r, 6) + 'k'] = randomValue(r, depth - 1);
    return o;
  }
  if (pick < 0.65) return randomString(r, 12);
  if (pick < 0.8) {
    const n = (r() - 0.5) * 10 ** Math.floor(r() * 12 - 4);
    return r() < 0.5 ? Math.round(n) : n;
  }
  if (pick < 0.9) return r() < 0.5;
  return null;
}

function randomString(r, max) {
  let s = '';
  for (let i = Math.floor(r() * max); i > 0; i--) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
}

test('fuzz: matches JSON.parse for random documents and chunk sizes', async () => {
  const SEED = 0xc1a0de;
  const r = rng(SEED);
  for (let n = 0; n < 3000; n++) {
    // Mostly arrays (the real case); sometimes a single value.
    const value = r() < 0.9
      ? Array.from({ length: Math.floor(r() * 12) }, () => randomValue(r, 3))
      : randomValue(r, 3);
    const indent = [undefined, 0, 1, 2, '\t'][Math.floor(r() * 5)];
    let text = JSON.stringify(value, null, indent);
    if (r() < 0.2) text = ' \n' + text + '\n ';
    let bytes = enc.encode(text);
    if (r() < 0.1) bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    const maxChunk = 1 + Math.floor(r() * (r() < 0.5 ? 8 : 200));
    const expected = Array.isArray(value) ? asText(value) : [JSON.stringify(value)];
    let got;
    try {
      got = (await parse(bytes, () => 1 + Math.floor(r() * maxChunk))).items;
    } catch (e) {
      assert.fail(`document #${n} (seed ${SEED}) threw ${e.message}\n${text}`);
    }
    assert.deepEqual(got, expected, `document #${n} (seed ${SEED}, max chunk ${maxChunk})\n${text}`);
  }
});
