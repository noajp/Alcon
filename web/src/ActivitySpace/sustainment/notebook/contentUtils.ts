// Helpers for extracting plain text / first-paragraph summaries from a
// note's HTML body. Note-style HTML is the only supported format.
import { htmlToPlainText } from './editor/htmlSanitizer';

export function extractPlainText(content: string): string {
  return htmlToPlainText(content ?? '');
}
