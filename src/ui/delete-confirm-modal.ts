import { Modal, Notice, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { AnkiConnectService } from '../services/anki-connect';
import { updateSyncLine } from '../services/card-format';

/**
 * Modal to confirm deletion of an Anki card.
 *
 * Identifies the block by its line range rather than by an index or note ID, so
 * the right block is edited even when a note holds several unsynced cards.
 */
export class DeleteConfirmModal extends Modal {
	private plugin: AnkiBlocksPlugin;
	private noteId: number;
	private file: TFile;
	private lineStart: number;
	private lineEnd: number;

	constructor(plugin: AnkiBlocksPlugin, noteId: number, file: TFile, lineStart: number, lineEnd: number) {
		super(plugin.app);
		this.plugin = plugin;
		this.noteId = noteId;
		this.file = file;
		this.lineStart = lineStart;
		this.lineEnd = lineEnd;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl('h2', { text: 'Delete Anki card' });
		contentEl.createEl('p', { text: 'Delete this card from Anki? This will:' });

		const list = contentEl.createEl('ul');
		list.createEl('li', { text: 'Remove the note from Anki (cannot be undone)' });
		list.createEl('li', { text: 'Clear the [sync] line from the block in your note' });

		const buttonContainer = contentEl.createDiv({ cls: 'anki-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const deleteBtn = buttonContainer.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		deleteBtn.addEventListener('click', () => { void this.handleDelete(); });
	}

	private async handleDelete(): Promise<void> {
		try {
			const ankiService = new AnkiConnectService(this.plugin.settings.ankiConnectUrl);
			await ankiService.deleteNote(this.noteId);

			await this.plugin.app.vault.process(this.file, (data) => {
				const lines = data.split('\n');
				if (this.lineEnd >= lines.length) return data;

				const before = lines.slice(0, this.lineStart);
				const blockLines = lines.slice(this.lineStart, this.lineEnd + 1);
				const after = lines.slice(this.lineEnd + 1);

				// Keep the fences, clear the sync state from the body.
				const body = blockLines.slice(1, -1).join('\n');
				const cleared = updateSyncLine(body, null, undefined);

				return [...before, blockLines[0]!, ...cleared.split('\n'), blockLines[blockLines.length - 1]!, ...after]
					.join('\n');
			});

			new Notice('Card deleted from Anki');
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			new Notice(`Failed to delete card: ${message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
