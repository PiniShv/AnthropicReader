# Changelog

All notable changes to this project are written down in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Each GitHub release has the reader (`claude-export-reader.html`) and a `.sha256` file to check the download. A release workflow publishes them when a version tag is pushed, but only after the tests and the build check pass and the tag matches `package.json`.
- CodeQL code scanning of the JavaScript (not the vendored libraries or `dist/`), on every push to `main`, on every pull request and once a week.

### Changed

- Accessibility to WCAG 2.2 level AA, checked with axe-core on the sample data in light and dark mode:
  - Text and control borders have enough contrast in both themes, links in text are underlined, and the primary buttons in dark mode use dark text.
  - Everything works from the keyboard: sortable column headers, artifact versions, the conversation options (now toggle buttons), the person picker (a combobox), and rows of the start page's latest conversations.
  - A skip link leads to the content. After a page change the focus goes to the new page's heading, and the tab title names the section. After a change in place (a tab, a version, a branch, a sort) the focus stays on the control.
  - The download dialog and full-screen previews keep the focus inside until Escape, and then give it back. Escape also closes the person picker and the menu on phones.
  - Icon-only buttons have names, status messages ("Copied", the number of results) are read out by screen readers, and the system setting for less motion turns off animations and smooth scrolling.
- The shortcut to the search box is now `Ctrl+K` (`⌘K` on a Mac) instead of `/`. A one-key shortcut can fire by accident for people who use speech input.
- CI tests on Node 20, 22 and 24, with the current major versions of `actions/checkout` and `actions/setup-node` (they run on Node 24, not the deprecated Node 20 runtime).
- In Chrome and Edge, **Choose a folder…** and **Reopen last export** open the files of a big folder 16 at a time instead of one by one, so loading starts sooner. The files are still read in the same order, so the result does not change.

### Security

- DOMPurify, the library that cleans HTML from the export before it is shown, is updated from 3.2.6 to 3.4.16. This brings the fixes for the 20 security advisories published against 3.2.6. Most of them need options or modes the reader does not use, but the sanitizer should never lag behind.

## [1.0.0] - 2026-10-05

The first public release.

### Added

- One self-contained HTML file (`dist/claude-export-reader.html`) that reads a Claude team data export inside the browser. It works offline and uploads nothing.
- Loading by drag and drop, file picker or folder picker. Zips, unzipped folders and loose JSON files all work. Big zips are not read into memory: only their index is read, and each file is unpacked when it is needed.
- Large `conversations.json` files are parsed as a stream, one chat at a time.
- **People:** a person finder on the start page and a page per person with tabs for conversations, artifacts and pages, projects, design chats, memory and comments. People who are no longer in `users.json` still appear. Phone numbers are hidden until you click "show".
- **Focus mode:** limit every list, count and search to one person.
- **Conversations:** branches for edited and regenerated messages, tool calls with input and result, thinking blocks and summaries, web citations, uploaded text files, widgets, drafts, question forms, charts and place lists, and a list of everything Claude produced in the chat. Copy as Markdown, download as `.md` or `.json`, print, and copy a link to one message.
- **Artifacts:** every saved version, shown in a sandboxed preview. Supports single-file and multi-file HTML, Slides decks (with speaker notes), Design canvases (one board at a time) and Claude Docs pages (with tabs and comment threads). Preview, source and file views, open in a new tab, full screen and download.
- **Projects:** instructions, knowledge files and related memory.
- **Design chats:** Claude Design chats with tool calls, attachments, question forms and answers, and file changes per turn.
- **Memory:** memory files by folder, the chat memory summary and project memories, with working `[[links]]`.
- **Search** across everything, with exact phrases in quotes and an optional deep search inside tool calls, thinking, attached files and artifact content.
- **Download one person's data** as a single `.zip`.
- **Manifest support:** shows the export date, says which parts are missing and offers their download links.
- Support for older export formats (`projects.json`, `memories.json`, chats without branches) and for loading several exports together (the newer copy of an item wins).
- "Reopen last export" in Chrome and Edge.
- "Try it with sample data": a small, made-up export to explore the reader without real data.
- Dark mode, right-to-left text and a layout for phones and tablets.
- Build script, tests and CI (Node 20 and 22). No npm dependencies; marked and DOMPurify are vendored.

[Unreleased]: https://github.com/PiniShv/AnthropicReader/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/PiniShv/AnthropicReader/releases/tag/v1.0.0
