// Reads / writes for `documents.content` (jsonb) when used as a note body.
// Forward path: editor produces sanitized HTML → stored as a plain string
// inside the jsonb column.
// Backward path: legacy rows hold a structured-block JSON array → converted
// one-way to HTML for the editor's `initialHtml` prop. New writes drop the
// JSON and store HTML.

import { legacyJsonToHtml } from './legacyJsonToHtml';

export function documentContentToHtml(content: unknown): string {
  if (typeof content === 'string') {
    // Could be a stored HTML string OR a stringified legacy block array.
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return legacyJsonToHtml(content);
    }
    return content;
  }
  if (Array.isArray(content)) {
    return legacyJsonToHtml(content);
  }
  return '';
}
