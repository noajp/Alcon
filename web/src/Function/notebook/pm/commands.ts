import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { Fragment, type Node as PMNode, type NodeType } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { schema } from './schema';

// What the toolbar, the "/" menu and the keyboard do to a Note, as
// ProseMirror commands.

export type BlockTag = 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE';
export type ListKind = 'bullet' | 'dashed' | 'numbered' | 'check';
export type Align = 'left' | 'center' | 'right';

const { paragraph, heading, blockquote, code_block, bullet_list, ordered_list, list_item, table, table_row, table_header, table_cell } = schema.nodes;

/** The innermost ancestor of the selection of one of `types`, with its depth. */
function ancestor(state: EditorState, types: NodeType[]): { node: PMNode; depth: number; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (types.includes(node.type)) return { node, depth: d, pos: $from.before(d) };
  }
  return null;
}

/** Pure. The block style the selection stands in. */
function currentBlock(state: EditorState): BlockTag | null {
  if (ancestor(state, [blockquote])) return 'BLOCKQUOTE';
  const parent = state.selection.$from.parent;
  if (parent.type === heading) return `H${parent.attrs.level}` as BlockTag;
  if (parent.type === code_block) return 'PRE';
  if (parent.type === paragraph) return 'P';
  return null;
}

/** Makes the selected blocks `tag`; the same tag again turns them back to text. */
export function toggleBlock(tag: BlockTag): Command {
  return (state, dispatch) => {
    const current = currentBlock(state);
    if (tag === 'BLOCKQUOTE') return current === 'BLOCKQUOTE' ? lift(state, dispatch) : wrapIn(blockquote)(state, dispatch);
    const target = current === tag ? 'P' : tag;
    if (target === 'P') return setBlockType(paragraph)(state, dispatch);
    if (target === 'PRE') return setBlockType(code_block)(state, dispatch);
    return setBlockType(heading, { level: Number(target.slice(1)) })(state, dispatch);
  };
}

/** Sets the selected blocks to `tag` (not a toggle — the "/" menu and the handle). */
export function setBlock(tag: BlockTag): Command {
  return (state, dispatch) => {
    if (tag === 'BLOCKQUOTE') return currentBlock(state) === 'BLOCKQUOTE' || wrapIn(blockquote)(state, dispatch);
    if (tag === 'P') return setBlockType(paragraph)(state, dispatch);
    if (tag === 'PRE') return setBlockType(code_block)(state, dispatch);
    return setBlockType(heading, { level: Number(tag.slice(1)) })(state, dispatch);
  };
}

function listAttrs(kind: ListKind) {
  return kind === 'numbered' ? null : { checklist: kind === 'check', dashed: kind === 'dashed' };
}

function kindOf(list: PMNode): ListKind {
  if (list.type === ordered_list) return 'numbered';
  if (list.attrs.checklist) return 'check';
  return list.attrs.dashed ? 'dashed' : 'bullet';
}

/** Turns the selection into a list of `kind`; inside one already of that kind
 *  it lifts the items out, inside one of another kind it changes the list. */
export function toggleList(kind: ListKind): Command {
  return (state, dispatch) => {
    const list = ancestor(state, [bullet_list, ordered_list]);
    const type = kind === 'numbered' ? ordered_list : bullet_list;
    if (list && kindOf(list.node) === kind) return liftListItem(list_item)(state, dispatch);
    if (list) {
      if (dispatch) {
        const tr = state.tr.setNodeMarkup(list.pos, type, listAttrs(kind));
        if (kind === 'check') markItemsUnchecked(tr, list.pos);
        dispatch(tr);
      }
      return true;
    }
    if (!dispatch) return wrapInList(type, listAttrs(kind))(state);
    return wrapInList(type, listAttrs(kind))(state, (tr) => {
      if (kind === 'check') {
        const found = ancestorIn(tr, [bullet_list]);
        if (found !== null) markItemsUnchecked(tr, found);
      }
      dispatch(tr);
    });
  };
}

function ancestorIn(tr: Transaction, types: NodeType[]): number | null {
  const $from = tr.selection.$from;
  for (let d = $from.depth; d > 0; d--) if (types.includes($from.node(d).type)) return $from.before(d);
  return null;
}

/** A checklist's items start unchecked (their box shows), unless linked. */
function markItemsUnchecked(tr: Transaction, listPos: number) {
  const list = tr.doc.nodeAt(listPos);
  if (!list) return;
  list.forEach((item, offset) => {
    if (item.attrs.checked === null && !item.attrs.elementId) {
      tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, checked: false });
    }
  });
}

/** Aligns the selected text blocks. */
export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    let changed = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === paragraph || node.type === heading) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: align === 'left' ? null : align });
        changed = true;
        return false;
      }
      return true;
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  };
}

export const toggleBold = toggleMark(schema.marks.strong);
export const toggleItalic = toggleMark(schema.marks.em);
export const toggleUnderline = toggleMark(schema.marks.underline);
export const toggleStrike = toggleMark(schema.marks.strike);

/** Links the selected text to `href`; no href removes the link. */
export function setLink(href: string | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    const mark = schema.marks.link;
    if (!href) {
      if (dispatch) dispatch(state.tr.removeMark(from, to, mark));
      return true;
    }
    if (dispatch) {
      if (empty) {
        dispatch(state.tr.insert(from, schema.text(href, [mark.create({ href })])));
      } else {
        dispatch(state.tr.addMark(from, to, mark.create({ href })));
      }
    }
    return true;
  };
}

/** A table of `rows` × `cols`, its first row headers. */
export function createTable(rows: number, cols: number): PMNode {
  const cell = (type: NodeType) => type.createAndFill()!;
  const row = (type: NodeType) => table_row.create(null, Fragment.from(Array.from({ length: cols }, () => cell(type))));
  return table.create(null, Fragment.from([row(table_header), ...Array.from({ length: Math.max(0, rows - 1) }, () => row(table_cell))]));
}

/** Puts `node` where the caret is: in place of an empty line, else after the
 *  current block; the caret moves to the text block after it. */
export function placeBlock(node: PMNode): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { $from } = state.selection;
    const block = $from.depth > 0 ? $from.before(1) : 0;
    const top = state.doc.nodeAt(block);
    const emptyLine = !!top && top.isTextblock && top.content.size === 0;
    const tr = state.tr;
    let at: number;
    if (emptyLine && top) {
      tr.replaceWith(block, block + top.nodeSize, node);
      at = block + node.nodeSize;
    } else {
      at = top ? block + top.nodeSize : state.doc.content.size;
      tr.insert(at, node);
      at += node.nodeSize;
    }
    if (at >= tr.doc.content.size || !tr.doc.nodeAt(at)?.isTextblock) tr.insert(at, paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Toggles the box of an unlinked checklist item at `pos`. */
export function toggleChecked(pos: number): Command {
  return (state, dispatch) => {
    const item = state.doc.nodeAt(pos);
    if (!item || item.type !== list_item || item.attrs.elementId) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: !item.attrs.checked }));
    return true;
  };
}

/** Links list items (by position) to the Elements made from them. */
export function linkItems(entries: { pos: number; elementId: string }[]): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    for (const { pos, elementId } of entries) {
      const item = tr.doc.nodeAt(pos);
      if (item?.type === list_item) tr.setNodeMarkup(pos, undefined, { ...item.attrs, elementId, checked: null });
    }
    if (dispatch && tr.docChanged) dispatch(tr);
    return tr.docChanged;
  };
}

