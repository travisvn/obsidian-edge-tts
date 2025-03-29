/* eslint-disable @typescript-eslint/no-inferrable-types */
/* eslint-disable no-useless-escape */

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

export function escapeAmpersand(text: string): string {
  return text.replace(/&/g, '&amp;')  // Escape '&'
}

export function escapeXml(text: string): string {
  return text
    // .replace(/&/g, '&amp;')  // Escape '&' first to avoid double escaping
    .replace(/</g, '&lt;')   // Escape '<'
    .replace(/>/g, '&gt;')   // Escape '>'
    .replace(/"/g, '&quot;') // Escape '"'
    .replace(/'/g, '&apos;'); // Escape "'"
}

export function filterMarkdown(text: string, overrideAmpersandEscape = false): string {
  // Remove frontmatter (e.g., YAML between triple dashes "---")
  const noFrontmatter = text.replace(/^-{3}[\s\S]*?-{3}\n?/, '');

  // Remove URLs
  const noUrls = noFrontmatter.replace(/https?:\/\/[^\s]+/g, '');

  // Remove code blocks (e.g., fenced with ``` or indented by 4 spaces, unless they are nested list item)
  const noCodeBlocks = noUrls.replace(/```[\s\S]*?```/g, '').replace(/^( {4}|\t)(?!(?:[-*+ ]|\d+\.) ).+/gm, '');

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

  // Trim leading and trailing whitespace and escape '&' if indicated
  cleanedMarkdown = (overrideAmpersandEscape) ? cleanedMarkdown.trim() : escapeAmpersand(cleanedMarkdown.trim());

  const finalText = escapeXml(cleanedMarkdown);

  return finalText;
}