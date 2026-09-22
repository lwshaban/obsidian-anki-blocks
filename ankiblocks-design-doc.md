# AnkiBlocks - Design Document

## Overview

AnkiBlocks is an Obsidian plugin for two-way sync between Obsidian and Anki, with a primary focus on Obsidian → Anki synchronization. It differentiates itself from existing plugins through a card syntax that holds Markdown verbatim — no indentation, no escaping, no nesting limits — and clean visual rendering.

## Project Goals

- Create a flexible, two-way sync between Obsidian and Anki
- Provide a cleaner, more aesthetic implementation than existing solutions
- Support collapsible card displays (similar to callouts)
- Handle complex content including nested code blocks
- Maintain direct compatibility with AnkiConnect API

## Design Philosophy

### Why not YAML or JSON

The first implementation used YAML with block scalars, falling back to JSON. Both were abandoned. The lesson was that a *data* format is the wrong tool for holding *prose*:

1. **Indentation tax** — every content line needed four leading spaces. Pasting a code snippet meant re-indenting it, and getting it wrong produced a parse error instead of a card.
2. **Type coercion** — YAML infers types on values that aren't typed. A deck named `1.0` failed validation as "not a string"; an 8-character hex hash like `12e45678` parsed as scientific notation and became `Infinity`, so that card re-synced forever. The old parser carried a `String(lastSyncedHash)` workaround as evidence.
3. **Unsafe write-back** — serialising arbitrary strings to YAML correctly needs a real emitter. The plugin concatenated strings, so a deck named `Physics: Optics` or a tag containing a comma produced an invalid block *as a result of syncing a valid one*.
4. **Lossy round-trips** — regenerating the block from a fixed key list silently discarded comments, key order, and any key the plugin didn't know about.
5. **Fence fragility** — the 5-backtick workaround broke if content contained five backticks, and 3-backtick `anki` blocks rendered in preview but were invisible to the sync regex.

### The box format

A flat header, then `[Field]` boxes holding literal Markdown:

~~~
~~~anki
deck: Programming::Algorithms
model: Basic
tags: algorithms, python

[Front]
What's the time complexity of binary search?

```python
def binary_search(arr, x): ...
```

[Back]
**O(log n)**

[sync] id=1748291045821 rev=a3f9c1
~~~
~~~

**Rules**

- **Header** — lines before the first box. `key: value`, where the value is the rest of the line, verbatim and always a string. No nesting, so no indentation rules and no type inference.
- **Boxes** — a line that is exactly `[Name]` opens a field. Body is at column 0. `Name` becomes the Anki field name, so custom note types need no configuration.
- **`[sync]`** — reserved and machine-owned. Visually quarantined from user content instead of masquerading as a normal key.
- **Escaping** — a content line that would read as a marker is prefixed with `\`.
- **Fence** — `~~~anki`. CommonMark tilde fences are closed only by tildes, so field content can contain backtick code blocks of any length. Backtick fences of 3+ are still parsed for compatibility.

**Why this works**

The decisive property is **surgical write-back**. Because `[sync]` is a single line, a routine sync splices that one line and leaves every other byte alone. The plugin never re-emits user content, which makes the entire class of write-back corruption bugs *unreachable* rather than merely fixed.

Secondary benefits: zero indentation, zero escaping, zero type coercion, a ~60-line parser instead of a 40KB dependency, and error messages like "Line 4: expected key: value or a [Section] marker" instead of "bad indentation of a mapping entry at line 7, column 3".

**Why the Anki API allows it.** Anki's note model is flat — `fields` is `Record<string, string>` and that's the whole payload. The nesting that does exist in AnkiConnect v6 (`options.duplicateScopeOptions`, and `audio`/`video`/`picture` as arrays of objects) is transport concern, not card structure: `options` is sync policy that belongs in settings, and media is better derived by scanning field content for embeds than hand-authored. If structure is ever needed, a reserved box can hold a line-oriented mini-format:

```
[media]
picture: diagram.png -> Back
```

### Migration

The parser detects which of the three syntaxes a block uses: a `[Section]` line means box format, a leading `{` means JSON, anything else is treated as legacy YAML. Legacy blocks keep working indefinitely and are rewritten into box format the next time they sync.

## Visual Rendering

### Custom Code Block Processor

The plugin registers a markdown code block processor for `anki` blocks:

```typescript
this.registerMarkdownCodeBlockProcessor('anki', (source, el, ctx) => {
  // Try parsing as YAML first (primary format)
  let data;
  try {
    data = YAML.parse(source);
  } catch (yamlError) {
    // Fallback to JSON
    try {
      data = JSON.parse(source);
    } catch (jsonError) {
      // Show error in preview
      el.createDiv({ text: 'Invalid YAML or JSON', cls: 'anki-error' });
      return;
    }
  }
  
  // Render custom UI
  const container = el.createDiv({ cls: 'anki-card-preview' });
  
  // Process markdown in fields
  const frontHtml = this.markdownRenderer(data.fields.Front);
  const backHtml = this.markdownRenderer(data.fields.Back);
  
  // Build collapsible card UI with processed markdown
});
```

### Rendering Modes

**Edit Mode:**
- Shows raw YAML (or JSON) with syntax highlighting
- Clean, readable format for editing
- Optionally could provide a WYSIWYG editor overlay

**Reading/Preview Mode:**
- Renders as a beautiful, collapsible card component
- Markdown content is fully rendered (bold, code blocks, images, etc.)
- Shows sync status and metadata
- Provides action buttons (Sync Now, Edit, etc.)

### Example Rendered Output

```
╭─ 🎴 Anki Card ─────────────────────────╮
│ 📚 Deck: Programming                    │
│ 🏷️  Tags: algorithms, python            │
│ 🎯 Model: Basic                         │
├─────────────────────────────────────────┤
│ Front:                                  │
│ What's the time complexity of binary    │
│ search?                                 │
│                                         │
│ [Rendered with full markdown support]  │
│                                         │
│ ───────────────                         │
│                                         │
│ Back:                                   │
│ O(log n)                                │
│                                         │
│ [Code blocks render with syntax         │
│  highlighting]                          │
├─────────────────────────────────────────┤
│ ✓ Synced to Anki (ID: 1234567890)      │
│ Last sync: 2 hours ago                  │
│                                         │
│ [🔄 Sync Now]  [⚙️ Edit]  [🗑️ Delete]   │
╰─────────────────────────────────────────╯
```

### Rendering Considerations

1. **Model-Based Field Display**
   - The plugin should know which fields to show for each model type
   - Could hardcode common models (Basic, Cloze, etc.)
   - Allow user configuration for custom models

2. **Collapsibility Options**
   - Always show front, collapse back until clicked?
   - Flip card animation?
   - Side-by-side display?
   - Configurable per user preference

3. **Media Handling**
   - Images: `![](image.png)` references
   - Audio: Similar markdown syntax
   - Files synced separately via AnkiConnect media upload

## Two-Way Sync Strategy

### Sync Flow: Obsidian → Anki

1. User creates/edits card in Obsidian
2. Plugin detects changes (via file watcher or manual sync command)
3. Parse YAML (or JSON) from code block
4. Convert to JSON format for AnkiConnect API
5. If `noteId` is null: Create new note via AnkiConnect
6. If `noteId` exists: Update existing note via AnkiConnect
7. Update `noteId` in Obsidian file after successful creation
8. Store hash/timestamp for change detection

### Sync Flow: Anki → Obsidian

1. Query AnkiConnect for notes in tracked decks
2. Compare with Obsidian vault cards
3. Detect changes via:
   - Field content hash
   - Modification timestamp
   - Tag differences
4. Update Obsidian file with changes
5. Handle conflicts (see below)

### Note ID Tracking

- New cards: `noteId: null`
- After first sync: `noteId: 1234567890`
- Plugin uses this ID to track and update cards
- **Important**: Users should not modify the `noteId` field manually

### Conflict Resolution

When the same card is modified in both Obsidian and Anki:

**Strategies to consider:**
1. **Obsidian Wins** (default) - Obsidian is source of truth
2. **Most Recent Wins** - Compare timestamps
3. **Manual Merge** - Show diff and let user choose
4. **Anki Wins** - For reverse sync scenarios

**Recommendation**: Default to "Obsidian Wins" with user notification of conflicts.

### Change Detection

Track changes using:
- File modification timestamps
- Content hash of fields
- Anki's `mod` field (modification time)

Store metadata in plugin settings or a separate tracking file.

## User Experience

### Creating Cards

**Option 1: Command Palette**
```
Cmd/Ctrl + P → "AnkiBlocks: Insert New Card"
```
- Automatically inserts 5-backtick code block
- Pre-fills with template YAML structure
- Cursor positioned for editing

**Option 2: Code Snippet**
- User types ` `````anki ` manually
- Plugin could provide autocomplete templates

**Option 3: Context Menu**
- Right-click in editor → "Insert Anki Card"

**Option 4: Modal Dialog** (Recommended)
- Opens a form with textarea inputs for Front/Back
- Supports multiline content naturally
- Generates YAML code block on submit

### Editor Enhancements

**Validation on Edit:**
- Real-time YAML/JSON validation
- Highlight syntax errors
- Suggest corrections
- Validate required fields (deck, model, fields)

**Warnings:**
- Detect if user has ` ```code``` ` inside content with only 3 backticks
- Warn: "Nested code blocks detected. Ensure you're using 5 backticks for the outer fence."
- Warn if `|` block scalar is missing for multiline content

**Auto-formatting:**
- Prettify YAML on save or via command
- Ensure proper indentation
- Validate block scalar syntax

### Settings & Configuration

**Plugin Settings Should Include:**

1. **Sync Settings**
   - Default deck name
   - Sync interval (manual, auto on save, timed)
   - Conflict resolution strategy

2. **Model Configuration**
   - Map model names to field display order
   - Define which fields to show in preview
   - Custom model support

3. **Rendering Options**
   - Collapsibility preference (auto-collapse back, flip animation, etc.)
   - Show/hide metadata (deck, tags, noteId)
   - Custom CSS classes

4. **Advanced**
   - AnkiConnect URL (default: http://localhost:8765)
   - Enable/disable two-way sync
   - Backup before sync
   - Debug logging

## Technical Implementation

### Dependencies

- **AnkiConnect**: Anki add-on providing HTTP API
- **Obsidian API**: Plugin API for editor, file system, settings
- **YAML Parser**: Library for parsing YAML (e.g., js-yaml)

### Key Components

1. **Parser Module**
   - Parse 5-backtick `anki` code blocks
   - Extract and validate YAML (primary format)
   - Fallback to JSON parsing
   - Convert YAML to JSON for API calls
   - Validate block scalar syntax

2. **Renderer Module**
   - Register code block processor
   - Render markdown within fields
   - Build collapsible UI components
   - Handle user interactions (sync, edit, delete)

3. **Sync Engine**
   - Communicate with AnkiConnect API
   - Track sync state and history
   - Handle conflicts
   - Queue sync operations

4. **File Watcher**
   - Monitor changes to files with anki blocks
   - Trigger sync on save (if enabled)
   - Update noteId after sync

5. **Settings Manager**
   - Store user preferences
   - Provide settings UI
   - Validate configuration

### AnkiConnect API Calls

**Create Note:**
```typescript
await fetch('http://localhost:8765', {
  method: 'POST',
  body: JSON.stringify({
    action: 'addNote',
    version: 6,
    params: {
      note: {
        deckName: data.deck,
        modelName: data.model,
        fields: data.fields,
        tags: data.tags
      }
    }
  })
});
```

**Update Note:**
```typescript
await fetch('http://localhost:8765', {
  method: 'POST',
  body: JSON.stringify({
    action: 'updateNoteFields',
    version: 6,
    params: {
      note: {
        id: data.noteId,
        fields: data.fields
      }
    }
  })
});
```

**Query Notes:**
```typescript
await fetch('http://localhost:8765', {
  method: 'POST',
  body: JSON.stringify({
    action: 'findNotes',
    version: 6,
    params: {
      query: 'deck:"Programming"'
    }
  })
});
```

### Error Handling

- Validate YAML/JSON syntax before sync
- Validate required fields (deck, model, fields)
- Check for proper block scalar usage (`|`)
- Check AnkiConnect availability
- Handle network errors gracefully
- Provide clear error messages to user
- Log errors for debugging

## Comparison with Existing Plugins

### Existing Solutions

1. **Obsidian_to_Anki** - Custom markdown syntax, complex rules
2. **Flashcards** - Inline `::` syntax, tag-based
3. **AnkiBridge** - Blueprint-based parsing
4. **Yanki** - Minimal markdown patterns

### AnkiBlocks Advantages

✅ **Natural multiline support** - YAML block scalars handle complex content without escaping
✅ **Highly readable** - Clean, indentation-based syntax that's easy to understand
✅ **Handles nested code blocks** - Via 5-backtick solution + YAML block scalars
✅ **Clean visual rendering** - Beautiful preview mode with markdown rendering
✅ **Flexible and extensible** - Structure supports any Anki field or model type
✅ **Two-way sync focus** - Built for bidirectional updates
✅ **Copy-paste friendly** - Content works naturally without modification
✅ **JSON fallback** - Still supports JSON for programmatic generation
✅ **Direct API compatibility** - YAML converts seamlessly to JSON for AnkiConnect

### Potential Drawbacks

⚠️ **Indentation sensitivity** - YAML requires correct indentation (but this is intuitive)
⚠️ **Learning curve** - Users need to understand block scalar syntax (`|`)
⚠️ **5-backtick requirement** - Users must remember this for nested code
⚠️ **Edit mode isn't WYSIWYG** - Raw YAML in edit mode (but more readable than JSON)

## Future Enhancements

### Phase 1 (MVP)
- [ ] YAML parsing with block scalar support
- [ ] JSON fallback parsing
- [ ] 5-backtick code block rendering
- [ ] One-way sync (Obsidian → Anki)
- [ ] Support for Basic and Cloze models
- [ ] Simple collapsible preview
- [ ] Manual sync command
- [ ] Modal dialog for card creation

### Phase 2
- [ ] Two-way sync
- [ ] Automatic sync on save
- [ ] Conflict resolution UI
- [ ] Custom model support
- [ ] Advanced rendering options
- [ ] Media file handling

### Phase 3
- [ ] Batch operations
- [ ] Sync statistics and history
- [ ] Card templates/snippets library
- [ ] Mobile app support
- [ ] Integration with Obsidian Daily Notes
- [ ] Templater integration examples

### Advanced Features (Maybe)
- [ ] AI-assisted card generation
- [ ] Spaced repetition preview in Obsidian
- [ ] Card difficulty tracking
- [ ] Collaborative deck sharing
- [ ] Export to other SRS systems

## Development Workflow

### Getting Started

1. **Setup**
   ```bash
   git clone https://github.com/yourusername/ankiblocks
   cd ankiblocks
   npm install
   ```

2. **Development**
   ```bash
   npm run dev
   ```

3. **Build**
   ```bash
   npm run build
   ```

### Testing Strategy

- Unit tests for YAML/JSON parsing
- Test block scalar handling
- Integration tests with AnkiConnect
- Manual testing with various card types
- Test with nested code blocks
- Test sync scenarios
- Test indentation edge cases

### Documentation

- README with setup instructions
- Wiki with detailed examples
- Video tutorial for new users
- API documentation for developers

## Resources

### AnkiConnect
- [AnkiConnect GitHub](https://github.com/FooSoft/anki-connect)
- [API Documentation](https://foosoft.net/projects/anki-connect/)

### Obsidian Plugin Development
- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins)
- [Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)

### Related Projects
- [Obsidian_to_Anki](https://github.com/ObsidianToAnki/Obsidian_to_Anki)
- [Flashcards Plugin](https://github.com/reuseman/flashcards-obsidian)
- [AnkiBridge](https://github.com/jeppeklitgaard/ObsidianAnkiBridge)

## Contributing

Guidelines for contributors:
- Follow TypeScript best practices
- Maintain backward compatibility
- Add tests for new features
- Update documentation
- Use semantic versioning

## License

TBD - Likely MIT or similar permissive license

---

**Document Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Design Phase
