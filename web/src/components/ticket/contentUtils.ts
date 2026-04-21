// Extract plain text from a ticket content string.
// Handles both:
//  - Plain string (legacy / fallback)
//  - BlockNote JSON (array of blocks) stringified
//
// Used for card previews where a block editor can't render.

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
  if (inline) {
    const checkMark = block.type === 'checkListItem'
      ? block.props?.checked ? '☑ ' : '☐ '
      : '';
    parts.push(checkMark + inline);
  }
  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const t = textFromBlock(child);
      if (t) parts.push(t);
    }
  }
  return parts.join(' ');
}

export function extractPlainText(content: string): string {
  if (!content) return '';
  // Try BlockNote JSON first
  if (content.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map(textFromBlock).filter(Boolean).join(' · ').trim();
      }
    } catch {
      // fall through
    }
  }
  return content;
}
