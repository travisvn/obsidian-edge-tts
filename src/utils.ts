/* eslint-disable @typescript-eslint/no-inferrable-types */
/* eslint-disable no-useless-escape */

import { MP3_GENERATION_LIMITS } from './modules/constants';
import { Platform } from 'obsidian';
import type { EdgeTTSPluginSettings } from './modules/settings';

/**
 * Filters out the frontmatter from a Markdown text.
 * Frontmatter is defined as a block of YAML enclosed by `---` or `...` at the start of the file.
 * @param text - The Markdown text from which to remove frontmatter.
 * @returns The text without the frontmatter block.
 */
export function filterFrontmatter(text: string): string {
  // Define the regular expression for frontmatter blocks
  const frontmatterRegex = /^(---|\.\.\.)([\s\S]*?)\1\n?/;

  // Remove frontmatter if it exists
  return text.replace(frontmatterRegex, '').trim();
}

export function replaceComparisonSymbols(text: string): string {
  return text
    .replace(/>=/g, '≥') // Replace ">=" with "≥"
    .replace(/<=/g, '≤'); // Replace "<=" with "≤"
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

export function filterMarkdown(text: string, overrideCodeBlockRemoval = false): string {
  // Remove frontmatter (e.g., YAML between triple dashes "---")
  const noFrontmatter = text.replace(/^-{3}[\s\S]*?-{3}\n?/, '');

  // Remove URLs
  const noUrls = noFrontmatter.replace(/https?:\/\/[^\s]+/g, '');

  // Remove code blocks (e.g., fenced with ```)
  const noCodeBlocks = noUrls.replace(/```[\s\S]*?```/g, '');

  // Remove inline markdown syntax
  let cleanedMarkdown = noCodeBlocks
    // Remove bold (**text** or __text__) and italics (*text* or _text_)
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
    .replace(/(\*|_)(.*?)\1/g, '$2')   // Italics
    // Remove inline code markers (`code`)
    .replace(/`([^`]*)`/g, '$1')
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, '$1')
    // Remove other markdown characters (e.g., #, -, *, etc., not part of inline code)
    .replace(/^[#*-]+\s*/gm, '')
    // Remove unordered list markers (e.g., "- ", "* ", "+ ")
    .replace(/^[\-\+\*]\s+/gm, '')
    // Remove ordered list numbers (e.g., "1. ", "2. ")
    .replace(/^\d+\.\s+/gm, '')
    // Remove blockquote markers (e.g., "> ") only at the start of a line
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules (e.g., "---", "***")
    .replace(/^[-*]{3,}\s*$/gm, '');

  cleanedMarkdown = replaceComparisonSymbols(cleanedMarkdown);

  // Remove HTML tags explicitly while preserving `<` and `>` symbols in text
  cleanedMarkdown = cleanedMarkdown.replace(/<([^>\s]+)[^>]*>/g, '');

  // Trim leading and trailing whitespace
  // Note: edge-tts-universal handles XML/SSML escaping internally, so we no longer need manual escaping
  cleanedMarkdown = cleanedMarkdown.trim();

  const finalText = cleanedMarkdown;

  return finalText;
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