import { App, Modal, Setting, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { generateCardYaml } from '../services/parser';
import { AnkiCard } from '../types';
import { findAnkiBlocks } from '../commands/sync-command';

/**
 * Modal for editing an existing Anki card.
 */
export class CardEditModal extends Modal {
	private plugin: AnkiBlocksPlugin;
	private file: TFile;
	private blockIndex: number;
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
		blockIndex: number,
		card: AnkiCard,
		onSave: () => void
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.blockIndex = blockIndex;
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

		contentEl.createEl('h2', { text: 'Edit Anki Card' });

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
		saveBtn.addEventListener('click', () => this.saveCard());
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

		// Generate new YAML
		const yaml = generateCardYaml(updatedCard);
		const newBlock = `\`\`\`\`\`anki\n${yaml}\n\`\`\`\`\``;

		// Read file and find the block to replace
		const content = await this.plugin.app.vault.read(this.file);
		const blocks = findAnkiBlocks(content);

		if (this.blockIndex >= 0 && this.blockIndex < blocks.length) {
			const block = blocks[this.blockIndex]!;
			const newContent = content.substring(0, block.startIndex) + newBlock + content.substring(block.endIndex);
			await this.plugin.app.vault.modify(this.file, newContent);
		}

		this.onSave();
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
