import { EdgeTTSPluginSettings } from './settings';
import { setIcon, setTooltip } from 'obsidian';
import { AudioPlaybackManager } from './audio-playback';
import { TTSEngine, TTSTaskStatus } from './tts-engine';
import EdgeTTSPlugin from 'src/main';

/**
 * Manages UI components for the Edge TTS plugin
 */
export class UIManager {
  private plugin: EdgeTTSPlugin;
  private settings: EdgeTTSPluginSettings;
  private statusBarEl: HTMLElement | null = null;
  private ribbonIconEl: HTMLElement | null = null;
  private audioManager: AudioPlaybackManager;
  private ttsEngine?: TTSEngine;

  constructor(plugin: EdgeTTSPlugin, settings: EdgeTTSPluginSettings, audioManager: AudioPlaybackManager, ttsEngine?: TTSEngine) {
    this.plugin = plugin;
    this.settings = settings;
    this.audioManager = audioManager;
    this.ttsEngine = ttsEngine;
  }

  /**
   * Initialize the status bar with TTS controls
   */
  initializeStatusBar(): void {
    this.statusBarEl = this.plugin.addStatusBarItem();
    this.updateStatusBar();
  }

  /**
   * Remove the status bar button
   */
  removeStatusBarButton(): void {
    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
  }

  /**
   * Update the status bar with appropriate controls
   */
  updateStatusBar(withControls = false): void {
    if (!this.statusBarEl) return;
    if (!this.settings.showStatusBarButton) {
      this.removeStatusBarButton();
      return;
    }

    this.statusBarEl.empty();

    // Check if we have background tasks in progress
    const hasActiveTasks = this.hasActiveTasks();

    if (hasActiveTasks) {
      // Show background task indicator with progress
      this.renderTaskProgressIndicator();
    }
    else if (withControls) {
      // Add pause/play button
      const pausePlayButton = createEl('span', { cls: 'edge-tts-status-bar-control' });
      setTooltip(pausePlayButton, this.audioManager.isPlaybackPaused() ? 'Resume' : 'Pause', { placement: 'top' })
      setIcon(pausePlayButton, this.audioManager.isPlaybackPaused() ? 'circle-play' : 'circle-pause');
      pausePlayButton.onclick = () => (this.audioManager.isPlaybackPaused() ? this.audioManager.resumePlayback() : this.audioManager.pausePlayback());
      this.statusBarEl.appendChild(pausePlayButton);

      // Add stop button
      const stopButton = createEl('span', { cls: 'edge-tts-status-bar-control' });
      setTooltip(stopButton, 'Stop', { placement: 'top' })
      setIcon(stopButton, 'square');
      stopButton.onclick = () => this.audioManager.stopPlayback();
      this.statusBarEl.appendChild(stopButton);
    } else {
      // Add icon to read note aloud
      const readAloudStatusBar = createEl('span', { cls: 'edge-tts-status-bar-control' });
      setTooltip(readAloudStatusBar, 'Read note aloud', { placement: 'top' })
      setIcon(readAloudStatusBar, 'audio-lines');
      readAloudStatusBar.onclick = () => this.plugin.readNoteAloud();
      this.statusBarEl.appendChild(readAloudStatusBar);
    }
  }

  /**
   * Render a progress indicator for background tasks
   */
  private renderTaskProgressIndicator(): void {
    if (!this.statusBarEl || !this.ttsEngine) return;

    const tasks = this.ttsEngine.getAllTasks();
    const processingTasks = tasks.filter(t => t.status === TTSTaskStatus.PROCESSING);
    const pendingTasks = tasks.filter(t => t.status === TTSTaskStatus.PENDING);

    // Container for the status elements
    const container = createEl('div', { cls: 'edge-tts-status-bar-progress-container' });

    // Icon for TTS processing
    const icon = createEl('span', { cls: 'edge-tts-status-bar-icon' });
    setIcon(icon, 'cpu');
    container.appendChild(icon);

    if (processingTasks.length > 0) {
      // Show progress for the current task
      const task = processingTasks[0];
      const progressText = createEl('span', {
        cls: 'edge-tts-status-bar-text',
        text: `${task.progress}%`
      });
      container.appendChild(progressText);

      // Add tooltip with details
      const taskCount = processingTasks.length + pendingTasks.length;
      const taskText = taskCount > 1 ? `${taskCount} tasks` : '1 task';
      setTooltip(container, `Processing TTS: ${taskText}`, { placement: 'top' });
    } else if (pendingTasks.length > 0) {
      // Show waiting status for pending tasks
      const progressText = createEl('span', {
        cls: 'edge-tts-status-bar-text',
        text: 'Waiting...'
      });
      container.appendChild(progressText);

      // Add tooltip with details
      const taskCount = pendingTasks.length;
      const taskText = taskCount > 1 ? `${taskCount} tasks` : '1 task';
      setTooltip(container, `Waiting to process: ${taskText}`, { placement: 'top' });
    }

    this.statusBarEl.appendChild(container);
  }

  /**
   * Check if there are any active TTS tasks
   */
  private hasActiveTasks(): boolean {
    if (!this.ttsEngine) return false;

    const tasks = this.ttsEngine.getAllTasks();
    return tasks.some(t =>
      t.status === TTSTaskStatus.PENDING ||
      t.status === TTSTaskStatus.PROCESSING
    );
  }

  /**
   * Add the plugin ribbon icon
   */
  addPluginRibbonIcon(): void {
    if (this.ribbonIconEl) {
      this.ribbonIconEl.remove();
    }

    this.ribbonIconEl = this.plugin.addRibbonIcon('audio-lines', 'Read note aloud', () => {
      this.plugin.readNoteAloud();
    });
  }

  /**
   * Remove the plugin ribbon icon
   */
  removePluginRibbonIcon(): void {
    if (this.ribbonIconEl) {
      this.ribbonIconEl.remove();
      this.ribbonIconEl = null;
    }
  }

  /**
   * Add plugin menu items to file and editor menus
   */
  addPluginMenuItems(): void {
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('file-menu', (menu: any, file: any) => {
        menu.addItem((item: any) => {
          item
            .setTitle('Read note aloud')
            .setIcon('audio-lines')
            .onClick(async () => {
              this.plugin.readNoteAloud(undefined, undefined, file.path);
            });
        });

        if (this.settings.generateMP3) {
          menu.addItem((item: any) => {
            item
              .setTitle('Generate MP3')
              .setIcon('microphone')
              .onClick(async () => {
                await this.plugin.generateMP3(undefined, undefined, file.path);
              });
          });
        }
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.workspace.on('editor-menu', (menu: any, editor: any, view: any) => {
        menu.addItem((item: any) => {
          item
            .setTitle('Read note aloud')
            .setIcon('audio-lines')
            .onClick(async () => {
              this.plugin.readNoteAloud(editor, view);
            });
        });

        if (this.settings.generateMP3) {
          menu.addItem((item: any) => {
            item
              .setTitle('Generate MP3')
              .setIcon('microphone')
              .onClick(async () => {
                await this.plugin.generateMP3(editor, view);
              });
          });
        }
      })
    );
  }

  /**
   * Set the TTS engine reference
   */
  setTTSEngine(ttsEngine: TTSEngine): void {
    this.ttsEngine = ttsEngine;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EdgeTTSPluginSettings): void {
    this.settings = settings;
  }
} 