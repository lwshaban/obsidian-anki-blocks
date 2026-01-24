# AnkiBlocks - Design Document

## Overview

AnkiBlocks is an Obsidian plugin for two-way sync between Obsidian and Anki, with a primary focus on Obsidian → Anki synchronization. It differentiates itself from existing plugins through its YAML-based syntax that handles multiline content naturally, and clean visual rendering.

## Project Goals

- Create a flexible, two-way sync between Obsidian and Anki
- Provide a cleaner, more aesthetic implementation than existing solutions
- Support collapsible card displays (similar to callouts)
- Handle complex content including nested code blocks
- Maintain direct compatibility with AnkiConnect API

## Design Philosophy

### Why YAML?

The plugin uses YAML as its core syntax for several key reasons:

1. **Natural Multiline Support** - YAML's block scalar syntax (`|`) handles multiline content without escaping
2. **Human-Readable** - Clean, indentation-based structure that's easy to read and write
3. **No Escape Characters** - Code blocks, paragraphs, and formatted text work naturally without `\n` escaping
4. **Direct API Compatibility** - YAML can be parsed and converted to JSON for AnkiConnect's API
5. **Flexible Structure** - Clear key-value pairs with explicit nesting via indentation
6. **Copy-Paste Friendly** - Content can be pasted directly without modification
7. **Programmatic Generation** - Still easy to generate cards via scripts (YAML parsers handle JSON too)

### The Code Block Nesting Problem

Initial consideration was given to both callout syntax and standard triple-backtick code blocks, but both have limitations:

**Callout Syntax (`> [!anki]`):**
- Doesn't nest well with complex card structures
- Difficult to distinguish front/back fields
- Doesn't naturally support cloze deletions

**Triple Backtick Code Blocks (` ```anki `):**
- **Critical Issue**: Cannot contain nested code blocks
- When content contains ` ```python ` inside a field, the markdown parser treats the first ` ``` ` as the closing fence
- This breaks the entire code block

**Solution: 5-Backtick Code Blocks with YAML**

Following the CommonMark specification, Obsidian supports variable-length code fences:

- Opening fence with 5 backticks: `` `````anki ``
- Inner content can contain up to 4 backticks without breaking
- Closing fence with 5 backticks: `` ````` ``

This allows nested code blocks within YAML field content while maintaining proper parsing. YAML's block scalar syntax (`|`) makes multiline content explicit and unambiguous.

## Card Syntax

### Basic Card Structure (YAML - Primary Format)

``````markdown
`````anki
deck: Programming
model: Basic
fields:
  Front: |
    What's the time complexity of binary search?
  Back: |
    O(log n)
tags: [algorithms, python]
noteId: null
`````
``````

### Card with Nested Code Block

``````markdown
`````anki
deck: Programming
model: Basic
fields:
  Front: |
    What does this function do?
    
    ```python
    def binary_search(arr, x):
        left, right = 0, len(arr) - 1
        while left <= right:
            mid = (left + right) // 2
            if arr[mid] == x:
                return mid
            elif arr[mid] < x:
                left = mid + 1
            else:
                right = mid - 1
        return -1
    ```
    
    Explain the algorithm and its time complexity.
  Back: |
    Implements binary search algorithm.
    
    Time complexity: O(log n)
    Space complexity: O(1)
    
    Key points:
    - Divides search space in half each iteration
    - Requires sorted array
    - Returns index if found, -1 otherwise
tags: [python, algorithms, search]
noteId: 1234567890
`````
``````

### YAML Schema

```yaml
deck: string (required) - Name of Anki deck
model: string (required) - Anki note type (e.g., 'Basic', 'Cloze')
fields:
  FieldName: |
    Field content with markdown/HTML
    Use the pipe (|) character for multiline content
tags: [array, of, strings] (optional)
noteId: number or null - Anki note ID (null for new cards)
```

### Understanding YAML Block Scalars

The `|` (pipe) character after a field name indicates a **block scalar** - everything indented below it is literal text content:

``````markdown
`````anki
fields:
  Front: |
    This is all content
    Even things that look like YAML:
    key: value
    - list item
    These are just text!
  Back: |
    Another field starts here
`````
``````

**Important Rules:**
- Always use `|` after field names for multiline content
- Content must be indented (typically 2 or 4 spaces)
- Everything at that indent level is literal text, not YAML structure
- This prevents ambiguity - colons, dashes, and other YAML syntax in your content won't be misinterpreted

### Alternative: JSON Format (Optional)

For simple cards or programmatic generation, JSON is also supported:

``````markdown
`````anki
{
  "deck": "Programming",
  "model": "Basic",
  "fields": {
    "Front": "What's the time complexity of binary search?",
    "Back": "O(log n)"
  },
  "tags": ["algorithms", "python"],
  "noteId": null
}
`````
``````

**Note:** JSON requires escaping newlines with `\n`, making it less suitable for cards with code blocks or lengthy content. YAML is recommended for most use cases.

### YAML Best Practices

**1. Always use block scalars (`|`) for field content**
```yaml
fields:
  Front: |
    Your content here
  Back: |
    Your answer here
```

**2. Consistent indentation (2 or 4 spaces)**
```yaml
deck: Programming
model: Basic
fields:     # 0 spaces
  Front: |  # 2 spaces
    Text    # 4 spaces (content)
```

**3. Array syntax for tags**
```yaml
# Inline array (recommended for short lists)
tags: [python, algorithms]

# Block array (for longer lists)
tags:
  - python
  - algorithms
  - data-structures
```

**4. Cloze deletions**
```yaml
model: Cloze
fields:
  Text: |
    The time complexity of binary search is {{c1::O(log n)}}.
    It requires a {{c2::sorted}} array.
```

**5. Multiple paragraphs and formatting**
```yaml
fields:
  Front: |
    # Question Header
    
    What's the difference between:
    - BFS
    - DFS
    
    Consider both time and space complexity.
```

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
