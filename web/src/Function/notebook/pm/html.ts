import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { schema, TABLE_ATTR } from './schema';

// A body's HTML in and out of the document model. What goes out is the same
// HTML the Notes have always been saved as; what comes in may be anything
// (old bodies, pasted pages) and keeps only what the model can hold.

/** Moves <colgroup> widths onto the first row's cells (the table model keeps a
 *  column's width on its cells), and tells an empty body from a blank line. */
function prepare(container: HTMLElement): void {
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
 *  are written straight into them (<li>text</li>, as bodies always were); tables get their marker and a
 *  <colgroup> from the first row's widths; the cells' own width attribute is
 *  dropped. */
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

/** Pure but for the DOM. A body's HTML as a document. */
export function htmlToDoc(html: string, doc: Document = document): PMNode {
  const container = doc.createElement('div');
  container.innerHTML = html || '';
  prepare(container);
  return PMDOMParser.fromSchema(schema).parse(container);
}

/** Pure but for the DOM. A document as the HTML it is saved as. */
export function docToHtml(node: PMNode, doc: Document = document): string {
  const container = doc.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: doc }));
  finish(container);
  return container.innerHTML;
}

/** Pure. Whether a document says nothing: one empty line of text or heading. */
export function isEmptyDoc(node: PMNode): boolean {
  if (node.childCount !== 1) return false;
  const only = node.firstChild!;
  return only.isTextblock && only.content.size === 0 && only.type.name !== 'code_block';
}
