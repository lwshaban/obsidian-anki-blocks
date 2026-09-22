import { Notice, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { AnkiConnectService, AnkiNoteInfo } from '../services/anki-connect';
import { parseCard, serializeCard, updateSyncLine } from '../services/card-format';
import { ANKI_BLOCK_REGEX, wrapInFence } from '../utils/constants';
import { AnkiBlockMatch, SyncResult, GlobalSyncResult, AnkiCard } from '../types';
import { computeContentHash } from '../utils/hash';
import { SyncErrorModal } from '../ui/sync-error-modal';
import { convertFieldsToHtml } from '../utils/markdown-html';

/**
 * Find all anki code blocks in file content.
 */
export function findAnkiBlocks(content: string): AnkiBlockMatch[] {
	const blocks: AnkiBlockMatch[] = [];
	const regex = new RegExp(ANKI_BLOCK_REGEX);
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		blocks.push({
			content: (match[3] ?? '').replace(/\n$/, ''),
			startIndex: match.index,
			endIndex: match.index + match[0].length,
			fullMatch: match[0],
			fence: match[2] ?? '~~~',
			indent: match[1] ?? '',
		});
	}

	return blocks;
}

/**
 * A card that has been parsed out of a file and needs pushing to Anki.
 */
interface PendingCard {
	file: TFile;
	/** 1-based position of the block within its file, for error messages. */
	position: number;
	block: AnkiBlockMatch;
	card: AnkiCard;
	currentHash: string;
	/** True when the block is in a legacy syntax and should be rewritten. */
	needsMigration: boolean;
}

/**
 * Build an Obsidian URI for the given file.
 */
function buildObsidianUri(plugin: AnkiBlocksPlugin, file: TFile): string {
	const vaultName = plugin.app.vault.getName();
	return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file.path)}`;
}

/**
 * Get fields ready for sync to Anki: Markdown converted to HTML if enabled,
 * plus a link back to the source note if the card asked for one.
 */
async function getFieldsForSync(
	card: AnkiCard,
	plugin: AnkiBlocksPlugin,
	file: TFile,
): Promise<Record<string, string>> {
	let fields = { ...card.fields };

	if (plugin.settings.convertMarkdownToHtml) {
		fields = await convertFieldsToHtml(plugin.app, fields, file.path, plugin.app.vault.getName());
	}

	if (card.linkSource) {
		const fieldNames = Object.keys(fields);
		const lastFieldName = fieldNames[fieldNames.length - 1];
		if (lastFieldName) {
			const uri = buildObsidianUri(plugin, file);
			fields[lastFieldName] = `${fields[lastFieldName]}<br><br><a href="${uri}">${file.basename}</a>`;
		}
	}

	return fields;
}

/**
 * Scan one file and collect the cards that need pushing.
 *
 * Uses cachedRead: this pass never writes, and on a whole-vault sync it runs
 * against every note in the vault.
 */
async function collectFromFile(
	plugin: AnkiBlocksPlugin,
	file: TFile,
	result: SyncResult,
): Promise<PendingCard[]> {
	const content = await plugin.app.vault.cachedRead(file);
	const blocks = findAnkiBlocks(content);
	const pending: PendingCard[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i]!;
		const parsed = parseCard(block.content);

		if (!parsed.success) {
			result.failed++;
			result.errors.push(`${file.path} block ${i + 1}: ${parsed.error}`);
			continue;
		}

		const card = parsed.data!;
		if (card.ignore) continue;

		const currentHash = computeContentHash(card);
		const isNew = card.noteId === null;
		const isModified = card.lastSyncedHash !== currentHash;
		const needsMigration = parsed.format !== 'box';

		if (isNew || isModified || needsMigration) {
			pending.push({ file, position: i + 1, block, card, currentHash, needsMigration });
		} else {
			result.skipped++;
		}
	}

	return pending;
}

/**
 * Push one card to Anki and return the block text that should replace it.
 *
 * Returns null when the block does not need rewriting.
 */
async function pushCard(
	pending: PendingCard,
	plugin: AnkiBlocksPlugin,
	anki: AnkiConnectService,
	noteInfo: Map<number, AnkiNoteInfo>,
	result: SyncResult,
): Promise<string | null> {
	const { card, currentHash, file, position } = pending;
	const fieldsForSync = await getFieldsForSync(card, plugin, file);

	if (card.noteId === null) {
		const noteId = await anki.addNote(card, fieldsForSync);
		card.noteId = noteId;
		card.lastSyncedHash = currentHash;
		result.created++;
		return renderBlock(pending);
	}

	const info = noteInfo.get(card.noteId);

	if (!info) {
		result.failed++;
		result.errors.push(
			`${file.path} block ${position}: note ${card.noteId} no longer exists in Anki. ` +
			`Remove the [sync] line to recreate it.`,
		);
		return null;
	}

	if (info.modelName !== card.model) {
		result.failed++;
		result.errors.push(
			`${file.path} block ${position}: model mismatch — Obsidian has "${card.model}" but Anki has ` +
			`"${info.modelName}". Anki cannot change the note type of an existing note.`,
		);
		return null;
	}

	await anki.updateNoteFields(card.noteId, fieldsForSync);

	// Only touch the deck and tags when they actually differ; each of these is
	// several extra round trips.
	if (info.deckName !== card.deck) {
		await anki.changeNoteDeck(card.noteId, card.deck);
	}
	const desiredTags = card.tags ?? [];
	if (!sameTags(info.tags, desiredTags)) {
		await anki.setNoteTags(card.noteId, info.tags, desiredTags);
	}

	card.lastSyncedHash = currentHash;
	result.updated++;
	return renderBlock(pending);
}

/**
 * Produce the replacement text for a block.
 *
 * For a block already in box format this only splices the [sync] line, leaving
 * every other byte — comments, spacing, unknown keys, field order — untouched.
 * Legacy blocks are rewritten once, into box format.
 */
function renderBlock(pending: PendingCard): string {
	const { block, card, needsMigration } = pending;
	const { indent } = block;

	const body = needsMigration
		? serializeCard(card)
		: updateSyncLine(block.content, card.noteId, card.lastSyncedHash);

	const fence = needsMigration && block.fence.startsWith('`') ? '~~~' : block.fence;
	const rebuilt = wrapInFence(body, fence);

	return indent ? rebuilt.split('\n').map(l => (l ? indent + l : l)).join('\n') : rebuilt;
}

function sameTags(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const left = [...a].sort();
	const right = [...b].sort();
	return left.every((tag, i) => tag === right[i]);
}

/**
 * Apply block replacements to a file atomically.
 *
 * vault.process re-reads the file under a lock, so edits made while we were
 * waiting on the network are not clobbered. Replacements are applied back to
 * front so earlier offsets stay valid.
 */
async function applyReplacements(
	plugin: AnkiBlocksPlugin,
	file: TFile,
	replacements: Array<{ block: AnkiBlockMatch; text: string }>,
): Promise<boolean> {
	if (replacements.length === 0) return false;

	let applied = true;
	await plugin.app.vault.process(file, (data) => {
		// Verify the file still looks the way it did when we parsed it. If it
		// changed under us, skip the write rather than corrupt the note.
		for (const { block } of replacements) {
			if (data.slice(block.startIndex, block.endIndex) !== block.fullMatch) {
				applied = false;
				return data;
			}
		}

		let next = data;
		const ordered = [...replacements].sort((a, b) => b.block.startIndex - a.block.startIndex);
		for (const { block, text } of ordered) {
			next = next.slice(0, block.startIndex) + text + next.slice(block.endIndex);
		}
		return next;
	});

	return applied;
}

/**
 * Core sync routine shared by the single-file and whole-vault commands.
 */
async function syncFiles(
	plugin: AnkiBlocksPlugin,
	files: TFile[],
	result: GlobalSyncResult,
): Promise<GlobalSyncResult> {
	const anki = new AnkiConnectService(plugin.settings.ankiConnectUrl);

	if (!(await anki.testConnection())) {
		new Notice('Cannot connect to Anki. Is Anki running with AnkiConnect?');
		result.success = false;
		return result;
	}

	const pendingByFile = new Map<TFile, PendingCard[]>();
	const noteIds: number[] = [];

	for (const file of files) {
		result.filesProcessed++;
		const pending = await collectFromFile(plugin, file, result);
		if (pending.length === 0) continue;

		result.filesWithCards++;
		pendingByFile.set(file, pending);
		for (const item of pending) {
			if (item.card.noteId !== null) noteIds.push(item.card.noteId);
		}
	}

	const totalPending = [...pendingByFile.values()].reduce((n, list) => n + list.length, 0);
	if (totalPending === 0) {
		new Notice(result.skipped > 0 ? `All ${result.skipped} card(s) up to date` : 'No Anki cards found');
		return result;
	}

	new Notice(`Syncing ${totalPending} card(s)...`);

	const noteInfo = await anki.getNotesInfo(noteIds);
	const staleFiles: string[] = [];

	for (const [file, pending] of pendingByFile) {
		const replacements: Array<{ block: AnkiBlockMatch; text: string }> = [];

		for (const item of pending) {
			try {
				const text = await pushCard(item, plugin, anki, noteInfo, result);
				if (text !== null) replacements.push({ block: item.block, text });
			} catch (error) {
				result.failed++;
				const message = error instanceof Error ? error.message : 'Unknown error';
				result.errors.push(`${file.path} block ${item.position}: ${message}`);
			}
		}

		const applied = await applyReplacements(plugin, file, replacements);
		if (!applied && replacements.length > 0) staleFiles.push(file.path);
	}

	for (const path of staleFiles) {
		result.errors.push(
			`${path}: file changed during sync, so note IDs were not written back. ` +
			`Cards reached Anki — run sync again to record them.`,
		);
		result.failed++;
	}

	reportResult(plugin, result);
	result.success = result.failed === 0;
	return result;
}

function emptyResult(): GlobalSyncResult {
	return {
		success: true,
		created: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		errors: [],
		filesProcessed: 0,
		filesWithCards: 0,
	};
}

function reportResult(plugin: AnkiBlocksPlugin, result: GlobalSyncResult): void {
	if (result.failed === 0) {
		const parts: string[] = [];
		if (result.created > 0) parts.push(`${result.created} created`);
		if (result.updated > 0) parts.push(`${result.updated} updated`);
		if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
		new Notice(`Sync complete: ${parts.join(', ') || 'no changes'}`);
		return;
	}

	new Notice(`Sync completed with ${result.failed} error(s). See details.`);
	new SyncErrorModal(plugin.app, result.errors).open();
	for (const error of result.errors) {
		console.error('[AnkiBlocks]', error);
	}
}

/**
 * Sync all Anki cards in the current file.
 */
export async function syncCurrentFile(plugin: AnkiBlocksPlugin): Promise<SyncResult> {
	const file = plugin.app.workspace.getActiveFile();
	if (!file) {
		new Notice('No active file to sync');
		return { ...emptyResult(), success: false };
	}
	return syncFiles(plugin, [file], emptyResult());
}

/**
 * Sync all Anki cards across all markdown files in the vault.
 */
export async function syncAllFiles(plugin: AnkiBlocksPlugin): Promise<GlobalSyncResult> {
	const files = plugin.app.vault.getMarkdownFiles();
	new Notice(`Scanning ${files.length} files for Anki cards...`);
	return syncFiles(plugin, files, emptyResult());
}
