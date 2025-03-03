import { EdgeTTSPluginSettings } from './settings';
import { Notice } from 'obsidian';
import { EdgeTTSClient, OUTPUT_FORMAT, ProsodyOptions } from 'edge-tts-client';
import { filterFrontmatter, filterMarkdown } from '../utils';

/**
 * Handles all audio playback functionality for the Edge TTS plugin
 */
export class AudioPlaybackManager {
  private audioContext: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private isPaused = false;
  private pausedAt = 0;
  private updateStatusBarCallback: (withControls: boolean) => void;
  private settings: EdgeTTSPluginSettings;

  constructor(
    settings: EdgeTTSPluginSettings,
    updateStatusBarCallback: (withControls: boolean) => void
  ) {
    this.settings = settings;
    this.updateStatusBarCallback = updateStatusBarCallback;
  }

  /**
   * Start text-to-speech playback
   * @param selectedText Text to read aloud
   */
  async startPlayback(selectedText: string): Promise<void> {
    if (this.audioContext || this.audioSource) {
      // Stop any ongoing narration before starting a new one
      this.stopPlayback();
    }

    if (!selectedText.trim()) {
      if (this.settings.showNotices) new Notice('No text selected or available.');
      return;
    }

    const cleanText = filterMarkdown(filterFrontmatter(selectedText), this.settings.overrideAmpersandEscape);

    if (!cleanText.trim()) {
      if (this.settings.showNotices) new Notice('No readable text after filtering.');
      return;
    }

    try {
      if (this.settings.showNotices) new Notice('Processing text-to-speech...');
      this.updateStatusBarCallback(true);

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
          this.updateStatusBarCallback(false);
          if (this.settings.showNotices) new Notice('Finished reading aloud.');
        };
      });
    } catch (error) {
      console.error('Error reading note aloud:', error);
      this.updateStatusBarCallback(false);
      if (this.settings.showNotices) new Notice('Failed to read note aloud.');
    }
  }

  /**
   * Pause current playback 
   */
  pausePlayback(): void {
    if (this.audioContext && this.audioSource) {
      this.isPaused = true;
      this.pausedAt = this.audioContext.currentTime;
      this.audioContext.suspend();
      this.updateStatusBarCallback(true);
    }
  }

  /**
   * Resume paused playback
   */
  resumePlayback(): void {
    if (this.audioContext) {
      this.isPaused = false;
      this.audioContext.resume();
      this.updateStatusBarCallback(true);
    }
  }

  /**
   * Stop playback completely
   */
  stopPlayback(): void {
    if (this.audioSource) {
      this.audioSource.stop();
      this.cleanupAudioContext();
      this.updateStatusBarCallback(false);
    }
  }

  /**
   * Clean up audio resources
   */
  cleanupAudioContext(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.audioSource = null;
    this.isPaused = false;
    this.pausedAt = 0;
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
    return this.audioContext !== null && this.audioSource !== null;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EdgeTTSPluginSettings): void {
    this.settings = settings;
  }
} 