// Helpers for extracting plain text / first-paragraph summaries from a
// note's HTML body. Note-style HTML is the only supported format.
import { htmlToPlainText } from './editor/htmlSanitizer';

export function extractPlainText(content: string): string {
  return htmlToPlainText(content ?? '');
}

// Pick a sensible default summary when extracting a Brief from a Note:
// the first meaningful line of text from the note body.
export function extractFirstParagraph(content: string): string {
  const txt = htmlToPlainText(content ?? '');
  return txt.split('\n').find((l) => l.trim()) ?? '';
}
