/**
 * Source syntax a block was written in.
 *
 * 'box' is the current format. 'yaml' and 'json' are read-only legacy formats
 * kept so existing vaults keep working; blocks are rewritten as 'box' on sync.
 */
export type CardFormat = 'box' | 'yaml' | 'json';

/**
 * Represents an Anki card as defined in an anki code block.
 */
export interface AnkiCard {
	deck: string;
	model: string;
	fields: Record<string, string>;
	tags?: string[];
	noteId: number | null;
	title?: string;  // Optional title shown when card is collapsed
	lastSyncedHash?: string;  // Hash of fields at last successful sync
	ignore?: boolean;  // If true, skip this card during sync
	linkSource?: boolean;  // If true, append Obsidian URI to card when syncing
	/** Header keys we don't recognise, preserved verbatim across round-trips. */
	extra?: Record<string, string>;
}

/**
 * Result from parsing an anki code block.
 */
export interface ParseResult {
	success: boolean;
	data?: AnkiCard;
	error?: string;
	/** Which syntax the block was written in. Present whenever parsing succeeded. */
	format?: CardFormat;
}

/**
 * Result from validating a card.
 */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Result from syncing a single card.
 */
export interface SyncCardResult {
	success: boolean;
	noteId?: number;
	error?: string;
	isNew: boolean;
}

/**
 * Result from syncing all cards in a file.
 */
export interface SyncResult {
	success: boolean;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
	errors: string[];
}

/**
 * Result from syncing all files in the vault.
 */
export interface GlobalSyncResult extends SyncResult {
	filesProcessed: number;
	filesWithCards: number;
}

/**
 * Represents a matched anki block in a file with position info.
 */
export interface AnkiBlockMatch {
	content: string;
	startIndex: number;
	endIndex: number;
	fullMatch: string;
	/** The opening fence exactly as written, e.g. '~~~' or '`````'. */
	fence: string;
	/** Leading whitespace the fence was indented by, if any. */
	indent: string;
}

/**
 * AnkiConnect API request structure.
 */
export interface AnkiConnectRequest {
	action: string;
	version: number;
	params?: Record<string, unknown>;
}

/**
 * AnkiConnect API response structure.
 */
export interface AnkiConnectResponse<T = unknown> {
	result: T;
	error: string | null;
}
