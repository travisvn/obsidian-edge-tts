import { Plugin, MarkdownView, Notice, Editor, MarkdownFileInfo } from 'obsidian';
import { EdgeTTSPluginSettings, EdgeTTSPluginSettingTab, DEFAULT_SETTINGS } from './modules/settings';
import { AudioPlaybackManager } from './modules/audio-playback';
import { FileOperationsManager } from './modules/file-operations';
import { UIManager } from './modules/ui-components';
import { TTSEngine, TTSTaskStatus } from './modules/tts-engine';
import { OUTPUT_FORMAT } from 'edge-tts-client';

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	audioManager: AudioPlaybackManager;
	fileManager: FileOperationsManager;
	uiManager: UIManager;
	ttsEngine: TTSEngine;

	// Task tracking for MP3 generation
	private mp3GenerationTasks: Map<string, { taskId: string, editor?: Editor, filePath?: string }> = new Map();

	async onload() {
		if (process.env.NODE_ENV === 'development') {
			console.log('Loading Obsidian Edge TTS Plugin');
		}

		// Load settings
		await this.loadSettings();

		// Initialize managers
		this.ttsEngine = new TTSEngine(this.settings);
		this.audioManager = new AudioPlaybackManager(this.settings, this.updateStatusBar.bind(this));
		this.fileManager = new FileOperationsManager(this.app, this.settings);
		this.uiManager = new UIManager(this, this.settings, this.audioManager, this.ttsEngine);

		// Add settings tab
		this.addSettingTab(new EdgeTTSPluginSettingTab(this.app, this));

		// Initialize UI
		this.uiManager.addPluginRibbonIcon();
		if (this.settings.showStatusBarButton) this.uiManager.initializeStatusBar();
		if (this.settings.showMenuItems) this.uiManager.addPluginMenuItems();

		// Start task monitoring for background processing
		this.registerInterval(
			window.setInterval(() => this.monitorTasks(), 1000)
		);

		// Add command to read notes aloud
		this.addCommand({
			id: 'read-note-aloud',
			name: 'Read note aloud',
			editorCallback: (editor, view) => {
				this.readNoteAloud(editor, view);
			}
		});

		// Add command to generate MP3
		this.addCommand({
			id: 'generate-mp3',
			name: 'Generate MP3',
			editorCallback: (editor, view) => {
				this.generateMP3(editor, view);
			}
		});

		// Add command to stop playback
		this.addCommand({
			id: 'stop-tts-playback',
			name: 'Stop TTS playback',
			callback: () => {
				this.audioManager.stopPlayback();
			}
		});
	}

	/**
	 * Monitor background TTS tasks
	 */
	private monitorTasks(): void {
		// Check for completed MP3 generation tasks
		for (const [id, taskInfo] of this.mp3GenerationTasks.entries()) {
			const task = this.ttsEngine.getTask(taskInfo.taskId);

			if (!task) {
				this.mp3GenerationTasks.delete(id);
				continue;
			}

			// Handle completed tasks
			if (task.status === TTSTaskStatus.COMPLETED && task.buffer) {
				this.mp3GenerationTasks.delete(id);

				// Save the MP3 file
				this.fileManager.saveMP3File(task.buffer, taskInfo.filePath).then(savedPath => {
					if (savedPath && this.settings.embedInNote) {
						this.fileManager.embedMP3InNote(savedPath, taskInfo.filePath, taskInfo.editor);
					}
				});

				if (this.settings.showNotices) new Notice('MP3 generation complete');
			}
			// Handle failed tasks
			else if (task.status === TTSTaskStatus.FAILED) {
				this.mp3GenerationTasks.delete(id);
				if (this.settings.showNotices) new Notice(`MP3 generation failed: ${task.error || 'Unknown error'}`);
			}
		}

		// Clean up old tasks periodically (every 5 minutes)
		if (Math.random() < 0.0033) { // ~1/300 chance each second = ~once every 5 minutes
			this.ttsEngine.cleanupOldTasks();
		}
	}

	updateStatusBar(withControls = false): void {
		this.uiManager.updateStatusBar(withControls);
	}

	async readNoteAloud(editor?: Editor, viewInput?: MarkdownView | MarkdownFileInfo, filePath?: string): Promise<void> {
		let selectedText = '';

		if (filePath) {
			const fileContent = await this.fileManager.extractFileContent(filePath);
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

		// Use audio manager for playback
		await this.audioManager.startPlayback(selectedText);
	}

	async generateMP3(editor?: Editor, viewInput?: MarkdownView | MarkdownFileInfo, filePath?: string): Promise<void> {
		let selectedText = '';

		if (filePath) {
			const fileContent = await this.fileManager.extractFileContent(filePath);
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

		if (!selectedText.trim()) {
			if (this.settings.showNotices) new Notice('No text selected or available.');
			return;
		}

		try {
			if (this.settings.showNotices) new Notice('Starting MP3 generation in background...');

			// Create a background task for MP3 generation
			const task = this.ttsEngine.createTask(selectedText, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

			// Generate a unique ID for this MP3 generation task
			const generationId = `mp3-${Date.now()}`;

			// Store task information for monitoring
			this.mp3GenerationTasks.set(generationId, {
				taskId: task.id,
				editor,
				filePath
			});
		} catch (error) {
			console.error('Error starting MP3 generation:', error);
			if (this.settings.showNotices) new Notice('Failed to start MP3 generation.');
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Update settings in all managers
		this.audioManager.updateSettings(this.settings);
		this.fileManager.updateSettings(this.settings);
		this.uiManager.updateSettings(this.settings);
		this.ttsEngine.updateSettings(this.settings);
	}

	onunload() {
		console.log('Unloading Obsidian Edge TTS Plugin');
		this.uiManager.removePluginRibbonIcon();
		this.audioManager.cleanupAudioContext();
		this.uiManager.removeStatusBarButton();
	}
}
