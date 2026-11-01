import JSZip from 'jszip';

// Reading Word and PowerPoint files in the browser for what they say — the
// fallback when a file's layout cannot be drawn (Excel always is: see
// sheetLayout). Each is a zip of XML: paragraphs (with heading levels) from
// a .docx, each slide's lines from a .pptx. Nothing leaves the page: no
// viewer service is handed the file. The XML is read with patterns, so this
// runs the same in the browser and under the tests.

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';

export interface DocParagraph { text: string; heading: number | null }
export interface Slide { lines: string[] }

export type OfficePreview =
  | { kind: 'docx'; paragraphs: DocParagraph[] }
  | { kind: 'pptx'; slides: Slide[] };

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

/** Pure. One .pptx slide's lines of text, in order. */
function pptxLines(slideXml: string): string[] {
  return [...slideXml.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g)]
    .map((m) => runsOf(m[0], 'a:t'))
    .filter((t) => t.trim());
}

const byNumber = (a: string, b: string) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0);

/** Reads an Office file's bytes into its preview. */
export async function readOffice(kind: 'docx' | 'pptx', bytes: ArrayBuffer): Promise<OfficePreview> {
  const zip = await JSZip.loadAsync(bytes);
  const text = (path: string) => zip.file(path)?.async('string') ?? Promise.resolve('');
  if (kind === 'docx') return { kind, paragraphs: docxParagraphs(await text('word/document.xml')) };
  const paths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort(byNumber);
  return { kind, slides: await Promise.all(paths.map(async (p) => ({ lines: pptxLines(await text(p)) }))) };
}
