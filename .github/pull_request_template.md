## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one (Fixes #123). -->

## How I tested it

<!-- Browser(s) used, and what you clicked through. Use the sample data. -->

## Checklist

- [ ] `npm test` passes.
- [ ] I ran `npm run build` and committed the updated `dist/claude-export-reader.html` (`npm run build:check` passes).
- [ ] **No real export data** anywhere: not in code, tests, fixtures, screenshots or this description.
- [ ] I tried the change in a browser with the sample data. For UI changes, I also checked dark mode and a narrow (phone-sized) window.
- [ ] No new network requests and no new dependencies.
- [ ] Untrusted export content is escaped, sanitized or sandboxed (see [CONTRIBUTING.md](https://github.com/PiniShv/AnthropicReader/blob/main/CONTRIBUTING.md#coding-style)).
- [ ] Docs updated if behaviour or the export format changed (`README.md`, `docs/`).
- [ ] A line under **Unreleased** in `CHANGELOG.md`, if users will notice the change.
