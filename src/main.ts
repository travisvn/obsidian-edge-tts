import { Plugin, MarkdownView, Notice, Editor, MarkdownFileInfo, Platform } from 'obsidian';
import { EdgeTTSPluginSettings, EdgeTTSPluginSettingTab, DEFAULT_SETTINGS } from './modules/settings';
import { AudioPlaybackManager } from './modules/audio-playback';
import { FileOperationsManager } from './modules/file-operations';
import { UIManager } from './modules/ui-components';
import { TTSEngine, TTSTaskStatus } from './modules/tts-engine';
import { OUTPUT_FORMAT } from './modules/tts-client-wrapper';
import { FloatingUIManager } from './modules/FloatingUIManager';
import { QueueUIManager } from './modules/QueueUIManager';
import { ChunkedProgressManager } from './modules/ChunkedProgressManager';
import { ChunkedGenerator } from './modules/chunked-generator';
import { checkAndTruncateContent, shouldShowNotices } from './utils';

export default class EdgeTTSPlugin extends Plugin {
	settings: EdgeTTSPluginSettings;
	audioManager: AudioPlaybackManager;
	fileManager: FileOperationsManager;
	uiManager: UIManager;
	ttsEngine: TTSEngine;
	floatingUIManager: FloatingUIManager;
	queueUIManager?: QueueUIManager;
	chunkedProgressManager: ChunkedProgressManager;

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

		// 12. Initialize ChunkedProgressManager
		this.chunkedProgressManager = new ChunkedProgressManager();

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

		// Add command to generate MP3 (desktop only)
		if (!Platform.isMobile) {
			this.addCommand({
				id: 'generate-mp3',
				name: 'Generate MP3',
				editorCallback: (editor, view) => {
					this.generateMP3(editor, view);
				}
			});
		}

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
			// hotkeys: [{ modifiers: ['Ctrl'], key: ' ' }], // Ctrl+Space like media players
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
			// hotkeys: [{ modifiers: ['Ctrl'], key: 'ArrowRight' }],
			callback: () => this.audioManager.jumpForward()
		});

		this.addCommand({
			id: 'jump-backward-10s',
			name: 'Jump backward 10 seconds',
			// hotkeys: [{ modifiers: ['Ctrl'], key: 'ArrowLeft' }],
			callback: () => this.audioManager.jumpBackward()
		});

		this.addCommand({
			id: 'read-selected-text',
			name: 'Read selected text aloud',
			// hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
			editorCallback: (editor, view) => {
				const selectedText = editor.getSelection();
				if (selectedText.trim()) {
					this.audioManager.startPlayback(selectedText);
				} else {
					if (shouldShowNotices(this.settings)) new Notice('No text selected.');
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
				if (shouldShowNotices(this.settings)) new Notice('Floating player position reset.');
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
						if (shouldShowNotices(this.settings)) new Notice('No text selected.');
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
				// hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'q' }],
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

		// Add command for force chunked generation (useful for testing or manual override, desktop only)
		if (!Platform.isMobile) {
			this.addCommand({
				id: 'force-chunked-mp3-generation',
				name: 'Force chunked MP3 generation',
				editorCallback: (editor, view) => {
					const selectedText = editor.getSelection() || editor.getValue();
					if (selectedText.trim()) {
						// Check content limits and truncate if necessary
						const truncationResult = checkAndTruncateContent(selectedText);

						if (truncationResult.wasTruncated) {
							const limitType = truncationResult.truncationReason === 'words' ? 'word' : 'character';
							const limitValue = truncationResult.truncationReason === 'words' ? '5,000 words' : '30,000 characters';

							if (this.settings.showNotices) {
								new Notice(
									`Content exceeds MP3 generation limit (${limitValue}). ` +
									`Generating MP3 for the first ${truncationResult.finalWordCount.toLocaleString()} words ` +
									`(${truncationResult.finalCharCount.toLocaleString()} characters). ` +
									`Original content had ${truncationResult.originalWordCount.toLocaleString()} words.`,
									8000 // Show notice for 8 seconds
								);
							}
						}

						this.generateChunkedMP3(truncationResult.content, editor, view.file?.path);
					} else {
						if (this.settings.showNotices) new Notice('No text available for chunked generation.');
					}
				}
			});
		}

		// Debug command for Media Session API (experimental features)
		this.addCommand({
			id: 'debug-media-session',
			name: 'Debug Media Session API support',
			callback: () => {
				const hasMediaSession = 'mediaSession' in navigator;
				const hasMetadata = hasMediaSession && 'MediaMetadata' in window;
				const experimentalEnabled = this.settings.enableExperimentalFeatures;
				const isAndroid = /Android/i.test(navigator.userAgent);
				const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

				const info = [
					`Media Session API: ${hasMediaSession ? '✅ Supported' : '❌ Not supported'}`,
					`MediaMetadata: ${hasMetadata ? '✅ Supported' : '❌ Not supported'}`,
					`Experimental features: ${experimentalEnabled ? '✅ Enabled' : '❌ Disabled'}`,
					`Platform: ${Platform.isMobile ? 'Mobile' : 'Desktop'}`,
					`OS: ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'Other'}`,
					`Expected to work: ${hasMediaSession && experimentalEnabled ? (isIOS ? '✅ Yes (iOS)' : isAndroid ? '⚠️ Maybe (Android)' : '⚠️ Unknown') : '❌ No'}`,
				];

				console.log('Media Session Debug Info:', info);
				new Notice(`Media Session Debug:\n${info.join('\n')}`, 12000);
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

		// Check content limits and truncate if necessary
		const truncationResult = checkAndTruncateContent(selectedText);

		if (truncationResult.wasTruncated) {
			const limitType = truncationResult.truncationReason === 'words' ? 'word' : 'character';
			const limitValue = truncationResult.truncationReason === 'words' ? '5,000 words' : '30,000 characters';

			if (this.settings.showNotices) {
				new Notice(
					`Content exceeds playback limit (${limitValue}). ` +
					`Playing first ${truncationResult.finalWordCount.toLocaleString()} words ` +
					`(${truncationResult.finalCharCount.toLocaleString()} characters). ` +
					`Original content had ${truncationResult.originalWordCount.toLocaleString()} words.`,
					8000 // Show notice for 8 seconds
				);
			}
		}

		// Use audio manager for playback with potentially truncated content
		await this.audioManager.startPlayback(truncationResult.content);
	}

	async generateMP3(editor?: Editor, viewInput?: MarkdownView | MarkdownFileInfo, filePath?: string): Promise<void> {
		// Check if we're on mobile - MP3 generation is not supported
		if (Platform.isMobile) {
			if (this.settings.showNotices) {
				new Notice('MP3 generation is not supported on mobile devices due to file system limitations. Use audio playback instead.');
			}
			return;
		}

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

		// Check content limits and truncate if necessary
		const truncationResult = checkAndTruncateContent(selectedText);

		if (truncationResult.wasTruncated) {
			const limitType = truncationResult.truncationReason === 'words' ? 'word' : 'character';
			const limitValue = truncationResult.truncationReason === 'words' ? '5,000 words' : '30,000 characters';

			if (this.settings.showNotices) {
				new Notice(
					`Content exceeds MP3 generation limit (${limitValue}). ` +
					`Generating MP3 for the first ${truncationResult.finalWordCount.toLocaleString()} words ` +
					`(${truncationResult.finalCharCount.toLocaleString()} characters). ` +
					`Original content had ${truncationResult.originalWordCount.toLocaleString()} words.`,
					8000 // Show notice for 8 seconds
				);
			}
		}

		// Use the potentially truncated content
		const contentToProcess = truncationResult.content;

		// Check if the text needs chunking
		if (ChunkedGenerator.needsChunking(contentToProcess, this.settings)) {
			// Use chunked generation
			await this.generateChunkedMP3(contentToProcess, editor, filePath);
			return;
		}

		try {
			if (this.settings.showNotices) new Notice('Starting MP3 generation in background...');

			// Create a background task for MP3 generation
			const task = this.ttsEngine.createTask(contentToProcess, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

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

	/**
	 * Generate MP3 using chunked approach for long texts
	 */
	private async generateChunkedMP3(text: string, editor?: Editor, filePath?: string): Promise<void> {
		// Check if we're on mobile - MP3 generation is not supported
		if (Platform.isMobile) {
			if (this.settings.showNotices) {
				new Notice('MP3 generation is not supported on mobile devices due to file system limitations. Use audio playback instead.');
			}
			return;
		}

		try {
			const noteTitle = filePath ?
				this.app.vault.getAbstractFileByPath(filePath)?.name?.replace(/\.md$/, '') || 'Note' :
				'Note';

			// Show progress indicator
			this.chunkedProgressManager.show({
				noteTitle,
				totalChunks: ChunkedGenerator.estimateChunkCount(text, this.settings)
			});

			// Generate chunked MP3
			const buffer = await ChunkedGenerator.generateChunkedMP3({
				text,
				settings: this.settings,
				progressManager: this.chunkedProgressManager,
				noteTitle,
				maxChunkLength: ChunkedGenerator.getRecommendedChunkSize(text, this.settings)
			});

			if (buffer) {
				// Save the MP3 file
				const savedPath = await this.fileManager.saveMP3File(buffer, filePath);
				if (savedPath && this.settings.embedInNote) {
					await this.fileManager.embedMP3InNote(savedPath, filePath, editor);
				}

				if (this.settings.showNotices) {
					new Notice('Chunked MP3 generation completed successfully!');
				}

				// Hide progress after a delay to show completion state
				setTimeout(() => {
					this.chunkedProgressManager.hide();
				}, 3000);
			} else {
				// Error case - progress manager already shows error state
				if (this.settings.showNotices) {
					new Notice('Failed to generate chunked MP3.');
				}
				// Hide progress after a longer delay for error state
				setTimeout(() => {
					this.chunkedProgressManager.hide();
				}, 5000);
			}
		} catch (error) {
			console.error('Error in chunked MP3 generation:', error);
			this.chunkedProgressManager.updateState({
				currentPhase: 'error',
				errorMessage: error instanceof Error ? error.message : 'Unknown error occurred'
			});

			if (this.settings.showNotices) {
				new Notice('Failed to generate chunked MP3.');
			}

			// Hide progress after a delay for error state
			setTimeout(() => {
				this.chunkedProgressManager.hide();
			}, 5000);
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		// Ensure textFiltering settings exist for backward compatibility
		if (!this.settings.textFiltering) {
			this.settings.textFiltering = DEFAULT_SETTINGS.textFiltering;
		} else {
			// Merge any missing text filtering properties with defaults
			this.settings.textFiltering = Object.assign({}, DEFAULT_SETTINGS.textFiltering, this.settings.textFiltering);
		}

		// Specifically ensure replaceComparisonSymbols is set for backward compatibility
		if (typeof this.settings.textFiltering.replaceComparisonSymbols === 'undefined') {
			this.settings.textFiltering.replaceComparisonSymbols = DEFAULT_SETTINGS.textFiltering.replaceComparisonSymbols;
		}

		// Ensure symbolReplacement settings exist for backward compatibility
		if (!this.settings.symbolReplacement) {
			this.settings.symbolReplacement = DEFAULT_SETTINGS.symbolReplacement;
		} else {
			// Merge any missing symbol replacement properties with defaults
			this.settings.symbolReplacement = Object.assign({}, DEFAULT_SETTINGS.symbolReplacement, this.settings.symbolReplacement);
		}

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
		this.chunkedProgressManager.destroy();

		// No async cleanup in onunload for the temp file.
		// It will be cleaned up on next load by cleanupTempAudioFile() in fileManager.
	}
}
