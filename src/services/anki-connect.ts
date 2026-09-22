import { requestUrl } from 'obsidian';
import { AnkiCard, AnkiConnectRequest, AnkiConnectResponse } from '../types';

/**
 * What the plugin needs to know about a note that already exists in Anki.
 */
export interface AnkiNoteInfo {
	modelName: string;
	fields: string[];
	tags: string[];
	deckName: string;
}

/** Shape of a single `notesInfo` entry. */
interface RawNoteInfo {
	noteId: number;
	modelName: string;
	fields: Record<string, { value: string; order: number }>;
	tags: string[];
	cards: number[];
}

/**
 * Service for communicating with AnkiConnect API.
 */
export class AnkiConnectService {
	private url: string;

	constructor(url: string) {
		this.url = url;
	}

	/**
	 * Send a request to AnkiConnect.
	 */
	private async request<T>(action: string, params?: Record<string, unknown>): Promise<T> {
		const body: AnkiConnectRequest = {
			action,
			version: 6,
			params,
		};

		try {
			const response = await requestUrl({
				url: this.url,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});

			const result = response.json as AnkiConnectResponse<T>;

			if (result.error) {
				throw new Error(`AnkiConnect error: ${result.error}`);
			}

			return result.result;
		} catch (error) {
			if (error instanceof Error && error.message.includes('AnkiConnect')) {
				throw error;
			}
			throw new Error(
				'Cannot connect to Anki. Is Anki running with AnkiConnect installed?'
			);
		}
	}

	/**
	 * Test connection to AnkiConnect.
	 */
	async testConnection(): Promise<boolean> {
		try {
			await this.request<number>('version');
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get AnkiConnect version.
	 */
	async getVersion(): Promise<number> {
		return this.request<number>('version');
	}

	/**
	 * Get list of deck names.
	 */
	async getDecks(): Promise<string[]> {
		return this.request<string[]>('deckNames');
	}

	/**
	 * Get list of model names.
	 */
	async getModels(): Promise<string[]> {
		return this.request<string[]>('modelNames');
	}

	/**
	 * Get field names for a model.
	 */
	async getModelFields(modelName: string): Promise<string[]> {
		return this.request<string[]>('modelFieldNames', { modelName });
	}

	/**
	 * Add a new note to Anki.
	 * Returns the note ID.
	 * @param card - The card data
	 * @param fieldsOverride - Optional fields to use instead of card.fields (for adding source links)
	 */
	async addNote(card: AnkiCard, fieldsOverride?: Record<string, string>): Promise<number> {
		// Always ensure deck exists (createDeck is idempotent)
		await this.createDeck(card.deck);

		const noteId = await this.request<number | null>('addNote', {
			note: {
				deckName: card.deck,
				modelName: card.model,
				fields: fieldsOverride ?? card.fields,
				tags: card.tags ?? [],
				options: {
					allowDuplicate: false,
					duplicateScope: 'deck',
				},
			},
		});

		if (noteId === null) {
			throw new Error('Failed to create note. It may be a duplicate.');
		}

		return noteId;
	}

	/**
	 * Update fields of an existing note.
	 */
	async updateNoteFields(noteId: number, fields: Record<string, string>): Promise<void> {
		await this.request<null>('updateNoteFields', {
			note: {
				id: noteId,
				fields,
			},
		});
	}

	/**
	 * Replace a note's tags.
	 *
	 * Callers pass the tags Anki currently holds (already batched in via
	 * getNotesInfo) so this costs at most two requests rather than three.
	 * Clearing every tag is supported: an empty `next` removes what is there.
	 */
	async setNoteTags(noteId: number, current: string[], next: string[]): Promise<void> {
		const removed = current.filter(tag => !next.includes(tag));
		const added = next.filter(tag => !current.includes(tag));

		if (removed.length > 0) {
			await this.request<null>('removeTags', { notes: [noteId], tags: removed.join(' ') });
		}
		if (added.length > 0) {
			await this.request<null>('addTags', { notes: [noteId], tags: added.join(' ') });
		}
	}

	/**
	 * Check if a deck exists.
	 */
	async deckExists(deckName: string): Promise<boolean> {
		const decks = await this.request<string[]>('deckNames');
		return decks.includes(deckName);
	}

	/**
	 * Create a deck if it doesn't exist.
	 */
	async createDeck(deckName: string): Promise<void> {
		await this.request<number>('createDeck', { deck: deckName });
	}

	/**
	 * Move a note's cards into the given deck, creating it if needed.
	 *
	 * Only called when the deck actually differs from what Anki holds.
	 */
	async changeNoteDeck(noteId: number, deckName: string): Promise<void> {
		await this.createDeck(deckName);

		const cardIds = await this.request<number[]>('findCards', { query: `nid:${noteId}` });
		if (cardIds.length === 0) {
			throw new Error(`No cards found for note ${noteId}`);
		}

		await this.request<null>('changeDeck', { cards: cardIds, deck: deckName });
	}

	/**
	 * Get info for multiple notes in a single request.
	 *
	 * This is the one place note state is fetched during a sync; deck and tag
	 * comparisons are made against it so the per-card path stays at one or two
	 * requests instead of five.
	 */
	async getNotesInfo(noteIds: number[]): Promise<Map<number, AnkiNoteInfo>> {
		if (noteIds.length === 0) {
			return new Map();
		}

		const results = await this.request<Array<RawNoteInfo | null>>('notesInfo', { notes: noteIds });
		const cardIds = results.flatMap(note => (note?.cards ?? []));
		const deckByCard = await this.getDecksForCards(cardIds);

		const infoMap = new Map<number, AnkiNoteInfo>();
		for (const note of results) {
			// AnkiConnect returns an empty object for notes that no longer exist.
			if (!note || note.noteId === undefined) continue;
			const firstCard = note.cards?.[0];
			infoMap.set(note.noteId, {
				modelName: note.modelName,
				fields: Object.keys(note.fields ?? {}),
				tags: note.tags ?? [],
				deckName: (firstCard !== undefined ? deckByCard.get(firstCard) : undefined) ?? '',
			});
		}
		return infoMap;
	}

	/**
	 * Map card IDs to their deck names in a single request.
	 */
	private async getDecksForCards(cardIds: number[]): Promise<Map<number, string>> {
		const byCard = new Map<number, string>();
		if (cardIds.length === 0) return byCard;

		const decks = await this.request<Record<string, number[]>>('getDecks', { cards: cardIds });
		for (const [deckName, ids] of Object.entries(decks)) {
			for (const id of ids) byCard.set(id, deckName);
		}
		return byCard;
	}

	/**
	 * Find notes by query.
	 */
	async findNotes(query: string): Promise<number[]> {
		return this.request<number[]>('findNotes', { query });
	}

	/**
	 * Check if a note exists.
	 */
	async noteExists(noteId: number): Promise<boolean> {
		try {
			const info = await this.request<Array<{ noteId: number }>>('notesInfo', {
				notes: [noteId],
			});
			const noteData = info[0];
			return noteData !== undefined && noteData.noteId === noteId;
		} catch {
			return false;
		}
	}

	/**
	 * Delete a note.
	 */
	async deleteNote(noteId: number): Promise<void> {
		await this.request<null>('deleteNotes', {
			notes: [noteId],
		});
	}
}
