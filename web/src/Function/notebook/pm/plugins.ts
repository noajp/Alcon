import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands';
import { history, redo as pmRedo, undo as pmUndo } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { addRowAfter, columnResizing, goToNextCell, isInTable, tableEditing } from 'prosemirror-tables';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { toggleBold, toggleItalic, toggleStrike, toggleUnderline } from './commands';

// The behaviour of a Note: keys, Markdown-style shortcuts, the "/" menu's
// trigger, linked lines' live status and the placeholder.

const { paragraph, heading, blockquote, code_block, bullet_list, ordered_list, list_item } = schema.nodes;

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
      'Enter': chainCommands(leaveCodeOnEmptyLine, splitListItem(list_item)),
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

/** "# ", "- ", "1. ", "[] ", "> " and "```" turn a line into that block. */
export function shortcuts(): Plugin {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*>\s$/, blockquote),
      wrappingInputRule(/^\s*([-*])\s$/, bullet_list),
      wrappingInputRule(/^\s*\[\s?\]\s$/, bullet_list, { checklist: true }),
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

// ── Linked lines' live status ────────────────────────────────────────────

export const statusKey = new PluginKey<DecorationSet>('note-element-status');

/** Each line linked to an Element shows that Element's status (never saved). */
export function elementStatus(get: () => Record<string, string | null | undefined> | undefined): Plugin<DecorationSet> {
  const build = (doc: PMNode) => {
    const map = get() ?? {};
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type === list_item && node.attrs.elementId) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-element-status': map[node.attrs.elementId as string] ?? 'backlog' }));
      }
      return true;
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin<DecorationSet>({
    key: statusKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, prev) => (tr.docChanged || tr.getMeta(statusKey) ? build(tr.doc) : prev),
    },
    props: { decorations: (state) => statusKey.getState(state) },
  });
}

/** A code block drawn as a diagram or a live view shows its source while the
 *  caret is in it. */
export function drawnEditing(): Plugin {
  return new Plugin({
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
    },
  });
}

/** Tables: drag a column's edge to size it; select and edit cells. */
export const tablePlugins = () => [columnResizing({ cellMinWidth: 48 }), tableEditing()];

export const cursors = () => [dropCursor({ color: 'var(--accent-default)' }), gapCursor()];
