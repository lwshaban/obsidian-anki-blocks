/**
 * Regex pattern to find anki code blocks in file content.
 * Matches 5-backtick fenced code blocks with 'anki' language.
 */
export const ANKI_BLOCK_REGEX = /`````anki\n([\s\S]*?)\n`````/g;

/**
 * Default fields for common Anki models.
 */
export const MODEL_FIELDS: Record<string, string[]> = {
	'Basic': ['Front', 'Back'],
	'Basic (and reversed card)': ['Front', 'Back'],
	'Basic (optional reversed card)': ['Front', 'Back'],
	'Cloze': ['Text', 'Extra'],
};

/**
 * Get fields for a model, falling back to defaults.
 */
export function getModelFields(model: string): string[] {
	return MODEL_FIELDS[model] ?? ['Front', 'Back'];
}

/**
 * Card template for new cards.
 */
export function getCardTemplate(deck: string, model: string): string {
	const fields = getModelFields(model);
	const fieldLines = fields
		.map((field, i) => `  ${field}: |\n    ${i === 0 ? 'Question here' : 'Answer here'}`)
		.join('\n');

	return `\`\`\`\`\`anki
deck: ${deck}
model: ${model}
fields:
${fieldLines}
tags: []
noteId: null
\`\`\`\`\``;
}
