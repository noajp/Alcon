// Reads / writes for `documents.content` (jsonb) when used as a note body.
// Forward path: editor produces sanitized HTML → stored as a plain string
// inside the jsonb column.
// Backward path: legacy rows hold a BlockNote JSON array → converted to
// HTML one-way for the editor's `initialHtml` prop. New writes drop the
// JSON and store HTML.

import { blockNoteJsonToHtml } from './blockNoteToHtml';

export function documentContentToHtml(content: unknown): string {
  if (typeof content === 'string') {
    // Could be a stored HTML string OR a stringified BlockNote array.
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return blockNoteJsonToHtml(content);
    }
    return content;
  }
  if (Array.isArray(content)) {
    return blockNoteJsonToHtml(content);
  }
  return '';
}
