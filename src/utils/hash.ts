import { AnkiCard } from '../types';

/**
 * Compute a hash of everything the plugin pushes to Anki.
 *
 * This covers fields, deck, model and tags: anything that can change what the
 * note looks like in Anki has to be in here, or an edit to it leaves the card
 * marked "Synced" and it never gets pushed.
 *
 * Uses djb2 for a short, stable, dependency-free digest.
 */
export function computeContentHash(card: Pick<AnkiCard, 'fields' | 'deck' | 'model' | 'tags'>): string {
	const sortedFields: Record<string, string> = {};
	for (const key of Object.keys(card.fields).sort()) {
		sortedFields[key] = card.fields[key]!;
	}

	const content = JSON.stringify({
		deck: card.deck,
		model: card.model,
		fields: sortedFields,
		tags: [...(card.tags ?? [])].sort(),
	});

	let hash = 5381;
	for (let i = 0; i < content.length; i++) {
		hash = ((hash << 5) + hash) + content.charCodeAt(i);
	}
	return (hash >>> 0).toString(16);
}
