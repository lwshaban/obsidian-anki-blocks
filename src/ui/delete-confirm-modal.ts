import { Modal, Notice, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { AnkiConnectService } from '../services/anki-connect';
import { findAnkiBlocks } from '../commands/sync-command';
import { parseAnkiBlock, generateCardYaml } from '../services/parser';

/**
 * Modal to confirm deletion of an Anki card.
 */
export class DeleteConfirmModal extends Modal {
	private plugin: AnkiBlocksPlugin;
	private noteId: number;
	private file: TFile;
	private blockIndex: number;

	constructor(plugin: AnkiBlocksPlugin, noteId: number, file: TFile, blockIndex: number) {
		super(plugin.app);
		this.plugin = plugin;
		this.noteId = noteId;
		this.file = file;
		this.blockIndex = blockIndex;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'Delete Anki Card' });

		contentEl.createEl('p', {
			text: 'Are you sure you want to delete this card from Anki? This will:',
		});

		const list = contentEl.createEl('ul');
		list.createEl('li', { text: 'Remove the card from Anki (cannot be undone)' });
		list.createEl('li', { text: 'Clear the noteId and hash from the block in your file' });

		const buttonContainer = contentEl.createDiv({ cls: 'anki-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const deleteBtn = buttonContainer.createEl('button', {
			text: 'Delete',
			cls: 'mod-warning',
		});
		deleteBtn.addEventListener('click', () => this.handleDelete());
	}

	private async handleDelete(): Promise<void> {
		try {
			// Delete from Anki
			const ankiService = new AnkiConnectService(this.plugin.settings.ankiConnectUrl);
			await ankiService.deleteNote(this.noteId);

			// Update file to remove noteId and hash
			let content = await this.plugin.app.vault.read(this.file);
			const blocks = findAnkiBlocks(content);
			const block = blocks[this.blockIndex];

			if (block) {
				const parseResult = parseAnkiBlock(block.content);
				if (parseResult.success && parseResult.data) {
					const card = parseResult.data;
					card.noteId = null;
					delete card.lastSyncedHash;

					const newYaml = generateCardYaml(card);
					const newBlock = `\`\`\`\`\`anki\n${newYaml}\n\`\`\`\`\``;
					content = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);

					await this.plugin.app.vault.modify(this.file, content);
				}
			}

			new Notice('Card deleted from Anki');
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to delete card: ${message}`);
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
