import { Editor, FileSystemAdapter, getLanguage, MarkdownView, Notice, TFile, normalizePath, Platform } from 'obsidian';
import { toArrayBuffer } from '../utils';
import { EdgeTTSPluginSettings, defaultSelectedTextMp3Name } from './settings';

// Mobile-compatible path helpers (only import path/os on desktop)
let path: any = null;
let os: any = null;

if (!Platform.isMobile) {
  try {
    path = require('path');
    os = require('os');
  } catch (e) {
    console.warn('Node.js modules not available:', e);
  }
}

// Helper function to get directory name (compatible with mobile)
function getDirectoryName(filePath: string): string {
  if (path && path.dirname) {
    return path.dirname(filePath);
  }
  // Mobile fallback: simple string manipulation
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? '.' : filePath.substring(0, lastSlash);
}

// Helper function to get basename (compatible with mobile)
function getBaseName(filePath: string, extension?: string): string {
  if (path && path.basename) {
    return path.basename(filePath, extension);
  }
  // Mobile fallback: simple string manipulation
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  let basename = lastSlash === -1 ? filePath : filePath.substring(lastSlash + 1);

  if (extension && basename.endsWith(extension)) {
    basename = basename.substring(0, basename.length - extension.length);
  }

  return basename;
}

// Helper function to join paths (compatible with mobile)
function joinPaths(...paths: string[]): string {
  if (path && path.join) {
    return path.join(...paths);
  }
  // Mobile fallback: simple string joining with normalization
  return normalizePath(paths.join('/'));
}

/**
 * Handles file operations for the Edge TTS plugin
 */
export class FileOperationsManager {
  private app: any;
  private settings: EdgeTTSPluginSettings;
  private tempAudioPath: string | null = null;

  constructor(app: any, settings: EdgeTTSPluginSettings, tempAudioPath?: string) {
    this.app = app;
    this.settings = settings;
    if (tempAudioPath) {
      this.tempAudioPath = tempAudioPath;
    }
  }

  /**
   * Extract content from a file
   */
  async extractFileContent(filePath: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);

    // Ensure the file is a markdown file
    if (file instanceof TFile) {
      try {
        const content = await this.app.vault.read(file);
        return content;
      } catch (error) {
        console.error('Error reading file content:', error);
        return null;
      }
    } else {
      console.warn('The specified file is not a TFile (markdown file).');
      return null;
    }
  }

  /**
   * Embeds an MP3 file link in a note
   */
  async embedMP3InNote(relativePath: string, filePath?: string, editor?: Editor): Promise<void> {
    try {
      if (editor) {
        // Get the selected text and its position in the editor
        const selectedText = editor.getSelection();
        const cursorPosition = editor.getCursor('to');

        // Construct the embed link
        const embedLink = `\n\n![[${relativePath}]]\n`;

        // Insert the embed link after the selected text
        if (selectedText) {
          editor.replaceSelection(`${selectedText}${embedLink}`);
        } else {
          // If no selection, insert at the cursor position
          editor.replaceRange(embedLink, cursorPosition);
        }

        if (this.settings.showNotices) new Notice('MP3 embedded after the selected text.');
      } else {
        if (!filePath) {
          console.error('Error embedding MP3 in note due to filePath and editor not being passed to embedMP3InNote');
          if (this.settings.showNotices) new Notice('Failed to embed MP3 in note.');
          return;
        }

        // Fallback for non-editor scenarios
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
          if (this.settings.showNotices) new Notice(`File not found or is not a valid markdown file: ${filePath}`);
          return;
        }

        // Read the existing content of the note
        const content = await this.app.vault.read(file);

        // Construct the embed link
        const embedLink = `![[${relativePath}]]`;

        // Append the embed link to the content
        const updatedContent = `${content}\n\n${embedLink}`;

        // Write the updated content back to the note
        await this.app.vault.modify(file, updatedContent);

        if (this.settings.showNotices) new Notice('MP3 embedded in note.');
      }
    } catch (error) {
      console.error('Error embedding MP3 in note:', error);
      if (this.settings.showNotices) new Notice('Failed to embed MP3 in note.');
    }
  }

  /**
   * Saves an MP3 file to disk
   */
  async saveMP3File(buffer: Buffer | Uint8Array, filePath?: string): Promise<string | null> {
    try {
      // Convert Uint8Array to Buffer if needed for Node.js compatibility
      let finalBuffer: Buffer;
      if (buffer instanceof Uint8Array && !(buffer instanceof Buffer)) {
        // On desktop with Node.js, convert Uint8Array to Buffer
        if (typeof Buffer !== 'undefined' && Buffer.from) {
          finalBuffer = Buffer.from(buffer);
        } else {
          // Fallback for environments without Buffer
          throw new Error('Buffer not available and cannot convert Uint8Array');
        }
      } else {
        finalBuffer = buffer as Buffer;
      }

      // Ensure the output folder exists in the vault
      const fallbackFolderName = this.settings.replaceSpacesInFilenames
        ? 'Note_Narration_Audio'
        : 'Note Narration Audio';
      const folderPath = normalizePath(this.settings.outputFolder || fallbackFolderName);

      // Ensure the output folder exists
      if (!await this.app.vault.adapter.exists(folderPath)) {
        await this.app.vault.adapter.mkdir(folderPath);
      }

      const language = getLanguage();

      // Format the current date and time
      const now = new Date();
      const formattedDate = new Intl.DateTimeFormat(language, {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      let sanitizedDate = formattedDate.replace(/,/g, '').trim();

      // Sanitize date for all platforms - remove forbidden characters: \ / : * ? " < > |
      sanitizedDate = sanitizedDate.replace(/[\\/:*?"<>|]/g, '-');

      // Generate the file name
      let noteName = filePath
        ? getBaseName(filePath, '.md') || defaultSelectedTextMp3Name
        : defaultSelectedTextMp3Name;

      // Sanitize note name - remove forbidden characters
      noteName = noteName.replace(/[\\/:*?"<>|]/g, '-');

      if (this.settings.replaceSpacesInFilenames) {
        noteName = noteName.replace(/\s+/g, '_');
        sanitizedDate = sanitizedDate.replace(/\s+/g, '_');
      }

      const baseFileName = this.settings.replaceSpacesInFilenames
        ? `${noteName}_-_${sanitizedDate}.mp3`
        : `${noteName} - ${sanitizedDate}.mp3`;

      // Generate a unique filename by checking for conflicts and appending (1), (2), etc.
      const fileName = await this.generateUniqueFileName(folderPath, baseFileName);

      // Use forward slashes for Obsidian vault paths
      const relativeFilePath = normalizePath(`${folderPath}/${fileName}`);

      // Use Obsidian's vault.createBinary() instead of adapter.writeBinary()
      // This properly updates Obsidian's file cache and prevents ghost files
      await this.app.vault.createBinary(relativeFilePath, finalBuffer);

      // Get the absolute path for the success message
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        const basePath = adapter.getBasePath();
        const absoluteFilePath = joinPaths(basePath, folderPath, fileName);
        if (this.settings.showNotices) new Notice(`MP3 saved to: ${absoluteFilePath}`);
      } else {
        if (this.settings.showNotices) new Notice(`MP3 saved to: ${relativeFilePath}`);
      }

      return relativeFilePath;
    } catch (error) {
      console.error('Error saving MP3:', error);
      if (this.settings.showNotices) new Notice('Failed to save MP3 file.');
      return null;
    }
  }

  /**
   * Saves a buffer to the temporary audio file path.
   * Returns the absolute path if successful, null otherwise.
   */
  async saveTempAudioFile(buffer: Buffer | Uint8Array): Promise<string | null> {
    // On mobile, temp file saving is not supported
    if (Platform.isMobile) {
      console.log('Temporary file saving is not supported on mobile platforms.');
      return null;
    }

    if (!this.tempAudioPath) {
      console.error('Temporary audio path is not set in FileOperationsManager.');
      if (this.settings.showNotices) new Notice('Failed to save temporary audio: path not set.');
      return null;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      console.error('File system adapter not available for temp audio.');
      if (this.settings.showNotices) new Notice('Unable to save temporary audio file.');
      return null;
    }

    // Convert buffer to proper format for desktop
    let finalBuffer: Buffer;
    if (buffer instanceof Uint8Array && !(buffer instanceof Buffer)) {
      if (typeof Buffer !== 'undefined' && Buffer.from) {
        finalBuffer = Buffer.from(buffer);
      } else {
        console.error('Buffer not available for temp file creation');
        return null;
      }
    } else {
      finalBuffer = buffer as Buffer;
    }

    try {
      // Ensure the directory for the temp file exists (path includes filename)
      const tempDir = getDirectoryName(this.tempAudioPath);
      if (!await adapter.exists(tempDir)) {
        await adapter.mkdir(tempDir);
      }

      // Convert to a true ArrayBuffer for Obsidian's API
      const arrayBuffer: ArrayBuffer = toArrayBuffer(finalBuffer);
      await adapter.writeBinary(this.tempAudioPath, arrayBuffer);
      // console.log('Temporary audio saved to:', this.tempAudioPath);
      return this.app.vault.adapter.getResourcePath(this.tempAudioPath);
    } catch (error) {
      console.error('Error saving temporary audio file:', error);
      if (this.settings.showNotices) new Notice('Failed to save temporary audio file.');
      return null;
    }
  }

  /**
   * Gets the resource path for the temporary audio file.
   */
  getTempAudioFileResourcePath(): string | null {
    // Temp files not supported on mobile
    if (Platform.isMobile) {
      return null;
    }

    if (!this.tempAudioPath) return null;
    // Check if file exists before returning path, though getResourcePath might not require existence
    // For now, assume if tempAudioPath is set, we can try to get its resource path.
    return this.app.vault.adapter.getResourcePath(this.tempAudioPath);
  }

  /**
   * Cleans up the temporary audio file.
   */
  async cleanupTempAudioFile(): Promise<void> {
    // Temp files not supported on mobile
    if (Platform.isMobile) {
      return;
    }

    if (!this.tempAudioPath) return;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;

    try {
      if (await adapter.exists(this.tempAudioPath)) {
        await adapter.remove(this.tempAudioPath);
        // console.log('Temporary audio file cleaned up:', this.tempAudioPath);
      }
    } catch (error) {
      console.error('Error cleaning up temporary audio file:', error);
    }
  }

  /**
 * Generate a unique filename by checking for conflicts and appending (1), (2), etc.
 * Similar to how most operating systems handle duplicate filenames.
 */
  private async generateUniqueFileName(folderPath: string, baseFileName: string): Promise<string> {
    const normalizedFolderPath = normalizePath(folderPath);
    let fileName = baseFileName;
    let counter = 1;
    const maxAttempts = 100; // Safety limit

    // Keep checking if the file exists and increment counter until we find a unique name
    while (counter <= maxAttempts) {
      const fullPath = normalizePath(`${normalizedFolderPath}/${fileName}`);

      try {
        // Check if file exists in the vault
        const fileExists = await this.app.vault.adapter.exists(fullPath);

        if (!fileExists) {
          // File doesn't exist, we can use this filename
          return fileName;
        }

        // File exists, generate next variation
        const lastDotIndex = baseFileName.lastIndexOf('.');
        if (lastDotIndex === -1) {
          // No extension, just append counter
          fileName = `${baseFileName} (${counter})`;
        } else {
          // Has extension, insert counter before extension
          const nameWithoutExt = baseFileName.substring(0, lastDotIndex);
          const extension = baseFileName.substring(lastDotIndex);
          fileName = `${nameWithoutExt} (${counter})${extension}`;
        }

        counter++;
      } catch (error) {
        console.error('Error checking file existence:', error);
        // If we can't check, just return the current filename attempt
        return fileName;
      }
    }

    // If we've reached the maximum attempts, log a warning and return the last attempt
    console.warn('generateUniqueFileName: reached maximum attempts limit');
    return fileName;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: EdgeTTSPluginSettings): void {
    this.settings = settings;
  }
} 
