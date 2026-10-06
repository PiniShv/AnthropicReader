# Security and privacy

Claude Export Reader opens files that hold personal data: names, emails, phone numbers and everything people wrote to Claude. This page explains how the reader protects that data, what it trusts, and how to report a problem.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:

1. Go to the [Security tab](https://github.com/PiniShv/AnthropicReader/security) of this repository.
2. Click **Report a vulnerability** (or open [this link](https://github.com/PiniShv/AnthropicReader/security/advisories/new) directly).
3. Describe the problem, the browser you used, and the steps to see it.

Use made-up data in your report. If the problem needs a special export file to show it, build a small file by hand with invented content. Never send real export data.

This is a project maintained in free time. The maintainer aims to answer within 7 days and to fix confirmed problems as fast as their severity calls for. You will be credited in the advisory unless you ask not to be.

## Supported versions

Only the latest release, and the current `main` branch, get security fixes. The reader is a single file, so updating means downloading the new `dist/claude-export-reader.html`.

## Privacy model

**The export never leaves your computer.**

- **Reading.** Files you pick or drop are read with standard browser file APIs. Zip files are opened in place: the reader reads their index and unpacks single entries when it needs them. Nothing is uploaded.
- **Memory only.** The parsed export lives in the memory of the open tab. Closing or reloading the tab forgets it.
- **No network requests of its own.** The reader has no analytics, no telemetry, no update check, and it loads no fonts, scripts or styles from the network. All of its code is inside the one HTML file. It works with the network turned off.
- **What the browser stores.** Two small settings, and nothing else:

  | Where | Key | What |
  |---|---|---|
  | `localStorage` | `cer-theme` | light or dark theme |
  | `localStorage` | `cer-conv-opts` | conversation view switches (tool calls, thinking, system notes, hide empty chats) |

  Nothing about the export is stored: no content, no names or ids, no file names and no file handles. The person you focus on is kept in memory only. This matters because Chromium-based browsers (Chrome, Edge, Brave) give **every page opened from disk** (`file://`) one shared storage. Any other local HTML file you open, such as a downloaded artifact, can read what the reader stores there. Older versions kept file handles for **Reopen last export** in IndexedDB, which let such a page open your export files. That feature is gone, and the reader deletes the old `claude-export-reader` database when it starts.

- **Phone numbers** are masked until you click **show**.
- **Manifest download links.** A manifest holds single-use, secret download links. The reader accepts only `https://claude.ai/export/…` links, keeps them in memory only, and never saves, logs or fetches them. It shows them only as **Download** buttons. When you click one, your browser opens it in a new tab with your own claude.ai sign-in, and no referrer is sent.
- **Links to claude.ai.** Pages have a "claude.ai ↗" link to the original item. It only opens when you click it.
- **Downloads you make** (a conversation as Markdown, one person's data as a zip) contain the same personal data as the export. Handle them with the same care.

## Threat model

### What we protect

- The export data in the tab.
- The reader page itself (its code and its view of your data).
- Your other browser data: storage, cookies and your claude.ai session.

### What we treat as untrusted

**Everything inside an export.** Claude, the people in the workspace, web pages Claude read, and files people uploaded can all put arbitrary text and code into an export. That includes:

- Markdown and raw HTML in messages, project docs, memory files, comments and design chats
- whole HTML apps in artifacts, widgets and created files, often with JavaScript
- file names, titles, ids and URLs
- the zip and JSON files themselves, which may be broken, cut short or very large

### How the reader defends itself

- **Escaping.** Plain values (names, titles, file names, ids) are HTML-escaped (`esc()` in `src/render.js`) before they go into the page.
- **Sanitizing.** Markdown is turned into HTML with marked and then cleaned with **DOMPurify**, which keeps only the tags and attributes that Markdown output needs (`PURIFY_CONFIG` in `src/render.js`). The tags are text and lists, headings, tables, code, links, images, `<details>` and a few inline ones (such as `<kbd>`, `<mark>` and `<abbr>`). The attributes are `href`, `src`, `title`, `alt`, `colspan`, `rowspan`, `start`, `dir` and `open`. So there is no `class`, `id`, `style`, `name`, `tabindex`, `aria-` or `data-` attribute: export text cannot use the reader's own look (for example a fake "sign in again" dialog over the page), take over its element ids or change its Tab order. Nothing that loads, runs or posts on its own is on the list: no scripts, styles, forms, media, frames, `<dialog>` or image maps. SVG and MathML are not on it either, because their attributes can load files from the internet (for example `mask="url(…)"`); an `<svg>` or `<math>` element is shown as the plain text it holds. After cleaning, `<img>` tags with remote addresses become plain links instead of loading, and no other element keeps a `src`. Every `href` is checked: web and mail links stay clickable and open in a new tab with `rel="noopener noreferrer"`, and in-app links (`#/…`) open the reader's own pages. A relative or `//host` link would open a path on your computer, or on Windows a network share, so it becomes plain text. Links built from export data are only clickable for `http:`, `https:` and `mailto:` addresses (`safeUrl()`).
- **Sandboxed previews.** Anything that is meant to run (HTML artifacts, Slides, Design boards, widgets, HTML project files and created HTML files) is shown in an `<iframe>` with `srcdoc` and a `sandbox` attribute that allows scripts, pop-ups, forms, modals (and downloads in the artifact viewer) but **never** `allow-same-origin`. The content therefore runs in an opaque origin. It cannot read the reader's page, its memory, storage or cookies, and it cannot reach other artifacts. Pop-ups it opens keep the same sandbox. The frames also use `referrerpolicy="no-referrer"`.
- **Narrow messages from frames.** The reader listens to one kind of message from a preview: a request to switch to another board of the same Design canvas. It accepts it only from the preview frame that is open, and only as a board name.
- **"Open in new tab".** The new tab holds only a sandboxed iframe with the artifact, so the artifact is just as isolated there. Its title is always "Artifact preview", so the artifact's title does not end up in the browser history.
- **Robust parsing.** The zip reader reads only the central directory up front, checks every header signature, and supports only the STORED and DEFLATE methods. The JSON parser streams huge arrays and reports files that end too early. A file that cannot be read becomes a warning, and the rest of the export still loads. So does a single record that cannot be read: it is skipped with a warning, and the rest of its file still loads. A load that fails anyway leaves the export that was open as it was.
- **Tested with hostile input.** `npm run security` (`scripts/security.mjs`) feeds hostile, made-up export text through every renderer, and a whole hostile export through every kind of page, in headless Chrome with the network cut off. It fails on any script that runs in the reader, any network request, any tag or attribute outside the allow-list, any frame without its sandbox, and anything in browser storage beyond the two settings. CI runs it on every pull request and every push to `main`.
- **Safe file names in downloads.** Download names, and in the per-person zip the item names and the paths of project docs, memory files and artifact files, are cleaned part by part: `.` and `..` path parts, characters that file systems reject, dots and spaces at the end, and names Windows keeps for devices (such as `CON` or `NUL`) are replaced.

### Known limits

These are trade-offs, not bugs. Reports that improve them are still welcome.

- **Sandboxed content can use the network.** An artifact or widget may load fonts, images or scripts from the internet, or send data it already contains (such as its own text) to a server, just as it could on claude.ai. It cannot read anything outside its own frame. If you need a strictly offline session, turn off the network before you open previews.
- **The reader relies on the browser.** The isolation above depends on the browser's iframe sandbox and on DOMPurify. Keep your browser up to date.
- **Very large files** can use a lot of memory. A hostile export can make the tab slow or crash it. That affects only that tab.
- **Your files on disk** are outside the reader's control. Store and delete exports with care.

## Third-party code

The reader includes [marked](https://github.com/markedjs/marked) and [DOMPurify](https://github.com/cure53/DOMPurify), vendored and unchanged. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A weekly workflow checks them against npm and fails when a security advisory names their version. When a security fix comes out for either library, it will be updated here.
