/* eslint-disable @typescript-eslint/no-inferrable-types */
/* eslint-disable no-useless-escape */

import { MP3_GENERATION_LIMITS } from './modules/constants';
import { Platform, getLanguage } from 'obsidian';
import type { EdgeTTSPluginSettings } from './modules/settings';
import { COMPARISON_SYMBOL_TRANSLATIONS } from './lib/translations';

/**
 * Detect user's language, preferring Obsidian's language setting over browser locale
 */
export function detectUserLanguage(): string {
  try {
    // First try to get Obsidian's interface language
    const obsidianLanguage = getLanguage();
    if (obsidianLanguage) {
      // Obsidian returns language codes like 'en', 'es', 'fr', etc.
      const languageCode = obsidianLanguage.toLowerCase();

      // Return language code if we have translations for it
      if (Object.keys(COMPARISON_SYMBOL_TRANSLATIONS).includes(languageCode)) {
        return languageCode;
      }
    }
  } catch (error) {
    // If getLanguage() fails, fall back to browser locale detection
    console.warn('Failed to get Obsidian language, falling back to browser locale:', error);
  }

  // Fallback to browser locale if Obsidian language is not available or supported
  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en';
    const languageCode = locale.split('-')[0].toLowerCase();

    // Return language code if we have translations for it, otherwise default to English
    return Object.keys(COMPARISON_SYMBOL_TRANSLATIONS).includes(languageCode) ? languageCode : 'en';
  } catch (error) {
    // Final fallback to English
    console.warn('Failed to detect any language, defaulting to English:', error);
    return 'en';
  }
}

/**
 * Get comparison symbol translations for a specific language
 */
export function getComparisonTranslations(settings: EdgeTTSPluginSettings): {
  greaterThan: string;
  lessThan: string;
  greaterThanOrEqual: string;
  lessThanOrEqual: string;
} {
  // If no symbolReplacement settings, use default English
  if (!settings.symbolReplacement) {
    return COMPARISON_SYMBOL_TRANSLATIONS.en;
  }

  if (settings.symbolReplacement.enableCustomReplacements) {
    return settings.symbolReplacement.customReplacements;
  }

  let language = settings.symbolReplacement.language;
  if (language === 'auto') {
    language = detectUserLanguage();
  }

  return COMPARISON_SYMBOL_TRANSLATIONS[language as keyof typeof COMPARISON_SYMBOL_TRANSLATIONS] || COMPARISON_SYMBOL_TRANSLATIONS.en;
}

/**
 * Filters out the frontmatter from a Markdown text.
 * Frontmatter is defined as a block of YAML enclosed by `---` or `...` at the start of the file.
 * @param text - The Markdown text from which to remove frontmatter.
 * @param shouldFilter - Whether to actually filter frontmatter (default: true)
 * @returns The text without the frontmatter block.
 */
export function filterFrontmatter(text: string, shouldFilter: boolean = true): string {
  if (!shouldFilter) {
    return text;
  }

  // Define the regular expression for frontmatter blocks
  const frontmatterRegex = /^(---|\.\.\.)([\s\S]*?)\1\n?/;

  // Remove frontmatter if it exists
  return text.replace(frontmatterRegex, '').trim();
}

export function replaceComparisonSymbols(text: string, settings?: EdgeTTSPluginSettings): string {
  // If no settings provided or comparison replacement is disabled, use Unicode symbols
  if (!settings || !settings.textFiltering.replaceComparisonSymbols) {
    return text
      .replace(/>=/g, '≥') // Replace ">=" with "≥"
      .replace(/<=/g, '≤'); // Replace "<=" with "≤"
  }

  // Get appropriate translations
  const translations = getComparisonTranslations(settings);

  // Split text into lines to handle blockquotes and process each line carefully
  const lines = text.split('\n');
  const processedLines = lines.map(line => {
    // Skip lines that start with blockquote markers (> )
    if (/^\s*>\s/.test(line)) {
      return line;
    }

    // Skip lines that appear to contain HTML tags or comments
    if (/<[^>]+>/.test(line) || /<!--.*?-->/.test(line)) {
      return line;
    }

    // Skip lines that contain URLs
    if (/https?:\/\//.test(line) || /<[^@\s]+@[^@\s]+\.[^@\s]+>/.test(line)) {
      return line;
    }

    // Process comparison operators for this line
    let processedLine = line;

    // Replace compound operators first using the same robust approach
    // Handle >= symbols
    let previousLine = '';
    while (previousLine !== processedLine) {
      previousLine = processedLine;
      processedLine = processedLine.replace(/(\w+)\s*>=\s*(\w+)/g, '$1' + translations.greaterThanOrEqual + '$2');
    }

    // Handle <= symbols
    previousLine = '';
    while (previousLine !== processedLine) {
      previousLine = processedLine;
      processedLine = processedLine.replace(/(\w+)\s*<=\s*(\w+)/g, '$1' + translations.lessThanOrEqual + '$2');
    }

    // Replace standalone comparison symbols using a more robust approach
    // that handles multiple symbols on the same line correctly

    // Handle > symbols that appear between word characters
    previousLine = '';
    while (previousLine !== processedLine) {
      previousLine = processedLine;
      processedLine = processedLine.replace(/(\w+)\s*>\s*(\w+)/g, '$1' + translations.greaterThan + '$2');
    }

    // Handle < symbols
    previousLine = '';
    while (previousLine !== processedLine) {
      previousLine = processedLine;
      processedLine = processedLine.replace(/(\w+)\s*<\s*(\w+)/g, '$1' + translations.lessThan + '$2');
    }

    return processedLine;
  });

  return processedLines.join('\n');
}

/**
 * Convert a Buffer or Uint8Array to a true ArrayBuffer.
 * Avoids ArrayBuffer | SharedArrayBuffer union issues in newer TypeScript libdom.
 */
export function toArrayBuffer(data: Buffer | Uint8Array): ArrayBuffer {
  // Buffer is a subclass of Uint8Array; treat uniformly
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  const ab = new ArrayBuffer(view.byteLength);
  new Uint8Array(ab).set(view);
  return ab;
}

// Legacy XML escaping functions - no longer needed since edge-tts-universal handles this internally
// export function escapeAmpersand(text: string): string {
//   return text.replace(/&/g, '&amp;')  // Escape '&'
// }

// export function escapeXml(text: string): string {
//   return text
//     .replace(/</g, '&lt;')   // Escape '<'
//     .replace(/>/g, '&gt;')   // Escape '>'
//     .replace(/"/g, '&quot;') // Escape '"'
//     .replace(/'/g, '&apos;'); // Escape "'"
// }

export function filterMarkdown(text: string, textFiltering?: EdgeTTSPluginSettings['textFiltering'], symbolReplacement?: EdgeTTSPluginSettings['symbolReplacement']): string {
  let processedText = text;

  // Apply frontmatter filtering if enabled (default behavior if no settings provided)
  if (!textFiltering || textFiltering.filterFrontmatter) {
    // Remove frontmatter (e.g., YAML between triple dashes "---")
    processedText = processedText.replace(/^-{3}[\s\S]*?-{3}\n?/, '');
  }

  // Filter comments if enabled
  if (textFiltering?.filterComments) {
    // Remove HTML comments <!-- comment -->
    processedText = processedText.replace(/<!--[\s\S]*?-->/g, '');
    // Remove Obsidian comments %%comment%%
    processedText = processedText.replace(/%%[\s\S]*?%%/g, '');
  }

  // Filter math expressions if enabled
  if (textFiltering?.filterMathExpressions) {
    // Remove block math $$...$$
    processedText = processedText.replace(/\$\$[\s\S]*?\$\$/g, '');
    // Remove inline math $...$
    processedText = processedText.replace(/\$[^\n$]+\$/g, '');
  }

  // Filter code blocks if enabled (default behavior if no settings provided)
  if (!textFiltering || textFiltering.filterCodeBlocks) {
    // Remove fenced code blocks (e.g., ```code```)
    processedText = processedText.replace(/```[\s\S]*?```/g, '');
  }

  // Filter tables if enabled
  if (textFiltering?.filterTables) {
    // Remove markdown tables (lines with | characters that form table structure)
    processedText = processedText.replace(/^\|.*\|$/gm, '');
    // Remove table separator lines like |---|---|
    processedText = processedText.replace(/^\|[\s\-\|:]+\|$/gm, '');
  }

  // Filter images if enabled
  if (textFiltering?.filterImages) {
    // Remove image embeds ![alt](url)
    processedText = processedText.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
    // Remove image attachments ![[image.png]]
    processedText = processedText.replace(/!\[\[([^\]]*)\]\]/g, '');
  }

  // Filter callouts if enabled
  if (textFiltering?.filterCallouts) {
    // Remove Obsidian callout syntax but keep the content
    // Match lines starting with > [!type] and remove the callout formatting
    processedText = processedText.replace(/^>\s*\[![^\]]*\]\s*/gm, '');
    // Also remove subsequent > markers that are part of the callout
    const lines = processedText.split('\n');
    let inCallout = false;
    const filteredLines = lines.map(line => {
      if (line.match(/^>\s*\[![^\]]*\]/)) {
        inCallout = true;
        return line.replace(/^>\s*\[![^\]]*\]\s*/, '');
      } else if (inCallout && line.startsWith('> ')) {
        return line.substring(2);
      } else if (inCallout && !line.startsWith('>') && line.trim() !== '') {
        inCallout = false;
      }
      return line;
    });
    processedText = filteredLines.join('\n');
  }

  // Filter footnotes if enabled
  if (textFiltering?.filterFootnotes) {
    // Remove footnote references [^1]
    processedText = processedText.replace(/\[\^[^\]]+\]/g, '');
    // Remove footnote definitions [^1]: content
    processedText = processedText.replace(/^\[\^[^\]]+\]:\s*.*$/gm, '');
  }

  // Filter markdown links if enabled
  if (textFiltering?.filterMarkdownLinks) {
    // Remove markdown links [text](url) completely
    processedText = processedText.replace(/\[([^\]]*)\]\([^)]*\)/g, '');
  } else {
    // Default behavior: keep link text but remove URL
    processedText = processedText.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  }

  // Filter wiki links if enabled
  if (textFiltering?.filterWikiLinks) {
    // Remove wiki links [[link]] but keep display text [[link|display]] -> display
    processedText = processedText.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2'); // [[link|display]] -> display
    processedText = processedText.replace(/\[\[([^\]]*)\]\]/g, '$1'); // [[link]] -> link
  } else {
    // Default behavior: keep wiki link text
    processedText = processedText.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2'); // [[link|display]] -> display
    processedText = processedText.replace(/\[\[([^\]]*)\]\]/g, '$1'); // [[link]] -> link
  }

  // Remove URLs that aren't part of markdown links
  processedText = processedText.replace(/https?:\/\/[^\s]+/g, '');

  // Remove inline markdown syntax
  let cleanedMarkdown = processedText;

  // Remove bold (**text** or __text__) and italics (*text* or _text_)
  cleanedMarkdown = cleanedMarkdown
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
    .replace(/(\*|_)(.*?)\1/g, '$2');   // Italics

  // Filter inline code if enabled (default behavior if no settings provided)
  if (!textFiltering || textFiltering.filterInlineCode) {
    // Remove inline code markers (`code`) but keep the content
    cleanedMarkdown = cleanedMarkdown.replace(/`([^`]*)`/g, '$1');
  }

  // Filter highlights if enabled
  if (textFiltering?.filterHighlights) {
    // Remove highlight markers ==text== but keep the content
    cleanedMarkdown = cleanedMarkdown.replace(/==([^=]*)==/g, '$1');
  }

  // Remove strikethrough (~~text~~) but keep the content
  cleanedMarkdown = cleanedMarkdown.replace(/~~(.*?)~~/g, '$1');

  // Remove other markdown characters (e.g., #, -, *, etc., not part of inline code)
  cleanedMarkdown = cleanedMarkdown
    .replace(/^[#*-]+\s*/gm, '')
    // Remove unordered list markers (e.g., "- ", "* ", "+ ")
    .replace(/^[\-\+\*]\s+/gm, '')
    // Remove ordered list numbers (e.g., "1. ", "2. ")
    .replace(/^\d+\.\s+/gm, '')
    // Remove blockquote markers (e.g., "> ") only at the start of a line
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules (e.g., "---", "***")
    .replace(/^[-*]{3,}\s*$/gm, '');

  // Replace comparison symbols based on settings (create a minimal settings object)
  const settings = { textFiltering, symbolReplacement } as EdgeTTSPluginSettings;
  cleanedMarkdown = replaceComparisonSymbols(cleanedMarkdown, settings);

  // Filter HTML tags if enabled (default behavior if no settings provided)
  if (!textFiltering || textFiltering.filterHtmlTags) {
    // Remove HTML tags explicitly while preserving `<` and `>` symbols in text
    cleanedMarkdown = cleanedMarkdown.replace(/<([^>\s]+)[^>]*>/g, '');
  }

  // Clean up excessive whitespace
  cleanedMarkdown = cleanedMarkdown
    // Replace multiple consecutive newlines with double newlines
    .replace(/\n{3,}/g, '\n\n')
    // Replace multiple consecutive spaces with single spaces
    .replace(/ {2,}/g, ' ')
    // Trim leading and trailing whitespace
    .trim();

  return cleanedMarkdown;
}

/**
 * Result of content truncation check
 */
export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalWordCount: number;
  originalCharCount: number;
  finalWordCount: number;
  finalCharCount: number;
  truncationReason?: 'words' | 'characters';
}

/**
 * Check if content exceeds MP3 generation limits and truncate if necessary
 * @param text - The text content to check and potentially truncate
 * @returns TruncationResult with the processed content and metadata
 */
export function checkAndTruncateContent(text: string): TruncationResult {
  const originalText = text.trim();
  const originalWords = originalText.split(/\s+/).filter(word => word.length > 0);
  const originalWordCount = originalWords.length;
  const originalCharCount = originalText.length;

  // Check if content is within limits
  const exceedsWordLimit = originalWordCount > MP3_GENERATION_LIMITS.MAX_WORDS;
  const exceedsCharLimit = originalCharCount > MP3_GENERATION_LIMITS.MAX_CHARACTERS;

  if (!exceedsWordLimit && !exceedsCharLimit) {
    // Content is within limits, return as-is
    return {
      content: originalText,
      wasTruncated: false,
      originalWordCount,
      originalCharCount,
      finalWordCount: originalWordCount,
      finalCharCount: originalCharCount,
    };
  }

  // Determine which limit is more restrictive
  const wordLimitRatio = originalWordCount / MP3_GENERATION_LIMITS.MAX_WORDS;
  const charLimitRatio = originalCharCount / MP3_GENERATION_LIMITS.MAX_CHARACTERS;
  const truncationReason: 'words' | 'characters' = wordLimitRatio > charLimitRatio ? 'words' : 'characters';

  let truncatedContent: string;

  if (truncationReason === 'words') {
    // Truncate by word count
    const maxWords = MP3_GENERATION_LIMITS.MAX_WORDS - 10; // Small buffer
    const truncatedWords = originalWords.slice(0, maxWords);
    truncatedContent = truncatedWords.join(' ');
  } else {
    // Truncate by character count
    const maxChars = MP3_GENERATION_LIMITS.MAX_CHARACTERS - 50; // Small buffer
    truncatedContent = originalText.substring(0, maxChars);
  }

  // Try to find a good sentence boundary to truncate at
  truncatedContent = findBestTruncationPoint(truncatedContent);

  const finalWords = truncatedContent.split(/\s+/).filter(word => word.length > 0);
  const finalWordCount = finalWords.length;
  const finalCharCount = truncatedContent.length;

  return {
    content: truncatedContent,
    wasTruncated: true,
    originalWordCount,
    originalCharCount,
    finalWordCount,
    finalCharCount,
    truncationReason,
  };
}

/**
 * Find the best truncation point at sentence or word boundaries
 * @param text - The text to find a truncation point for
 * @returns The text truncated at the best boundary found
 */
function findBestTruncationPoint(text: string): string {
  // Try to find sentence endings (., !, ?) followed by whitespace
  const sentenceEndings = /[.!?]\s+/g;
  const matches = Array.from(text.matchAll(sentenceEndings));

  if (matches.length > 0) {
    // Use the last sentence ending found
    const lastMatch = matches[matches.length - 1];
    const endIndex = lastMatch.index! + lastMatch[0].length - 1; // Don't include the trailing space
    return text.substring(0, endIndex);
  }

  // If no sentence endings found, try to find paragraph breaks
  const paragraphBreaks = /\n\s*\n/g;
  const paragraphMatches = Array.from(text.matchAll(paragraphBreaks));

  if (paragraphMatches.length > 0) {
    const lastParagraphMatch = paragraphMatches[paragraphMatches.length - 1];
    return text.substring(0, lastParagraphMatch.index!);
  }

  // If no paragraph breaks, try to find word boundaries (spaces)
  const lastSpaceIndex = text.lastIndexOf(' ');
  if (lastSpaceIndex > text.length * 0.8) { // Only if we're not losing too much content
    return text.substring(0, lastSpaceIndex);
  }

  // Fallback: return the text as-is (already truncated to approximately the right length)
  return text;
}

/**
 * Check if notices should be shown based on settings and platform
 * @param settings - Plugin settings
 * @returns true if notices should be shown, false otherwise
 */
export function shouldShowNotices(settings: EdgeTTSPluginSettings): boolean {
  // If general notices are disabled, don't show any
  if (!settings.showNotices) {
    return false;
  }

  // On mobile, check the reduced notices setting
  if (Platform.isMobile && settings.reducedNoticesOnMobile) {
    return false;
  }

  // Otherwise, show notices
  return true;
}
