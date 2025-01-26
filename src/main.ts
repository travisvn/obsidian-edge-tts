import { Plugin, MarkdownView, Notice, PluginSettingTab, Setting, Editor, MarkdownFileInfo, setIcon, setTooltip, TFile, FileSystemAdapter } from 'obsidian';
import { EdgeTTSClient, OUTPUT_FORMAT, ProsodyOptions } from 'edge-tts-client';
import { filterFrontmatter, filterMarkdown } from 'src/utils';

import * as path from 'path';
import * as os from 'os';

// Top voices to be displayed in the dropdown
const TOP_VOICES = [
	'en-US-AvaMultilingualNeural',
	'en-US-BrianMultilingualNeural',
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

	generateMP3: boolean;
	outputFolder: string;
	embedInNote: boolean;
	replaceSpacesInFilenames: boolean;

	overrideAmpersandEscape: boolean;
}

const DEFAULT_SETTINGS: EdgeTTSPluginSettings = {
	selectedVoice: 'en-US-AvaNeural',
	customVoice: '',
	playbackSpeed: 1.0,

	showNotices: true,
	showStatusBarButton: true,
	showMenuItems: true,

	generateMP3: false,
	outputFolder: 'Note Narration Audio',
	embedInNote: false,
	replaceSpacesInFilenames: false,

	overrideAmpersandEscape: false,
}

const defaultSelectedTextMp3Name = 'note'

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

				if (this.settings.generateMP3) {
					menu.addItem((item) => {
						item
							.setTitle('Generate MP3')
							.setIcon('microphone')
							.onClick(async () => {
								await this.generateMP3(undefined, undefined, file.path);
							});
					});
				}
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

				if (this.settings.generateMP3) {
					menu.addItem((item) => {
						item
							.setTitle('Generate MP3')
							.setIcon('microphone')
							.onClick(async () => {
								await this.generateMP3(editor, view);
							});
					});
				}
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

	async embedMP3InNote(relativePath: string, filePath?: string, editor?: Editor): Promise<void> {
		try {
			if (editor) {
				// Get the selected text and its position in the editor
				const selectedText = editor.getSelection();
				const cursorPosition = editor.getCursor('to');

				// Construct the embed link
				const embedLink = `\n\n![[${relativePath}]]\n`;

				// Insert the embed link after the selected text
				if (selectedText) {
					editor.replaceSelection(`${selectedText}${embedLink}`);
				} else {
					// If no selection, insert at the cursor position
					editor.replaceRange(embedLink, cursorPosition);
				}

				if (this.settings.showNotices) new Notice('MP3 embedded after the selected text.');
			} else {
				if (!filePath) {
					console.error('Error embedding MP3 in note due to filePath and editor not being passed to embedMP3InNote');
					if (this.settings.showNotices) new Notice('Failed to embed MP3 in note.');
					return;
				}

				// Fallback for non-editor scenarios
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) {
					if (this.settings.showNotices) new Notice(`File not found or is not a valid markdown file: ${filePath}`);
					return;
				}

				// Read the existing content of the note
				const content = await this.app.vault.read(file);

				// Construct the embed link
				const embedLink = `![[${relativePath}]]`;

				// Append the embed link to the content
				const updatedContent = `${content}\n\n${embedLink}`;

				// Write the updated content back to the note
				await this.app.vault.modify(file, updatedContent);

				if (this.settings.showNotices) new Notice('MP3 embedded in note.');
			}
		} catch (error) {
			console.error('Error embedding MP3 in note:', error);
			if (this.settings.showNotices) new Notice('Failed to embed MP3 in note.');
		}
	}

	async saveMP3File(buffer: Buffer, filePath?: string): Promise<string | null> {
		const adapter = this.app.vault.adapter;

		if (!(adapter instanceof FileSystemAdapter)) {
			console.error('File system adapter not available.');
			if (this.settings.showNotices) new Notice('Unable to save MP3 file.');
			return null;
		}

		const basePath = adapter.getBasePath();
		const fallbackFolderName = this.settings.replaceSpacesInFilenames
			? 'Note_Narration_Audio'
			: 'Note Narration Audio';
		const folderPath = this.settings.outputFolder || fallbackFolderName;

		const relativeFolderPath = folderPath; // Path relative to vault root
		const absoluteFolderPath = path.join(basePath, relativeFolderPath); // Platform-agnostic path

		try {
			// Ensure the relative output folder exists
			if (!await adapter.exists(relativeFolderPath)) {
				await adapter.mkdir(relativeFolderPath);
			}

			// Format the current date and time
			const now = new Date();
			const formattedDate = new Intl.DateTimeFormat('en-US', {
				month: 'short',
				day: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			}).format(now);

			let sanitizedDate = formattedDate.replace(/,/g, '').trim();

			// Check for Windows and adjust the date format to remove colons
			if (os.platform() === 'win32') {
				sanitizedDate = sanitizedDate.replace(/:/g, '-');
			}

			// Generate the file name
			let noteName = filePath
				? path.basename(filePath, '.md') || defaultSelectedTextMp3Name
				: defaultSelectedTextMp3Name;

			if (this.settings.replaceSpacesInFilenames) {
				noteName = noteName.replace(/\s+/g, '_');
				sanitizedDate = sanitizedDate.replace(/\s+/g, '_');
			}

			const fileName = this.settings.replaceSpacesInFilenames
				? `${noteName}_-_${sanitizedDate}.mp3`
				: `${noteName} - ${sanitizedDate}.mp3`;
			const relativeFilePath = path.join(relativeFolderPath, fileName);
			const absoluteFilePath = path.join(absoluteFolderPath, fileName);

			// Explicitly create an empty file before writing
			await adapter.write(relativeFilePath, '');

			// Write the MP3 file
			await adapter.writeBinary(relativeFilePath, buffer);

			if (this.settings.showNotices) new Notice(`MP3 saved to: ${absoluteFilePath}`);

			// return fileName; // Return the file name
			return relativeFilePath;
		} catch (error) {
			console.error('Error saving MP3:', error);
			if (this.settings.showNotices) new Notice('Failed to save MP3 file.');
			return null;
		}
	}

	async generateMP3(editor?: Editor, viewInput?: MarkdownView | MarkdownFileInfo, filePath?: string) {
		let selectedText = '';
		let cleanText = '';

		if (filePath) {
			const fileContent = await this.extractFileContent(filePath);
			if (fileContent) {
				selectedText = fileContent;
			} else {
				if (this.settings.showNotices) new Notice('Failed to generate MP3: could not read file.');
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
			cleanText = filterMarkdown(filterFrontmatter(selectedText), this.settings.overrideAmpersandEscape);

			if (cleanText.trim()) {
				try {
					if (this.settings.showNotices) new Notice('Generating MP3...');

					const tts = new EdgeTTSClient();
					const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;
					await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

					const audioBuffer: Uint8Array[] = [];
					const readable = tts.toStream(cleanText);

					readable.on('data', (data: Uint8Array) => audioBuffer.push(data));
					readable.on('end', async () => {
						const completeBuffer = Buffer.concat(audioBuffer);

						// Save MP3 file and get fileName
						const savedMp3RelativePath = await this.saveMP3File(completeBuffer, filePath);

						if (savedMp3RelativePath && this.settings.embedInNote) {
							await this.embedMP3InNote(savedMp3RelativePath, filePath, editor);
						}
					});
				} catch (error) {
					console.error('Error generating MP3:', error);
					if (this.settings.showNotices) new Notice('Failed to generate MP3.');
				}
			} else {
				if (this.settings.showNotices) new Notice('No readable text after filtering.');
			}
		} else {
			if (this.settings.showNotices) new Notice('No text selected or available.');
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
			cleanText = filterMarkdown(filterFrontmatter(selectedText), this.settings.overrideAmpersandEscape);

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

		containerEl.createEl('h3', { text: 'Saving .mp3 of narration' });

		new Setting(containerEl)
			.setName('Generate MP3 file')
			.setDesc('Enable option to select "Generate MP3" in the file and editor menus.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.generateMP3);
				toggle.onChange(async (value) => {
					this.plugin.settings.generateMP3 = value;
					await this.plugin.saveSettings();
					if (!value) {
						new Notice('Menu items will be removed after the next reload.');
					}
				});
			});

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc('Specify the folder to save generated MP3 files.')
			.addText(text => {
				text.setPlaceholder('e.g., Note Narration Audio')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						this.plugin.settings.outputFolder = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Embed MP3 in note')
			.setDesc('Embed a link to the generated MP3 file in the note.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.embedInNote);
				toggle.onChange(async (value) => {
					this.plugin.settings.embedInNote = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Replace spaces in filenames')
			.setDesc('Replaces spaces in mp3 file name with underscores (used for system compatibility).')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.replaceSpacesInFilenames);
				toggle.onChange(async (value) => {
					this.plugin.settings.replaceSpacesInFilenames = value;
					await this.plugin.saveSettings();
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

		containerEl.createEl('h3', { text: 'Extra Settings' });

		new Setting(containerEl)
			.setName('Override ampersand (&) escaping')
			.setDesc('If an ampersand (&) is by itself, we "escape it" for the API call. This override is an option for rare use cases.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.overrideAmpersandEscape);
				toggle.onChange(async (value) => {
					this.plugin.settings.overrideAmpersandEscape = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
