/**
 * Compute a simple hash of card content (fields + deck).
 * Uses djb2 algorithm for fast, consistent hashing.
 * Sorts fields by key to ensure consistent ordering.
 */
export function computeContentHash(fields: Record<string, string>, deck: string): string {
	// Sort fields by key for consistent ordering
	const sortedFields: Record<string, string> = {};
	for (const key of Object.keys(fields).sort()) {
		sortedFields[key] = fields[key]!;
	}
	const content = JSON.stringify({ deck, fields: sortedFields });
	let hash = 5381;
	for (let i = 0; i < content.length; i++) {
		hash = ((hash << 5) + hash) + content.charCodeAt(i);
	}
	return (hash >>> 0).toString(16);
}
