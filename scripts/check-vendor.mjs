#!/usr/bin/env node
// Checks the vendored libraries in vendor/ against their official npm packages.
// THIRD_PARTY_NOTICES.md is the one list: its table names the npm file each vendored file
// was taken from, and its "Checksums" block pins the SHA-256 of each file. Needs the
// network; no dependencies (Node 22+).
//
//   node scripts/check-vendor.mjs
//
// For each file it downloads the package from the npm registry, checks the tarball against
// the registry's integrity value, and compares the official file with the pinned checksum
// and with the file in vendor/. It also lists known security advisories for the pinned
// version (the same data `npm audit` uses) and newer releases. Exit 1 on any problem.
//
// test/vendor.test.mjs uses readVendorList() and sha256() offline, on every `npm test`.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
export const NOTICES = 'THIRD_PARTY_NOTICES.md';

// SHA-256 as hex. Git on Windows may check text files out with CRLF line endings; the
// official builds use LF only, so CRLF is hashed as LF and such a checkout still passes.
export function sha256(bytes) {
  const lf = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha256').update(lf).digest('hex');
}

// The vendored files, read from the notices: one table row per library and one
// "<sha256>  <file>" line per file. `sums` holds every checksum line, also stray ones.
export function readVendorList(text = readFileSync(join(ROOT, NOTICES), 'utf8')) {
  const sums = new Map(Array.from(text.matchAll(/^([0-9a-f]{64}) {2}(vendor\/\S+)$/gm), m => [m[2], m[1]]));
  const row = /^\| \[([^\]]+)\]\([^)]*\) \| (\S+) \| `(vendor\/[^`]+)` \| `((?:@[^/`]+\/)?[^@/`]+)@([^/`]+)\/([^`]+)` \|/gm;
  const files = Array.from(text.matchAll(row), m => ({
    name: m[1], version: m[2], file: m[3],
    pkg: m[4], pkgVersion: m[5], pkgPath: m[6],
    sha256: sums.get(m[3]) || null,
  }));
  return { files, sums };
}

// One file from an uncompressed tar archive. npm tarballs use plain ustar headers; paths
// longer than the header allows (pax records) are not needed for the files we vendor.
function tarFile(tar, wanted) {
  for (let at = 0; at + 512 <= tar.length;) {
    const field = (from, len) => tar.subarray(at + from, at + from + len).toString('utf8').replace(/\0[\s\S]*$/, '');
    const name = field(0, 100);
    if (!name) return null; // an empty block ends the archive
    const prefix = field(345, 155);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    if ((prefix ? prefix + '/' + name : name) === wanted && (type === '0' || type === '')) {
      return tar.subarray(at + 512, at + 512 + size);
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function request(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

// "1.2.3" → [1, 2, 3]; pre-releases ("1.2.3-beta.1") give null and are skipped.
const parts = v => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

async function check(f) {
  let ok = true;
  const say = (good, text) => { console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${text}`); if (!good) ok = false; };
  console.log(`\n${f.file}  from  ${f.pkg}@${f.pkgVersion}/${f.pkgPath}`);

  // The abbreviated metadata has every version's tarball, integrity and deprecation.
  const meta = await (await request(`${REGISTRY}/${f.pkg.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })).json();
  const release = meta.versions && meta.versions[f.pkgVersion];
  if (!release) { say(false, `${f.pkgVersion} is not published on npm`); return false; }
  if (release.deprecated) say(false, `npm marks ${f.pkgVersion} as deprecated: ${release.deprecated}`);

  // Take the tarball only from the registry itself, and check it against its integrity value.
  const { tarball, integrity = '' } = release.dist;
  if (new URL(tarball).origin !== REGISTRY) { say(false, `unexpected tarball URL ${tarball}`); return false; }
  const tgz = Buffer.from(await (await request(tarball)).arrayBuffer());
  const want = integrity.split(/\s+/).find(s => s.startsWith('sha512-'));
  say(!!want && 'sha512-' + createHash('sha512').update(tgz).digest('base64') === want, 'the tarball matches the registry integrity value');

  const official = tarFile(gunzipSync(tgz), 'package/' + f.pkgPath);
  if (!official) { say(false, `${f.pkgPath} is not in the package`); return false; }
  const officialSum = sha256(official);
  say(officialSum === f.sha256, `the official file has the pinned checksum${officialSum === f.sha256 ? '' : ` (official: ${officialSum})`}`);
  say(sha256(readFileSync(join(ROOT, f.file))) === officialSum, `${f.file} is byte for byte the official file`);

  const advisories = (await (await request(`${REGISTRY}/-/npm/v1/security/advisories/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [f.pkg]: [f.pkgVersion] }),
  })).json())[f.pkg] || [];
  say(advisories.length === 0, `known security advisories for ${f.pkgVersion}: ${advisories.length}`);
  for (const a of advisories) console.log(`          ${a.severity}  ${a.url}  (affects ${a.vulnerable_versions})  ${a.title}`);

  // Newer releases are information, not a failure: an update needs a person to review it.
  const pinned = parts(f.pkgVersion);
  const later = Object.keys(meta.versions).map(v => [v, parts(v)])
    .filter(([v, p]) => p && newer(p, pinned) && !meta.versions[v].deprecated)
    .sort((a, b) => (newer(a[1], b[1]) ? -1 : 1));
  const sameMajor = later.find(([, p]) => p[0] === pinned[0]);
  console.log(`  info  newest ${pinned[0]}.x: ${sameMajor ? sameMajor[0] : f.pkgVersion + ' (pinned)'}; npm "latest": ${meta['dist-tags'] && meta['dist-tags'].latest}`);
  return ok;
}

async function main() {
  const { files, sums } = readVendorList();
  if (!files.length) throw new Error(`no vendored files found in ${NOTICES}`);
  let ok = true;
  for (const file of sums.keys()) {
    if (!files.some(f => f.file === file)) { console.log(`FAIL  ${file} has a checksum but no table row in ${NOTICES}`); ok = false; }
  }
  for (const f of files) {
    if (!f.sha256) { console.log(`FAIL  ${f.file} has no checksum line in ${NOTICES}`); ok = false; continue; }
    if (!(await check(f))) ok = false;
  }
  console.log(ok ? '\nAll vendored files are the official builds, with no known advisories.' : '\nProblems found (see FAIL above).');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // fetch() hides the network reason (DNS, proxy, TLS) in err.cause.
  main().catch(err => {
    const cause = err.cause ? ` (${err.cause.code || err.cause.message})` : '';
    console.error(`check-vendor: ${err.message}${cause}`);
    process.exit(1);
  });
}
