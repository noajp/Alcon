import { DOMParser as PMDOMParser, DOMSerializer, Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema, TABLE_ATTR } from './schema';

// A body's HTML in and out of the document model. What goes out is the same
// HTML the Notes have always been saved as; what comes in may be anything
// (old bodies, pasted pages) and keeps only what the model can hold.

/** Moves <colgroup> widths onto the first row's cells (the table model keeps a
 *  column's width on its cells), and gives every checklist line that is not
 *  an Element its box, unchecked unless it says otherwise. */
function prepare(container: HTMLElement): void {
  for (const li of Array.from(container.querySelectorAll('ul[data-checklist="true"] > li'))) {
    if (!li.hasAttribute('data-checked') && !li.getAttribute('data-element-id')) li.setAttribute('data-checked', 'false');
  }
  for (const table of Array.from(container.querySelectorAll('table'))) {
    const widths = Array.from(table.querySelectorAll(':scope > colgroup > col')).map((col) => {
      const m = (col.getAttribute('style') ?? '').match(/width\s*:\s*([\d.]+)px/i);
      return m ? Math.round(parseFloat(m[1])) : 0;
    });
    if (!widths.some(Boolean)) continue;
    const first = table.querySelector('tr');
    if (!first) continue;
    let col = 0;
    for (const cell of Array.from(first.children)) {
      const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const own = widths.slice(col, col + span);
      if (own.every(Boolean)) cell.setAttribute('data-colwidth', own.join(','));
      col += span;
    }
  }
}

/** The reverse of prepare: a list item's first line, and a cell's only line,
 *  are written straight into them (<li>text</li>, as bodies always were);
 *  tables get their marker and a <colgroup> from the first row's widths; the
 *  cells' own width attribute is dropped. */
function finish(container: HTMLElement): void {
  for (const li of Array.from(container.querySelectorAll('li'))) {
    const first = li.firstElementChild;
    if (first !== li.firstChild || first?.tagName !== 'P' || first.attributes.length) continue;
    first.replaceWith(...Array.from(first.childNodes));
  }
  // A cell of one plain line holds its text straight, too.
  for (const cell of Array.from(container.querySelectorAll('td, th'))) {
    const only = cell.firstElementChild;
    if (cell.childNodes.length !== 1 || only?.tagName !== 'P' || only.attributes.length) continue;
    only.replaceWith(...Array.from(only.childNodes));
  }
  for (const table of Array.from(container.querySelectorAll('table'))) {
    table.setAttribute(TABLE_ATTR, 'true');
    const first = table.querySelector('tr');
    const widths: number[] = [];
    for (const cell of Array.from(first?.children ?? [])) {
      const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const own = (cell.getAttribute('data-colwidth') ?? '').split(',').map((v) => parseInt(v, 10) || 0);
      for (let i = 0; i < span; i++) widths.push(own[i] ?? 0);
    }
    for (const cell of Array.from(table.querySelectorAll('[data-colwidth]'))) cell.removeAttribute('data-colwidth');
    if (widths.some(Boolean)) {
      const group = container.ownerDocument.createElement('colgroup');
      for (const w of widths) {
        const col = container.ownerDocument.createElement('col');
        if (w) col.setAttribute('style', `width:${w}px`);
        group.appendChild(col);
      }
      table.insertBefore(group, table.firstChild);
    }
  }
}

// HTML drops a space at the start or end of a line and all but one of
// several in a row. Saved, those spaces are written as no-break spaces (as a
// browser's own editing writes them — what bodies have always held); read
// back, a no-break space standing where one was written for that reason is a
// plain space again. One typed on purpose inside a line is left alone.

const NBSP = '\u00a0';

/** Pure. A text block's pieces (null: a line break) with the spaces HTML
 *  would drop written as no-break spaces. */
export function keepSpaces(texts: (string | null)[]): (string | null)[] {
  let lineStart = true;
  let afterSpace = false;
  const out = texts.map((text) => {
    if (text === null) { lineStart = true; afterSpace = false; return null; }
    let kept = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ' && (lineStart || afterSpace)) { kept += NBSP; afterSpace = false; }
      else { kept += ch; afterSpace = ch === ' '; }
      lineStart = false;
    }
    return kept;
  });
  for (let i = out.length - 1; i >= 0; i--) {
    const text = out[i];
    if (text === null) break;
    if (!text) continue;
    if (text.endsWith(' ')) out[i] = text.slice(0, -1) + NBSP;
    break;
  }
  return out;
}

/** Pure. The reverse of keepSpaces. */
export function plainSpaces(texts: (string | null)[]): (string | null)[] {
  const chars: (string | null)[] = [];
  for (const text of texts) {
    if (text === null) chars.push(null);
    else for (let i = 0; i < text.length; i++) chars.push(text[i]);
  }
  let at = 0;
  return texts.map((text) => {
    if (text === null) { at += 1; return null; }
    let plain = '';
    for (let i = 0; i < text.length; i++, at++) {
      const ch = chars[at];
      const before = at > 0 ? chars[at - 1] : null;
      const edge = at === 0 || before === null || at === chars.length - 1;
      plain += ch === NBSP && (edge || before === ' ' || chars[at + 1] === ' ') ? ' ' : ch;
    }
    return plain;
  });
}

/** Pure. A document with every text block's text passed through `fn` (code
 *  keeps its spaces as they are). Unchanged parts are the same nodes. */
function mapText(node: PMNode, fn: (texts: (string | null)[]) => (string | null)[]): PMNode {
  if (node.isText || node.isLeaf) return node;
  const kids: PMNode[] = [];
  node.forEach((kid) => kids.push(kid));
  if (node.isTextblock) {
    if (node.type.spec.code) return node;
    const before = kids.map((kid) => (kid.isText ? kid.text ?? '' : null));
    const after = fn(before);
    if (after.every((text, i) => text === before[i])) return node;
    return node.copy(Fragment.from(kids.map((kid, i) => (kid.isText && after[i] !== before[i] ? schema.text(after[i] ?? '', kid.marks) : kid))));
  }
  const mapped = kids.map((kid) => mapText(kid, fn));
  return mapped.every((kid, i) => kid === kids[i]) ? node : node.copy(Fragment.from(mapped));
}

/** Pure but for the DOM. A body's HTML as a document. The HTML is read in a
 *  document of its own, where nothing in it can run or load: a body is
 *  written by other people (and by whatever they pasted), and reading it in
 *  the page would run an `onerror` it carries. */
export function htmlToDoc(html: string): PMNode {
  const body = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}`, 'text/html').body;
  prepare(body);
  return mapText(PMDOMParser.fromSchema(schema).parse(body), plainSpaces);
}

/** Pure but for the DOM. A document as the HTML it is saved as. */
export function docToHtml(node: PMNode, doc: Document = document): string {
  const container = doc.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(mapText(node, keepSpaces).content, { document: doc }));
  finish(container);
  return container.innerHTML;
}

/** Pure. Whether a document says nothing: one empty line of text or heading. */
export function isEmptyDoc(node: PMNode): boolean {
  if (node.childCount !== 1) return false;
  const only = node.firstChild!;
  return only.isTextblock && only.content.size === 0 && only.type.name !== 'code_block';
}
