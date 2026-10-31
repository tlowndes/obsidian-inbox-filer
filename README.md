# Inbox Filer

An Obsidian plugin that tags and files the notes in your inbox, using your own rules first and Claude for the rest. You always see a preview before anything moves.

It's the vault version of [Folder Tidy](https://github.com/tlowndes/folder-tidy): same idea, rules then a "Check now" style preview, but for notes.

## How it works

1. Every night at the time you pick (22:00 by default), it looks at the top level of your inbox folder (`01 - Inbox` by default). If Obsidian was closed at that time, it catches up the next time you open it.
2. **Your rules go first.** A rule can match a tag, a word in the note, a word in the title, or a frontmatter property, and it sends the note to a folder and can add tags. The first match wins.
3. **Claude handles the rest.** For notes no rule catches, Claude picks one of your existing folders and suggests up to three tags, preferring tags you already use.
4. **The preview.** Each note shows where it's going and why: green for a rule, accent colour for Claude, grey when there's no suggestion. Untick anything, change a folder or tags, then press **File**.
5. **Undo.** Run "Undo last filing" from the command palette to put the last batch back and remove the tags it added.

Notes are moved with Obsidian's own rename, so links to them keep working.

### Left alone

- Claude logs (`type: claude-log`), because the nightly bible task files those.
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
| Suggest with Claude | On |
| Anthropic API key | (empty) |
| Model | `claude-opus-5-5` |
| Folders to leave out | `.trash`, `Templates` |
| Rules | none |

### Privacy and cost

Only notes that no rule catches are sent to Anthropic's API, and only up to 6,000 characters of each one, in batches of 20. Your API key stays in this vault's `.obsidian/plugins/inbox-filer/data.json`. A typical night costs a fraction of a penny. Turn Claude off and it works on rules alone.

## Install by hand

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/inbox-filer/`.
3. In Obsidian, go to **Settings → Community plugins**, then turn on **Inbox Filer**.

## Develop

```bash
npm install
npm test          # unit tests for the rules, planner, schedule and Claude helpers
npm run build     # type-check and bundle main.js
npm run dev       # rebuild on save
```

To release, bump `version` in `manifest.json`, `package.json` and `versions.json`, then push a tag with the same version (for example `0.1.0`). The release workflow builds the plugin and attaches the files.

## Licence

MIT
