import { Plugin, MarkdownView, Notice, PluginSettingTab, Setting, Editor, MarkdownFileInfo, setIcon, setTooltip, TFile } from 'obsidian';
import { EdgeTTSClient, OUTPUT_FORMAT, ProsodyOptions } from 'edge-tts-client';
import { filterFrontmatter, filterMarkdown } from 'src/utils';

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
	playbackSpeed: number;
	showNotices: boolean;
	showStatusBarButton: boolean;
	showMenuItems: boolean;
}

const DEFAULT_SETTINGS: EdgeTTSPluginSettings = {
	selectedVoice: 'en-US-ChristopherNeural',
	customVoice: '',
	playbackSpeed: 1.2,
	showNotices: true,
	showStatusBarButton: true,
	showMenuItems: true,
};

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	ribbonIconEl: HTMLElement | null = null;
	statusBarEl: HTMLElement | null = null;
	audioContext: AudioContext | null = null;
	audioSource: AudioBufferSourceNode | null = null;
	isPaused = false;
	pausedAt = 0;

	async onload() {
		if (process.env.NODE_ENV === 'development') {
			console.log('Loading Obsidian Edge TTS Plugin');
		}

		// Load settings
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new EdgeTTSPluginSettingTab(this.app, this));

		this.addPluginRibbonIcon();

		if (this.settings.showStatusBarButton) this.initializeStatusBar();

		if (this.settings.showMenuItems) this.addPluginMenuItems();

		// Add command to read notes aloud
		this.addCommand({
			id: 'read-note-aloud',
			name: 'Read note aloud',
			editorCallback: (editor, view) => {
				this.readNoteAloud(editor, view);
			}
		});
	}

	initializeStatusBar() {
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
	}

	removeStatusBarButton(): void {
		if (this.statusBarEl) {
			this.statusBarEl?.remove();
			this.statusBarEl = null;
		}
	}

	updateStatusBar(withControls = false) {
		if (!this.statusBarEl) return;
		if (!this.settings.showStatusBarButton) {
			this.removeStatusBarButton();
			return;
		}

		this.statusBarEl.empty();

		if (withControls) {
			// Add pause/play button
			const pausePlayButton = createEl('span', { cls: 'edge-tts-status-bar-control' });
			setTooltip(pausePlayButton, this.isPaused ? 'Resume' : 'Pause', { placement: 'top' })
			setIcon(pausePlayButton, this.isPaused ? 'circle-play' : 'circle-pause');
			pausePlayButton.onclick = () => (this.isPaused ? this.resumePlayback() : this.pausePlayback());
			this.statusBarEl.appendChild(pausePlayButton);
		} else {
			// Add icon to read note aloud
			const readAloudStatusBar = createEl('span', { cls: 'edge-tts-status-bar-control' });
			setTooltip(readAloudStatusBar, 'Read note aloud', { placement: 'top' })
			setIcon(readAloudStatusBar, 'audio-lines');
			readAloudStatusBar.onclick = () => this.readNoteAloud();
			this.statusBarEl.appendChild(readAloudStatusBar);
		}
	}

	addPluginMenuItems(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				menu.addItem((item) => {
					item
						.setTitle('Read note aloud')
						.setIcon('audio-lines')
						.onClick(async () => {
							this.readNoteAloud(undefined, undefined, file.path);
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				menu.addItem((item) => {
					item
						.setTitle('Read note aloud')
						.setIcon('audio-lines')
						.onClick(async () => {
							this.readNoteAloud(editor, view);
						});
				});
			})
		);
	}

	addPluginRibbonIcon(): void {
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
		}

		this.ribbonIconEl = this.addRibbonIcon('audio-lines', 'Read note aloud', () => {
			this.readNoteAloud();
		});
	}

	removePluginRibbonIcon(): void {
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}
	}

	async extractFileContent(filePath: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		// Ensure the file is a markdown file
		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				return content;
			} catch (error) {
				console.error('Error reading file content:', error);
				return null;
			}
		} else {
			console.warn('The specified file is not a TFile (markdown file).');
			return null;
		}
	}

	async readNoteAloud(editor?: Editor, viewInput?: MarkdownView | MarkdownFileInfo, filePath?: string) {
		if (this.audioContext || this.audioSource) {
			// Stop any ongoing narration before starting a new one
			this.stopPlayback();
		}

		let selectedText = '';
		let cleanText = '';

		let fileContent = null;
		if (filePath) {
			fileContent = await this.extractFileContent(filePath);
			if (fileContent) {
				selectedText = fileContent;
			} else {
				if (this.settings.showNotices) new Notice('Failed to read note aloud.');
				return;
			}
		} else {
			const view = viewInput ?? this.app.workspace.getActiveViewOfType(MarkdownView);

			if (!editor && view) editor = view.editor;

			if (editor && view) {
				selectedText = editor.getSelection() || editor.getValue();
			}
		}

		if (selectedText.trim()) {
			cleanText = filterMarkdown(filterFrontmatter(selectedText));

			if (cleanText.trim()) {
				try {
					if (this.settings.showNotices) new Notice('Processing text-to-speech...');
					this.updateStatusBar(true);

					const tts = new EdgeTTSClient();
					const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;
					await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);

					const prosodyOptions = new ProsodyOptions();
					prosodyOptions.rate = this.settings.playbackSpeed;

					const readable = tts.toStream(cleanText, prosodyOptions);
					this.audioContext = new AudioContext();
					this.audioSource = this.audioContext.createBufferSource();
					const audioBuffer: Uint8Array[] = [];

					readable.on('data', (data: Uint8Array) => {
						audioBuffer.push(data);
					});

					readable.on('end', async () => {
						const completeBuffer = new Uint8Array(Buffer.concat(audioBuffer));
						const audioBufferDecoded = await this.audioContext!.decodeAudioData(completeBuffer.buffer);

						this.audioSource!.buffer = audioBufferDecoded;
						this.audioSource!.connect(this.audioContext!.destination);
						this.audioSource!.start(0);

						this.audioSource!.onended = () => {
							this.cleanupAudioContext();
							this.updateStatusBar();
							if (this.settings.showNotices) new Notice('Finished reading aloud.');
						};
					});
				} catch (error) {
					console.error('Error reading note aloud:', error);
					this.updateStatusBar();
					if (this.settings.showNotices) new Notice('Failed to read note aloud.');
				}
			} else {
				if (this.settings.showNotices) new Notice('No readable text after filtering.');
			}
		} else {
			if (this.settings.showNotices) new Notice('No text selected or available.');
		}
	}

	pausePlayback() {
		if (this.audioContext && this.audioSource) {
			this.isPaused = true;
			this.pausedAt = this.audioContext.currentTime;
			this.audioContext.suspend();
			this.updateStatusBar(true);
		}
	}

	resumePlayback() {
		if (this.audioContext) {
			this.isPaused = false;
			this.audioContext.resume();
			this.updateStatusBar(true);
		}
	}

	stopPlayback() {
		if (this.audioSource) {
			this.audioSource.stop();
			this.cleanupAudioContext();
			this.updateStatusBar();
		}
	}

	cleanupAudioContext() {
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		this.audioSource = null;
		this.isPaused = false;
		this.pausedAt = 0;
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
		this.statusBarEl?.remove();
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

		// Add a text notice about sampling voices
		const inbetweenInfo = containerEl.createEl('div', {
			cls: 'edge-tts-info-div'
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
			.setName('Select voice')
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
		patternFragment.append('Leave empty to use the selected voice above.');

		// Text input for custom voice
		new Setting(containerEl)
			.setName('Custom voice')
			.setDesc(patternFragment)
			.addText(text => {
				text.setPlaceholder('e.g., fr-FR-HenriNeural');
				text.setValue(this.plugin.settings.customVoice);
				text.onChange(async (value) => {
					this.plugin.settings.customVoice = value;
					await this.plugin.saveSettings();
				});
			});

		// Slider for playback speed
		new Setting(containerEl)
			.setName('Playback speed')
			.setDesc('Change playback speed multiplier (ex. 0.5 = 0.5x playback speed (50% speed)). Default = 1.2')
			.addSlider(slider => {
				slider.setLimits(0.5, 2.0, 0.1);
				slider.setValue(this.plugin.settings.playbackSpeed);
				slider.onChange(async (value) => {
					this.plugin.settings.playbackSpeed = value;
					await this.plugin.saveSettings();
				});
				slider.setDynamicTooltip();
				slider.showTooltip();
			});

		// Notice toggle setting
		new Setting(containerEl)
			.setName('Show notices')
			.setDesc('Toggle notices for processing status and errors.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showNotices);
				toggle.onChange(async (value) => {
					this.plugin.settings.showNotices = value;
					await this.plugin.saveSettings();
				});
			});

		// Status toggle setting
		new Setting(containerEl)
			.setName('Show status bar button')
			.setDesc('Toggle playback button in the status bar.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showStatusBarButton);
				toggle.onChange(async (value) => {
					this.plugin.settings.showStatusBarButton = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.initializeStatusBar();
					} else {
						this.plugin.removeStatusBarButton();
					}
				});
			});

		// Menu items toggle setting
		new Setting(containerEl)
			.setName('Show file and editor menu items')
			.setDesc('Toggle menu items in the file and editor menus.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showMenuItems);
				toggle.onChange(async (value) => {
					this.plugin.settings.showMenuItems = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.addPluginMenuItems();
					} else {
						new Notice('Menu items will be removed after the next reload.');
					}
				});
			});

		const starContainer = containerEl.createEl('div', { cls: 'edge-tts-star-section' });
		starContainer.createEl('p', {
			text: 'Please star this project on GitHub if you find it useful ⭐️',
			cls: 'edge-tts-star-message'
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
