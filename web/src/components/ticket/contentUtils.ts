// Helpers for extracting plain text / first-paragraph summaries from a
// BlockNote-serialized content string. Content is either:
//   - A BlockNote JSON array (new tickets)
//   - A plain string (legacy / empty)

interface BlockLike {
  type?: string;
  content?: InlineLike[] | unknown;
  children?: BlockLike[];
  props?: { checked?: boolean };
}
interface InlineLike {
  type?: string;
  text?: string;
  content?: InlineLike[];
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

function textFromBlock(block: BlockLike): string {
  const parts: string[] = [];
  const inline = textFromInline(block.content);
  if (inline) parts.push(inline);
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const t = textFromBlock(child);
      if (t) parts.push(t);
    }
  }
  return parts.join(' ');
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
