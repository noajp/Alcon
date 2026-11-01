import { readOffice, officeKindOf } from './officePreview';
import { readWorkbook } from './sheetLayout';
import { pdfToText } from './pdfText';

// What a stored file says, as plain text, for finding it by its words: the
// same deterministic readers as the preview (no service, no AI). Word's
// paragraphs, PowerPoint's slide lines, Excel's cells (row by row), a PDF's
// pages, and text, CSV, Markdown, JSON or a page's visible words —
// Unicode-normalized (NFKC), so look-alike characters match. Long files are
// cut at MAX_CHARS.

const MAX_CHARS = 300_000;
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'html', 'htm']);

/** The text of a file, or null when it holds none we can read (an image, a video…). */
export async function fileText(bytes: ArrayBuffer, name: string, mime: string | null): Promise<string | null> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const kind = officeKindOf(name);
  let text: string | null = null;
  if (kind === 'docx') {
    const read = await readOffice('docx', bytes);
    text = read.kind === 'docx' ? read.paragraphs.map((p) => p.text).join('\n') : null;
  } else if (kind === 'pptx') {
    const read = await readOffice('pptx', bytes);
    text = read.kind === 'pptx' ? read.slides.map((s) => s.lines.join('\n')).join('\n\n') : null;
  } else if (kind === 'xlsx') {
    const sheets = await readWorkbook(bytes);
    text = sheets.map((s) => [s.name, ...s.rows.map((r) => r.cells.map((c) => (c && !c.hidden ? c.text : '')).filter(Boolean).join('\t'))]
      .filter(Boolean).join('\n')).join('\n\n');
  } else if (ext === 'pdf' || mime === 'application/pdf') {
    text = (await pdfToText(bytes)).text;
  } else if (TEXT_EXT.has(ext) || mime?.startsWith('text/')) {
    const raw = new TextDecoder().decode(bytes);
    if (ext === 'html' || ext === 'htm' || mime === 'text/html') {
      const page = new DOMParser().parseFromString(raw, 'text/html');
      page.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
      text = page.body?.textContent ?? '';
    } else text = raw;
  }
  if (text === null) return null;
  // NFKC: a PDF often writes 自 as the radical ⾃, full-width letters as
  // ｆｕｌｌ; the query is normalized the same way (searchAttachments).
  return text.normalize('NFKC').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
}
