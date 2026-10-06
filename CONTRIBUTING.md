# Contributing

Thank you for helping. Bug reports, ideas, docs fixes and pull requests are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before anything else: never share real export data

A Claude export holds other people's names, emails, phone numbers and private conversations. **Never attach real export files, screenshots, logs or snippets with real data to an issue or a pull request**, not even "just one line".

Instead:

- use the sample export: click **Try it with sample data** in the reader, or run `npm run demo` to get it as zip files
- or write a small, made-up example that has the same shape as the real data (invent names, ids and text)

If you found a problem that you can only show with real data, describe the shape of the data (which keys, which types, which file) in words. Do not paste the data.

Security problems go through a private report, not a public issue. See [SECURITY.md](SECURITY.md).

## Set up

You need **Node.js 20 or newer** and Git. There are no npm dependencies, so there is nothing to install.

```bash
git clone https://github.com/PiniShv/AnthropicReader.git
```

```bash
cd AnthropicReader
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/claude-export-reader.html` from `src/` and `vendor/`. |
| `npm run build:check` | Fails if `dist/claude-export-reader.html` does not match the sources. CI runs this. |
| `npm test` | Runs the tests in `test/` with Node's built-in test runner. |
| `node scripts/check-vendor.mjs` | Checks that the files in `vendor/` are the official npm builds named in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and lists known security advisories and newer releases. Needs the network, so CI does not run it. |
| `npm run demo` | Writes the made-up sample export (six zip parts and a manifest) to `demo/`, for trying the reader on real files. `npm run demo -- <folder>` writes them somewhere else. |
| `npm run a11y` | Checks accessibility (WCAG 2.2 AA) with axe-core and a few keyboard checks, on the sample data in headless Chrome. Needs the network the first time. See [Checking accessibility](#checking-accessibility). |
| `npm run snapshot -- --out <folder>` | Saves the HTML of every page of the sample data, with every block opened, using headless Chrome (Node 22+; set `CHROME=<path>` if Chrome is not found). Run it before a refactor. After it, `npm run snapshot -- --compare <folder>` fails if any page changed. |

To try your change, run `npm run build` and open `dist/claude-export-reader.html` in a browser. Load the sample data, and test with your own export if you have one (keep it on your computer).

## How the code is organised

Read [docs/architecture.md](docs/architecture.md) for the full picture. In short:

- `src/*.js` are **classic browser scripts, not modules**. The build puts them into one page in a fixed order (see `APP_SCRIPTS` in `scripts/build.mjs`). They share one global scope, so a file can use functions from the files before it.
- `src/ingest.js` reads the export into memory, into the model in `src/model.js`. The `views*.js` files draw pages from that model.
- `vendor/` holds marked and DOMPurify, unchanged. Do not edit these files; to update one, see [Updating a vendored library](#updating-a-vendored-library).
- `dist/` holds the built file. It is committed, so people can download it straight from GitHub.

## Coding style

- 2-space indent, single quotes, semicolons, `'use strict'` at the top of each `src` file. The [`.editorconfig`](.editorconfig) file sets the basics for most editors.
- No build-time tools, no transpiler and no npm dependencies. Write JavaScript that recent browsers run as is.
- Keep comments short and explain **why**, not what.
- Use plain English (about CEFR B1) for everything people read: UI text, docs, comments and commit messages. Short sentences, common words, active voice. Technical terms are fine; explain them once.
- Keep it offline. The reader must not make network requests of its own: no CDN, no web fonts, no analytics.
- Treat everything in an export as untrusted:
  - put text into HTML only through `esc()`
  - render Markdown only through `mdToHtml()` / `mdBlock()`, which sanitize with DOMPurify
  - show HTML from the export only in a sandboxed iframe (`sandboxFrame()`), never with `allow-same-origin`
  - make links from export data clickable only through `safeUrl()`
- Keep big exports fast. Do not read large files up front. Render big blocks lazily (`blk()` with a render function), and cut very long text with `preHtml()`.
- Use `dir="auto"` on blocks of user text, so right-to-left languages display correctly.
- Keep it accessible (WCAG 2.2 AA): every control is a real `<button>`, link or form field, so it works from the keyboard. Give icon-only buttons an `aria-label`, take colours from the theme tokens in `styles.css`, and keep the focus in place when you draw a part of the page again. See [Accessibility](docs/architecture.md#accessibility).

## Checking accessibility

The reader aims at WCAG 2.2 level AA. After a UI change, run:

```bash
npm run build && npm run a11y
```

`scripts/a11y.mjs` opens the built reader with the sample data in headless Chrome (Node 22+; set `CHROME=<path>` or pass `--chrome <path>` if Chrome is not found). It checks:

- **axe-core** on about 30 pages and states (every kind of page, every person tab, blocks opened, search results, the person picker, the download dialog, full screen, the phone menu), in light and dark mode, at desktop and phone width. The rules are WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices. The content of preview frames is the artifact's own HTML, so it is left out.
- **The keyboard**: the skip link, the focus after a page change and after a change in place, the person picker, the download dialog and full screen (the focus stays inside and comes back), a focus ring on every Tab stop, and the setting for less motion.

It prints each problem with the element it found and exits with code 1. A clean run takes about a minute and a half.

axe-core is not a dependency and is not in the repository. The first run downloads the pinned version from jsDelivr into your temp folder and checks its SHA-256 before it runs it. Offline, download `axe.min.js` of that version yourself and pass `--axe <file>`. To move to a newer axe-core, change `AXE_VERSION` and `AXE_SHA256` at the top of the script, and fix what the new rules find.

Automated checks find only part of the problems. For a bigger UI change, also try the page with the keyboard alone and with a screen reader (VoiceOver on a Mac, NVDA on Windows).

## Adding support for a new export field

Claude exports change over time. When you find a field the reader does not show yet:

1. **Describe it with made-up data.** Write down which file it is in, its key, its type, and a small invented example.
2. **Read it into the model** (`src/ingest.js`). Each record type has an `add…()` function (`addConversation`, `addProject`, `addMemory`, `addDesignChat`, `artifactMeta`, `addUser`, `addManifest`). Every record keeps its original JSON in `raw`, so a view can often read a new field without any model change. A new kind of **file** needs a rule in `classify()` (by path) and maybe in `sniffShape()` (by shape, for files with unexpected names). A new kind of small JSON file also needs an entry in `SMALL_INGEST`, which says how to add one record (a file can hold one record or a list).
3. **Show it.** Conversation blocks and tools are drawn in `src/views-conv.js` (`assistantBody`, `toolCallHtml`, `toolInputHtml`, `toolResultHtml`). A tool that gets its own card (a file, a widget, a question form) needs one entry in `TOOL_CARDS`; if the person saw its output, also add it to `OUTPUTS` (`src/ingest.js`), so the list badge counts it, and give it a `chip` for the "What Claude produced here" box. Design chats are in `src/views-design.js` (`designMessageHtml`, `designToolHtml`, `designAttachments`). Artifacts are in `src/views-art.js`, and their previews are built in `src/preview.js`. Unknown blocks already fall back to a collapsed JSON view, so nothing is lost while you work. A whole new kind of record also needs an entry in `KINDS` (`src/views.js`), with every field filled in. It gives the kind its routes, its sidebar link, its person tab, its search tab and the look of its search results (`searchResult`). The search tab stays empty until `runSearch()` finds the new records (step 4).
4. **Make it searchable** if it holds text people will look for (`msgProse` / `msgDeep` and `runSearch` in `src/search.js`). For a new kind, `runSearch()` puts its hits (`{ item, … }`) in the list under the kind's key.
5. **Include it in the per-person download** if it belongs to a person (`buildPersonZip` in `src/export.js`).
6. **Add it to the sample data**, with invented content, so others can see it: conversations in `src/demo-chats.js`, projects, memory and design chats in `src/demo-records.js`, artifacts in `src/demo-artifacts.js` (shared helpers and packaging are in `src/demo.js`).
7. **Add a test** in `test/`. `test/harness.mjs` loads the browser scripts into a Node `vm` context (there is no real DOM), so test the model and parsing, not the drawing.
8. **Document it** in [docs/export-format.md](docs/export-format.md), again with invented examples only.

Be defensive: export fields are often missing, `null`, empty, or of a different type than usual. Older exports must keep working.

## Updating a vendored library

`vendor/` holds marked and DOMPurify as their **official minified builds from npm, unchanged**. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists, for each file, its version, the npm file it comes from and its SHA-256 checksum. `npm test` fails if a file, its checksum and its version do not agree, so every update follows these steps.

Update a library when it has a security fix, and keep DOMPurify current: it is the sanitizer. Stay on the same major version unless you have a reason, because a new major version can change the output.

1. **Look for advisories and new releases** (needs the network):

   ```bash
   node scripts/check-vendor.mjs
   ```

2. **Save a snapshot of the pages before the change** (Node 22+ and Chrome):

   ```bash
   npm run build && npm run snapshot -- --out ../snapshot-before
   ```

3. **Download the official file** of the new version. jsDelivr serves the files of the npm package, so the URL is `https://cdn.jsdelivr.net/npm/<package>@<version>/<path>`, with the path from the table in the notices. For example:

   ```bash
   curl -fsSL -o vendor/purify.min.js https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js
   ```

   Never edit, re-minify or reformat the file.

4. **Update THIRD_PARTY_NOTICES.md:** the Version column, the npm file (for example `dompurify@3.4.16/dist/purify.min.js`), the line in the **Checksums** block, and the library's section (heading, source and license links, and the license text if it changed). Get the new checksum with `shasum -a 256 vendor/<file>` (or `sha256sum` on Linux).

5. **Check that it is the official file.** Run `node scripts/check-vendor.mjs` again. It downloads the package from the npm registry, checks it against the registry's `integrity` value, and compares it byte for byte with your file and with the checksum in the notices. No line may say `FAIL`.

6. **Find other mentions of the old version** and update them (older CHANGELOG entries stay as they are):

   ```bash
   git grep -nF "<old version>" -- . ":!vendor" ":!dist"
   ```

7. **Build, test and compare the pages:**

   ```bash
   npm run build && npm test && npm run snapshot -- --compare ../snapshot-before
   ```

   The sample data does not try to break the sanitizer. So also open the old and the new build in a browser and, in the console, compare what `mdToHtml()` returns for some hostile input (event handlers, `javascript:` links, remote images, `<iframe>`, `<svg>`). In the pull request, explain every page and every output that changed. A sanitizer update must never let more through without a reason.

8. **Write it down.** Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) (under **Security** for a security fix). Commit `vendor/`, `dist/`, THIRD_PARTY_NOTICES.md and CHANGELOG.md together.

## Pull requests

Keep each pull request about one thing. A small, focused change is reviewed faster.

Checklist:

- [ ] `npm test` passes.
- [ ] `npm run build` was run, and the updated `dist/claude-export-reader.html` is committed. (`npm run build:check` passes.)
- [ ] No real export data anywhere: not in code, tests, fixtures, screenshots or the description.
- [ ] Tried in a browser with the sample data. For UI changes, also checked dark mode, a narrow (phone-sized) window and the keyboard alone (Tab, Enter, Space, Escape).
- [ ] No new network requests and no new dependencies.
- [ ] Docs updated if behaviour or the format changed (README, `docs/`).
- [ ] A line added under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for changes users will notice.

## Releasing

The maintainer makes releases from `main`. A release is a version tag; a workflow does the rest.

1. Choose the new version ([Semantic Versioning](https://semver.org/)) and set it in `package.json`.
2. In [CHANGELOG.md](CHANGELOG.md), turn the **Unreleased** notes into a `## [x.y.z] - YYYY-MM-DD` section, put an empty `## [Unreleased]` heading above it, and update the links at the bottom of the file.
3. Run `npm run build` (the page shows the version, so `dist/` changes) and `npm test`, commit, and push `main`. The release workflow publishes only commits that are already on `main`.
4. Tag that commit and push the tag:

```bash
git tag -a vx.y.z -m vx.y.z
```

```bash
git push origin vx.y.z
```

The [release workflow](.github/workflows/release.yml) then checks that the tag is on `main` and matches the version in `package.json`, runs `npm test` and `npm run build:check`, signs a build provenance attestation for the page, and creates the GitHub release. The release has `claude-export-reader.html`, a `claude-export-reader.html.sha256` checksum file, and the CHANGELOG section as its notes. If a check fails, nothing is published: fix the problem, delete the tag (`git push origin :vx.y.z` and `git tag -d vx.y.z`) and tag again. A version with a hyphen, such as `1.1.0-rc.1`, becomes a pre-release, so it never replaces the latest release.

## Reporting bugs and asking for features

Use the issue forms on GitHub. For bugs, say which browser and version you use, which export parts you loaded, and what you expected. Remember: describe your data, do not attach it.
