import type { Cell, WorkSheet } from './sheetLayout';
import type { DocBlock, DocLayout, DocPara } from './docLayout';
import type { Deck, DeckSlide, Para as SlidePara } from './deckLayout';

// What changed between two versions of a file, for marking it in the
// preview: a workbook's cells (what each changed one held before), a Word
// document's paragraphs (changed — with what it read before — added, and how
// many were taken out). Paragraphs are matched in order (a longest common
// subsequence of their text), so a paragraph inserted near the top does not
// make every paragraph under it read as changed.

/** Pure. A cell's reference as Excel writes it (row 0, column 0 → "A1"). */
export function cellRef(r: number, c: number): string {
  let name = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return `${name}${r + 1}`;
}

/** Pure. A reference's row and column ("B3" → [2, 1]); null when not one. */
export function refPosition(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

/** What a cell holds, as typed into it: a number's value, not its format. */
export const cellValue = (cell: Cell | undefined) => (cell && !cell.hidden ? (cell.value != null ? String(cell.value) : cell.text) : '');

export interface SheetChanges {
  /** Sheet name → cell reference → what the cell held before ('' = empty). */
  cells: Map<string, Map<string, string>>;
  count: number;
}

/** Pure. The cells whose content differs between two versions of a workbook. */
export function diffWorkbooks(before: WorkSheet[], after: WorkSheet[]): SheetChanges {
  const cells = new Map<string, Map<string, string>>();
  let count = 0;
  for (const sheet of after) {
    const old = before.find((s) => s.name === sheet.name);
    const changed = new Map<string, string>();
    const rows = Math.max(sheet.rows.length, old?.rows.length ?? 0);
    for (let r = 0; r < rows; r++) {
      const now = sheet.rows[r]?.cells ?? [];
      const was = old?.rows[r]?.cells ?? [];
      for (let c = 0; c < Math.max(now.length, was.length); c++) {
        const a = cellValue(was[c]);
        const b = cellValue(now[c]);
        if (a !== b && (a || b)) changed.set(cellRef(r, c), a);
      }
    }
    if (changed.size) { cells.set(sheet.name, changed); count += changed.size; }
  }
  return { cells, count };
}

export type ParaMark = { kind: 'changed'; before: string } | { kind: 'added' };
export interface DocChanges {
  /** Each paragraph of the newer version that changed or was added. */
  marks: Map<DocPara, ParaMark>;
  /** Paragraphs of the older version that are gone. */
  removed: number;
  count: number;
}

/** Every paragraph of a document's body, tables included, in reading order. */
function paragraphs(blocks: DocBlock[], out: DocPara[] = []): DocPara[] {
  for (const b of blocks) {
    if (b.kind === 'p') out.push(b);
    else if (b.kind === 'table') for (const row of b.rows) for (const cell of row) if (!cell.skip) paragraphs(cell.blocks, out);
  }
  return out;
}
const textOf = (p: DocPara) => p.runs.map((r) => r.text).join('');

/** Pure. Pairs of indexes (in a, in b) where the sequences agree, in order. */
function commonSubsequence(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  // Past this size the table would be large; match equal runs at the ends only.
  if (n * m > 4_000_000) {
    const pairs: [number, number][] = [];
    let i = 0;
    while (i < n && i < m && a[i] === b[i]) { pairs.push([i, i]); i++; }
    let j = 0;
    while (j < n - i && j < m - i && a[n - 1 - j] === b[m - 1 - j]) { pairs.push([n - 1 - j, m - 1 - j]); j++; }
    return pairs.sort((x, y) => x[0] - y[0]);
  }
  const len = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Pure. Paragraph texts of an older version against a newer one's
 *  paragraphs, matched in order: between two that match, the ones left over
 *  are paired as changed; the rest were added (in the newer) or removed
 *  (from the older). */
function diffParagraphs<P>(was: string[], now: P[], textOfNew: (p: P) => string, marks: Map<P, ParaMark>): number {
  const b = now.map(textOfNew);
  let removed = 0;
  let i = 0, j = 0;
  for (const [mi, mj] of [...commonSubsequence(was, b), [was.length, b.length] as [number, number]]) {
    const gone = was.slice(i, mi);
    const come = now.slice(j, mj);
    come.forEach((p, k) => {
      if (k < gone.length) marks.set(p, { kind: 'changed', before: gone[k] });
      else if (textOfNew(p).trim()) marks.set(p, { kind: 'added' });
    });
    removed += gone.slice(come.length).filter((t) => t.trim()).length;
    i = mi + 1; j = mj + 1;
  }
  return removed;
}

/** Pure. The paragraphs that changed, were added or went between two
 *  versions of a Word document. */
export function diffDocs(before: DocLayout, after: DocLayout): DocChanges {
  const marks = new Map<DocPara, ParaMark>();
  const removed = diffParagraphs(paragraphs(before.blocks).map(textOf), paragraphs(after.blocks), textOf, marks);
  return { marks, removed, count: marks.size + removed };
}

export interface DeckChanges {
  /** Each paragraph of the newer version's slides that changed or was added. */
  marks: Map<SlidePara, ParaMark>;
  removed: number;
  count: number;
}

/** A slide's text by shape: its own shapes' paragraphs, keyed by shape id. */
function shapeTexts(slide: DeckSlide | undefined): Map<string, SlidePara[]> {
  const out = new Map<string, SlidePara[]>();
  for (const item of slide?.items ?? []) {
    if (item.kind === 'shape' && item.spId && item.text) out.set(item.spId, item.text.paras);
  }
  return out;
}
const slideText = (p: SlidePara) => p.runs.map((r) => r.text).join('');

/** Pure. The paragraphs that changed, were added or went between two
 *  versions of a PowerPoint deck: slide by slide (in order), shape by
 *  shape (by its id), paragraphs matched in order as in a document. */
export function diffDecks(before: Deck, after: Deck): DeckChanges {
  const marks = new Map<SlidePara, ParaMark>();
  let removed = 0;
  const slides = Math.max(before.slides.length, after.slides.length);
  for (let n = 0; n < slides; n++) {
    const was = shapeTexts(before.slides[n]);
    const now = shapeTexts(after.slides[n]);
    for (const [id, paras] of now) removed += diffParagraphs((was.get(id) ?? []).map(slideText), paras, slideText, marks);
    for (const [id, paras] of was) if (!now.has(id)) removed += paras.filter((p) => slideText(p).trim()).length;
  }
  return { marks, removed, count: marks.size + removed };
}
