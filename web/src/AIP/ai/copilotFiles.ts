import type { CopilotAttachment } from './useAlconCopilot';

// Files the AI can read: PDF, Markdown and plain text. A PDF goes to the model
// as itself (base64); Markdown and text go as their text. The limits match
// the engine's (_shared/attachments.ts), so a file it would refuse is
// refused here first.

export const ATTACH_ACCEPT = '.pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain';
export const MAX_FILES = 5;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;

export type AttachKind = 'pdf' | 'text';

/** What a file is, from its type or (browsers often leave .md untyped) its name. */
export function attachKind(name: string, type: string): AttachKind | null {
  const lower = name.toLowerCase();
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (type === 'text/plain' || type === 'text/markdown' || /\.(md|markdown|txt)$/.test(lower)) return 'text';
  return null;
}

export class AttachError extends Error {
  constructor(readonly reason: 'type' | 'size', readonly fileName: string) {
    super(reason === 'type' ? `${fileName}: unsupported` : `${fileName}: too large`);
    this.name = 'AttachError';
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Reads a picked or dropped file into an attachment, or throws AttachError. */
export async function readAttachment(file: File): Promise<CopilotAttachment> {
  const kind = attachKind(file.name, file.type);
  if (!kind) throw new AttachError('type', file.name);
  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new AttachError('size', file.name);
    const url = await readAsDataUrl(file);
    return { name: file.name, mediaType: 'application/pdf', data: url.slice(url.indexOf(',') + 1) };
  }
  const text = await file.text();
  if (text.length > MAX_TEXT_CHARS) throw new AttachError('size', file.name);
  return { name: file.name, mediaType: 'text/plain', data: text };
}

/** The step a tool call is taking, in words a person reads: reading, creating,
 *  changing or deleting. */
export function toolVerb(name: string, input?: Record<string, unknown>): 'Reading' | 'Creating' | 'Updating' | 'Deleting' {
  const action = typeof input?.action === 'string' ? input.action : '';
  const word = `${name} ${action}`;
  if (/delete|remove/i.test(word)) return 'Deleting';
  if (/create|add|insert/i.test(word)) return 'Creating';
  if (/^(list|get|find|analyze)|\b(list|get|campaigns|query)\b/i.test(word)) return 'Reading';
  if (/update|set|toggle|move|link|patch|place/i.test(word)) return 'Updating';
  return 'Reading';
}
