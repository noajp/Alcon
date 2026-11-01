import JSZip from 'jszip';

// Light edits to an Office file, written into the file itself: a workbook
// cell's value, or a Word paragraph's text. Each edit says what it found
// (`from`) and what it makes (`to`), so it can be applied to a newer version
// of the file than the one it was made on — someone else's edits to other
// cells and paragraphs stay, and an edit whose cell or paragraph has since
// changed is reported back as a conflict. Everything else in the file
// (styles, formulas elsewhere, pictures, charts) is left byte for byte as it
// was. Read and written with DOMParser / XMLSerializer — the browser, or
// jsdom in the tests.

export interface CellEdit { kind: 'cell'; sheet: string; ref: string; from: string; to: string }
export interface ParaEdit { kind: 'para'; index: number; from: string; to: string }
export type OfficeEdit = CellEdit | ParaEdit;
export interface EditResult {
  bytes: Uint8Array;
  /** Applied, but the cell or paragraph no longer held what the edit found. */
  conflicts: OfficeEdit[];
  /** Not applied: the paragraph could not be found any more. */
  skipped: OfficeEdit[];
}

/** Edits made in a preview and not yet saved, one per cell or paragraph. */
export interface EditSession {
  /** Different for each time editing is turned on (a view's selection belongs to one). */
  id: string;
  pending: ReadonlyMap<string, OfficeEdit>;
  /** Records an edit; one that puts back what was there is dropped. */
  set: (edit: OfficeEdit) => void;
}
export const cellKey = (sheet: string, ref: string) => `c:${sheet}!${ref.toUpperCase()}`;
export const paraKey = (index: number) => `p:${index}`;
const editKey = (e: OfficeEdit) => (e.kind === 'cell' ? cellKey(e.sheet, e.ref) : paraKey(e.index));

/** Pure. The pending edits after one more: it keeps what the file first held
 *  (`from`), and an edit back to that is no edit. */
export function withEdit(pending: ReadonlyMap<string, OfficeEdit>, edit: OfficeEdit): Map<string, OfficeEdit> {
  const key = editKey(edit);
  const next = new Map(pending);
  const from = pending.get(key)?.from ?? edit.from;
  if (edit.to === from) next.delete(key);
  else next.set(key, { ...edit, from });
  return next;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const preserve = (t: Element) => t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parse = (text: string) => new DOMParser().parseFromString(text, 'application/xml');
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
const byLocal = (root: Document | Element, name: string) => Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
/** A new element in the same namespace and prefix as `like`. */
const make = (doc: Document, like: Element, name: string) => doc.createElementNS(like.namespaceURI, like.prefix ? `${like.prefix}:${name}` : name);

/** Pure. New texts for a paragraph's runs so that together they read `to`:
 *  the shared start and end keep their runs (and so their formatting), and
 *  what changed in between goes into the run where the change begins. */
function distributeText(pieces: string[], to: string): string[] {
  const old = pieces.join('');
  let p = 0;
  while (p < old.length && p < to.length && old[p] === to[p]) p++;
  let s = 0;
  while (s < old.length - p && s < to.length - p && old[old.length - 1 - s] === to[to.length - 1 - s]) s++;
  const mid = to.slice(p, to.length - s);
  const cutEnd = old.length - s;
  let offset = 0;
  let inserted = false;
  return pieces.map((t, i) => {
    let out = '';
    for (let k = 0; k < t.length; k++) {
      const pos = offset + k;
      if (!inserted && pos === p) { out += mid; inserted = true; }
      if (pos < p || pos >= cutEnd) out += t[k];
    }
    offset += t.length;
    // A pure insertion at a run's end extends that run (typing on); a
    // replacement goes where the replaced text began.
    if (!inserted && ((offset === p && cutEnd === p) || i === pieces.length - 1)) { out += mid; inserted = true; }
    return out;
  });
}

// ── Word ────────────────────────────────────────────────────────────────

/** A paragraph's own text elements (not those of a text box inside it). */
const ownTexts = (p: Element) => byLocal(p, 't').filter((t) => t.namespaceURI === W && closestPara(t) === p);
function closestPara(el: Element): Element | null {
  for (let e = el.parentElement; e; e = e.parentElement) if (e.localName === 'p' && e.namespaceURI === W) return e;
  return null;
}
const paraText = (p: Element) => ownTexts(p).map((t) => t.textContent ?? '').join('');

function setParaText(doc: Document, p: Element, to: string) {
  const texts = ownTexts(p);
  if (!texts.length) {
    if (!to) return;
    // An empty paragraph: one run, in the paragraph mark's look.
    const run = make(doc, p, 'r');
    const markRPr = byLocal(p, 'pPr')[0]?.getElementsByTagNameNS(W, 'rPr')[0];
    if (markRPr) run.appendChild(markRPr.cloneNode(true));
    const t = make(doc, p, 't');
    run.appendChild(t);
    p.appendChild(run);
    texts.push(t);
  }
  const next = distributeText(texts.map((t) => t.textContent ?? ''), to);
  texts.forEach((t, i) => {
    if (t.textContent === next[i]) return;
    t.textContent = next[i];
    preserve(t);
  });
}

function editWord(doc: Document, edits: ParaEdit[]) {
  const paras = Array.from(doc.getElementsByTagNameNS(W, 'p'));
  const conflicts: OfficeEdit[] = [];
  const skipped: OfficeEdit[] = [];
  for (const e of edits) {
    let p: Element | undefined = paras[e.index];
    if (!p || paraText(p) !== e.from) {
      // The paragraph moved (someone added or removed some before it): take
      // the nearest one that still reads what the edit found. If none does,
      // someone changed this one too — the edit still wins, and says so.
      const near = paras.map((q, i) => ({ q, d: Math.abs(i - e.index) })).filter(({ q }) => paraText(q) === e.from).sort((a, b) => a.d - b.d)[0];
      if (near) p = near.q;
      else if (!p) { skipped.push(e); continue; }
      else conflicts.push(e);
    }
    setParaText(doc, p, e.to);
  }
  return { conflicts, skipped };
}

// ── Excel ───────────────────────────────────────────────────────────────

const refParts = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
};
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** What a cell holds as text: its number, its string (shared or inline), or its last result. */
function cellRaw(c: Element | undefined, sst: string[]): string {
  if (!c) return '';
  const type = c.getAttribute('t');
  const v = byLocal(c, 'v')[0]?.textContent ?? '';
  if (type === 's') return sst[Number(v)] ?? '';
  if (type === 'inlineStr') return byLocal(c, 't').map((t) => t.textContent ?? '').join('');
  return v;
}
const sameValue = (a: string, b: string) => a === b || (NUMBER.test(a.trim()) && NUMBER.test(b.trim()) && Number(a) === Number(b));

function setCell(doc: Document, c: Element, to: string) {
  for (const child of Array.from(c.children)) if (['v', 'is', 'f'].includes(child.localName)) c.removeChild(child);
  c.removeAttribute('t');
  if (to === '') return;
  if (NUMBER.test(to.trim())) {
    const v = make(doc, c, 'v');
    v.textContent = String(Number(to.trim()));
    c.appendChild(v);
  } else {
    c.setAttribute('t', 'inlineStr');
    const is = make(doc, c, 'is');
    const t = make(doc, c, 't');
    t.textContent = to;
    if (to !== to.trim()) preserve(t);
    is.appendChild(t);
    c.appendChild(is);
  }
}

/** The row and cell for a reference, made (in order) when the sheet has none. */
function cellAt(doc: Document, sheetData: Element, ref: string): Element | null {
  const at = refParts(ref);
  if (!at) return null;
  const rows = Array.from(sheetData.children).filter((e) => e.localName === 'row');
  let row = rows.find((r) => Number(r.getAttribute('r')) === at.row);
  if (!row) {
    row = make(doc, sheetData, 'row');
    row.setAttribute('r', String(at.row));
    sheetData.insertBefore(row, rows.find((r) => Number(r.getAttribute('r')) > at.row) ?? null);
  }
  const cells = Array.from(row.children).filter((e) => e.localName === 'c');
  const upper = ref.toUpperCase();
  let c = cells.find((x) => (x.getAttribute('r') ?? '').toUpperCase() === upper);
  if (!c) {
    c = make(doc, row, 'c');
    c.setAttribute('r', upper);
    row.insertBefore(c, cells.find((x) => (refParts(x.getAttribute('r') ?? '')?.col ?? 0) > at.col) ?? null);
    // A row that lists its span must cover the new cell.
    const spans = row.getAttribute('spans');
    if (spans) {
      const [a, b] = spans.split(':').map(Number);
      row.setAttribute('spans', `${Math.min(a, at.col)}:${Math.max(b, at.col)}`);
    }
  }
  return c;
}

async function editExcel(zip: JSZip, edits: CellEdit[]) {
  const read = async (path: string) => { const f = zip.file(path); return f ? parse(await f.async('string')) : null; };
  const wb = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('Not a workbook');
  const targets = new Map(byLocal(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const sheetPath = new Map(byLocal(wb, 'sheet').map((s) => {
    const t = targets.get(s.getAttributeNS(R, 'id') ?? s.getAttribute('r:id')) ?? '';
    return [s.getAttribute('name') ?? '', t.startsWith('/') ? t.slice(1) : `xl/${t}`];
  }));
  const sstDoc = await read('xl/sharedStrings.xml');
  const sst = sstDoc ? byLocal(sstDoc, 'si').map((si) => byLocal(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join('')) : [];

  const conflicts: OfficeEdit[] = [];
  let removedFormula = false;
  const bySheet = new Map<string, CellEdit[]>();
  for (const e of edits) bySheet.set(e.sheet, [...(bySheet.get(e.sheet) ?? []), e]);
  for (const [name, list] of bySheet) {
    const path = sheetPath.get(name);
    const doc = path ? await read(path) : null;
    const sheetData = doc ? byLocal(doc, 'sheetData')[0] : null;
    if (!doc || !sheetData || !path) { conflicts.push(...list); continue; }
    for (const e of list) {
      const c = cellAt(doc, sheetData, e.ref);
      if (!c) continue;
      if (!sameValue(cellRaw(c, sst), e.from)) conflicts.push(e);
      if (byLocal(c, 'f').length) removedFormula = true;
      setCell(doc, c, e.to);
    }
    zip.file(path, serialize(doc));
  }
  // A formula overwritten by a value leaves the calculation chain naming a
  // cell that no longer calculates; Excel rebuilds the chain when it is gone.
  if (removedFormula && zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    for (const r of byLocal(rels, 'Relationship')) if ((r.getAttribute('Target') ?? '').endsWith('calcChain.xml')) r.parentNode?.removeChild(r);
    zip.file('xl/_rels/workbook.xml.rels', serialize(rels));
    const types = await read('[Content_Types].xml');
    if (types) {
      for (const o of byLocal(types, 'Override')) if ((o.getAttribute('PartName') ?? '').endsWith('calcChain.xml')) o.parentNode?.removeChild(o);
      zip.file('[Content_Types].xml', serialize(types));
    }
  }
  // Formulas that read an edited cell are worked out again when the file opens.
  const calcPr = byLocal(wb, 'calcPr')[0] ?? (() => { const el = make(wb, wb.documentElement, 'calcPr'); wb.documentElement.appendChild(el); return el; })();
  calcPr.setAttribute('fullCalcOnLoad', '1');
  zip.file('xl/workbook.xml', serialize(wb));
  return { conflicts, skipped: [] as OfficeEdit[] };
}

/** Applies edits to a .xlsx or .docx and returns the new file. */
export async function applyOfficeEdits(bytes: ArrayBuffer | Uint8Array, edits: OfficeEdit[]): Promise<EditResult> {
  const zip = await JSZip.loadAsync(bytes);
  let outcome: { conflicts: OfficeEdit[]; skipped: OfficeEdit[] };
  if (zip.file('xl/workbook.xml')) {
    outcome = await editExcel(zip, edits.filter((e): e is CellEdit => e.kind === 'cell'));
  } else if (zip.file('word/document.xml')) {
    const doc = parse(await zip.file('word/document.xml')!.async('string'));
    outcome = editWord(doc, edits.filter((e): e is ParaEdit => e.kind === 'para'));
    zip.file('word/document.xml', serialize(doc));
  } else throw new Error('Only workbooks and Word documents can be edited here.');
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), ...outcome };
}
