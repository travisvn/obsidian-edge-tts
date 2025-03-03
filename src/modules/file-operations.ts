import { Editor, FileSystemAdapter, getLanguage, MarkdownView, Notice, TFile } from 'obsidian';
import { EdgeTTSPluginSettings, defaultSelectedTextMp3Name } from './settings';
import * as path from 'path';
import * as os from 'os';

/**
 * Handles file operations for the Edge TTS plugin
 */
export class FileOperationsManager {
  private app: any;
  private settings: EdgeTTSPluginSettings;

  constructor(app: any, settings: EdgeTTSPluginSettings) {
    this.app = app;
    this.settings = settings;
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
  async saveMP3File(buffer: Buffer, filePath?: string): Promise<string | null> {
    const adapter = this.app.vault.adapter;

    if (!(adapter instanceof FileSystemAdapter)) {
      console.error('File system adapter not available.');
      if (this.settings.showNotices) new Notice('Unable to save MP3 file.');
      return null;
    }

    const basePath = adapter.getBasePath();
    const fallbackFolderName = this.settings.replaceSpacesInFilenames
      ? 'Note_Narration_Audio'
      : 'Note Narration Audio';
    const folderPath = this.settings.outputFolder || fallbackFolderName;

    const relativeFolderPath = folderPath; // Path relative to vault root
    const absoluteFolderPath = path.join(basePath, relativeFolderPath); // Platform-agnostic path

    try {
      // Ensure the relative output folder exists
      if (!await adapter.exists(relativeFolderPath)) {
        await adapter.mkdir(relativeFolderPath);
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

      // Check for Windows and adjust the date format to remove colons
      if (os.platform() === 'win32') {
        sanitizedDate = sanitizedDate.replace(/:/g, '-');
      }

      // Generate the file name
      let noteName = filePath
        ? path.basename(filePath, '.md') || defaultSelectedTextMp3Name
        : defaultSelectedTextMp3Name;

      if (this.settings.replaceSpacesInFilenames) {
        noteName = noteName.replace(/\s+/g, '_');
        sanitizedDate = sanitizedDate.replace(/\s+/g, '_');
      }

      const fileName = this.settings.replaceSpacesInFilenames
        ? `${noteName}_-_${sanitizedDate}.mp3`
        : `${noteName} - ${sanitizedDate}.mp3`;
      const relativeFilePath = path.join(relativeFolderPath, fileName);
      const absoluteFilePath = path.join(absoluteFolderPath, fileName);

      // Explicitly create an empty file before writing
      await adapter.write(relativeFilePath, '');

      // Write the MP3 file
      await adapter.writeBinary(relativeFilePath, buffer);

      if (this.settings.showNotices) new Notice(`MP3 saved to: ${absoluteFilePath}`);

      return relativeFilePath;
    } catch (error) {
      console.error('Error saving MP3:', error);
      if (this.settings.showNotices) new Notice('Failed to save MP3 file.');
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