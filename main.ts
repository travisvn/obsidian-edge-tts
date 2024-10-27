import { Plugin, MarkdownView, Notice, PluginSettingTab, Setting } from 'obsidian';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts-browserify';
import { filterMarkdown } from 'utils';

// Top voices to be displayed in the dropdown
const TOP_VOICES = [
	'en-US-AndrewNeural',
	'en-US-AriaNeural',
	'en-US-AvaNeural',
	'en-US-ChristopherNeural',
	'en-US-SteffanNeural',
	'en-IE-ConnorNeural',
	'en-GB-RyanNeural',
	'en-GB-SoniaNeural',
	'en-AU-NatashaNeural',
	'en-AU-WilliamNeural',
];

// Settings interface and default settings
interface EdgeTTSPluginSettings {
	selectedVoice: string;
	customVoice: string;
	showRibbonIcon: boolean;
	showNotices: boolean;
}

const DEFAULT_SETTINGS: EdgeTTSPluginSettings = {
	selectedVoice: 'en-US-ChristopherNeural',
	customVoice: '',
	showRibbonIcon: true,
	showNotices: false,
};

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	ribbonIconEl: HTMLElement | null = null;
	audioContext: AudioContext | null = null;

	async onload() {
		console.log('Loading Obsidian Edge TTS Plugin');

		// Load settings
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new EdgeTTSPluginSettingTab(this.app, this));

		// Add the ribbon icon if enabled
		if (this.settings.showRibbonIcon) {
			this.addPluginRibbonIcon();
		}

		// Add command to read notes aloud
		this.addCommand({
			id: 'read-note-aloud',
			name: 'Read Note Aloud',
			callback: () => this.readNoteAloud(),
			hotkeys: [{ modifiers: ["Mod"], key: "R" }]
		});
	}

	addPluginRibbonIcon(): void {
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
		}

		this.ribbonIconEl = this.addRibbonIcon('audio-lines', 'Read Note Aloud', () => {
			this.readNoteAloud();
		});
	}

	removePluginRibbonIcon(): void {
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	async readNoteAloud() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			const selectedText = editor.getSelection() || editor.getValue();

			if (selectedText.trim()) {
				const cleanText = filterMarkdown(selectedText);

				if (cleanText.trim()) {
					try {
						if (this.settings.showNotices) {
							new Notice('Processing text-to-speech...');
						}

						const tts = new MsEdgeTTS();
						const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;
						await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);

						const readable = tts.toStream(cleanText);
						this.audioContext = new AudioContext();
						const source = this.audioContext.createBufferSource();
						// eslint-disable-next-line prefer-const
						let audioBuffer: Uint8Array[] = [];

						readable.on('data', (data) => {
							audioBuffer.push(data);
						});

						readable.on('end', async () => {
							try {
								const completeBuffer = new Uint8Array(Buffer.concat(audioBuffer));
								const audioBufferDecoded = await this.audioContext!.decodeAudioData(completeBuffer.buffer);

								source.buffer = audioBufferDecoded;
								source.connect(this.audioContext!.destination);
								source.start(0);

								source.onended = () => {
									this.cleanupAudioContext();
									if (this.settings.showNotices) {
										new Notice('Finished reading aloud.');
									}
								};

								console.log('Audio playback started');
							} catch (decodeError) {
								console.error('Error decoding audio:', decodeError);
								this.cleanupAudioContext();
								if (this.settings.showNotices) {
									new Notice('Failed to decode audio.');
								}
							}
						});
					} catch (error) {
						console.error('Error reading note aloud:', error);
						if (this.settings.showNotices) {
							new Notice('Failed to read note aloud.');
						}
					}
				} else {
					if (this.settings.showNotices) {
						new Notice('No readable text after filtering.');
					}
				}
			} else {
				if (this.settings.showNotices) {
					new Notice('No text selected or available.');
				}
			}
		}
	}

	cleanupAudioContext() {
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		console.log('Unloading Obsidian Edge TTS Plugin');
		this.removePluginRibbonIcon();
		this.cleanupAudioContext();
	}
}

class EdgeTTSPluginSettingTab extends PluginSettingTab {
	plugin: EdgeTTSPlugin;

	constructor(app: any, plugin: EdgeTTSPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Edge TTS Plugin Settings' });

		// Add a text notice about sampling voices
		const inbetweenInfo = containerEl.createEl('div', {
			cls: 'inbetween-info-div'
		})

		const infoText = document.createElement('p');
		const secondLink = document.createElement('a');
		secondLink.href = 'https://tts.travisvn.com';
		secondLink.text = 'tts.travisvn.com';
		infoText.append('You can sample available voices at ');
		infoText.append(secondLink);

		inbetweenInfo.appendChild(infoText)

		// Dropdown for top voices
		new Setting(containerEl)
			.setName('Select Voice')
			.setDesc('Choose from the top voices.')
			.setClass('default-style')
			.addDropdown(dropdown => {
				TOP_VOICES.forEach(voice => {
					dropdown.addOption(voice, voice);
				});
				dropdown.setValue(this.plugin.settings.selectedVoice);
				dropdown.onChange(async (value) => {
					this.plugin.settings.selectedVoice = value;
					await this.plugin.saveSettings();
				});
			});

		const patternFragment = document.createDocumentFragment();
		const link = document.createElement('a');
		link.href = 'https://tts.travisvn.com';
		link.text = 'tts.travisvn.com';
		patternFragment.append('(OPTIONAL) Enter custom voice. Visit ');
		patternFragment.append(link);
		patternFragment.append(' for list of options. ');
		patternFragment.append('Leave empty to use the selected voice above.')

		// Text input for custom voice
		new Setting(containerEl)
			.setName('Custom Voice')
			.setDesc(patternFragment)
			.addText(text => {
				text.setPlaceholder('e.g., fr-FR-HenriNeural');
				text.setValue(this.plugin.settings.customVoice);
				text.onChange(async (value) => {
					this.plugin.settings.customVoice = value;
					await this.plugin.saveSettings();
				});
			});

		// Ribbon icon toggle setting
		new Setting(containerEl)
			.setName('Show Ribbon Icon')
			.setDesc('Toggle the ribbon icon for quick access.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showRibbonIcon);
				toggle.onChange(async (value) => {
					this.plugin.settings.showRibbonIcon = value;
					await this.plugin.saveSettings();

					if (value) {
						this.plugin.addPluginRibbonIcon();
					} else {
						this.plugin.removePluginRibbonIcon();
					}
				});
			});

		// Notice toggle setting
		new Setting(containerEl)
			.setName('Show Notices')
			.setDesc('Toggle notices for processing status and errors.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showNotices);
				toggle.onChange(async (value) => {
					this.plugin.settings.showNotices = value;
					await this.plugin.saveSettings();
				});
			});

		const starContainer = containerEl.createEl('div', { cls: 'star-section' });
		starContainer.createEl('h3', {
			text: 'Please star this project on GitHub if you find it useful ⭐️',
			cls: 'star-message'
		});

		starContainer.createEl('a', {
			text: 'GitHub: Edge TTS Plugin',
			href: 'https://github.com/travisvn/obsidian-edge-tts',
			cls: 'external-link',
			attr: {
				target: '_blank',
				rel: 'noopener'
			}
		});
	}
}
