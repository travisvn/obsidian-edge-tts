import { Plugin, MarkdownView, Notice, Editor, MarkdownFileInfo } from 'obsidian';
import { EdgeTTSPluginSettings, EdgeTTSPluginSettingTab, DEFAULT_SETTINGS } from './modules/settings';
import { AudioPlaybackManager } from './modules/audio-playback';
import { FileOperationsManager } from './modules/file-operations';
import { UIManager } from './modules/ui-components';
import { TTSEngine, TTSTaskStatus } from './modules/tts-engine';
import { OUTPUT_FORMAT } from 'edge-tts-client';
import { FloatingUIManager } from './modules/FloatingUIManager';

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	audioManager: AudioPlaybackManager;
	fileManager: FileOperationsManager;
	uiManager: UIManager;
	ttsEngine: TTSEngine;
	floatingUIManager: FloatingUIManager;

	// Task tracking for MP3 generation
	private mp3GenerationTasks: Map<string, { taskId: string, editor?: Editor, filePath?: string }> = new Map();

	async onload() {
		if (process.env.NODE_ENV === 'development') {
			console.log('Loading Obsidian Edge TTS Plugin');
		}

		await this.loadSettings(); // 1. Load settings first

		// 2. Define temp audio path
		const tempAudioDir = this.app.vault.configDir + "/plugins/" + this.manifest.id + "/temp";
		const tempAudioPath = tempAudioDir + "/tts-temp-audio.mp3";

		// 3. Initialize FileOperationsManager
		this.fileManager = new FileOperationsManager(this.app, this.settings, tempAudioPath);

		// 4. Clean up any old temp audio file from a previous session
		await this.fileManager.cleanupTempAudioFile();

		// 5. Ensure temp directory for audio exists
		if (!await this.app.vault.adapter.exists(tempAudioDir)) {
			await this.app.vault.adapter.mkdir(tempAudioDir);
		}

		// 6. Initialize TTSEngine
		this.ttsEngine = new TTSEngine(this.settings);

		// 7. Initialize AudioPlaybackManager
		this.audioManager = new AudioPlaybackManager(
			this.settings,
			this.updateStatusBar.bind(this),
			// Callbacks for floating UI - these will be set properly later
			(data) => { console.warn("showFloatingPlayerCallback not yet initialized with data:", data); },
			() => { console.warn("hideFloatingPlayerCallback not yet initialized"); },
			(data) => { console.warn("updateFloatingPlayerCallback not yet initialized with data:", data); },
			this.fileManager,
			this.app
		);

		// 8. Initialize FloatingUIManager
		this.floatingUIManager = new FloatingUIManager({
			audioManager: this.audioManager,
			savePositionCallback: async (position) => {
				this.settings.floatingPlayerPosition = position;
				await this.saveSettings();
			}
		});

		// 9. Now, properly set the callbacks in AudioPlaybackManager
		this.audioManager.setFloatingPlayerCallbacks(
			(data) => this.floatingUIManager.showPlayer(data), // Pass data through
			() => this.floatingUIManager.hidePlayer(),
			(data) => this.floatingUIManager.updatePlayerState(data) // Pass data through
		);

		// 10. Initialize UIManager
		this.uiManager = new UIManager(this, this.settings, this.audioManager, this.ttsEngine);

		// 11. Set initial floating player position from loaded settings
		if (this.settings.floatingPlayerPosition) {
			this.floatingUIManager.setInitialSavedPosition(this.settings.floatingPlayerPosition);
		}

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

		this.addCommand({
			id: 'show-floating-playback-controls',
			name: 'Show floating playback controls',
			callback: () => {
				if (!this.floatingUIManager.getIsPlayerVisible()) {
					this.floatingUIManager.showPlayer();
				}
			}
		});

		this.addCommand({
			id: 'reset-floating-player-position',
			name: 'Reset floating player position',
			callback: () => {
				this.floatingUIManager.resetPlayerPosition();
				if (this.settings.showNotices) new Notice('Floating player position reset.');
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
		// Initial position setting is moved to onload after floatingUIManager is initialized.
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Update settings in all managers
		this.audioManager.updateSettings(this.settings);
		this.fileManager.updateSettings(this.settings);
		this.uiManager.updateSettings(this.settings);
		this.ttsEngine.updateSettings(this.settings);
		// If FloatingUIManager needs settings updates, add its updater here
	}

	onunload() {
		console.log('Unloading Obsidian Edge TTS Plugin');
		this.uiManager.removePluginRibbonIcon();
		this.audioManager.stopPlayback(); // This will also trigger hidePlayer if popover is not disabled, which saves position
		this.uiManager.removeStatusBarButton();

		// Save position one last time on unload, if available and player was visible or position changed recently
		// The hidePlayer and onDragEnd should cover most cases. This is a fallback.
		const currentPosition = this.floatingUIManager.getCurrentPosition();
		if (currentPosition &&
			(this.settings.floatingPlayerPosition?.x !== currentPosition.x ||
				this.settings.floatingPlayerPosition?.y !== currentPosition.y)) {
			this.settings.floatingPlayerPosition = currentPosition;
			// Directly save data to avoid triggering full saveSettings and potential side effects during unload
			this.saveData(this.settings).catch(error => console.error("Failed to save player position on unload:", error));
		}
		this.floatingUIManager.destroy();

		// No async cleanup in onunload for the temp file.
		// It will be cleaned up on next load by cleanupTempAudioFile() in fileManager.
	}
}
