import { EdgeTTSPluginSettings } from './settings';
import { Notice } from 'obsidian';
import { EdgeTTSClient, OUTPUT_FORMAT, ProsodyOptions } from 'edge-tts-client';
import { filterFrontmatter, filterMarkdown } from '../utils';
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

  // MSE specific properties
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private completeMp3BufferArray: Uint8Array[] = [];
  private mseAudioQueue: Uint8Array[] = [];
  private isAppendingBuffer = false; // To manage sequential appends to SourceBuffer
  private isStreamingWithMSE = false;
  private isSwitchingToFullFile = false;
  private streamedPlaybackTimeBeforeSwitch = 0;

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
      if (this.settings.showNotices) new Notice('Finished reading aloud.');
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
    };

    // Listener for SourceBuffer updates
    // This needs to be added when sourceBuffer is created.
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
   * Start text-to-speech playback
   * @param selectedText Text to read aloud
   */
  async startPlayback(selectedText: string): Promise<void> {
    // 1. Stop any existing playback and clean up resources
    this.stopPlaybackInternal(); // This also resets MSE vars and currentPlaybackId
    this.currentPlaybackId++; // Create a new ID for this playback attempt
    const activePlaybackAttemptId = this.currentPlaybackId;

    this.isStreamingWithMSE = true;
    this.isPaused = false; // Reset isPaused for the new playback session
    this.completeMp3BufferArray = [];
    this.mseAudioQueue = [];
    this.isAppendingBuffer = false;

    // 2. Update UI to show loading state immediately
    if (!this.settings.disablePlaybackControlPopover) {
      this.showFloatingPlayerCallback({
        currentTime: 0,
        duration: Infinity, // Duration is unknown with MSE initially
        isPlaying: false,   // Will be true once playback starts
        isLoading: true,
      });
    }

    // 3. Validate and clean text
    if (!selectedText.trim()) {
      if (this.settings.showNotices) new Notice('No text selected or available.');
      if (!this.settings.disablePlaybackControlPopover) this.hideFloatingPlayerCallback();
      this.isStreamingWithMSE = false; // Reset flag
      return;
    }
    const cleanText = filterMarkdown(filterFrontmatter(selectedText), this.settings.overrideAmpersandEscape);
    if (!cleanText.trim()) {
      if (this.settings.showNotices) new Notice('No readable text after filtering.');
      if (!this.settings.disablePlaybackControlPopover) this.hideFloatingPlayerCallback();
      this.isStreamingWithMSE = false; // Reset flag
      return;
    }

    // 4. Initialize MediaSource
    this.mediaSource = new MediaSource();
    this.audioElement.src = URL.createObjectURL(this.mediaSource);
    // audioElement.load() is implicitly called when src is set

    this.mediaSource.addEventListener('sourceopen', () => {
      if (this.currentPlaybackId !== activePlaybackAttemptId || !this.mediaSource) return;
      URL.revokeObjectURL(this.audioElement.src); // Revoke old blob URL if any, though new one was just set

      try {
        // TODO: Check MediaSource.isTypeSupported('audio/mpeg') before creating
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
      // console.log("MediaSource ended event fired.");
      // This means endOfStream() was called and all bufferring is complete from MSE perspective
      // The audio might still be playing the buffered content.
    });
    this.mediaSource.addEventListener('sourceclose', () => {
      // console.log("MediaSource closed event fired.");
      // Occurs when the media element is no longer using the media source
      this.isStreamingWithMSE = false; // MSE session is truly over
    });

    // 5. Fetch and process TTS stream
    try {
      if (this.settings.showNotices && this.isStreamingWithMSE) {
        // Notice is slightly different for streaming, implying it will start soon
        new Notice('Starting audio stream...');
      }
      this.updateStatusBarCallback(true);

      const tts = new EdgeTTSClient();
      const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;
      // Using a format suitable for MSE, like AUDIO_24KHZ_48KBITRATE_MONO_MP3
      await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const prosodyOptions = new ProsodyOptions();
      prosodyOptions.rate = this.settings.playbackSpeed;

      const readable = tts.toStream(cleanText, prosodyOptions);

      readable.on('data', (data: Uint8Array) => {
        if (this.currentPlaybackId !== activePlaybackAttemptId) {
          // readable.destroy(); // TODO: Check edge-tts-client for proper stream abortion method
          return;
        }
        this.completeMp3BufferArray.push(data);
        this.mseAudioQueue.push(data);
        this.appendNextChunkToSourceBuffer();
      });

      readable.on('end', async () => {
        if (this.currentPlaybackId !== activePlaybackAttemptId) return;

        // Ensure all MSE chunks are processed before ending the stream
        const waitForMseQueue = async () => {
          while (this.mseAudioQueue.length > 0 || this.isAppendingBuffer) {
            // console.log(`Waiting for MSE queue: ${this.mseAudioQueue.length}, appending: ${this.isAppendingBuffer}`);
            await new Promise(resolve => setTimeout(resolve, 50)); // Wait a bit
          }
        };
        await waitForMseQueue();

        if (this.mediaSource && this.mediaSource.readyState === 'open' && this.sourceBuffer) {
          try {
            if (!this.sourceBuffer.updating) { // Only call if not already updating
              this.mediaSource.endOfStream();
            } else {
              // If it's updating, wait for updateend to call endOfStream
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

        // Now, process the complete MP3 buffer
        if (this.completeMp3BufferArray.length === 0) {
          if (this.settings.showNotices) new Notice('TTS stream was empty.');
          // No actual audio data, isLoading should be false, player should be hidden or in a final state

          // <<ARTIFICIAL DELAY FOR TESTING LOADER>>
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay

          if (!this.settings.disablePlaybackControlPopover) {
            this.updateFloatingPlayerCallback({ currentTime: 0, duration: 0, isPlaying: false, isLoading: false });
            this.hideFloatingPlayerCallback();
          }
          this.updateStatusBarCallback(false);
          this.isStreamingWithMSE = false;
          return;
        }

        const completeBuffer = Buffer.concat(this.completeMp3BufferArray);
        const tempFilePath = await this.fileManager.saveTempAudioFile(completeBuffer);

        if (this.currentPlaybackId !== activePlaybackAttemptId) {
          this.isStreamingWithMSE = false;
          return;
        }

        if (tempFilePath) {
          console.log('Full MP3 saved to:', tempFilePath);
          // --- DEFERRED: SEAMLESS SWITCH LOGIC ---
          // For now, MSE stream will play out. The full file is available for future replays.
          // If we were to implement seamless switch here:
          // 1. this.streamedPlaybackTimeBeforeSwitch = this.audioElement.currentTime;
          // 2. this.isSwitchingToFullFile = true;
          // 3. this.audioElement.src = tempFilePath; // This will trigger onloadedmetadata
          // 4. this.audioElement.load();
          // The onloadedmetadata listener has logic to handle this.isSwitchingToFullFile

          // For now, we just note that the full file is ready.
          // The MSE stream continues until it naturally ends.
          // If enableReplayOption is true, the player stays open at the end of MSE stream.
          // A subsequent "replay" could then use this tempFilePath.

          // <<ARTIFICIAL DELAY FOR TESTING LOADER>>
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay

        } else {
          if (this.settings.showNotices) new Notice('Failed to save temporary audio for playback.');
          // Update UI to reflect that loading is done, but no full file is available for robust replay

          // <<ARTIFICIAL DELAY FOR TESTING LOADER>>
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay

          if (!this.settings.disablePlaybackControlPopover) {
            this.updateFloatingPlayerCallback({
              currentTime: this.audioElement.currentTime,
              duration: this.audioElement.duration, // Or Infinity if MSE hasn't updated it
              isPlaying: !this.audioElement.paused,
              isLoading: false
            });
          }
        }
        // isStreamingWithMSE remains true until sourceclose or explicit stop.
      });

      // readable.on('error', (err) => {
      //   if (this.currentPlaybackId !== activePlaybackAttemptId) return;
      //   console.error('TTS stream error:', err);
      //   if (this.settings.showNotices) new Notice('Failed to stream TTS audio.');
      //   this.stopPlaybackInternal(); // Full stop on stream error
      // });

    } catch (error) {
      console.error('Error reading note aloud (outer try-catch):', error);
      if (this.currentPlaybackId === activePlaybackAttemptId) {
        if (this.settings.showNotices) new Notice('Failed to read note aloud.');
        this.stopPlaybackInternal(); // Full stop
      }
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
} 