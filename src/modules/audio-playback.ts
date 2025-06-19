import { EdgeTTSPluginSettings } from './settings';
import { Notice, Platform } from 'obsidian';
import { UniversalTTSClient as EdgeTTSClient, OUTPUT_FORMAT, createProsodyOptions } from './tts-client-wrapper';
import { filterFrontmatter, filterMarkdown, shouldShowNotices } from '../utils';

// Create a ProsodyOptions class that matches the old API
class ProsodyOptions {
  rate?: number;

  constructor() {
    // Initialize with defaults
  }
}
import type { FileOperationsManager } from './file-operations';
import type { App } from 'obsidian';

/**
 * Handles all audio playback functionality for the Edge TTS plugin
 */
export class AudioPlaybackManager {
  private audioElement: HTMLAudioElement;
  private app: App;
  private fileManager: FileOperationsManager;
  private isPaused = false;
  private updateStatusBarCallback: (withControls: boolean) => void;
  private settings: EdgeTTSPluginSettings;
  private showFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void;
  private hideFloatingPlayerCallback: () => void;
  private updateFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void;
  private currentPlaybackId = 0;

  // Auto-pause functionality
  private wasPlayingBeforeBlur = false;

  // Playback queue functionality
  private playbackQueue: Array<{ text: string, title?: string }> = [];
  private currentQueueIndex = -1;
  private isPlayingFromQueue = false;
  private loopEnabled = false; // Loop queue functionality

  // Sleep timer functionality
  private sleepTimerTimeout: number | null = null;
  private sleepTimerMinutes = 0;

  // MSE specific properties
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private completeMp3BufferArray: Uint8Array[] = [];
  private mseAudioQueue: Uint8Array[] = [];
  private isAppendingBuffer = false; // To manage sequential appends to SourceBuffer
  private isStreamingWithMSE = false;
  private isSwitchingToFullFile = false;
  private streamedPlaybackTimeBeforeSwitch = 0;

  // Queue change notification callback
  private queueChangeCallback?: () => void;

  // Queue UI update callback (for playback state changes)
  private queueUIUpdateCallback?: () => void;

  // Media Session API integration for Android system controls
  private mediaSessionSupported = false;

  constructor(
    settings: EdgeTTSPluginSettings,
    updateStatusBarCallback: (withControls: boolean) => void,
    showFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void,
    hideFloatingPlayerCallback: () => void,
    updateFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void,
    fileManager: FileOperationsManager,
    app: App
  ) {
    this.settings = settings;
    this.updateStatusBarCallback = updateStatusBarCallback;
    this.showFloatingPlayerCallback = showFloatingPlayerCallback;
    this.hideFloatingPlayerCallback = hideFloatingPlayerCallback;
    this.updateFloatingPlayerCallback = updateFloatingPlayerCallback;
    this.fileManager = fileManager;
    this.app = app;
    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';
    this.setupAudioEventListeners();
    this.setupAutoPauseListeners();
    this.initializeMediaSession();
  }

  private setupAudioEventListeners(): void {
    this.audioElement.onloadedmetadata = () => {
      if (this.isStreamingWithMSE && !this.isSwitchingToFullFile) {
        // With MediaSource, duration might initially be Infinity or change.
        // We might set it explicitly once known or let it be handled by MediaSource.
        // For now, we only care about this event when switching to the full file.
        return;
      }
      if (this.isSwitchingToFullFile) {
        this.audioElement.currentTime = this.streamedPlaybackTimeBeforeSwitch;
        this.isSwitchingToFullFile = false;
        if (!this.isPaused) { // Resume playback if it wasn't paused before switch
          this.audioElement.play().catch(e => console.error("Error playing after source switch:", e));
        }
        this.updateFloatingPlayerCallback({
          currentTime: this.audioElement.currentTime,
          duration: this.audioElement.duration, // Now we have the full file duration
          isPlaying: !this.audioElement.paused,
          isLoading: false,
        });
        return;
      }

      // Original onloadedmetadata logic for non-MSE playback (e.g. if we directly load a file initially)
      this.updateFloatingPlayerCallback({
        currentTime: this.audioElement.currentTime,
        duration: this.audioElement.duration,
        isPlaying: !this.audioElement.paused,
        isLoading: false,
      });

      // Set up Media Session metadata when audio is loaded
      this.updateMediaSessionMetadata(this.getCurrentAudioTitle(), this.audioElement.duration);
    };

    this.audioElement.ontimeupdate = () => {
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({
          currentTime: this.audioElement.currentTime,
          duration: this.isStreamingWithMSE && !this.mediaSource?.duration ? Infinity : this.audioElement.duration, // Handle MSE duration
          isPlaying: !this.audioElement.paused,
          isLoading: false,
        });
      }
      // Update Media Session position for system controls
      this.updateMediaSessionPosition();
    };

    this.audioElement.onended = () => {
      if (this.isStreamingWithMSE && this.mediaSource && this.mediaSource.readyState === 'ended') {
        // This is the end of the MSE stream, before switching to the full file.
        // The actual "finished reading" will happen after the full file plays or if no switch occurs.
        console.log("MSE stream ended.");
        // The switch to the full file should be initiated elsewhere (e.g., after saving the full buffer)
        // For now, we assume if enableReplayOption is on, we keep player open.
        if (this.settings.enableReplayOption && !this.settings.disablePlaybackControlPopover) {
          this.isPaused = true;
          this.updateFloatingPlayerCallback({
            currentTime: this.audioElement.currentTime, // Should be near duration if MSE set it
            duration: this.audioElement.duration,
            isPlaying: false,
            isLoading: false,
          });
        } else {
          this.resetPlaybackStateAndHidePlayer();
          this.updateStatusBarCallback(false);
        }
        return;
      }

      // Original onended logic (for when playing the full MP3 file)
      if (shouldShowNotices(this.settings)) new Notice('Finished reading aloud.');

      // Check if we should play next item in queue
      if (this.isPlayingFromQueue) {
        // Small delay before playing next item
        setTimeout(() => this.playNextInQueue(), 1000);
        return;
      }

      if (this.settings.enableReplayOption && !this.settings.disablePlaybackControlPopover) {
        this.isPaused = true;
        this.updateStatusBarCallback(false);
        if (!this.settings.disablePlaybackControlPopover) {
          this.updateFloatingPlayerCallback({
            currentTime: this.audioElement.duration,
            duration: this.audioElement.duration,
            isPlaying: false,
            isLoading: false,
          });
        }
      } else {
        this.resetPlaybackStateAndHidePlayer();
        this.updateStatusBarCallback(false);
      }
    };

    this.audioElement.onpause = () => {
      this.isPaused = true; // isPaused is critical for our logic
      this.updateStatusBarCallback(true);
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({
          currentTime: this.audioElement.currentTime,
          duration: this.isStreamingWithMSE && !this.mediaSource?.duration ? Infinity : this.audioElement.duration,
          isPlaying: false,
          isLoading: false, // isLoading is false if paused
        });
      }

      // Update Media Session state
      if (this.mediaSessionSupported && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'paused';
      }
    };

    this.audioElement.onplay = () => {
      this.isPaused = false;
      // isLoading state is handled by the updateFloatingPlayerCallback
      this.updateStatusBarCallback(true);
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({
          currentTime: this.audioElement.currentTime,
          duration: this.isStreamingWithMSE && !this.mediaSource?.duration ? Infinity : this.audioElement.duration,
          isPlaying: true,
          isLoading: false, // When actually playing, loading is done for that segment/file
        });
      }

      // Update Media Session state and metadata when playback starts
      if (this.mediaSessionSupported && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';

        if (this.isAndroid()) {
          // Android: Reinitialize handlers on first play (sometimes needed for webview)
          this.setupMediaSessionHandlers();
          // Longer delay for Android to ensure webview is ready
          setTimeout(() => {
            this.updateMediaSessionMetadata(this.getCurrentAudioTitle(), this.audioElement.duration);
          }, 300);
        } else {
          // iOS/other platforms: Set metadata with small delay
          setTimeout(() => {
            this.updateMediaSessionMetadata(this.getCurrentAudioTitle(), this.audioElement.duration);
          }, 100);
        }
      }
    };

    // Listener for SourceBuffer updates
    // This needs to be added when sourceBuffer is created.
  }

  private setupAutoPauseListeners(): void {
    // Auto-pause when user switches away from Obsidian
    window.addEventListener('blur', () => {
      if (this.settings.autoPauseOnWindowBlur && !this.audioElement.paused) {
        this.wasPlayingBeforeBlur = true;
        this.pausePlayback();
      }
    });

    window.addEventListener('focus', () => {
      if (this.settings.autoPauseOnWindowBlur && this.wasPlayingBeforeBlur && this.audioElement.paused) {
        this.wasPlayingBeforeBlur = false;
        this.resumePlayback();
      }
    });
  }

  /**
   * Initialize Media Session API for system media controls (Android/Chrome)
   */
  private initializeMediaSession(): void {
    // Only enable if experimental features are enabled
    if (!this.settings.enableExperimentalFeatures) {
      console.log('Media Session: Experimental features disabled');
      return;
    }

    // Check if Media Session API is supported
    if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
      this.mediaSessionSupported = true;
      console.log('Media Session: API supported, setting up handlers');

      // Android-specific: Add delay for webview initialization
      if (this.isAndroid()) {
        console.log('Media Session: Android detected, using delayed initialization');
        setTimeout(() => {
          this.setupMediaSessionHandlers();
        }, 500); // Give Android webview time to fully initialize
      } else {
        this.setupMediaSessionHandlers();
      }
    } else {
      console.log('Media Session: API not supported in this browser');
    }
  }

  /**
   * Set up Media Session API action handlers
   */
  private setupMediaSessionHandlers(): void {
    if (!this.mediaSessionSupported || !navigator.mediaSession) return;

    try {
      // Set up action handlers for system media controls
      navigator.mediaSession.setActionHandler('play', () => {
        this.resumePlayback();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        this.pausePlayback();
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        this.stopPlayback();
      });

      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const seekTime = details.seekOffset || 10;
        this.jumpBackward(seekTime);
      });

      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const seekTime = details.seekOffset || 10;
        this.jumpForward(seekTime);
      });

      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seekPlayback(details.seekTime);
        }
      });

      // Queue navigation handlers (if queue is enabled)
      if (this.settings.enableQueueFeature) {
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (this.isPlayingFromQueue && this.currentQueueIndex > 0) {
            this.playQueueItem(this.currentQueueIndex - 1);
          }
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (this.isPlayingFromQueue && this.currentQueueIndex < this.playbackQueue.length - 1) {
            this.playQueueItem(this.currentQueueIndex + 1);
          }
        });
      }
    } catch (error) {
      console.warn('Failed to set up Media Session handlers:', error);
    }
  }

  /**
   * Update Media Session metadata
   */
  private updateMediaSessionMetadata(title?: string, duration?: number): void {
    if (!this.mediaSessionSupported || !navigator.mediaSession) return;

    try {
      const metadata: any = {
        title: title || 'Edge TTS Audio',
        artist: 'Obsidian Edge TTS',
        album: 'Text-to-Speech',
      };

      // Add queue information if playing from queue
      if (this.isPlayingFromQueue && this.playbackQueue.length > 0) {
        const queueInfo = ` (${this.currentQueueIndex + 1}/${this.playbackQueue.length})`;
        metadata.title = (title || 'Queue Item') + queueInfo;
      }

      console.log('Media Session: Setting metadata:', metadata);
      navigator.mediaSession.metadata = new MediaMetadata(metadata);

      // Android-specific: Set playback state before position state
      const playbackState = this.audioElement.paused ? 'paused' : 'playing';
      console.log('Media Session: Setting playback state:', playbackState);
      navigator.mediaSession.playbackState = playbackState;

      // Update position state for seeking support (with Android-specific handling)
      if (duration && duration !== Infinity) {
        console.log('Media Session: Setting position state:', { duration, position: this.audioElement.currentTime });

        if (this.isAndroid()) {
          // Android: Add small delay before setting position state
          setTimeout(() => {
            try {
              navigator.mediaSession?.setPositionState({
                duration: duration,
                playbackRate: this.audioElement.playbackRate,
                position: this.audioElement.currentTime,
              });
            } catch (posError) {
              console.warn('Android position state failed:', posError);
            }
          }, 100);
        } else {
          // iOS/other platforms: Set immediately
          navigator.mediaSession.setPositionState({
            duration: duration,
            playbackRate: this.audioElement.playbackRate,
            position: this.audioElement.currentTime,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to update Media Session metadata:', error);
    }
  }

  /**
   * Update Media Session position state
   */
  private updateMediaSessionPosition(): void {
    if (!this.mediaSessionSupported || !navigator.mediaSession) return;

    try {
      const duration = this.audioElement.duration;
      if (duration && duration !== Infinity && !isNaN(duration)) {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: this.audioElement.playbackRate,
          position: this.audioElement.currentTime,
        });
      }
    } catch (error) {
      // Silently fail - position updates happen frequently
    }
  }

  /**
   * Clear Media Session when playback stops
   */
  private clearMediaSession(): void {
    if (!this.mediaSessionSupported || !navigator.mediaSession) return;

    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (error) {
      console.warn('Failed to clear Media Session:', error);
    }
  }

  /**
   * Get the current audio title for Media Session
   */
  private getCurrentAudioTitle(): string {
    if (this.isPlayingFromQueue && this.currentQueueIndex >= 0 && this.playbackQueue[this.currentQueueIndex]) {
      return this.playbackQueue[this.currentQueueIndex].title || 'Queue Item';
    }
    return 'Edge TTS Audio';
  }

  /**
   * Detect if running on Android
   */
  private isAndroid(): boolean {
    return /Android/i.test(navigator.userAgent);
  }

  /**
   * Appends data from the mseAudioQueue to the SourceBuffer.
   * Manages sequential appends.
   */
  private appendNextChunkToSourceBuffer(): void {
    if (this.isAppendingBuffer || !this.sourceBuffer || this.sourceBuffer.updating || this.mseAudioQueue.length === 0) {
      return;
    }

    if (this.mediaSource && this.mediaSource.readyState === 'ended') {
      // console.log("MediaSource is ended, not appending more chunks.");
      this.isAppendingBuffer = false;
      return;
    }

    this.isAppendingBuffer = true;
    const chunk = this.mseAudioQueue.shift();
    try {
      this.sourceBuffer.appendBuffer(chunk as BufferSource); // Type assertion
      // Playback will be triggered from onupdateend or when enough data is buffered initially
    } catch (e: any) {
      console.error('Error appending buffer:', e);
      // Handle specific errors like QuotaExceededError or InvalidStateError
      if (e.name === 'QuotaExceededError') {
        // MSE buffer is full. This might happen if data is arriving faster than it can be played.
        // Or if the content is very long. MSE has limits.
        // We might need a strategy here, like pausing the TTS stream or more complex buffer management.
        console.warn('MSE QuotaExceededError. Playback might be affected.');
        // For now, we'll stop trying to append if quota is exceeded and log it.
        // In a more robust solution, we might pause fetching or clear older buffer ranges.
        this.isAppendingBuffer = false;
        // Potentially stop playback or signal an error to the user
        this.stopPlaybackInternal(); // Stop playback if we can't buffer anymore
        if (this.settings.showNotices) new Notice('Audio buffer limit reached. Playback stopped.');
        return;
      }
      this.isAppendingBuffer = false;
      // Attempt to process next chunk even if this one failed, unless it's a critical error
      // queueMicrotask(() => this.appendNextChunkToSourceBuffer());
    }
  }

  /**
   * Check if MediaSource Extensions are supported
   */
  private isMSESupported(): boolean {
    return typeof window !== 'undefined' &&
      'MediaSource' in window &&
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported &&
      MediaSource.isTypeSupported('audio/mpeg');
  }

  /**
   * Start text-to-speech playback
   * @param selectedText Text to read aloud
   */
  async startPlayback(selectedText: string): Promise<void> {
    // 1. Stop any existing playback and clean up resources
    this.stopPlaybackInternal(); // This also resets MSE vars and currentPlaybackId
    this.currentPlaybackId++; // Create a new ID for this playback attempt
    const activePlaybackAttemptId = this.currentPlaybackId;

    // Check if we should use MSE or fallback approach
    const useMSE = this.isMSESupported();
    this.isStreamingWithMSE = useMSE;

    this.isPaused = false; // Reset isPaused for the new playback session
    this.completeMp3BufferArray = [];
    this.mseAudioQueue = [];
    this.isAppendingBuffer = false;

    // 2. Update UI to show loading state immediately
    if (!this.settings.disablePlaybackControlPopover) {
      this.showFloatingPlayerCallback({
        currentTime: 0,
        duration: useMSE ? Infinity : 0, // Duration is unknown with MSE initially
        isPlaying: false,   // Will be true once playback starts
        isLoading: true,
      });
    }

    // 3. Validate and clean text
    if (!selectedText.trim()) {
      if (shouldShowNotices(this.settings)) new Notice('No text selected or available.');
      if (!this.settings.disablePlaybackControlPopover) this.hideFloatingPlayerCallback();
      this.isStreamingWithMSE = false; // Reset flag
      return;
    }
    const cleanText = this.settings ? filterMarkdown(filterFrontmatter(selectedText), this.settings.textFiltering, this.settings.symbolReplacement) : filterMarkdown(filterFrontmatter(selectedText));
    if (!cleanText.trim()) {
      if (this.settings.showNotices) new Notice('No readable text after filtering.');
      if (!this.settings.disablePlaybackControlPopover) this.hideFloatingPlayerCallback();
      this.isStreamingWithMSE = false; // Reset flag
      return;
    }

    if (useMSE) {
      // 4a. Initialize MediaSource (desktop/browsers with MSE support)
      await this.startMSEPlayback(cleanText, activePlaybackAttemptId);
    } else {
      // 4b. Use fallback approach (mobile/browsers without MSE support)
      await this.startFallbackPlayback(cleanText, activePlaybackAttemptId);
    }
  }

  /**
   * Start MSE-based playback for supported browsers
   */
  private async startMSEPlayback(cleanText: string, activePlaybackAttemptId: number): Promise<void> {
    this.mediaSource = new MediaSource();
    this.audioElement.src = URL.createObjectURL(this.mediaSource);
    // audioElement.load() is implicitly called when src is set

    this.mediaSource.addEventListener('sourceopen', () => {
      if (this.currentPlaybackId !== activePlaybackAttemptId || !this.mediaSource) return;
      URL.revokeObjectURL(this.audioElement.src); // Revoke old blob URL if any, though new one was just set

      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg'); // For MP3
        this.sourceBuffer.mode = 'sequence'; // Ensures correct playback of appended segments

        this.sourceBuffer.addEventListener('updateend', () => {
          this.isAppendingBuffer = false;
          // If playback hasn't started and buffer has some data, try to play
          if (!this.isPaused && this.audioElement.paused && this.sourceBuffer && this.sourceBuffer.buffered.length > 0) {
            const playPromise = this.audioElement.play();
            if (playPromise !== undefined) {
              playPromise.then(_ => {
                // Playback started
                if (this.currentPlaybackId === activePlaybackAttemptId && !this.settings.disablePlaybackControlPopover) {
                  this.updateFloatingPlayerCallback({
                    currentTime: this.audioElement.currentTime,
                    duration: Infinity, // Duration may still be unknown or evolving with MSE
                    isPlaying: true,
                    isLoading: true, // Keep isLoading true while stream is active
                  });
                }
              }).catch(error => {
                console.error("Error starting MSE playback:", error);
                if (this.settings.showNotices) new Notice('Error starting audio playback.');
                this.stopPlaybackInternal();
              });
            }
          }
          this.appendNextChunkToSourceBuffer(); // Continue processing queue
        });

        this.sourceBuffer.addEventListener('error', (ev) => {
          console.error('SourceBuffer error', ev);
          if (this.settings.showNotices) new Notice('Audio playback error (SourceBuffer).');
          this.stopPlaybackInternal();
        });

        // Start processing any chunks that might have arrived before sourceBuffer was ready
        this.appendNextChunkToSourceBuffer();

      } catch (e) {
        console.error('Error setting up MediaSource SourceBuffer:', e);
        if (this.settings.showNotices) new Notice('Failed to initialize audio stream.');
        this.stopPlaybackInternal();
      }
    });

    this.mediaSource.addEventListener('sourceended', () => {
      // This means endOfStream() was called and all bufferring is complete from MSE perspective
    });
    this.mediaSource.addEventListener('sourceclose', () => {
      // Occurs when the media element is no longer using the media source
      this.isStreamingWithMSE = false; // MSE session is truly over
    });

    // Start TTS stream processing
    await this.processTTSStream(cleanText, activePlaybackAttemptId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, true);
  }

  /**
   * Start fallback playback for mobile/browsers without MSE support
   */
  private async startFallbackPlayback(cleanText: string, activePlaybackAttemptId: number): Promise<void> {
    // For mobile, we'll generate the complete audio first, then play it
    // This avoids MSE entirely and uses traditional audio playback
    // Use MP3 format which is better supported on mobile devices
    await this.processTTSStream(cleanText, activePlaybackAttemptId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, false);
  }

  /**
   * Process TTS stream - common logic for both MSE and fallback approaches
   */
  private async processTTSStream(cleanText: string, activePlaybackAttemptId: number, outputFormat: string, useMSE: boolean): Promise<void> {
    try {
      if (this.settings.showNotices) {
        new Notice(useMSE ? 'Starting audio stream...' : 'Generating audio...');
      }
      this.updateStatusBarCallback(true);

      const tts = new EdgeTTSClient();
      const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;
      await tts.setMetadata(voiceToUse, outputFormat);

      const prosodyOptions = new ProsodyOptions();
      prosodyOptions.rate = this.settings.playbackSpeed;

      const readable = tts.toStream(cleanText, prosodyOptions);

      readable.on('data', (data: Uint8Array) => {
        if (this.currentPlaybackId !== activePlaybackAttemptId) {
          return;
        }
        this.completeMp3BufferArray.push(data);
        if (useMSE) {
          this.mseAudioQueue.push(data);
          this.appendNextChunkToSourceBuffer();
        }
      });

      readable.on('end', async () => {
        if (this.currentPlaybackId !== activePlaybackAttemptId) return;

        if (useMSE) {
          // MSE-specific end logic
          await this.finishMSEPlayback(activePlaybackAttemptId);
        } else {
          // Fallback end logic
          await this.finishFallbackPlayback(activePlaybackAttemptId);
        }
      });

    } catch (error) {
      console.error('Error processing TTS stream:', error);
      if (this.currentPlaybackId === activePlaybackAttemptId) {
        if (this.settings.showNotices) new Notice('Failed to read note aloud.');
        this.stopPlaybackInternal();
      }
    }
  }

  /**
   * Finish MSE playback
   */
  private async finishMSEPlayback(activePlaybackAttemptId: number): Promise<void> {
    // Ensure all MSE chunks are processed before ending the stream
    const waitForMseQueue = async () => {
      while (this.mseAudioQueue.length > 0 || this.isAppendingBuffer) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await waitForMseQueue();

    if (this.mediaSource && this.mediaSource.readyState === 'open' && this.sourceBuffer) {
      try {
        if (!this.sourceBuffer.updating) {
          this.mediaSource.endOfStream();
        } else {
          const onUpdateEnd = () => {
            if (this.mediaSource && this.mediaSource.readyState === 'open') {
              try { this.mediaSource.endOfStream(); } catch (e) { console.warn("Error in endOfStream (onUpdateEnd)", e); }
            }
            this.sourceBuffer?.removeEventListener('updateend', onUpdateEnd);
          };
          this.sourceBuffer.addEventListener('updateend', onUpdateEnd);
        }
      } catch (e) {
        console.warn('Error calling endOfStream on TTS end:', e);
      }
    }

    // Handle empty stream
    if (this.completeMp3BufferArray.length === 0) {
      if (this.settings.showNotices) new Notice('TTS stream was empty.');
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
        this.hideFloatingPlayerCallback();
      }
      this.updateStatusBarCallback(false);
      this.isStreamingWithMSE = false;
      return;
    }

    // Save complete buffer for replay functionality
    const completeBuffer = Buffer.concat(this.completeMp3BufferArray);
    const tempFilePath = await this.fileManager.saveTempAudioFile(completeBuffer);

    if (this.currentPlaybackId !== activePlaybackAttemptId) {
      this.isStreamingWithMSE = false;
      return;
    }

    if (!tempFilePath && this.settings.showNotices && !Platform.isMobile) {
      new Notice('Failed to save temporary audio for playback.');
    }

    if (!this.settings.disablePlaybackControlPopover) {
      this.updateFloatingPlayerCallback({
        currentTime: this.audioElement.currentTime,
        duration: this.audioElement.duration,
        isPlaying: !this.audioElement.paused,
        isLoading: false
      });
    }
  }

  /**
 * Finish fallback playback
 */
  private async finishFallbackPlayback(activePlaybackAttemptId: number): Promise<void> {
    if (this.completeMp3BufferArray.length === 0) {
      if (this.settings.showNotices) new Notice('TTS stream was empty.');
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
        this.hideFloatingPlayerCallback();
      }
      this.updateStatusBarCallback(false);
      return;
    }

    try {
      // Show progress feedback
      if (this.settings.showNotices) new Notice('Processing audio for playback...');

      // Create buffer for file operations
      let completeBuffer: Buffer | Uint8Array;

      if (Platform.isMobile || typeof Buffer === 'undefined') {
        // Mobile environment - manual concatenation to Uint8Array
        const totalLength = this.completeMp3BufferArray.reduce((sum, arr) => sum + arr.length, 0);
        const concatenated = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of this.completeMp3BufferArray) {
          concatenated.set(arr, offset);
          offset += arr.length;
        }
        completeBuffer = concatenated;
      } else {
        // Desktop environment - use Buffer.concat
        completeBuffer = Buffer.concat(this.completeMp3BufferArray);
      }

      if (this.currentPlaybackId !== activePlaybackAttemptId) return;

      // Try to save as temp file first (works better for mobile)
      const tempFilePath = await this.fileManager.saveTempAudioFile(completeBuffer);

      if (tempFilePath) {
        // Use temp file approach (more reliable on mobile)
        this.audioElement.src = this.fileManager.getTempAudioFileResourcePath() || '';
        this.audioElement.load();

        const onLoadedMetadata = () => {
          if (this.currentPlaybackId !== activePlaybackAttemptId) return;

          if (!this.settings.disablePlaybackControlPopover) {
            this.updateFloatingPlayerCallback({
              currentTime: 0,
              duration: this.audioElement.duration,
              isPlaying: false,
              isLoading: false
            });
          }

          // Start playback
          const playPromise = this.audioElement.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              if (this.currentPlaybackId === activePlaybackAttemptId && !this.settings.disablePlaybackControlPopover) {
                this.updateFloatingPlayerCallback({
                  currentTime: this.audioElement.currentTime,
                  duration: this.audioElement.duration,
                  isPlaying: true,
                  isLoading: false
                });
              }
            }).catch(error => {
              console.error("Error starting temp file playback:", error);
              if (this.settings.showNotices) new Notice('Error starting audio playback.');
              this.stopPlaybackInternal();
            });
          }

          this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        };

        const onError = () => {
          if (this.settings.showNotices) new Notice('Failed to load temp audio file.');
          this.fallbackToBlobPlayback(completeBuffer, activePlaybackAttemptId);
          this.audioElement.removeEventListener('error', onError);
          this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        };

        this.audioElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        this.audioElement.addEventListener('error', onError, { once: true });

      } else {
        // Fallback to blob approach if temp file fails
        this.fallbackToBlobPlayback(completeBuffer, activePlaybackAttemptId);
      }

    } catch (error) {
      console.error('Error in finishFallbackPlayback:', error);
      if (this.settings.showNotices) new Notice('Failed to process audio for mobile playback.');
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
        this.hideFloatingPlayerCallback();
      }
      this.updateStatusBarCallback(false);
    }
  }

  /**
   * Fallback to blob-based playback when temp file approach fails
   */
  private fallbackToBlobPlayback(buffer: Buffer | Uint8Array, activePlaybackAttemptId: number): void {
    try {
      // Convert to ArrayBuffer for blob
      let arrayBuffer: ArrayBuffer;

      // Simple conversion that works for both Buffer and Uint8Array
      if (buffer instanceof Uint8Array) {
        arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } else {
        // Convert Buffer to Uint8Array first, then to ArrayBuffer
        const uint8Array = new Uint8Array(buffer);
        arrayBuffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
      }

      // Create blob and play - use MP3 MIME type
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      this.audioElement.src = audioUrl;
      this.audioElement.load();

      const onError = () => {
        if (this.settings.showNotices) new Notice('Audio playback failed on mobile device.');
        if (!this.settings.disablePlaybackControlPopover) {
          this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
          this.hideFloatingPlayerCallback();
        }
        this.updateStatusBarCallback(false);
        URL.revokeObjectURL(audioUrl);
        this.audioElement.removeEventListener('error', onError);
        this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
      };

      const onLoadedMetadata = () => {
        if (this.currentPlaybackId !== activePlaybackAttemptId) {
          URL.revokeObjectURL(audioUrl);
          return;
        }

        if (!this.settings.disablePlaybackControlPopover) {
          this.updateFloatingPlayerCallback({
            currentTime: 0,
            duration: this.audioElement.duration,
            isPlaying: false,
            isLoading: false
          });
        }

        // Start playback
        const playPromise = this.audioElement.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            if (this.currentPlaybackId === activePlaybackAttemptId && !this.settings.disablePlaybackControlPopover) {
              this.updateFloatingPlayerCallback({
                currentTime: this.audioElement.currentTime,
                duration: this.audioElement.duration,
                isPlaying: true,
                isLoading: false
              });
            }
          }).catch(error => {
            console.error("Error starting blob playback:", error);
            if (this.settings.showNotices) new Notice('Final audio playback attempt failed.');
            this.stopPlaybackInternal();
          });
        }

        // Clean up blob URL when audio ends
        this.audioElement.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
        }, { once: true });

        this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        this.audioElement.removeEventListener('error', onError);
      };

      this.audioElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      this.audioElement.addEventListener('error', onError, { once: true });

    } catch (error) {
      console.error('Error in fallbackToBlobPlayback:', error);
      if (this.settings.showNotices) new Notice('Critical audio playback error.');
      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
        this.hideFloatingPlayerCallback();
      }
      this.updateStatusBarCallback(false);
    }
  }

  /**
   * Pause current playback 
   */
  pausePlayback(): void {
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }
  }

  /**
   * Resume paused playback
   */
  resumePlayback(): void {
    if (this.audioElement && this.audioElement.paused) {
      this.audioElement.play().catch(e => console.error("Error resuming playback:", e));
    }
  }

  /**
   * Stop playback completely
   */
  stopPlayback(): void {
    this.currentPlaybackId++;
    this.stopPlaybackInternal();
  }

  private stopPlaybackInternal(): void {
    this.currentPlaybackId++; // Invalidate ongoing TTS fetches or MSE operations
    this.isStreamingWithMSE = false;
    this.isSwitchingToFullFile = false;
    this.streamedPlaybackTimeBeforeSwitch = 0;
    this.mseAudioQueue = [];
    this.isAppendingBuffer = false;
    this.cancelSleepTimer(); // Cancel sleep timer when stopping

    if (this.mediaSource) {
      if (this.mediaSource.readyState === 'open' && this.sourceBuffer && this.sourceBuffer.updating) {
        try {
          this.sourceBuffer.abort(); // Abort current append if any
        } catch (e) {
          console.warn("Error aborting sourceBuffer:", e);
        }
      }
      if (this.mediaSource.readyState === 'open') {
        try {
          // Only call endOfStream if it hasn't been called and sourceBuffer exists
          if (this.sourceBuffer) this.mediaSource.endOfStream();
        } catch (e) {
          console.warn("Error calling endOfStream on mediaSource stop:", e);
        }
      }
      // Detach MediaSource from element. Important for cleanup.
      if (this.audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audioElement.src);
      }
      this.mediaSource = null;
      this.sourceBuffer = null;
    }

    if (this.audioElement) {
      this.audioElement.pause();
      if (this.audioElement.src && !this.audioElement.src.startsWith('blob:')) { // Don't clear blob URL if it was just revoked
        this.audioElement.src = '';
        this.audioElement.load();
      } else if (!this.audioElement.src) {
        // If src is already empty (e.g. after blob revocation and before new src set), ensure load is called to reset.
        this.audioElement.load();
      }

      if (!this.settings.disablePlaybackControlPopover) {
        this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
      }
      this.resetPlaybackStateAndHidePlayer();
      this.updateStatusBarCallback(false);
    }
    this.completeMp3BufferArray = []; // Clear the MP3 buffer

    // Clear Media Session
    this.clearMediaSession();
  }

  /**
   * Clean up audio resources and reset state, conditionally hiding the player.
   */
  resetPlaybackStateAndHidePlayer(): void {
    this.isPaused = false;
    if (!this.settings.disablePlaybackControlPopover) {
      this.hideFloatingPlayerCallback();
    }
    // Note: We no longer clear this.currentPlaybackId here as stopPlayback() handles it.
    // Clearing audioElement.src is now specific to stopPlaybackInternal.
  }

  /**
   * Replays the current audio from the beginning.
   */
  replayPlayback(): void {
    if (this.audioElement && this.audioElement.src && this.audioElement.duration > 0) {
      this.audioElement.currentTime = 0;
      this.isPaused = false; // Ensure onplay event sets correct UI state
      this.audioElement.play().catch(e => {
        console.error("Error during replay:", e);
        if (this.settings.showNotices) new Notice('Error replaying audio.');
        this.stopPlaybackInternal(); // If replay fails, fully stop
      });
      // The onplay event handler will call updateFloatingPlayerCallback and updateStatusBarCallback
    } else {
      if (this.settings.showNotices) new Notice('No audio to replay or audio not fully loaded.');
      // If called inappropriately, ensure UI is in a clean stopped state
      this.stopPlaybackInternal();
    }
  }

  /**
   * Check if audio is currently paused
   */
  isPlaybackPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Check if audio is currently playing
   */
  isPlaying(): boolean {
    return this.audioElement !== null && !this.audioElement.paused;
  }

  /**
   * Jumps playback forward by a specified amount of time (default 10 seconds).
   */
  jumpForward(seconds = 10): void {
    if (this.audioElement && this.audioElement.duration > 0) {
      const newTime = Math.min(this.audioElement.currentTime + seconds, this.audioElement.duration);
      this.seekPlayback(newTime);
    }
  }

  /**
   * Jumps playback backward by a specified amount of time (default 10 seconds).
   */
  jumpBackward(seconds = 10): void {
    if (this.audioElement && this.audioElement.duration > 0) {
      const newTime = Math.max(this.audioElement.currentTime - seconds, 0);
      this.seekPlayback(newTime);
    }
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EdgeTTSPluginSettings): void {
    this.settings = settings;

    // Re-initialize Media Session if experimental features were toggled
    this.initializeMediaSession();
  }

  /**
   * Seek playback to a specific time
   * @param time Time in seconds to seek to
   */
  seekPlayback(time: number): void {
    if (this.audioElement && this.audioElement.seekable && this.audioElement.seekable.length > 0) {
      const newTime = Math.max(0, Math.min(time, this.audioElement.duration));
      if (isFinite(newTime) && isFinite(this.audioElement.duration) && this.audioElement.duration > 0) {
        this.audioElement.currentTime = newTime;
      } else {
        console.warn(
          'Cannot seek: Audio duration is not yet available or is invalid.',
          {
            currentTime: this.audioElement.currentTime,
            duration: this.audioElement.duration,
            readyState: this.audioElement.readyState,
            seekable: this.audioElement.seekable,
          }
        );
      }
    } else {
      console.warn(
        'Cannot seek: Audio element is not seekable or has no seekable ranges.',
        {
          readyState: this.audioElement.readyState,
          seekable: this.audioElement.seekable,
        }
      );
    }
  }

  /**
   * Setter for floating player callbacks, to avoid circular dependency issues during instantiation.
   */
  public setFloatingPlayerCallbacks(
    showFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void,
    hideFloatingPlayerCallback: () => void,
    updateFloatingPlayerCallback: (data: { currentTime: number, duration: number, isPlaying: boolean, isLoading: boolean }) => void
  ): void {
    this.showFloatingPlayerCallback = (data) => {
      if (!this.settings.disablePlaybackControlPopover) {
        showFloatingPlayerCallback(data);
      }
    };
    this.hideFloatingPlayerCallback = () => {
      if (!this.settings.disablePlaybackControlPopover) {
        hideFloatingPlayerCallback();
      }
    };
    this.updateFloatingPlayerCallback = (data) => {
      if (!this.settings.disablePlaybackControlPopover) {
        updateFloatingPlayerCallback(data);
      }
    };
  }

  /**
   * Set callback for queue changes
   */
  public setQueueChangeCallback(callback: () => void): void {
    this.queueChangeCallback = callback;
  }

  /**
   * Set callback for queue UI updates (playback state changes)
   */
  public setQueueUIUpdateCallback(callback: () => void): void {
    this.queueUIUpdateCallback = callback;
  }

  /**
   * Notify that queue has changed
   */
  private notifyQueueChange(): void {
    if (this.queueChangeCallback) {
      this.queueChangeCallback();
    }
  }

  /**
   * Notify that queue UI should update (playback state changes)
   */
  private notifyQueueUIUpdate(): void {
    if (this.queueUIUpdateCallback) {
      this.queueUIUpdateCallback();
    }
  }

  /**
   * Add text to playback queue
   */
  addToQueue(text: string, title?: string): void {
    this.playbackQueue.push({ text, title });
    if (this.settings.showNotices) {
      new Notice(`Added "${title || 'text'}" to playback queue (${this.playbackQueue.length} items)`);
    }
    this.notifyQueueChange();
  }

  /**
   * Start playing the queue from the beginning
   */
  async playQueue(): Promise<void> {
    if (this.playbackQueue.length === 0) {
      if (this.settings.showNotices) new Notice('Playback queue is empty.');
      return;
    }

    this.currentQueueIndex = 0;
    this.isPlayingFromQueue = true;
    this.notifyQueueUIUpdate(); // Update queue UI when starting queue playback
    await this.playCurrentQueueItem();
  }

  /**
   * Play the next item in queue automatically
   */
  private async playNextInQueue(): Promise<void> {
    if (!this.isPlayingFromQueue || this.currentQueueIndex >= this.playbackQueue.length - 1) {
      if (this.loopEnabled && this.playbackQueue.length > 0) {
        // Loop back to the beginning
        this.currentQueueIndex = 0;
        this.notifyQueueUIUpdate(); // Update queue UI to show looping
        if (this.settings.showNotices) new Notice('Queue looping - restarting from beginning.');
        await this.playCurrentQueueItem();
        return;
      } else {
        // Normal end of queue
        this.isPlayingFromQueue = false;
        this.currentQueueIndex = -1;
        this.notifyQueueUIUpdate(); // Update queue UI when queue finishes
        if (this.settings.showNotices) new Notice('Finished playing queue.');
        return;
      }
    }

    this.currentQueueIndex++;
    this.notifyQueueUIUpdate(); // Update queue UI to show new playing item
    await this.playCurrentQueueItem();
  }

  /**
   * Play the current queue item
   */
  private async playCurrentQueueItem(): Promise<void> {
    const item = this.playbackQueue[this.currentQueueIndex];
    if (item) {
      if (this.settings.showNotices) {
        new Notice(`Playing ${this.currentQueueIndex + 1}/${this.playbackQueue.length}: ${item.title || 'Untitled'}`);
      }
      await this.startPlayback(item.text);
    }
  }

  /**
   * Clear the playback queue
   */
  clearQueue(): void {
    this.playbackQueue = [];
    this.currentQueueIndex = -1;
    this.isPlayingFromQueue = false;
    if (this.settings.showNotices) new Notice('Playback queue cleared.');
    this.notifyQueueChange();
    this.notifyQueueUIUpdate(); // Update queue UI when clearing
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): { queue: Array<{ text: string, title?: string }>, currentIndex: number, isPlayingFromQueue: boolean } {
    return {
      queue: [...this.playbackQueue],
      currentIndex: this.currentQueueIndex,
      isPlayingFromQueue: this.isPlayingFromQueue
    };
  }

  /**
   * Play a specific item in the queue by index
   */
  async playQueueItem(index: number): Promise<void> {
    if (index < 0 || index >= this.playbackQueue.length) {
      if (this.settings.showNotices) new Notice('Invalid queue item index.');
      return;
    }

    this.currentQueueIndex = index;
    this.isPlayingFromQueue = true;
    this.notifyQueueUIUpdate(); // Update queue UI to show new playing item
    await this.playCurrentQueueItem();
  }

  /**
   * Remove an item from the queue by index
   */
  removeQueueItem(index: number): void {
    if (index < 0 || index >= this.playbackQueue.length) {
      if (this.settings.showNotices) new Notice('Invalid queue item index.');
      return;
    }

    const removedItem = this.playbackQueue.splice(index, 1)[0];

    // Adjust current index if necessary
    if (this.isPlayingFromQueue) {
      if (index < this.currentQueueIndex) {
        this.currentQueueIndex--;
      } else if (index === this.currentQueueIndex) {
        // If we removed the currently playing item
        if (this.currentQueueIndex >= this.playbackQueue.length) {
          // We were at the end, stop playing from queue
          this.isPlayingFromQueue = false;
          this.currentQueueIndex = -1;
          this.stopPlayback();
        }
        // If there are still items after, the next item is now at the same index
      }
    }

    if (this.settings.showNotices) {
      new Notice(`Removed "${removedItem.title || 'Untitled'}" from queue.`);
    }
    this.notifyQueueChange();
    this.notifyQueueUIUpdate(); // Update queue UI when removing items
  }

  /**
   * Move an item in the queue from one position to another
   */
  moveQueueItem(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.playbackQueue.length ||
      toIndex < 0 || toIndex >= this.playbackQueue.length ||
      fromIndex === toIndex) {
      return;
    }

    const item = this.playbackQueue.splice(fromIndex, 1)[0];
    this.playbackQueue.splice(toIndex, 0, item);

    // Adjust current index if necessary
    if (this.isPlayingFromQueue) {
      if (fromIndex === this.currentQueueIndex) {
        // The currently playing item was moved
        this.currentQueueIndex = toIndex;
      } else if (fromIndex < this.currentQueueIndex && toIndex >= this.currentQueueIndex) {
        // Item moved from before current to after current
        this.currentQueueIndex--;
      } else if (fromIndex > this.currentQueueIndex && toIndex <= this.currentQueueIndex) {
        // Item moved from after current to before current
        this.currentQueueIndex++;
      }
    }

    if (this.settings.showNotices) {
      new Notice(`Moved "${item.title || 'Untitled'}" in queue.`);
    }
    this.notifyQueueChange();
    this.notifyQueueUIUpdate(); // Update queue UI when moving items
  }

  /**
   * Set sleep timer to automatically stop playback after specified minutes
   */
  setSleepTimer(minutes: number): void {
    this.cancelSleepTimer(); // Cancel any existing timer

    this.sleepTimerMinutes = minutes;
    this.sleepTimerTimeout = window.setTimeout(() => {
      if (this.settings.showNotices) new Notice('Sleep timer expired. Stopping playback.');
      this.stopPlayback();
      this.sleepTimerTimeout = null;
      this.sleepTimerMinutes = 0;
    }, minutes * 60 * 1000);

    if (this.settings.showNotices) {
      new Notice(`Sleep timer set for ${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }
  }

  /**
   * Cancel the sleep timer
   */
  cancelSleepTimer(): void {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
      if (this.sleepTimerMinutes > 0 && this.settings.showNotices) {
        new Notice('Sleep timer cancelled');
      }
      this.sleepTimerMinutes = 0;
    }
  }

  /**
   * Get sleep timer status
   */
  getSleepTimerStatus(): { isActive: boolean, remainingMinutes: number } {
    return {
      isActive: this.sleepTimerTimeout !== null,
      remainingMinutes: this.sleepTimerMinutes
    };
  }

  /**
   * Set loop enabled
   */
  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
  }

  /**
   * Get loop enabled
   */
  getLoopEnabled(): boolean {
    return this.loopEnabled;
  }
} 