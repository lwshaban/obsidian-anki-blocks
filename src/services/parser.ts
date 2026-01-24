import * as yaml from 'js-yaml';
import { AnkiCard, ParseResult, ValidationResult } from '../types';

/**
 * Parse an anki code block content, trying YAML first then JSON.
 */
export function parseAnkiBlock(source: string): ParseResult {
	const trimmed = source.trim();

	// Try YAML first (primary format)
	try {
		const data = yaml.load(trimmed);
		const validation = validateCard(data);
		if (!validation.valid) {
			return {
				success: false,
				error: validation.errors.join('; '),
			};
		}
		return {
			success: true,
			data: normalizeCard(data as AnkiCard),
		};
	} catch (yamlError) {
		// Try JSON as fallback
		try {
			const data: unknown = JSON.parse(trimmed);
			const validation = validateCard(data);
			if (!validation.valid) {
				return {
					success: false,
					error: validation.errors.join('; '),
				};
			}
			return {
				success: true,
				data: normalizeCard(data as AnkiCard),
			};
		} catch {
			// Both failed, return YAML error as it's the primary format
			const yamlMessage = yamlError instanceof Error ? yamlError.message : 'Unknown YAML error';
			return {
				success: false,
				error: `Invalid YAML: ${yamlMessage}`,
			};
		}
	}
}

/**
 * Validate that parsed data has required fields.
 */
export function validateCard(data: unknown): ValidationResult {
	const errors: string[] = [];

	if (!data || typeof data !== 'object') {
		return { valid: false, errors: ['Card data must be an object'] };
	}

	const card = data as Record<string, unknown>;

	// Check required fields
	if (!card.deck || typeof card.deck !== 'string' || card.deck.trim() === '') {
		errors.push('deck is required and must be a non-empty string');
	}

	if (!card.model || typeof card.model !== 'string' || card.model.trim() === '') {
		errors.push('model is required and must be a non-empty string');
	}

	if (!card.fields || typeof card.fields !== 'object' || Array.isArray(card.fields)) {
		errors.push('fields is required and must be an object');
	} else {
		const fields = card.fields as Record<string, unknown>;
		const fieldKeys = Object.keys(fields);
		if (fieldKeys.length === 0) {
			errors.push('fields must contain at least one field');
		}
		for (const key of fieldKeys) {
			if (typeof fields[key] !== 'string') {
				errors.push(`field "${key}" must be a string`);
			}
		}
	}

	// Check optional fields
	if (card.tags !== undefined) {
		if (!Array.isArray(card.tags)) {
			errors.push('tags must be an array');
		} else {
			for (let i = 0; i < card.tags.length; i++) {
				if (typeof card.tags[i] !== 'string') {
					errors.push(`tags[${i}] must be a string`);
				}
			}
		}
	}

	if (card.noteId !== undefined && card.noteId !== null) {
		if (typeof card.noteId !== 'number') {
			errors.push('noteId must be a number or null');
		}
	}

	// Check optional title
	if (card.title !== undefined && typeof card.title !== 'string') {
		errors.push('title must be a string');
	}

	// Check optional lastSyncedHash (can be string or number from YAML)
	if (card.lastSyncedHash !== undefined && typeof card.lastSyncedHash !== 'string' && typeof card.lastSyncedHash !== 'number') {
		errors.push('lastSyncedHash must be a string');
	}

	// Check optional ignore
	if (card.ignore !== undefined && typeof card.ignore !== 'boolean') {
		errors.push('ignore must be a boolean');
	}

	// Check optional linkSource
	if (card.linkSource !== undefined && typeof card.linkSource !== 'boolean') {
		errors.push('linkSource must be a boolean');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Normalize card data to ensure consistent types.
 */
function normalizeCard(card: AnkiCard): AnkiCard {
	const normalized: AnkiCard = {
		deck: card.deck.trim(),
		model: card.model.trim(),
		fields: normalizeFields(card.fields),
		tags: card.tags?.map(t => t.trim()) ?? [],
		noteId: card.noteId ?? null,
	};
	if (card.title) {
		normalized.title = card.title.trim();
	}
	if (card.lastSyncedHash !== undefined && card.lastSyncedHash !== null) {
		// Convert to string in case YAML parsed it as a number
		normalized.lastSyncedHash = String(card.lastSyncedHash);
	}
	if (card.ignore) {
		normalized.ignore = true;
	}
	if (card.linkSource) {
		normalized.linkSource = true;
	}
	return normalized;
}

/**
 * Normalize field values (trim trailing newlines from block scalars).
 */
function normalizeFields(fields: Record<string, string>): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		// YAML block scalars may have trailing newlines; trim them
		normalized[key] = value.replace(/\n+$/, '');
	}
	return normalized;
}

/**
 * Generate YAML string from card data.
 */
export function generateCardYaml(card: Partial<AnkiCard>): string {
	const lines: string[] = [];

	if (card.deck) {
		lines.push(`deck: ${card.deck}`);
	}
	if (card.model) {
		lines.push(`model: ${card.model}`);
	}
	if (card.title) {
		lines.push(`title: ${card.title}`);
	}
	if (card.ignore) {
		lines.push(`ignore: true`);
	}
	if (card.linkSource) {
		lines.push(`linkSource: true`);
	}

	if (card.fields && Object.keys(card.fields).length > 0) {
		lines.push('fields:');
		for (const [name, value] of Object.entries(card.fields)) {
			lines.push(`  ${name}: |`);
			// Indent each line of content by 4 spaces
			const contentLines = value.split('\n').map(l => `    ${l}`);
			lines.push(...contentLines);
		}
	}

	if (card.tags && card.tags.length > 0) {
		lines.push(`tags: [${card.tags.join(', ')}]`);
	}

	lines.push(`noteId: ${card.noteId ?? 'null'}`);

	if (card.lastSyncedHash) {
		lines.push(`lastSyncedHash: ${card.lastSyncedHash}`);
	}

	return lines.join('\n');
}
