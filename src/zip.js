/* Minimal random-access ZIP reader.
 * Reads only the central directory up front, then inflates single entries on demand
 * with the browser's native DecompressionStream, so multi-GB archives never load whole.
 * Supports STORED (0) and DEFLATE (8), ZIP64, data descriptors, UTF-8 names. */
'use strict';

const ZIP_SIG_EOCD = 0x06054b50;
const ZIP_SIG_EOCD64_LOC = 0x07064b50;
const ZIP_SIG_EOCD64 = 0x06064b50;
const ZIP_SIG_CEN = 0x02014b50;
const ZIP_SIG_LOC = 0x04034b50;

const utf8 = new TextDecoder('utf-8');

// A path as the import reads it: forward slashes and no leading slash. Zips made on Windows
// can have backslashes in their names. load.js uses it for loose files too.
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/* Unpacking DEFLATE needs DecompressionStream('deflate-raw'): Chrome and Edge 103, Firefox
 * 113, Safari 16.4. Older browsers have no DecompressionStream, or one without 'deflate-raw'
 * (Chrome 80-102), so a zip that needs it fails at once with this message, not later with an
 * engine error per file. STORED zips (the sample data) and unzipped folders still work. */
const NO_INFLATE = 'This browser cannot unpack zip files. Use Chrome or Edge 103, Firefox 113 or Safari 16.4 or newer, or unzip the files first and choose the folder.';
function canInflate() {
  try { new DecompressionStream('deflate-raw'); return true; } catch (e) { return false; }
}

async function readSlice(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function u64(dv, off) {
  // Safe for values < 2^53, which covers any real archive.
  return dv.getUint32(off, true) + dv.getUint32(off + 4, true) * 0x100000000;
}

class ZipEntry {
  constructor(zip, name, method, flags, compSize, size, localOffset) {
    this.zip = zip;
    this.name = name;
    this.method = method;
    this.flags = flags;
    this.compSize = compSize;
    this.size = size;
    this.localOffset = localOffset;
  }

  // An entry is also a file node for the import (like FileNode in load.js).
  get path() { return normPath(this.name); }
  get container() { return this.zip.file.name; }   // the zip the person picked

  async _dataStart() {
    const head = await readSlice(this.zip.file, this.localOffset, this.localOffset + 30);
    const dv = new DataView(head.buffer);
    if (dv.getUint32(0, true) !== ZIP_SIG_LOC) throw new Error('Bad local header for ' + this.name);
    return this.localOffset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  }

  /** ReadableStream of the uncompressed bytes. */
  async stream() {
    const start = await this._dataStart();
    const raw = this.zip.file.slice(start, start + this.compSize).stream();
    if (this.method === 0) return raw;
    if (this.method === 8) return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    throw new Error('Unsupported ZIP compression method ' + this.method + ' for ' + this.name);
  }

  async bytes() {
    const start = await this._dataStart();
    const raw = this.zip.file.slice(start, start + this.compSize);
    if (this.method === 0) return new Uint8Array(await raw.arrayBuffer());
    if (this.method !== 8) throw new Error('Unsupported ZIP compression method ' + this.method + ' for ' + this.name);
    const out = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(out);
  }

  async text() { return utf8.decode(await this.bytes()); }
  async blob(type) { return new Blob([await this.bytes()], { type: type || '' }); }
}

/* Minimal ZIP writer (STORED, UTF-8 names) for "download this person's data". */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ZipWriter {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.names = new Set();
    const d = new Date();
    this.dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    this.dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }

  add(name, data) {
    const enc = new TextEncoder();
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    // Paths can come from the export itself: never let "." or ".." escape the zip's folder.
    let n = String(name).split(/[\\/]+/).filter(s => s && s !== '.').map(s => (s === '..' ? '_' : s)).join('/') || 'file';
    // Keep names unique: "a.md", "a (2).md", …
    if (this.names.has(n)) {
      const dot = n.lastIndexOf('.');
      const stem = dot > n.lastIndexOf('/') ? n.slice(0, dot) : n;
      const ext = dot > n.lastIndexOf('/') ? n.slice(dot) : '';
      let i = 2;
      while (this.names.has(stem + ' (' + i + ')' + ext)) i++;
      n = stem + ' (' + i + ')' + ext;
    }
    this.names.add(n);
    const nameBytes = enc.encode(n);
    const crc = crc32(bytes);
    if (this.offset + bytes.length > 0xfffffff0 || this.central.length / 2 >= 0xffff) {
      throw new Error('Too much data for one zip file (over 4 GB or 65,535 files).');
    }
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);          // UTF-8 names
    head.setUint16(8, 0, true);               // STORED
    head.setUint16(10, this.dosTime, true);
    head.setUint16(12, this.dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, bytes.length, true);
    head.setUint32(22, bytes.length, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint16(28, 0, true);
    this.parts.push(head.buffer, nameBytes, bytes);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, this.dosTime, true);
    cen.setUint16(14, this.dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, bytes.length, true);
    cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, this.offset, true);
    this.central.push(cen.buffer, nameBytes);
    this.offset += 30 + nameBytes.length + bytes.length;
  }

  blob() {
    const cdSize = this.central.reduce((a, p) => a + (p.byteLength != null ? p.byteLength : p.length), 0);
    const count = this.central.length / 2;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}

class ZipArchive {
  constructor(file) {
    this.file = file;
    this.entries = [];
  }

  static async open(file) {
    const zip = new ZipArchive(file);
    await zip._readDirectory();
    if (zip.entries.some(e => e.method === 8) && !canInflate()) throw new Error(NO_INFLATE);
    return zip;
  }

  async _readDirectory() {
    const size = this.file.size;
    const tailLen = Math.min(size, 65557 + 22);
    const tail = await readSlice(this.file, size - tailLen, size);
    const tdv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tdv.getUint32(i, true) === ZIP_SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(this.file.name + ' is not a ZIP file (no end-of-directory record).');

    let count = tdv.getUint16(eocd + 10, true);
    let cdSize = tdv.getUint32(eocd + 12, true);
    let cdOffset = tdv.getUint32(eocd + 16, true);

    // ZIP64: a locator sits 20 bytes before the classic EOCD record.
    const locPos = eocd - 20;
    if (locPos >= 0 && tdv.getUint32(locPos, true) === ZIP_SIG_EOCD64_LOC) {
      const eocd64Off = u64(tdv, locPos + 8);
      const rec = await readSlice(this.file, eocd64Off, eocd64Off + 56);
      const rdv = new DataView(rec.buffer);
      if (rdv.getUint32(0, true) === ZIP_SIG_EOCD64) {
        count = u64(rdv, 32);
        cdSize = u64(rdv, 40);
        cdOffset = u64(rdv, 48);
      }
    }

    const cd = await readSlice(this.file, cdOffset, cdOffset + cdSize);
    const dv = new DataView(cd.buffer);
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (dv.getUint32(p, true) !== ZIP_SIG_CEN) throw new Error('Corrupt central directory in ' + this.file.name);
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let compSize = dv.getUint32(p + 20, true);
      let usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      let localOffset = dv.getUint32(p + 42, true);
      const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));

      // ZIP64 extended information extra field (0x0001) holds the real 64-bit values,
      // in order, only for the fields that are 0xFFFFFFFF above.
      if (usize === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
        let e = p + 46 + nameLen;
        const eEnd = e + extraLen;
        while (e + 4 <= eEnd) {
          const id = dv.getUint16(e, true);
          const len = dv.getUint16(e + 2, true);
          if (id === 0x0001) {
            let q = e + 4;
            if (usize === 0xffffffff) { usize = u64(dv, q); q += 8; }
            if (compSize === 0xffffffff) { compSize = u64(dv, q); q += 8; }
            if (localOffset === 0xffffffff) { localOffset = u64(dv, q); q += 8; }
            break;
          }
          e += 4 + len;
        }
      }

      if (!name.endsWith('/')) {
        this.entries.push(new ZipEntry(this, name, method, flags, compSize, usize, localOffset));
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
  }
}
