/**
 * Markdown ↔ HTML conversion for Anki field content.
 *
 * Both directions delegate to Obsidian rather than hand-rolled regex, so field
 * content gets the same treatment it gets in a note — tables, nested lists,
 * footnotes, callouts, reference links and Obsidian's own extensions all work.
 */

import { App, Component, MarkdownRenderer, htmlToMarkdown } from 'obsidian';

/** Attributes Obsidian adds for its own rendering that mean nothing in Anki. */
const STRIPPED_ATTRIBUTES = ['class', 'dir', 'tabindex', 'contenteditable', 'spellcheck', 'style'];

/** Elements Obsidian injects as UI affordances, not content. */
const UI_SELECTORS = [
	'.copy-code-button',
	'.collapse-indicator',
	'.heading-collapse-indicator',
	'.list-collapse-indicator',
	'.footnote-backref',
	'.metadata-container',
	'.frontmatter',
	'.frontmatter-container',
];

/**
 * Render Markdown to HTML suitable for an Anki field.
 *
 * `vaultName` lets internal links become `obsidian://` URIs so they stay
 * clickable from inside Anki; without it they degrade to plain text.
 */
export async function markdownToHtml(
	app: App,
	markdown: string,
	sourcePath: string,
	vaultName?: string,
): Promise<string> {
	if (!markdown.trim()) return '';

	const host = document.createElement('div');
	const component = new Component();
	component.load();

	try {
		await MarkdownRenderer.render(app, markdown, host, sourcePath, component);
		cleanForAnki(host, vaultName);
		return host.innerHTML.trim();
	} finally {
		component.unload();
		host.remove();
	}
}

/**
 * Strip Obsidian-specific markup so the HTML stands alone inside Anki.
 */
function cleanForAnki(root: HTMLElement, vaultName?: string): void {
	for (const selector of UI_SELECTORS) {
		root.querySelectorAll(selector).forEach(el => { el.remove(); });
	}

	// Internal links point at vault paths Anki knows nothing about.
	root.querySelectorAll('a.internal-link, a[data-href]').forEach(el => {
		const anchor = el as HTMLAnchorElement;
		const target = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
		if (vaultName && target) {
			anchor.setAttribute(
				'href',
				`obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(target)}`,
			);
		} else {
			anchor.replaceWith(...Array.from(anchor.childNodes));
		}
	});

	// Obsidian resolves embeds to absolute app:// URLs. Anki looks media up by
	// bare filename in its own collection.media folder, so reduce to that.
	root.querySelectorAll('img, audio, video, source').forEach(el => {
		const src = el.getAttribute('src');
		if (src) el.setAttribute('src', toMediaFilename(src));
		el.removeAttribute('srcset');
		el.removeAttribute('loading');
	});

	// Unresolved embeds render as a placeholder span wrapping the link text.
	root.querySelectorAll('span.internal-embed').forEach(el => {
		const target = el.getAttribute('src');
		if (!target) return;
		const img = document.createElement('img');
		img.setAttribute('src', toMediaFilename(target));
		el.replaceWith(img);
	});

	stripAttributes(root);
}

/**
 * Reduce any src to the bare filename Anki stores in collection.media.
 */
export function toMediaFilename(src: string): string {
	const withoutQuery = src.split('?')[0]!.split('#')[0]!;
	const decoded = safeDecode(withoutQuery);
	const segments = decoded.split('/');
	return segments[segments.length - 1] || decoded;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function stripAttributes(root: HTMLElement): void {
	const walk = (el: Element) => {
		for (const name of STRIPPED_ATTRIBUTES) el.removeAttribute(name);
		for (const attr of Array.from(el.attributes)) {
			if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
				el.removeAttribute(attr.name);
			}
		}
		for (const child of Array.from(el.children)) walk(child);
	};
	for (const child of Array.from(root.children)) walk(child);
}

/**
 * Convert Anki's HTML back to Markdown. Obsidian ships this, so we use it.
 */
export function ankiHtmlToMarkdown(html: string): string {
	return htmlToMarkdown(html);
}

/**
 * Convert every field of a card from Markdown to HTML.
 */
export async function convertFieldsToHtml(
	app: App,
	fields: Record<string, string>,
	sourcePath: string,
	vaultName?: string,
): Promise<Record<string, string>> {
	const converted: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		converted[key] = await markdownToHtml(app, value, sourcePath, vaultName);
	}
	return converted;
}

/**
 * Convert every field of a note from HTML to Markdown.
 */
export function convertFieldsToMarkdown(fields: Record<string, string>): Record<string, string> {
	const converted: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		converted[key] = ankiHtmlToMarkdown(value);
	}
	return converted;
}
