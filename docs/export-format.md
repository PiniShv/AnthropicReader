# The Claude team export format

This page describes the data export of a Claude **Team** workspace (an organisation export, not a personal one), as Claude Export Reader understands it.

- It is **not official**. Anthropic does not publish a schema. Everything here was learned by reading exports, and the format can change at any time.
- Field lists are "what we have seen", not "what is guaranteed". Treat every field as optional. Values can be `null`, empty, or of an unexpected type.
- **All examples are invented.** The company (Northwind Labs), the people, the ids and the text are made up. The `…` in examples means "more of the same".

Contents:

1. [Delivery: the manifest and the parts](#1-delivery-the-manifest-and-the-parts)
2. [Zip files and paths](#2-zip-files-and-paths)
3. [Timestamps and ids](#3-timestamps-and-ids)
4. [`users.json`](#4-usersjson)
5. [`conversations.json`](#5-conversationsjson)
6. [Projects](#6-projects)
7. [Memories](#7-memories)
8. [Design chats](#8-design-chats)
9. [Artifacts and pages (frames)](#9-artifacts-and-pages-frames)
10. [How records link to people](#10-how-records-link-to-people)
11. [Links between records](#11-links-between-records)
12. [Older export formats](#12-older-export-formats)
13. [Known quirks](#13-known-quirks)

---

## 1. Delivery: the manifest and the parts

An admin asks for an export in the claude.ai settings. The export arrives as an email with download links: one zip file per **part**, plus a **manifest**.

The manifest is a separate JSON file (not inside any zip). Its name looks like this:

```text
manifest-<workspace uuid>-<unix seconds>-<hash>-<YYYY-MM-DD-HH-MM-SS>.json
```

```json
{
  "instructions": "Download each file using the export_url. …",
  "created_at": "2026-09-30T09:00:00.000000+00:00",
  "total_files": 7,
  "data_files": [
    { "batch_index": 0, "export_url": "https://claude.ai/export/<secret>", "category": "light_metadata", "part": 0, "filename": "light_metadata-000.zip" },
    { "batch_index": 1, "export_url": "https://claude.ai/export/<secret>", "category": "conversations",  "part": 0, "filename": "conversations-000.zip" },
    { "batch_index": 4, "export_url": "https://claude.ai/export/<secret>", "category": "frames",         "part": 0, "filename": "frames-000.zip" },
    { "batch_index": 4, "export_url": "https://claude.ai/export/<secret>", "category": "frames",         "part": 1, "filename": "frames-001.zip" }
  ],
  "version": "1.0"
}
```

| Key | Notes |
|---|---|
| `created_at` | When the export was made. The download links expire 24 hours later. |
| `total_files` | Number of parts. |
| `data_files[].category` | `light_metadata`, `conversations`, `projects`, `memories`, `design_chats`, `frames`. An export may lack some categories. |
| `data_files[].part` | Numbers the parts of one category (`frames` often has several). |
| `data_files[].filename` | `<category>-<part as 3 digits>.zip` |
| `data_files[].export_url` | A **secret, single-use** download link. It needs the person's claude.ai sign-in. Never display, log or store it. |

The reader keeps manifest links in memory only. It accepts only `https://claude.ai/export/…` links and never fetches them itself.

## 2. Zip files and paths

| Zip | Paths inside |
|---|---|
| `light_metadata-000.zip` | `users.json` |
| `conversations-000.zip` | `conversations.json` (one JSON array, often hundreds of MB) |
| `projects-000.zip` | `projects/<project uuid>.json` (one object per file) |
| `memories-000.zip` | `memories/<account uuid>.json` (one object per file) |
| `design_chats-000.zip` | `design_chats/<chat uuid>.json` (one object per file) |
| `frames-000.zip`, `frames-001.zip`, … | `artifacts/<artifact uuid>/…` (see [section 9](#9-artifacts-and-pages-frames)) |

Paths inside one artifact folder:

```text
artifacts/<artifact uuid>/artifact.json               metadata, every artifact
artifacts/<artifact uuid>/versions/<vid>.html          a single-file version
artifacts/<artifact uuid>/versions/<vid>.files.json    file list of a multi-file version
artifacts/<artifact uuid>/versions/<vid>/<path>        files of a multi-file version
artifacts/<artifact uuid>/page.md                      Claude Docs pages only
artifacts/<artifact uuid>/comments.json                Claude Docs pages only
artifacts/<artifact uuid>/artifact_comments.json       comment threads (some artifacts)
```

How the reader recognises files (`classify()` in `src/ingest.js`), first match wins:

| Rule | Kind |
|---|---|
| `__MACOSX/`, `.DS_Store`, `._*`, `Thumbs.db` | ignored |
| `…/<uuid>/artifact.json`, `comments.json`, `artifact_comments.json`, `page.md`, `versions/…` | artifact file |
| file name `conversations.json` | conversations |
| file name `users.json` | people |
| file name `projects.json` | projects (older array format) |
| file name `memories.json` | memories (older array format) |
| file name `manifest*.json` | manifest |
| `…/design_chats*/<name>.json` | design chat |
| `…/projects*/<name>.json` | project |
| `…/memories*/<name>.json` | memory |
| any other `.json` under 64 MB | read and recognised by its shape (`sniffShape()`) |

So the zips, the folders your computer makes when it unzips them, and loose JSON files all work.

Zip container facts seen so far:

- Entries are DEFLATE-compressed. There are no directory entries, so folders exist only in paths.
- Entry dates are all 1980-01-01. Use the timestamps inside the JSON instead.
- One artifact can be **split across two frames zips**. Both copies of `artifact.json` are the same, and the later zip holds a superset of the files. Merge by full path.
- The reader still handles STORED entries, ZIP64 and data descriptors, because a bigger export could need them.

## 3. Timestamps and ids

Timestamps are ISO 8601 in UTC, but the exact shape differs per file:

| Shape | Seen in |
|---|---|
| `2026-09-21T14:13:20.123456Z` (6 fraction digits, `Z`) | conversations, messages, content blocks |
| `2026-09-21T14:13:20.123456+00:00` | projects, memories, design chats, the manifest |
| `2026-09-21T14:13:20+00:00` (no fraction) | `artifact.json`, `artifact_comments.json` |
| `2026-09-21T14:13:20.123Z` (3 digits) | `comments.json` |
| `2026-09-21T14:13:20.123456789Z` (up to 9 digits) | design chat `content.timestamp` |

Safari rejects more than 3 fraction digits, so the reader cuts the fraction to 3 digits before parsing.

Ids are lowercase UUIDs (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), except:

- artifact **version ids**: `<10-digit unix seconds>-<4 hex>`, for example `1790000000-a1b2`. The seconds equal the version's `created_at`, so sorting the ids as text sorts them by time.
- tool call ids: `toolu_…` (and `srvtoolu_…` for server-side tools in design chats)
- some design chat message ids: short base-36 strings
- the message tree root: `00000000-0000-4000-8000-000000000000` (see [5.4](#54-branches-edits-and-retries))

## 4. `users.json`

One JSON array. Each item is one account in the workspace:

```json
[
  { "uuid": "aaaaaaaa-0000-4000-8000-000000000001", "full_name": "Avery Okoye",  "email_address": "avery@northwind.example",  "verified_phone_number": "+15550100001" },
  { "uuid": "aaaaaaaa-0000-4000-8000-000000000002", "full_name": null,          "email_address": "jordan@northwind.example", "verified_phone_number": null }
]
```

| Key | Notes |
|---|---|
| `uuid` | The account id. Every other file links to people through this id. |
| `full_name` | Can be `null`, a first name only, all lower case, or even an email address. **Not unique**: two people can have the same name. |
| `email_address` | Unique. The only readable unique key. |
| `verified_phone_number` | Often `null`. Personal data: the reader masks it until you click "show". |

There is no role, no join date and no "left the team" flag. People who left are simply missing, while their data can still be in the export (see [section 10](#10-how-records-link-to-people)).

## 5. `conversations.json`

One very large JSON array of conversation objects. The array is **not sorted**; sort it yourself. The reader parses it as a stream, one conversation at a time (see [architecture](architecture.md#streaming-json-parser)).

### 5.1 Conversation

```json
{
  "uuid": "c0000000-0000-4000-8000-000000000001",
  "name": "Quarterly report outline",
  "summary": "**Conversation Overview**\n\nThe user asked for …",
  "created_at": "2026-09-21T14:00:00.000000Z",
  "updated_at": "2026-09-21T14:20:00.000000Z",
  "account": { "uuid": "aaaaaaaa-0000-4000-8000-000000000001" },
  "chat_messages": [ … ]
}
```

| Key | Notes |
|---|---|
| `uuid` | Also used in links: `https://claude.ai/chat/<uuid>`. |
| `name` | Often empty. Names repeat. The reader then uses the first prompt as the title. |
| `summary` | Markdown written by Claude, or empty. |
| `account.uuid` | **The owner.** The only user field in a conversation. |
| `chat_messages` | Can be empty. |

There is **no project field**: the export does not say which project a chat belongs to.

### 5.2 Message

```json
{
  "uuid": "01900000-0000-7000-8000-000000000002",
  "text": "…",
  "content": [ { "type": "text", "text": "Here is an outline …", "citations": [], "start_timestamp": "…", "stop_timestamp": "…", "flags": null } ],
  "sender": "assistant",
  "created_at": "2026-09-21T14:00:31.000000Z",
  "updated_at": "2026-09-21T14:00:31.000000Z",
  "attachments": [],
  "files": [],
  "parent_message_uuid": "01900000-0000-7000-8000-000000000001"
}
```

| Key | Notes |
|---|---|
| `sender` | `human` or `assistant`. Messages have **no author id**; every `human` message belongs to the conversation owner. |
| `content` | The real content: a list of blocks ([5.5](#55-content-blocks)). Can be empty. |
| `text` | A flattened copy. For assistant messages it is **lossy**: it includes thinking text and puts a placeholder ("This block is not supported on your current device yet.") where tool results were. Use it only when `content` is empty. |
| `created_at` | For assistant messages this is about the **end** of the answer. Block `start_timestamp` values say when it started. |
| `attachments` | Uploaded text files with their extracted text ([5.9](#59-attachments-and-files)). |
| `files` | References to uploaded files, without their bytes. |
| `parent_message_uuid` | The message this one answers or follows ([5.4](#54-branches-edits-and-retries)). Missing in old exports. |

### 5.3 Empty conversations

Some conversations have messages where every message has empty `text`, empty `content` and no files. Some have no messages at all. The export simply has no content for them. The reader counts them separately ("without content") and hides them by default.

Empty messages can also sit in the middle of normal chats (for example a stopped answer). Keep them when you walk the message tree: later messages may point to them as their parent.

### 5.4 Branches (edits and retries)

When a person edits a prompt or asks Claude to retry, the old messages stay in the array. The messages form a **tree** through `parent_message_uuid`:

- The root is the fixed id `00000000-0000-4000-8000-000000000000`. A parent id that is not in the conversation also counts as the root.
- A parent with more than one child is a **branch point**: human siblings are edited prompts, assistant siblings are retries.
- There can be several first messages (the first prompt was edited).
- The array is in time order, and a parent always comes before its children.
- There is no "current branch" field. The **last element of the array is always the current leaf**. So the branch that is shown on claude.ai is the path from the root to the last element.
- Do not assume that human and assistant messages alternate. Two messages from the same sender in a row exist.

The reader shows the current path and puts a `‹ 1 / 2 ›` switcher on every message that has siblings. At each branch point it follows the child whose subtree holds the newest message, unless you chose another one.

### 5.5 Content blocks

Every block has `type`, `start_timestamp`, `stop_timestamp` and `flags` (always `null` so far).

| `type` | Sender | What it is |
|---|---|---|
| `text` | both | Markdown text, maybe with citations. Can be `""` or a single space. |
| `thinking` | assistant | Claude's thinking and its summaries. |
| `tool_use` | assistant | A tool call: name and input. |
| `tool_result` | assistant | The tool's answer. It is in the **same** message as its `tool_use`, usually right after it. |
| `injected_prompt_block` | human | Text the platform added to the prompt (memory snapshot, date). The person did not type or see it. |
| `token_budget` | assistant | All fields `null`. Carries no information. |

**`text`**

```json
{ "type": "text", "text": "Northwind's revenue grew in Q3 …",
  "citations": [ { "uuid": "…", "start_index": 0, "end_index": 32,
                   "details": { "type": "web_search_citation", "url": "https://news.example/northwind-q3" } } ] }
```

`start_index` and `end_index` point into this block's `text`. The reader treats them as Unicode code points and places a numbered source link at `end_index`. The page title for a citation can be found in a `knowledge` result with the same URL in the same message. Optional keys: `citations_grouping_mode`, and `raw_text` / `voice_spoken_chars` in voice mode.

**`thinking`**

```json
{ "type": "thinking", "thinking": "", "thinking_hidden": true,
  "summaries": [ { "summary": "Compared the two report layouts." } ],
  "cut_off": false, "truncated": false, "hidden": false, "alternative_display_type": null, "signature": null }
```

When `thinking_hidden` is `true`, `thinking` is empty and only the summaries remain. Duration = `stop_timestamp − start_timestamp`.

**`tool_use`**

```json
{ "type": "tool_use", "id": "toolu_01ExampleExampleExample01", "name": "web_search",
  "input": { "query": "Northwind Labs quarterly results" },
  "message": "Searching the web", "integration_name": null, "display_content": null }
```

| Key | Notes |
|---|---|
| `id` | Matches `tool_result.tool_use_id`. |
| `name` | First-party tools have plain names (`web_search`). Connector (MCP) tools are named `<Integration>:<tool>`, for example `Northwind Tracker:search_issues`. |
| `input` | Free-form, written by the model. **Types are not guaranteed** (a list can arrive as a string). |
| `message` | A short caption shown in the UI. |
| `integration_name`, `icon_name`, `integration_icon_url`, `mcp_server_url`, `is_mcp_app`, `tool_origin`, `hidden_in_chat`, `approval_options`, `approval_key` | UI and connector details. Icon URLs point to the internet. |
| `display_content` | A ready-made view of the input ([5.7](#57-display_content)). |

**`tool_result`**

```json
{ "type": "tool_result", "tool_use_id": "toolu_01ExampleExampleExample01", "name": "web_search",
  "content": [ { "type": "knowledge", "title": "Northwind Labs reports Q3", "url": "https://news.example/northwind-q3",
                 "text": "…page text…", "metadata": { "type": "webpage_metadata", "site_domain": "news.example", "site_name": "Example News" } } ],
  "is_error": false }
```

| Key | Notes |
|---|---|
| `content` | A list of items ([5.6](#56-tool-result-items)). |
| `is_error` | `true` when the tool failed. `meta.error_type` may say why (`tool_error`, `client_tool_timeout`, `approval_denied`, …). |
| `display_content` | A ready-made view of the result ([5.7](#57-display_content)). |
| `structured_content` | Raw structured output of a connector tool. Free-form JSON, can be `{}`. |
| `meta` | Extra details: `output_format_category`, `error_type`, and connector-specific keys. |
| `message` | A short caption, for example "Presented file" or "Published artifact". |

A `tool_use` can have no result when the answer was stopped.

**`injected_prompt_block`**: `prompt` (the added text), `injection_source` (for example `memory_block_head` or `date_note`), and two flags. It comes after the person's text block. The reader hides it unless you turn on "System notes", because it can contain the person's memory.

### 5.6 Tool result items

| Item `type` | Keys | Comes from |
|---|---|---|
| `text` | `text` (can be very long), `uuid?` | most tools |
| `knowledge` | `title`, `url`, `text` (the page text Claude read), `metadata { site_domain, site_name, favicon_url }`, `prompt_context_metadata { age, … }`, `is_citable`, `links?` | web search and web fetch |
| `image` | `file_uuid` only. **No bytes and no URL.** | screenshots, viewing an image |
| `local_resource` | `file_path`, `name`, `mime_type`, `uuid?`, `artifact_publishable?` | `present_files` (files shown to the person) |
| `image_gallery` | `images[] { title, url, thumbnail_url, page_url, … }`, `is_expired` | image search |

### 5.7 `display_content`

On `tool_use` (a view of the input):

| `type` | Keys | Notes |
|---|---|---|
| `code_block` | `code`, `language`, `filename` | shell commands, created files |
| `json_block` | `json_block` (a JSON **string**) | Often parses to `{ language, code, filename? }`. Can be cut short and then is invalid JSON. |
| `text` | `text` | a one-line description |
| `table` | `table` (list of `[key, value]` pairs) | |

On `tool_result` (a view of the output):

| `type` | Keys | Notes |
|---|---|---|
| `json_block`, `text`, `code_block` | as above | Often a copy of `content`. |
| `rich_link` | `link { title, url, icon_url, source }` | web fetch |
| `rich_content` | `content[] { title, subtitles, url }` | chat search and memory tools; `url` can be `https://claude.ai/chat/<uuid>` |
| `file` | `published_url`, `published_artifact_id`, `published_action` (`published`, `updated`, `opened`), `title` | the `Artifact` tool |

### 5.8 Tool payload shapes

The reader gives special views to these tools. Everything else is shown as a generic input and result.

| Tool | Input | Result |
|---|---|---|
| `bash_tool` | `{ command, description }` | text that is a JSON string `{ "returncode", "stdout", "stderr" }` |
| `create_file` | `{ description, path, file_text }` (the whole file) | "File created successfully: …" |
| `str_replace` | `{ description, path, old_str, new_str }` | success or error text |
| `view` | `{ description, path, view_range? }` | numbered lines, a folder listing, or an `image` item |
| `present_files` | `{ filepaths: [ … ] }` | one `local_resource` item per file |
| `web_search` | `{ query }` | `knowledge` items |
| `web_fetch` | `{ url }` | a `knowledge` item, or an error; `display_content.rich_link` |
| `image_search` | `{ query, max_results? }` | an `image_gallery` item |
| `conversation_search`, `recent_chats` | `{ query }` | text with `<chat url="https://claude.ai/chat/<uuid>" …>` parts and `rich_content` |
| `visualize:show_widget` | `{ title, loading_messages, widget_code }` (an HTML or SVG fragment) | boilerplate text |
| `message_compose_v1` | `{ kind, summary_title, variants: [ { label, subject?, body } ] }` (`variants` can also be a string or `null`, with the text in `body`) | |
| `ask_user_input_v0` | `{ questions: [ { question, options, type? } ] }` | the answer is the next human message |
| `chart_display_v0` | `{ title, series: [ { name, values } ], xAxis: { data }, yAxis }` | |
| `places_map_display_v0` | `{ title, narrative, days: [ { day_number, title, locations } ] }` or `locations` at the top level | |
| `artifacts` (older) | `{ command, id, type, title, content }` with `type` like `text/markdown`, `text/html` or `application/vnd.ant.react` | "OK" |
| `Artifact` (newer) | `{ action, url?, file_path?, title?, … }` | `display_content.type = "file"` with `published_artifact_id`, or `structured_content.artifact_id` |
| `memory_user_edits`, `memory_read` | memory commands and paths | text and `rich_content` |

Files Claude wrote live in paths like `/mnt/user-data/outputs/report.md`. If a `create_file` call wrote the file, its text is in the input. Files made by running code (spreadsheets, PDFs, images) are listed by name only; **their bytes are not in the export**.

Big results: a result whose text starts with "Tool result too large for context, stored at …" is only a stub. The full payload is in `structured_content`.

### 5.9 Attachments and files

```json
"attachments": [ { "file_name": "meeting-notes.md", "file_size": 2048, "file_type": "text/markdown", "extracted_content": "# Meeting notes\n…" } ],
"files":       [ { "file_uuid": "…", "file_name": "meeting-notes.md" }, { "file_uuid": "…", "file_name": "whiteboard.png" } ]
```

- `attachments` hold uploaded **text** with its full content. `file_name` can be `""` (pasted text). `file_type` mixes extensions (`txt`) and MIME types (`text/markdown`). `file_size` is sometimes bytes, sometimes characters.
- `files` hold **references only**: `file_uuid` and `file_name` (which can be `null` or `""`). No size, no type, no bytes.
- Every attachment also appears in `files` with the same name. The reader pairs them by name so an upload is not listed twice.
- `files` on assistant messages are usually tool screenshots.

## 6. Projects

`projects/<project uuid>.json`, one object per file. The file name equals `uuid`.

```json
{
  "uuid": "b0000000-0000-4000-8000-000000000001",
  "name": "Brand guidelines",
  "description": "Voice, tone and logo rules for Northwind Labs.",
  "is_private": true,
  "is_starter_project": false,
  "prompt_template": "",
  "created_at": "2026-09-01T10:00:00.000000+00:00",
  "updated_at": "2026-09-15T10:00:00.000000+00:00",
  "creator": { "uuid": "aaaaaaaa-0000-4000-8000-000000000001", "full_name": "Avery Okoye" },
  "docs": [
    { "uuid": "…", "filename": "guides/voice-and-tone.md", "content": "# Voice and tone\n…", "created_at": "2026-09-01T10:05:00.000000+00:00" }
  ]
}
```

| Key | Notes |
|---|---|
| `name` | Can be empty or end with a space. Names repeat across people. |
| `is_private` | `false` means the project is shared with the workspace. There is no member list. |
| `is_starter_project` | The built-in example project. |
| `prompt_template` | The project instructions. Often empty. |
| `creator` | The owner. `full_name` is a copy of `users.json` and can be `null`. |
| `docs[]` | Knowledge files: `uuid`, `filename`, `content`, `created_at`. No size or type field. |

About `docs`:

- `filename` can contain folders (`guides/voice-and-tone.md`).
- `content` is always **text**. For `.pptx`, `.docx` or `.pdf` uploads it is the text extracted from the file, not the file. `.html` docs are raw HTML (full pages or fragments, often with scripts), so preview them only in a sandbox.

`updated_at` can change for many projects at once (a backend update), so it is not a reliable "last edited" date.

## 7. Memories

`memories/<account uuid>.json`, one object per person. The file name equals `account_uuid`.

```json
{
  "conversations_memory": "**Work context**\n\nAvery leads the brand team at Northwind Labs …",
  "project_memories": { "b0000000-0000-4000-8000-000000000001": "**Purpose & context**\n\n…" },
  "memory_files": [
    { "path": "/profile.md", "content": "---\nname: profile\ndescription: Who Avery is\nsources: [chat]\naliases: []\n---\n- [stated] Leads the brand team", "updated_at": "2026-09-20T08:00:00.000000+00:00" },
    { "path": "/people/jordan.md", "content": "---\nname: jordan\ndescription: A teammate\nsources: [backfill, chat]\naliases: [JP]\n---\n- [stated] Works with [[profile]] on launches", "updated_at": "…" }
  ],
  "account_uuid": "aaaaaaaa-0000-4000-8000-000000000001"
}
```

| Key | Notes |
|---|---|
| `account_uuid` | The person. |
| `conversations_memory` | Optional. A Markdown summary with bold lines as section titles. Missing keys are absent, never `null`. |
| `project_memories` | Optional, rare. `{ <project uuid>: markdown }`. The project's creator is the memory owner. |
| `memory_files[]` | `{ path, content, updated_at }`, sorted by path. |

Memory file paths:

| Path | Meaning |
|---|---|
| `/profile.md`, `/preferences.md` | about the person |
| `/people/<slug>.md` | people they mention |
| `/areas/<slug>.md` | work areas |
| `/topics/<slug>.md` | topics |
| `/projects/<project uuid>/…` | memory about one project (`index.md` is a stub whose `name` is the project name) |

Memory file content:

- It always starts with front matter between `---` lines: `name`, `description`, `sources` (a list of `backfill`, `chat` and `cowork`) and `aliases` (a list, items may be in double quotes).
- `description` values can contain `": "`, which breaks strict YAML parsers. The reader reads front matter line by line.
- The body is a bullet list. Bullets often start with a tag such as `[stated]`.
- `[[slug]]` is a link to another memory file of the same person (by `name` or file stem). The target may not exist.

`project_memories` and `/projects/<uuid>/` files are different texts about the same project. Show both.

## 8. Design chats

`design_chats/<chat uuid>.json`, one Claude Design chat per file.

```json
{
  "uuid": "e0000000-0000-4000-8000-000000000001",
  "title": "Chat",
  "project": { "uuid": "f0000000-0000-4000-8000-000000000001", "name": "Northwind landing page" },
  "created_at": "2026-09-10T09:00:00.000000+00:00",
  "updated_at": "2026-09-10T11:00:00.000000+00:00",
  "messages": [ … ]
}
```

- `title` is always the literal `"Chat"`. The reader builds a title from the first real prompt, else the project name.
- `project` is a **design project**. Its ids are a separate namespace: they never match `projects/*.json`.
- `messages` can be empty. Such chats have no author.
- `updated_at` can be far later than the last message. Use the last message time for "last active".

### 8.1 Messages

Each message is `{ uuid, role, content, created_at }`, and `content` is an **object** (unlike conversations):

```json
{ "uuid": "…", "role": "user", "created_at": "2026-09-10T09:01:00.000000+00:00",
  "content": { "id": "…", "role": "user", "kind": "chat", "content": "Make the hero section bolder.",
               "authorAccountUuid": "aaaaaaaa-0000-4000-8000-000000000001", "authorName": "Avery",
               "attachments": [], "timestamp": "2026-09-10T09:01:00.123456789Z" } }
```

| Key in `content` | Role | Notes |
|---|---|---|
| `content` | both | Markdown text. May contain raw HTML or JSX, so sanitize. User text can start with platform blocks (`<system-info …>`, `<attached_files>`, HTML comments). |
| `authorAccountUuid`, `authorName` | user | **The only author fields.** `authorName` is the name at send time and can differ from `users.json`. |
| `kind` | both | `chat` (or absent), `question-receipt`, `question-record`, `chat-summary`. |
| `pill` | user | `true` = an automation notice shown as a small pill, not typed by a person. |
| `attachments` | user | [8.3](#83-attachments) |
| `contentBlocks` | assistant | The real answer, in stream order ([8.2](#82-assistant-blocks-and-tools)). |
| `turnInputTokens` | assistant | Context size of the turn. Missing when the turn did not finish. |
| `turnChanges` | assistant | `{ created, edited, deleted, moved, copied }`: lists of file paths changed in this turn. |
| `snipState` | both | `registered` or `dropped`: the message was trimmed from Claude's working context. It is still in the export and was still visible to the person. |
| `questionRecord`, `questionReceipt` | assistant / user | question forms ([8.4](#84-question-forms)) |

The assistant `content` string is the text blocks glued together without spaces. Render `contentBlocks` instead.

### 8.2 Assistant blocks and tools

| Block `type` | Payload |
|---|---|
| `text` | `text`: Markdown |
| `thinking` | `text`: always `""` in the export |
| `tool_call` | `toolCall { id, type, name, input, output, serverSide? }` |
| `error` | `message`: a **string**, the last block of a failed turn |
| `user_interjection` | `message`: an **object**, a user message typed while Claude was working (`id`, `role`, `content`, `attachments`, `timestamp`, no author fields). Some of these exist only here. |

About `toolCall`:

- `type` is always `"edit"` and means nothing.
- `input` is complete. It often holds whole files (`write_file.content`, `dc_write.b_dc_html`, `str_replace_edit.old_string` / `new_string`).
- `output` is a string. In newer chats it is **cut to 200 characters** with no marker. Visual tools return placeholders: `"[elided]"`, `"(image)"`, `"(N images)"`. `output` is missing when the turn was interrupted.

Common tool names: `read_file`, `write_file`, `str_replace_edit`, `list_files`, `grep`, `eval_js`, `run_script`, `show_html`, `save_screenshot`, `dc_write`, `dc_html_str_replace`, `dc_js_str_replace`, `copy_files`, `delete_file`, `snip`, `update_todos`, `done`, `ask_user`, `questions_v2`, `gen_pptx`, `fig_*` (Figma files), `local_*` (folders the person attached).

### 8.3 Attachments

| `type` | Keys | Notes |
|---|---|---|
| `skill` | `name`, `content` | an auto-attached skill or system prompt (can be long) |
| `text` | `name`, `content`, `hidden?` | pasted text; `hidden: true` ones belong to automation pills |
| `image` | `name`, `path`, `aspectRatio?`, `content?` | **bytes not exported**; drawings have a text `content` |
| `file` | `name`, `path` | uploaded file, **content not exported** |
| `folder` | `name` | a local folder the person attached |
| `comment` | `name`, `content`, `filePath?`, `selector?`, `descriptor?` | a comment on an element of the design. `content` looks like `File: …\nElement: <mentioned-element>…</mentioned-element>\nFeedback: …` (older) or ends with `**<name>**: …` (newer). |
| `fig-file` | `name`, `selectedFrames`, `figOutline` | a Figma file reference |

### 8.4 Question forms

Older chats: the `questions_v2` tool input holds the form, and the answer comes back as a plain user message ("Questions answered: …").

Newer chats use three messages:

1. an assistant message with `kind: "question-record"` and `questionRecord { questionId, spec { title, prompt, questions: [ { id, kind, title, options?, multi? } ] } }`
2. the assistant turn with the `ask_user` tool call
3. a user message with `kind: "question-receipt"` and `questionReceipt { questionId, payload }`, where `payload` is keyed by question `id`:

| Question kind | Answer shape |
|---|---|
| single choice | `{ "choice": "…" }` (`null` = skipped) |
| multiple choice | `{ "choices": [ … ] }` |
| chips | `{ "selected": [ … ] }` |
| free text | `{ "text": "…" }` |
| file | `{ "file": [ { "path", "name" } ] }` |
| code source | `{ "localFolders": [ … ] }` |

Receipts have no author fields. A record can have no receipt (never answered).

### 8.5 Other message kinds

- **`chat-summary`** (assistant): a Markdown recap carried over when a chat continues an earlier one. It follows a pill like `Continuing from "…".`
- **Duplicate user rows**: the same user message can be stored twice, in two **adjacent** rows with the same `content.id`. One copy usually has `authorAccountUuid`, the other not. The reader merges such pairs (keeping the copy with the author, and the union of attachments).
- **Noise**: some older text blocks are bare tags such as `<i></i>` or `<details>`. The reader drops them.

## 9. Artifacts and pages (frames)

The `frames-NNN.zip` parts hold published artifacts (HTML pages and apps) and Claude Docs pages, under `artifacts/<artifact uuid>/`.

### 9.1 `artifact.json`

```json
{
  "id": "d0000000-0000-4000-8000-000000000001",
  "kind": "artifact",
  "visibility": "organization",
  "versions": [
    { "id": "1790003600-c3d4", "title": "Launch checklist", "description": "Adds owners per step.", "created_at": "2026-09-21T15:13:20+00:00" },
    { "id": "1790000000-a1b2", "title": "Launch checklist", "description": "First draft.",          "created_at": "2026-09-21T14:13:20+00:00" }
  ],
  "owner_account": "aaaaaaaa-0000-4000-8000-000000000001",
  "updated_at": "2026-09-21T15:13:20+00:00",
  "active_version": "1790003600-c3d4",
  "shared_with": { "viewers": 3, "editors": 1 }
}
```

| Key | Notes |
|---|---|
| `kind` | `artifact` (HTML with version files) or `page` (a Claude Docs page: `page.md`, no version files). |
| `visibility` | `private`, `organization` (whole workspace), `invited`, or `agent`. |
| `versions[]` | Newest first. At most 20 entries, so older history may be cut. `description` is optional and can be HTML-escaped (`&amp;`). For pages and typed apps it is often the type's own blurb, not something the author wrote. |
| `owner_account` | The owner. Missing on agent-made artifacts, which have `created_by_agent: true` and `visibility: "agent"` instead. |
| `active_version` | The current version. **Usually** `versions[0]`, but not after a rollback. |
| `updated_at` | Can be **older** than the newest version. The reader uses the later of the two. |
| `shared_with` | **Counts only**, no names. Present on shared artifacts. |

### 9.2 Version layouts

Decide per version, not per artifact: one artifact can switch between layouts over time.

| Layout | How to recognise it | What it is |
|---|---|---|
| Single file | `versions/<vid>.html` | A complete HTML document. Can be very large (inline images). |
| Multi-file | `versions/<vid>.files.json` + `versions/<vid>/…` with `index.html` | An HTML page plus its images, scripts, styles and data files. |
| Slides | multi-file with `SKILL.md`, `artifact-type/` and `project/deck.json` or `project/slides/` | A slide deck ([9.4](#94-slides)). |
| Design | multi-file with `SKILL.md`, `artifact-type/` and `project/canvas.json` | A design canvas ([9.5](#95-design-canvases)). |
| Typed, no content | `SKILL.md` / `artifact-type/` but no `project/` | The content lived in claude.ai's database. **Not exported.** |
| Page | `kind: "page"`, `page.md` | A Claude Docs page ([9.7](#97-claude-docs-pages)). |

Multi-file versions refer to their files with plain relative paths (`img/chart.png`, `fetch('data.json')`).

### 9.3 `versions/<vid>.files.json`

```json
{ "files": [
  { "original_path": "img/chart.png", "exported_as": "img/chart.png", "sha256": "…", "size_bytes": 20480, "mime_type": "image/png" },
  { "original_path": "index.html",    "exported_as": "index.html",    "sha256": "…", "size_bytes": 8192,  "mime_type": "text/html" }
] }
```

It lists exactly the files in `versions/<vid>/`. `index.html` is the entry point by convention (it is not marked). Typed apps repeat the same runtime files in every version, so many files share a `sha256`.

Typed apps also contain files that are **not user content**: `SKILL.md` (instructions for Claude), `artifact-type/app.js`, `app.css`, `dc-runtime.js` (the app runtime), `artifact-type/reference/*.md` (reference docs for Claude) and `artifact-type/thumbnail/thumbnail.json`. The reader hides them under "platform files" and leaves them out of the per-person zip. Only these names at the top of the version folder count (`isPlumbing()`); a `SKILL.md` deeper in the folder is user content. The typed `index.html` needs the claude.ai runtime and does not work offline, so the reader draws Slides and Design from their `project/` files instead.

### 9.4 Slides

`project/deck.json`:

```json
{ "v": 4, "title": "Q4 kickoff",
  "order": ["cover", "goals", "timeline"],
  "sections": { "s1": { "description": "Where we are", "start": "cover" } },
  "faces": { "inter": { "family": "Inter", "href": "https://fonts.example/inter.css" } },
  "cover": "cover", "designSystems": [] }
```

- Each slide is `project/slides/<slide id>.html`: an HTML **fragment** (a `<section>` with inline styles) on a **1920 × 1080** canvas, not a full document.
- `order` lists the slides. It can name slides whose file is missing. Some versions have slide files but no `deck.json`; then sort the file names.
- `sections[].start` is the slide id where a section begins.
- `faces` are font stylesheets (internet links).
- `<aside>` inside a slide holds speaker notes.

### 9.5 Design canvases

`project/canvas.json`:

```json
{ "v": 3, "title": "Landing page",
  "launch": { "view": "focused", "file": "Home.dc.html" },
  "boards": { "Home.dc.html": { "x": 0, "y": 0, "w": 1440, "h": 960, "title": "Home" },
              "Pricing.dc.html": { "x": 1600, "y": 0, "w": 1440, "h": 960, "title": "Pricing" } },
  "order": ["Home.dc.html", "Pricing.dc.html"],
  "notes": { "n1": { "x": 0, "y": 1000, "text": "Check copy with marketing", "fill": "blue" } },
  "pages": [], "designSystems": [] }
```

- Each board is `project/<Name>.dc.html`, a full HTML document. A board can be listed but missing.
- Boards load `./support.js`, which is **not in the export**. The reader replaces it with an empty script; most boards still render as static HTML.
- `notes` are sticky notes on the canvas.
- Links between boards point to other `.dc.html` files.

### 9.6 References to claude.ai

Some artifacts refer to things that only exist on claude.ai and are not exported:

| Reference | What it is |
|---|---|
| `/_blob/<id>` | uploaded images and files in the artifact's asset store |
| `/_runtime/…` | platform fonts and libraries |
| `/_f/…`, `/_cas/…` | runtime files of typed apps |
| `window.claude…` | live features: shared data, the viewer's identity, … |
| `<base href="/appifact/…">` | design bundles published from Claude Code |

When a version uses `/_blob/`, `/_runtime/`, `/_f/`, `/_cas/` or `window.claude`, the reader shows a notice, because those parts will look broken or will not work.

### 9.7 Claude Docs pages

`page.md` is the **current** text only; `versions[]` lists older versions as metadata.

```markdown
# Launch plan

<!-- tab: Overview -->
# Launch plan
2026-09-20 · @Avery Okoye

The launch is on **October 12**.

<!-- tab: Risks -->
- The pricing page is not final.
```

- Tabs are introduced by `<!-- tab: <title> -->` lines.
- Images are written as `![alt](attachment)`: a placeholder, not a link. The image is not exported.

`comments.json` (pages only) is a list of threads:

```json
[ { "resolved": false, "tab": "Overview", "quoted_text": "October 12",
    "comments": [
      { "body": "@Claude is this date confirmed?", "author": { "uuid": "aaaaaaaa-0000-4000-8000-000000000001", "full_name": "Avery Okoye" }, "created_at": "2026-09-20T10:00:00.000Z" },
      { "body": "Yes, it matches the release plan.", "author": { "uuid": "aaaaaaaa-0000-4000-8000-000000000001", "full_name": "Avery Okoye" }, "posted_by_agent": true, "created_at": "2026-09-20T10:00:20.000Z" } ] } ]
```

- `tab` matches a tab title. `quoted_text` (optional) appears word for word in the page, so it can be highlighted.
- **Replies posted by Claude carry the person's `author`** plus `posted_by_agent: true`. Show them as "Claude, for <person>".
- `author` can be missing, and `full_name` can be `""`.

### 9.8 `artifact_comments.json`

```json
{ "threads": [ { "created_at": "2026-09-21T16:00:00+00:00", "resolved": true, "carried": true,
    "comments": [
      { "author_index": 1, "author_role": "",          "author_is_artifact_owner": true, "text": "Make the header smaller", "created_at": "…", "to_claude_at": "…" },
      { "author_index": 1, "author_role": "assistant", "author_is_artifact_owner": true, "text": "Done: the header is now 28px.", "created_at": "…" } ] } ] }
```

- Commenters are **anonymous**: `author_index` is a number local to this file. Only the owner's comments can be tied to a person (through `owner_account`).
- `author_role`: `""` (a person), `assistant` (Claude), `page` (a question asked inside a Docs page; it repeats `comments.json`).
- Claude's replies copy the owner flag of the person they answer, so only count `author_role !== "assistant"` as the owner's.
- There is no anchor, quoted text or version id: these comments cannot be placed on the page.

## 10. How records link to people

Every kind of data carries an account uuid somewhere:

| Data | Owner field | Notes |
|---|---|---|
| conversations | `account.uuid` | one owner per conversation; messages have no author |
| projects | `creator.uuid` | `creator.full_name` is a copy of `users.json` |
| memories | `account_uuid` (= file name) | one file per person |
| design chats | `messages[].content.authorAccountUuid` | on user messages only; a chat can have several authors |
| artifacts and pages | `artifact.json` → `owner_account` | missing on agent-made artifacts |
| page comments | `comments.json` → `comments[].author.uuid` | agent replies carry the person's uuid |
| thread comments | `author_is_artifact_owner` | anonymous otherwise |

How the reader decides:

- **Design chat owner**: the author with the most typed (non-pill) messages; a tie goes to whoever wrote first. Messages with only `authorName` are matched to a uuid seen with the same name **in the same chat** (never across the export, because first names repeat). Messages with no author fields (receipts, interjections) belong to the owner.
- **Unknown people**: an id that is not in `users.json` (usually someone who left) still gets a person page, marked "not in users.json". Their data is never dropped.
- **No owner**: agent-made artifacts and empty design chats are grouped under "No owner".
- **Display name**: `users.json` `full_name`, else a name seen in the data (`creator.full_name`, `authorName`, comment `author.full_name`), else the email local part, else `Unknown user · <first 8 characters of the id>`. When two people end up with the same name, the reader adds the email local part to both: `Sam · sam.r`.

## 11. Links between records

| From | To | Through |
|---|---|---|
| conversation | conversation | `https://claude.ai/chat/<uuid>` in chat search results |
| conversation | artifact | `display_content.published_artifact_id`, `structured_content.artifact_id`, or `https://claude.ai/code/artifact/<uuid>` in tool inputs and text. Short links `claude.ai/artifact/<slug>` cannot be resolved. |
| memory | project | `project_memories` keys and `/projects/<uuid>/` paths |
| conversation | project | **none** |
| artifact | conversation, project, design chat | **none** (only the reverse links above) |
| design project | anything | **none**: design projects are their own namespace |

The reader builds the reverse link: an artifact page lists the conversations that mention it.

## 12. Older export formats

Older exports came as one folder (named like `data-<date or ids>-batch-0000/`) with plain JSON files instead of zips. Differences the reader handles:

| Area | Older | Newer |
|---|---|---|
| projects | one `projects.json` **array** | `projects/<uuid>.json` per project |
| memories | one `memories.json` **array** of `{ account_uuid, conversations_memory, project_memories? }`, **no `memory_files`** | `memories/<uuid>.json` with `memory_files` |
| messages | no `parent_message_uuid`; only `text` blocks | branches, thinking and tools |
| artifacts | no frames parts | `frames-NNN.zip` |
| manifest | none | `manifest-….json` |

Messages without `parent_message_uuid` are shown in array order. `users.json`, conversations and design chats kept the same keys.

Older exports can hold data the newest one lacks (deleted projects, chats of people who left, memory that changed). You can load several exports together. When the same item appears twice:

| Item | Kept copy |
|---|---|
| conversation | newer `updated_at`; on a tie, the one with more messages |
| project, design chat | newer `updated_at` |
| artifact metadata, `page.md` and comments | the copy whose `artifact.json` is newer (its `updated_at` or its newest version, whichever is later); on a tie, the one loaded later |
| artifact version files | merged by path (a version's files never change) |
| memory | merged: newer files win, and older text fills gaps |
| person (`users.json`) | the file loaded last fills in the fields it has |

## 13. Known quirks

A checklist for anyone writing a reader:

**Conversations**

- `name` is often empty; `summary` is often empty.
- Conversations with no content at all, and conversations with no messages.
- Assistant `message.text` contains thinking text and placeholder strings. Render `content`.
- Text blocks that are `""` or `" "`.
- Hidden thinking (`thinking_hidden: true`): only the summaries are exported.
- `display_content.json_block` and `text` can be cut at 65,536 characters, which makes the JSON invalid. Always parse inside `try` / `catch`.
- Tool result text can be cut at 300,000 characters ("[Output abbreviated due to length limit]").
- "Tool result too large for context" stubs: the real data is in `structured_content`.
- `structured_content` can be very large, or `{}`.
- `tool_use` without a `tool_result` (the answer was stopped).
- Tool inputs do not always have the documented types.
- `files[].file_name` can be `null` or `""`.
- Images, PDFs, screenshots and files made by code are references only.
- Connector names vary in spelling and case for the same service.
- External URLs (icons, image thumbnails) do not load offline.

**Design chats**

- `title` is always `"Chat"`.
- Duplicate adjacent user rows with the same `content.id`.
- `content.timestamp` with up to 9 fraction digits.
- Roles do not alternate.
- `thinking` blocks are always empty.
- Tool `output` cut at 200 characters in newer chats; `[elided]` and `(image)` placeholders.
- `error.message` is a string, `user_interjection.message` is an object.
- Text blocks with bare tags (`<i></i>`, `<details>`).
- Platform blocks at the top of user text (`<system-info>`, `<attached_files>`).

**Artifacts and pages**

- Artifacts split across two frames zips.
- At most 20 versions.
- `active_version` is not always the first version.
- `updated_at` older than the newest version.
- Descriptions that are a type blurb, equal to the title, or HTML-escaped.
- Typed versions with no `project/` folder (content not exported).
- Decks that list missing slides; canvases that list missing boards; a missing `support.js`.
- Slides are fragments on a 1920 × 1080 canvas, not documents.
- `/_blob/`, `/_runtime/` and `window.claude` references that cannot work offline.
- Page images as `![alt](attachment)`.
- Agent replies in `comments.json` carry the person's uuid.
- `artifact_comments.json` is anonymous, and Claude replies copy the owner flag.

**People and projects**

- Duplicate names, `null` names, names that are emails.
- Ids in the data that are not in `users.json`.
- `creator.full_name` can be `null`; comment `author.full_name` can be `""`.
- `updated_at` touched in bulk for many projects at once.
- Memory front matter that is not valid YAML; `[[links]]` to files that do not exist.
