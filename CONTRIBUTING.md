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
| `npm run demo` | Writes the made-up sample export (six zip parts and a manifest) to `demo/`, for trying the reader on real files. `npm run demo -- <folder>` writes them somewhere else. |
| `npm run snapshot -- --out <folder>` | Saves the HTML of every page of the sample data, with every block opened, using headless Chrome (Node 22+; set `CHROME=<path>` if Chrome is not found). Run it before a refactor. After it, `npm run snapshot -- --compare <folder>` fails if any page changed. |

To try your change, run `npm run build` and open `dist/claude-export-reader.html` in a browser. Load the sample data, and test with your own export if you have one (keep it on your computer).

## How the code is organised

Read [docs/architecture.md](docs/architecture.md) for the full picture. In short:

- `src/*.js` are **classic browser scripts, not modules**. The build puts them into one page in a fixed order (see `APP_SCRIPTS` in `scripts/build.mjs`). They share one global scope, so a file can use functions from the files before it.
- `src/model.js` reads the export into memory. The `views*.js` files draw pages from that model.
- `vendor/` holds marked and DOMPurify, unchanged. Do not edit these files.
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

## Adding support for a new export field

Claude exports change over time. When you find a field the reader does not show yet:

1. **Describe it with made-up data.** Write down which file it is in, its key, its type, and a small invented example.
2. **Read it in the model** (`src/model.js`). Each record type has an `add…()` function (`addConversation`, `addProject`, `addMemory`, `addDesignChat`, `artifactMeta`, `addUsers`, `addManifest`). Every record keeps its original JSON in `raw`, so a view can often read a new field without any model change. A new kind of **file** needs a rule in `classify()` (by path) and maybe in `sniffShape()` (by shape, for files with unexpected names). A new kind of small JSON file also needs an entry in `SMALL_INGEST`, which says how to add one parsed file.
3. **Show it.** Conversation blocks and tools are drawn in `src/views-conv.js` (`assistantBody`, `toolCallHtml`, `specialToolHtml`, `toolInputHtml`, `toolResultHtml`). Design chats are in `src/views-design.js` (`designMessageHtml`, `designToolHtml`, `designAttachments`). Artifacts are in `src/views-art.js`, and their previews are built in `src/preview.js`. Unknown blocks already fall back to a collapsed JSON view, so nothing is lost while you work. A whole new kind of record also needs an entry in `KINDS` (`src/views.js`): it gives the kind its routes, sidebar link, person tab and search tab.
4. **Make it searchable** if it holds text people will look for (`msgProse` / `msgDeep` and `runSearch` in `src/search.js`).
5. **Include it in the per-person download** if it belongs to a person (`buildPersonZip` in `src/export.js`).
6. **Add it to the sample data** in `src/demo.js`, with invented content, so others can see it.
7. **Add a test** in `test/`. `test/harness.mjs` loads the browser scripts into a Node `vm` context (there is no real DOM), so test the model and parsing, not the drawing.
8. **Document it** in [docs/export-format.md](docs/export-format.md), again with invented examples only.

Be defensive: export fields are often missing, `null`, empty, or of a different type than usual. Older exports must keep working.

## Pull requests

Keep each pull request about one thing. A small, focused change is reviewed faster.

Checklist:

- [ ] `npm test` passes.
- [ ] `npm run build` was run, and the updated `dist/claude-export-reader.html` is committed. (`npm run build:check` passes.)
- [ ] No real export data anywhere: not in code, tests, fixtures, screenshots or the description.
- [ ] Tried in a browser with the sample data. For UI changes, also checked dark mode and a narrow (phone-sized) window.
- [ ] No new network requests and no new dependencies.
- [ ] Docs updated if behaviour or the format changed (README, `docs/`).
- [ ] A line added under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for changes users will notice.

## Reporting bugs and asking for features

Use the issue forms on GitHub. For bugs, say which browser and version you use, which export parts you loaded, and what you expected. Remember: describe your data, do not attach it.
