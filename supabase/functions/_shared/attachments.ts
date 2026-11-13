// Files sent with a person's message, turned into model content. Every
// entry that takes a message with files — Athena's chat driver in
// run-agent, and clayware-copilot's tool-free json mode — builds the turn's
// content here, so the limits and the block shapes mean the same thing
// however the message arrived. Pure: a bad file is an Error with the
// reason, and the caller decides how the conversation hears it.

import type { Block } from "./agentLoop.ts";

/** A file as it arrives on the wire; every field is checked before use. */
export interface Attachment { name?: unknown; mediaType?: unknown; data?: unknown }

// The limits keep one message inside what the model and the function accept.
export const MAX_FILES = 5;
export const MAX_PDF_BASE64 = 14_000_000;   // ≈ 10 MB of PDF
export const MAX_TEXT_CHARS = 400_000;

/** A turn's content: its text, or — when files came with it — a document
 *  block per file, then the text. Attachments ride only on a person's
 *  turn; anything else is plain text. */
export function requestContent(m: { role: string; content: string; attachments?: Attachment[] }): string | Block[] {
  const files = m.role === "user" && Array.isArray(m.attachments) ? m.attachments : [];
  if (files.length === 0) return m.content;
  if (files.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files per message`);
  const blocks: Block[] = files.map((f) => {
    const title = typeof f.name === "string" ? f.name.slice(0, 200) : "file";
    if (typeof f.data !== "string" || !f.data) throw new Error(`${title}: no contents`);
    if (f.mediaType === "application/pdf") {
      if (f.data.length > MAX_PDF_BASE64) throw new Error(`${title}: PDF too large`);
      return { type: "document", title, source: { type: "base64", media_type: "application/pdf", data: f.data } };
    }
    if (f.mediaType === "text/plain") {
      if (f.data.length > MAX_TEXT_CHARS) throw new Error(`${title}: text too long`);
      return { type: "document", title, source: { type: "text", media_type: "text/plain", data: f.data } };
    }
    throw new Error(`${title}: unsupported file type`);
  });
  return [...blocks, { type: "text", text: m.content || "添付したファイルを読んでください。" }];
}
