/* Sample data: a small, entirely made-up team export in the real export format.
 * Used by "Try it with sample data", the tests and the screenshots.
 *
 * Everything here is invented: the company (Northwind Labs), its people, their chats,
 * files and numbers. Ids come from fixed keys and every date is fixed, so each run builds
 * exactly the same bytes. It runs in the browser and in Node 20+: it needs only File,
 * Blob and TextEncoder, plus ZipWriter from zip.js.
 *
 * This file has the helpers, the people and the packaging (demoExportFiles). The content
 * is in demo-chats.js, demo-records.js (projects, memory, design chats) and
 * demo-artifacts.js, which load after it. All scripts share one global scope, so every
 * top-level name starts with demo or DEMO_. */
'use strict';

/* ---------- Deterministic helpers (no Math.random, no Date.now) ---------- */

const DEMO_HEX = '0123456789abcdef';
const DEMO_B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const DEMO_B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DEMO_ROOT = '00000000-0000-4000-8000-000000000000';   // parent of a chat's first message
const DEMO_EXPORTED = '2026-09-30T16:00';                    // when the made-up export was taken
const DEMO_FENCE = '```';

// FNV-1a: a stable 32-bit number for any string.
function demoHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// mulberry32: a tiny seeded generator that gives the same numbers in every engine.
function demoRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoChars(key, n, alphabet) {
  const next = demoRng(demoHash(key));
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(next() * alphabet.length)];
  return s;
}

// A valid-looking uuid (version 4 unless asked) that is always the same for the same key.
function demoUuid(key, version) {
  const h = demoChars('uuid:' + key, 32, DEMO_HEX).split('');
  h[12] = String(version || 4);
  h[16] = '89ab'[DEMO_HEX.indexOf(h[16]) & 3];
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
}

// 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DDTHH:MM:SS' (UTC) to epoch milliseconds.
function demoMs(s) { return Date.parse(s.length === 16 ? s + ':00Z' : s + 'Z'); }

// The export uses a different timestamp style in each file type; keep them all.
function demoIso(ms, style) {
  const head = new Date(ms).toISOString().slice(0, 19);
  const milli = String(ms % 1000).padStart(3, '0');
  const micro = milli + String(Math.floor(ms / 997) % 1000).padStart(3, '0');
  if (style === 'z6') return head + '.' + micro + 'Z';          // conversations
  if (style === 'p6') return head + '.' + micro + '+00:00';     // projects, memories, design chats
  if (style === 'z3') return head + '.' + milli + 'Z';          // comments, design message times
  if (style === 'z0') return head + 'Z';                        // deck and canvas files
  return head + '+00:00';                                       // artifact.json
}

const demoLines = (...lines) => lines.join('\n');

// SHA-256 for the files.json manifests. Plain JS, because crypto.subtle is async and is
// missing on some file:// pages.
const DEMO_SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function demoSha256(bytes) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = bytes.length;
  const buf = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(len / 0x20000000));
  dv.setUint32(buf.length - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + DEMO_SHA_K[i] + w[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function demoMime(path) {
  const ext = path.split('.').pop().toLowerCase();
  return { html: 'text/html', md: 'text/markdown', json: 'application/json', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
}

/* ---------- People ---------- */

// [key, full_name, email local part, phone]. Both "Sam" entries are on purpose: the reader
// tells them apart by email. Jonas has no name in users.json, and Fatima has no data at all.
const DEMO_USERS = [
  ['amara', 'Amara Okafor', 'amara.okafor'],
  ['kenji', 'Kenji Watanabe', 'kenji.watanabe'],
  ['noor', 'Noor Haddad', 'noor.haddad'],
  ['lucia', 'Lucía Fernández', 'lucia.fernandez'],
  ['priya', 'Priya Raman', 'priya.raman', '+447700900461'],   // a number reserved for fiction
  ['mateus', 'Mateus Costa', 'mateus.costa'],
  ['samn', 'Sam', 'sam.novak'],
  ['saml', 'Sam', 'sam.lindqvist'],
  ['jonas', null, 'jonas.berg'],
  ['fatima', 'Fatima Zahra Alaoui', 'fatima.alaoui'],
];

// Account uuid for a person. 'former' left the team: they own chats but are not in users.json.
const demoUser = key => demoUuid('user:' + key);

function demoUsersJson() {
  return DEMO_USERS.map(([key, name, local, phone]) => ({
    uuid: demoUser(key), full_name: name, email_address: local + '@northwind.example', verified_phone_number: phone || null,
  }));
}

/* ---------- Packaging ---------- */

function demoZip(name, entries) {
  const z = new ZipWriter();
  // Real exports date every entry 1980-01-01 00:00. So does this, and the bytes never change.
  z.dosTime = 0;
  z.dosDate = (1 << 5) | 1;
  for (const [path, data] of entries) z.add(path, data);
  return new File([z.blob()], name, { type: 'application/zip', lastModified: demoMs(DEMO_EXPORTED) });
}

// Returns the export as File objects: the zip parts plus the manifest, like a real download.
async function demoExportFiles() {
  const json = v => JSON.stringify(v, null, 2);
  const parts = [
    ['light_metadata', [['users.json', json(demoUsersJson())]]],
    ['projects', demoProjects().map(p => ['projects/' + p.uuid + '.json', json(p)])],
    ['memories', demoMemories().map(m => ['memories/' + m.account_uuid + '.json', json(m)])],
    ['design_chats', demoDesignChats().map(d => ['design_chats/' + d.uuid + '.json', json(d)])],
    ['frames', demoArtifactSpecs().flatMap(demoArtifactEntries)],
    ['conversations', [['conversations.json', JSON.stringify(demoConversations())]]],
  ];
  const zips = parts.map(([category, entries]) => demoZip(category + '-000.zip', entries));

  const org = demoUuid('org:northwind');
  const exported = demoMs(DEMO_EXPORTED);
  const manifest = {
    instructions: 'Download each file with its export_url. The links stop working 24 hours after the export was created.',
    created_at: demoIso(exported, 'p6'),
    total_files: parts.length,
    // Made-up links: they point at no real download, and they expired long ago.
    data_files: parts.map(([category], i) => ({
      batch_index: i, export_url: 'https://claude.ai/export/' + org + '/download/sample-' + demoChars('link:' + category, 24, DEMO_B62),
      category, part: 0, filename: category + '-000.zip',
    })),
    version: '1.0',
  };
  const stamp = new Date(exported).toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const manifestName = 'manifest-' + org + '-' + Math.floor(exported / 1000) + '-' + demoChars('manifest', 8, DEMO_HEX) + '-' + stamp + '.json';
  zips.push(new File([json(manifest)], manifestName, { type: 'application/json', lastModified: exported }));
  return zips;
}
