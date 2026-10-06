// The vendored libraries in vendor/. THIRD_PARTY_NOTICES.md pins the SHA-256 of each file
// and names its version. These tests keep the files and the notices in step, so an edited
// or swapped vendor file fails CI. scripts/check-vendor.mjs checks the pins against npm;
// it needs the network, so it is not part of `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTICES, readVendorList, sha256 } from '../scripts/check-vendor.mjs';
import { ROOT } from './harness.mjs';

const notices = readFileSync(join(ROOT, NOTICES), 'utf8');
const { files, sums } = readVendorList(notices);

// The "## <name> <version>" part of the notices: credits and license for one library.
function librarySection(name) {
  const at = notices.indexOf(`\n## ${name} `);
  if (at < 0) return '';
  const end = notices.indexOf('\n## ', at + 1);
  return notices.slice(at, end < 0 ? undefined : end);
}

test('the notices list every file in vendor/, each with one checksum', () => {
  const onDisk = readdirSync(join(ROOT, 'vendor')).filter(n => !n.startsWith('.')).map(n => 'vendor/' + n).sort();
  assert.deepEqual(files.map(f => f.file).sort(), onDisk, `the table in ${NOTICES} must list exactly the files in vendor/`);
  assert.deepEqual([...sums.keys()].sort(), onDisk, `the checksum block in ${NOTICES} must list exactly the files in vendor/`);
});

test('every vendored file matches its pinned SHA-256', () => {
  for (const f of files) {
    assert.equal(sha256(readFileSync(join(ROOT, f.file))), f.sha256,
      `${f.file} is not the file pinned in ${NOTICES}. Vendored files must stay the official build, unchanged. ` +
      'If you updated it on purpose, follow "Updating a vendored library" in CONTRIBUTING.md.');
  }
});

test('the notices name the version each vendored file really is', () => {
  for (const f of files) {
    // The license header at the top of each official build names its version.
    const header = (/\bv?(\d+\.\d+\.\d+)\b/.exec(readFileSync(join(ROOT, f.file), 'utf8').slice(0, 300)) || [])[1];
    assert.equal(f.version, header, `${f.file} says it is version ${header}, the table says ${f.version}`);
    assert.equal(f.pkgVersion, f.version, `${f.file}: the npm package version must match the Version column`);
    const section = librarySection(f.name);
    assert.ok(section, `${NOTICES} has no "## ${f.name} …" section`);
    assert.deepEqual([...new Set(section.match(/\b\d+\.\d+\.\d+\b/g))], [f.version], `every version in the "${f.name}" section must be ${f.version}`);
  }
});

test('a CRLF checkout (Git on Windows) hashes like the LF file', () => {
  assert.equal(sha256(Buffer.from('a\r\nb\n')), sha256(Buffer.from('a\nb\n')));
  assert.notEqual(sha256(Buffer.from('a\nb\n')), sha256(Buffer.from('a\nc\n')));
});
