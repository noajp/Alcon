import { Schema, type DOMOutputSpec, type Node as PMNode } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { EMBED_LANGS } from '../editor/embedBlocks';

// The Note editor's document model. It reads and writes exactly the HTML the
// Notes and descriptions have always been saved as (htmlSanitizer's
// vocabulary), so nothing stored changes shape:
//   p / h1–h3 (data-align), blockquote, pre (data-lang), hr,
//   ul (data-checklist, data-style="dashed"), ol, li (data-checked,
//   data-element-id), table[data-note-table] with colgroup widths and
//   th/td colspan/rowspan/data-align, br; strong, em, u, s, code, a[href].
// ```clayware / ```mermaid blocks are code blocks whose language says so; the
// editor draws them (nodeViews).

const ALIGNS = new Set(['center', 'right']);
const alignOf = (dom: HTMLElement) => {
  const a = dom.getAttribute('data-align') ?? dom.style?.textAlign ?? '';
  return ALIGNS.has(a) ? a : null;
};
const withAlign = (attrs: Record<string, unknown>, align: unknown) =>
  (align ? { ...attrs, 'data-align': align as string } : attrs);

const SAFE_HREF = /^(https?:|mailto:)/i;

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block', content: 'inline*', attrs: { align: { default: null } },
      parseDOM: [{ tag: 'p', getAttrs: (d) => ({ align: alignOf(d as HTMLElement) }) },
        { tag: 'div', getAttrs: (d) => ({ align: alignOf(d as HTMLElement) }) }],
      toDOM: (n): DOMOutputSpec => ['p', withAlign({}, n.attrs.align), 0],
    },
    heading: {
      group: 'block', content: 'inline*', defining: true,
      attrs: { level: { default: 1 }, align: { default: null } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`, getAttrs: (d: HTMLElement) => ({ level: Math.min(3, level), align: alignOf(d) }),
      })),
      toDOM: (n): DOMOutputSpec => [`h${n.attrs.level}`, withAlign({}, n.attrs.align), 0],
    },
    blockquote: {
      group: 'block', content: 'block+', defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: (): DOMOutputSpec => ['blockquote', 0],
    },
    code_block: {
      group: 'block', content: 'text*', marks: '', code: true, defining: true,
      attrs: { lang: { default: null } },
      parseDOM: [{
        tag: 'pre', preserveWhitespace: 'full',
        getAttrs: (d) => {
          const lang = (d as HTMLElement).getAttribute('data-lang');
          return { lang: lang && /^[a-z0-9+#-]{1,20}$/.test(lang) ? lang : null };
        },
      }],
      toDOM: (n): DOMOutputSpec => ['pre', n.attrs.lang ? { 'data-lang': n.attrs.lang } : {}, 0],
    },
    horizontal_rule: {
      group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: (): DOMOutputSpec => ['hr'],
    },
    bullet_list: {
      group: 'block', content: 'list_item+',
      attrs: { checklist: { default: false }, dashed: { default: false } },
      parseDOM: [{ tag: 'ul', getAttrs: (d) => ({
        checklist: (d as HTMLElement).getAttribute('data-checklist') === 'true',
        dashed: (d as HTMLElement).getAttribute('data-style') === 'dashed',
      }) }],
      toDOM: (n): DOMOutputSpec => ['ul', {
        ...(n.attrs.checklist ? { 'data-checklist': 'true' } : {}),
        ...(n.attrs.dashed ? { 'data-style': 'dashed' } : {}),
      }, 0],
    },
    ordered_list: {
      group: 'block', content: 'list_item+',
      parseDOM: [{ tag: 'ol' }], toDOM: (): DOMOutputSpec => ['ol', 0],
    },
    list_item: {
      // An item's first line is text, then nested lists or more blocks.
      content: 'paragraph block*', defining: true,
      attrs: { checked: { default: null }, elementId: { default: null } },
      parseDOM: [{ tag: 'li', getAttrs: (d) => {
        const el = d as HTMLElement;
        const c = el.getAttribute('data-checked');
        return { checked: c === 'true' ? true : c === 'false' ? false : null, elementId: el.getAttribute('data-element-id') || null };
      } }],
      toDOM: (n): DOMOutputSpec => ['li', {
        ...(n.attrs.checked !== null ? { 'data-checked': String(n.attrs.checked) } : {}),
        ...(n.attrs.elementId ? { 'data-element-id': n.attrs.elementId } : {}),
      }, 0],
    },
    ...tableNodes({
      tableGroup: 'block',
      cellContent: 'block+',
      cellAttributes: {
        align: {
          default: null,
          getFromDOM: (d) => alignOf(d as HTMLElement),
          setDOMAttr: (v, attrs) => { if (v) attrs['data-align'] = v as string; },
        },
      },
    }),
    text: { group: 'inline' },
    hard_break: {
      inline: true, group: 'inline', selectable: false,
      parseDOM: [{ tag: 'br' }], toDOM: (): DOMOutputSpec => ['br'],
    },
  },
  marks: {
    link: {
      attrs: { href: {} }, inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (d) => {
        const href = (d as HTMLElement).getAttribute('href') ?? '';
        return SAFE_HREF.test(href.trim()) ? { href } : false;
      } }],
      toDOM: (m): DOMOutputSpec => ['a', { href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
    },
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d{2})$/.test(v as string) && null }],
      toDOM: (): DOMOutputSpec => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: (): DOMOutputSpec => ['em', 0],
    },
    underline: {
      parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
      toDOM: (): DOMOutputSpec => ['u', 0],
    },
    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'strike' }, { tag: 'del' }],
      toDOM: (): DOMOutputSpec => ['s', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }], toDOM: (): DOMOutputSpec => ['code', 0],
    },
  },
});

/** Tables carry the Note's marker so its styles apply. */
export const TABLE_ATTR = 'data-note-table';

/** Pure. Whether a code block is drawn rather than shown as code. */
export function isDrawnBlock(node: PMNode): boolean {
  const lang = node.attrs.lang as string | null;
  return node.type === schema.nodes.code_block && !!lang && (lang === 'mermaid' || (EMBED_LANGS as readonly string[]).includes(lang));
}
