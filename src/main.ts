import { Plugin } from 'obsidian';
import { AnkiBlocksSettings, AnkiBlocksSettingTab, DEFAULT_SETTINGS } from './settings';
import { registerCommands } from './commands';
import { registerAnkiBlockProcessor } from './ui/card-renderer';
import { syncCurrentFile } from './commands/sync-command';

export default class AnkiBlocksPlugin extends Plugin {
	settings: AnkiBlocksSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register commands
		registerCommands(this);

		// Register anki code block processor
		registerAnkiBlockProcessor(this);

		// Add settings tab
		this.addSettingTab(new AnkiBlocksSettingTab(this.app, this));

		// Add ribbon icon for quick sync
		this.addRibbonIcon('layers', 'Sync Anki cards', () => {
			void syncCurrentFile(this);
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AnkiBlocksSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
