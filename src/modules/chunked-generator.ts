import { UniversalTTSClient as EdgeTTSClient, OUTPUT_FORMAT, createProsodyOptions } from './tts-client-wrapper';

// Create a ProsodyOptions class that matches the old API
class ProsodyOptions {
  rate?: number;

  constructor() {
    // Initialize with defaults
  }
}
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
}

export class ChunkedGenerator {
  private static readonly MAX_CHUNK_BYTES = 4096; // 4096 bytes as enforced by TTS API
  private static readonly SAFETY_BUFFER = 100; // Safety buffer for encoding differences
  private static readonly EFFECTIVE_MAX_BYTES = ChunkedGenerator.MAX_CHUNK_BYTES - ChunkedGenerator.SAFETY_BUFFER;

  /**
   * Split text into manageable chunks (max 4096 bytes) while trying to preserve sentence boundaries
   */
  private static splitTextIntoChunks(text: string): string[] {
    const maxBytes = ChunkedGenerator.EFFECTIVE_MAX_BYTES;
    const chunks: string[] = [];
    let currentChunk = '';

    // Helper function to get byte size of a string
    const getByteSize = (str: string): number => new Blob([str]).size;

    // Split by paragraphs first to try to maintain logical breaks
    const paragraphs = text.split(/\n\s*\n/);

    for (const paragraph of paragraphs) {
      // If a single paragraph is too long, we need to split it further
      if (getByteSize(paragraph) > maxBytes) {
        // If we have content in currentChunk, save it first
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }

        // Split long paragraph by sentences
        const sentences = paragraph.split(/(?<=[.!?])\s+/);

        for (const sentence of sentences) {
          if (getByteSize(sentence) > maxBytes) {
            // If even a single sentence is too long, split by words
            const words = sentence.split(/\s+/);
            let wordChunk = '';

            for (const word of words) {
              const potentialChunk = wordChunk + (wordChunk ? ' ' : '') + word;
              if (getByteSize(potentialChunk) > maxBytes) {
                if (wordChunk.trim()) {
                  chunks.push(wordChunk.trim());
                }
                wordChunk = word;
              } else {
                wordChunk = potentialChunk;
              }
            }

            if (wordChunk.trim()) {
              currentChunk = wordChunk.trim();
            }
          } else {
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
            if (getByteSize(potentialChunk) > maxBytes) {
              if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
              }
              currentChunk = sentence;
            } else {
              currentChunk = potentialChunk;
            }
          }
        }
      } else {
        // Check if adding this paragraph would exceed the limit
        const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;

        if (getByteSize(potentialChunk) > maxBytes && currentChunk.trim()) {
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
   * Check if text needs to be chunked (exceeds 4096 bytes)
   */
  static needsChunking(text: string, settings?: EdgeTTSPluginSettings): boolean {
    // Clean the text first to get accurate byte size
    const cleanText = settings ?
      filterMarkdown(
        filterFrontmatter(text, settings.textFiltering.filterFrontmatter),
        settings.textFiltering,
        settings.symbolReplacement
      ) :
      filterMarkdown(filterFrontmatter(text));

    // Check byte size instead of character count
    const byteSize = new Blob([cleanText]).size;
    return byteSize > ChunkedGenerator.EFFECTIVE_MAX_BYTES;
  }

  /**
   * Generate MP3 in chunks (4096 bytes each)
   */
  static async generateChunkedMP3(options: ChunkedGenerationOptions): Promise<Buffer | null> {
    const { text, settings, progressManager, noteTitle = 'Note' } = options;

    try {
      // Check content limits and truncate if necessary
      const truncationResult = checkAndTruncateContent(text);

      if (truncationResult.wasTruncated) {
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

      const cleanText = filterMarkdown(
        filterFrontmatter(truncationResult.content, settings.textFiltering.filterFrontmatter),
        settings.textFiltering,
        settings.symbolReplacement
      );

      if (!cleanText.trim()) {
        throw new Error('No readable text after filtering');
      }

      const textChunks = ChunkedGenerator.splitTextIntoChunks(cleanText);

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
    const cleanText = settings ?
      filterMarkdown(
        filterFrontmatter(text, settings.textFiltering.filterFrontmatter),
        settings.textFiltering
      ) :
      filterMarkdown(filterFrontmatter(text));
    const byteSize = new Blob([cleanText]).size;
    return Math.ceil(byteSize / ChunkedGenerator.EFFECTIVE_MAX_BYTES);
  }

  /**
   * Get the maximum chunk size in bytes (always 4096 - safety buffer)
   */
  static getMaxChunkBytes(): number {
    return ChunkedGenerator.EFFECTIVE_MAX_BYTES;
  }
} 