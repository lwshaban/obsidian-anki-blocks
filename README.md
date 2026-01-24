# AnkiBlocks

An Obsidian plugin that syncs flashcards to Anki using YAML-formatted code blocks. Create and manage your Anki cards directly in Obsidian notes with visual preview and seamless synchronization.

## Features

- **YAML Code Blocks**: Define Anki cards using ````anki` code blocks with YAML syntax
- **Visual Preview**: See your cards rendered in preview mode with expand/collapse functionality
- **Smart Syncing**: Automatically create, update, or delete cards in Anki based on changes
- **Change Detection**: Tracks content hashes to only sync when cards are modified
- **Multiple Commands**: Sync current file, sync all files, or insert new card templates
- **Settings Integration**: Configure AnkiConnect URL, default deck/model, and display formats
- **Error Handling**: Detailed error messages and sync status feedback

## Requirements

- **Anki** installed and running
- **AnkiConnect** add-on installed in Anki ([Get it here](https://ankiweb.net/shared/info/2055492159))
- Obsidian desktop app (this plugin is desktop-only)

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Obsidian Settings → Community plugins
2. Search for "AnkiBlocks"
3. Install and enable

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/yourusername/anki-blocks/releases)
2. Extract the files (`main.js`, `manifest.json`, `styles.css`) to your vault's `.obsidian/plugins/anki-blocks/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

## Usage

### Creating Anki Cards

Use an ````anki` code block with YAML syntax:

````markdown
```anki
deck: My Deck
model: Basic
fields:
  Front: What is the capital of France?
  Back: Paris
tags:
  - geography
  - capitals
```
````

### Card Properties

- **deck** (required): The Anki deck name
- **model** (required): The Anki card model/type (e.g., "Basic", "Cloze")
- **fields** (required): Object mapping field names to content
- **tags** (optional): Array of tags
- **title** (optional): Display title when card is collapsed
- **ignore** (optional): Set to `true` to skip this card during sync
- **linkSource** (optional): Set to `true` to append Obsidian URI to card

### Commands

- **Sync current file to Anki**: Syncs all ````anki` blocks in the active file
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

- Node.js 16+ (`node --version`)
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
  services/            # AnkiConnect API client and parser
  ui/                  # Modal components and card renderer
  utils/               # Utilities (hashing, constants)
  types.ts             # TypeScript type definitions
```

### Building for Release

```bash
npm run build
```

This compiles TypeScript and bundles everything into `main.js`.

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
