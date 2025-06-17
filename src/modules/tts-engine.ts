import { UniversalTTSClient as EdgeTTSClient, OUTPUT_FORMAT, createProsodyOptions } from './tts-client-wrapper';

// Create a ProsodyOptions class that matches the old API
class ProsodyOptions {
  rate?: number;

  constructor() {
    // Initialize with defaults
  }
}
import { Notice, Platform } from 'obsidian';
import { EdgeTTSPluginSettings } from './settings';
import { filterFrontmatter, filterMarkdown, checkAndTruncateContent } from '../utils';

/**
 * Status of a TTS generation task
 */
export enum TTSTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * A TTS generation task
 */
export interface TTSTask {
  id: string;
  text: string;
  status: TTSTaskStatus;
  progress: number;  // 0-100
  buffer?: Buffer | Uint8Array;   // Result buffer when complete (handle both Node.js Buffer and mobile Uint8Array)
  error?: string;    // Error message if failed
  createdAt: Date;
  completedAt?: Date;
  outputFormat: string;
  voice: string;
  playbackSpeed: number;
}

/**
 * Manages text-to-speech generation with background processing capabilities
 */
export class TTSEngine {
  private settings: EdgeTTSPluginSettings;
  private tasks: Map<string, TTSTask> = new Map();
  private processingQueue: string[] = [];
  private isProcessing = false;

  constructor(settings: EdgeTTSPluginSettings) {
    this.settings = settings;
  }

  /**
   * Create a new TTS task and add it to the queue
   */
  createTask(text: string, outputFormat: string): TTSTask {
    // Check if we're on mobile - MP3 generation may not work properly
    if (Platform.isMobile) {
      throw new Error('MP3 generation is not supported on mobile devices due to file system limitations. Use audio playback instead.');
    }

    // Check content limits and truncate if necessary
    const truncationResult = checkAndTruncateContent(text);

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

    // Clean the (potentially truncated) text for TTS processing
    const cleanText = filterMarkdown(filterFrontmatter(truncationResult.content), this.settings.overrideAmpersandEscape);

    if (!cleanText.trim()) {
      throw new Error('No readable text after filtering');
    }

    const taskId = `tts-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;

    const task: TTSTask = {
      id: taskId,
      text: cleanText,
      status: TTSTaskStatus.PENDING,
      progress: 0,
      createdAt: new Date(),
      outputFormat,
      voice: voiceToUse,
      playbackSpeed: this.settings.playbackSpeed
    };

    this.tasks.set(taskId, task);
    this.processingQueue.push(taskId);

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processNextTask();
    }

    return task;
  }

  /**
   * Process tasks in the queue
   */
  private async processNextTask(): Promise<void> {
    if (this.processingQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const taskId = this.processingQueue.shift()!;
    const task = this.tasks.get(taskId);

    if (!task) {
      // Task was removed, process next
      setTimeout(() => this.processNextTask(), 0);
      return;
    }

    // Update task status
    task.status = TTSTaskStatus.PROCESSING;
    this.tasks.set(taskId, task);

    try {
      const tts = new EdgeTTSClient();
      await tts.setMetadata(task.voice, task.outputFormat);

      const prosodyOptions = new ProsodyOptions();
      prosodyOptions.rate = task.playbackSpeed;

      const readable = tts.toStream(task.text, prosodyOptions);
      const audioBuffer: Uint8Array[] = [];

      // Estimated total size for progress calculation (rough estimate)
      const estimatedSize = task.text.length * 50; // 50 bytes per character is a rough estimate
      let receivedSize = 0;

      readable.on('data', (data: Uint8Array) => {
        audioBuffer.push(data);
        receivedSize += data.length;

        // Update progress (cap at 99% until fully complete)
        task.progress = Math.min(99, Math.floor((receivedSize / estimatedSize) * 100));
        this.tasks.set(taskId, task);
      });

      // Use Promise to await stream completion
      await new Promise<void>((resolve, reject) => {
        readable.on('end', () => {
          // Handle Buffer creation for different environments
          let completeBuffer: Buffer | Uint8Array;

          if (Platform.isMobile || typeof Buffer === 'undefined') {
            // Mobile environment - use Uint8Array concatenation
            const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
            completeBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const arr of audioBuffer) {
              (completeBuffer as Uint8Array).set(arr, offset);
              offset += arr.length;
            }
          } else {
            // Desktop environment - use Node.js Buffer
            completeBuffer = Buffer.concat(audioBuffer);
          }

          task.buffer = completeBuffer;
          task.status = TTSTaskStatus.COMPLETED;
          task.progress = 100;
          task.completedAt = new Date();
          this.tasks.set(taskId, task);
          resolve();
        });

        // Handle errors with try-catch instead of event listener
        // Set a timeout to check if the stream has completed
        const errorTimeout = setTimeout(() => {
          if (task.status !== TTSTaskStatus.COMPLETED) {
            task.status = TTSTaskStatus.FAILED;
            task.error = 'Timed out waiting for TTS stream to complete';
            this.tasks.set(taskId, task);
            reject(new Error('TTS processing timeout'));
          }
        }, 60000); // 1 minute timeout

        // Clear timeout when complete
        readable.on('end', () => {
          clearTimeout(errorTimeout);
        });
      });
    } catch (error: any) {
      task.status = TTSTaskStatus.FAILED;
      task.error = error.message || 'Unknown error';
      this.tasks.set(taskId, task);
      console.error('TTS generation error:', error);
    }

    // Process next task with a small delay to prevent UI blocking
    setTimeout(() => this.processNextTask(), 10);
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): TTSTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TTSTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Clean up completed tasks older than the specified age
   */
  cleanupOldTasks(maxAgeMs = 3600000): void { // Default 1 hour
    const now = new Date().getTime();
    for (const [id, task] of this.tasks.entries()) {
      if (
        (task.status === TTSTaskStatus.COMPLETED || task.status === TTSTaskStatus.FAILED) &&
        (now - task.createdAt.getTime() > maxAgeMs)
      ) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * Generate audio for playback (not stored as a task)
   * For compatibility with direct playback
   */
  async generateAudioBuffer(text: string): Promise<AudioBuffer | null> {
    try {
      // Check content limits and truncate if necessary
      const truncationResult = checkAndTruncateContent(text);

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

      // Create a task but don't store it in the regular task list
      const cleanText = filterMarkdown(filterFrontmatter(truncationResult.content), this.settings.overrideAmpersandEscape);

      if (!cleanText.trim()) {
        throw new Error('No readable text after filtering');
      }

      const voiceToUse = this.settings.customVoice.trim() || this.settings.selectedVoice;

      const tts = new EdgeTTSClient();
      await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);

      const prosodyOptions = new ProsodyOptions();
      prosodyOptions.rate = this.settings.playbackSpeed;

      const readable = tts.toStream(cleanText, prosodyOptions);
      const audioBuffer: Uint8Array[] = [];

      // Collect audio data
      return new Promise<AudioBuffer>((resolve, reject) => {
        readable.on('data', (data: Uint8Array) => {
          audioBuffer.push(data);
        });

        readable.on('end', async () => {
          // Handle buffer concatenation for different environments
          let completeBufferArrayBuffer: ArrayBuffer;

          if (Platform.isMobile || typeof Buffer === 'undefined') {
            // Mobile environment - manual concatenation
            const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
            const concatenated = new Uint8Array(totalLength);
            let offset = 0;
            for (const arr of audioBuffer) {
              concatenated.set(arr, offset);
              offset += arr.length;
            }
            completeBufferArrayBuffer = concatenated.buffer;
          } else {
            // Desktop environment - use Buffer.concat
            const nodeBuffer = Buffer.concat(audioBuffer);
            completeBufferArrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
          }

          try {
            // Create AudioContext for decoding
            const audioContext = new AudioContext();
            const audioBufferDecoded = await audioContext.decodeAudioData(completeBufferArrayBuffer);
            resolve(audioBufferDecoded);
          } catch (error) {
            reject(error);
          }
        });

        // Handle errors with timeout instead of event listener
        const errorTimeout = setTimeout(() => {
          reject(new Error('TTS processing timeout'));
        }, 30000); // 30 second timeout

        // Clear timeout when complete
        readable.on('end', () => {
          clearTimeout(errorTimeout);
        });
      });
    } catch (error) {
      console.error('Error generating audio buffer:', error);
      return null;
    }
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EdgeTTSPluginSettings): void {
    this.settings = settings;
  }
} 