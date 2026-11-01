# Inbox Filer

An Obsidian plugin that tags and files the notes in your inbox, using your own rules first and Claude for the rest. You always see a preview before anything moves.

It's the vault version of [Folder Tidy](https://github.com/tlowndes/folder-tidy): same idea, rules then a "Check now" style preview, but for notes.

## How it works

1. Every night at the time you pick (22:00 by default), it looks at the top level of your inbox folder (`01 - Inbox` by default). If Obsidian was closed at that time, it catches up the next time you open it.
2. **Your rules go first.** A rule can match a tag, a word in the note, a word in the title, or a frontmatter property, and it sends the note to a folder and can add tags. The first match wins.
3. **Claude handles the rest.** For notes no rule catches, Claude picks one of your existing folders and suggests up to three tags, preferring tags you already use. By default this goes through **Claude Code** on your computer, so it runs on your Claude subscription with no API key. You can switch to the Anthropic API, or turn Claude off and use rules alone.
4. **The preview.** Each note shows where it's going and why: green for a rule, accent colour for Claude, grey when there's no suggestion. Untick anything, change a folder or tags, then press **File**.
5. **Undo.** Run "Undo last filing" from the command palette to put the last batch back and remove the tags it added.

Notes are moved with Obsidian's own rename, so links to them keep working. Each note is moved first and tagged second, so tag-based movers that watch the inbox (like Auto Note Mover) don't fight over it.

### Left alone

- Claude logs (`type: claude-log`), because the nightly bible task files those.
- Notes named in **Always leave these notes**, such as a task list.
- Notes with a tag from **Leave notes with these tags** (`review` by default).
- Any note with `inbox-filer: ignore` in its frontmatter.
- Attachments and anything else that isn't a Markdown note.

## Commands

- **File inbox now**, also on the ribbon (inbox icon)
- **Undo last filing**

## Settings

| Setting | Default |
| --- | --- |
| Inbox folder | `01 - Inbox` |
| Check every night / Time | On / `22:00` |
| Suggestions from | Claude Code (your Claude subscription) |
| Claude Code path / model | found automatically / Claude Code's default |
| Anthropic API key / model (API only) | (empty) / `claude-opus-5-5` |
| Always leave these notes | (none) |
| Leave notes with these tags | `review` |
| Tags per note | 3 |
| Folders to leave out | `.trash`, `Templates` |
| Rules | none |

### Using Claude Code (the default)

[Install Claude Code](https://code.claude.com/docs/en/setup) and run `claude` once in a terminal to sign in. The plugin then runs `claude -p` in the background with no tools, no MCP servers and no saved session, so it only reads the notes it's given. It looks in the usual install folders (on Windows, `%USERPROFILE%\.local\bin\claude.exe`). If yours is somewhere else, set the path in settings. Usage counts towards your Claude plan's limits.

### Privacy and cost

Only notes that no rule catches are sent to Claude, and only up to 6,000 characters of each one, in batches of 20. With the API option, your key stays in this vault's `.obsidian/plugins/inbox-filer/data.json` and a typical night costs a fraction of a penny.

## Install by hand

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/inbox-filer/`.
3. In Obsidian, go to **Settings → Community plugins**, then turn on **Inbox Filer**.

## Develop

```bash
npm install
npm test          # unit tests for the rules, planner, schedule, Claude API and Claude Code helpers
npm run build     # type-check and bundle main.js
npm run dev       # rebuild on save
```

To release, bump `version` in `manifest.json`, `package.json` and `versions.json`, then push a tag with the same version (for example `0.1.0`). The release workflow builds the plugin and attaches the files.

## Licence

MIT
