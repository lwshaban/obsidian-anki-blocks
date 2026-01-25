import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type AnkiBlocksPlugin from './main';
import { AnkiConnectService } from './services/anki-connect';

/**
 * Plugin settings interface.
 */
export interface AnkiBlocksSettings {
	ankiConnectUrl: string;
	defaultDeck: string;
	defaultModel: string;
	collapsedDisplayFormat: string;
	expandedDisplayFormat: string;
	convertMarkdownToHtml: boolean;
}

/**
 * Default plugin settings.
 */
export const DEFAULT_SETTINGS: AnkiBlocksSettings = {
	ankiConnectUrl: 'http://localhost:8765',
	defaultDeck: 'Default',
	defaultModel: 'Basic',
	collapsedDisplayFormat: '{card-type}: {title}',
	expandedDisplayFormat: '{card-type}',
	convertMarkdownToHtml: true,
};

/**
 * Settings tab for AnkiBlocks plugin.
 */
export class AnkiBlocksSettingTab extends PluginSettingTab {
	plugin: AnkiBlocksPlugin;

	constructor(app: App, plugin: AnkiBlocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Connection section
		new Setting(containerEl).setName('Connection').setHeading();

		new Setting(containerEl)
			.setName('AnkiConnect URL')
			.setDesc('URL of the AnkiConnect server (default: http://localhost:8765)')
			.addText(text => text
				.setPlaceholder('http://localhost:8765')
				.setValue(this.plugin.settings.ankiConnectUrl)
				.onChange(async (value) => {
					this.plugin.settings.ankiConnectUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Verify that AnkiConnect is accessible')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					button.setButtonText('Testing...');
					button.setDisabled(true);

					const service = new AnkiConnectService(this.plugin.settings.ankiConnectUrl);
					const connected = await service.testConnection();

					if (connected) {
						new Notice('Successfully connected to Anki');
						button.setButtonText('Connected');
					} else {
						new Notice('Failed to connect. Is Anki running with AnkiConnect?');
						button.setButtonText('Failed');
					}

					setTimeout(() => {
						button.setButtonText('Test');
						button.setDisabled(false);
					}, 2000);
				}));

		// Defaults section
		new Setting(containerEl).setName('Defaults').setHeading();

		new Setting(containerEl)
			.setName('Default deck')
			.setDesc('The default deck name for new cards')
			.addText(text => text
				.setPlaceholder('Default')
				.setValue(this.plugin.settings.defaultDeck)
				.onChange(async (value) => {
					this.plugin.settings.defaultDeck = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default model')
			.setDesc('The default card type for new cards')
			.addDropdown(dropdown => dropdown
				.addOption('Basic', 'Basic')
				.addOption('Basic (and reversed card)', 'Basic (and reversed card)')
				.addOption('Cloze', 'Cloze')
				.setValue(this.plugin.settings.defaultModel)
				.onChange(async (value) => {
					this.plugin.settings.defaultModel = value;
					await this.plugin.saveSettings();
				}));

		// Display section
		new Setting(containerEl).setName('Display').setHeading();

		new Setting(containerEl)
			.setName('Collapsed display format')
			.setDesc('Template after "ANKI" for collapsed view. Available: {card-type}, {deck}, {title}, {tags}')
			.addText(text => text
				.setPlaceholder('{card-type}: {title}')
				.setValue(this.plugin.settings.collapsedDisplayFormat)
				.onChange(async (value) => {
					this.plugin.settings.collapsedDisplayFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Expanded display format')
			.setDesc('Template after "ANKI" for expanded view. Available: {card-type}, {deck}, {title}, {tags}')
			.addText(text => text
				.setPlaceholder('{card-type}')
				.setValue(this.plugin.settings.expandedDisplayFormat)
				.onChange(async (value) => {
					this.plugin.settings.expandedDisplayFormat = value;
					await this.plugin.saveSettings();
				}));

		// Conversion section
		new Setting(containerEl).setName('Content Conversion').setHeading();

		new Setting(containerEl)
			.setName('Convert Markdown to HTML')
			.setDesc('Automatically convert Markdown formatting to HTML when syncing to Anki. Anki uses HTML for card content.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.convertMarkdownToHtml)
				.onChange(async (value) => {
					this.plugin.settings.convertMarkdownToHtml = value;
					await this.plugin.saveSettings();
				}));

		// Help section
		new Setting(containerEl).setName('Help').setHeading();

		new Setting(containerEl)
			.setName('AnkiConnect required')
			.setDesc('This plugin requires Anki to be running with the AnkiConnect add-on installed.')
			.addButton(button => button
				.setButtonText('Get AnkiConnect')
				.onClick(() => {
					window.open('https://ankiweb.net/shared/info/2055492159', '_blank');
				}));
	}
}
