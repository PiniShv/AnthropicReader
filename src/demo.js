/* Sample data: a small, entirely made-up team export in the real export format.
 * Used by "Try it with sample data", the tests and the screenshots.
 *
 * Everything here is invented: the company (Northwind Labs), its people, their chats,
 * files and numbers. Ids come from fixed keys and every date is fixed, so each run builds
 * exactly the same bytes. It runs in the browser and in Node 20+: it needs only File,
 * Blob and TextEncoder, plus ZipWriter from zip.js. */
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

/* ---------- Conversations: builders ---------- */

const DEMO_TOOL_PLACEHOLDER = '\n```\nThis block is not supported on your current device yet.\n```\n\n';
const DEMO_ARTIFACT_PLACEHOLDER = '\n```\nViewing artifacts created via the Analysis Tool web feature preview isn\'t yet supported on mobile.\n```\n\n';

function demoText(text, citations) { return { type: 'text', text, citations: citations || [] }; }

function demoThinking(thinking, summaries, hidden) {
  return {
    type: 'thinking', thinking: hidden ? '' : thinking, summaries: summaries.map(s => ({ summary: s })),
    cut_off: false, truncated: false, hidden: false, thinking_hidden: !!hidden, alternative_display_type: null, signature: null,
  };
}

// A tool call and its result. `res` holds tool_result keys, `use` extra tool_use keys.
function demoTool(name, input, res, use) { return { tool: true, name, input, res: res || {}, use: use || {} }; }
const demoOut = text => [{ type: 'text', text }];

// A web citation over `phrase` in `text`. Offsets count code points, like the export does.
function demoCite(text, phrase, url) {
  const at = text.indexOf(phrase);
  if (at < 0) throw new Error('demo citation not found: ' + phrase);
  const start = Array.from(text.slice(0, at)).length;
  return { uuid: demoUuid('cite:' + url + ':' + at), start_index: start, end_index: start + Array.from(phrase).length, details: { type: 'web_search_citation', url } };
}

// A web page as web_search and web_fetch return it.
function demoWebPage(title, url, site, text, extra) {
  const host = /^https?:\/\/([^/]+)/.exec(url)[1];
  return {
    type: 'knowledge', title, url, text,
    metadata: { type: 'webpage_metadata', site_domain: host, site_name: site, favicon_url: null },
    is_missing: false, is_citable: true, prompt_context_metadata: Object.assign({ url }, extra || {}),
  };
}

function demoAttachment(name, type, text) {
  return { file_name: name, file_size: text.length, file_type: type, extracted_content: text };
}

/* One conversation. Turns are human ('h') or assistant ('a') messages in array order.
 * Each message's parent is the one before it, unless the turn names another (`parent`),
 * or 'root' for an edited first prompt. `wait` is the gap before the turn in seconds. */
function demoChat(spec) {
  const rnd = demoRng(demoHash('chat:' + spec.key));
  const jitter = max => Math.floor(rnd() * max);
  let clock = demoMs(spec.start) + jitter(50000);
  const byKey = new Map();
  let prev = DEMO_ROOT;
  let toolNo = 0;
  let firstMs = 0, lastMs = 0;
  const stamp = (b, secs) => {
    b.start_timestamp = demoIso(clock, 'z6');
    if (secs) clock += Math.round(secs * 1000) + jitter(400);
    b.stop_timestamp = demoIso(clock, 'z6');
    b.flags = null;
    return b;
  };
  const msgs = (spec.turns || []).map((t, i) => {
    const key = t.k || String(i);
    const uuid = demoUuid('msg:' + spec.key + ':' + key);
    if (i) clock += (t.wait != null ? t.wait : t.who === 'h' ? 75 : 2) * 1000 + jitter(9000);
    const parent = t.parent === 'root' ? DEMO_ROOT : t.parent ? byKey.get(t.parent) : prev;
    byKey.set(key, uuid);
    prev = uuid;
    const content = [];
    let text = '';
    let created = clock;
    if (t.who === 'h') {
      if (!t.empty) {
        content.push(stamp(demoText(t.text), 0));
        text = t.text;
        if (t.inject) {
          content.push(stamp({ type: 'injected_prompt_block', prompt: t.inject.prompt, injection_source: t.inject.source, initial_turn_only: false, skip_on_truncated_continuation: false }, 0));
        }
      }
    } else if (!t.empty) {
      clock += 1200 + jitter(800);
      for (const b of (t.blocks || []).flat()) {
        if (b.tool) {
          const id = 'toolu_01' + demoChars(spec.key + ':tool:' + toolNo++, 22, DEMO_B62);
          content.push(stamp(Object.assign({ type: 'tool_use', id, name: b.name, input: b.input, message: null, integration_name: null }, b.use), 1));
          content.push(stamp(Object.assign({ type: 'tool_result', tool_use_id: id, name: b.name, content: [], is_error: false }, b.res), b.res.is_error ? 0.8 : 2.5));
          text += b.name === 'artifacts' ? DEMO_ARTIFACT_PLACEHOLDER : DEMO_TOOL_PLACEHOLDER;
        } else {
          const blk = Object.assign({}, b);
          const len = (blk.text || blk.thinking || '').length;
          content.push(stamp(blk, blk.type === 'thinking' ? 3 + len / 150 : 1 + len / 90));
          text += blk.type === 'thinking' ? blk.thinking : blk.text;
        }
      }
      created = clock + 300;
      clock = created;
    }
    if (!firstMs) firstMs = created;
    lastMs = created;
    const attachments = t.attachments || [];
    // Every attachment also has a same-name entry in files[]; other uploads are references only.
    const fileNames = attachments.map(a => a.file_name).concat(t.files || []);
    return {
      uuid, text, content, sender: t.who === 'h' ? 'human' : 'assistant',
      created_at: demoIso(created, 'z6'), updated_at: demoIso(created, 'z6'),
      attachments,
      files: fileNames.map((n, j) => ({ file_uuid: demoUuid('file:' + spec.key + ':' + key + ':' + j), file_name: n })),
      parent_message_uuid: parent,
    };
  });
  const start = firstMs || demoMs(spec.start);
  return {
    uuid: demoUuid('chat:' + spec.key), name: spec.name || '', summary: spec.summary || '',
    created_at: demoIso(start - 1500, 'z6'), updated_at: demoIso((lastMs || start) + 800, 'z6'),
    account: { uuid: demoUser(spec.owner) }, chat_messages: msgs,
  };
}

/* ---------- Conversations: content ---------- */

function demoConversations() {
  const F = DEMO_FENCE;
  const T = demoText;
  const fileTool = { integration_name: 'File Creation' };
  const bash = (command, description, stdout, code, stderr) => demoTool('bash_tool', { command, description },
    { content: demoOut(JSON.stringify({ returncode: code || 0, stdout, stderr: stderr || '' })) },
    Object.assign({ message: description, icon_name: 'commandLine', display_content: { type: 'json_block', json_block: JSON.stringify({ language: 'bash', code: command }) } }, fileTool));
  const createFile = (path, fileText, description) => demoTool('create_file', { description, path, file_text: fileText },
    { content: demoOut('File created successfully: ' + path), meta: { output_format_category: path.split('.').pop() === 'html' ? 'html' : 'other' } },
    Object.assign({ message: description, icon_name: 'file' }, fileTool));
  const present = files => demoTool('present_files', { filepaths: files.map(f => f[0]) },
    { content: files.map(([p, mime]) => ({ type: 'local_resource', file_path: p, name: p.split('/').pop(), mime_type: mime, uuid: demoUuid('res:' + p) })), message: files.length === 1 ? 'Presented file' : 'Presented ' + files.length + ' files' },
    Object.assign({ message: 'Presenting file(s)...', icon_name: 'file', display_content: { type: 'table', table: files.map(f => ['File', f[0].split('/').pop()]) } }, fileTool));
  const replace = (path, oldStr, newStr, description) => demoTool('str_replace', { description, path, old_str: oldStr, new_str: newStr },
    { content: demoOut('Successfully replaced string in ' + path) },
    Object.assign({ message: description, icon_name: 'edit', display_content: { type: 'text', text: description } }, fileTool));
  const widget = { integration_name: 'Dynamic Widget' };

  const reportPath = '/mnt/user-data/outputs/q3-onboarding-report.html';
  const reportId = demoUuid('art:report');
  const slidesId = demoUuid('art:kickoff-slides');

  const spring = demoLines(
    '🌱 Spring campaigns this year share three ideas.',
    '',
    '**1. A fresh start for team habits.** Many brands frame spring as a reset and offer checklists and templates to tidy up projects.',
    '',
    '**2. Free seats for small teams.** Several tools give small teams extra seats for a few months to grow usage.',
    '',
    '**3. Customers tell the story.** Short customer videos replace product tours in ads.',
    '',
    'For Northwind, the fresh-start idea fits our new onboarding checklist best.',
  );
  const springUrls = [
    'https://marketing-weekly.example/2026/fresh-start-campaigns',
    'https://saas-notes.example/free-seats-for-small-teams',
    'https://brand-stories.example/customer-led-campaigns',
  ];

  const interviewNotes = demoLines(
    '# Customer interviews, week 36',
    '',
    '## 1. Design agency, 12 people',
    '- Set-up took one afternoon',
    '- Did not find the invite button at first ("I looked for it under Settings")',
    '- Loves the weekly summary email',
    '',
    '## 2. Logistics start-up, 40 people',
    '- Uses Northwind for sprint planning',
    '- Wants SSO before they add more teams',
    '- Invited 6 teammates in week one',
    '',
    '## 3. Accounting firm, 25 people',
    '- Only two people use it so far',
    '- Not sure who should own the account',
    '',
    '## 4. Online shop, 8 people',
    '- Uses the mobile app every day',
    '- Wants CSV export for monthly reports',
    '',
    '## 5. Non-profit, 15 people',
    '- Struggled to import old tasks',
    '- Not sure who should be the admin',
  );

  const pythonScript = demoLines(
    '"""Find customers that appear more than once with slightly different emails."""',
    'import sys',
    '',
    'import pandas as pd',
    '',
    '',
    'def normalise(email: str) -> str:',
    '    return "".join(str(email).split()).lower()',
    '',
    '',
    'def main(src: str, dest: str) -> None:',
    '    df = pd.read_csv(src)',
    '    print(f"Read {len(df):,} rows")',
    '    df["email_key"] = df["email"].map(normalise)',
    '    dupes = df[df.duplicated("email_key", keep=False)].sort_values("email_key")',
    '    print(f"Found {dupes[\'email_key\'].nunique():,} duplicate groups ({len(dupes):,} rows)")',
    '    dupes.to_excel(dest, index=False)',
    '    print(f"Wrote {dest}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main(sys.argv[1], sys.argv[2])',
    '',
  );

  const roadmapSvg = demoLines(
    '<svg width="100%" viewBox="0 0 680 200" role="img" xmlns="http://www.w3.org/2000/svg">',
    '<title>Q4 retention plan</title>',
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round"/></marker></defs>',
    '<g class="c-teal"><rect x="20" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="110" y="92" text-anchor="middle">Onboarding checklist</text><text class="ts" x="110" y="116" text-anchor="middle">Web team · Oct–Nov</text></g>',
    '<g class="c-purple"><rect x="250" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="340" y="92" text-anchor="middle">First project</text><text class="ts" x="340" y="116" text-anchor="middle">Goal: 60% of new teams</text></g>',
    '<g class="c-amber"><rect x="480" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="570" y="92" text-anchor="middle">Usage alerts</text><text class="ts" x="570" y="116" text-anchor="middle">Data team · Nov–Dec</text></g>',
    '<line class="arr" x1="202" y1="98" x2="246" y2="98" marker-end="url(#arrow)"/>',
    '<line class="arr" x1="432" y1="98" x2="476" y2="98" marker-end="url(#arrow)"/>',
    '<text class="ts" x="340" y="184" text-anchor="middle">Q4 focus: keep new teams active after week 4</text>',
    '</svg>',
  );

  const brandGuide = demoLines(
    '# Northwind brand voice',
    '',
    'We sound like a helpful colleague: **clear first, warm second, never pushy.**',
    '',
    '## Three rules',
    '1. **Say it simply.** Short sentences, common words.',
    '2. **Lead with what the reader gets.**',
    '3. **Be human.** It is fine to say "we" and "you".',
    '',
    '## Do and don\'t',
    '',
    '| Do | Don\'t |',
    '|---|---|',
    '| "Invite your team in two clicks." | "Leverage our seamless collaboration suite." |',
    '| "Something went wrong. Please try again." | "An unexpected error has occurred." |',
    '| "Thanks for telling us!" | "Your feedback is valuable to us." |',
    '',
    '## Words we like',
    '*team, project, start, simple, together*',
  );

  const churnRows = [['2026-07-20', 42, 1.9], ['2026-07-27', 39, 1.8], ['2026-08-03', 45, 2.0], ['2026-08-10', 37, 1.7],
    ['2026-08-17', 33, 1.5], ['2026-08-24', 36, 1.6], ['2026-08-31', 29, 1.3], ['2026-09-07', 27, 1.2]];
  const churnData = churnRows.map(([week, churned, pct]) => ({ week, churned_teams: churned, churn_pct: pct }));
  const warehouse = { integration_name: 'Warehouse', mcp_server_url: 'https://mcp.warehouse.example/mcp', is_mcp_app: false, icon_name: 'search' };

  const travelPolicy = demoLines(
    'Travel policy (excerpt)',
    '',
    '3.1 Book through the travel desk when you can.',
    '3.2 Trains: second class by default. First class is allowed for trips longer than 4 hours, or when it costs the same as second class.',
    '3.3 Flights: economy class only.',
  );

  const specs = [
    // ---- Amara Okafor: product lead ----
    {
      key: 'q3-report', owner: 'amara', name: 'Q3 onboarding report', start: '2026-09-08T09:12',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Amara shared the Q3 onboarding numbers as a CSV file and asked for a one-page HTML report with a table of contents. Claude built the report, then renamed it to *Q3 Onboarding Review*, added percentages to the funnel table and published it for the team.',
        '',
        '**Key numbers**',
        '',
        '- 1,240 new teams signed up; 49% were still active in week 4',
        '- Start-ups had the best week-4 activity (54%)',
      ),
      turns: [
        {
          who: 'h', text: 'Here are our Q3 onboarding numbers. Can you turn them into a one-page HTML report for the team? Keep it clean, with a short table of contents at the top.',
          attachments: [demoAttachment('q3-onboarding.csv', 'text/csv', demoLines(
            'step,teams,share_of_signups', 'Signed up,1240,100%', 'Invited teammates,860,69%', 'Created first project,702,57%', 'Active in week 4,612,49%',
            '', 'segment,teams,active_week_4', 'Start-ups,520,54%', 'Mid-size,480,47%', 'Enterprise,240,42%'))],
        },
        {
          who: 'a', blocks: [
            demoThinking('Amara wants a one-page HTML report from the CSV. The data has two parts: the funnel and the segments. A table of contents with links to each section fits a one-pager. I will keep the styling simple so it reads well in light and dark mode, and put the three key numbers at the top.',
              ['Read the funnel and segment numbers from the CSV.', 'Planned a one-page layout with a table of contents and key numbers first.']),
            T('I\'ll build a single HTML page with four short sections: summary, funnel, segments and next steps.'),
            createFile(reportPath, demoReportHtml(1), 'Q3 onboarding report as a one-page HTML file'),
            present([[reportPath, 'text/html']]),
            T(demoLines(
              'Here\'s the report. The table of contents at the top links to each section.',
              '',
              'A few things stand out:',
              '',
              '- **69%** of new teams invited a teammate, but only **49%** were still active in week 4.',
              '- Start-ups stay active more often than enterprise teams (54% vs 42%).',
              '',
              'Want me to change anything before you share it?',
            )),
          ],
        },
        { who: 'h', wait: 107000, text: 'Looks great. Please rename it to “Q3 Onboarding Review”, add the percentages to the funnel table and publish it so the team can open it.' },
        {
          who: 'a', blocks: [
            replace(reportPath, '<h1>Q3 Onboarding Report</h1>', '<h1>Q3 Onboarding Review</h1>', 'Rename the report'),
            replace(reportPath, '<tr><th>Step</th><th>Teams</th></tr>', '<tr><th>Step</th><th>Teams</th><th>Share</th></tr>', 'Add a share column to the funnel table'),
            demoTool('Artifact', { action: 'publish', file_path: reportPath, title: 'Q3 Onboarding Review', favicon: 'chart' }, {
              content: demoOut('Published https://claude.ai/code/artifact/' + reportId),
              display_content: { type: 'file', published_url: 'https://claude.ai/code/artifact/' + reportId, published_artifact_id: reportId, published_action: 'published', title: 'Q3 Onboarding Review', pinned: null, owned_by_account: true },
              structured_content: { url: 'https://claude.ai/code/artifact/' + reportId, owned: true, title: 'Q3 Onboarding Review', artifact_id: reportId },
              message: 'Published artifact',
            }, { message: 'Publishing the report' }),
            T('Done. The report is published as **Q3 Onboarding Review**, and everyone at Northwind Labs can open it. I changed the title and added a share column to the funnel table.'),
          ],
        },
      ],
    },
    {
      key: 'launch-email', owner: 'amara', name: 'Activation dashboard launch email', start: '2026-09-15T13:40',
      turns: [
        { who: 'h', text: 'We launch the new activation dashboard on Monday. Draft a short email to all customer success managers. Two versions please: one warm, one very short.' },
        {
          who: 'a', blocks: [
            T('Here are two drafts.'),
            demoTool('message_compose_v1', {
              kind: 'email', summary_title: 'Activation dashboard launch',
              variants: [
                { label: 'Warm', subject: 'Meet the new activation dashboard', body: demoLines('Hi team,', '', 'On Monday we launch the new activation dashboard. For every customer, it shows how far they got in onboarding and where they got stuck.', '', 'Two things get easier:', '- spotting teams that have not invited anyone yet', '- seeing which accounts need a check-in call this week', '', 'There is a 15-minute walkthrough on Monday at 10:00. Bring your questions!', '', 'Thanks,', 'Amara') },
                { label: 'Short', subject: 'New: activation dashboard (Monday)', body: demoLines('Hi all,', '', 'The activation dashboard goes live on Monday. It shows where each customer is in onboarding. Walkthrough on Monday at 10:00.', '', 'Amara') },
              ],
            }, { content: demoOut('The drafts were shown to the user.') }, widget),
            T('Tell me if you want a version for customers too.'),
          ],
        },
      ],
    },
    {
      key: 'roadmap', owner: 'amara', name: 'Q4 roadmap priorities', start: '2026-08-21T10:05',
      turns: [
        { who: 'h', text: 'Help me prioritise the Q4 roadmap. The candidates are: onboarding checklist, SSO for small teams, usage alerts, a new mobile home screen and CSV export for reports.' },
        {
          who: 'a', blocks: [
            T('Happy to help. Two quick questions first, so the ranking fits your goals.'),
            demoTool('ask_user_input_v0', {
              questions: [
                { question: 'What matters most in Q4?', options: ['Retention', 'New revenue', 'Team speed'], type: 'single_select' },
                { question: 'Which teams have time this quarter?', options: ['Web', 'Mobile', 'Data'], type: 'multi_select' },
              ],
            }, { content: demoOut('The questions were shown to the user.'), message: 'Generated ask_user_input_v0 widget' }, widget),
          ],
        },
        { who: 'h', text: 'Retention matters most. Web and Data have time; Mobile is busy until November.' },
        {
          who: 'a', blocks: [
            T(demoLines(
              'Here is a ranking based on retention and the teams you have:',
              '',
              '| Rank | Feature | Why | Team |',
              '|---|---|---|---|',
              '| 1 | Onboarding checklist | Directly lifts week-4 activity | Web |',
              '| 2 | Usage alerts | Warns customer success before a team goes quiet | Data |',
              '| 3 | CSV export for reports | Small, and often asked for | Data |',
              '| 4 | SSO for small teams | More about revenue than retention | Web |',
              '| 5 | Mobile home screen | Mobile is busy until November | Mobile |',
              '',
              'And here is how the top two fit together:',
            )),
            demoTool('visualize:show_widget', { title: 'Q4 retention plan', loading_messages: ['Drawing the plan', 'Placing the arrows'], widget_code: roadmapSvg },
              { content: demoOut('The widget was shown to the user.'), meta: { 'io.modelcontextprotocol/serverInfo': { name: 'visualize', version: '1.0.0' } } },
              { integration_name: 'visualize', is_mcp_app: true }),
            T('The checklist gets new teams to their first project; the alerts catch teams that slip after that.'),
          ],
        },
      ],
    },
    {
      key: 'slide-sentence', owner: 'amara', name: '', start: '2026-07-02T16:20',
      turns: [
        { who: 'h', text: 'Can you make this sentence shorter for a slide? “We are rolling out the new onboarding checklist to every customer team over the next six weeks, starting with the teams that signed up most recently.”' },
        { who: 'a', blocks: [T(demoLines('Three options, from shortest to longest:', '', '1. **Onboarding checklist: all teams in six weeks**', '2. **A new checklist for every team, newest first**', '3. **Rolling out the onboarding checklist to all teams over six weeks, newest teams first**'))] },
      ],
    },

    // ---- Kenji Watanabe: platform engineer ----
    {
      key: 'flaky-test', owner: 'kenji', name: 'Flaky checkout test on CI', start: '2026-08-04T11:30',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Kenji asked why the checkout integration test failed about one run in ten on CI. Claude found a fixed 0.5 second sleep after the payment webhook, replaced it with a polling wait, and the test then passed 50 times in a row.',
      ),
      turns: [
        { who: 'h', text: 'Our checkout integration test fails about one run in ten on CI. The repo is in /home/claude/repo. Can you find out why?' },
        {
          who: 'a', blocks: [
            demoThinking('A failure rate of about 10% points to timing, not logic. Payment flows often wait for a webhook, so I should look for fixed sleeps or waits around the webhook in the checkout test. Then run the test many times to see the failure, and check the git history for recent changes to the test.',
              ['Suspected a timing problem rather than a logic bug.', 'Planned to look for fixed waits and to run the test many times.']),
            bash('cd /home/claude/repo && ls tests/integration', 'List the integration tests', 'conftest.py\ntest_cart.py\ntest_checkout.py\ntest_login.py\n'),
            bash('cd /home/claude/repo && grep -n "sleep\\|webhook" tests/integration/test_checkout.py', 'Look for waits in the checkout test',
              '14:from time import sleep\n41:    trigger_payment_webhook(order.id)\n42:    sleep(0.5)\n43:    assert order.refresh().status == "paid"\n'),
            bash('cd /home/claude/repo && python -m pytest tests/integration/test_checkout.py -q --count 20 2>&1 | tail -3', 'Run the test 20 times',
              'FAILED tests/integration/test_checkout.py::test_paid_order[7] - AssertionError: assert \'pending\' == \'paid\'\nFAILED tests/integration/test_checkout.py::test_paid_order[15] - AssertionError: assert \'pending\' == \'paid\'\n2 failed, 18 passed in 41.20s\n', 1,
              'DeprecationWarning: payment_client.sync_charge() will be removed in version 3\n'),
            bash('cd /home/claude/repo && git log --oneline -3 -- tests/integration/test_checkout.py', 'See recent changes to the test',
              'a41c9e2 Speed up checkout tests\n7d02b18 Add paid-order test\n3f9e011 Move checkout tests to integration\n'),
            T(demoLines(
              'Found it. The test triggers the payment webhook and then waits a fixed **0.5 seconds** before it checks the order:',
              '',
              F + 'python',
              'trigger_payment_webhook(order.id)',
              'sleep(0.5)',
              'assert order.refresh().status == "paid"',
              F,
              '',
              'On a busy CI runner the webhook sometimes takes longer than that, so the order is still `pending`. The commit *Speed up checkout tests* lowered the wait from 2 s to 0.5 s.',
              '',
              'A fixed sleep is fragile either way, so I\'ll replace it with a short polling wait.',
            )),
            replace('/home/claude/repo/tests/integration/test_checkout.py', '    sleep(0.5)\n    assert order.refresh().status == "paid"',
              '    wait_for(lambda: order.refresh().status == "paid", timeout=10)', 'Replace the fixed sleep with a polling wait'),
            bash('cd /home/claude/repo && python -m pytest tests/integration/test_checkout.py -q --count 50 2>&1 | tail -1', 'Run the test 50 times', '50 passed in 96.84s\n'),
            T('With the polling wait, **all 50 runs pass**. `wait_for` checks every 100 ms and gives up after 10 s, so the test stays fast when the webhook is quick.'),
          ],
        },
      ],
    },
    {
      // An edited first prompt: two versions of it. Kenji then went back to the first one and
      // carried on there, so the newest message sits on the older branch.
      key: 'rate-limit', owner: 'kenji', name: 'Rate limiting the public API', start: '2026-06-16T09:45',
      turns: [
        { k: 'h1', who: 'h', text: 'What\'s a good way to rate-limit our public API per customer?' },
        { k: 'a1', who: 'a', blocks: [T(demoLines(
          'A **token bucket** per customer is the usual choice:',
          '',
          '- Each customer has a bucket that holds up to *N* tokens (the burst size).',
          '- Tokens refill at a steady rate, for example 100 per minute.',
          '- Each request takes one token. No token, no request: return `429 Too Many Requests` with a `Retry-After` header.',
          '',
          'It allows short bursts but keeps the average rate under control, and it is easy to explain to customers.',
        ))] },
        { k: 'h1b', who: 'h', parent: 'root', wait: 300, text: 'What\'s a good way to rate-limit our public API per customer? We run three app servers behind a load balancer.' },
        { k: 'a1b', who: 'a', blocks: [T(demoLines(
          'With three servers the limit must be shared, or each customer gets three times the limit. Two common options:',
          '',
          '1. **A central counter in Redis.** Each request runs one small atomic script that updates the customer\'s bucket. Simple and exact, but Redis is now on every request.',
          '2. **Limits at the load balancer.** Many gateways support limits per API key. No app code, but less control over the response.',
          '',
          'For most teams, option 1 is the best start.',
        ))] },
        { k: 'h2', who: 'h', parent: 'a1', wait: 900, text: 'Let\'s keep it simple and stay with the plain token bucket for now. Can you show it in Python?' },
        { k: 'a2', who: 'a', blocks: [T(demoLines(
          'Here is a small version that keeps one bucket per customer in memory:',
          '',
          F + 'python',
          'import time',
          'from dataclasses import dataclass, field',
          '',
          '',
          '@dataclass',
          'class TokenBucket:',
          '    rate: float        # tokens added per second',
          '    capacity: int      # largest burst',
          '    tokens: float = field(init=False)',
          '    updated: float = field(init=False)',
          '',
          '    def __post_init__(self):',
          '        self.tokens = self.capacity',
          '        self.updated = time.monotonic()',
          '',
          '    def allow(self) -> bool:',
          '        now = time.monotonic()',
          '        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)',
          '        self.updated = now',
          '        if self.tokens >= 1:',
          '            self.tokens -= 1',
          '            return True',
          '        return False',
          '',
          '',
          'buckets: dict[str, TokenBucket] = {}',
          '',
          '',
          'def allow_request(customer_id: str) -> bool:',
          '    bucket = buckets.setdefault(customer_id, TokenBucket(rate=100 / 60, capacity=20))',
          '    return bucket.allow()',
          F,
          '',
          'This works per server. When you move to the shared set-up, the same logic can run as a Redis script.',
        ))] },
      ],
    },
    {
      // A regenerated reply: two answers to the same prompt.
      key: 'order-regex', owner: 'kenji', name: 'Regex for order IDs', start: '2026-09-22T15:10',
      turns: [
        { k: 'h1', who: 'h', text: 'I need a regex that matches order IDs like NW-2026-000123 but not NW-26-123.' },
        { k: 'a1', who: 'a', blocks: [T(demoLines('This should do it:', '', F, '^NW-\\d{4}-\\d{6}$', F))] },
        { k: 'a1b', who: 'a', parent: 'h1', wait: 40, blocks: [T(demoLines(
          'Use this pattern:',
          '',
          F + 'regex',
          '^NW-(?<year>\\d{4})-(?<number>\\d{6})$',
          F,
          '',
          '- `^` and `$` make sure the whole string is an order ID, not just part of it.',
          '- `\\d{4}` needs a four-digit year, so `NW-26-123` does not match.',
          '- The named groups let you read the year and the number directly.',
          '',
          '| Input | Match? |',
          '|---|---|',
          '| `NW-2026-000123` | yes |',
          '| `NW-26-123` | no |',
          '| `XNW-2026-000123` | no |',
        ))] },
        { k: 'h2', who: 'h', parent: 'a1b', text: 'Perfect. Does that work in JavaScript too?' },
        { k: 'a2', who: 'a', blocks: [T(demoLines(
          'Yes. Named groups work in all current browsers and in Node:',
          '',
          F + 'js',
          'const m = /^NW-(?<year>\\d{4})-(?<number>\\d{6})$/.exec(\'NW-2026-000123\');',
          'console.log(m.groups.year);   // "2026"',
          F,
        ))] },
      ],
    },
    {
      key: 'dedupe', owner: 'kenji', name: 'Find duplicate customers in a CSV', start: '2026-07-28T14:00',
      turns: [
        { who: 'h', text: 'I have customers.csv with about 40,000 rows. Some customers appear twice with small differences in the email (upper case, spaces). Can you write a script that finds them and gives me a spreadsheet?', files: ['customers.csv'] },
        {
          who: 'a', blocks: [
            T('I\'ll write a small script that normalises the emails and groups the rows that match.'),
            createFile('/mnt/user-data/outputs/find_duplicates.py', pythonScript, 'Script that finds duplicate customers'),
            bash('cd /mnt/user-data/outputs && python find_duplicates.py /mnt/user-data/uploads/customers.csv duplicates-report.xlsx', 'Run the script on the uploaded file',
              'Read 40,212 rows\nFound 1,318 duplicate groups (2,701 rows)\nWrote duplicates-report.xlsx\n'),
            present([['/mnt/user-data/outputs/find_duplicates.py', 'text/x-python'], ['/mnt/user-data/outputs/duplicates-report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]),
            T('Done. The spreadsheet has one row per duplicate customer, sorted so that each group sits together: **1,318 groups** in total. The script is attached too, so you can run it again next month.'),
          ],
        },
      ],
    },

    // ---- Noor Haddad: user researcher (one chat in Hebrew, to show right-to-left text) ----
    {
      key: 'team-meeting-he', owner: 'noor', name: 'סדר יום לישיבת צוות רבעונית', start: '2026-09-03T07:50',
      turns: [
        { who: 'h', text: 'אני צריכה סדר יום לישיבת צוות רבעונית של שעתיים. אנחנו שמונה אנשים, וחלק מהם מצטרפים מרחוק.' },
        { who: 'a', blocks: [T(demoLines(
          'הנה הצעה לסדר יום של שעתיים:',
          '',
          '1. **פתיחה וסבב הצלחות (15 דקות)** – כל אחד משתף הצלחה אחת מהרבעון.',
          '2. **סקירת יעדים (30 דקות)** – מה השגנו, מה נדחה ולמה.',
          '3. **הפסקה (10 דקות)**',
          '4. **סדנת תכנון (45 דקות)** – עבודה בזוגות על היעדים לרבעון הבא.',
          '5. **סיכום ומשימות (20 דקות)** – מי עושה מה ועד מתי.',
          '',
          'טיפ למשתתפים מרחוק: תנו להם לדבר ראשונים בכל סבב, והשתמשו בלוח משותף אחד לכולם.',
        ))] },
        { who: 'h', text: 'מעולה, תודה! אפשר גם הודעה קצרה להזמנה?' },
        { who: 'a', blocks: [T(demoLines(
          'בטח:',
          '',
          '> היי צוות,',
          '> ביום חמישי הקרוב נקיים את ישיבת הצוות הרבעונית, בין 10:00 ל-12:00.',
          '> נעבור על הרבעון, נתכנן את הבא ונסיים עם משימות ברורות.',
          '> מי שמצטרף מרחוק – הקישור נמצא בהזמנה ביומן.',
          '> נתראה!',
        ))] },
      ],
    },
    {
      key: 'interviews', owner: 'noor', name: 'Interview themes, week 36', start: '2026-09-11T12:25',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Noor shared notes and quotes from five customer interviews. Claude grouped them into four themes. The strongest one: new teams struggle to find how to invite teammates.',
      ),
      turns: [
        {
          who: 'h', text: 'Here are my notes from this week\'s five customer interviews, plus a few quotes I pasted from the recordings and a photo of our whiteboard. What are the main themes?',
          attachments: [
            demoAttachment('interview-notes-week-36.md', 'text/markdown', interviewNotes),
            demoAttachment('', 'txt', demoLines('"I looked for the invite button under Settings and gave up."', '"If we had SSO, we would roll it out to the whole company."', '"Nobody told us who should be the admin."', '"The weekly summary email is the first thing I read on Monday."')),
          ],
          files: ['whiteboard-photo.png'],
        },
        { who: 'a', blocks: [T(demoLines(
          'Across the five interviews, four themes stand out:',
          '',
          '| Theme | Interviews | What we heard |',
          '|---|---|---|',
          '| **Inviting teammates is hard to find** | 1, 3 | People look for invites under Settings |',
          '| **Unclear ownership** | 3, 5 | Teams do not know who should be the admin |',
          '| **Needs of bigger companies** | 2 | SSO blocks a wider rollout |',
          '| **Reporting** | 4 | CSV export for monthly reports |',
          '',
          'The strongest signal is the first one. The team that invited people early (interview 2) is also the most active, and the biggest cluster on your whiteboard is about invites too.',
          '',
          'Want me to turn this into a one-page summary for the product team?',
        ))] },
      ],
    },

    // ---- Lucía Fernández: marketing ----
    {
      key: 'spring-campaigns', owner: 'lucia', name: 'Spring campaign ideas from other tools', start: '2026-05-19T10:00',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Lucía asked what other productivity tools do in their spring campaigns. Claude searched the web and found three common ideas: a fresh start for team habits, free seats for small teams, and customer stories. It suggested the fresh-start idea for Northwind.',
      ),
      turns: [
        { who: 'h', text: 'What are other productivity tools doing in their spring campaigns this year? A short overview with sources, please.' },
        {
          who: 'a', blocks: [
            demoThinking('', ['Searched for this year\'s spring campaigns from productivity tools.', 'Grouped what I found into three common ideas.'], true),
            demoTool('web_search', { query: 'productivity software spring campaign 2026' }, {
              content: [
                demoWebPage('Why “fresh start” campaigns work every spring', springUrls[0], 'Marketing Weekly', 'Spring is the season of resets. This year many software brands frame their spring campaigns as a fresh start for team habits, with checklists, templates and short guides that help teams tidy up their projects.', { age: '3 weeks ago' }),
                demoWebPage('Free seats for small teams: a trend to watch', springUrls[1], 'SaaS Notes', 'Several tools now give small teams extra seats for two or three months. The offers aim to grow usage inside a company before the first renewal.', { age: '1 month ago' }),
                demoWebPage('Customer-led campaigns beat product tours', springUrls[2], 'Brand Stories', 'Short videos where customers explain how they work are replacing classic product tours in ads. They feel more honest and are cheaper to make.', { age: '2 weeks ago' }),
              ],
            }, { message: 'Searching the web', icon_name: 'globe' }),
            T(spring, [
              demoCite(spring, 'Many brands frame spring as a reset and offer checklists and templates to tidy up projects.', springUrls[0]),
              demoCite(spring, 'Several tools give small teams extra seats for a few months to grow usage.', springUrls[1]),
              demoCite(spring, 'Short customer videos replace product tours in ads.', springUrls[2]),
            ]),
          ],
        },
      ],
    },
    {
      key: 'linkedin-post', owner: 'lucia', name: 'Post for the checklist launch', start: '2026-09-24T09:15',
      turns: [
        { who: 'h', text: 'Write a LinkedIn post about our new onboarding checklist. Friendly, not salesy, at most 80 words.' },
        {
          who: 'a', blocks: [
            T('Here\'s a draft:'),
            // The model sometimes sends `variants` as a broken string; the real text is in `body`.
            demoTool('message_compose_v1', {
              kind: 'other', summary_title: 'Checklist launch post', variants: 'label',
              body: demoLines('New at Northwind: an onboarding checklist that walks your team through the first week. ✅', '', 'Invite your teammates, start your first project and set up your weekly summary, one step at a time.', '', 'We built it after talking to dozens of new customers. Their most common question was “what should we do first?” Now the answer is right there.', '', 'Try it in your team space today.'),
            }, { content: demoOut('The draft was shown to the user.') }, widget),
          ],
        },
      ],
    },
    {
      key: 'brand-voice', owner: 'lucia', name: 'Brand voice guide', start: '2026-06-30T11:45',
      turns: [
        { who: 'h', text: 'Can you write a short brand voice guide for Northwind? We want to sound helpful, clear and a little warm. Include do\'s and don\'ts.' },
        {
          who: 'a', blocks: [
            T('Here\'s a first version of the guide.'),
            demoTool('artifacts', { version_uuid: demoUuid('artifact-version:brand-voice'), command: 'create', id: 'brand-voice-guide', type: 'text/markdown', title: 'Northwind brand voice guide', content: brandGuide, language: null, source: 'c' },
              { content: demoOut('OK') }),
            T('It\'s short on purpose, so people actually read it. I can add examples for support replies next.'),
          ],
        },
      ],
    },

    // ---- Priya Raman: data analyst ----
    {
      key: 'weekly-churn', owner: 'priya', name: 'Weekly churn numbers', start: '2026-09-14T08:40',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Priya asked for weekly churn over the last eight weeks. The first query used a table that does not exist; Claude rebuilt the numbers from the daily events table and drew a bar chart.',
        '',
        '**Finding:** weekly churn fell from about 2% in July to 1.2% in early September, starting the week the new welcome email went out.',
      ),
      turns: [
        { who: 'h', text: 'Can you pull weekly churn for the last eight weeks from the warehouse and chart it?' },
        {
          who: 'a', blocks: [
            T('Let me query the warehouse.'),
            demoTool('Warehouse:run_query', { query: 'SELECT week, churned_teams, churn_pct FROM analytics.weekly_churn WHERE week >= \'2026-07-20\' ORDER BY week', limit: 20 },
              { content: demoOut('ERROR: relation "analytics.weekly_churn" does not exist'), is_error: true, meta: { error_type: 'tool_error' } }, warehouse),
            T('That table does not exist. I\'ll compute churn from the daily events table instead.'),
            demoTool('Warehouse:run_query', {
              query: demoLines(
                'WITH last_seen AS (',
                '  SELECT team_id, MAX(day) AS last_day FROM events_daily GROUP BY team_id',
                ')',
                'SELECT date_trunc(\'week\', last_day + 30) AS week, COUNT(*) AS churned_teams',
                'FROM last_seen',
                'WHERE last_day + 30 BETWEEN \'2026-07-20\' AND \'2026-09-13\'',
                'GROUP BY 1 ORDER BY 1'),
              limit: 20,
            }, { content: demoOut(JSON.stringify(churnData)), structured_content: { rows: churnData, row_count: churnData.length }, meta: { output_format_category: 'other' } }, warehouse),
            demoTool('chart_display_v0', {
              title: 'Weekly churn rate', style: 'bar',
              series: [{ name: 'Churn %', values: churnRows.map(r => r[2]), color: '#2c8c7c' }],
              xAxis: { data: ['Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7'] },
              yAxis: { title: '% of active teams' },
            }, { content: demoOut('The chart was shown to the user.') }, widget),
            T('Churn dropped from about **2%** a week in July to **1.2%** in early September. The drop starts in the week of August 17, when the new welcome email went out.'),
          ],
        },
      ],
    },
    {
      key: 'cohorts', owner: 'priya', name: 'Which cohort method for the churn dashboard?', start: '2026-08-12T13:20',
      turns: [
        { who: 'h', text: 'Can you read these two articles and tell me which cohort method fits our churn dashboard? https://analytics-handbook.example/cohort-analysis and https://data-blog.example/posts/retention-curves' },
        {
          who: 'a', blocks: [
            demoTool('web_fetch', { url: 'https://analytics-handbook.example/cohort-analysis' }, {
              content: [demoWebPage('Cohort analysis, step by step', 'https://analytics-handbook.example/cohort-analysis', 'Analytics Handbook',
                'A cohort is a group of users who started in the same period. The most useful cohorts for retention are signup-month cohorts. For each cohort, plot the share of users who are still active after 1, 2, 4 and 8 weeks. Compare cohorts before and after a product change to see its effect.',
                { content_type: 'html', mime_type: 'text/html' })],
              display_content: { type: 'rich_link', link: { title: 'Cohort analysis, step by step', url: 'https://analytics-handbook.example/cohort-analysis', icon_url: null, source: 'analytics-handbook.example', subtitles: null, resource_type: null }, is_trusted: false },
            }, { message: 'Fetching: https://analytics-handbook.example/cohort-analysis', integration_name: 'Web Fetch', icon_name: 'globe' }),
            demoTool('web_fetch', { url: 'https://data-blog.example/posts/retention-curves' }, {
              content: demoOut(JSON.stringify({ error_type: 'CLIENT_ERROR', error_message: 'The page returned HTTP 404 (not found).' })),
              is_error: true,
              display_content: { type: 'rich_link', link: { title: 'https://data-blog.example/posts/retention-curves', url: 'https://data-blog.example/posts/retention-curves', icon_url: null, source: 'data-blog.example', subtitles: null, resource_type: null }, is_trusted: false },
              message: 'Failed to fetch: https://data-blog.example/posts/retention-curves',
            }, { message: 'Fetching: https://data-blog.example/posts/retention-curves', integration_name: 'Web Fetch', icon_name: 'globe' }),
            T(demoLines(
              'I could read the first article. The second link returned an error (page not found).',
              '',
              'The handbook recommends **signup-month cohorts** with one retention curve per cohort. For your dashboard that means:',
              '',
              '- Group teams by the month they signed up.',
              '- For each cohort, plot the share still active after 1, 2, 4 and 8 weeks.',
              '- Compare cohorts before and after a change, such as the new welcome email.',
              '',
              'This fits well, because your churn rule (30 days without activity) already gives a clear "active" flag for every week.',
            )),
          ],
        },
      ],
    },
    {
      key: 'churn-recap', owner: 'priya', name: 'Churn findings for Friday\'s review', start: '2026-09-29T10:30',
      turns: [
        { who: 'h', text: 'What did we find about churn a couple of weeks ago? I need it for Friday\'s review.' },
        {
          who: 'a', blocks: [
            demoTool('conversation_search', { query: 'weekly churn' }, {
              content: demoOut('<chat url="https://claude.ai/chat/' + demoUuid('chat:weekly-churn') + '" updated_at="2026-09-14T08:52:10Z">\nTitle: Weekly churn numbers\nChurn dropped from about 2% a week in July to 1.2% in early September.\n</chat>'),
              display_content: { type: 'rich_content', content: [{ title: 'Weekly churn numbers', subtitles: ['14 Sep 2026'], url: 'https://claude.ai/chat/' + demoUuid('chat:weekly-churn'), icon_url: null, resource_type: null, source: null }] },
            }, { message: 'Searching past chats', integration_name: 'Search Past Conversations', icon_name: 'search' }),
            T('In **Weekly churn numbers** (14 September) we found that weekly churn fell from about 2% in July to **1.2%** in early September, starting the week the new welcome email went out.\n\nFor Friday, I\'d show the eight-week bar chart and one sentence about the welcome email.'),
          ],
        },
      ],
    },

    // ---- Mateus Costa: designer ----
    {
      key: 'icon-names', owner: 'mateus', name: 'Icon naming conventions', start: '2026-06-09T15:00',
      turns: [
        { who: 'h', text: 'We have 300 icons with messy names like "Icon_final2.svg". Suggest a naming convention.' },
        { who: 'a', blocks: [T(demoLines(
          'Use **`category-name-variant`**, all lower case, with hyphens between words:',
          '',
          '| Today | New name |',
          '|---|---|',
          '| `Icon_final2.svg` | `action-add-filled.svg` |',
          '| `arrowLeft copy.svg` | `nav-arrow-left.svg` |',
          '| `Trash_NEW.svg` | `action-delete-outline.svg` |',
          '',
          'Rules:',
          '- **Category** first (`action`, `nav`, `status`, `file`), so related icons sort together.',
          '- **Variant** last: `outline` or `filled`.',
          '- No version words like *final* or *new*. Version history belongs in git.',
        ))] },
      ],
    },
    {
      key: 'checkout-a11y', owner: 'mateus', name: 'Accessibility review of checkout step 2', start: '2026-08-26T09:35',
      turns: [
        { who: 'h', text: 'Here\'s a screenshot of step 2 of our checkout. Can you check it for accessibility problems?', files: ['checkout-step-2.png'] },
        {
          who: 'a', blocks: [
            demoTool('view', { description: 'Look at the checkout screenshot', path: '/mnt/user-data/uploads/checkout-step-2.png' },
              { content: [{ type: 'image', file_uuid: demoUuid('image:checkout-step-2') }] },
              Object.assign({ message: 'Look at the checkout screenshot', icon_name: 'file', display_content: { type: 'text', text: 'Look at the checkout screenshot' } }, fileTool)),
            demoTool('image_search', { query: 'accessible form error message example', max_results: 2 }, {
              content: [{
                type: 'image_gallery', is_expired: false,
                images: [
                  { id: 'img_1', title: 'Inline error message under a card number field', url: 'https://design-patterns.example/img/inline-error.png', thumbnail_url: 'https://design-patterns.example/img/inline-error-thumb.png', page_url: 'https://design-patterns.example/forms/errors', source: 'design-patterns.example', width: 1200, height: 800, thumbnail_width: 300, thumbnail_height: 200 },
                  { id: 'img_2', title: 'Error summary at the top of a form', url: 'https://a11y-notes.example/img/error-summary.png', thumbnail_url: 'https://a11y-notes.example/img/error-summary-thumb.png', page_url: 'https://a11y-notes.example/error-summaries', source: 'a11y-notes.example', width: 1000, height: 700, thumbnail_width: 300, thumbnail_height: 210 },
                ],
              }],
            }, { message: 'Searching for images', icon_name: 'search' }),
            T(demoLines(
              'I found four problems:',
              '',
              '1. **Low contrast** on the grey hint text (about 2.8:1; it needs 4.5:1).',
              '2. **Placeholder used as a label** in the card number field. The label disappears when people type.',
              '3. **The error is shown only in red.** Add an icon and a short text, like *"Card number is too short"*.',
              '4. **A small tap target** for the *Edit address* link (about 24 px high; aim for 44 px).',
              '',
              'The two images show good examples of error messages next to the field.',
            )),
          ],
        },
      ],
    },

    // ---- The two Sams ----
    {
      key: 'kickoff-deck', owner: 'samn', name: 'Check the sales kickoff deck', start: '2026-09-16T16:05',
      turns: [
        { who: 'h', text: 'I made the kickoff deck yesterday. Can you open it and check that the targets slide matches these numbers: 120 new customers, 92% retention, 3 new regions?' },
        {
          who: 'a', blocks: [
            demoTool('Artifact', { action: 'open', url: 'https://claude.ai/code/artifact/' + slidesId }, {
              content: demoOut('Opened "Sales Kickoff 2026" (5 slides).'),
              display_content: { type: 'file', published_url: 'https://claude.ai/code/artifact/' + slidesId, published_artifact_id: slidesId, published_action: 'opened', title: 'Sales Kickoff 2026', pinned: null, owned_by_account: true },
              structured_content: { url: 'https://claude.ai/code/artifact/' + slidesId, owned: true, title: 'Sales Kickoff 2026', opened: true, artifact_id: slidesId },
            }, { message: 'Opening the deck' }),
            T('I checked the **Targets for 2027** slide. All three numbers match: 120 new customers, 92% retention and 3 new regions. The speaker notes also mention this year\'s results (104 customers), which is fine as context.'),
          ],
        },
      ],
    },
    {
      // The export sometimes keeps a chat but none of its text.
      key: 'empty', owner: 'samn', name: '', start: '2026-09-18T08:00',
      turns: [{ who: 'h', empty: true }, { who: 'a', empty: true }],
    },
    {
      key: 'k8s-upgrade', owner: 'saml', name: 'Kubernetes upgrade checklist', start: '2026-07-14T10:10',
      turns: [
        { who: 'h', text: 'We\'re upgrading our clusters by one Kubernetes minor version next week. Give me a short checklist.' },
        { who: 'a', blocks: [T(demoLines(
          'Here is a checklist for a minor-version upgrade:',
          '',
          '**Before**',
          '- [ ] Read the release notes for removed APIs.',
          '- [ ] Check if anything still calls deprecated APIs:',
          '  ' + F + 'bash',
          '  kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis',
          '  ' + F,
          '- [ ] Back up etcd, or check your provider\'s backups.',
          '- [ ] Upgrade a staging cluster first.',
          '',
          '**During**',
          '- [ ] Upgrade the control plane, then the node pools one by one.',
          '- [ ] Drain each node before it is replaced: `kubectl drain <node> --ignore-daemonsets`.',
          '',
          '**After**',
          '- [ ] Check that all pods are `Running` and that no `PodDisruptionBudget` blocked a drain.',
          '- [ ] Watch error rates and latency for a day.',
        ))] },
      ],
    },
    { key: 'no-messages', owner: 'saml', name: 'Quick question', start: '2026-09-25T17:30', turns: [] },

    // ---- Jonas Berg: no name in users.json ----
    {
      key: 'travel-policy', owner: 'jonas', name: 'First class train tickets', start: '2026-08-31T09:00',
      turns: [
        { who: 'h', text: 'Can I expense a first class train ticket if the trip is longer than four hours?', inject: { source: 'date_note', prompt: '\n\nThe current date is ' + demoLongDate('2026-08-31T09:00') + '.' } },
        { who: 'a', blocks: [T('I don\'t have Northwind\'s travel policy, so I can\'t say for sure. Many policies allow first class only for long trips, often over four hours, or when it costs the same as second class.\n\nIf you paste the travel part of the policy here, I can find the exact rule for you.')] },
        { who: 'h', text: 'Here\'s the travel part of the policy.', attachments: [demoAttachment('', '', travelPolicy)] },
        { who: 'a', blocks: [T('Yes. Rule **3.2** says first class is allowed for trips **longer than 4 hours**. Keep the ticket, and write the trip time in your expense note so finance can see why.')] },
      ],
    },

    // ---- A former member: owns chats, but is no longer in users.json ----
    {
      key: 'billing-migration', owner: 'former', name: 'Legacy billing migration plan', start: '2026-05-06T10:30',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Planning how to move 2,400 customers from the old billing system to the new one without charging anyone twice. Claude suggested four phases and one rule: a customer is billed by exactly one system at any time.',
      ),
      turns: [
        { who: 'h', text: 'We need to move 2,400 customers from the old billing system to the new one without charging anyone twice. How would you plan it?' },
        { who: 'a', blocks: [T(demoLines(
          'I\'d do it in four phases:',
          '',
          '1. **Freeze changes.** No new plans or prices in the old system during the move.',
          '2. **Dry run.** Copy all customers to the new system in test mode and compare the next invoice for each one. Fix every difference.',
          '3. **Move in batches.** 10% of customers per day, simplest plans first. Turn off billing in the old system for a customer *before* you turn it on in the new one.',
          '4. **Watch, then close.** Compare payments for one full billing cycle, then switch off the old system.',
          '',
          'The key rule: a customer is billed by exactly one system at any time. Keep a table that says which one.',
        ))] },
        { who: 'h', text: 'How do we handle customers whose renewal falls in the middle of the move?' },
        { who: 'a', blocks: [T('Move them right **after** their renewal, not before. Then their first invoice from the new system is a normal one a month later, and nobody gets two invoices for the same period.')] },
      ],
    },
    {
      key: 'vendor-renewal', owner: 'former', name: 'Monitoring vendor renewal', start: '2026-05-27T14:15',
      turns: [
        { who: 'h', text: 'Our contract with a monitoring vendor renews in July. What should I ask for before I sign?' },
        { who: 'a', blocks: [T(demoLines(
          'Five things worth asking for:',
          '',
          '1. **A price lock** for two years, or a cap on yearly increases (for example 5%).',
          '2. **A usage review:** pay for what you used last year, not for an estimate.',
          '3. **Exit terms:** an export of your data in a standard format, and 60 days to move.',
          '4. **Support times** in writing.',
          '5. **Their latest security audit report.**',
          '',
          'Ask early: vendors are more flexible a few weeks before the renewal date than on the last day.',
        ))] },
      ],
    },
  ];

  return specs.map(demoChat).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// "Monday, August 31, 2026", as in the platform's date notes.
function demoLongDate(s) {
  const d = new Date(demoMs(s));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

/* ---------- Projects ---------- */

function demoProjects() {
  const project = (key, owner, ownerName, name, description, created, updated, docs, flags) => Object.assign({
    uuid: demoUuid('project:' + key), name, description, is_private: true, is_starter_project: false, prompt_template: '',
    created_at: demoIso(demoMs(created), 'p6'), updated_at: demoIso(demoMs(updated), 'p6'),
    creator: { uuid: demoUser(owner), full_name: ownerName },
    docs: docs.map(([filename, content, at], i) => ({ uuid: demoUuid('doc:' + key + ':' + i), filename, content, created_at: demoIso(demoMs(at), 'p6') })),
  }, flags || {});

  const welcomeEmail = demoLines(
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><title>Welcome to Northwind</title>',
    '<style>',
    'body{margin:0;background:#f3f1ec;font:16px/1.6 system-ui,sans-serif;color:#1f1e1c}',
    '.mail{max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}',
    '.top{background:#1f9d6b;color:#fff;padding:28px 32px}.top h1{margin:0;font-size:24px}',
    '.body{padding:24px 32px}.btn{display:inline-block;background:#1f9d6b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px}',
    '.note{color:#6b665d;font-size:14px}',
    '</style></head>',
    '<body><div class="mail">',
    '<div class="top"><h1>Welcome to Northwind, {{first_name}}!</h1></div>',
    '<div class="body">',
    '<p>Your team space is ready. Three steps get most teams going in their first week:</p>',
    '<ol><li>Invite two teammates</li><li>Create your first project</li><li>Book a 20-minute kickoff call with us</li></ol>',
    '<p><a class="btn" href="#">Open my team space</a></p>',
    '<p class="note">Questions? Just reply to this email.</p>',
    '</div></div></body></html>',
  );

  return [
    project('onboarding', 'amara', 'Amara Okafor', 'Customer Onboarding', 'Everything we know about getting new customer teams up and running.', '2026-05-12T08:30', '2026-09-10T14:05', [
      ['claude/README.md', demoLines(
        '# Customer Onboarding',
        '',
        'This project holds what Claude needs to help with customer onboarding at Northwind Labs.',
        '',
        '## What is in here',
        '- `source/welcome-email.html`: the email new customers get on day one',
        '- `reference/kickoff-deck.pptx`: text from the deck we use in the first call',
        '',
        '## How to help',
        '- Keep answers short and practical.',
        '- Use our funnel names: signed up, invited teammates, first project, active in week 4.',
      ), '2026-05-12T08:31'],
      ['source/welcome-email.html', welcomeEmail, '2026-05-12T08:33'],
      ['reference/kickoff-deck.pptx', demoLines(
        '## Slide 1', '', 'Customer kickoff', '', 'Northwind Labs', '',
        '## Slide 2', '', 'Your first 30 days', '', '- Week 1: invite your team', '- Week 2: start your first project', '- Week 4: review together', '',
        '## Slide 3', '', 'Who to contact', '', 'Your onboarding manager replies within one working day.',
      ), '2026-06-02T10:12'],
    ]),
    project('getting-started', 'kenji', 'Kenji Watanabe', 'Getting started with Claude', 'An example project that shows how projects work.', '2026-05-04T09:00', '2026-05-04T09:00', [
      ['Prompting tips.md', demoLines(
        '# Prompting tips',
        '',
        '1. Say who the answer is for.',
        '2. Paste the material you want Claude to use.',
        '3. Ask for a format: a table, a list, a short email.',
        '4. Ask again for a shorter or simpler version when you need one.',
      ), '2026-05-04T09:00'],
    ], { is_starter_project: true }),
    project('analytics', 'priya', 'Priya Raman', 'Analytics playbook', 'Shared definitions and helpers for product analytics.', '2026-06-20T11:00', '2026-09-15T09:20', [
      ['claude/metrics-glossary.md', demoLines(
        '# Metrics glossary',
        '',
        '| Metric | Definition |',
        '|---|---|',
        '| Active team | At least one action in the last 7 days |',
        '| Churned team | No activity for 30 days |',
        '| Weekly churn | Teams that churned this week ÷ active teams at the start of the week |',
        '| Activation | Invited a teammate **and** created a first project |',
        '',
        'All numbers come from the `events_daily` table in the warehouse.',
      ), '2026-06-20T11:02'],
      ['source/kpi-helpers.js', demoLines(
        '// Small helpers used in our notebook charts.',
        'export function churnRate(churned, activeAtStart) {',
        '  return activeAtStart ? churned / activeAtStart : 0;',
        '}',
        '',
        'export function weekLabel(isoDate) {',
        '  return new Date(isoDate).toLocaleDateString(\'en-GB\', { day: \'numeric\', month: \'short\' });',
        '}',
        '',
      ), '2026-07-03T15:40'],
    ], { is_private: false }),
    project('untitled', 'jonas', null, '', '', '2026-08-31T09:30', '2026-08-31T09:30', []),
  ];
}

/* ---------- Memory ---------- */

function demoMemories() {
  const onboarding = demoUuid('project:onboarding');
  const file = (path, at, content) => ({ path, content, updated_at: demoIso(demoMs(at), 'p6') });
  const memory = (owner, files, chatMemory, projectMemories) => {
    const m = {};
    if (chatMemory) m.conversations_memory = chatMemory;
    if (projectMemories) m.project_memories = projectMemories;
    m.memory_files = files.sort((a, b) => a.path.localeCompare(b.path));
    m.account_uuid = demoUser(owner);
    return m;
  };

  return [
    memory('amara', [
      file('/profile.md', '2026-09-09T15:20', demoLines(
        '---', 'name: profile', 'description: Who Amara is and how she likes to work', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Product lead at Northwind Labs, based in Lisbon',
        '- [stated] Leads [[customer-onboarding]] this year',
        '- [stated] Likes a short summary with a table first, details after (see [[report-style]])',
        '- [stated] Writes in British English')),
      file('/areas/customer-onboarding.md', '2026-09-09T15:21', demoLines(
        '---', 'name: customer-onboarding', 'description: Onboarding for new customer teams: goals, numbers and owners', 'sources: [backfill, chat]', 'aliases: [onboarding, "first 30 days"]', '---',
        '- [stated] Owns the Q4 rollout of the onboarding checklist to every customer team',
        '- [stated] Main number is "active in week 4"; it was 49% in Q3',
        '- [stated] Works with [[kenji-watanabe]] on the activation dashboard')),
      file('/people/kenji-watanabe.md', '2026-08-27T10:02', demoLines(
        '---', 'name: kenji-watanabe', 'description: Platform engineer who builds the activation dashboard with Amara', 'sources: [chat]', 'aliases: [Kenji]', '---',
        '- [stated] Owns the data pipeline behind the onboarding dashboard',
        '- [stated] Prefers written specs over meetings')),
      file('/topics/report-style.md', '2026-09-02T12:44', demoLines(
        '---', 'name: report-style', 'description: How Amara wants reports and summaries to look', 'sources: [cowork]', 'aliases: [reports]', '---',
        '- [stated] One page, a table of contents, numbers in a table',
        '- [stated] Publishes finished reports as artifacts for the whole team')),
      file('/projects/' + onboarding + '/index.md', '2026-08-27T10:00', '---\nname: "Customer Onboarding"\ndescription: Customer Onboarding\n---\n'),
      file('/projects/' + onboarding + '/overview.md', '2026-09-10T14:06', demoLines(
        '---', 'name: overview', 'description: What the Customer Onboarding project is for and where it stands', 'sources: [chat]', 'aliases: []', '---',
        '- [stated] Holds the onboarding checklist, the welcome email and the kickoff deck',
        '- [stated] Q4 goal: raise "active in week 4" from 49% to 55%')),
    ], demoLines(
      '**Work context**', '',
      'Amara is the product lead for customer onboarding at Northwind Labs. She plans the onboarding programme, tracks activation numbers and writes the quarterly onboarding report.', '',
      '**Top of mind**', '',
      'Rolling out the new onboarding checklist in Q4, and raising the share of teams that are still active in their fourth week.', '',
      '**Brief history**', '',
      'Over the summer Amara worked on the Q3 onboarding report, a launch email for the activation dashboard and the Q4 roadmap.',
    ), {
      [onboarding]: demoLines(
        '**Purpose & context**', '',
        'This project collects the material for customer onboarding: the checklist, the welcome email and the kickoff deck.', '',
        '**Current state**', '',
        'The Q3 report is published. The checklist rollout starts in October.', '',
        '**Key learnings & principles**', '',
        '- Teams that invite a teammate in week one are twice as likely to stay active.',
        '- Short emails get more replies than long ones.',
      ),
    }),
    // No chat memory summary: the key is simply missing, as in real exports.
    memory('kenji', [
      file('/preferences.md', '2026-08-28T09:12', demoLines(
        '---', 'name: preferences', 'description: How Kenji wants answers', '---',
        '- [stated] Code first, explanation after',
        '- [stated] Python examples unless he asks for another language')),
      file('/profile.md', '2026-08-28T09:13', demoLines(
        '---', 'name: profile', 'description: Who Kenji is', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Backend engineer on the platform team',
        '- [stated] Working on [[rate-limiting]] for the public API')),
      file('/topics/rate-limiting.md', '2026-09-22T15:30', demoLines(
        '---', 'name: rate-limiting', 'description: Rate limits for the public API: the chosen design and open questions', 'sources: [chat]', 'aliases: [throttling, "token bucket, per customer"]', '---',
        '- [stated] Chose a token bucket per customer: 100 requests per minute, bursts of 20',
        '- [stated] Open question: share the buckets across the three app servers with Redis')),
    ]),
    memory('noor', [
      file('/profile.md', '2026-09-11T12:40', demoLines(
        '---', 'name: profile', 'description: Who Noor is and how she likes to work', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] User researcher at Northwind Labs',
        '- [stated] מעדיפה סיכומים קצרים עם נקודות',
        '- [stated] Runs a weekly round of [[customer-interviews]]')),
      file('/topics/customer-interviews.md', '2026-09-11T12:41', demoLines(
        '---', 'name: customer-interviews', 'description: The weekly customer interview programme', 'sources: [chat]', 'aliases: [interviews]', '---',
        '- [stated] Five interviews a week, notes in Markdown',
        '- [stated] Shares the themes with the [[product-team]] every Friday')),
    ], demoLines(
      '**Work context**', '',
      'Noor is a user researcher at Northwind Labs. She runs customer interviews and turns them into themes for the product team.', '',
      '**Personal context**', '',
      'Noor often writes in Hebrew. היא מעדיפה לקבל סיכומים לצוות בעברית.', '',
      '**Top of mind**', '',
      'The quarterly team meeting and the week 36 interview round.',
    )),
    memory('priya', [
      file('/profile.md', '2026-09-14T09:00', demoLines(
        '---', 'name: profile', 'description: Who Priya is', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Data analyst at Northwind Labs',
        '- [stated] Prefers SQL answers that use CTEs',
        '- [stated] Works on [[churn-analytics]]')),
      file('/areas/churn-analytics.md', '2026-09-29T10:45', demoLines(
        '---', 'name: churn-analytics', 'description: Churn reporting: weekly numbers, definitions and the dashboard', 'sources: [cowork]', 'aliases: ["churn dashboard", retention]', '---',
        '- [stated] A team counts as churned after 30 days without activity',
        '- [stated] Weekly numbers come from the events_daily table',
        '- [stated] Definitions live in the [[analytics-playbook]] project')),
    ], demoLines(
      '**Work context**', '',
      'Priya is a data analyst at Northwind Labs. She owns the churn dashboard and the shared analytics playbook.', '',
      '**Top of mind**', '',
      'Weekly churn numbers and a cohort view for the October review.',
    )),
  ];
}

/* ---------- Design chats ---------- */

const DEMO_TOKENS_CSS = ':root{--accent:#1f9d6b;--ink:#1f1e1c;--paper:#fbfaf7;--muted:#6b665d;--radius:14px;--font:system-ui,-apple-system,"Segoe UI",sans-serif}\n';

// A design board as Claude Design stores it: a full page that loads ./support.js.
function demoBoard(title, css, body) {
  return demoLines(
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>' + title + '</title>',
    '<link rel="stylesheet" href="tokens.css">',
    '<style>',
    'body{margin:0;background:var(--paper);font-family:var(--font);color:var(--ink)}',
    '.phone{width:390px;height:844px;margin:0 auto;display:flex;flex-direction:column;justify-content:space-between;padding:72px 28px 40px;box-sizing:border-box}',
    '.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;padding:16px;border-radius:var(--radius);font-weight:600;font-size:17px}',
    css,
    '</style>',
    '<script src="./support.js"><\/script>',
    '</head><body>',
    body,
    '</body></html>',
    '',
  );
}

const DEMO_WELCOME = demoBoard('Welcome',
  '.logo{width:56px;height:56px;border-radius:16px;background:var(--accent)}\nh1{font-size:28px;margin:28px 0 10px;white-space:nowrap}\np{color:var(--muted);font-size:17px;line-height:1.5}\n.dots{display:flex;gap:8px;justify-content:center;margin-bottom:20px}.dots i{width:8px;height:8px;border-radius:50%;background:#d6d2c8}.dots i.on{background:var(--accent)}',
  demoLines(
    '<div class="phone">',
    '  <div><div class="logo"></div><h1>Welcome to Northwind</h1>',
    '  <p>Plan projects with your team, see what everyone is working on, and get a calm summary every Monday.</p></div>',
    '  <div><div class="dots"><i class="on"></i><i></i><i></i></div><a class="btn" href="Team.dc.html">Set up my team</a></div>',
    '</div>',
  ));

const DEMO_TEAM = demoBoard('Pick your team',
  'h1{font-size:26px;margin:0 0 18px}\n.opt{display:flex;align-items:center;gap:14px;padding:16px;border:1.5px solid #e4e0d6;border-radius:var(--radius);margin-bottom:12px;background:#fff}\n.opt.on{border-color:var(--accent);background:#e2f4f1}\n.opt b{display:block}.opt span{color:var(--muted);font-size:14px}\n.back{display:block;text-align:center;margin-top:14px;color:var(--muted)}',
  demoLines(
    '<div class="phone">',
    '  <div><h1>Pick your team</h1>',
    '  <div class="opt on"><div><b>Product</b><span>Roadmaps, specs, launches</span></div></div>',
    '  <div class="opt"><div><b>Marketing</b><span>Campaigns and content</span></div></div>',
    '  <div class="opt"><div><b>Engineering</b><span>Sprints, bugs, releases</span></div></div>',
    '  <div class="opt"><div><b>Something else</b><span>Start from a blank space</span></div></div></div>',
    '  <div><a class="btn" href="#">Continue</a><a class="back" href="Welcome.dc.html">Back</a></div>',
    '</div>',
  ));

/* One design chat. Rows are messages in order. `dupOf` makes a second copy of an earlier
 * user row (same content.id), as the export stores some messages twice. */
function demoDesignChat(spec) {
  const rnd = demoRng(demoHash('design:' + spec.key));
  let clock = demoMs(spec.start) + Math.floor(rnd() * 40000);
  let toolNo = 0;
  const messages = [];
  (spec.rows || []).forEach((r, i) => {
    if (i) clock += (r.wait != null ? r.wait : 45) * 1000 + Math.floor(rnd() * 6000);
    const user = r.role === 'user';
    const uuid = demoUuid('design-row:' + spec.key + ':' + i, user && r.dupOf == null ? 4 : 5);
    const id = r.dupOf != null ? messages[r.dupOf].content.id : user ? uuid : demoChars('design-id:' + spec.key + ':' + i, 10, DEMO_B36);
    const c = Object.assign({ role: r.role, id }, r.c || {});
    if (Array.isArray(c.contentBlocks)) {
      c.contentBlocks = c.contentBlocks.map(b => {
        if (b.type !== 'tool_call' || b.toolCall.id) return b;
        return { type: 'tool_call', toolCall: Object.assign({ id: 'toolu_01' + demoChars(spec.key + ':tool:' + toolNo++, 22, DEMO_B62) }, b.toolCall) };
      });
    }
    // The flat `content` string is the text blocks glued together, as in the export.
    c.content = r.text != null ? r.text : (c.contentBlocks || []).filter(b => b.type === 'text').map(b => b.text).join('');
    c.timestamp = demoIso(clock - (user ? 0 : 5000), 'z3');
    messages.push({ uuid, role: r.role, content: c, created_at: demoIso(clock, 'p6') });
  });
  const start = demoMs(spec.start);
  return {
    uuid: demoUuid('design:' + spec.key), title: 'Chat', project: { uuid: demoUuid('design-project:' + spec.project), name: spec.projectName },
    created_at: demoIso(start, 'p6'), updated_at: demoIso(Math.max(clock, start) + 95000, 'p6'), messages,
  };
}

function demoDesignChats() {
  const mateus = { authorAccountUuid: demoUser('mateus'), authorName: 'Mateus' };
  const lucia = { authorAccountUuid: demoUser('lucia'), authorName: 'Lucía' };
  const amara = { authorAccountUuid: demoUser('amara'), authorName: 'Amara' };
  const text = t => ({ type: 'text', text: t });
  const tool = (name, input, output) => ({ type: 'tool_call', toolCall: output === undefined ? { type: 'edit', name, input } : { type: 'edit', name, input, output } });
  const changes = (created, edited) => ({ created: created || [], edited: edited || [], deleted: [], moved: [], copied: [] });
  const wrote = (path, content) => 'Wrote ' + content.length.toLocaleString('en-US') + ' characters to ' + path;

  // The first Welcome board, before the comment asked for a smaller heading and a clearer button.
  const welcomeFirst = DEMO_WELCOME
    .replace('h1{font-size:28px;margin:28px 0 10px;white-space:nowrap}', 'h1{font-size:34px;margin:28px 0 10px}')
    .replace('>Set up my team<', '>Get started<');
  const questionId = 'q_' + demoChars('design-question', 11, DEMO_B36);
  const questions = {
    title: 'A few questions before I start',
    prompt: 'Answer what you like; I will choose the rest.',
    questions: [
      { id: 'tone', kind: 'text-options', title: 'What tone should the copy have?', options: ['Playful', 'Calm and clear', 'Bold'] },
      { id: 'extras', kind: 'chips', title: 'Any extra screens?', options: ['Notifications', 'Profile photo', 'Dark mode'], multi: true },
      { id: 'notes', kind: 'freeform', title: 'Anything else I should know?', placeholder: 'Optional' },
    ],
  };
  const landing = demoLines(
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Autumn campaign</title>',
    '<link rel="stylesheet" href="tokens.css">',
    '<style>body{margin:0;font-family:var(--font);color:var(--ink);background:var(--paper)}.hero{padding:80px 24px;text-align:center;background:#e2f4f1}.hero h1{font-size:44px;margin:0 0 12px}.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:960px;margin:40px auto;padding:0 24px}.benefits div{background:#fff;border-radius:var(--radius);padding:20px}form{text-align:center;margin:40px 0 80px}input{padding:12px;border:1px solid #d6d2c8;border-radius:10px;width:260px}button{padding:12px 20px;border:0;border-radius:10px;background:var(--accent);color:#fff}</style>',
    '<script src="./support.js"><\/script>',
    '</head><body>',
    '<section class="hero"><h1>A calm start to the season</h1><p>Plan the next quarter with your whole team in one place.</p></section>',
    '<section class="benefits"><div><b>One plan</b><p>Every project and owner on one page.</p></div><div><b>Weekly summary</b><p>A short email every Monday.</p></div><div><b>Easy start</b><p>A checklist for your first week.</p></div></section>',
    '<form><input type="email" placeholder="Work email"> <button>Get the guide</button></form>',
    '</body></html>',
    '',
  );
  const quote = '<blockquote>“We stopped losing tasks between meetings.” — Operations lead, logistics start-up</blockquote>';
  const welcomeDark = DEMO_WELCOME
    .replace('<link rel="stylesheet" href="tokens.css">', '<link rel="stylesheet" href="tokens.css">\n<style>:root{--paper:#161a18;--ink:#eef3f0;--muted:#9fb0a8;--accent:#4cc794}</style>')
    .replace('<title>Welcome</title>', '<title>Welcome (dark)</title>');

  return [
    demoDesignChat({
      key: 'onboarding-screens', project: 'mobile-app', projectName: 'Northwind Mobile App', start: '2026-08-18T10:02',
      rows: [
        {
          role: 'user', text: 'Design the onboarding screens for our mobile app: a welcome screen, "pick your team" and "invite teammates". Keep it friendly and use our green accent.',
          c: Object.assign({}, mateus, {
            kind: 'chat',
            attachments: [
              { id: demoUuid('att:skill-screens'), name: 'Polished app screens', type: 'skill', content: 'Use this skill to make polished, high-fidelity screens. Work in boards of the real device size, use the project tokens for colour and type, and check contrast before you hand over.' },
              { id: demoUuid('att:moodboard'), name: 'brand-moodboard.png', path: 'uploads/brand-moodboard.png', type: 'image', aspectRatio: 1.5 },
              { id: demoUuid('att:fig'), name: 'Onboarding.fig', type: 'fig-file', selectedFrames: ['/Onboarding/Welcome', '/Onboarding/Team picker'], figOutline: 'Page: Onboarding\n  Frame: Welcome (390×844)\n  Frame: Team picker (390×844)\n  Frame: Invite (390×844)\nPage: Components\n  Button / primary\n  Option card' },
            ],
          }),
        },
        // The same message saved a second time by the app, without the author's account id.
        { role: 'user', dupOf: 0, wait: 0.4, text: 'Design the onboarding screens for our mobile app: a welcome screen, "pick your team" and "invite teammates". Keep it friendly and use our green accent.', c: { authorName: 'Mateus', kind: 'chat', attachments: [{ id: demoUuid('att:moodboard'), name: 'brand-moodboard.png', path: 'uploads/brand-moodboard.png', type: 'image', aspectRatio: 1.5 }] } },
        {
          role: 'assistant', wait: 6, text: '',
          c: { kind: 'question-record', questionRecord: { v: 1, event: 'asked', questionId, round: 1, askedAt: demoIso(demoMs('2026-08-18T10:03:40'), 'z3'), askTurnId: demoUuid('design-ask-turn'), spec: questions } },
        },
        {
          role: 'assistant', wait: 2,
          c: {
            contentBlocks: [
              { type: 'thinking', text: '' },
              text('Before I start, a few quick questions so the screens fit what you have in mind.'),
              tool('ask_user', questions, 'The question form is now up. Waiting for the answers.'),
            ],
            turnInputTokens: 41250,
          },
        },
        {
          role: 'user', wait: 70, text: 'Answered — tone: Calm and clear; extra screens: Notifications; notes: skipped',
          c: { kind: 'question-receipt', questionReceipt: { path: '', questionId, payload: { tone: { choice: 'Calm and clear' }, extras: { selected: ['Notifications'] }, notes: { text: '' } } } },
        },
        {
          role: 'assistant', wait: 240,
          c: {
            contentBlocks: [
              text('Calm and clear it is. I\'ll set up the design tokens first, then the screens.'),
              tool('list_files', { path: '' }, '📁 uploads\n📄 uploads/brand-moodboard.png'),
              tool('write_file', { path: 'tokens.css', content: DEMO_TOKENS_CSS }, wrote('tokens.css', DEMO_TOKENS_CSS)),
              tool('write_file', { path: 'Welcome.dc.html', content: welcomeFirst }, wrote('Welcome.dc.html', welcomeFirst)),
              tool('write_file', { path: 'Team.dc.html', content: DEMO_TEAM }, wrote('Team.dc.html', DEMO_TEAM)),
              { type: 'user_interjection', message: { id: demoUuid('design-interjection'), role: 'user', content: 'Can the invite screen also offer a link instead of email?', attachments: [], timestamp: demoIso(demoMs('2026-08-18T10:07:12'), 'z3'), kind: 'chat' } },
              tool('read_file', { path: 'Welcome.dc.html' }, welcomeFirst.slice(0, 200)),
              tool('show_html', { path: 'Welcome.dc.html' }, '[elided]'),
              text('Here are the first two screens: **Welcome** and **Pick your team**. And yes: the invite screen will have a *Copy invite link* button next to the email field.'),
            ],
            turnChanges: changes(['tokens.css', 'Welcome.dc.html', 'Team.dc.html']),
            turnInputTokens: 86320,
          },
        },
        {
          role: 'user', wait: 20, text: 'Verifier agent check completed',
          c: Object.assign({}, mateus, {
            pill: true, kind: 'chat',
            attachments: [{ id: demoUuid('att:verifier'), name: 'fork_verifier_agent result', type: 'text', hidden: true, content: '<verifier-result verdict="done">\nBoth screens render without console errors.\nText contrast passes WCAG AA.\nThe "Get started" button links to Team.dc.html.\n</verifier-result>' }],
          }),
        },
        {
          role: 'user', wait: 300, text: 'Apply comment',
          c: Object.assign({}, mateus, {
            pill: false, kind: 'chat',
            attachments: [{
              id: 'ann-' + demoUuid('att:comment'), type: 'comment', name: '.phone h1', filePath: 'Welcome.dc.html', selector: '.phone h1',
              descriptor: '<mentioned-element>\ndom:      body › div.phone › div › h1\ntext:     "Welcome to Northwind"\n</mentioned-element>',
              content: 'File: Welcome.dc.html\nElement: <mentioned-element>\ndom:      body › div.phone › div › h1\ntext:     "Welcome to Northwind"\n</mentioned-element>\n\n**Mateus**: Make the heading one size smaller and keep it on one line. The button should also say what happens next.',
            }],
          }),
        },
        {
          role: 'assistant', wait: 30,
          c: {
            contentBlocks: [
              tool('str_replace_edit', {
                path: 'Welcome.dc.html',
                edits: [
                  { old_string: 'h1{font-size:34px;margin:28px 0 10px}', new_string: 'h1{font-size:28px;margin:28px 0 10px;white-space:nowrap}' },
                  { old_string: '>Get started<', new_string: '>Set up my team<' },
                ],
              }, 'Edited Welcome.dc.html (2 replacements)'),
              text('Done. The heading is one size smaller and stays on one line, and the button now says **Set up my team**.'),
            ],
            turnChanges: changes([], ['Welcome.dc.html']),
            turnInputTokens: 90412,
          },
        },
      ],
    }),
    demoDesignChat({
      key: 'autumn-landing', project: 'marketing-site', projectName: 'Northwind Marketing Site', start: '2026-09-02T10:14',
      rows: [
        {
          role: 'user',
          text: '<system-info comment="Only acknowledge these if relevant">\nProject: Northwind Marketing Site\nLocal time: Wednesday, 2 September 2026, 11:14\n</system-info>\n\nCreate a landing page for the autumn campaign: a hero, three benefits and a sign-up form.',
          c: Object.assign({}, lucia, { kind: 'chat', attachments: [{ id: demoUuid('att:skill-landing'), name: 'Campaign page', type: 'skill', content: 'Use this skill for marketing landing pages: one clear message, a short list of benefits, and one call to action.' }] }),
        },
        {
          role: 'assistant', wait: 90,
          c: {
            contentBlocks: [
              text('I\'ll start with a single page.'),
              tool('write_file', { path: 'Landing.dc.html', content: landing }, wrote('Landing.dc.html', landing)),
              tool('show_html', { path: 'Landing.dc.html' }, '[elided]'),
              text('The first version is ready: a hero, three benefit cards and an email sign-up.'),
            ],
            turnChanges: changes(['Landing.dc.html']),
            turnInputTokens: 52310,
          },
        },
        { role: 'user', wait: 1500, text: 'Nice! Can we add a short customer quote under the benefits?', c: Object.assign({}, amara, { kind: 'chat' }) },
        {
          // A turn that broke off: the edit has no result and the turn ends with an error.
          role: 'assistant', wait: 20,
          c: {
            contentBlocks: [
              text('Adding a quote section now.'),
              tool('str_replace_edit', { path: 'Landing.dc.html', old_string: '</section>\n<form>', new_string: '</section>\n' + quote + '\n<form>' }),
              { type: 'error', message: 'Network error: the reply stopped before it was finished' },
            ],
          },
        },
        { role: 'user', wait: 600, text: 'That stopped halfway. Can you try again? Keep the quote short.', c: Object.assign({}, lucia, { kind: 'chat' }) },
        {
          role: 'assistant', wait: 40,
          c: {
            contentBlocks: [
              text('Sorry about that.'),
              tool('str_replace_edit', { path: 'Landing.dc.html', old_string: '</section>\n<form>', new_string: '</section>\n' + quote + '\n<form>' }, 'Edited Landing.dc.html'),
              text('Added the quote under the benefits: *“We stopped losing tasks between meetings.”*'),
            ],
            turnChanges: changes([], ['Landing.dc.html']),
            turnInputTokens: 57880,
          },
        },
      ],
    }),
    // An empty chat: no messages, so no author either.
    demoDesignChat({ key: 'illustrations', project: 'brand-illustrations', projectName: 'Brand Illustrations', start: '2026-09-05T15:20', rows: [] }),
    demoDesignChat({
      key: 'dark-mode', project: 'mobile-app', projectName: 'Northwind Mobile App', start: '2026-08-25T13:30',
      rows: [
        { role: 'user', text: 'Continuing from "Onboarding screens".', c: { authorName: 'Mateus', pill: true } },
        {
          role: 'assistant', wait: 3, c: { kind: 'chat-summary' },
          text: demoLines(
            'We designed onboarding screens for the Northwind mobile app (welcome, pick your team, invite teammates).',
            '',
            '**Decisions made:**',
            '- Calm, clear copy',
            '- Green accent `#1f9d6b`, 14 px corner radius',
            '- The invite screen offers a link as well as email',
            '',
            '**Open:** a dark mode version.',
          ),
        },
        { role: 'user', wait: 60, text: 'Now make a dark mode version of the welcome screen.', c: Object.assign({}, mateus, { kind: 'chat' }) },
        {
          role: 'assistant', wait: 75,
          c: {
            contentBlocks: [
              text('Here is the dark version. I kept the same layout and only changed the colours.'),
              tool('write_file', { path: 'Welcome-dark.dc.html', content: welcomeDark }, wrote('Welcome-dark.dc.html', welcomeDark)),
              text('It sits next to the light board on the canvas.'),
            ],
            turnChanges: changes(['Welcome-dark.dc.html']),
            turnInputTokens: 38190,
          },
        },
      ],
    }),
  ];
}

/* ---------- Artifacts (frames) ---------- */

const DEMO_PAGE_CSS = demoLines(
  ':root{--bg:#fbfaf7;--fg:#1f1e1c;--muted:#6b665d;--line:#e4e0d6;--card:#fff;--accent:#1f9d6b;--soft:#e2f4f1}',
  '@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eceae4;--muted:#a49e92;--line:#36332e;--card:#24221f;--accent:#4cc794;--soft:#1f3a31}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'main{max-width:880px;margin:0 auto;padding:40px 24px 64px}',
  'h1{font-size:32px;line-height:1.2;margin:0 0 6px}',
  'h2{font-size:20px;margin:36px 0 12px}',
  '.sub{color:var(--muted);margin:0 0 28px}',
  'a{color:var(--accent)}',
  'table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}',
  'th,td{text-align:start;padding:9px 14px;border-bottom:1px solid var(--line)}',
  'th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}',
  '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}',
  '.big{display:block;font-size:30px;font-weight:700;color:var(--accent)}',
  '.tag{display:inline-block;padding:1px 10px;border-radius:999px;font-size:13px;background:var(--soft);color:var(--accent)}',
  '.tag.bad{background:#fbe7e5;color:#b3261e}',
  '.foot{margin-top:40px;color:var(--muted);font-size:14px}',
);

// A small, self-contained HTML page: inline styles only, no external links.
function demoHtml(title, body, opts) {
  const o = opts || {};
  return demoLines(
    '<!doctype html>',
    '<html lang="' + (o.lang || 'en') + '"' + (o.dir ? ' dir="' + o.dir + '"' : '') + '>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>', DEMO_PAGE_CSS + (o.css ? '\n' + o.css : ''), '</style>',
    '</head>',
    '<body><main>',
    body,
    '</main>' + (o.script ? '\n<script>\n' + o.script + '\n<\/script>' : ''),
    '</body></html>',
    '',
  );
}

const demoRows = rows => rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('\n');

// The Q3 report in three versions: 1 = first draft, 2 = renamed with a share column, 3 = with notes.
function demoReportHtml(v) {
  const title = v === 1 ? 'Q3 Onboarding Report' : 'Q3 Onboarding Review';
  const funnel = [['Signed up', '1,240', '100%', 'All new teams'], ['Invited teammates', '860', '69%', 'Most invite in week one'],
    ['Created first project', '702', '57%', 'Templates help here'], ['Active in week 4', '612', '49%', 'Goal for Q4: 55%']];
  const cols = v === 1 ? 2 : v === 2 ? 3 : 4;
  const head = ['Step', 'Teams', 'Share', 'Notes'].slice(0, cols).map(h => '<th>' + h + '</th>').join('');
  return demoHtml(title, demoLines(
    '<h1>' + title + '</h1>',
    '<p class="sub">Northwind Labs · Customer onboarding · July to September 2026</p>',
    '<nav class="toc"><b>Contents</b><ol><li><a href="#summary">Summary</a></li><li><a href="#funnel">Onboarding funnel</a></li><li><a href="#segments">By segment</a></li><li><a href="#next">Next steps</a></li></ol></nav>',
    '<h2 id="summary">Summary</h2>',
    '<div class="cards"><div class="card"><span class="big">1,240</span>new teams signed up</div><div class="card"><span class="big">69%</span>invited a teammate</div><div class="card"><span class="big">49%</span>still active in week 4</div></div>',
    '<p>More teams signed up than in Q2, and most of them invited someone in their first week. The drop comes later: half of the teams are no longer active by week 4.</p>',
    '<h2 id="funnel">Onboarding funnel</h2>',
    '<table>',
    '<tr>' + head + '</tr>',
    demoRows(funnel.map(r => r.slice(0, cols))),
    '</table>',
    '<h2 id="segments">By segment</h2>',
    '<table>',
    '<tr><th>Segment</th><th>Teams</th><th>Active in week 4</th></tr>',
    demoRows([['Start-ups', '520', '<span class="bar" style="--w:54%"></span>54%'], ['Mid-size', '480', '<span class="bar" style="--w:47%"></span>47%'], ['Enterprise', '240', '<span class="bar" style="--w:42%"></span>42%']]),
    '</table>',
    '<h2 id="next">Next steps</h2>',
    '<ol><li>Roll out the onboarding checklist to every team in October.</li><li>Add usage alerts for teams that go quiet after week 2.</li><li>Run five interviews with enterprise teams about their set-up.</li></ol>',
    '<p class="foot">Made with Claude for the onboarding team. Numbers from the product database, 7 September 2026.</p>',
  ), { css: '.toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 18px}.toc ol{margin:6px 0 0}\n.bar{display:inline-block;height:10px;width:calc(var(--w) * 2);max-width:140px;background:var(--accent);border-radius:5px;margin-inline-end:8px;vertical-align:middle}' });
}

const DEMO_SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#1f9d6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

// Typed artifacts (Slides, Design) carry the app that shows them on claude.ai. The reader
// does not run it; these stand-ins only show what the folder looks like.
function demoTypeFiles(type, title) {
  return {
    'SKILL.md': demoLines('---', 'name: ' + type, 'description: How Claude fills in and edits a ' + (type === 'slides' ? 'deck' : 'design') + ' made from this type.', '---', '',
      '# ' + (type === 'slides' ? 'Slides' : 'Design'), '',
      type === 'slides' ? 'Each slide is one HTML file in project/slides/. The order is in project/deck.json.' : 'Each board is one .dc.html file in project/. The layout is in project/canvas.json.', ''),
    'artifact-type/app.css': '#root{font-family:system-ui,sans-serif;padding:40px;color:#6b665d}\n',
    'artifact-type/app.js': '/* The app for this artifact type. It runs only on claude.ai. */\n(function () {\n  document.getElementById(\'root\').textContent = \'Open this artifact on claude.ai to use the app.\';\n})();\n',
    'artifact-type/thumbnail/thumbnail.json': JSON.stringify({ v: 1, source: 'db', db: { meta: type === 'slides' ? 'deck/meta' : 'design/meta', collections: type === 'slides' ? ['slides', 'notes', 'assets'] : ['boards', 'notes', 'assets'], cover: { collection: type === 'slides' ? 'slides' : 'boards', orderField: type === 'slides' ? 'order' : 'boardOrder' } }, files: { index: type === 'slides' ? 'project/deck.json' : 'project/canvas.json', order: 'order', cover: 'cover' } }),
    'index.html': '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + title + '</title><link rel="stylesheet" href="artifact-type/app.css"></head>\n<body><div id="root"></div><script src="artifact-type/app.js"><\/script></body></html>\n',
  };
}

function demoSlide(id, bg, fg, inner, notes) {
  return '<section id="' + id + '" style="width:1920px;height:1080px;box-sizing:border-box;padding:120px 160px;background:' + bg + ';color:' + fg + ';font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;display:flex;flex-direction:column;gap:56px">\n' +
    inner + '\n<aside>' + notes + '</aside>\n</section>\n';
}

function demoStat(value, label) {
  return '<div style="flex:1;background:#fff;border-radius:28px;padding:56px;box-shadow:0 6px 24px rgba(0,0,0,.08)"><div style="font-size:130px;font-weight:800;line-height:1;color:#1f9d6b">' + value + '</div><div style="font-size:42px;color:#6b665d;margin-top:20px">' + label + '</div></div>';
}

function demoArtifactSpecs() {
  const officeGuide = {
    'index.html': demoLines(
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lisbon Office Guide</title>',
      '<style>',
      DEMO_PAGE_CSS,
      '.plan{width:100%;height:auto;border-radius:12px}',
      '.tips{list-style:none;padding:0;display:grid;gap:10px}',
      '.tips li{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}',
      '</style></head>',
      '<body><main>',
      '<h1>Welcome to the Lisbon office</h1>',
      '<p class="sub">Everything you need in your first week at Northwind Labs.</p>',
      '<h2>Floor plan</h2>',
      '<img class="plan" src="img/floor-plan.svg" alt="Floor plan of the office">',
      '<h2>Good to know</h2>',
      '<ul class="tips" id="tips"></ul>',
      '<h2>Who to ask</h2>',
      '<p>Reception is open from 08:30 to 18:00. For anything else, ask in the <b>#lisbon-office</b> channel.</p>',
      '</main>',
      '<script>',
      '// The icon file name is built from each tip\'s key.',
      'const tips = [',
      '  [\'wifi\', \'Wi-Fi: <b>Northwind-Guest</b>. The password is on the card at reception.\'],',
      '  [\'coffee\', \'Coffee and tea are free in the kitchen. Please rinse your cup.\'],',
      '  [\'bike\', \'Bike storage is in the basement, next to the showers.\'],',
      '  [\'plant\', \'The plants are watered on Fridays. You may adopt one!\'],',
      '];',
      'const list = document.getElementById(\'tips\');',
      'for (const [icon, text] of tips) {',
      '  const li = document.createElement(\'li\');',
      '  const img = document.createElement(\'img\');',
      '  img.src = \'icons/\' + icon + \'.svg\';',
      '  img.alt = \'\';',
      '  const span = document.createElement(\'span\');',
      '  span.innerHTML = text;',
      '  li.append(img, span);',
      '  list.append(li);',
      '}',
      '<\/script>',
      '</body></html>',
      '',
    ),
    'img/floor-plan.svg': demoLines(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" font-family="system-ui, sans-serif" font-size="15" fill="#1f1e1c">',
      '<rect x="1" y="1" width="598" height="298" rx="12" fill="#fbfaf7" stroke="#b9b4a8" stroke-width="2"/>',
      '<rect x="20" y="20" width="200" height="120" rx="8" fill="#e2f4f1" stroke="#2c8c7c"/><text x="120" y="85" text-anchor="middle">Team area</text>',
      '<rect x="240" y="20" width="160" height="120" rx="8" fill="#eeeafc" stroke="#7b68d9"/><text x="320" y="85" text-anchor="middle">Meeting room</text>',
      '<rect x="420" y="20" width="160" height="120" rx="8" fill="#fdf2da" stroke="#c48a12"/><text x="500" y="85" text-anchor="middle">Kitchen</text>',
      '<rect x="20" y="160" width="380" height="120" rx="8" fill="#e6effc" stroke="#3a73c9"/><text x="210" y="225" text-anchor="middle">Quiet desks</text>',
      '<rect x="420" y="160" width="160" height="120" rx="8" fill="#fde9e3" stroke="#d5694a"/><text x="500" y="225" text-anchor="middle">Reception</text>',
      '</svg>',
      '',
    ),
    'icons/wifi.svg': DEMO_SVG_ICON + '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="#1f9d6b"/></svg>\n',
    'icons/coffee.svg': DEMO_SVG_ICON + '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 2v3M12 2v3"/></svg>\n',
    'icons/bike.svg': DEMO_SVG_ICON + '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8l2 8"/></svg>\n',
    'icons/plant.svg': DEMO_SVG_ICON + '<path d="M12 21v-9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 14c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z"/><path d="M8 21h8"/></svg>\n',
  };

  const deck = {
    v: 4, createdOnFiles: { v: 1, at: '2026-09-15T09:00:00Z' }, lists: 'css', title: 'Sales Kickoff 2026', cover: 'cover',
    order: ['cover', 'agenda', 'wins', 'targets', 'thanks'],
    sections: { s1: { description: 'Looking back', start: 'cover' }, s2: { description: 'Looking ahead', start: 'targets' } },
    faces: {}, designSystems: [],
  };
  const h2 = t => '<h2 style="font-size:84px;font-weight:800;line-height:1.1">' + t + '</h2>';
  const slides = Object.assign(demoTypeFiles('slides', 'Sales Kickoff 2026'), {
    'project/deck.json': JSON.stringify(deck, null, 2),
    'project/slides/cover.html': demoSlide('cover', 'linear-gradient(135deg,#0f3d2e,#1f9d6b)', '#fff',
      '<div style="flex:1"></div>\n<div style="font-size:36px;letter-spacing:6px;text-transform:uppercase;opacity:.8">Northwind Labs</div>\n<h1 style="font-size:150px;line-height:1;font-weight:800">Sales Kickoff 2026</h1>\n<p style="font-size:46px;opacity:.85">Lisbon · 12 October 2026</p>',
      'Welcome everyone. Today: what went well this year, and our three targets for next year.'),
    'project/slides/agenda.html': demoSlide('agenda', '#fbfaf7', '#1f1e1c',
      h2('Agenda') + '\n<ol style="font-size:56px;line-height:1.7;padding-left:70px"><li>This year in numbers</li><li>What our customers told us</li><li>Targets for 2027</li><li>Questions</li></ol>',
      'Keep this short: about one minute.'),
    'project/slides/wins.html': demoSlide('wins', '#f3f1ec', '#1f1e1c',
      h2('This year in numbers') + '\n<div style="display:flex;gap:60px">' + demoStat('104', 'new customers') + demoStat('89%', 'retention') + demoStat('2', 'new regions') + '</div>',
      'Our target was 110 new customers and we reached 104. Retention was the best we have had.'),
    'project/slides/targets.html': demoSlide('targets', '#fbfaf7', '#1f1e1c',
      h2('Targets for 2027') + '\n<div style="display:flex;gap:60px">' + demoStat('120', 'new customers') + demoStat('92%', 'retention') + demoStat('3', 'new regions') + '</div>',
      'Targets agreed with finance on 2 October. This year we reached 104 new customers.'),
    'project/slides/thanks.html': demoSlide('thanks', '#0f3d2e', '#fff',
      '<div style="flex:1"></div>\n<h1 style="font-size:150px;font-weight:800">Thank you</h1>\n<p style="font-size:46px;opacity:.85">Questions? Ask in #sales-kickoff</p>',
      'Open the floor for questions. Share the deck link in the channel afterwards.'),
  });

  const canvas = {
    v: 3, createdOnFiles: { v: 1, at: '2026-08-18T11:40:00Z' }, title: 'Mobile Onboarding Screens',
    launch: { view: 'focused', file: 'Welcome.dc.html' }, pages: [],
    boards: {
      'Welcome.dc.html': { x: 0, y: 0, w: 390, h: 844, title: 'Welcome', is_interactive: true },
      'Team.dc.html': { x: 470, y: 0, w: 390, h: 844, title: 'Pick your team', is_interactive: true },
    },
    order: ['Welcome.dc.html', 'Team.dc.html'],
    notes: { about: { x: 940, y: 0, w: 320, fill: 'blue', text: 'Calm, clear copy. Accent green #1f9d6b.\n\nThe invite screen comes next.' } },
    designSystems: [],
  };
  const design = Object.assign(demoTypeFiles('design', 'Mobile Onboarding Screens'), {
    'artifact-type/dc-runtime.js': '/* Board runtime for claude.ai. Not needed to read the export. */\n',
    'project/canvas.json': JSON.stringify(canvas, null, 2),
    'project/tokens.css': DEMO_TOKENS_CSS,
    'project/Welcome.dc.html': DEMO_WELCOME,
    'project/Team.dc.html': DEMO_TEAM,
  });

  const offsitePage = demoLines(
    '# Team Offsite Plan',
    '',
    '<!-- tab: Plan -->',
    '# Team Offsite Plan',
    '',
    '2026-09-22 · @Lucía Fernández',
    '',
    '## Goals',
    '- Agree on the three marketing bets for next year',
    '- Spend a whole afternoon away from screens',
    '',
    '## Schedule',
    '',
    '| Time | What |',
    '|---|---|',
    '| 09:30 | Coffee and welcome |',
    '| 10:00 | Review of this year\'s campaigns |',
    '| 13:00 | Lunch on the river terrace |',
    '| 14:30 | Walk and talk in pairs |',
    '| 16:00 | Decide the three bets |',
    '',
    '<!-- tab: Budget -->',
    '# Budget',
    '',
    '| Item | Cost (EUR) |',
    '|---|---|',
    '| Venue | 1,200 |',
    '| Lunch for 9 | 540 |',
    '| Travel | 380 |',
    '| **Total** | **2,120** |',
    '',
    '![Venue photo](attachment)',
    '',
  );
  const lucia = { uuid: demoUser('lucia'), full_name: 'Lucía Fernández' };
  const docBlurb = 'Living docs — plans and briefs that you and Claude write and edit together.';

  const hebrew = demoHtml('סיכום ראיונות לקוחות – שבוע 36', demoLines(
    '<h1>סיכום ראיונות לקוחות – שבוע 36</h1>',
    '<p class="sub">חמישה ראיונות · ספטמבר 2026</p>',
    '<h2>הממצאים העיקריים</h2>',
    '<ol>',
    '<li>קשה למצוא איך מזמינים אנשי צוות – שני לקוחות חיפשו את זה בהגדרות.</li>',
    '<li>לא ברור מי אחראי על החשבון בצוות.</li>',
    '<li>לקוחות גדולים מבקשים כניסה מאובטחת (SSO) לפני שהם מרחיבים את השימוש.</li>',
    '<li>יש ביקוש לייצוא נתונים לקובץ CSV.</li>',
    '</ol>',
    '<h2>הצעדים הבאים</h2>',
    '<ul><li>להציג את כפתור ההזמנה כבר במסך הראשון.</li><li>להוסיף שלב "מי מנהל את החשבון?" בתהליך ההרשמה.</li></ul>',
  ), { lang: 'he', dir: 'rtl' });

  const calendarRows = [['Sep 28', 'Blog', 'Why a checklist beats a manual', 'Lucía'], ['Oct 5', 'LinkedIn', 'Checklist launch post', 'Lucía'],
    ['Oct 12', 'Email', 'Autumn newsletter', 'Amara'], ['Oct 19', 'Webinar', 'Your first week with Northwind', 'Amara'],
    ['Oct 26', 'Video', 'Customer story: a logistics start-up', 'Mateus'], ['Nov 2', 'Blog', 'Five habits of calm teams', 'Lucía']];
  const calendar = n => demoHtml('Autumn Campaign Calendar', demoLines(
    '<h1>Autumn Campaign Calendar</h1>',
    '<p class="sub">Marketing · September to November 2026</p>',
    '<table><tr><th>Week</th><th>Channel</th><th>Message</th><th>Owner</th></tr>',
    demoRows(calendarRows.slice(0, n).map(r => [r[0], '<span class="tag">' + r[1] + '</span>', r[2], r[3]])),
    '</table>',
  ));

  const builds = n => demoHtml('Nightly Build Status', demoLines(
    '<h1>Nightly Build Status</h1>',
    '<p class="sub">Updated by the release agent every night at 02:00 UTC.</p>',
    '<table><tr><th>Build</th><th>Branch</th><th>Result</th><th>Time</th></tr>',
    demoRows([['#1482', 'main', '<span class="tag">passed</span>', '12 min'], ['#1481', 'main', '<span class="tag bad">failed: checkout test</span>', '14 min'],
      ['#1480', 'main', '<span class="tag">passed</span>', '11 min'], ['#1479', 'release/2.8', '<span class="tag">passed</span>', '13 min']].slice(4 - n)),
    '</table>',
  ));

  return [
    {
      key: 'report', owner: 'amara', visibility: 'organization', sharedWith: { viewers: 6, editors: 1 }, active: 1, updated: '2026-09-12T08:30',
      versions: [
        { at: '2026-09-12T08:30', title: 'Q3 Onboarding Review (with notes)', description: 'Adds a notes column to the funnel. Rolled back for now.', html: demoReportHtml(3) },
        { at: '2026-09-09T15:01', title: 'Q3 Onboarding Review', description: 'Funnel, week-4 activity by segment and next steps for Q4.', html: demoReportHtml(2) },
        { at: '2026-09-08T09:16', title: 'Q3 Onboarding Report', description: 'First draft from the onboarding numbers.', html: demoReportHtml(1) },
      ],
      threads: [
        {
          created_at: demoIso(demoMs('2026-09-10T09:02'), 'p0'), resolved: true, carried: true,
          comments: [
            { author_index: 1, author_role: '', author_is_artifact_owner: true, text: 'Can we add a short note next to each funnel step?', created_at: demoIso(demoMs('2026-09-10T09:02'), 'p0'), to_claude_at: demoIso(demoMs('2026-09-10T09:02'), 'p0') },
            { author_index: 1, author_role: 'assistant', author_is_artifact_owner: true, text: 'Done: the funnel table now has a Notes column.', created_at: demoIso(demoMs('2026-09-10T09:03'), 'p0') },
          ],
        },
        {
          created_at: demoIso(demoMs('2026-09-11T16:40'), 'p0'), resolved: false, carried: true,
          comments: [{ author_index: 2, author_role: '', author_is_artifact_owner: false, text: 'Nice! Could we split week-4 activity by plan as well?', created_at: demoIso(demoMs('2026-09-11T16:40'), 'p0') }],
        },
      ],
    },
    {
      key: 'office-guide', owner: 'mateus', visibility: 'invited', sharedWith: { viewers: 3, editors: 0 },
      versions: [{ at: '2026-07-21T11:20', title: 'Lisbon Office Guide', description: 'A first-week guide for new people in the Lisbon office.', folder: officeGuide }],
    },
    {
      key: 'kickoff-slides', owner: 'samn', visibility: 'organization',
      versions: [{ at: '2026-09-15T17:45', title: 'Sales Kickoff 2026', description: 'Presentation decks: 16:9 slides you build and edit with Claude.', folder: slides }],
    },
    {
      key: 'onboarding-design', owner: 'mateus', visibility: 'private',
      versions: [{ at: '2026-08-18T11:40', title: 'Mobile Onboarding Screens', description: 'Design canvas for websites, apps and prototypes.', folder: design }],
    },
    {
      key: 'offsite-doc', kind: 'page', owner: 'lucia', visibility: 'organization', updated: '2026-09-23T08:10',
      versions: [
        { at: '2026-09-23T08:20', title: 'Team Offsite Plan', description: docBlurb },
        { at: '2026-09-22T16:40', title: 'Team offsite plan (draft)', description: docBlurb },
      ],
      page: offsitePage,
      comments: [
        {
          resolved: false, tab: 'Plan', quoted_text: 'Walk and talk in pairs',
          comments: [
            { body: '@Claude can you suggest pairs, so people meet someone from another team?', author: lucia, created_at: demoIso(demoMs('2026-09-23T08:14:05'), 'z3') },
            { body: 'Sure. A simple rule: pair people from different teams who have not worked on a project together this year. With nine people, make one group of three.', author: lucia, posted_by_agent: true, created_at: demoIso(demoMs('2026-09-23T08:14:41'), 'z3') },
          ],
        },
        {
          resolved: true, tab: 'Budget', quoted_text: 'Lunch for 9',
          comments: [{ body: 'Price confirmed with the venue.', author: lucia, created_at: demoIso(demoMs('2026-09-24T10:02:17'), 'z3') }],
        },
      ],
      // The same doc question again, as the export also lists it here. The reader hides it.
      threads: [{
        created_at: demoIso(demoMs('2026-09-23T08:14'), 'p0'), resolved: false, carried: true,
        comments: [{ author_index: 1, author_role: 'page', author_is_artifact_owner: true, text: '@Claude can you suggest pairs, so people meet someone from another team?', created_at: demoIso(demoMs('2026-09-23T08:14'), 'p0') }],
      }],
    },
    {
      // Made by an agent: no owner account at all.
      key: 'nightly-builds', owner: null, visibility: 'agent',
      versions: [
        { at: '2026-09-29T02:04', title: 'Nightly Build Status', description: 'Results of the last nightly builds.', html: builds(4) },
        { at: '2026-09-28T02:03', title: 'Nightly Build Status', description: 'Results of the last nightly builds.', html: builds(3) },
      ],
    },
    {
      // A typed app whose content lived in claude.ai's database: only the app files are exported.
      key: 'team-update', owner: 'kenji', visibility: 'private',
      versions: [{ at: '2026-09-02T13:15', title: 'Platform Team Update', description: 'Presentation decks: 16:9 slides you build and edit with Claude.', folder: demoTypeFiles('slides', 'Platform Team Update') }],
    },
    {
      key: 'token-bucket', owner: 'kenji', visibility: 'private',
      versions: [{
        at: '2026-06-17T10:30', title: 'Token Bucket Cheat Sheet', description: 'Rate limits for the public API on one page.',
        html: demoHtml('Token Bucket Cheat Sheet', demoLines(
          '<h1>Token bucket cheat sheet</h1>',
          '<p class="sub">Rate limits for the public API · platform team</p>',
          '<div class="cards"><div class="card"><span class="big">100 / min</span>refill rate</div><div class="card"><span class="big">20</span>largest burst</div><div class="card"><span class="big">429</span>when the bucket is empty</div></div>',
          '<h2>How it works</h2>',
          '<ol><li>Every customer has a bucket of tokens.</li><li>Each request takes one token.</li><li>Tokens come back at a steady rate.</li><li>No token: answer <code>429</code> with a <code>Retry-After</code> header.</li></ol>',
          '<h2>Limits per plan</h2>',
          '<table><tr><th>Plan</th><th>Rate</th><th>Burst</th></tr>',
          demoRows([['Free', '30 / min', '10'], ['Team', '100 / min', '20'], ['Business', '300 / min', '50']]),
          '</table>',
        )),
      }],
    },
    {
      key: 'churn-one-pager', owner: 'priya', visibility: 'organization', sharedWith: { viewers: 4, editors: 0 },
      versions: [{
        at: '2026-09-15T09:10', title: 'Churn Metrics One-Pager', description: 'Weekly churn and how we measure it.',
        html: demoHtml('Churn Metrics One-Pager', demoLines(
          '<h1>Churn metrics</h1>',
          '<p class="sub">Analytics · numbers up to 13 September 2026</p>',
          '<div class="cards"><div class="card"><span class="big">1.2%</span>weekly churn, latest week</div><div class="card"><span class="big">288</span>teams churned in 8 weeks</div><div class="card"><span class="big" id="live">–</span>live number (claude.ai only)</div></div>',
          '<h2>Definitions</h2>',
          '<table><tr><th>Term</th><th>Meaning</th></tr>',
          demoRows([['Active team', 'At least one action in the last 7 days'], ['Churned team', 'No activity for 30 days'], ['Weekly churn', 'Churned this week ÷ active at the start of the week']]),
          '</table>',
        ), { script: '// On claude.ai this reads the latest number from the shared data store.\nif (window.claude && window.claude.use) window.claude.use(\'db\');' }),
      }],
    },
    {
      key: 'campaign-calendar', owner: 'lucia', visibility: 'private',
      versions: [
        { at: '2026-09-25T11:05', title: 'Autumn Campaign Calendar', description: 'Six weeks of posts, emails and events.', html: calendar(6) },
        { at: '2026-09-24T10:00', title: 'Autumn Campaign Calendar', description: 'First four weeks.', html: calendar(4) },
      ],
    },
    {
      key: 'interviews-he', owner: 'noor', visibility: 'invited', sharedWith: { viewers: 2, editors: 1 },
      versions: [{ at: '2026-09-12T09:30', title: 'סיכום ראיונות לקוחות – שבוע 36', description: 'ארבעה ממצאים וצעדים הבאים לצוות המוצר.', html: hebrew }],
    },
    {
      key: 'upgrade-runbook', owner: 'saml', visibility: 'private',
      versions: [{
        at: '2026-07-15T08:50', title: 'Cluster Upgrade Runbook', description: 'Step by step, with owners.',
        html: demoHtml('Cluster Upgrade Runbook', demoLines(
          '<h1>Cluster upgrade runbook</h1>',
          '<p class="sub">Infrastructure · one minor version at a time</p>',
          '<table><tr><th>#</th><th>Step</th><th>Owner</th></tr>',
          demoRows([['1', 'Check for deprecated APIs', 'Sam'], ['2', 'Confirm etcd backups', 'Sam'], ['3', 'Upgrade the staging cluster', 'Kenji'],
            ['4', 'Upgrade the production control plane', 'Sam'], ['5', 'Replace node pools one by one', 'Kenji'], ['6', 'Watch error rates for a day', 'Both']]),
          '</table>',
        )),
      }],
    },
    {
      key: 'triage', owner: 'amara', visibility: 'private',
      versions: [{
        at: '2026-08-22T14:10', title: 'Feature Request Triage', description: 'Top requests from customers this quarter.',
        html: demoHtml('Feature Request Triage', demoLines(
          '<h1>Feature request triage</h1>',
          '<p class="sub">Product · requests from customer calls, Q3 2026</p>',
          '<table><tr><th>Request</th><th>Votes</th><th>Status</th></tr>',
          demoRows([['Onboarding checklist', '41', '<span class="tag">planned for Q4</span>'], ['CSV export for reports', '27', '<span class="tag">planned for Q4</span>'],
            ['SSO for small teams', '19', '<span class="tag">later</span>'], ['Dark mode on the web', '15', '<span class="tag bad">not now</span>']]),
          '</table>',
        )),
      }],
    },
  ];
}

// The zip entries for one artifact, in the order real exports write them.
function demoArtifactEntries(spec) {
  const enc = new TextEncoder();
  const id = demoUuid('art:' + spec.key);
  const base = 'artifacts/' + id + '/';
  const versions = spec.versions.map((v, i) => Object.assign({ id: Math.floor(demoMs(v.at) / 1000) + '-' + demoChars('vid:' + spec.key + ':' + i, 4, DEMO_HEX) }, v));
  const meta = {
    id, kind: spec.kind || 'artifact', visibility: spec.visibility,
    versions: versions.map(v => Object.assign({ id: v.id, title: v.title }, v.description ? { description: v.description } : {}, { created_at: demoIso(demoMs(v.at), 'p0') })),
  };
  if (spec.owner) meta.owner_account = demoUser(spec.owner);
  else meta.created_by_agent = true;
  meta.updated_at = demoIso(demoMs(spec.updated || spec.versions[0].at), 'p0');
  meta.active_version = versions[spec.active || 0].id;
  if (spec.sharedWith) meta.shared_with = spec.sharedWith;

  const entries = [[base + 'artifact.json', JSON.stringify(meta)]];
  for (const v of versions) {
    if (v.html != null) entries.push([base + 'versions/' + v.id + '.html', v.html]);
    if (!v.folder) continue;
    const list = [];
    for (const [path, text] of Object.entries(v.folder)) {
      const bytes = enc.encode(text);
      entries.push([base + 'versions/' + v.id + '/' + path, bytes]);
      list.push({ original_path: path, exported_as: path, sha256: demoSha256(bytes), size_bytes: bytes.length, mime_type: demoMime(path) });
    }
    list.sort((a, b) => (a.original_path < b.original_path ? -1 : a.original_path > b.original_path ? 1 : 0));
    entries.push([base + 'versions/' + v.id + '.files.json', JSON.stringify({ files: list })]);
  }
  if (spec.page != null) entries.push([base + 'page.md', spec.page]);
  if (spec.comments) entries.push([base + 'comments.json', JSON.stringify(spec.comments)]);
  if (spec.threads) entries.push([base + 'artifact_comments.json', JSON.stringify({ threads: spec.threads })]);
  return entries;
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
