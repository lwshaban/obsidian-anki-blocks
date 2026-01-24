import { Notice, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { AnkiConnectService } from '../services/anki-connect';
import { parseAnkiBlock, generateCardYaml } from '../services/parser';
import { ANKI_BLOCK_REGEX } from '../utils/constants';
import { AnkiBlockMatch, SyncResult, GlobalSyncResult, AnkiCard } from '../types';
import { computeContentHash } from '../utils/hash';
import { SyncErrorModal } from '../ui/sync-error-modal';

/**
 * Build an Obsidian URI for the given file.
 */
function buildObsidianUri(plugin: AnkiBlocksPlugin, file: TFile): string {
	const vaultName = plugin.app.vault.getName();
	const encodedVault = encodeURIComponent(vaultName);
	const encodedFile = encodeURIComponent(file.path);
	return `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
}

/**
 * Get fields with source link appended if linkSource is enabled.
 */
function getFieldsForSync(card: AnkiCard, plugin: AnkiBlocksPlugin, file: TFile): Record<string, string> {
	if (!card.linkSource) {
		return card.fields;
	}

	const fields = { ...card.fields };
	const fieldNames = Object.keys(fields);
	const lastFieldName = fieldNames[fieldNames.length - 1];

	if (lastFieldName) {
		const uri = buildObsidianUri(plugin, file);
		const fileName = file.basename;
		const link = `<br><br><a href="${uri}">${fileName}</a>`;
		fields[lastFieldName] = fields[lastFieldName] + link;
	}

	return fields;
}

/**
 * Sync all Anki cards in the current file.
 */
export async function syncCurrentFile(plugin: AnkiBlocksPlugin): Promise<SyncResult> {
	const result: SyncResult = {
		success: true,
		created: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		errors: [],
	};

	// Get active file
	const file = plugin.app.workspace.getActiveFile();
	if (!file) {
		new Notice('No active file to sync');
		result.success = false;
		return result;
	}

	// Create AnkiConnect service
	const ankiService = new AnkiConnectService(plugin.settings.ankiConnectUrl);

	// Test connection
	const connected = await ankiService.testConnection();
	if (!connected) {
		new Notice('Cannot connect to Anki. Is Anki running with AnkiConnect?');
		result.success = false;
		return result;
	}

	// Read file content
	let content = await plugin.app.vault.read(file);

	// Find all anki blocks
	const blocks = findAnkiBlocks(content);

	if (blocks.length === 0) {
		new Notice('No Anki cards found in this file');
		return result;
	}

	// Parse all blocks and determine which need syncing
	interface CardToSync {
		index: number;
		block: AnkiBlockMatch;
		card: AnkiCard;
		currentHash: string;
		needsSync: boolean;
	}

	const cardsToProcess: CardToSync[] = [];
	const existingNoteIds: number[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i]!;
		const parseResult = parseAnkiBlock(block.content);

		if (!parseResult.success) {
			result.failed++;
			result.errors.push(`Block ${i + 1}: ${parseResult.error}`);
			continue;
		}

		const card = parseResult.data!;

		// Skip ignored cards
		if (card.ignore) {
			continue;
		}

		const currentHash = computeContentHash(card.fields, card.deck);
		const isNew = card.noteId === null;
		const isModified = !isNew && card.lastSyncedHash !== currentHash;

		// Only sync new or modified cards
		if (isNew || isModified) {
			cardsToProcess.push({ index: i, block, card, currentHash, needsSync: true });
			if (!isNew && card.noteId) {
				existingNoteIds.push(card.noteId);
			}
		} else {
			result.skipped++;
		}
	}

	if (cardsToProcess.length === 0) {
		new Notice(`All ${result.skipped} card(s) up to date`);
		return result;
	}

	new Notice(`Syncing ${cardsToProcess.length} card(s)...`);

	// Batch fetch note info for existing cards to validate
	const noteInfoMap = await ankiService.getNotesInfo(existingNoteIds);

	// Process blocks in reverse order so indices stay valid when we modify content
	let modified = false;
	for (let i = cardsToProcess.length - 1; i >= 0; i--) {
		const { index, block, card, currentHash } = cardsToProcess[i]!;

		try {
			// Get fields with source link if enabled
			const fieldsForSync = getFieldsForSync(card, plugin, file);

			if (card.noteId === null) {
				// Create new note
				const noteId = await ankiService.addNote(card, fieldsForSync);
				card.noteId = noteId;
				card.lastSyncedHash = currentHash;
				result.created++;

				// Update the block in the file with the new noteId and hash
				const newYaml = generateCardYaml(card);
				const newBlock = `\`\`\`\`\`anki\n${newYaml}\n\`\`\`\`\``;
				content = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);
				modified = true;
			} else {
				// Validate model matches before updating
				const ankiInfo = noteInfoMap.get(card.noteId);
				if (ankiInfo && ankiInfo.modelName !== card.model) {
					result.failed++;
					result.errors.push(`Block ${index + 1}: Model mismatch - Obsidian has "${card.model}" but Anki has "${ankiInfo.modelName}". Cannot change model for existing notes.`);
					continue;
				}

				// Update existing note
				await ankiService.updateNoteFields(card.noteId, fieldsForSync);

				// Update deck if it changed
				await ankiService.changeNoteDeck(card.noteId, card.deck);

				// Also update tags if present
				if (card.tags && card.tags.length > 0) {
					await ankiService.updateNoteTags(card.noteId, card.tags);
				}

				// Update hash
				card.lastSyncedHash = currentHash;
				const newYaml = generateCardYaml(card);
				const newBlock = `\`\`\`\`\`anki\n${newYaml}\n\`\`\`\`\``;
				content = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);
				modified = true;

				result.updated++;
			}
		} catch (error) {
			result.failed++;
			const message = error instanceof Error ? error.message : 'Unknown error';
			result.errors.push(`Block ${index + 1}: ${message}`);
		}
	}

	// Save modified content if noteIds were added
	if (modified) {
		await plugin.app.vault.modify(file, content);
	}

	// Show result notice
	if (result.failed === 0) {
		const parts = [];
		if (result.created > 0) parts.push(`${result.created} created`);
		if (result.updated > 0) parts.push(`${result.updated} updated`);
		if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
		new Notice(`Sync complete: ${parts.join(', ') || 'no changes'}`);
	} else {
		new Notice(`Sync completed with ${result.failed} error(s). See details.`);
		// Show error modal with details
		new SyncErrorModal(plugin.app, result.errors).open();
		// Also log to console for debugging
		for (const error of result.errors) {
			console.error('[AnkiBlocks]', error);
		}
	}

	result.success = result.failed === 0;
	return result;
}

/**
 * Find all anki code blocks in file content.
 */
export function findAnkiBlocks(content: string): AnkiBlockMatch[] {
	const blocks: AnkiBlockMatch[] = [];
	const regex = new RegExp(ANKI_BLOCK_REGEX);
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		blocks.push({
			content: match[1] ?? '',
			startIndex: match.index,
			endIndex: match.index + match[0].length,
			fullMatch: match[0],
		});
	}

	return blocks;
}

/**
 * Sync all Anki cards across all markdown files in the vault.
 */
export async function syncAllFiles(plugin: AnkiBlocksPlugin): Promise<GlobalSyncResult> {
	const result: GlobalSyncResult = {
		success: true,
		created: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		errors: [],
		filesProcessed: 0,
		filesWithCards: 0,
	};

	// Create AnkiConnect service
	const ankiService = new AnkiConnectService(plugin.settings.ankiConnectUrl);

	// Test connection
	const connected = await ankiService.testConnection();
	if (!connected) {
		new Notice('Cannot connect to Anki. Is Anki running with AnkiConnect?');
		result.success = false;
		return result;
	}

	// Get all markdown files
	const markdownFiles = plugin.app.vault.getMarkdownFiles();

	new Notice(`Scanning ${markdownFiles.length} files for Anki cards...`);

	// First pass: collect all cards that need syncing across all files
	interface GlobalCardToSync {
		file: TFile;
		index: number;
		block: AnkiBlockMatch;
		card: AnkiCard;
		currentHash: string;
	}

	const allCardsToSync: GlobalCardToSync[] = [];
	const existingNoteIds: number[] = [];
	const fileContents = new Map<string, string>();

	for (const file of markdownFiles) {
		result.filesProcessed++;

		const content = await plugin.app.vault.read(file);
		const blocks = findAnkiBlocks(content);

		if (blocks.length === 0) {
			continue;
		}

		result.filesWithCards++;
		fileContents.set(file.path, content);

		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i]!;
			const parseResult = parseAnkiBlock(block.content);

			if (!parseResult.success) {
				result.failed++;
				result.errors.push(`${file.path} block ${i + 1}: ${parseResult.error}`);
				continue;
			}

			const card = parseResult.data!;

			if (card.ignore) {
				continue;
			}

			const currentHash = computeContentHash(card.fields, card.deck);
			const isNew = card.noteId === null;
			const isModified = !isNew && card.lastSyncedHash !== currentHash;

			if (isNew || isModified) {
				allCardsToSync.push({ file, index: i, block, card, currentHash });
				if (!isNew && card.noteId) {
					existingNoteIds.push(card.noteId);
				}
			} else {
				result.skipped++;
			}
		}
	}

	if (allCardsToSync.length === 0) {
		new Notice(`All ${result.skipped} card(s) up to date`);
		return result;
	}

	new Notice(`Syncing ${allCardsToSync.length} card(s) across ${result.filesWithCards} files...`);

	// Batch fetch note info for all existing cards
	const noteInfoMap = await ankiService.getNotesInfo(existingNoteIds);

	// Group cards by file for processing
	const cardsByFile = new Map<string, GlobalCardToSync[]>();
	for (const cardInfo of allCardsToSync) {
		const existing = cardsByFile.get(cardInfo.file.path) || [];
		existing.push(cardInfo);
		cardsByFile.set(cardInfo.file.path, existing);
	}

	// Process each file
	for (const [filePath, cards] of cardsByFile) {
		let content = fileContents.get(filePath)!;
		let modified = false;
		const file = cards[0]!.file;

		// Process in reverse order to maintain indices
		const sortedCards = [...cards].sort((a, b) => b.block.startIndex - a.block.startIndex);

		for (const { index, block, card, currentHash } of sortedCards) {
			try {
				const fieldsForSync = getFieldsForSync(card, plugin, file);

				if (card.noteId === null) {
					const noteId = await ankiService.addNote(card, fieldsForSync);
					card.noteId = noteId;
					card.lastSyncedHash = currentHash;
					result.created++;

					const newYaml = generateCardYaml(card);
					const newBlock = `\`\`\`\`\`anki\n${newYaml}\n\`\`\`\`\``;
					content = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);
					modified = true;
				} else {
					// Validate model matches
					const ankiInfo = noteInfoMap.get(card.noteId);
					if (ankiInfo && ankiInfo.modelName !== card.model) {
						result.failed++;
						result.errors.push(`${filePath} block ${index + 1}: Model mismatch - Obsidian has "${card.model}" but Anki has "${ankiInfo.modelName}"`);
						continue;
					}

					await ankiService.updateNoteFields(card.noteId, fieldsForSync);
					await ankiService.changeNoteDeck(card.noteId, card.deck);

					if (card.tags && card.tags.length > 0) {
						await ankiService.updateNoteTags(card.noteId, card.tags);
					}

					card.lastSyncedHash = currentHash;
					const newYaml = generateCardYaml(card);
					const newBlock = `\`\`\`\`\`anki\n${newYaml}\n\`\`\`\`\``;
					content = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);
					modified = true;

					result.updated++;
				}
			} catch (error) {
				result.failed++;
				const message = error instanceof Error ? error.message : 'Unknown error';
				result.errors.push(`${filePath} block ${index + 1}: ${message}`);
			}
		}

		if (modified) {
			await plugin.app.vault.modify(file, content);
		}
	}

	// Show result notice
	if (result.failed === 0) {
		const parts = [];
		if (result.created > 0) parts.push(`${result.created} created`);
		if (result.updated > 0) parts.push(`${result.updated} updated`);
		if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
		new Notice(`Global sync complete: ${result.filesWithCards} files, ${parts.join(', ') || 'no changes'}`);
	} else {
		new Notice(`Global sync completed with ${result.failed} error(s). See details.`);
		// Show error modal with details
		new SyncErrorModal(plugin.app, result.errors).open();
		// Also log to console for debugging
		for (const error of result.errors) {
			console.error('[AnkiBlocks]', error);
		}
	}

	result.success = result.failed === 0;
	return result;
}
