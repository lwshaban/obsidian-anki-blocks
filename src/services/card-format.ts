/**
 * The "box" card format.
 *
 * A flat header followed by [Section] boxes holding literal Markdown:
 *
 *     deck: Programming::Algorithms
 *     model: Basic
 *     tags: algorithms, python
 *
 *     [Front]
 *     What's the time complexity of binary search?
 *
 *     [Back]
 *     **O(log n)**
 *
 *     [sync] id=1748291045821 rev=a3f9c1
 *
 * Design notes:
 * - Header values are never type-coerced. Everything is a string until this
 *   module decides otherwise, so a deck named "1.0" or a hex hash that looks
 *   like scientific notation survives intact.
 * - Field bodies sit at column 0, so pasted content needs no re-indentation
 *   and nested code fences need no escaping.
 * - [sync] is machine-owned. Because it is a single line we can splice it in
 *   place (see `updateSyncLine`) instead of regenerating the block, which means
 *   syncing can never rewrite, reorder, or drop a user's content.
 */

import { AnkiCard, CardFormat, ParseResult, ValidationResult } from '../types';

/** A line that is exactly `[Name]` opens a box. */
const SECTION_RE = /^\[([^\]\n]+)\][ \t]*$/;

/** `key: value` in the header. Value is the rest of the line, verbatim. */
const HEADER_RE = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/;

/** Box names the plugin owns; they never become Anki fields. */
const RESERVED_SECTIONS = new Set(['sync']);

/** Header keys the plugin understands. Anything else is kept in `extra`. */
const KNOWN_HEADER_KEYS = new Set([
	'deck', 'model', 'tags', 'title', 'ignore', 'linksource',
	// Accepted when reading legacy blocks; written into [sync] from now on.
	'noteid', 'lastsyncedhash',
]);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a block, auto-detecting which of the three syntaxes it uses.
 */
export function parseCard(source: string): ParseResult {
	const format = detectFormat(source);
	switch (format) {
		case 'box':
			return parseBox(source);
		case 'json':
			return parseJson(source);
		case 'yaml':
			return parseLegacyYaml(source);
	}
}

/**
 * Work out which syntax a block is written in.
 *
 * A `[Section]` line is unambiguous — neither JSON nor our old YAML layout can
 * contain one at column 0 — so it wins. Otherwise a leading brace means JSON
 * and everything else is treated as legacy YAML.
 */
export function detectFormat(source: string): CardFormat {
	for (const line of source.split('\n')) {
		if (SECTION_RE.test(line)) return 'box';
	}
	return source.trimStart().startsWith('{') ? 'json' : 'yaml';
}

/**
 * Parse the box format.
 */
export function parseBox(source: string): ParseResult {
	const lines = source.split('\n');

	const header: Record<string, string> = {};
	const sections: Array<{ name: string; body: string[] }> = [];
	let current: { name: string; body: string[] } | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const sectionMatch = SECTION_RE.exec(line);

		if (sectionMatch) {
			current = { name: sectionMatch[1]!.trim(), body: [] };
			sections.push(current);
			continue;
		}

		// `[sync] id=… rev=…` carries trailing content so it fails SECTION_RE.
		// It terminates whatever box is open — nothing follows it in a card.
		if (parseInlineSync(line, header)) {
			current = null;
			continue;
		}

		if (current) {
			current.body.push(unescapeMarker(line));
			continue;
		}

		// Still in the header.
		if (line.trim() === '') continue;

		const headerMatch = HEADER_RE.exec(line);
		if (!headerMatch) {
			return {
				success: false,
				error: `Line ${i + 1}: expected "key: value" or a [Section] marker, got "${truncate(line)}"`,
			};
		}
		header[headerMatch[1]!.toLowerCase()] = headerMatch[2]!.trim();
	}

	// [sync] may also have been captured as a section (when written bare).
	for (const section of sections) {
		if (section.name.toLowerCase() !== 'sync') continue;
		for (const line of section.body) {
			if (line.trim()) parseSyncPairs(line, header);
		}
	}

	const fields: Record<string, string> = {};
	for (const section of sections) {
		if (RESERVED_SECTIONS.has(section.name.toLowerCase())) continue;
		fields[section.name] = trimBlankEdges(section.body).join('\n');
	}

	if (sections.length === 0) {
		return { success: false, error: 'No [Field] boxes found. A card needs at least one, e.g. [Front].' };
	}

	const card = buildCard(header, fields);
	const validation = validateCard(card.data);
	if (!validation.valid) {
		return { success: false, error: validation.errors.join('; ') };
	}

	return { success: true, data: card.data, format: 'box' };
}

/** Matches `[sync] id=… rev=…` written on one line. */
const INLINE_SYNC_RE = /^\[sync\][ \t]+\S.*$/i;

/**
 * Read `[sync] id=… rev=…` written on a single line. Returns false if the line
 * isn't a sync marker so the caller can keep trying other shapes.
 */
function parseInlineSync(line: string, header: Record<string, string>): boolean {
	if (!INLINE_SYNC_RE.test(line.trim())) return false;
	parseSyncPairs(line.trim().slice('[sync]'.length), header);
	return true;
}

/**
 * True if a line would be read as a box or sync marker, and so needs escaping
 * when it appears inside field content.
 */
function isMarkerLine(line: string): boolean {
	return SECTION_RE.test(line) || INLINE_SYNC_RE.test(line.trim());
}

/** Reverse the escaping applied by `escapeBody`. */
function unescapeMarker(line: string): string {
	if (!line.startsWith('\\')) return line;
	const unescaped = line.slice(1);
	return isMarkerLine(unescaped) ? unescaped : line;
}

/**
 * Pull `k=v` pairs out of a sync line into header keys.
 */
function parseSyncPairs(text: string, header: Record<string, string>): void {
	const pairRe = /([A-Za-z][A-Za-z0-9_-]*)=(\S*)/g;
	let match: RegExpExecArray | null;
	while ((match = pairRe.exec(text)) !== null) {
		const key = match[1]!.toLowerCase();
		const value = match[2]!;
		if (key === 'id') header['noteid'] = value;
		else if (key === 'rev') header['lastsyncedhash'] = value;
		else header[key] = value;
	}
}

/**
 * Turn a raw header map plus field bodies into an AnkiCard.
 */
function buildCard(header: Record<string, string>, fields: Record<string, string>): { data: AnkiCard } {
	const extra: Record<string, string> = {};
	for (const [key, value] of Object.entries(header)) {
		if (!KNOWN_HEADER_KEYS.has(key)) extra[key] = value;
	}

	const noteIdRaw = header['noteid'];
	const noteId = noteIdRaw && noteIdRaw !== 'null' && /^\d+$/.test(noteIdRaw)
		? Number(noteIdRaw)
		: null;

	const card: AnkiCard = {
		deck: (header['deck'] ?? '').trim(),
		model: (header['model'] ?? '').trim(),
		fields,
		tags: parseTags(header['tags']),
		noteId,
	};

	if (header['title']) card.title = header['title'].trim();
	if (header['lastsyncedhash']) card.lastSyncedHash = header['lastsyncedhash'];
	if (isTruthy(header['ignore'])) card.ignore = true;
	if (isTruthy(header['linksource'])) card.linkSource = true;
	if (Object.keys(extra).length > 0) card.extra = extra;

	return { data: card };
}

/**
 * Tags are comma- or whitespace-separated. Anki tags cannot contain spaces, so
 * either separator is unambiguous.
 */
function parseTags(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.replace(/^\[|\]$/g, '')
		.split(/[,\s]+/)
		.map(t => t.trim())
		.filter(t => t.length > 0);
}

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase());
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start]!.trim() === '') start++;
	while (end > start && lines[end - 1]!.trim() === '') end--;
	return lines.slice(start, end);
}

function truncate(text: string, max = 60): string {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// ---------------------------------------------------------------------------
// Legacy formats (read-only)
// ---------------------------------------------------------------------------

function parseJson(source: string): ParseResult {
	try {
		const data: unknown = JSON.parse(source);
		return finishLegacy(data, 'json');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return { success: false, error: `Invalid JSON: ${message}` };
	}
}

/**
 * Parse the original YAML layout.
 *
 * This is a deliberately small hand-rolled reader rather than a YAML library:
 * it only needs to understand the shape the plugin itself used to emit (flat
 * scalars plus `fields:` with `|` block scalars), and doing it here means we
 * can drop the js-yaml dependency entirely.
 */
export function parseLegacyYaml(source: string): ParseResult {
	const lines = source.split('\n');
	const header: Record<string, string> = {};
	const fields: Record<string, string> = {};

	let inFields = false;
	let currentField: string | null = null;
	let currentBody: string[] = [];
	let bodyIndent: number | null = null;

	const flush = () => {
		if (currentField !== null) {
			fields[currentField] = dedent(currentBody, bodyIndent).join('\n').replace(/\n+$/, '');
		}
		currentField = null;
		currentBody = [];
		bodyIndent = null;
	};

	for (const line of lines) {
		if (line.trim() === '' && currentField !== null) {
			currentBody.push('');
			continue;
		}
		if (line.trim() === '') continue;

		const indent = line.length - line.trimStart().length;

		// A block scalar body continues while it stays indented past its key.
		if (currentField !== null && indent > 2) {
			currentBody.push(line);
			if (bodyIndent === null) bodyIndent = indent;
			else bodyIndent = Math.min(bodyIndent, indent);
			continue;
		}

		flush();

		if (/^fields[ \t]*:/.test(line)) {
			inFields = true;
			continue;
		}

		const fieldMatch = /^\s{1,}([^:]+?)[ \t]*:[ \t]*\|[-+]?[ \t]*$/.exec(line);
		if (inFields && fieldMatch) {
			currentField = fieldMatch[1]!.trim();
			continue;
		}

		const inlineField = /^\s{1,}([^:]+?)[ \t]*:[ \t]*(.+)$/.exec(line);
		if (inFields && indent > 0 && inlineField) {
			fields[inlineField[1]!.trim()] = stripQuotes(inlineField[2]!.trim());
			continue;
		}

		const headerMatch = HEADER_RE.exec(line);
		if (headerMatch) {
			inFields = false;
			header[headerMatch[1]!.toLowerCase()] = stripQuotes(headerMatch[2]!.trim());
		}
	}
	flush();

	const card = buildCard(header, fields);
	const validation = validateCard(card.data);
	if (!validation.valid) {
		return { success: false, error: validation.errors.join('; ') };
	}
	return { success: true, data: card.data, format: 'yaml' };
}

function dedent(lines: string[], indent: number | null): string[] {
	if (indent === null) return trimBlankEdges(lines);
	return trimBlankEdges(lines.map(l => (l.length >= indent ? l.slice(indent) : l.trimStart())));
}

function stripQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

function finishLegacy(data: unknown, format: CardFormat): ParseResult {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return { success: false, error: 'Card data must be an object' };
	}
	const raw = data as Record<string, unknown>;
	const card: AnkiCard = {
		deck: asText(raw['deck']).trim(),
		model: asText(raw['model']).trim(),
		fields: normalizeFields(raw['fields']),
		tags: Array.isArray(raw['tags']) ? raw['tags'].map(t => asText(t).trim()).filter(Boolean) : [],
		noteId: typeof raw['noteId'] === 'number' ? raw['noteId'] : null,
	};
	if (raw['title']) card.title = asText(raw['title']).trim();
	if (raw['lastSyncedHash'] !== undefined && raw['lastSyncedHash'] !== null) {
		card.lastSyncedHash = asText(raw['lastSyncedHash']);
	}
	if (raw['ignore'] === true) card.ignore = true;
	if (raw['linkSource'] === true) card.linkSource = true;

	const validation = validateCard(card);
	if (!validation.valid) {
		return { success: false, error: validation.errors.join('; ') };
	}
	return { success: true, data: card, format };
}

function normalizeFields(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const fields: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		fields[key] = asText(value).replace(/\n+$/, '');
	}
	return fields;
}

/**
 * Coerce a value from a legacy block to text without producing
 * "[object Object]" for nested structures the old formats allowed.
 */
function asText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value) ?? '';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCard(card: AnkiCard): ValidationResult {
	const errors: string[] = [];

	if (!card.deck || card.deck.trim() === '') {
		errors.push('deck is required');
	}
	if (!card.model || card.model.trim() === '') {
		errors.push('model is required');
	}

	const fieldNames = Object.keys(card.fields);
	if (fieldNames.length === 0) {
		errors.push('at least one field box is required, e.g. [Front]');
	}
	const empty = fieldNames.filter(name => card.fields[name]!.trim() === '');
	if (empty.length === fieldNames.length && fieldNames.length > 0) {
		errors.push('all field boxes are empty');
	}

	return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

/**
 * Render a card as box format. Used when creating new cards and when migrating
 * a legacy block; routine syncs use `updateSyncLine` instead.
 */
export function serializeCard(card: Partial<AnkiCard>): string {
	const out: string[] = [];

	if (card.deck) out.push(`deck: ${card.deck}`);
	if (card.model) out.push(`model: ${card.model}`);
	if (card.tags && card.tags.length > 0) out.push(`tags: ${card.tags.join(', ')}`);
	if (card.title) out.push(`title: ${card.title}`);
	if (card.ignore) out.push('ignore: true');
	if (card.linkSource) out.push('linkSource: true');
	for (const [key, value] of Object.entries(card.extra ?? {})) {
		out.push(`${key}: ${value}`);
	}

	for (const [name, content] of Object.entries(card.fields ?? {})) {
		out.push('');
		out.push(`[${name}]`);
		out.push(escapeBody(content));
	}

	const sync = formatSyncLine(card.noteId ?? null, card.lastSyncedHash);
	if (sync) {
		out.push('');
		out.push(sync);
	}

	return out.join('\n');
}

/**
 * Escape any line in a field body that would otherwise read as a box marker.
 */
function escapeBody(content: string): string {
	return content
		.split('\n')
		.map(line => (isMarkerLine(line) ? `\\${line}` : line))
		.join('\n');
}

export function formatSyncLine(noteId: number | null, rev?: string): string | null {
	if (noteId === null && !rev) return null;
	const parts: string[] = [];
	if (noteId !== null) parts.push(`id=${noteId}`);
	if (rev) parts.push(`rev=${rev}`);
	return `[sync] ${parts.join(' ')}`;
}

/**
 * Replace (or append) the [sync] line in an existing block, leaving every other
 * byte untouched.
 *
 * This is what makes routine syncs non-destructive: the plugin never re-emits
 * the user's header or field content, so unknown keys, comments, spacing and
 * ordering all survive exactly as written.
 */
export function updateSyncLine(source: string, noteId: number | null, rev?: string): string {
	const syncLine = formatSyncLine(noteId, rev);
	const lines = source.split('\n');

	const existing = lines.findIndex(line => /^\[sync\]/i.test(line.trim()));
	if (existing !== -1) {
		if (syncLine === null) {
			lines.splice(existing, 1);
			while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
		} else {
			lines[existing] = syncLine;
		}
		return lines.join('\n');
	}

	if (syncLine === null) return source;

	while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
	lines.push('', syncLine);
	return lines.join('\n');
}
