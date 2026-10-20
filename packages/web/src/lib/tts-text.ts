export function stripMarkdownForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[#*_~>|]/g, '')
    .trim();
}

export function prepareTtsParagraphs(text: string, minParagraphs = 3): string[] {
  const paragraphs = splitIntoParagraphs(text);
  if (paragraphs.length === 0) return [];
  if (paragraphs.length < minParagraphs) return [paragraphs.join(' ')];
  return paragraphs;
}

export function splitIntoParagraphs(text: string): string[] {
  const plain = stripMarkdownForTts(text);
  if (!plain) return [];

  const paragraphs = plain
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length > 0) return paragraphs;

  const single = plain.replace(/\s+/g, ' ').trim();
  return single ? [single] : [];
}

export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}