import type AnkiBlocksPlugin from '../main';
import { syncCurrentFile, syncAllFiles } from './sync-command';
import { CardCreationModal } from '../ui/card-modal';

/**
 * Register all plugin commands.
 */
export function registerCommands(plugin: AnkiBlocksPlugin): void {
	// Sync current file to Anki
	plugin.addCommand({
		id: 'sync-current-file',
		name: 'Sync current file to Anki',
		callback: () => syncCurrentFile(plugin),
	});

	// Insert new Anki card
	plugin.addCommand({
		id: 'insert-anki-card',
		name: 'Insert new Anki card',
		editorCallback: (editor, view) => {
			new CardCreationModal(plugin.app, plugin, editor).open();
		},
	});

	// Sync all files to Anki
	plugin.addCommand({
		id: 'sync-all-files',
		name: 'Sync all files to Anki',
		callback: () => syncAllFiles(plugin),
	});
}
