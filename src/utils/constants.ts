/**
 * Matches anki code blocks in file content.
 *
 * Accepts any fence of three or more backticks or tildes, so both the current
 * `~~~anki` style and legacy `` `````anki `` blocks are found. Tilde fences are
 * preferred because only tildes close them, which means field content can hold
 * code blocks of any backtick length without escaping.
 *
 * Capture groups: 1 = indent, 2 = fence, 3 = body (keeps its trailing newline).
 */
export const ANKI_BLOCK_REGEX = /^([ \t]*)(`{3,}|~{3,})anki[ \t]*\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;

/** Fence used for blocks the plugin writes. */
export const DEFAULT_FENCE = '~~~';

/**
 * Default fields for common Anki models, used to pre-fill new cards. This is a
 * convenience only — the parser accepts any field names, and the real list is
 * fetched from Anki when it is reachable.
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
 * Wrap card body text in an anki fence.
 */
export function wrapInFence(body: string, fence: string = DEFAULT_FENCE): string {
	return `${fence}anki\n${body}\n${fence}`;
}

/**
 * Card template for new cards.
 */
export function getCardTemplate(deck: string, model: string): string {
	const fields = getModelFields(model);
	const boxes = fields
		.map((field, i) => `[${field}]\n${i === 0 ? 'Question here' : 'Answer here'}`)
		.join('\n\n');

	return wrapInFence(`deck: ${deck}\nmodel: ${model}\n\n${boxes}`);
}
