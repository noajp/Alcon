import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode, newlineInCode } from 'prosemirror-commands';
import { history, redo as pmRedo, undo as pmUndo } from 'prosemirror-history';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { canJoin, findWrapping } from 'prosemirror-transform';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { addRowAfter, columnResizing, goToNextCell, isInTable, tableEditing } from 'prosemirror-tables';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { schema } from './schema';
import { EMBED_LANGS } from '../editor/embedBlocks';
import { toggleBold, toggleItalic, toggleStrike, toggleUnderline } from './commands';

// The behaviour of a Note: keys, Markdown-style shortcuts and the "/" menu's
// trigger.

const { paragraph, heading, blockquote, code_block, bullet_list, ordered_list, list_item, hard_break } = schema.nodes;

/** Enter on an empty last line of a code block leaves it (two Enters close it). */
const leaveCodeOnEmptyLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== code_block) return false;
  const text = $from.parent.textContent;
  if (!text.endsWith('\n') || $from.parentOffset !== text.length) return false;
  if (dispatch) {
    const tr = state.tr.delete($from.pos - 1, $from.pos);
    const after = $from.after() - 1;
    tr.insert(after, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Enter in a list starts a new item. The new item is its own: it is not
 *  checked, and not the Element the line above was made into. */
const splitItem: Command = (state, dispatch) => splitListItem(list_item)(state, dispatch && ((tr) => {
  const $pos = tr.selection.$from;
  for (let d = $pos.depth; d > 0; d--) {
    const item = $pos.node(d);
    if (item.type !== list_item) continue;
    const checked = $pos.node(d - 1).attrs.checklist ? false : null;
    if (item.attrs.elementId !== null || item.attrs.checked !== checked) {
      tr.setNodeMarkup($pos.before(d), undefined, { ...item.attrs, checked, elementId: null });
    }
    break;
  }
  dispatch(tr);
}));

/** Shift-Enter breaks the line without starting a new block. */
const breakLine: Command = (state, dispatch) => {
  if (!state.selection.$from.parent.inlineContent) return false;
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
};

/** Tab in a table's last cell adds a row and moves into it. */
const nextCellOrNewRow: Command = (state, dispatch, view) => {
  if (goToNextCell(1)(state, dispatch)) return true;
  if (!isInTable(state)) return false;
  if (!dispatch || !view) return true;
  addRowAfter(state, dispatch);
  goToNextCell(1)(view.state, view.dispatch);
  return true;
};

/** The keys. `undo` / `redo` come from history alone or from the shared
 *  document; text kept as Markdown has no underline. */
export function noteKeymap(undo: Command, redo: Command, { underline = true } = {}): Plugin[] {
  return [
    keymap({
      'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo,
      'Mod-b': toggleBold, 'Mod-i': toggleItalic, 'Mod-u': underline ? toggleUnderline : () => true, 'Mod-Shift-x': toggleStrike,
      'Enter': chainCommands(leaveCodeOnEmptyLine, splitItem),
      'Shift-Enter': chainCommands(newlineInCode, breakLine),
      'Mod-Enter': exitCode,
      'Tab': chainCommands(nextCellOrNewRow, sinkListItem(list_item), () => true),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(list_item), () => true),
    }),
    keymap(baseKeymap),
  ];
}

/** History for a Note edited alone; the shared document brings its own. */
export const localHistory = () => [history()];
export { pmUndo, pmRedo };

/** "[] " makes the line a checklist line, unchecked, carrying on a checklist
 *  just above it. */
const checklistRule = new InputRule(/^\s*\[\s?\]\s$/, (state, _match, start, end) => {
  const tr = state.tr.delete(start, end);
  const range = tr.doc.resolve(start).blockRange();
  const wrapping = range && findWrapping(range, bullet_list, { checklist: true });
  if (!range || !wrapping) return null;
  tr.wrap(range, wrapping.map((w) => (w.type === list_item ? { type: w.type, attrs: { ...w.attrs, checked: false } } : w)));
  const above = tr.doc.resolve(start - 1).nodeBefore;
  if (above && above.type === bullet_list && above.attrs.checklist && canJoin(tr.doc, start - 1)) tr.join(start - 1);
  return tr;
});

/** "# ", "- ", "1. ", "[] ", "> " and "```" turn a line into that block. */
export function shortcuts(): Plugin {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, blockquote),
      // A new list joins the one above only when it is the same kind of list.
      wrappingInputRule(/^\s*([-*])\s$/, bullet_list, null, (_m, above) => !above.attrs.checklist && !above.attrs.dashed),
      checklistRule,
      wrappingInputRule(/^(\d+)\.\s$/, ordered_list),
      textblockTypeInputRule(/^```$/, code_block),
    ],
  });
}

// ── "/" ──────────────────────────────────────────────────────────────────

export interface SlashState { pos: number; query: string }
export const slashKey = new PluginKey<SlashState | null>('note-slash');

/** "/" typed at the start of an empty line opens the menu; what follows it is
 *  the query; leaving the line, or a space with nothing typed, closes it. */
export function slashTrigger(onKey: (key: string) => boolean): Plugin<SlashState | null> {
  return new Plugin<SlashState | null>({
    key: slashKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(slashKey) as SlashState | null | undefined;
        if (meta !== undefined) return meta;
        if (!prev) return null;
        const $pos = state.selection.$from;
        const start = tr.mapping.map(prev.pos);
        const text = $pos.parent.textBetween(0, $pos.parent.content.size, '\n');
        if (!state.selection.empty || $pos.start() !== start || !text.startsWith('/')) return null;
        const query = text.slice(1, $pos.parentOffset);
        if (/\s/.test(query) && !query.trim()) return null;
        return { pos: start, query };
      },
    },
    props: {
      handleTextInput(view, from, _to, text) {
        if (text !== '/') return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock || $from.parent.content.size !== 0 || $from.parent.type === code_block) return false;
        const tr = view.state.tr.insertText('/', from).setMeta(slashKey, { pos: $from.start(), query: '' });
        view.dispatch(tr);
        return true;
      },
      handleKeyDown(view, event) {
        if (!slashKey.getState(view.state)) return false;
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) return onKey(event.key);
        return false;
      },
    },
  });
}

/** Clears the "/" and its query from the line the menu was opened on. */
export function clearSlash(view: EditorView): void {
  const s = slashKey.getState(view.state);
  if (!s) return;
  const $pos = view.state.doc.resolve(s.pos);
  const end = s.pos + $pos.parent.content.size;
  view.dispatch(view.state.tr.delete(s.pos, end).setMeta(slashKey, null));
}

/** A code block drawn as a diagram or a live view shows its source while the
 *  caret is in it. */
export function drawnEditing(isLine: (source: string) => boolean = () => false): Plugin {
  return new Plugin({
    // A line's source is never shown, so the caret must never be in it: what
    // was typed there would go into the source unseen and break the line.
    // The caret that lands in one goes on to the text beyond it — back the
    // way it came from below, onward otherwise — and a line with nothing
    // after it gets an empty paragraph to write in.
    appendTransaction(_trs, before, state) {
      const { $from } = state.selection;
      if ($from.depth < 1 || $from.parent.type !== code_block) return null;
      if (!(EMBED_LANGS as readonly string[]).includes($from.parent.attrs.lang as string) || !isLine($from.parent.textContent)) return null;
      const start = $from.before($from.depth);
      const end = start + $from.parent.nodeSize;
      const tr = state.tr;
      const cameFromBelow = before.selection.from >= end;
      if (cameFromBelow && start > 0) {
        const up = Selection.findFrom(tr.doc.resolve(start), -1, true);
        if (up && up.from < start) return tr.setSelection(up);
      }
      if (end >= tr.doc.content.size) tr.insert(end, paragraph.create());
      const down = Selection.findFrom(tr.doc.resolve(end), 1, true);
      return down ? tr.setSelection(down) : null;
    },
    props: {
      decorations(state: EditorState) {
        const $from = state.selection.$from;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type === code_block && d > 0) {
            const pos = $from.before(d);
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'is-editing' }, { editing: true })]);
          }
        }
        return null;
      },
      // Backspace at the start of the line after a live view would join that
      // line's text onto the view's source and break it. It picks the view
      // up instead (an empty line goes); the next Backspace removes it.
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        if (event.key !== 'Backspace' || event.isComposing) return false;
        const { selection, doc } = view.state;
        const { $from } = selection;
        if (!selection.empty || $from.parentOffset !== 0 || $from.depth < 1) return false;
        const start = $from.before($from.depth);
        const before = doc.resolve(start).nodeBefore;
        if (!before || before.type !== code_block || !(EMBED_LANGS as readonly string[]).includes(before.attrs.lang as string)) return false;
        const at = start - before.nodeSize;
        let tr = view.state.tr;
        if ($from.parent.content.size === 0 && $from.after($from.depth) < doc.content.size) tr = tr.delete(start, $from.after($from.depth));
        view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
        return true;
      },
    },
  });
}

/** Tables: drag a column's edge to size it; select and edit cells. */
export const tablePlugins = () => [columnResizing({ cellMinWidth: 48 }), tableEditing()];

export const cursors = () => [dropCursor({ color: 'var(--accent-default)' }), gapCursor()];
