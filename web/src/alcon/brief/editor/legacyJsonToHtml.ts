// One-way converter: legacy structured-block JSON (the shape used by the
// previous block-based editor) → Apple Notes HTML.
// Used purely as a read-only migrator when a note's `html` column is null
// but the legacy `blocks` jsonb has content. New writes always go through
// the AppleNoteEditor and store HTML directly. No editor runtime is
// pulled in by this file.

interface BlockLike {
  type?: string;
  content?: unknown;
  children?: BlockLike[];
  props?: { checked?: boolean; level?: number; textAlignment?: string };
}
interface InlineLike {
  type?: string;
  text?: string;
  styles?: Record<string, unknown>;
  content?: InlineLike[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineToHtml(inlines: unknown): string {
  if (!Array.isArray(inlines)) return '';
  return (inlines as InlineLike[])
    .map((c) => {
      if (!c) return '';
      if (c.type === 'text' && typeof c.text === 'string') {
        let out = escapeHtml(c.text);
        const s = c.styles ?? {};
        if (s.code) out = `<code>${out}</code>`;
        if (s.strike) out = `<s>${out}</s>`;
        if (s.underline) out = `<u>${out}</u>`;
        if (s.italic) out = `<em>${out}</em>`;
        if (s.bold) out = `<strong>${out}</strong>`;
        return out;
      }
      if (c.type === 'link' && Array.isArray(c.content)) {
        return inlineToHtml(c.content);
      }
      return '';
    })
    .join('');
}

function alignAttr(props: BlockLike['props']): string {
  const a = props?.textAlignment;
  if (a === 'center' || a === 'right') return ` data-align="${a}"`;
  return '';
}

function blockToHtml(block: BlockLike): string {
  if (!block) return '';
  const align = alignAttr(block.props);

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(block.props?.level ?? 1, 1), 2);
      const tag = `h${level}`;
      return `<${tag}${align}>${inlineToHtml(block.content)}</${tag}>`;
    }
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem': {
      const inner = inlineToHtml(block.content);
      const children = (block.children ?? []).map(blockToHtml).join('');
      const checked = block.type === 'checkListItem' ? ` data-checked="${block.props?.checked ? 'true' : 'false'}"` : '';
      return `<li${checked}>${inner}${children}</li>`;
    }
    case 'quote':
      return `<blockquote${align}>${inlineToHtml(block.content)}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${inlineToHtml(block.content)}</code></pre>`;
    case 'paragraph':
    default:
      return `<p${align}>${inlineToHtml(block.content)}</p>`;
  }
}

// Group consecutive list items into <ul>/<ol> wrappers.
function groupBlocks(blocks: BlockLike[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const t = b?.type;
    if (t === 'bulletListItem' || t === 'numberedListItem' || t === 'checkListItem') {
      const groupType = t;
      const items: string[] = [];
      while (i < blocks.length && blocks[i]?.type === groupType) {
        items.push(blockToHtml(blocks[i]));
        i++;
      }
      const wrap =
        groupType === 'numberedListItem'
          ? '<ol>'
          : groupType === 'checkListItem'
            ? '<ul data-checklist="true">'
            : '<ul>';
      const close = groupType === 'numberedListItem' ? '</ol>' : '</ul>';
      out.push(`${wrap}${items.join('')}${close}`);
    } else {
      out.push(blockToHtml(b));
      i++;
    }
  }
  return out.join('');
}

export function legacyJsonToHtml(json: unknown): string {
  let blocks: BlockLike[] | null = null;
  if (Array.isArray(json)) blocks = json as BlockLike[];
  else if (typeof json === 'string') {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) blocks = parsed as BlockLike[];
    } catch {
      // not JSON → treat as raw text
      return `<p>${escapeHtml(json)}</p>`;
    }
  }
  if (!blocks) return '';
  return groupBlocks(blocks);
}
