// Helpers for extracting plain text / first-paragraph summaries from a
// BlockNote-serialized content string. Content is either:
//   - A BlockNote JSON array (new tickets)
//   - A plain string (legacy / empty)

interface BlockLike {
  type?: string;
  content?: InlineLike[] | TableContent | unknown;
  children?: BlockLike[];
  props?: { checked?: boolean; level?: number };
}
interface InlineLike {
  type?: string;
  text?: string;
  content?: InlineLike[];
}
interface TableCell {
  type?: string;
  content?: InlineLike[];
}
interface TableRow {
  cells?: Array<InlineLike[] | TableCell>;
}
interface TableContent {
  type?: string;
  rows?: TableRow[];
}

function textFromInline(inlines: unknown): string {
  if (!Array.isArray(inlines)) return '';
  return (inlines as InlineLike[])
    .map((c) => {
      if (!c) return '';
      if (c.type === 'text' && typeof c.text === 'string') return c.text;
      if (Array.isArray(c.content)) return textFromInline(c.content);
      return '';
    })
    .join('');
}

function textFromTableCell(cell: InlineLike[] | TableCell | undefined): string {
  if (!cell) return '';
  if (Array.isArray(cell)) return textFromInline(cell);
  if (Array.isArray(cell.content)) return textFromInline(cell.content);
  return '';
}

function isTableContent(value: unknown): value is TableContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as TableContent).rows)
  );
}

function tableToMarkdown(table: TableContent): string {
  const rows = (table.rows ?? []).map((row) =>
    (row.cells ?? []).map((cell) => textFromTableCell(cell).replace(/\|/g, '\\|').trim())
  );
  if (rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];
  rows.forEach((cells, idx) => {
    const padded = [...cells];
    while (padded.length < colCount) padded.push('');
    lines.push(`| ${padded.join(' | ')} |`);
    if (idx === 0) {
      lines.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
    }
  });
  return lines.join('\n');
}

function headingPrefix(level: number | undefined): string {
  const n = Math.min(Math.max(level ?? 1, 1), 6);
  return '#'.repeat(n) + ' ';
}

function listMarker(type: string | undefined, props: BlockLike['props']): string {
  if (type === 'bulletListItem') return '- ';
  if (type === 'numberedListItem') return '1. ';
  if (type === 'checkListItem') return props?.checked ? '- [x] ' : '- [ ] ';
  return '';
}

function textFromBlock(block: BlockLike): string {
  if (!block) return '';
  if (block.type === 'table' && isTableContent(block.content)) {
    return tableToMarkdown(block.content);
  }
  const parts: string[] = [];
  const inline = textFromInline(block.content);
  if (inline) {
    if (block.type === 'heading') {
      parts.push(headingPrefix(block.props?.level) + inline);
    } else {
      const marker = listMarker(block.type, block.props);
      parts.push(marker + inline);
    }
  }
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const t = textFromBlock(child);
      if (t) parts.push(t);
    }
  }
  return parts.join('\n');
}

function parseBlocks(content: string): BlockLike[] | null {
  if (!content || !content.trim().startsWith('[')) return null;
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as BlockLike[]) : null;
  } catch {
    return null;
  }
}

export function extractPlainText(content: string): string {
  const blocks = parseBlocks(content);
  if (!blocks) return content ?? '';
  return blocks.map(textFromBlock).filter(Boolean).join('\n').trim();
}

// Pick a sensible default summary for Ticketize: the first meaningful
// line of text from the note.
export function extractFirstParagraph(content: string): string {
  const blocks = parseBlocks(content);
  if (!blocks) return (content ?? '').split('\n').find((l) => l.trim()) ?? '';
  for (const b of blocks) {
    const t = textFromBlock(b).trim();
    if (t) return t;
  }
  return '';
}
