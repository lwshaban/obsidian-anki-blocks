import { Modal, Setting, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { serializeCard } from '../services/card-format';
import { AnkiCard } from '../types';
import { wrapInFence } from '../utils/constants';

/**
 * Modal for editing an existing Anki card.
 */
export class CardEditModal extends Modal {
	private plugin: AnkiBlocksPlugin;
	private file: TFile;
	private lineStart: number;
	private lineEnd: number;
	private card: AnkiCard;
	private onSave: () => void;

	// Editable fields
	private deck: string;
	private model: string;
	private title: string;
	private fields: Record<string, string>;
	private tags: string;

	constructor(
		plugin: AnkiBlocksPlugin,
		file: TFile,
		lineStart: number,
		lineEnd: number,
		card: AnkiCard,
		onSave: () => void
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.lineStart = lineStart;
		this.lineEnd = lineEnd;
		this.card = card;
		this.onSave = onSave;

		// Initialize with current values
		this.deck = card.deck;
		this.model = card.model;
		this.title = card.title || '';
		this.fields = { ...card.fields };
		this.tags = card.tags?.join(', ') || '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('anki-modal');

		contentEl.createEl('h2', { text: 'Edit Anki card' });

		const form = contentEl.createDiv({ cls: 'anki-modal-content' });

		// Deck input
		new Setting(form)
			.setName('Deck')
			.setDesc('Use :: for nested decks (e.g., Parent::Child)')
			.addText(text => {
				text
					.setPlaceholder('Deck name')
					.setValue(this.deck)
					.onChange(value => {
						this.deck = value;
					});
			});

		// Model (read-only for existing cards)
		new Setting(form)
			.setName('Model')
			.setDesc('Cannot change model for existing synced cards')
			.addText(text => {
				text
					.setValue(this.model)
					.setDisabled(this.card.noteId !== null);
				if (this.card.noteId === null) {
					text.onChange(value => {
						this.model = value;
					});
				}
			});

		// Title input
		new Setting(form)
			.setName('Title')
			.setDesc('Optional title shown when collapsed')
			.addText(text => {
				text
					.setPlaceholder('Card title...')
					.setValue(this.title)
					.onChange(value => {
						this.title = value;
					});
			});

		// Fields
		const fieldsContainer = form.createDiv({ cls: 'anki-modal-fields' });
		for (const [fieldName, fieldValue] of Object.entries(this.fields)) {
			const fieldDiv = fieldsContainer.createDiv({ cls: 'anki-modal-field' });
			fieldDiv.createEl('label', { text: fieldName });

			const textarea = fieldDiv.createEl('textarea');
			textarea.value = fieldValue;
			textarea.addEventListener('input', (e) => {
				this.fields[fieldName] = (e.target as HTMLTextAreaElement).value;
			});
		}

		// Tags input
		new Setting(form)
			.setName('Tags')
			.setDesc('Comma-separated tags')
			.addText(text => {
				text
					.setPlaceholder('tag1, tag2, tag3')
					.setValue(this.tags)
					.onChange(value => {
						this.tags = value;
					});
			});

		// Buttons
		const buttons = form.createDiv({ cls: 'anki-modal-buttons' });

		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });
		saveBtn.addEventListener('click', () => { void this.saveCard(); });
	}

	private async saveCard(): Promise<void> {
		// Validate
		if (!this.deck.trim()) {
			return;
		}

		// Parse tags
		const tagsList = this.tags
			.split(',')
			.map(t => t.trim())
			.filter(t => t !== '');

		// Build updated card
		const updatedCard: Partial<AnkiCard> = {
			deck: this.deck.trim(),
			model: this.model.trim(),
			fields: this.fields,
			tags: tagsList,
			noteId: this.card.noteId,
			lastSyncedHash: this.card.lastSyncedHash,
		};

		if (this.title.trim()) {
			updatedCard.title = this.title.trim();
		}
		if (this.card.ignore) {
			updatedCard.ignore = true;
		}
		if (this.card.linkSource) {
			updatedCard.linkSource = true;
		}

		if (this.card.extra) {
			updatedCard.extra = this.card.extra;
		}

		const newBlock = wrapInFence(serializeCard(updatedCard));

		// Replace the block by its line range so the correct one is edited even
		// when a note holds several unsynced cards.
		await this.plugin.app.vault.process(this.file, (data) => {
			const lines = data.split('\n');
			if (this.lineStart < 0 || this.lineEnd >= lines.length) return data;
			return [
				...lines.slice(0, this.lineStart),
				...newBlock.split('\n'),
				...lines.slice(this.lineEnd + 1),
			].join('\n');
		});

		this.onSave();
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
