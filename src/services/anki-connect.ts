import { requestUrl } from 'obsidian';
import { AnkiCard, AnkiConnectRequest, AnkiConnectResponse } from '../types';

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
	 * Update tags of an existing note.
	 */
	async updateNoteTags(noteId: number, tags: string[]): Promise<void> {
		// First get existing tags
		const noteInfo = await this.request<Array<{ tags: string[] }>>('notesInfo', {
			notes: [noteId],
		});

		const noteData = noteInfo[0];
		if (!noteData) {
			throw new Error(`Note with ID ${noteId} not found`);
		}

		const existingTags = noteData.tags;

		// Remove old tags
		if (existingTags.length > 0) {
			await this.request<null>('removeTags', {
				notes: [noteId],
				tags: existingTags.join(' '),
			});
		}

		// Add new tags
		if (tags.length > 0) {
			await this.request<null>('addTags', {
				notes: [noteId],
				tags: tags.join(' '),
			});
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
	 * Change the deck of a note's cards.
	 * Creates the deck if it doesn't exist.
	 */
	async changeNoteDeck(noteId: number, deckName: string): Promise<void> {
		// Ensure deck exists
		const exists = await this.deckExists(deckName);
		if (!exists) {
			await this.createDeck(deckName);
		}

		// Get card IDs for this note
		const cardIds = await this.request<number[]>('findCards', {
			query: `nid:${noteId}`,
		});

		if (cardIds.length === 0) {
			throw new Error(`No cards found for note ${noteId}`);
		}

		await this.request<null>('changeDeck', {
			cards: cardIds,
			deck: deckName,
		});
	}

	/**
	 * Get info for multiple notes in a single request.
	 */
	async getNotesInfo(noteIds: number[]): Promise<Map<number, { modelName: string; fields: string[] }>> {
		if (noteIds.length === 0) {
			return new Map();
		}

		const results = await this.request<Array<{
			noteId: number;
			modelName: string;
			fields: Record<string, { value: string; order: number }>;
		} | null>>('notesInfo', { notes: noteIds });

		const infoMap = new Map<number, { modelName: string; fields: string[] }>();
		for (const note of results) {
			if (note) {
				infoMap.set(note.noteId, {
					modelName: note.modelName,
					fields: Object.keys(note.fields),
				});
			}
		}
		return infoMap;
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
