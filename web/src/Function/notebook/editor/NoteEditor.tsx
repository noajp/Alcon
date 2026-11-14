'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState, TextSelection, type Command, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import {
  CellSelection, TableMap, addColumn, addRow, deleteColumn, deleteRow, deleteTable,
  mergeCells, moveTableColumn, moveTableRow, selectedRect, splitCell,
} from 'prosemirror-tables';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undo as yUndo, redo as yRedo } from 'y-prosemirror';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, List, ListOrdered,
  Quote, Link as LinkIcon, Table as TableIcon, Minus, Paperclip, FileText,
} from '@/ui/icons';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { EMBED_LANG, embedSource, useEmbedHost, type EmbedSpec } from './embedBlocks';
import { ArtifactPicker, FILE_VIEW } from './fileBlocks';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { uploadToArtifacts } from '@/hooks/artifactData';
import { openNoteCollab, type NoteCollab } from '@/hooks/noteCollab';
import { usePresenceName } from '@/hooks/usePresence';
import { formatError } from '@/Function/shared/formatError';
import { openInApp } from '@/Function/shared/appNavigation';
import { schema } from '../pm/schema';
import { docToHtml, htmlToDoc, isEmptyDoc } from '../pm/html';
import { FRAGMENT, hashText, seedFromHtml } from '../pm/collab';
import {
  createTable, linkItems, placeBlock, setAlign, setBlock, setLink, toggleBlock, toggleChecked, toggleList,
  toggleBold, toggleItalic, toggleStrike, toggleUnderline, type BlockTag, type ListKind,
} from '../pm/commands';
import {
  clearSlash, cursors, drawnEditing, elementStatus, localHistory, noteKeymap, pmRedo, pmUndo,
  shortcuts, slashKey, slashTrigger, statusKey, tablePlugins,
} from '../pm/plugins';
import { DrawnBlocks, DrawnRegistry, drawnNodeView } from '../pm/drawn';
import {
  FloatingToolbar, SlashMenu, TableContextMenu, TableInsertHandles, filterSlash, handlesKey, measureTableHandles,
  type Mark, type SlashItem, type TableAction, type TableHandles,
} from '../pm/NoteMenus';
import { NoteEditorStyles } from '../pm/NoteEditorStyles';

export interface NoteEditorProps {
  initialHtml?: string;
  /** Shared body. A body changed elsewhere (saved by someone, merged) is
   *  brought in without moving the caret. */
  value?: string;
  onChange?: (html: string) => void;
  /** A one-click edit that can land while the editor is not focused (a
   *  checklist box), so no blur follows to save it: called right after its
   *  onChange, for a host that saves on blur to save now. */
  onCommit?: (html: string) => void;
  editable?: boolean;
  /** Called when the user right-clicks on a list item (bullet/check). */
  onBulletContextMenu?: (info: BulletContextInfo) => void;
  /** id → status for every Element. Lines linked to an Element show its status. */
  elementStatusById?: Record<string, string | null | undefined>;
  /** A short body inside another page (an Element's description): no
   *  page-tall minimum, the page's text size, smaller headings. Its text is
   *  kept as Markdown, so it offers no underline or alignment. */
  compact?: boolean;
  /** What an empty body says. */
  placeholder?: string;
  /** The Note this body is, to edit it together with whoever else has it
   *  open: everyone's typing shows as it happens, with their cursors. */
  collab?: string;
}

export interface BulletContextInfo {
  /** Plain text of the targeted line. */
  text: string;
  /** All list items currently selected (or [target] when nothing is selected). */
  texts: string[];
  /** Source <li> nodes, parallel to `texts` — used to link them back after → Element 化. */
  liNodes: HTMLLIElement[];
  /** Screen position to anchor a popover. */
  x: number;
  y: number;
}

/** Imperative handle so the page around the editor can drive it. */
export interface NoteEditorHandle {
  applyBlock(tag: BlockTag): void;
  applyList(kind: ListKind): void;
  insertTable(rows?: number, cols?: number): void;
  focus(): void;
  /** Links lines just turned into Elements to them, then saves. */
  linkBullets(entries: { li: HTMLLIElement; elementId: string }[]): void;
}

const TOOLBAR_GAP = 8;
/** How far in from a linked line's edges its mark and arrow answer a click. */
const LINKED_EDGE_PX = 30;
/** How far from a checklist item's left edge a click lands on its box. */
const CHECK_BOX_HIT_PX = 20;
/** A change brought in from the saved body, not typed here. */
const EXTERNAL = 'note-external';
const CURSOR_COLORS = 6;

const { list_item, code_block, horizontal_rule, table: tableType, heading: headingType, blockquote: quoteType } = schema.nodes;

/** The list item `li` stands for, and where it starts. */
function itemAt(view: EditorView, li: Element): { node: PMNode; pos: number } | null {
  if (!li.isConnected || !view.dom.contains(li)) return null;
  const $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type === list_item) return { node: $pos.node(d), pos: $pos.before(d) };
  }
  return null;
}

/** Whether a list item is a line of plain text (no heading, quote or code in it). */
function isPlainLine(item: PMNode): boolean {
  let plain = true;
  item.forEach((c) => { if (c.type === headingType || c.type === quoteType || c.type === code_block) plain = false; });
  return plain;
}

/** The cell `cell` stands for: where it starts. */
function cellAt(view: EditorView, cell: Element): number | null {
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') return $pos.before(d);
  }
  return null;
}

/** The table `el` draws, as the table commands want it. */
function tableAt(view: EditorView, el: HTMLTableElement) {
  const cell = el.querySelector('td, th');
  if (!cell) return null;
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type === tableType) {
      return { map: TableMap.get(node), tableStart: $pos.start(d), table: node, left: 0, top: 0, right: 0, bottom: 0 };
    }
  }
  return null;
}

/** Brings `next` into the editor, replacing only the top-level blocks that
 *  differ, so the caret stays where it was in the rest. */
function replaceDoc(view: EditorView, next: PMNode): Transaction | null {
  const current = view.state.doc;
  if (current.eq(next)) return null;
  const a = current.childCount, b = next.childCount;
  let head = 0;
  while (head < a && head < b && current.child(head).eq(next.child(head))) head++;
  let tail = 0;
  while (tail < a - head && tail < b - head && current.child(a - 1 - tail).eq(next.child(b - 1 - tail))) tail++;
  let from = 0;
  for (let i = 0; i < head; i++) from += current.child(i).nodeSize;
  let to = from;
  for (let i = head; i < a - tail; i++) to += current.child(i).nodeSize;
  const blocks: PMNode[] = [];
  for (let i = head; i < b - tail; i++) blocks.push(next.child(i));
  return view.state.tr.replaceWith(from, to, blocks);
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor({
  initialHtml,
  value,
  onChange,
  onCommit,
  editable = true,
  onBulletContextMenu,
  elementStatusById,
  compact = false,
  placeholder,
  collab,
}, handleRef) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sessionRef = useRef<NoteCollab | null>(null);
  const registry = useMemo(() => new DrawnRegistry(), []);
  const [ready, setReady] = useState(false);

  // The latest props, for the editor's handlers made once.
  const valueRef = useRef(value ?? initialHtml ?? '');
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const bulletRef = useRef(onBulletContextMenu);
  const statusRef = useRef(elementStatusById);
  const editableRef = useRef(editable);
  const placeholderRef = useRef(placeholder ?? t('Start writing…'));
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  bulletRef.current = onBulletContextMenu;
  placeholderRef.current = placeholder ?? t('Start writing…');

  /** The body as last saved from here (or brought in): what is not new. */
  const lastEmittedRef = useRef('');
  /** Set once the editor shows its first body; before that nothing saves. */
  const initializedRef = useRef(false);
  /** A body that came in while a word was being composed. */
  const pendingRef = useRef<string | null>(null);

  const spaceId = useActiveSpaceId();
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const embedHost = useEmbedHost();
  const me = usePresenceName(!!collab && editable);

  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  const [slash, setSlash] = useState<{ x: number; y: number; query: string } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number; canMerge: boolean; canSplit: boolean } | null>(null);
  const [handles, setHandles] = useState<TableHandles | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // With others editing, the one who joined first saves the shared body for
  // everyone, so their saves never cross; when they leave the next one does.
  const isSaver = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return true;
    const ids = [...session.awareness.getStates().keys()];
    return !ids.length || Math.min(...ids) === session.doc.clientID;
  }, []);

  const emit = useCallback((doc: PMNode) => {
    const html = docToHtml(doc);
    if (html === lastEmittedRef.current) return;
    lastEmittedRef.current = html;
    onChangeRef.current?.(html);
  }, []);

  // The toolbar over selected text, and the "/" menu, follow the editor.
  const syncUi = useCallback((view: EditorView) => {
    const s = slashKey.getState(view.state);
    if (s) {
      const c = view.coordsAtPos(s.pos);
      setSlash((prev) => (prev && prev.x === c.left && prev.y === c.bottom + 4 && prev.query === s.query ? prev : { x: c.left, y: c.bottom + 4, query: s.query }));
    } else {
      setSlash(null);
      setSlashIndex(0);
    }
    // While a word is being composed (Japanese input) the text being
    // converted reads as a selection; the toolbar is for text the person chose.
    const { selection } = view.state;
    if (!editableRef.current || view.composing || selection.empty || selection instanceof CellSelection || !view.hasFocus()) {
      setToolbar(null);
      return;
    }
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range && view.dom.contains(range.commonAncestorContainer) ? range.getBoundingClientRect() : null;
    if (!rect || (rect.width === 0 && rect.height === 0)) { setToolbar(null); return; }
    setToolbar({ x: rect.left + rect.width / 2, y: rect.top - TOOLBAR_GAP });
  }, []);

  const bringIn = useCallback((view: EditorView, html: string) => {
    if (html === lastEmittedRef.current || !isSaver()) return;
    if (view.composing) { pendingRef.current = html; return; }
    const tr = replaceDoc(view, htmlToDoc(html));
    if (tr) view.dispatch(tr.setMeta(EXTERNAL, true).setMeta('addToHistory', false));
    lastEmittedRef.current = html;
  }, [isSaver]);

  const run = useCallback((cmd: Command) => {
    const view = viewRef.current;
    if (!view) return;
    cmd(view.state, view.dispatch, view);
    view.focus();
  }, []);

  const insertEmbed = useCallback((spec: EmbedSpec) => {
    run(placeBlock(code_block.create({ lang: EMBED_LANG }, schema.text(embedSource(spec)))));
  }, [run]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const space = spaceIdRef.current;
    if (!space || !files.length) return;
    try {
      for (const file of files) {
        const saved = await uploadToArtifacts(space, file);
        insertEmbed({ view: FILE_VIEW, id: saved.id });
      }
    } catch (err) {
      await appDialog.alert(formatError(err));
    }
  }, [insertEmbed]);

  // "/" keys, routed from the editor while the menu is open.
  const slashKeyRef = useRef<(key: string) => boolean>(() => false);

  // ── The editor ──────────────────────────────────────────────────────────
  const collabId = collab && editable ? collab : null;
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let view: EditorView | null = null;
    let session: NoteCollab | null = null;
    let cancelled = false;
    initializedRef.current = false;

    const handleDOMEvents: NonNullable<ConstructorParameters<typeof EditorView>[1]>['handleDOMEvents'] = {
      mousedown(v, event) {
        if (event.button !== 0) return false;
        const target = event.target as HTMLElement;
        const li = target.tagName === 'UL' || target.tagName === 'OL' ? null : target.closest('li');
        if (!li || !v.dom.contains(li) || li.parentElement?.getAttribute('data-checklist') !== 'true') return false;
        const rect = li.getBoundingClientRect();
        // A linked line's mark (left) and arrow (right) open its Element, as a
        // created Element's card in the chat does; the text between stays text.
        const linkedId = li.getAttribute('data-element-id');
        if (linkedId) {
          if (event.clientX - rect.left < LINKED_EDGE_PX || rect.right - event.clientX < LINKED_EDGE_PX) {
            event.preventDefault();
            openInApp('domain-elements', { elementId: linkedId });
            return true;
          }
          return false;
        }
        // An unlinked item's box checks or unchecks it. The box sits on the
        // item's first line, so a click lower down is not on it.
        if (!editableRef.current) return false;
        const lineHeight = parseFloat(getComputedStyle(li).lineHeight) || CHECK_BOX_HIT_PX;
        if (event.clientX - rect.left >= CHECK_BOX_HIT_PX || event.clientY - rect.top >= lineHeight) return false;
        const item = itemAt(v, li);
        if (!item) return false;
        event.preventDefault();
        toggleChecked(item.pos)(v.state, v.dispatch);
        onCommitRef.current?.(lastEmittedRef.current);
        return true;
      },
      contextmenu(v, event) {
        const target = event.target as HTMLElement;
        const cell = target.closest('td, th');
        if (cell && v.dom.contains(cell)) {
          if (!editableRef.current) return false;
          event.preventDefault();
          const at = cellAt(v, cell);
          if (at === null) return true;
          // Keep cells selected together when the click is on one of them.
          let inSelection = false;
          const sel = v.state.selection;
          if (sel instanceof CellSelection) sel.forEachCell((_n, pos) => { if (pos === at) inSelection = true; });
          if (!inSelection) v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(at + 1))));
          setTableMenu({ x: event.clientX, y: event.clientY, canMerge: mergeCells(v.state), canSplit: splitCell(v.state) });
          return true;
        }
        const onBullet = bulletRef.current;
        const li = target.closest('li');
        if (!onBullet || !li || !v.dom.contains(li)) return false;
        const clicked = itemAt(v, li);
        if (!clicked) return false;
        event.preventDefault();
        // The lines selected, or the one clicked.
        let items: { node: PMNode; pos: number }[] = [];
        const { from, to, empty } = v.state.selection;
        if (!empty) v.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type === list_item) items.push({ node, pos }); return true; });
        if (!items.length) items = [clicked];
        // Only a line of plain text not yet made an Element becomes one.
        const lines = items
          .map((it) => ({ ...it, text: (it.node.firstChild?.textContent ?? '').trim() }))
          .filter((it) => it.text && !it.node.attrs.elementId && isPlainLine(it.node))
          .map((it) => ({ ...it, dom: v.nodeDOM(it.pos) }))
          .filter((it): it is typeof it & { dom: HTMLLIElement } => it.dom instanceof HTMLLIElement);
        if (!lines.length) return true;
        onBullet({ text: lines[0].text, texts: lines.map((l) => l.text), liNodes: lines.map((l) => l.dom), x: event.clientX, y: event.clientY });
        return true;
      },
      compositionend(v) {
        setTimeout(() => {
          if (viewRef.current !== v) return;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending !== null) bringIn(v, pending);
          // A "/" typed through an input method opens the menu the same way.
          const { $from, empty } = v.state.selection;
          const text = $from.parent.textContent;
          if (empty && $from.parent.isTextblock && $from.parent.type !== code_block && (text === '/' || text === '／') && !slashKey.getState(v.state)) {
            v.dispatch(v.state.tr.insertText('/', $from.start(), $from.end()).setMeta(slashKey, { pos: $from.start(), query: '' }));
          }
          syncUi(v);
        }, 0);
        return false;
      },
      blur(v) { setTimeout(() => { if (viewRef.current === v && !v.hasFocus()) setToolbar(null); }, 0); return false; },
    };

    const create = (plugins: Plugin[], doc: PMNode | undefined) => {
      if (cancelled) return;
      const state = EditorState.create({ schema, doc, plugins });
      view = new EditorView(mount, {
        state,
        editable: () => editableRef.current,
        attributes: (s) => ({
          class: `note-editor no-focus-ring outline-none leading-[1.65] text-foreground ${compact ? 'note-compact min-h-[36px] text-[14px]' : 'min-h-[300px] text-[15px]'}`,
          'data-empty': isEmptyDoc(s.doc) ? 'true' : 'false',
          'data-placeholder': placeholderRef.current,
          spellcheck: 'false',
        }),
        nodeViews: { code_block: drawnNodeView(registry) },
        handleDOMEvents,
        handlePaste(_v, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length || !spaceIdRef.current) return false;
          event.preventDefault();
          void uploadFiles(files);
          return true;
        },
        handleDrop(v, event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length || !spaceIdRef.current || !editableRef.current) return false;
          event.preventDefault();
          const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
          if (at) v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(at.pos))));
          void uploadFiles(files);
          return true;
        },
        dispatchTransaction(this: EditorView, tr: Transaction) {
          const next = this.state.apply(tr);
          this.updateState(next);
          if (tr.docChanged && initializedRef.current) {
            if (tr.getMeta(EXTERNAL)) lastEmittedRef.current = docToHtml(next.doc);
            else if (isSaver()) emit(next.doc);
          }
          syncUi(this);
        },
      });
      viewRef.current = view;
      // What was saved is not new: only what changes from here on saves.
      lastEmittedRef.current = docToHtml(htmlToDoc(valueRef.current));
      initializedRef.current = true;
      // Joining others who have edits not yet saved: whoever saves takes them.
      if (isSaver()) emit(view.state.doc);
      setReady(true);
    };

    const common = (undo: Command, redo: Command): Plugin[] => [
      slashTrigger((key) => slashKeyRef.current(key)),
      ...tablePlugins(),
      ...noteKeymap(undo, redo, { underline: !compact }),
      shortcuts(),
      elementStatus(() => statusRef.current),
      drawnEditing(),
      ...cursors(),
    ];

    if (collabId) {
      session = openNoteCollab(collabId);
      sessionRef.current = session;
      const s = session;
      // Someone else becoming the one who saves, or leaving it to this side.
      const onPeers = () => { const v = viewRef.current; if (v && initializedRef.current && isSaver()) emit(v.state.doc); };
      s.awareness.on('change', onPeers);
      void s.settled.then((how) => {
        if (cancelled) return;
        if (how === 'alone') seedFromHtml(s.doc, valueRef.current);
        create([
          ySyncPlugin(s.doc.getXmlFragment(FRAGMENT)),
          yCursorPlugin(s.awareness),
          yUndoPlugin(),
          ...common(yUndo as Command, yRedo as Command),
        ], undefined);
      });
    } else {
      create([...localHistory(), ...common(pmUndo, pmRedo)], htmlToDoc(valueRef.current));
    }

    return () => {
      cancelled = true;
      view?.destroy();
      if (viewRef.current === view) viewRef.current = null;
      session?.destroy();
      if (sessionRef.current === session) sessionRef.current = null;
      initializedRef.current = false;
      setReady(false);
    };
    // The editor is made once per Note; its other inputs are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabId, compact, registry]);

  // Who this is, for the others' view of where they are typing.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !ready) return;
    const color = `var(--chart-${(hashText(me.userId ?? '') % CURSOR_COLORS) + 1})`;
    session.awareness.setLocalStateField('user', { name: me.name || t('Someone'), color });
  }, [ready, me.name, me.userId, t]);

  // A body saved elsewhere, or merged with another's save.
  useEffect(() => {
    const next = value ?? initialHtml ?? '';
    valueRef.current = next;
    const view = viewRef.current;
    if (view && initializedRef.current) bringIn(view, next);
  }, [value, initialHtml, bringIn]);

  useEffect(() => {
    editableRef.current = editable;
    viewRef.current?.setProps({ editable: () => editableRef.current });
  }, [editable]);

  useEffect(() => {
    statusRef.current = elementStatusById;
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(statusKey, true));
  }, [elementStatusById, ready]);

  useEffect(() => {
    const onMove = () => { const v = viewRef.current; if (v) syncUi(v); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [syncUi]);

  // ── What the page and the menus ask for ────────────────────────────────
  const applyBlock = useCallback((tag: BlockTag) => run(setBlock(tag)), [run]);
  const applyList = useCallback((kind: ListKind) => run(toggleList(kind)), [run]);
  // A header row and `rows` rows under it.
  const insertTable = useCallback((rows = 3, cols = 3) => run(placeBlock(createTable(rows + 1, cols))), [run]);
  const focus = useCallback(() => viewRef.current?.focus(), []);
  const linkBullets = useCallback((entries: { li: HTMLLIElement; elementId: string }[]) => {
    const view = viewRef.current;
    if (!view) return;
    const found = entries
      .map(({ li, elementId }) => ({ item: itemAt(view, li), elementId }))
      .filter((e): e is { item: { node: PMNode; pos: number }; elementId: string } => !!e.item && !!e.elementId)
      .map((e) => ({ pos: e.item.pos, elementId: e.elementId }));
    if (found.length) linkItems(found)(view.state, view.dispatch);
  }, []);
  useImperativeHandle(handleRef, () => ({ applyBlock, applyList, insertTable, focus, linkBullets }),
    [applyBlock, applyList, insertTable, focus, linkBullets]);

  const askUrl = useCallback(async (): Promise<string | null> => {
    const url = await appDialog.prompt(t('Link URL'), 'https://');
    if (!url) return null;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      await appDialog.alert(t('Enter a URL that starts with http(s):// or mailto:.'));
      return null;
    }
    return url;
  }, [t]);

  // The toolbar's link: selected text already linked is unlinked; otherwise
  // it asks for the address. The text must still be there once it is given.
  const toggleLink = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection;
    if (view.state.doc.rangeHasMark(from, to, schema.marks.link)) { run(setLink(null)); return; }
    const doc = view.state.doc;
    const url = await askUrl();
    if (!url || viewRef.current !== view || view.state.doc !== doc) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
    run(setLink(url));
  }, [askUrl, run]);

  // A link on a line of its own: the address is its text.
  const insertUrl = useCallback(async () => {
    const url = await askUrl();
    if (url) run(setLink(url));
  }, [askUrl, run]);

  const onMark = useCallback((mark: Mark) => {
    run(mark === 'bold' ? toggleBold : mark === 'italic' ? toggleItalic : mark === 'underline' ? toggleUnderline : toggleStrike);
  }, [run]);

  const tableAction = useCallback((action: TableAction) => {
    setTableMenu(null);
    const view = viewRef.current;
    if (!view) return;
    const move = (dir: 'row' | 'col', by: -1 | 1): Command => (state, dispatch) => {
      const rect = selectedRect(state);
      const from = dir === 'row' ? rect.top : rect.left;
      const last = dir === 'row' ? rect.map.height - 1 : rect.map.width - 1;
      const to = from + by;
      if (to < 0 || to > last) return false;
      return dir === 'row' ? moveTableRow({ from, to })(state, dispatch) : moveTableColumn({ from, to })(state, dispatch);
    };
    const commands: Record<TableAction, Command> = {
      'merge': mergeCells, 'split': splitCell,
      'row-up': move('row', -1), 'row-down': move('row', 1), 'col-left': move('col', -1), 'col-right': move('col', 1),
      'delete-row': deleteRow, 'delete-col': deleteColumn, 'delete-table': deleteTable,
    };
    run(commands[action]);
  }, [run]);

  const insertCol = useCallback((el: HTMLTableElement, index: number) => {
    const view = viewRef.current;
    const rect = view && tableAt(view, el);
    if (!view || !rect) return;
    view.dispatch(addColumn(view.state.tr, rect, index));
    setHandles(null);
  }, []);
  const insertRow = useCallback((el: HTMLTableElement, rowIndex: number) => {
    const view = viewRef.current;
    const rect = view && tableAt(view, el);
    if (!view || !rect) return;
    view.dispatch(addRow(view.state.tr, rect, rowIndex + 1));
    setHandles(null);
  }, []);

  // Everything "/" offers, in the order shown. A description keeps its text
  // as Markdown, so it has no underline or alignment.
  const headingIcon = (n: number) => <span className="text-[11px] font-semibold leading-none">H{n}</span>;
  const slashItems: SlashItem[] = [
    { id: 'p', group: 'Style', label: 'Text', icon: <FileText size={15} />, keywords: 'paragraph body', run: () => applyBlock('P') },
    { id: 'h1', group: 'Style', label: 'Heading 1', icon: headingIcon(1), keywords: 'title h1', run: () => applyBlock('H1') },
    { id: 'h2', group: 'Style', label: 'Heading 2', icon: headingIcon(2), keywords: 'h2', run: () => applyBlock('H2') },
    { id: 'h3', group: 'Style', label: 'Heading 3', icon: headingIcon(3), keywords: 'h3', run: () => applyBlock('H3') },
    { id: 'quote', group: 'Style', label: 'Quote', icon: <Quote size={15} />, keywords: 'blockquote', run: () => applyBlock('BLOCKQUOTE') },
    { id: 'code', group: 'Style', label: 'Code block', icon: <span className="font-mono text-[11px] leading-none">{'</>'}</span>, keywords: 'pre mermaid', run: () => applyBlock('PRE') },
    { id: 'bullet', group: 'List', label: 'Bulleted list', icon: <List size={15} />, keywords: 'ul', run: () => applyList('bullet') },
    { id: 'numbered', group: 'List', label: 'Numbered list', icon: <ListOrdered size={15} />, keywords: 'ol', run: () => applyList('numbered') },
    { id: 'check', group: 'List', label: 'Checklist', icon: <ElementIcon size={15} />, keywords: 'todo task', run: () => applyList('check') },
    { id: 'table', group: 'Insert', label: 'Insert table', icon: <TableIcon size={15} />, keywords: 'grid', run: () => insertTable() },
    { id: 'hr', group: 'Insert', label: 'Divider', icon: <Minus size={15} />, keywords: 'hr line rule', run: () => run(placeBlock(horizontal_rule.create())) },
    { id: 'link', group: 'Insert', label: 'Link', icon: <LinkIcon size={15} />, keywords: 'url', run: () => { void insertUrl(); } },
    ...(spaceId ? [{ id: 'file', group: 'Insert', label: 'File', icon: <Paperclip size={15} />, keywords: 'upload image attach artifact',
      run: (at: { x: number; y: number }) => setPicker(at) }] : []),
    ...(embedHost?.views ?? []).map((v) => ({
      id: `embed:${v.id}`, group: 'Insert', label: v.label, hint: v.hint, icon: v.icon ?? null, translated: true,
      run: () => insertEmbed({ view: v.id }),
    })),
    { id: 'bold', group: 'Formatting', label: 'Bold', icon: <Bold size={15} />, run: () => onMark('bold') },
    { id: 'italic', group: 'Formatting', label: 'Italic', icon: <Italic size={15} />, run: () => onMark('italic') },
    ...(compact ? [] : [{ id: 'underline', group: 'Formatting', label: 'Underline', icon: <UnderlineIcon size={15} />, run: () => onMark('underline') }]),
    { id: 'strike', group: 'Formatting', label: 'Strikethrough', icon: <Strikethrough size={15} />, run: () => onMark('strike') },
    ...(compact ? [] : [
      { id: 'left', group: 'Formatting', label: 'Align left', icon: <AlignLeft size={15} />, run: () => run(setAlign('left')) },
      { id: 'center', group: 'Formatting', label: 'Align center', icon: <AlignCenter size={15} />, run: () => run(setAlign('center')) },
      { id: 'right', group: 'Formatting', label: 'Align right', icon: <AlignRight size={15} />, run: () => run(setAlign('right')) },
    ]),
  ];
  const shownSlash = slash ? filterSlash(slashItems, slash.query, t) : [];

  const closeSlash = useCallback(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta(slashKey, null));
  }, []);
  const pickSlash = (item: SlashItem) => {
    const view = viewRef.current;
    const at = slash ?? { x: 0, y: 0 };
    if (view) clearSlash(view);
    item.run({ x: at.x, y: at.y });
  };
  slashKeyRef.current = (key) => {
    const n = shownSlash.length || 1;
    if (key === 'ArrowDown') { setSlashIndex((i) => (i + 1) % n); return true; }
    if (key === 'ArrowUp') { setSlashIndex((i) => (i + n - 1) % n); return true; }
    if (key === 'Enter') {
      const item = shownSlash[Math.min(slashIndex, shownSlash.length - 1)];
      if (item) pickSlash(item); else closeSlash();
      return true;
    }
    if (key === 'Escape') { closeSlash(); return true; }
    return false;
  };

  return (
    <>
      <div ref={frameRef} className="relative"
        onMouseMove={editable ? (e) => {
          const view = viewRef.current;
          if (!view || !frameRef.current || e.buttons) return;
          const next = measureTableHandles(view.dom as HTMLElement, frameRef.current, e.clientX, e.clientY);
          if (handlesKey(next) !== handlesKey(handles) || next?.table !== handles?.table) setHandles(next);
        } : undefined}
        onMouseLeave={() => setHandles(null)}>
        <div ref={mountRef} />
        {!ready && <div className={compact ? 'min-h-[36px]' : 'min-h-[300px]'} />}
        <DrawnBlocks registry={registry} editable={editable} />
        {editable && handles && <TableInsertHandles geom={handles} onInsertCol={insertCol} onInsertRow={insertRow} />}
        {editable && (
          <input ref={fileInputRef} type="file" multiple hidden
            onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void uploadFiles(files); }} />
        )}
      </div>

      {slash && (
        <SlashMenu x={slash.x} y={slash.y} query={slash.query} items={shownSlash} index={Math.min(slashIndex, Math.max(0, shownSlash.length - 1))}
          onHover={setSlashIndex} onPick={pickSlash} onClose={closeSlash} />
      )}
      {picker && createPortal(
        <ArtifactPicker spaceId={spaceId} x={Math.min(picker.x, window.innerWidth - 336)} y={Math.min(picker.y, window.innerHeight - 320)}
          onClose={() => setPicker(null)}
          onUpload={() => { setPicker(null); fileInputRef.current?.click(); }}
          onPick={(file) => { setPicker(null); insertEmbed({ view: FILE_VIEW, id: file.id }); }} />,
        document.body,
      )}
      {toolbar && editable && (
        <FloatingToolbar x={toolbar.x} y={toolbar.y} markdownOnly={compact}
          onMark={onMark} onAlign={(a) => run(setAlign(a))} onList={applyList}
          onBlock={(tag) => run(toggleBlock(tag))} onLink={() => { void toggleLink(); }} />
      )}
      {tableMenu && editable && (
        <TableContextMenu x={tableMenu.x} y={tableMenu.y} canMerge={tableMenu.canMerge} canSplit={tableMenu.canSplit}
          onAction={tableAction} onClose={() => setTableMenu(null)} />
      )}
      <NoteEditorStyles />
    </>
  );
});
