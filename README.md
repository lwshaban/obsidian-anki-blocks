# AnkiBlocks

An Obsidian plugin that syncs flashcards to Anki. Cards are written in a plain, indentation-free block format that holds Markdown verbatim — including nested code blocks — and renders as a collapsible card in preview.

## Features

- **Readable card syntax**: A flat header plus `[Field]` boxes. Content sits at column 0, so you can paste anything in without re-indenting or escaping.
- **Nested code blocks just work**: Tilde fences (`~~~anki`) are closed only by tildes, so a field can contain a ```` ``` ```` code block of any length.
- **Visual preview**: Cards render with expand/collapse and full Markdown, using Obsidian's own renderer.
- **Non-destructive sync**: Syncing only ever rewrites the machine-owned `[sync]` line. Your comments, spacing, field order and custom keys are left byte-for-byte intact.
- **Change detection**: Content hashing over fields, deck, model and tags means a card only syncs when something Anki cares about actually changed.
- **Backwards compatible**: Existing YAML and JSON blocks still parse and are migrated to the new syntax on the next sync.

## Card syntax

~~~markdown
~~~anki
deck: Programming::Algorithms
model: Basic
tags: algorithms, python

[Front]
What's the time complexity of binary search?

```python
def binary_search(arr, x):
    lo, hi = 0, len(arr) - 1
    ...
```

[Back]
**O(log n)** — halves the search space each step.

[sync] id=1748291045821 rev=a3f9c1
~~~
~~~

### Rules

- **Header** — everything before the first `[Box]`. One `key: value` per line; the value is the rest of the line, taken literally. No nesting, so no indentation to get wrong and no type coercion (a deck named `1.0` stays the string `1.0`).
- **Boxes** — a line that is exactly `[Name]` opens a field. `Name` becomes the Anki field name, so any note type works, including custom ones. The body is literal Markdown at column 0.
- **`[sync]`** — written and owned by the plugin. Don't edit it. Delete the whole line to detach a card from Anki and have it recreated.
- **Escaping** — if a line in your content is literally `[Something]` or `[sync] ...`, prefix it with a backslash: `\[Something]`.
- **Fences** — `~~~anki` is recommended and is what the plugin writes. Backtick fences of any length still work and are still parsed.

### Header keys

| Key | Required | Meaning |
| --- | --- | --- |
| `deck` | yes | Anki deck name; `::` nests |
| `model` | yes | Anki note type, e.g. `Basic`, `Cloze` |
| `tags` | no | Comma- or space-separated |
| `title` | no | Shown when the card is collapsed |
| `ignore` | no | `true` skips this card during sync |
| `linkSource` | no | `true` appends a link back to the note |

Any other key is kept as-is and round-trips untouched, so you can annotate cards freely.

## Requirements

- **Anki** installed and running
- **AnkiConnect** add-on installed in Anki ([Get it here](https://ankiweb.net/shared/info/2055492159))
- Obsidian desktop for syncing. Cards render on mobile, but AnkiConnect needs Anki desktop, so the sync commands are hidden there.

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Obsidian Settings → Community plugins
2. Search for "AnkiBlocks"
3. Install and enable

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/lwshaban/obsidian-anki-blocks/releases)
2. Extract the files (`main.js`, `manifest.json`, `styles.css`) to your vault's `.obsidian/plugins/anki-blocks/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

## Usage

### Commands

- **Sync current file to Anki**: Syncs every anki block in the active file
- **Sync all files to Anki**: Scans entire vault and syncs all cards
- **Insert new Anki card**: Inserts a template card at cursor position
- **Ribbon icon**: Quick sync button in the left sidebar

### Settings

Configure the plugin in **Settings → AnkiBlocks**:

- **AnkiConnect URL**: Default is `http://localhost:8765`
- **Default deck**: Default deck name for new cards
- **Default model**: Default card type (Basic, Cloze, etc.)
- **Display formats**: Customize how cards appear in preview mode

## Development

### Prerequisites

- Node.js 20+ (`node --version`)
- npm

### Setup

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
4. Make changes to TypeScript files in `src/`
5. Reload Obsidian to see changes

### Project Structure

```
src/
  main.ts              # Plugin entry point
  settings.ts          # Settings interface and UI
  commands/            # Command implementations
  services/            # AnkiConnect client, card format parser/serializer
  ui/                  # Modal components and card renderer
  utils/               # Utilities (hashing, constants)
  types.ts             # TypeScript type definitions
```

### Building for Release

```bash
npm run build
```

This compiles TypeScript and bundles everything into `main.js`.

### Tests

```bash
npm test
```

Tests cover the card format end to end: parsing, serialising, legacy migration, round-trip safety and fence matching.

### Linting

```bash
npm run lint
```

## Releasing

1. Update `manifest.json` with new version number (e.g., `0.1.1`)
2. Update `versions.json` with the minimum Obsidian version required
3. Run `npm run build` to create `main.js`
4. Create a GitHub release with tag matching the version (no `v` prefix)
5. Attach `main.js`, `manifest.json`, and `styles.css` to the release

## API Documentation

- [Obsidian API](https://docs.obsidian.md)
- [AnkiConnect API](https://github.com/FooSoft/anki-connect)

## License

0-BSD

## Author

Lawrence Shaban
