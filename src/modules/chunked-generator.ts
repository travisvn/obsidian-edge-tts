import { EdgeTTSClient, OUTPUT_FORMAT, ProsodyOptions } from 'edge-tts-client';
import { EdgeTTSPluginSettings } from './settings';
import { filterFrontmatter, filterMarkdown, checkAndTruncateContent } from '../utils';
import { ChunkStatus } from '../ui/ChunkedProgressUI';
import type { ChunkedProgressManager } from './ChunkedProgressManager';
import { MP3_GENERATION_LIMITS } from './constants';

interface ChunkInfo {
  id: string;
  text: string;
  status: ChunkStatus;
  progress: number;
  buffer?: Buffer;
  error?: string;
}

export interface ChunkedGenerationOptions {
  text: string;
  settings: EdgeTTSPluginSettings;
  progressManager: ChunkedProgressManager;
  noteTitle?: string;
  maxChunkLength?: number; // Maximum characters per chunk
}

export class ChunkedGenerator {
  private static readonly DEFAULT_MAX_CHUNK_LENGTH = 9000; // 9000 characters as mentioned
  private static readonly MAX_WORD_LENGTH = 1500; // 1500 words as mentioned (rough estimate: 6 chars per word average)

  /**
   * Split text into manageable chunks while trying to preserve sentence boundaries
   */
  private static splitTextIntoChunks(text: string, maxLength: number = ChunkedGenerator.DEFAULT_MAX_CHUNK_LENGTH): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    // Split by paragraphs first to try to maintain logical breaks
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      // If a single paragraph is too long, we need to split it further
      if (paragraph.length > maxLength) {
        // If we have content in currentChunk, save it first
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // Split long paragraph by sentences
        const sentences = paragraph.split(/(?<=[.!?])\s+/);

        for (const sentence of sentences) {
          if (sentence.length > maxLength) {
            // If even a single sentence is too long, split by words
            const words = sentence.split(/\s+/);
            let wordChunk = '';

            for (const word of words) {
              if ((wordChunk + ' ' + word).length > maxLength) {
                if (wordChunk.trim()) {
                  chunks.push(wordChunk.trim());
                }
                wordChunk = word;
              } else {
                wordChunk += (wordChunk ? ' ' : '') + word;
              }
            }

            if (wordChunk.trim()) {
              currentChunk = wordChunk.trim();
            }
          } else {
            if ((currentChunk + '\n\n' + sentence).length > maxLength) {
              if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
              }
              currentChunk = sentence;
            } else {
              currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
          }
        }
      } else {
        // Check if adding this paragraph would exceed the limit
        const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;

        if (potentialChunk.length > maxLength && currentChunk.trim()) {
          // Save current chunk and start a new one
          chunks.push(currentChunk.trim());
          currentChunk = paragraph;
        } else {
          currentChunk = potentialChunk;
        }
      }
    }

    // Add the last chunk if it has content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.trim().length > 0);
  }

  /**
   * Check if text needs to be chunked
   */
  static needsChunking(text: string, settings?: EdgeTTSPluginSettings): boolean {
    // Clean the text first to get accurate length
    const cleanText = filterMarkdown(filterFrontmatter(text), false);

    const maxLength = settings?.chunkSize || ChunkedGenerator.DEFAULT_MAX_CHUNK_LENGTH;

    // Check both character count and estimated word count
    const charCount = cleanText.length;
    const wordCount = cleanText.split(/\s+/).length;

    return charCount > maxLength || wordCount > ChunkedGenerator.MAX_WORD_LENGTH;
  }

  /**
   * Generate MP3 in chunks
   */
  static async generateChunkedMP3(options: ChunkedGenerationOptions): Promise<Buffer | null> {
    const { text, settings, progressManager, noteTitle = 'Note', maxChunkLength = ChunkedGenerator.DEFAULT_MAX_CHUNK_LENGTH } = options;

    try {
      // Check content limits and truncate if necessary
      const truncationResult = checkAndTruncateContent(text);

      if (truncationResult.wasTruncated) {
        const limitType = truncationResult.truncationReason === 'words' ? 'word' : 'character';
        const limitValue = truncationResult.truncationReason === 'words' ? '5,000 words' : '30,000 characters';

        // Show truncation notice in progress manager
        progressManager.updateState({
          currentPhase: 'splitting',
          noteTitle,
          overallProgress: 0,
          errorMessage: `Content truncated: exceeded ${limitValue} limit. Processing first ${truncationResult.finalWordCount.toLocaleString()} words.`
        });

        // Also show a regular notice if enabled
        if (settings.showNotices) {
          // We can access Notice through the global window object or import it
          // For now, let's use console.warn and rely on the progress manager message
          console.warn(
            `Content exceeds MP3 generation limit (${limitValue}). ` +
            `Generating MP3 for the first ${truncationResult.finalWordCount.toLocaleString()} words. ` +
            `Original content had ${truncationResult.originalWordCount.toLocaleString()} words.`
          );
        }

        // Wait a moment to show the truncation message
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Phase 1: Splitting (clear any error message from truncation notice)
      progressManager.updateState({
        currentPhase: 'splitting',
        noteTitle,
        overallProgress: 0,
        errorMessage: undefined // Clear any truncation message
      });

      const cleanText = filterMarkdown(filterFrontmatter(truncationResult.content), settings.overrideAmpersandEscape);

      if (!cleanText.trim()) {
        throw new Error('No readable text after filtering');
      }

      const textChunks = ChunkedGenerator.splitTextIntoChunks(cleanText, maxChunkLength);

      if (textChunks.length === 0) {
        throw new Error('No valid chunks created from text');
      }

      // Create chunk info objects
      const chunks: ChunkInfo[] = textChunks.map((chunkText, index) => ({
        id: `chunk-${index}`,
        text: chunkText,
        status: ChunkStatus.PENDING,
        progress: 0
      }));

      progressManager.updateState({
        currentPhase: 'generating',
        totalChunks: chunks.length,
        chunks: chunks
      });

      // Phase 2: Generate audio for each chunk
      const voiceToUse = settings.customVoice.trim() || settings.selectedVoice;
      const outputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

      const prosodyOptions = new ProsodyOptions();
      prosodyOptions.rate = settings.playbackSpeed;

      const audioBuffers: Buffer[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
          // Update chunk status to processing
          progressManager.updateChunk(chunk.id, {
            status: ChunkStatus.PROCESSING,
            progress: 0
          });

          // Trigger progress recalculation
          progressManager.updateState({});

          const tts = new EdgeTTSClient();
          await tts.setMetadata(voiceToUse, outputFormat);

          const readable = tts.toStream(chunk.text, prosodyOptions);
          const chunkBuffers: Uint8Array[] = [];

          // Track progress for this chunk
          const estimatedSize = chunk.text.length * 50; // Rough estimate
          let receivedSize = 0;

          readable.on('data', (data: Uint8Array) => {
            chunkBuffers.push(data);
            receivedSize += data.length;

            // Update chunk progress (cap at 99% until complete)
            const chunkProgress = Math.min(99, Math.floor((receivedSize / estimatedSize) * 100));
            progressManager.updateChunk(chunk.id, { progress: chunkProgress });

            // Trigger progress recalculation every 10% increment to avoid too many updates
            if (chunkProgress % 10 === 0) {
              progressManager.updateState({});
            }
          });

          // Wait for chunk completion
          const chunkBuffer = await new Promise<Buffer>((resolve, reject) => {
            readable.on('end', () => {
              const completeBuffer = Buffer.concat(chunkBuffers);
              resolve(completeBuffer);
            });

            // Add error handling for the stream
            const onError = (error: any) => {
              console.error(`Stream error for chunk ${i + 1}:`, error);
              reject(error);
            };

            // "error" does not exist as a valid event, given the edge-tts package
            //    Keeping this code below in case that changes in the future.
            // Try to attach error listener
            try {
              (readable as any).on('error', onError);
            } catch (e) {
              // If error listener can't be attached, that's okay
              // console.warn('Could not attach error listener to TTS stream');
            }

            // Timeout after 2 minutes for a single chunk
            setTimeout(() => {
              reject(new Error(`Timeout generating chunk ${i + 1}`));
            }, 120000);
          });

          // Mark chunk as completed
          progressManager.updateChunk(chunk.id, {
            status: ChunkStatus.COMPLETED,
            progress: 100
          });

          // Force a state update to trigger progress recalculation
          progressManager.updateState({});

          audioBuffers.push(chunkBuffer);

        } catch (error) {
          console.error(`Error generating chunk ${i + 1}:`, error);
          progressManager.updateChunk(chunk.id, {
            status: ChunkStatus.FAILED,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          // Continue with other chunks instead of failing completely
          // We'll skip this chunk in the final combination
        }

        // Add a small delay between chunks to avoid overwhelming the service
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }
      }

      // Check if we have any successful chunks
      if (audioBuffers.length === 0) {
        throw new Error('Failed to generate any audio chunks');
      }

      // Phase 3: Combine audio buffers
      progressManager.updateState({
        currentPhase: 'combining'
      });

      // Simple concatenation of MP3 buffers (this works for MP3 format)
      const combinedBuffer = Buffer.concat(audioBuffers);

      // Phase 4: Completed
      progressManager.updateState({
        currentPhase: 'completed'
      });

      return combinedBuffer;

    } catch (error) {
      console.error('Chunked MP3 generation error:', error);
      progressManager.updateState({
        currentPhase: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error occurred'
      });
      return null;
    }
  }

  /**
   * Estimate the number of chunks that would be created
   */
  static estimateChunkCount(text: string, settings?: EdgeTTSPluginSettings): number {
    const cleanText = filterMarkdown(filterFrontmatter(text), false);
    const maxLength = settings?.chunkSize || ChunkedGenerator.DEFAULT_MAX_CHUNK_LENGTH;
    return Math.ceil(cleanText.length / maxLength);
  }

  /**
   * Get recommended chunk size based on text characteristics
   */
  static getRecommendedChunkSize(text: string, settings?: EdgeTTSPluginSettings): number {
    const userChunkSize = settings?.chunkSize || ChunkedGenerator.DEFAULT_MAX_CHUNK_LENGTH;
    const cleanText = filterMarkdown(filterFrontmatter(text), false);

    // For very long texts, use smaller chunks to prevent memory issues
    if (cleanText.length > 50000) {
      return Math.min(userChunkSize, 7000);
    } else if (cleanText.length > 20000) {
      return Math.min(userChunkSize, 8000);
    } else {
      return userChunkSize;
    }
  }
} 