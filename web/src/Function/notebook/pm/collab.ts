import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { htmlToDoc } from './html';

// Starting a shared document from a Note's saved HTML.

/** The shared document's fragment the editor binds to. */
export const FRAGMENT = 'prosemirror';

/** Pure. A 32-bit hash of a string (FNV-1a), never 0. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

/** Pure. The name of the body a shared document was started from: two
 *  documents with the same name were started the same way and are one. */
export function seedId(html: string): string {
  return `${hashText(html)}.${html.length}`;
}

/**
 * Fills an empty shared document with a Note's saved body, and returns that
 * body's name. Everyone who starts from the same body starts the same way:
 * the content is written under an author id taken from the body itself, so
 * their starts are the very same edit and merge as one instead of doubling
 * the text.
 */
export function seedFromHtml(doc: Y.Doc, html: string): string {
  if (doc.getXmlFragment(FRAGMENT).length === 0) {
    const seed = new Y.Doc();
    seed.clientID = hashText(html);
    prosemirrorToYXmlFragment(htmlToDoc(html), seed.getXmlFragment(FRAGMENT));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
    seed.destroy();
  }
  return seedId(html);
}
