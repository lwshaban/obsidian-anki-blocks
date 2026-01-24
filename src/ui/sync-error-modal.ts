import { App, Modal } from 'obsidian';

/**
 * Modal to display sync errors.
 */
export class SyncErrorModal extends Modal {
	private errors: string[];

	constructor(app: App, errors: string[]) {
		super(app);
		this.errors = errors;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Sync Errors' });
		contentEl.createEl('p', {
			text: 'The following errors occurred during sync:',
			cls: 'anki-error-intro'
		});

		const errorList = contentEl.createEl('ul', { cls: 'anki-error-list' });
		for (const error of this.errors) {
			errorList.createEl('li', { text: error });
		}

		const buttonContainer = contentEl.createDiv({ cls: 'anki-modal-buttons' });
		const closeBtn = buttonContainer.createEl('button', { text: 'Close' });
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
