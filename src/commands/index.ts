import { Platform } from 'obsidian';
import type AnkiBlocksPlugin from '../main';
import { syncCurrentFile, syncAllFiles } from './sync-command';
import { CardCreationModal } from '../ui/card-modal';

/**
 * Register all plugin commands.
 */
export function registerCommands(plugin: AnkiBlocksPlugin): void {
	// Sync commands only available on desktop (AnkiConnect requires Anki desktop)
	if (!Platform.isMobile) {
		// Sync current file to Anki
		plugin.addCommand({
			id: 'sync-current-file',
			name: 'Sync current file to Anki',
			callback: () => syncCurrentFile(plugin),
		});

		// Sync all files to Anki
		plugin.addCommand({
			id: 'sync-all-files',
			name: 'Sync all files to Anki',
			callback: () => syncAllFiles(plugin),
		});
	}

	// Insert new Anki card - available on all platforms
	plugin.addCommand({
		id: 'insert-anki-card',
		name: 'Insert new Anki card',
		editorCallback: (editor, view) => {
			new CardCreationModal(plugin.app, plugin, editor).open();
		},
	});
}
