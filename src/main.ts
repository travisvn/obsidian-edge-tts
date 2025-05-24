import { Plugin, MarkdownView, Notice, Editor, MarkdownFileInfo } from 'obsidian';
import { EdgeTTSPluginSettings, EdgeTTSPluginSettingTab, DEFAULT_SETTINGS } from './modules/settings';
import { AudioPlaybackManager } from './modules/audio-playback';
import { FileOperationsManager } from './modules/file-operations';
import { UIManager } from './modules/ui-components';
import { TTSEngine, TTSTaskStatus } from './modules/tts-engine';
import { OUTPUT_FORMAT } from 'edge-tts-client';
import { FloatingUIManager } from './modules/FloatingUIManager';
import { QueueUIManager } from './modules/QueueUIManager';

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	audioManager: AudioPlaybackManager;
	fileManager: FileOperationsManager;
	uiManager: UIManager;
	ttsEngine: TTSEngine;
	floatingUIManager: FloatingUIManager;
	queueUIManager?: QueueUIManager;

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

		// 8. Initialize FloatingUIManager (we'll set queueUIManager reference later)
		this.floatingUIManager = new FloatingUIManager({
			audioManager: this.audioManager,
			savePositionCallback: async (position) => {
				this.settings.floatingPlayerPosition = position;
				await this.saveSettings();
			},
			enableQueueFeature: this.settings.enableQueueFeature
		});

		// 8b. Initialize QueueUIManager (only if queue feature is enabled)
		if (this.settings.enableQueueFeature) {
			this.queueUIManager = new QueueUIManager({
				audioManager: this.audioManager,
				savePositionCallback: async (position) => {
					this.settings.queueManagerPosition = position;
					await this.saveSettings();
				}
			});

			// 8c. Connect the queue UI manager to the floating UI manager
			if (this.queueUIManager) {
				this.floatingUIManager.setQueueUIManager(this.queueUIManager);
			}
		}

		// 9. Now, properly set the callbacks in AudioPlaybackManager
		this.audioManager.setFloatingPlayerCallbacks(
			(data) => this.floatingUIManager.showPlayer(data), // Pass data through
			() => this.floatingUIManager.hidePlayer(),
			(data) => this.floatingUIManager.updatePlayerState(data) // Pass data through
		);

		// 9b. Set up queue change callback to update queue UI (only if queue feature is enabled)
		if (this.settings.enableQueueFeature && this.queueUIManager) {
			this.audioManager.setQueueChangeCallback(() => {
				this.queueUIManager?.updateQueue();
			});

			// 9c. Set up queue UI update callback for playback state changes
			this.audioManager.setQueueUIUpdateCallback(() => {
				this.queueUIManager?.updateQueue();
			});
		}

		// 10. Initialize UIManager
		this.uiManager = new UIManager(this, this.settings, this.audioManager, this.ttsEngine);

		// 11. Set initial floating player position from loaded settings
		if (this.settings.floatingPlayerPosition) {
			this.floatingUIManager.setInitialSavedPosition(this.settings.floatingPlayerPosition);
		}

		// 11b. Set initial queue position from loaded settings (only if queue feature is enabled)
		if (this.settings.enableQueueFeature && this.queueUIManager && this.settings.queueManagerPosition) {
			this.queueUIManager.setInitialSavedPosition(this.settings.queueManagerPosition);
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

		// Add enhanced keyboard shortcuts for playback control
		this.addCommand({
			id: 'pause-resume-playback',
			name: 'Pause/Resume playback',
			hotkeys: [{ modifiers: ['Ctrl'], key: ' ' }], // Ctrl+Space like media players
			callback: () => {
				if (this.audioManager.isPlaybackPaused()) {
					this.audioManager.resumePlayback();
				} else {
					this.audioManager.pausePlayback();
				}
			}
		});

		this.addCommand({
			id: 'jump-forward-10s',
			name: 'Jump forward 10 seconds',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'ArrowRight' }],
			callback: () => this.audioManager.jumpForward()
		});

		this.addCommand({
			id: 'jump-backward-10s',
			name: 'Jump backward 10 seconds',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'ArrowLeft' }],
			callback: () => this.audioManager.jumpBackward()
		});

		this.addCommand({
			id: 'read-selected-text',
			name: 'Read selected text aloud',
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
			editorCallback: (editor, view) => {
				const selectedText = editor.getSelection();
				if (selectedText.trim()) {
					this.audioManager.startPlayback(selectedText);
				} else {
					if (this.settings.showNotices) new Notice('No text selected.');
				}
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

		// Queue management commands (only if queue feature is enabled)
		if (this.settings.enableQueueFeature) {
			this.addCommand({
				id: 'add-note-to-queue',
				name: 'Add current note to playback queue',
				editorCallback: (editor, view) => {
					const noteTitle = view.file?.basename || 'Untitled';
					const content = editor.getValue();
					this.audioManager.addToQueue(content, noteTitle);
				}
			});

			this.addCommand({
				id: 'add-selection-to-queue',
				name: 'Add selected text to playback queue',
				editorCallback: (editor, view) => {
					const selectedText = editor.getSelection();
					if (selectedText.trim()) {
						const noteTitle = view.file?.basename || 'Untitled';
						this.audioManager.addToQueue(selectedText, `${noteTitle} (selection)`);
					} else {
						if (this.settings.showNotices) new Notice('No text selected.');
					}
				}
			});

			this.addCommand({
				id: 'play-queue',
				name: 'Play entire queue',
				callback: () => {
					this.audioManager.playQueue();
				}
			});

			this.addCommand({
				id: 'clear-queue',
				name: 'Clear playback queue',
				callback: () => {
					this.audioManager.clearQueue();
				}
			});

			this.addCommand({
				id: 'show-queue-status',
				name: 'Show queue status',
				callback: () => {
					const status = this.audioManager.getQueueStatus();
					const message = status.queue.length === 0
						? 'Playback queue is empty.'
						: `Queue has ${status.queue.length} items. ${status.isPlayingFromQueue ? `Currently playing item ${status.currentIndex + 1}.` : 'Not currently playing from queue.'}`;
					if (this.settings.showNotices) new Notice(message);
				}
			});
		}

		// Sleep timer commands
		this.addCommand({
			id: 'set-sleep-timer-15min',
			name: 'Set sleep timer (15 minutes)',
			callback: () => {
				this.audioManager.setSleepTimer(15);
			}
		});

		this.addCommand({
			id: 'set-sleep-timer-30min',
			name: 'Set sleep timer (30 minutes)',
			callback: () => {
				this.audioManager.setSleepTimer(30);
			}
		});

		this.addCommand({
			id: 'set-sleep-timer-60min',
			name: 'Set sleep timer (60 minutes)',
			callback: () => {
				this.audioManager.setSleepTimer(60);
			}
		});

		this.addCommand({
			id: 'cancel-sleep-timer',
			name: 'Cancel sleep timer',
			callback: () => {
				this.audioManager.cancelSleepTimer();
			}
		});

		// Queue UI management commands (only if queue feature is enabled)
		if (this.settings.enableQueueFeature && this.queueUIManager) {
			this.addCommand({
				id: 'show-queue-manager',
				name: 'Show queue manager',
				hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'q' }],
				callback: () => {
					this.queueUIManager?.showQueue();
				}
			});

			this.addCommand({
				id: 'toggle-queue-manager',
				name: 'Toggle queue manager',
				callback: () => {
					this.queueUIManager?.toggleQueueVisibility();
				}
			});

			this.addCommand({
				id: 'reset-queue-position',
				name: 'Reset queue manager position',
				callback: () => {
					this.queueUIManager?.resetQueuePosition();
					if (this.settings.showNotices) new Notice('Queue manager position reset.');
				}
			});
		}
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
		this.floatingUIManager.updateQueueFeatureEnabled(this.settings.enableQueueFeature);
	}

	onunload() {
		console.log('Unloading Obsidian Edge TTS Plugin');
		this.uiManager.removePluginRibbonIcon();
		this.audioManager.stopPlayback(); // This will also trigger hidePlayer if popover is not disabled, which saves position
		this.uiManager.removeStatusBarButton();

		// Save positions one last time on unload
		const currentPlayerPosition = this.floatingUIManager.getCurrentPosition();
		const currentQueuePosition = this.queueUIManager?.getCurrentPosition();
		let shouldSave = false;

		if (currentPlayerPosition &&
			(this.settings.floatingPlayerPosition?.x !== currentPlayerPosition.x ||
				this.settings.floatingPlayerPosition?.y !== currentPlayerPosition.y)) {
			this.settings.floatingPlayerPosition = currentPlayerPosition;
			shouldSave = true;
		}

		if (currentQueuePosition &&
			(this.settings.queueManagerPosition?.x !== currentQueuePosition.x ||
				this.settings.queueManagerPosition?.y !== currentQueuePosition.y)) {
			this.settings.queueManagerPosition = currentQueuePosition;
			shouldSave = true;
		}

		if (shouldSave) {
			// Directly save data to avoid triggering full saveSettings and potential side effects during unload
			this.saveData(this.settings).catch(error => console.error("Failed to save UI positions on unload:", error));
		}

		this.floatingUIManager.destroy();
		if (this.queueUIManager) {
			this.queueUIManager.destroy();
		}

		// No async cleanup in onunload for the temp file.
		// It will be cleaned up on next load by cleanupTempAudioFile() in fileManager.
	}
}
