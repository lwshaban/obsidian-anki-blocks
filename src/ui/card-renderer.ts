import { MarkdownRenderer, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, TFile } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { parseCard } from '../services/card-format';
import { AnkiCard } from '../types';
import { computeContentHash } from '../utils/hash';
import { DeleteConfirmModal } from './delete-confirm-modal';

/**
 * Register the anki code block processor.
 */
export function registerAnkiBlockProcessor(plugin: AnkiBlocksPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('anki', async (source, el, ctx) => {
		const result = parseCard(source);

		if (!result.success) {
			renderError(el, result.error ?? 'Unknown error');
			return;
		}

		// Create a render child for proper lifecycle management
		const renderChild = new MarkdownRenderChild(el);
		ctx.addChild(renderChild);

		await renderCardPreview(el, result.data!, ctx, renderChild, plugin);
	});
}

/**
 * Render an error message in the preview.
 */
function renderError(el: HTMLElement, message: string): void {
	const container = el.createDiv({ cls: 'anki-card-container anki-card-error' });
	const header = container.createDiv({ cls: 'anki-card-header' });
	header.createSpan({ cls: 'anki-card-icon', text: 'Error' });

	const content = container.createDiv({ cls: 'anki-card-content' });
	content.createEl('p', { text: message, cls: 'anki-error-message' });
}

/**
 * Render the display text with styled segments.
 * Always starts with "ANKI" in accent color, then renders the template.
 * {card-type} also gets accent styling.
 */
function renderDisplayText(container: HTMLElement, template: string, card: AnkiCard): void {
	// Always start with styled "ANKI"
	container.createSpan({ cls: 'anki-card-icon', text: 'ANKI' });

	// If template is empty, we're done
	if (!template.trim()) return;

	// Add a space after ANKI
	container.createSpan({ text: ' ' });

	// Replace placeholders with markers for splitting
	const replacements: Record<string, { text: string; cls?: string }> = {
		'{card-type}': { text: card.model, cls: 'anki-card-model' },
		'{deck}': { text: card.deck },
		'{title}': { text: card.title || '' },
		'{tags}': { text: card.tags?.join(', ') || '' },
	};

	// Split template by placeholders and render each part
	const regex = /(\{card-type\}|\{deck\}|\{title\}|\{tags\})/g;
	let lastIndex = 0;
	let match;

	while ((match = regex.exec(template)) !== null) {
		// Add text before the match
		if (match.index > lastIndex) {
			container.createSpan({ text: template.slice(lastIndex, match.index) });
		}

		// Add the matched placeholder with styling
		const matched = match[0];
		if (replacements[matched]) {
			const { text, cls } = replacements[matched];
			if (text) {
				container.createSpan({ cls, text });
			}
		}

		lastIndex = regex.lastIndex;
	}

	// Add remaining text after last match
	if (lastIndex < template.length) {
		container.createSpan({ text: template.slice(lastIndex) });
	}
}

/**
 * Render the card preview.
 */
async function renderCardPreview(
	el: HTMLElement,
	card: AnkiCard,
	ctx: MarkdownPostProcessorContext,
	renderChild: MarkdownRenderChild,
	plugin: AnkiBlocksPlugin,
): Promise<void> {
	const app = plugin.app;
	const container = el.createDiv({ cls: 'anki-card-container' });

	// Header with metadata
	const header = container.createDiv({ cls: 'anki-card-header' });

	// Title row with both collapsed and expanded display text
	const titleRow = header.createDiv({ cls: 'anki-card-title-row' });

	// Collapsed display text (visible when collapsed)
	const collapsedTextEl = titleRow.createSpan({ cls: 'anki-card-collapsed-text' });
	renderDisplayText(collapsedTextEl, plugin.settings.collapsedDisplayFormat, card);

	// Expanded display text (visible when expanded)
	const expandedTextEl = titleRow.createSpan({ cls: 'anki-card-expanded-text' });
	renderDisplayText(expandedTextEl, plugin.settings.expandedDisplayFormat, card);

	// Collapse toggle chevron on the right
	titleRow.createSpan({ cls: 'anki-card-collapse-toggle' });

	// Click anywhere on header to toggle collapse
	header.addEventListener('click', (e) => {
		// Don't toggle if clicking on buttons or interactive elements
		if ((e.target as HTMLElement).closest('button')) return;
		container.toggleClass('collapsed', !container.hasClass('collapsed'));
	});

	// Meta row (visible when expanded)
	const metaRow = header.createDiv({ cls: 'anki-card-meta-row' });
	metaRow.createSpan({ cls: 'anki-card-deck', text: card.deck });

	// Show ignored badge if card is ignored
	if (card.ignore) {
		const ignoredBadge = metaRow.createSpan({ cls: 'anki-card-sync-badge ignored' });
		ignoredBadge.createSpan({ text: 'Ignored' });
	} else if (card.noteId) {
		const currentHash = computeContentHash(card);
		const isModified = !card.lastSyncedHash || card.lastSyncedHash !== currentHash;
		if (isModified) {
			const syncBadge = metaRow.createSpan({ cls: 'anki-card-sync-badge modified' });
			syncBadge.createSpan({ text: 'Modified' });
		} else {
			const syncBadge = metaRow.createSpan({ cls: 'anki-card-sync-badge synced' });
			syncBadge.createSpan({ text: 'Synced' });
		}
	} else {
		const syncBadge = metaRow.createSpan({ cls: 'anki-card-sync-badge not-synced' });
		syncBadge.createSpan({ text: 'Not synced' });
	}

	// Fields
	const fieldsContainer = container.createDiv({ cls: 'anki-card-fields' });

	for (const [fieldName, fieldContent] of Object.entries(card.fields)) {
		const fieldEl = fieldsContainer.createDiv({ cls: 'anki-card-field' });

		// Field header with collapse toggle
		const fieldHeader = fieldEl.createDiv({ cls: 'anki-card-field-header' });
		fieldHeader.createSpan({ cls: 'anki-card-collapse-icon', text: '\u25BC' });
		fieldHeader.createSpan({ cls: 'anki-card-field-label', text: fieldName });

		// Field content (collapsible)
		const fieldContent_el = fieldEl.createDiv({ cls: 'anki-card-field-content' });

		// Render markdown content
		await MarkdownRenderer.render(
			app,
			fieldContent,
			fieldContent_el,
			ctx.sourcePath,
			renderChild
		);

		// Toggle collapse on header click
		fieldHeader.addEventListener('click', () => {
			fieldEl.toggleClass('collapsed', !fieldEl.hasClass('collapsed'));
		});
	}

	// Tags
	if (card.tags && card.tags.length > 0) {
		const tagsContainer = container.createDiv({ cls: 'anki-card-tags' });
		tagsContainer.createSpan({ cls: 'anki-card-tags-label', text: 'Tags:' });
		const tagsList = tagsContainer.createDiv({ cls: 'anki-card-tags-list' });
		for (const tag of card.tags) {
			tagsList.createSpan({ cls: 'anki-card-tag', text: tag });
		}
	}

	// Footer with actions
	const footer = container.createDiv({ cls: 'anki-card-footer' });

	if (card.noteId) {
		footer.createSpan({ cls: 'anki-card-note-id', text: `ID: ${card.noteId}` });

		// Delete button
		const deleteBtn = footer.createEl('button', {
			cls: 'anki-card-delete-btn',
			text: 'Delete',
		});
		deleteBtn.addEventListener('click', () => {
			const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
			// getSectionInfo gives this block's exact line range, so the right
			// block is edited even when a note holds several unsynced cards.
			const section = ctx.getSectionInfo(el);
			if (file instanceof TFile && section) {
				new DeleteConfirmModal(
					plugin,
					card.noteId!,
					file,
					section.lineStart,
					section.lineEnd,
				).open();
			} else {
				new Notice('Could not locate this card in the note.');
			}
		});
	}
}
