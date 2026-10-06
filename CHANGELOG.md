# Changelog

All notable changes to this project are written down in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-06

The first release.

### Added

- One self-contained HTML file (`claude-export-reader.html`) that reads a Claude team data export inside the browser. It works offline and uploads nothing.
- Loading by drag and drop or the file and folder pickers. Zips, unzipped folders and loose JSON files all work. Big zips are not read into memory: only their index is read, and each file is unpacked when it is needed. `conversations.json` is parsed as a stream, one chat at a time.
- **People:** a person finder on the start page and a page per person with tabs for conversations, artifacts and pages, projects, design chats, memory and comments. People who are no longer in `users.json` still appear. Phone numbers are hidden until you click "show".
- **Focus mode:** limit every list, count and search to one person.
- **Conversations:** branches for edited and regenerated messages, tool calls with input and result, thinking blocks and summaries, web citations, uploaded text files, widgets, drafts, question forms, charts and place lists, and a list of everything Claude produced in the chat. Copy as Markdown, download as `.md` or the original `.json`, print, and copy a link to one message.
- **Artifacts:** every saved version in a sandboxed preview: single-file and multi-file HTML, Slides decks with speaker notes, Design canvases one board at a time, and Claude Docs pages with tabs and comment threads. Preview, source and file views, open in a new tab, full screen and download.
- **Projects** with instructions, knowledge files and related memory. **Design chats** with tool calls, attachments, question forms and answers, and file changes per turn. **Memory** files by folder, the chat memory summary and project memories, with working `[[links]]`.
- **Search** across everything, with exact phrases in quotes and an optional deep search inside tool calls, thinking, attached files and artifact content.
- **Download one person's data** as a single `.zip`, with Windows-safe names.
- **Manifest support:** the export date, which parts are missing, and their download links.
- Older export formats (`projects.json`, `memories.json`, chats without branches), and loading several exports together (the newer copy of an item wins).
- Robust loading: a broken record is skipped and named in a warning, the rest of its file still loads, and a failed load leaves the open export as it was. A tool call or block of an unexpected shape draws as a notice with its data instead of hiding its message.
- "Try it with sample data", or open the page with `?demo`: a small, made-up export to explore the reader.
- Accessibility to WCAG 2.2 level AA in light and dark mode, full keyboard use (`Ctrl+K` / `⌘K` jumps to search), right-to-left text, and a layout for phones and tablets.
- Each GitHub release has the reader, a `.sha256` file and a build provenance attestation, made by a release workflow that publishes only after the tests pass on the tagged commit of `main`.
- For maintainers, with no npm dependencies: unit tests, `npm run snapshot` (the HTML of every page before and after a change), `npm run security` (hostile export text, network cut off), `npm run robustness` (every view field given every wrong type), `npm run a11y` (axe-core and keyboard checks) and `node scripts/check-vendor.mjs` (the vendored marked 18.1.0 and DOMPurify 3.4.16 are the official builds, with no known advisories). Building and testing need Node.js 22 or newer. CI runs them on Node 22 and 24, with SHA-pinned actions, CodeQL and Dependabot.

### Security

If you downloaded `dist/claude-export-reader.html` from `main` before this release (the repository was public from 6 October 2026), replace it with this release. That build:

- kept handles to the files you opened (**Reopen last export**) in Chrome and Edge, where any other HTML file opened from disk could use them to read your export. The feature is gone, and this version deletes the old handles when it starts;
- put saved view settings into the page without checking them, and every file opened from disk can write those settings in Chrome and Edge. Now only the known switches, as true or false, are read;
- let Markdown in the export load files from the internet (SVG `url(…)` attributes), draw a fake dialog with the reader's own styles, and open local paths or network shares through relative links. Markdown now keeps only the tags and attributes it needs, and only web, mail and in-app links stay clickable;
- showed Markdown as unsanitized HTML in a browser where the sanitizer could not run, and put an artifact's title in the browser history through **Open in new tab**;
- used DOMPurify 3.2.6, which has 20 published advisories. This release has 3.4.16.

[Unreleased]: https://github.com/PiniShv/AnthropicReader/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PiniShv/AnthropicReader/releases/tag/v1.0.0
