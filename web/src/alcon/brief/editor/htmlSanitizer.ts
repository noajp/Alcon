// Minimal allowlist-based HTML sanitizer for the Apple Notes-style editor.
// We control both the writer (AppleNoteEditor) and the reader (PageView), so
// the sanitizer only needs to defend against pasted HTML and malformed input.
//
// Allowed shape:
//   blocks  : h1, h2, p, blockquote, pre, ul, ol, li, hr, br
//   inline  : strong, em, u, s, code, a[href]
//   attrs   : data-align="left|center|right" on blocks
//             data-checklist="true" on ul
//             data-checked="true|false" on li
//             href on a (http/https/mailto only)

const BLOCK_TAGS = new Set(['h1', 'h2', 'p', 'blockquote', 'pre', 'ul', 'ol', 'li', 'hr', 'br', 'div']);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'a', 'span']);
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
  if (!BLOCK_TAGS.has(original) && !INLINE_TAGS.has(original)) {
    // Unknown tag → unwrap (keep children as a fragment)
    return unwrap(node, doc);
  }
  const tag = tagRename(original);
  const out = doc.createElement(tag);

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
  return container.innerHTML;
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
