/* eslint-disable no-useless-escape */
export function filterMarkdown(text: string): string {
  // Remove URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '');

  // Remove Markdown links [text](url)
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Remove bold/italic symbols
  text = text.replace(/(\*\*|__|\*|_)/g, '');

  // Remove headers (#, ##, ###, etc.)
  text = text.replace(/^#+\s+/gm, '');

  // Remove code blocks and inline code
  text = text.replace(/`{1,3}[^`]+`{1,3}/g, '');
  text = text.replace(/```[\s\S]+?```/g, '');

  // Remove other Markdown syntax like lists and quotes
  text = text.replace(/^[>\-\+\*\d]+\s+/gm, '');

  // Remove image syntax ![alt text](url)
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Remove HTML tags
  text = text.replace(/<\/?[^>]+(>|$)/g, '');

  // Trim extra whitespace
  text = text.trim();

  return text;
}