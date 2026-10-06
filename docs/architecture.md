# Architecture

This page explains how Claude Export Reader is built: what each file does, how data flows from the files you drop to the pages you see, and why some parts are built the way they are.

For the format of the export itself, see [export-format.md](export-format.md).

## Goals that shape the design

- **One file.** The reader is a single HTML file that people can download and double-click. No server, no install.
- **Offline and private.** No network requests of its own, no external code. All data stays in the tab.
- **Big exports.** A team export can be several gigabytes of zips, with one JSON file of hundreds of megabytes. Nothing may load a whole big file into one string, and opening the app must stay fast.
- **Untrusted content.** Everything in an export is treated as hostile HTML and code.
- **No dependencies.** No framework, no bundler, no npm packages. Two small libraries are vendored.

## Files

`src/*.js` are **classic scripts** that share one global scope. `scripts/build.mjs` inlines them into `src/template.html` in this order (later files use functions from earlier ones):

| File | Job |
|---|---|
| `vendor/marked.min.js` | Markdown to HTML. |
| `vendor/purify.min.js` | DOMPurify: HTML sanitizer. |
| `src/zip.js` | `ZipArchive` / `ZipEntry`: random-access zip reader. `ZipWriter`: small zip writer for downloads. |
| `src/load.js` | `FileNode`: a loose file with the same interface as a `ZipEntry` (`path`, `size`, `container`, `stream()`, `bytes()`, `text()`, `blob()`). File and folder picking, drag and drop, remembered file handles (`HandleStore`), `parseJsonArrayStream()`, and `mapLimit()` (async work a few at a time, used by the import and search too). |
| `src/render.js` | Escaping (`esc`), reading and formatting of dates (`parseTime`; 0 means unknown and shows as nothing), numbers and sizes, Markdown (`mdToHtml`, `mdBlock`), sanitizing, search highlighting, sandboxed frames (`sandboxFrame()`, `withFrameShim()`), small helpers (toast, `announce()` for screen readers, copy, download, MIME types). Pure formatting and sanitizing: it binds no handlers and keeps no page state. A code block's Copy button carries no key; one click listener in `app.js` handles every `.copy-code` button. |
| `src/ui.js` | `App` (route and focus), `focusPerson()` / `focusScope()`, the `$` / `$$` shortcuts, and the lifetime of one drawn page: `VIEW`, `after()`, `viewKey()`, `on()` for click behaviour, `blk()` for collapsible blocks, and `preHtml()` for long text with a **Show all** button. Focus helpers: `refocus()` and `isolate()` (see [Accessibility](#accessibility)). |
| `src/model.js` | The in-memory model: `Person`, the `DB` object, `finalize()` (links and derived data), `parseVersionRel()` (which version an artifact file belongs to), `versionInfo()` (what an artifact version holds) and small queries (`scopeOf()`, `peopleMatching()`, `artifactTitle()`, `latestManifest()`, `missingFiles()`, `hasRecords()`). |
| `src/ingest.js` | Reading files into the model: `classify()` and `sniffShape()`, one `add…()` function per record type, `OUTPUTS` (which tool calls count as outputs) and `importExport()` (the import pipeline). |
| `src/conversation.js` | Conversations as data: the message tree and branches (`childrenByParent()`, `buildTree()`, `currentPath()`, `selectBranchFor()`), tool names and inputs, and the outputs Claude produced (`collectOutputs()`). |
| `src/search.js` | The search engine (`runSearch()`), the searchable text of each record and the search index. No DOM. |
| `src/export.js` | Files made for download: a conversation as Markdown (`convToMarkdown()`) and the per-person zip (`buildPersonZip()`). |
| `src/preview.js` | Artifact previews: `buildVersionHtml()` turns a version's files into one HTML document for a sandboxed frame (multi-file HTML, `buildSlides()`, `buildDesign()`), with file inlining (`inlineRefs()`, `assetLookup()`) and a small cache of built previews (`getBuilt()`). |
| `src/views.js` | The kind registry (`KINDS`: routes, labels, icons, counts, views and search results of the five record kinds), router dispatch (`renderRoute`), sidebar, the shared sortable table, start page, people list and person page. |
| `src/views-conv.js` | Conversation list and thread: message and tool rendering, the tool cards (`TOOL_CARDS`: tools drawn as their own card, and their chips), branch arrows, the "What Claude produced here" box. |
| `src/views-art.js` | Artifact list and page, version viewer (Preview, Source and Files tabs), Claude Docs pages, artifact comments. |
| `src/views-design.js` | Claude Design chats: list and thread (prompts, tool calls, questions, attachments). |
| `src/views-misc.js` | Projects, memory, the search page, "About this export", manifest download links, and the per-person download dialog. |
| `src/demo.js` | The made-up sample export ("Try it with sample data"): deterministic helpers, the people, and the packaging into zips (`demoExportFiles()`). |
| `src/demo-chats.js` | Sample conversations, and the builders that turn short specs into `conversations.json` records. |
| `src/demo-records.js` | Sample projects, memory and Claude Design chats. |
| `src/demo-artifacts.js` | Sample artifacts: versions, files and comments. |
| `src/app.js` | Start-up: theme, loading screen, file pickers, hash routing, focus mode, global events. |

`src/template.html` holds the landing screen and the empty app shell (top bar, sidebar, main area). `src/styles.css` holds all styles, with light and dark themes as CSS custom properties.

### Building blocks

A few small pieces carry most of the app. When you add something, reach for these first.

| Piece | Where | What it is for |
|---|---|---|
| `VIEW`, `after(fn)` | `ui.js` | Everything that lives as long as one drawn page: its `AbortController`, its handlers, and hooks that run once its HTML is in the page. |
| `on(fn)`, `on.change(fn)` | `ui.js` | Bind click (or change) behaviour where the markup is made. The markup gets only a short key. |
| `blk({ summary }, render)` | `ui.js` | A collapsible block whose body is drawn the first time it opens. `sourceBlk(text)` is the folded raw text under a preview or rendered Markdown. |
| `tableHtml(spec)` | `views.js` | The sortable, filterable, paged table, with optional type chips (`spec.facet`). It keeps its own state per table key. |
| `KINDS` | `views.js` | The five record kinds (conversations, artifacts, projects, design chats, memory): routes, labels, icons, counts, list and person views, and how a search hit looks (`searchResult`). `runSearch()` gives one list of hits per kind, by its key. |
| `scopeOf(p)`, `focusScope()` | `model.js`, `ui.js` | The records in view: one person's, or everyone's. Lists, sidebar counts and search use it. |
| `DB.generation` | `model.js` | Goes up on every `finalize()`, so caches of derived data (the search index and built previews) start again. |
| `isolate(el)` | `ui.js` | Makes everything outside `el` inert, as a modal does. The download dialog and full-screen previews use it. |
| `announce(msg)` | `render.js` | Says a short status message to screen readers (`toast()` calls it too). |
| `getBuilt()` | `preview.js` | A built artifact preview. The last 4 (per version and board) are kept, so switching tabs does not rebuild them. The cache starts again when `DB.generation` changes. |

## Data flow

```text
 files you pick or drop (zips, folders, loose JSON, or the sample export)
        │
        ▼
 nodesFromFiles()        zip → read the central directory only → one ZipEntry per file
        │                loose file → FileNode
        ▼
 classify(node)          by path: users, conversations, projects, memories, design, manifest,
        │                artifact file, junk, or "sniff" (unknown .json: recognised by shape,
        │                then read with the files of its kind)
        ▼
 ingest, in order        1. users.json                 → people
        │                2. conversations.json          → streamed, one chat at a time
        │                3. projects, memories, design chats, manifests (8 at a time)
        │                4. artifacts: index every file, read only artifact.json,
        │                   comments.json and artifact_comments.json (16 at a time)
        ▼
 finalize()              link every item to a Person, reverse links, display names,
        │                name clashes, sorting, derived values (comment counts, project memory)
        ▼
 showApp() → router → views   pages are drawn from DB on demand
```

### Gathering input

- **Drag and drop** walks dropped folders with `webkitGetAsEntry`. Files are read in parallel but kept in folder order, so the same drop always gives the same result. In Chrome and Edge it also asks for persistent file handles (`getAsFileSystemHandle`).
- **Choose files / Choose a folder** use the File System Access API when it exists (`showOpenFilePicker`, `showDirectoryPicker`) and fall back to `<input type="file">`.
- File handles are stored in IndexedDB (`HandleStore`), so **Reopen last export** can open the same files after a reload. Only handles are stored, never content. The saved folders are listed one level at a time and their files opened, 16 at a time (`filesFromHandles()`), and the files keep folder order, as with a drop.
- Dropping files on an open export asks first, then adds them to the same model. That is how several exports are merged.

### Loading screen

`importExport()` reports progress through a small `ui.set(key, label, fraction, value, state)` interface (the `Loader` in `app.js`). Files that cannot be read become warnings. If there are warnings, the loading screen lists them and offers **Continue anyway** instead of hiding the problem. If only a manifest was loaded, the page shows its download links and waits for the zips. If nothing could be read, the load fails and leaves `DB` empty, so a failed attempt never shows up on the About page. The message is the first problem when files failed (for example a browser that cannot unpack zips), or says that the files hold no export data.

### The model

`DB` holds arrays and id maps for conversations, projects, design chats, memories and artifacts, plus `people`, `manifests`, `sources`, `warnings` and `ignored` files. During an import, the `add…()` functions write only the id maps. `finalize()` builds the sorted arrays from them.

Each record keeps the fields the views need, plus `raw` (the original JSON) and `source` (where it came from). Large content is **not** copied into the model: artifact files stay as file nodes (`ZipEntry` or `FileNode`) and are read when they are opened.

When the same item is loaded twice (two exports), the `add…()` functions keep the newer copy (see [export-format.md, section 12](export-format.md#12-older-export-formats)). For an artifact, the files a newer export can change (`artifact.json`, the comment files and `page.md`) are grouped per artifact folder and container. The group with the newest `artifact.json` gives all of them; version files are merged by path.

`finalize()` rebuilds every link from scratch (`Person.resetLinks()`), so loading more files later never counts anything twice. It:

- attaches each item to a `Person` (creating placeholder people for unknown ids, and a "No owner" person for items without one)
- attributes thread comments and page comments, and stores each artifact's comment count (`commentCount`) and its threads without the repeated doc comments (`threadView`)
- builds the reverse "mentioned in conversations" links for artifacts, and each project's memory (`memoryRefs`: summaries and `/projects/<id>/` memory files)
- picks display names and adds the email local part when two people share a name
- sorts everything newest first, and puts the conversation, project, design chat and memory maps in the same order, so a later load starts from it

These values change only when files are loaded, so the views read them instead of working them out on every draw. Fields read from the export are never overwritten with a display fallback: a title like "Untitled page" is worked out when it is shown (`artifactTitle()`), because the file that decides it can come in a later load. `Person` has one definition of each count (`convCount()`, `memoryCount()`, `total()`), so every card, tile, tab and badge shows the same number. Chats that the export left empty are listed but never counted as conversations; `withContent()` is the one rule for that.

## ZIP reader

`src/zip.js` reads zips **lazily**, so multi-gigabyte artifact zips cost almost nothing until you open something:

1. Read the last 64 KB of the file and search backwards for the end-of-central-directory record.
2. If a ZIP64 locator sits in front of it, read the ZIP64 record for the real counts and offsets.
3. Read the central directory in one slice and create a `ZipEntry` (name, method, sizes, offset) per file. ZIP64 extra fields are honoured. Directory entries are skipped.
4. Nothing else is read. When an entry is needed, `ZipEntry` reads its 30-byte local header to find where the data starts, slices exactly the compressed bytes with `Blob.slice()`, and, for DEFLATE, pipes them through the browser's native `DecompressionStream('deflate-raw')`.

A browser without `'deflate-raw'` (before Chrome and Edge 103, Firefox 113 and Safari 16.4) cannot open a zip with DEFLATE entries: `ZipArchive.open()` then fails at once with a message that names the browsers and suggests the unzipped folder (`canInflate()`). STORED zips, such as the sample data, still open.

Entries are available as a stream (`stream()`), bytes, text or a `Blob`. Only STORED (0) and DEFLATE (8) are supported.

`ZipWriter` builds the per-person download and multi-file version downloads. It writes STORED entries with CRC-32 and UTF-8 names, makes repeated names unique (`a.md`, `a (2).md`), and refuses archives over 4 GB or 65,535 files.

## Streaming JSON parser

`conversations.json` can be larger than the biggest string a browser can hold (about 512 MB in Chrome), so it is never decoded as one string. The files of people, projects, memories and design chats are read the same way (`readEach()` in `src/ingest.js`), because an old-format `projects.json` or `memories.json` holds every record in one list. `parseJsonArrayStream()` in `src/load.js`:

- reads the file as a stream of byte chunks
- scans the **bytes** for JSON structure (`[`, `]`, `{`, `}`, `,`, `"`, `\`). All of these are ASCII, so bytes of multi-byte UTF-8 characters can never be mistaken for them.
- tracks nesting depth, strings and escapes, and collects the bytes of each top-level array element (an element can span many chunks)
- decodes and `JSON.parse`s one element at a time, and hands it to `addConversation()` together with its raw text (used to find artifact links cheaply)
- jumps between quotes and backslashes with `indexOf` inside strings, which keeps the scan linear and fast on long text
- falls back to parsing the whole document when the top level is not an array, and throws a clear error when the array is never closed (a cut-off file)

Progress is reported in bytes, so the loading bar moves smoothly.

## Rendering and sanitizing

Views are plain functions that return HTML strings built with template literals. The router puts the string into `#main`. Behaviour is bound where the markup is made: `<button ${on(() => copyText(p.id))}>` keeps the function for the current view and writes only a short key (`data-on`) into the markup. One delegated `click` listener and one `change` listener on `document` call it. Parts that need wiring after insertion (tables, filters, the conversation thread) use `after(fn)` hooks. If drawing a page fails, `renderRoute()` drops the hooks it queued, so a hook can count on its markup being in the page.

Everything that belongs to one drawn page lives in `VIEW` (`src/ui.js`): its `after()` hooks, the functions behind its `on()` keys and lazy blocks (`viewKey()`), and an `AbortController`. Keys come from one counter for the whole session, so an element left over from an old page can never call a function of the new one. A part that is drawn again in place (the conversation thread, after a branch switch or an option change) first drops the keys of its old content with `dropKeys()`, and a lazy block's key is dropped once its body is drawn. When the route changes, `onRoute()` aborts the old view and starts a new one. Listeners added with the view's `signal` are removed, and async drawers (artifact versions, docs, search) check `signal.aborted` after each `await`, so a slow draw never writes into a newer page.

Rules that keep this safe:

- **Every value** from the export goes through `esc()` before it enters a template.
- **Markdown** goes through `mdToHtml()`:
  1. marked (GitHub-flavoured) turns it into HTML
  2. DOMPurify cleans it. On top of the defaults, it forbids the tags `style`, `form`, `input`, `button`, `textarea`, `select`, `video`, `audio`, `source`, `track`, `picture`, `image`, `object`, `embed`, `iframe`, `link` and `meta`, the attributes `style`, `srcset` and `ping`, and all `data-` attributes. A hook (`uponSanitizeAttribute`) also drops every attribute that would load a URL as soon as the element exists (`src`, `poster`, `background`, `action`, `href` on anything but a link, …), unless the URL is `data:`, `blob:` or `#…`. Only an `<img>` keeps its `src`, for the next step.
  3. `finishMarkdown()` makes external links open in a new tab with `noopener noreferrer`, turns remote `<img>` tags into plain links, adds `dir="auto"` to text blocks (for right-to-left languages) and adds copy buttons to code blocks.
- **Human messages** are shown as escaped plain text with clickable `http(s)` links (`plainTextHtml()`), not as Markdown, like on claude.ai.
- **Links** from export data are only clickable for `http:`, `https:` and `mailto:` (`safeUrl()`).

Size limits keep the tab responsive:

- Markdown longer than 400,000 characters is shown as plain text.
- `preHtml()` shows the first 60,000 characters of long text with a **Show all** button. The button keeps the full text, so it is not put into the page twice.
- Search highlighting walks text nodes only (`highlightIn()`), so it never breaks markup.

## Lazy rendering

- **Collapsed blocks** (tool calls, thinking, attachments, docs, memory files) are made with `blk({ summary }, render)`. The block starts with only its `body` (usually empty), and `render` is kept in the current view under a key (`data-lazy`). A capturing `toggle` listener draws the body the first time the block is opened. A block that starts open (`open: true`) draws its body right away. A page opened from a search result (a conversation or design chat) puts the search words in `VIEW.terms`, and the listener marks them in each body it draws. The listener itself never reads the URL.
- **Long conversations** are drawn in batches: the first 30 messages (or enough to reach a linked message) at once, then 25 more every few milliseconds. A sequence number (`threadSeq`) stops an old batch run when the thread is redrawn (for example after a branch switch).
- **Tables** show 200 rows at a time with a **Show more** button.
- **Artifact metadata** is read at load time, but version files are read only when a version is opened.

## Sandboxed previews

Anything from the export that is meant to run, such as HTML artifacts, widgets, Slides, Design boards and HTML project files, is shown in an `<iframe>` with `srcdoc` and

```html
sandbox="allow-scripts allow-popups allow-forms allow-modals"
```

(the artifact viewer also allows downloads). There is **never** `allow-same-origin`, so the frame runs in an opaque origin and cannot touch the reader.

How a preview is built:

- **Frame HTML.** `sandboxFrame()` (widgets, HTML files and docs in chats and projects) writes the HTML into the escaped `srcdoc` attribute, so the frame loads when its block is put into the page. The artifact viewer and the new-tab view set the `srcdoc` property instead: their HTML can hold up to 120 MB of inlined files, and an escaped copy in a markup string would double that.
- **Frame shim.** A `srcdoc` frame inherits the reader's URL as its base, so a `#section` link inside an artifact would load the reader itself. `withFrameShim()` adds a tiny script right after `<head>` (never before the doctype, which would switch the page to quirks mode) that makes such links scroll inside the frame.
- **Single-file versions** are used as they are, plus the shim.
- **Multi-file versions** (`inlineRefs()` in `src/preview.js`): a sandboxed `srcdoc` frame cannot load files from the reader, so files that `index.html` refers to with literal `src`, `href`, `poster`, `url(…)` or `fetch(…)` paths are replaced by `data:` URLs. `url()` references inside stylesheets are resolved relative to the stylesheet. Limits: 120 MB of inlined data per preview, and large video or audio files stay out (they can be opened from the Files tab).
- **Lookup script.** Some apps build file paths in JavaScript (`'icons/' + name + '.png'`). `assetLookup()` collects the remaining files (up to 4 MB per file and 30 MB in total), and `assetLookupScript()` adds them as a small map and patches `fetch`, `XMLHttpRequest` and `src` / `href` / `poster` attributes (through a `MutationObserver`) to serve them from it. Platform files (`isPlumbing()`), Markdown, other boards and media stay out.
- **Encoded once.** One build encodes each file at most once (`newEncoding()`), so an image that every slide uses is read and turned into base64 only once.
- **Slides** (`buildSlides()`): the typed app's runtime needs claude.ai, so the reader draws the deck itself. It reads `deck.json`, places each slide fragment on a 1920 × 1080 stage scaled to fit, adds section titles and the deck's fonts, and moves speaker notes (`<aside>`) below each slide. Slides only inline what they refer to; they get no lookup script.
- **Design** (`buildDesign()`): shows one board at a time, chosen by the board picker, the canvas `launch` file, or the first board with real content. `./support.js` is replaced by an empty script. Links between boards send a `postMessage({ cerBoard })` to the reader, which accepts it only from the open preview frame and switches the board.
- **Widgets** get a stand-in stylesheet (`WIDGET_CSS`) with the CSS variables and class names that claude.ai normally provides, so their SVGs do not render solid black.
- **Notices.** `platformNotes()` warns when a version uses claude.ai-only resources (`/_blob/`, `/_runtime/`, `/_f/`, `/_cas/`, `window.claude`).
- **Cache.** Built previews are kept in a small cache (4 entries), so switching between Preview, Source and Files does not rebuild them. Files added later can complete a version (one version can be split across two zips), so the cache starts again when `DB.generation` changes.
- **New tab.** "Open in new tab" opens an empty window first (inside the click, so pop-up blockers allow it), then puts a sandboxed iframe with the preview into it.

## Routing

The app uses hash routes, so it works from `file://` and a reload keeps your place (after you load the files again).

| Route | Page |
|---|---|
| `#/` | start page |
| `#/people` | people list |
| `#/person/<id>[/<tab>]` | person page; tabs: `conversations`, `artifacts`, `projects`, `design`, `memory`, `comments` |
| `#/conversations` | conversation list |
| `#/c/<id>?q=…&m=<message id>` | conversation; `q` highlights words, `m` scrolls to a message and opens its branch |
| `#/artifacts` | artifact list |
| `#/a/<id>[/<version id>]?view=…&board=…&tab=…` | artifact; `view` is `preview`, `source` or `files` |
| `#/projects`, `#/p/<id>` | projects |
| `#/design`, `#/d/<id>` | design chats |
| `#/memories`, `#/memory/<person id>?f=<memory file>` | memory |
| `#/search?q=…&t=<type>&deep=1` | search |
| `#/about` | about this export |

`navigate()` uses `history.pushState` / `replaceState` and draws the page. `onRoute()` ends the old view, draws the new one, moves the focus (see [Accessibility](#accessibility)), runs its `after()` hooks and redraws the sidebar, which also sets the tab's title to the active section. Because a link click fires both `popstate` and `hashchange`, the app draws only when the hash really changed.

**Focus mode** keeps the focused person's id in `App.focus` (and in `sessionStorage` for this tab). Only `writeFocus()` changes it, and it keeps both copies the same: `setFocus()` uses it when you pick a person, and `showApp()` after each load (which keeps the focus if that person is still loaded, or, after a reload, takes the one saved for this tab). Lists, sidebar counts and search read `focusScope()`: the focused person's records, which `finalize()` linked to them, or everyone's (`scopeOf()`).

## Accessibility

The aim is WCAG 2.2 level AA. The rules the code follows:

- **Focus after a route change.** `focusPage()` (`app.js`) moves the focus to the new page's `h1`, so a screen reader reads it and Tab goes on from the top of the page. A change in place (`navigate(hash, true)`: a view tab, a version, a doc tab, a board, deep search) puts the focus back on the control with the same `id` instead (`VIEW.refocus`, `refocus()`). Async drawers call `refocus()` again once their controls are in the page. Parts that are drawn again without a route change (the thread after a branch switch, a table after a sort or **Show more**) move the focus themselves.
- **Modal parts.** The download dialog and a full-screen preview make the rest of the page inert with `isolate()`, close on Escape and give the focus back to the button that opened them.
- **Names and states.** Every icon-only button has an `aria-label`. A control that shows which item is shown gets `aria-current`; a toggle gets `aria-pressed`. Decorative icons are `aria-hidden`.
- **Status messages** go to one polite live region (`#sr-status`) through `announce()`. Counts that change while someone types (`.count-note`) are live regions themselves.
- **Colours** come from the theme tokens in `styles.css`. Text tokens reach 4.5:1 and `--border-strong` (control borders) 3:1 on every surface they are used on, in both themes. Links in text are underlined.
- **Motion.** The system setting for less motion turns off animations and smooth scrolling (`scrollMotion()`).
- **Scrolling.** Long `<pre>` blocks from `preHtml()` take Tab, so a keyboard can scroll them sideways.

`scripts/a11y.mjs` (`npm run a11y`) checks these rules on the sample data: axe-core on every kind of page in both themes and at phone width, and the focus behaviour with real key presses.

## Search

`runSearch()` in `src/search.js` matches every search term (words, or phrases in quotes) case-insensitively, in the records of one scope (`scopeOf()`). People are always searched in full.

- The search index (`searchEntry()`) keeps the lower-cased text of each item, built the first time it is searched, so later searches are fast. Adding files to an open export can change records in place, so `finalize()` raises `DB.generation` and the index starts again.
- The result has one list of hits per kind (`res[k.key]` for each entry of `KINDS`, plus `res.people`). Every hit is `{ item, … }` and carries the text its snippet needs, so the search page never reads the index. The page draws each hit with its kind's `searchResult()`.
- Normal search covers titles, summaries, message text and file names. **Deep search** adds tool inputs and results, thinking, attachment text and artifact content (the visible text of each artifact's current version, read from the zip once and capped at 2 MB).
- The conversation loop yields to the browser every 40 conversations and reports progress. Leaving the page aborts the view's signal, which stops the search at its next pause.
- A result links to the matching message (switching to its branch if needed) with the words highlighted.

## Per-person download

`buildPersonZip()` (in `src/export.js`) writes one zip with a README, `person.json`, every conversation as Markdown and JSON, projects with their docs, design chats, memory, comments, and artifact files (only the current version unless you tick "every version"). Folder and file names are `<date> <title> (<short id>)`, cleaned so they work on every file system. Paths of project docs and memory files are cleaned too, so they cannot escape their folder. Artifact files keep their path from the export (`versions/<vid>/…`).

## Performance choices, in short

- Read zip indexes, not zips. Inflate single entries on demand with native `DecompressionStream`.
- Stream-parse the big JSON file; never build one giant string.
- Read many small files in parallel with a concurrency limit (`mapLimit`).
- Keep big content as file nodes, not strings, until it is shown.
- Render lazily: collapsed blocks, message batches, paged tables.
- Cache built previews and search text, and encode each preview file only once per build; cap everything that could grow without limit.
- Work out values that only change on load (comment counts, project memory) once, in `finalize()`.

## Testing hook

`app.js` exposes `window.ExportReader = { load(files), DB() }` for scripted use. The tests in `test/` do not use a browser: `test/harness.mjs` runs the same scripts in a Node `vm` context with small stubs, and tests the zip reader, the parser and the import pipeline directly.

The tests cannot check the HTML the views draw. For that, `scripts/snapshot.mjs` opens the built page with the sample data in headless Chrome. It visits every page (also with focus on one person), opens every collapsed block, and saves the HTML of the main area and the sidebar, and the `srcdoc` of every preview frame. Attributes that only carry click data (`data-on` and lazy keys, other `data-*` values) are left out, so a refactor that keeps the pages the same gives the same files. `scripts/lib/chrome.mjs` is the small DevTools-protocol driver it shares with `scripts/screenshots.mjs` and `scripts/a11y.mjs`.
