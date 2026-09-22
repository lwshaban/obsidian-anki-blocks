import { App, Editor, Modal, Setting } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { serializeCard } from '../services/card-format';
import { getModelFields, wrapInFence } from '../utils/constants';

/**
 * Modal for creating a new Anki card.
 */
export class CardCreationModal extends Modal {
	private plugin: AnkiBlocksPlugin;
	private editor: Editor;
	private deck: string;
	private model: string;
	private fields: Record<string, string>;
	private tags: string;

	constructor(app: App, plugin: AnkiBlocksPlugin, editor: Editor) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.deck = plugin.settings.defaultDeck;
		this.model = plugin.settings.defaultModel;
		this.fields = {};
		this.tags = '';

		// Initialize fields for default model
		this.initFieldsForModel(this.model);
	}

	private initFieldsForModel(model: string): void {
		const fieldNames = getModelFields(model);
		this.fields = {};
		for (const name of fieldNames) {
			this.fields[name] = '';
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('anki-modal');

		contentEl.createEl('h2', { text: 'Insert Anki card' });

		const form = contentEl.createDiv({ cls: 'anki-modal-content' });

		// Deck input
		new Setting(form)
			.setName('Deck')
			.setDesc('The Anki deck to add this card to')
			.addText(text => {
				text
					.setPlaceholder('Deck name')
					.setValue(this.deck)
					.onChange(value => {
						this.deck = value;
					});
			});

		// Model dropdown
		new Setting(form)
			.setName('Model')
			.setDesc('The card type/template')
			.addDropdown(dropdown => {
				dropdown
					.addOption('Basic', 'Basic')
					.addOption('Basic (and reversed card)', 'Basic (and reversed card)')
					.addOption('Cloze', 'Cloze')
					.setValue(this.model)
					.onChange(value => {
						this.model = value;
						this.initFieldsForModel(value);
						this.renderFieldInputs(fieldsContainer);
					});
			});

		// Fields container (will be re-rendered when model changes)
		const fieldsContainer = form.createDiv({ cls: 'anki-modal-fields' });
		this.renderFieldInputs(fieldsContainer);

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

		const insertBtn = buttons.createEl('button', { text: 'Insert', cls: 'mod-cta' });
		insertBtn.addEventListener('click', () => this.insertCard());
	}

	private renderFieldInputs(container: HTMLElement): void {
		container.empty();

		const fieldNames = getModelFields(this.model);

		for (const fieldName of fieldNames) {
			const fieldDiv = container.createDiv({ cls: 'anki-modal-field' });
			fieldDiv.createEl('label', { text: fieldName });

			const textarea = fieldDiv.createEl('textarea', {
				placeholder: fieldName === 'Front' || fieldName === 'Text' ? 'Question...' : 'Answer...',
			});
			textarea.value = this.fields[fieldName] || '';
			textarea.addEventListener('input', (e) => {
				this.fields[fieldName] = (e.target as HTMLTextAreaElement).value;
			});
		}
	}

	private insertCard(): void {
		// Validate
		if (!this.deck.trim()) {
			return;
		}
		if (!this.model.trim()) {
			return;
		}

		// Check at least one field has content
		const hasContent = Object.values(this.fields).some(v => v.trim() !== '');
		if (!hasContent) {
			return;
		}

		// Parse tags
		const tagsList = this.tags
			.split(',')
			.map(t => t.trim())
			.filter(t => t !== '');

		const body = serializeCard({
			deck: this.deck.trim(),
			model: this.model.trim(),
			fields: this.fields,
			tags: tagsList,
			noteId: null,
		});

		this.editor.replaceSelection(wrapInFence(body) + '\n');

		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
