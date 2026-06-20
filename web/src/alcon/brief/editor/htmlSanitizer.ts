// Minimal allowlist-based HTML sanitizer for the Note-style editor.
// We control both the writer (NoteEditor) and the reader (PageView), so
// the sanitizer only needs to defend against pasted HTML and malformed input.
//
// Allowed shape:
//   blocks  : h1, h2, h3, p, blockquote, pre, ul, ol, li, hr, br
//   inline  : strong, em, u, s, code, a[href]
//   attrs   : data-align="left|center|right" on blocks
//             data-checklist="true" on ul
//             data-checked="true|false" on li
//             href on a (http/https/mailto only)

const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'blockquote', 'pre', 'ul', 'ol', 'li', 'hr', 'br', 'div']);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'a', 'span']);
// Note-style tables. Kept as-is (the structure normalizer ignores
// them); the table element carries data-note-table so the editor CSS targets
// only intentional tables, not pasted layout tables.
const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);
const ALIGN_VALUES = new Set(['left', 'center', 'right']);

function tagRename(tag: string): string {
  if (tag === 'b') return 'strong';
  if (tag === 'i') return 'em';
  if (tag === 'strike') return 's';
  if (tag === 'div') return 'p';
  return tag;
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:')
  );
}

function alignFromStyle(style: string | null): string | null {
  if (!style) return null;
  const m = style.match(/text-align\s*:\s*(left|center|right)/i);
  return m ? m[1].toLowerCase() : null;
}

function cleanElement(node: Element, doc: Document): Node | null {
  const original = node.tagName.toLowerCase();
  if (!BLOCK_TAGS.has(original) && !INLINE_TAGS.has(original) && !TABLE_TAGS.has(original)) {
    // Unknown tag → unwrap (keep children as a fragment)
    return unwrap(node, doc);
  }
  const tag = tagRename(original);
  const out = doc.createElement(tag);

  // Tables: keep the structural tags and the data-note-table marker; cells
  // hold ordinary inline content handled by the recursion below.
  if (tag === 'table' && node.getAttribute('data-note-table') === 'true') {
    out.setAttribute('data-note-table', 'true');
  }
  // Preserve cell spans (from merge) — only sane positive integers.
  if (tag === 'td' || tag === 'th') {
    for (const attr of ['colspan', 'rowspan'] as const) {
      const v = parseInt(node.getAttribute(attr) || '', 10);
      if (Number.isFinite(v) && v > 1) out.setAttribute(attr, String(v));
    }
  }

  // Carry over allowed attributes
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href && isSafeHref(href)) {
      out.setAttribute('href', href);
      out.setAttribute('rel', 'noopener noreferrer');
      out.setAttribute('target', '_blank');
    } else {
      // Drop the link, keep the text
      return unwrap(node, doc);
    }
  }

  // data-align: prefer existing data-align, else read from style="text-align:..."
  if (BLOCK_TAGS.has(tag)) {
    const dataAlign = node.getAttribute('data-align');
    const styleAlign = alignFromStyle(node.getAttribute('style'));
    const align = (dataAlign && ALIGN_VALUES.has(dataAlign)) ? dataAlign : styleAlign;
    if (align && align !== 'left') out.setAttribute('data-align', align);
  }

  if (tag === 'ul') {
    if (node.getAttribute('data-checklist') === 'true') {
      out.setAttribute('data-checklist', 'true');
    }
  }

  if (tag === 'li') {
    const checked = node.getAttribute('data-checked');
    if (checked === 'true' || checked === 'false') {
      out.setAttribute('data-checked', checked);
    }
    // Persisted link to an Element (set by → Element 化). The Element's
    // live status drives the bullet's ○ and is re-derived on render, so
    // only this stable id link survives a save round-trip.
    const elementId = node.getAttribute('data-element-id');
    if (elementId) out.setAttribute('data-element-id', elementId);
  }

  // Self-closing
  if (tag === 'br' || tag === 'hr') return out;

  // Recurse children
  for (const child of Array.from(node.childNodes)) {
    const cleaned = cleanNode(child, doc);
    if (cleaned) out.appendChild(cleaned);
  }
  return out;
}

function unwrap(node: Element, doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const child of Array.from(node.childNodes)) {
    const cleaned = cleanNode(child, doc);
    if (cleaned) frag.appendChild(cleaned);
  }
  return frag;
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3 /* TEXT */) {
    return doc.createTextNode(node.nodeValue ?? '');
  }
  if (node.nodeType !== 1 /* ELEMENT */) return null;
  return cleanElement(node as Element, doc);
}

export function sanitizeHtml(input: string): string {
  if (!input) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    // SSR: pass through; the reader hydrates client-side anyway.
    return input;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<!doctype html><body>${input}`, 'text/html');
  const out = doc.implementation.createHTMLDocument('');
  const container = out.createElement('div');
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child, out);
    if (cleaned) container.appendChild(cleaned);
  }
  // Tag-level allowlisting can't see bad *nesting* (e.g. formatBlock fired
  // inside a list yields <ul><h1>…</h1></ul>, or a heading wrapping a <p>).
  // Repair it so the persisted shape is always valid document structure.
  normalizeStructure(container);
  return container.innerHTML;
}

// Flow ("text") blocks. A flow block may hold inline content and, for a
// list item, a nested <ul>/<ol> — but never another flow block.
const FLOW_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'DIV']);

/** Cheap probe: true when the tree contains invalid block nesting — a list
 *  child that isn't <li>, or a flow block / list item wrapping another
 *  block. Lets the live editor skip normalization while plain typing (which
 *  never breaks structure) and only pay for it right after a structural
 *  command (formatBlock-in-list, pasted soup, …). */
export function hasInvalidStructure(root: Element): boolean {
  for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
    for (const child of Array.from(list.children)) {
      if (child.tagName !== 'LI') return true;
    }
  }
  for (const b of Array.from(root.querySelectorAll('li, p, h1, h2, h3, blockquote, pre'))) {
    for (const child of Array.from(b.children)) {
      if (FLOW_BLOCKS.has(child.tagName)) return true;
    }
  }
  return false;
}

/** Repair invalid block nesting in place: lists hold only <li>, and flow
 *  blocks / list items never wrap another block (the inner block's inline
 *  content is lifted out, the wrapper dropped). Only element wrappers are
 *  moved or removed — text nodes are relocated, never recreated — so a live
 *  caret sitting in a text node survives the repair. Nested <ul>/<ol>
 *  sub-lists inside an <li> are preserved. */
export function normalizeStructure(root: Element): void {
  const doc = root.ownerDocument;
  // 1. A list may only contain <li>; wrap any stray child in one.
  for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
    for (const child of Array.from(list.children)) {
      if (child.tagName !== 'LI') {
        const li = doc.createElement('li');
        list.insertBefore(li, child);
        li.appendChild(child);
      }
    }
  }
  // 2. Flatten nested flow blocks: lift their inline content up, drop the
  //    wrapper. Looped until stable so <li><h1><p>x</p></h1></li> collapses
  //    fully to <li>x</li>.
  const flatten = (el: Element) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of Array.from(el.children)) {
        if (FLOW_BLOCKS.has(child.tagName)) {
          while (child.firstChild) el.insertBefore(child.firstChild, child);
          el.removeChild(child);
          changed = true;
        }
      }
    }
  };
  for (const li of Array.from(root.querySelectorAll('li'))) flatten(li);
  for (const b of Array.from(root.querySelectorAll('p, h1, h2, h3, blockquote, pre'))) flatten(b);
}

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]+>/g, '').trim();
  }
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  // Insert newlines at block boundaries for readability.
  for (const tag of ['h1', 'h2', 'p', 'li', 'blockquote', 'pre', 'div', 'br']) {
    for (const el of Array.from(doc.body.querySelectorAll(tag))) {
      el.appendChild(doc.createTextNode('\n'));
    }
  }
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
