import JSZip from 'jszip';

// Reading Word, Excel and PowerPoint files in the browser, for a preview of
// what they say — not how they look. Each is a zip of XML: paragraphs (with
// heading levels) from a .docx, sheets as rows of cells from a .xlsx, each
// slide's lines from a .pptx. Nothing leaves the page: no viewer service is
// handed the file. The XML is read with patterns, so this runs the same in
// the browser and under the tests.

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

export interface DocParagraph { text: string; heading: number | null }
export interface Sheet { name: string; rows: string[][] }
export interface Slide { lines: string[] }

export type OfficePreview =
  | { kind: 'docx'; paragraphs: DocParagraph[] }
  | { kind: 'xlsx'; sheets: Sheet[] }
  | { kind: 'pptx'; slides: Slide[] };

const MAX_ROWS = 500;
const MAX_COLS = 50;

export function officeKindOf(name: string): OfficeKind | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}

/** Pure. XML entities back to characters. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Pure. The text runs of one XML fragment (`<w:t>`, `<a:t>`, `<t>`), joined. */
function runsOf(xml: string, tag: 'w:t' | 'a:t' | 't'): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (const m of xml.matchAll(re)) out += unescapeXml(m[1]);
  return out;
}

/** Pure. A .docx body's paragraphs; Heading1… styles give the level. */
function docxParagraphs(documentXml: string): DocParagraph[] {
  const out: DocParagraph[] = [];
  for (const m of documentXml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const text = runsOf(p, 'w:t');
    const style = /<w:pStyle w:val="(?:Heading|heading|見出し)\s?(\d)"/.exec(p)?.[1];
    if (!text.trim() && !style) { if (out.length && out[out.length - 1].text) out.push({ text: '', heading: null }); continue; }
    out.push({ text, heading: style ? Number(style) : null });
  }
  return out;
}

/** Pure. Column letters of a cell reference ("C12" → 2). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Pure. One .xlsx worksheet as rows of cell text, using the shared strings. */
function xlsxRows(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of sheetXml.matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
    if (rows.length >= MAX_ROWS) break;
    const row: string[] = [];
    for (const cm of rm[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const col = columnIndex(/r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '');
      if (col >= MAX_COLS) continue;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const value = type === 's' ? shared[Number(v)] ?? ''
        : type === 'inlineStr' ? runsOf(body, 't')
        : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : v !== undefined ? unescapeXml(v) : '';
      while (row.length < col) row.push('');
      row[col] = value;
    }
    rows.push(row);
  }
  // Trailing empty rows say nothing.
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/** Pure. The shared strings of a .xlsx. */
function xlsxSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsOf(m[1], 't'));
}

/** Pure. One .pptx slide's lines of text, in order. */
function pptxLines(slideXml: string): string[] {
  return [...slideXml.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g)]
    .map((m) => runsOf(m[0], 'a:t'))
    .filter((t) => t.trim());
}

const byNumber = (a: string, b: string) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0);

/** Reads an Office file's bytes into its preview. */
export async function readOffice(kind: OfficeKind, bytes: ArrayBuffer): Promise<OfficePreview> {
  const zip = await JSZip.loadAsync(bytes);
  const text = (path: string) => zip.file(path)?.async('string') ?? Promise.resolve('');
  if (kind === 'docx') return { kind, paragraphs: docxParagraphs(await text('word/document.xml')) };
  if (kind === 'xlsx') {
    const shared = xlsxSharedStrings(await text('xl/sharedStrings.xml'));
    const workbook = await text('xl/workbook.xml');
    const names = [...workbook.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
    const paths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort(byNumber);
    const sheets = await Promise.all(paths.map(async (p, i) => ({ name: names[i] ?? `Sheet${i + 1}`, rows: xlsxRows(await text(p), shared) })));
    return { kind, sheets };
  }
  const paths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort(byNumber);
  return { kind, slides: await Promise.all(paths.map(async (p) => ({ lines: pptxLines(await text(p)) }))) };
}
