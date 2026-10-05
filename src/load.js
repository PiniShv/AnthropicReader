/* Input gathering (files, folders, zips, drag-and-drop, remembered handles)
 * and streaming JSON parsing for very large top-level arrays. */
'use strict';

/* ---------- File nodes: loose files, with the same interface as zip entries (ZipEntry) ---------- */

class FileNode {
  constructor(path, file, container) {
    this.path = path;            // normalised, forward slashes, no leading slash
    this.file = file;
    this.size = file.size;
    this.container = container;  // what the user picked (folder or file name)
  }
  stream() { return Promise.resolve(this.file.stream()); }
  async bytes() { return new Uint8Array(await this.file.arrayBuffer()); }
  text() { return this.file.text(); }
  async blob(type) { return type ? new Blob([this.file], { type }) : this.file; }
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/* ---------- Gathering inputs ---------- */

// Turn picked File objects (plain or with webkitRelativePath) plus zips into nodes.
async function nodesFromFiles(files, onStatus) {
  const nodes = [];
  const sources = [];
  for (const f of files) {
    const path = normPath(f.relPath || f.webkitRelativePath || f.name);
    if (/\.zip$/i.test(f.name)) {
      onStatus && onStatus('Reading index of ' + f.name + '…');
      try {
        const zip = await ZipArchive.open(f);
        const before = nodes.length;
        for (const e of zip.entries) nodes.push(e);
        sources.push({ name: f.name, kind: 'zip', size: f.size, entries: nodes.length - before });
      } catch (err) {
        sources.push({ name: f.name, kind: 'zip', size: f.size, error: String(err.message || err) });
      }
    } else {
      nodes.push(new FileNode(path, f, path.split('/')[0]));
    }
  }
  const looseCount = files.filter(f => !/\.zip$/i.test(f.name)).length;
  if (looseCount) sources.push({ name: looseCount + ' loose file' + (looseCount === 1 ? '' : 's'), kind: 'files', entries: looseCount });
  return { nodes, sources };
}

// Recursively read a drag-and-drop directory entry (webkitGetAsEntry API).
function readDropEntry(entry, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(f => { f.relPath = entry.fullPath; out.push(f); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const next = () => reader.readEntries(batch => {
        if (!batch.length) {
          Promise.all(all.map(e => readDropEntry(e, out))).then(() => resolve());
        } else { all.push(...batch); next(); }
      }, () => resolve());
      next();
    } else resolve();
  });
}

async function filesFromDataTransfer(dt) {
  const out = [];
  const items = Array.from(dt.items || []).filter(i => i.kind === 'file');
  const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.some(Boolean)) {
    await Promise.all(entries.filter(Boolean).map(e => readDropEntry(e, out)));
  } else {
    out.push(...Array.from(dt.files || []));
  }
  return out;
}

// File System Access API handles (Chrome/Edge): lets us offer "Reopen last export".
async function filesFromHandles(handles) {
  const out = [];
  async function walk(h, prefix) {
    if (h.kind === 'file') {
      const f = await h.getFile();
      f.relPath = prefix + f.name;
      out.push(f);
    } else {
      for await (const child of h.values()) await walk(child, prefix + h.name + '/');
    }
  }
  for (const h of handles) await walk(h, '');
  return out;
}

const HandleStore = {
  _db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('claude-export-reader', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async save(handles) {
    try {
      const db = await this._db();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ handles, savedAt: new Date().toISOString() }, 'last');
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* storage unavailable: nothing to remember */ }
  },
  async load() {
    try {
      const db = await this._db();
      return await new Promise((res) => {
        const req = db.transaction('kv').objectStore('kv').get('last');
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
    } catch (e) { return null; }
  },
  async clear() {
    try {
      const db = await this._db();
      db.transaction('kv', 'readwrite').objectStore('kv').delete('last');
    } catch (e) { /* ignore */ }
  },
};

/* ---------- Streaming parse of a huge top-level JSON array ---------- */

// One byte array from several. A single part is returned as it is, without a copy.
function concatBytes(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* Calls onItem(value, text) for every element of the top-level array without ever building
 * one giant string (V8 caps strings near 512 MB). Works on raw UTF-8 bytes: every JSON
 * structural character is ASCII, so multi-byte characters can never be mistaken for one.
 * If the document is not an array, the whole value is passed to onItem once. */
async function parseJsonArrayStream(stream, onItem, onProgress) {
  const reader = stream.getReader();
  const dec = new TextDecoder('utf-8');
  let depth = 0;          // 0 = outside the array, 1 = inside it, 2+ = inside an element
  let inStr = false, esc = false;
  let inItem = false, itemIsContainer = false;
  let parts = [];         // byte chunks of the element being collected
  let mode = 'start';     // 'start' | 'array' | 'single' | 'done'
  let single = [];        // chunks when the document is not an array
  let done = 0;

  const flush = (chunk, from, to) => {
    parts.push(chunk.subarray(from, to));
    const buf = concatBytes(parts);
    parts = [];
    const text = dec.decode(buf).trim();
    if (text) onItem(JSON.parse(text), text);
  };

  for (;;) {
    const { value: chunk, done: end } = await reader.read();
    if (end) break;
    done += chunk.length;
    let i = 0;
    const n = chunk.length;

    if (mode === 'start') {
      while (i < n && (chunk[i] === 0x20 || chunk[i] === 0x0a || chunk[i] === 0x0d || chunk[i] === 0x09 || chunk[i] === 0xef || chunk[i] === 0xbb || chunk[i] === 0xbf)) i++;
      if (i === n) { onProgress && onProgress(done); continue; }
      if (chunk[i] === 0x5b) { mode = 'array'; depth = 1; i++; }
      else mode = 'single';
    }
    if (mode === 'single') { single.push(chunk.subarray(i)); onProgress && onProgress(done); continue; }
    if (mode === 'done') continue;

    let segStart = inItem ? 0 : -1;
    // Cached positions of the next quote / backslash at or after i (-1 = none left in
    // this chunk). Positions only move forward, so caching keeps the scan linear.
    let nq = -2, nb = -2;
    for (; i < n; i++) {
      const c = chunk[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (nb !== -1 && nb < i) nb = chunk.indexOf(0x5c, i);
        if (nq !== -1 && nq < i) nq = chunk.indexOf(0x22, i);
        if (nb !== -1 && (nq === -1 || nb < nq)) { i = nb; esc = true; continue; }
        if (nq === -1) { i = n; break; }
        i = nq; inStr = false;
        continue;
      }
      if (c === 0x22) {
        if (!inItem && depth === 1) { inItem = true; itemIsContainer = false; segStart = i; }
        inStr = true; continue;
      }
      if (c === 0x7b || c === 0x5b) {
        if (!inItem && depth === 1) { inItem = true; itemIsContainer = true; segStart = i; }
        depth++; continue;
      }
      if (c === 0x7d || c === 0x5d) {
        if (depth === 1) {
          // closing bracket of the top-level array
          if (inItem && !itemIsContainer) { flush(chunk, segStart, i); inItem = false; }
          mode = 'done'; depth = 0; break;
        }
        depth--;
        if (depth === 1 && inItem && itemIsContainer) { flush(chunk, segStart, i + 1); inItem = false; segStart = -1; }
        continue;
      }
      if (depth === 1) {
        if (c === 0x2c) {
          if (inItem) { flush(chunk, segStart, i); inItem = false; segStart = -1; }
          continue;
        }
        if (!inItem && c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) {
          inItem = true; itemIsContainer = false; segStart = i;
        }
      }
    }
    if (inItem && segStart >= 0) {
      const tail = chunk.slice(segStart, n);  // copy: the stream may reuse its buffer
      parts.push(tail);
    }
    onProgress && onProgress(done);
  }

  if (mode === 'single') {
    const text = dec.decode(concatBytes(single)).trim();
    if (text) onItem(JSON.parse(text), text);
  } else if (mode === 'array' && depth !== 0) {
    throw new Error('JSON ended before the top-level array was closed (file may be truncated).');
  }
}
