'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered,
  ChevronDown, Quote, Link as LinkIcon, Table as TableIcon, Plus,
} from 'lucide-react';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import { sanitizeHtml, hasInvalidStructure, normalizeStructure } from './htmlSanitizer';

export interface NoteEditorProps {
  initialHtml?: string;
  onChange?: (html: string) => void;
  editable?: boolean;
  /** Called when the user right-clicks on a list item (bullet/check). */
  onBulletContextMenu?: (info: BulletContextInfo) => void;
  /** id → status for every Element. Bullets linked via data-element-id
   *  render a read-only ○ that mirrors the linked Element's status. */
  elementStatusById?: Record<string, string | null | undefined>;
  /** When provided, the formatting toolbar is portaled into this element
   *  as a centered island instead of floating near the selection. */
  toolbarPortalRef?: React.RefObject<HTMLDivElement | null>;
}

export interface BulletContextInfo {
  /** Plain text of the targeted line. */
  text: string;
  /** All list items currently selected (or [target] when nothing is selected). */
  texts: string[];
  /** Source <li> nodes, parallel to `texts` — used to stamp the
   *  data-element-id link back after → Element 化. */
  liNodes: HTMLLIElement[];
  /** Screen position to anchor a popover. */
  x: number;
  y: number;
}

/** Imperative handle so the parent header (PageView's Note-style
 *  button strip) can drive the editor without lifting the entire
 *  selection/contentEditable state up. */
export interface NoteEditorHandle {
  applyBlock(tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE'): void;
  applyList(kind: 'bullet' | 'dashed' | 'numbered' | 'check'): void;
  insertTable(rows?: number, cols?: number): void;
  focus(): void;
  /** Stamp data-element-id onto bullets just turned into Elements, then persist. */
  linkBullets(entries: { li: HTMLLIElement; elementId: string }[]): void;
}

const TOOLBAR_GAP = 8;

// Blocks whose style must NOT carry onto the next line. Headings are
// single-line: Enter always drops to a paragraph. Quote / code are
// multi-line containers: Enter adds a line, and Enter on an *empty* line
// breaks out — otherwise a blockquote becomes inescapable.
const HEADING_BLOCKS = new Set(['H1', 'H2', 'H3']);
const CONTAINER_BLOCKS = new Set(['BLOCKQUOTE', 'PRE']);

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor({
  initialHtml,
  onChange,
  editable = true,
  onBulletContextMenu,
  elementStatusById,
  toolbarPortalRef,
}, handleRef) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [toolbar, setToolbar] = useState<{ x: number; y: number } | null>(null);
  // Right-click menu for table cells — anchored at the click point. The
  // target cell is held in a ref so menu actions act on it regardless of
  // where the selection drifts.
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  const tableCellRef = useRef<HTMLTableCellElement | null>(null);
  // Rectangular cell selection (drag across cells). The highlighted cells live
  // in selectedCellsRef and drive the "セルを結合する" item; HTML's own text
  // selection is linear, so we track a clean rectangle ourselves.
  const selectedCellsRef = useRef<HTMLTableCellElement[]>([]);
  const cellDragAnchorRef = useRef<HTMLTableCellElement | null>(null);
  // Geometry for the hover "+" insert handles (null = not hovering a table).
  const [tableHandles, setTableHandles] = useState<TableHandleGeom | null>(null);
  // Signature of the last computed handles so mousemove over the same table
  // doesn't re-render every frame (geometry is stable until the table changes).
  const handlesSigRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Refs don't trigger a re-render, so the parent's toolbar-portal node isn't
  // available on the first render. Flip this after mount to re-render once the
  // node exists and the always-on header island can portal into it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const initRef = useRef(false);
  const lastEmittedRef = useRef<string>('');
  // True while an IME composition is in flight. emit() rewrites the DOM
  // (normalizeStructure / read-back), and doing that mid-composition tears
  // the IME's composing range out from under it — the half-typed text then
  // gets re-committed, duplicating characters. So we hold off until
  // compositionend.
  const composingRef = useRef(false);
  // Last known caret/selection inside the editor. The always-on header
  // toolbar lives outside the contentEditable, so clicking a button moves
  // focus out and the live selection is gone by the time the command runs.
  // We snapshot the editor selection on every change and restore it right
  // before executing a command.
  const savedRangeRef = useRef<Range | null>(null);
  useEffect(() => {
    const save = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (ref.current?.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', save);
    return () => document.removeEventListener('selectionchange', save);
  }, []);

  // Snapshot the current in-editor selection. Called from the toolbar's
  // mousedown (the last instant the user's selection is still intact, before
  // the click can collapse it) and continuously via selectionchange below.
  const captureSelection = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  // Put the snapshot back before a command runs. Inline commands (bold,
  // createLink) need the original, possibly non-collapsed, selection — a
  // header-toolbar click can leave focus/selection collapsed, so we always
  // re-apply the snapshot rather than trusting the live selection.
  const restoreSelection = useCallback(() => {
    const el = ref.current;
    const saved = savedRangeRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;
    if (saved) {
      el.focus();
      try {
        sel.removeAllRanges();
        sel.addRange(saved.cloneRange());
        return;
      } catch {
        /* saved range detached (DOM rewritten) — fall through */
      }
    }
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) return;
    el.focus();
  }, []);

  // Set initial HTML once. Avoid re-setting on every prop update — that
  // would clobber the user's caret while they type.
  useEffect(() => {
    const el = ref.current;
    if (!el || initRef.current) return;
    initRef.current = true;
    // New lines should be <p>, not the legacy <div> WebKit defaults to —
    // <div> separators are what produced the malformed <div><br></div> +
    // mis-nested list/heading soup in older notes.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported */ }
    el.innerHTML = initialHtml ? sanitizeHtml(initialHtml) : '';
    // Collapse effectively-empty bodies (incl. malformed empty scaffolding
    // like <ul><li></li></ul>) to one clean paragraph so the placeholder
    // shows and the caret has a home.
    if (isEditorEmpty(el)) el.innerHTML = '<p><br></p>';
    el.setAttribute('data-empty', isEditorEmpty(el) ? 'true' : 'false');
    lastEmittedRef.current = el.innerHTML;
  }, [initialHtml]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Repair any bad nesting a structural command just produced before it
    // persists. Cheap guard keeps plain typing untouched; the repair only
    // moves element wrappers (text nodes are relocated, not recreated) so
    // the live caret survives.
    if (hasInvalidStructure(el)) normalizeStructure(el);
    el.setAttribute('data-empty', isEditorEmpty(el) ? 'true' : 'false');
    const html = el.innerHTML;
    if (html === lastEmittedRef.current) return;
    lastEmittedRef.current = html;
    onChange?.(html);
  }, [onChange]);

  // Mirror each linked bullet's ○ to its Element's live status.
  // `data-element-status` is derived — applied here and re-applied
  // whenever element data changes; the sanitizer drops it so it never
  // persists (only data-element-id, the link, survives a save).
  const applyElementStatuses = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    for (const li of Array.from(el.querySelectorAll<HTMLLIElement>('li[data-element-id]'))) {
      const id = li.getAttribute('data-element-id');
      const status = (id && elementStatusById?.[id]) || 'backlog';
      // Only touch the DOM when the value actually changes — avoids needless
      // mutations while the user is typing in the contentEditable.
      if (li.getAttribute('data-element-status') !== status) {
        li.setAttribute('data-element-status', status);
      }
    }
  }, [elementStatusById]);

  // Re-apply after the initial content loads and on every element change.
  useEffect(() => {
    applyElementStatuses();
  }, [applyElementStatuses]);

  // Stamp the data-element-id link onto bullets just turned into Elements
  // (called by PageView after → Element 化), then persist.
  const linkBullets = useCallback((entries: { li: HTMLLIElement; elementId: string }[]) => {
    for (const { li, elementId } of entries) {
      if (!li || !elementId) continue;
      li.setAttribute('data-element-id', elementId);
      li.setAttribute('data-element-status', elementStatusById?.[elementId] ?? 'backlog');
    }
    emit();
  }, [emit, elementStatusById]);

  const updateToolbarPosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) {
      setToolbar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbar(null);
      return;
    }
    setToolbar({
      x: rect.left + rect.width / 2,
      y: rect.top - TOOLBAR_GAP,
    });
  }, []);

  const exec = useCallback((cmd: string, value?: string) => {
    // Bring the (possibly drifted) caret back into the editor first so the
    // command targets the user's text rather than nothing.
    restoreSelection();
    document.execCommand(cmd, false, value);
    // execCommand applies inline `style="text-align: ..."` for justify.
    // Convert to data-align so our sanitizer + CSS handles it cleanly.
    normalizeAlignment(ref.current);
    emit();
    updateToolbarPosition();
  }, [emit, updateToolbarPosition, restoreSelection]);

  useEffect(() => {
    const onSel = () => updateToolbarPosition();
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('scroll', onSel, true);
    window.addEventListener('resize', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('scroll', onSel, true);
      window.removeEventListener('resize', onSel);
    };
  }, [updateToolbarPosition]);

  const handleInput = useCallback(() => {
    // Let the IME finish; compositionend re-runs this work once committed.
    if (composingRef.current) return;
    normalizeAlignment(ref.current);
    emit();
  }, [emit]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    normalizeAlignment(ref.current);
    emit();
  }, [emit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const cleaned = html ? sanitizeHtml(html) : escapeText(text);
    document.execCommand('insertHTML', false, cleaned);
  }, []);

  // Enter handling for "sticky" blocks so their style doesn't run forever.
  // Returns true when it took over (caller should preventDefault). Plain
  // Enter only — Shift+Enter falls through to a native soft break, and an
  // IME-commit Enter is left alone.
  const breakOutOfStickyBlock = useCallback((): boolean => {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return false;
    let node: Node | null = sel.anchorNode;
    let block: HTMLElement | null = null;
    while (node && node !== root) {
      if (node.nodeType === 1) {
        const t = (node as HTMLElement).tagName;
        if (HEADING_BLOCKS.has(t) || CONTAINER_BLOCKS.has(t) || t === 'P' || t === 'LI') {
          block = node as HTMLElement;
          break;
        }
      }
      node = node.parentNode;
    }
    if (!block) return false;
    const tag = block.tagName;
    const empty = (block.textContent ?? '').trim() === '';
    // Headings always exit; quote/code only when the current line is empty
    // (so multi-line quotes/code still work, but you can always break out).
    if (!HEADING_BLOCKS.has(tag) && !(CONTAINER_BLOCKS.has(tag) && empty)) return false;
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    if (empty) block.replaceWith(p);
    else block.after(p);
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    emit();
    return true;
  }, [emit]);

  // Tab / Shift+Tab moves between table cells (and Tab in the last cell
  // appends a new row, the way Note / Word do). Returns true when the
  // caret was in a table and the key was handled.
  const handleTableTab = useCallback((forward: boolean) => {
    const root = ref.current;
    if (!root) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node: Node | null = sel.anchorNode;
    let cell: HTMLTableCellElement | null = null;
    while (node && node !== root) {
      if (node.nodeType === 1) {
        const tag = (node as Element).tagName;
        if (tag === 'TD' || tag === 'TH') { cell = node as HTMLTableCellElement; break; }
      }
      node = node.parentNode;
    }
    if (!cell) return false;
    const table = cell.closest('table[data-note-table="true"]');
    if (!table) return false;

    const placeCaret = (target: Element) => {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    };

    const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th, td'));
    const idx = cells.indexOf(cell);
    if (forward) {
      if (idx < cells.length - 1) {
        placeCaret(cells[idx + 1]);
      } else {
        // Last cell → append a new body row mirroring the column count.
        const doc = table.ownerDocument;
        const cols = table.querySelector('tr')?.children.length ?? 1;
        const tbody = table.querySelector('tbody') ?? table;
        const tr = doc.createElement('tr');
        for (let i = 0; i < cols; i++) {
          const td = doc.createElement('td');
          td.appendChild(doc.createElement('br'));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        placeCaret(tr.firstElementChild as Element);
        emit();
      }
    } else if (idx > 0) {
      placeCaret(cells[idx - 1]);
    }
    return true;
  }, [emit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.nativeEvent.isComposing) {
      if (handleTableTab(!e.shiftKey)) { e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (breakOutOfStickyBlock()) { e.preventDefault(); return; }
    }
    // Cmd/Ctrl shortcuts that map to execCommand
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); exec('bold'); }
    else if (key === 'i') { e.preventDefault(); exec('italic'); }
    else if (key === 'u') { e.preventDefault(); exec('underline'); }
  }, [exec, breakOutOfStickyBlock, handleTableTab]);

  // Restore caret into the editor when triggering commands from the
  // header toolbar — execCommand only runs against the focused
  // contentEditable so we have to put the selection back first.
  const focusEditor = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    // Live selection already inside the editor → keep it.
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) return;
    // Header-toolbar case: restore the last editor selection so the command
    // acts on the line the user was on, not the end of the document.
    if (savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
      return;
    }
    // Nothing saved yet → place caret at end.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  const toggleChecklist = useCallback(() => {
    focusEditor();
    // Toggle the currently selected line(s) into a checklist <ul data-checklist="true">.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const root = ref.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return;

    // Collect the block-level ancestors that the selection touches.
    const blocks = collectSelectedBlocks(root, range);
    if (blocks.length === 0) return;

    // If every block is already a checklist item → unwrap to <p>.
    const allChecklist = blocks.every((b) =>
      b.tagName === 'LI' && (b.parentElement?.getAttribute('data-checklist') === 'true')
    );

    if (allChecklist) {
      for (const li of blocks) {
        const p = document.createElement('p');
        p.innerHTML = li.innerHTML;
        const ul = li.parentElement!;
        ul.parentElement!.insertBefore(p, ul);
        li.remove();
        if (ul.children.length === 0) ul.remove();
      }
    } else {
      wrapBlocksAsChecklist(blocks);
    }
    emit();
  }, [emit, focusEditor]);

  // Bulleted (•) and dashed (—) lists are both <ul>, distinguished by
  // a data-style attribute so CSS can swap the marker. Numbered → <ol>.
  const applyList = useCallback((kind: 'bullet' | 'dashed' | 'numbered' | 'check') => {
    if (kind === 'check') {
      toggleChecklist();
      return;
    }
    focusEditor();
    if (kind === 'numbered') {
      exec('insertOrderedList');
      return;
    }
    exec('insertUnorderedList');
    // Walk up from the selection to find the <ul> we just created and
    // tag it (bullet | dashed). The browser doesn't expose a "which list
    // did insert-list create" handle, so we use the current selection.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    while (node && node !== ref.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'UL') {
        const ul = node as HTMLElement;
        if (kind === 'dashed') ul.setAttribute('data-style', 'dashed');
        else ul.removeAttribute('data-style');
        break;
      }
      node = node.parentNode;
    }
    emit();
  }, [exec, toggleChecklist, focusEditor, emit]);

  const applyBlock = useCallback((tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE') => {
    focusEditor();
    exec('formatBlock', tag);
  }, [exec, focusEditor]);

  const insertTable = useCallback((rows = 3, cols = 3) => {
    focusEditor();
    // Build a simple HTML table — header row + (rows) body rows.
    const headerCells = Array.from({ length: cols }, () => '<th><br></th>').join('');
    const bodyRows = Array.from({ length: rows }, () => {
      const tds = Array.from({ length: cols }, () => '<td><br></td>').join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    const html = `<table data-note-table="true"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    emit();
  }, [focusEditor, emit]);

  useImperativeHandle(handleRef, () => ({
    applyBlock,
    applyList,
    insertTable,
    focus: focusEditor,
    linkBullets,
  }), [applyBlock, applyList, insertTable, focusEditor, linkBullets]);

  // Run a table mutation against the cell the menu was opened on, persist,
  // and close the menu. All ops are plain DOM edits (see tbl* helpers below).
  const runTableOp = useCallback((op: (cell: HTMLTableCellElement) => void) => {
    const cell = tableCellRef.current;
    if (cell && cell.isConnected) {
      op(cell);
      emit();
    }
    setTableMenu(null);
    tableCellRef.current = null;
  }, [emit]);

  const clearCellSelection = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    for (const c of Array.from(root.querySelectorAll('[data-cell-sel]'))) c.removeAttribute('data-cell-sel');
    selectedCellsRef.current = [];
  }, []);

  // Highlight the rectangle spanning anchor → current and remember its cells.
  const applyCellRect = useCallback((anchor: HTMLTableCellElement, current: HTMLTableCellElement) => {
    const table = anchor.closest('table');
    if (!table || current.closest('table') !== table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const posOf = (c: HTMLTableCellElement) => {
      const tr = c.closest('tr')!;
      return { r: rows.indexOf(tr), c: Array.from(tr.children).indexOf(c) };
    };
    const a = posOf(anchor), b = posOf(current);
    const minR = Math.min(a.r, b.r), maxR = Math.max(a.r, b.r);
    const minC = Math.min(a.c, b.c), maxC = Math.max(a.c, b.c);
    for (const c of Array.from(table.querySelectorAll('[data-cell-sel]'))) c.removeAttribute('data-cell-sel');
    const sel: HTMLTableCellElement[] = [];
    for (let r = minR; r <= maxR; r++) {
      const tr = rows[r];
      for (let cc = minC; cc <= maxC; cc++) {
        const cell = tr?.children[cc] as HTMLTableCellElement | undefined;
        if (cell) { cell.setAttribute('data-cell-sel', 'true'); sel.push(cell); }
      }
    }
    selectedCellsRef.current = sel;
  }, []);

  // Merge the highlighted rectangle.
  const runTableMerge = useCallback(() => {
    const cells = selectedCellsRef.current;
    if (cells.length >= 2) {
      tblMergeCells(cells);
      clearCellSelection(); // drop data-cell-sel before persisting
      emit();
    }
    setTableMenu(null);
    tableCellRef.current = null;
  }, [emit, clearCellSelection]);

  // Cell-selection drag wiring (attached to the editor in the JSX below).
  const handleEditorMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // right-click keeps an existing cell selection
    clearCellSelection();
    const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
    cellDragAnchorRef.current = cell && cell.closest('table[data-note-table="true"]') ? cell : null;
  }, [clearCellSelection]);

  const handleEditorMouseDrag = useCallback((e: React.MouseEvent) => {
    const anchor = cellDragAnchorRef.current;
    if (!anchor || !(e.buttons & 1)) return;
    const cell = (e.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
    if (!cell || cell === anchor || cell.closest('table') !== anchor.closest('table')) return;
    // Cross-cell drag → rectangular cell selection (suppress the text caret).
    (ref.current?.ownerDocument.defaultView ?? window).getSelection()?.removeAllRanges();
    applyCellRect(anchor, cell);
  }, [applyCellRect]);

  const handleEditorMouseUp = useCallback(() => {
    cellDragAnchorRef.current = null;
  }, []);

  // Compute the "+" handle geometry for whichever table the cursor is over
  // (with a small margin so the edge handles stay reachable). Coordinates are
  // relative to the editor content box, which is stable under scroll.
  const refreshTableHandles = useCallback((clientX: number, clientY: number) => {
    const editable = ref.current;
    if (!editable) return;
    lastPointerRef.current = { x: clientX, y: clientY };
    // Margin must clear the bottom "+" bar (sits ~20px below the table) so
    // hovering the bar doesn't fall outside the table region and hide it.
    const M = 28;
    const table = Array.from(editable.querySelectorAll<HTMLTableElement>('table[data-note-table="true"]'))
      .find((t) => {
        const r = t.getBoundingClientRect();
        return clientX >= r.left - M && clientX <= r.right + M && clientY >= r.top - M && clientY <= r.bottom + M;
      });
    if (!table) {
      if (handlesSigRef.current !== null) { handlesSigRef.current = null; setTableHandles(null); }
      return;
    }
    const rowsEls = Array.from(table.querySelectorAll('tr'));
    const headerCells = Array.from(rowsEls[0]?.children ?? []);
    if (!rowsEls.length || !headerCells.length) { setTableHandles(null); return; }
    const er = editable.getBoundingClientRect();
    const top = rowsEls[0].getBoundingClientRect().top - er.top;
    const left = headerCells[0].getBoundingClientRect().left - er.left;
    // Vertical gridlines: left edge of each column (the right edge is the
    // right bar, so it's excluded from the between-handle candidates).
    const colXs: { x: number; index: number }[] = [];
    let idx = 0;
    for (const c of headerCells) {
      colXs.push({ x: c.getBoundingClientRect().left - er.left, index: idx });
      idx += parseInt(c.getAttribute('colspan') || '1', 10);
    }
    const colCount = idx;
    const rightX = headerCells[headerCells.length - 1].getBoundingClientRect().right - er.left;
    // Horizontal gridlines: bottom of each row.
    const rowBottoms = rowsEls.map((tr, j) => ({ y: tr.getBoundingClientRect().bottom - er.top, rowIndex: j }));
    const tableBottom = rowBottoms[rowBottoms.length - 1].y;

    // Snap distance: a "+" only appears once the cursor is within this many
    // px of a gridline, so you get the one boundary you're pointing at (and
    // hovering a cell's middle shows just the bottom bar, nothing else).
    const SNAP = 12;
    const relX = clientX - er.left;
    const relY = clientY - er.top;

    let col: TableHandleGeom['col'] = null;
    { let best: { x: number; index: number } | null = null, bd = SNAP;
      for (const c of colXs) { const d = Math.abs(c.x - relX); if (d < bd) { bd = d; best = c; } }
      if (best) col = { x: best.x, top, index: best.index }; }

    // Internal row gridlines only (the last one is covered by the bottom bar).
    let rowBetween: TableHandleGeom['rowBetween'] = null;
    { let best: { y: number; rowIndex: number } | null = null, bd = SNAP;
      for (let j = 0; j < rowBottoms.length - 1; j++) { const d = Math.abs(rowBottoms[j].y - relY); if (d < bd) { bd = d; best = rowBottoms[j]; } }
      if (best) rowBetween = { y: best.y, left, rowIndex: best.rowIndex }; }

    const bottomBar = { left, top: tableBottom, width: rightX - left, rowIndex: rowsEls.length - 1 };
    const rightBar = { left: rightX, top, height: tableBottom - top, colIndex: colCount };
    const sig = `${rowsEls.length}x${headerCells.length}|c${col ? col.index : '-'}|r${rowBetween ? rowBetween.rowIndex : '-'}|${Math.round(tableBottom)},${Math.round(rightX)}`;
    if (sig === handlesSigRef.current) return;
    handlesSigRef.current = sig;
    setTableHandles({ table, bottomBar, rightBar, col, rowBetween });
  }, []);

  const handleInsertCol = useCallback((table: HTMLTableElement, index: number) => {
    tblInsertColAtIndex(table, index);
    emit();
    handlesSigRef.current = null; // geometry changed → recompute at the cursor
    const p = lastPointerRef.current;
    if (p) refreshTableHandles(p.x, p.y);
  }, [emit, refreshTableHandles]);
  const handleInsertRow = useCallback((table: HTMLTableElement, rowIndex: number) => {
    const rowEl = table.querySelectorAll('tr')[rowIndex] as HTMLTableRowElement | undefined;
    if (rowEl) {
      tblInsertRowAfter(rowEl);
      emit();
      handlesSigRef.current = null;
      const p = lastPointerRef.current;
      if (p) refreshTableHandles(p.x, p.y);
    }
  }, [emit, refreshTableHandles]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Table cell → table editing menu (takes priority over the bullet menu).
    const cell = target.closest('td, th') as HTMLTableCellElement | null;
    if (cell && cell.closest('table[data-note-table="true"]')) {
      e.preventDefault();
      tableCellRef.current = cell;
      // Keep the rectangular drag-selection if present; otherwise fall back to
      // a linear text selection spanning cells (e.g. keyboard select).
      if (selectedCellsRef.current.length < 2 && ref.current) {
        const linear = tblSelectedCells(ref.current);
        if (linear.length >= 2) selectedCellsRef.current = linear;
      }
      setTableMenu({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!onBulletContextMenu) return;
    const li = target.closest('li') as HTMLLIElement | null;
    if (!li) return;
    e.preventDefault();
    const sel = window.getSelection();
    let liNodes: HTMLLIElement[] = [li];
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const blocks = collectSelectedBlocks(ref.current!, range)
        .filter((b): b is HTMLLIElement => b.tagName === 'LI');
      if (blocks.length > 0) liNodes = blocks;
    }
    // Pair each <li> with its text; drop empties, lines already linked
    // to an Element (one-shot conversion), and lines whose content is
    // styled as a heading / quote / pre — only Regular-text bullets
    // become Elements.
    const items = liNodes
      .map((n) => ({ node: n, text: (n.textContent ?? '').trim() }))
      .filter(
        (it) =>
          it.text &&
          !it.node.hasAttribute('data-element-id') &&
          liIsRegularText(it.node),
      );
    if (items.length === 0) return;
    onBulletContextMenu({
      text: items[0].text,
      texts: items.map((it) => it.text),
      liNodes: items.map((it) => it.node),
      x: e.clientX,
      y: e.clientY,
    });
  }, [onBulletContextMenu]);

  const insertLink = useCallback(() => {
    // Restore the editor selection first — the header toolbar button stole
    // focus, and createLink needs the original (non-collapsed) selection to
    // know which text to wrap.
    restoreSelection();
    // Toggle: if the caret/selection already sits inside an <a>, strip
    // the link instead of prompting for a new URL.
    if (selectionHasAncestor(ref.current, 'A')) {
      exec('unlink');
      return;
    }
    const url = window.prompt('リンク先 URL', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert('http(s):// または mailto: で始まる URL を入力してください');
      return;
    }
    exec('createLink', url);
  }, [exec, restoreSelection]);

  // Block-level toggle: applies `tag` if the current block isn't
  // already that tag, otherwise reverts to <p>. Used by the floating
  // toolbar's quote button and the style dropdown so a second click
  // cancels the format instead of re-applying it.
  const toggleBlock = useCallback(
    (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE') => {
      focusEditor();
      const current = currentBlockTag(ref.current);
      const next = current === tag ? 'P' : tag;
      exec('formatBlock', next);
    },
    [exec, focusEditor],
  );

  return (
    <>
      {/* Mouse handlers live on the wrapper (not the contentEditable) so that
          moving the cursor onto an overlay "+" handle — which sits above the
          editable as a sibling — doesn't fire the editable's mouseleave and
          make the handles flicker out from under the pointer. */}
      <div
        className="relative"
        onMouseDown={editable ? handleEditorMouseDown : undefined}
        onMouseMove={editable ? (e) => { handleEditorMouseDrag(e); refreshTableHandles(e.clientX, e.clientY); } : undefined}
        onMouseUp={editable ? handleEditorMouseUp : undefined}
        onMouseLeave={() => { handlesSigRef.current = null; setTableHandles(null); }}
      >
        <div
          ref={ref}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onContextMenu={handleContextMenu}
          spellCheck={false}
          data-placeholder="Start writing…"
          className="note-editor no-focus-ring outline-none min-h-[300px] text-[15px] leading-[1.65] text-foreground"
        />
        {editable && tableHandles && (
          <TableInsertHandles
            geom={tableHandles}
            onInsertCol={handleInsertCol}
            onInsertRow={handleInsertRow}
          />
        )}
      </div>

      {/* Header-island toolbar — always visible, portaled into PageView's
          header bar (independent of the text selection). */}
      {editable && mounted && toolbarPortalRef?.current &&
        createPortal(
          <HeaderToolbar
            onCommand={exec}
            onChecklist={toggleChecklist}
            onLink={insertLink}
            onToggleBlock={toggleBlock}
            onInsertTable={() => insertTable()}
            onCaptureSelection={captureSelection}
          />,
          toolbarPortalRef.current,
        )}

      {/* Floating selection toolbar — fallback when no header portal target
          is provided (the toolbar follows the selection instead). */}
      {toolbar && editable && !toolbarPortalRef && (
        <FloatingToolbar
          x={toolbar.x}
          y={toolbar.y}
          onCommand={exec}
          onChecklist={toggleChecklist}
          onLink={insertLink}
          onToggleBlock={toggleBlock}
        />
      )}

      {/* Table cell right-click menu — merge selection, move & delete rows/cols. */}
      {tableMenu && editable && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          canMerge={selectedCellsRef.current.length >= 2}
          canUnmerge={
            (parseInt(tableCellRef.current?.getAttribute('colspan') || '1', 10)) > 1 ||
            (parseInt(tableCellRef.current?.getAttribute('rowspan') || '1', 10)) > 1
          }
          onAction={runTableOp}
          onMerge={runTableMerge}
          onClose={() => { setTableMenu(null); tableCellRef.current = null; }}
        />
      )}

      <style jsx global>{`
        .note-editor { position: relative; }
        /* Placeholder. Driven by data-empty (set in JS) rather than :empty,
           because after typing-then-deleting the DOM keeps a <p><br></p> and
           never becomes truly :empty. Absolutely positioned so it overlays
           the empty first line without nudging the caret. */
        .note-editor[data-empty="true"]::before {
          content: attr(data-placeholder);
          position: absolute;
          top: 0;
          left: 0;
          color: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
          pointer-events: none;
        }
        .note-editor ::selection,
        .note-editor::selection {
          background: var(--accent-default);
          color: #fff;
        }
        .note-editor h1 {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.25;
          margin: 1.2rem 0 0.4rem;
        }
        .note-editor h2 {
          font-size: 1.3rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 1rem 0 0.3rem;
        }
        .note-editor h3 {
          font-size: 1.05rem;
          font-weight: 600;
          line-height: 1.35;
          margin: 0.85rem 0 0.25rem;
        }
        .note-editor p { margin: 0.25rem 0; min-height: 1em; }
        .note-editor blockquote {
          border-left: 3px solid var(--border);
          padding-left: 0.8rem;
          margin: 0.5rem 0;
          color: var(--muted-foreground);
        }
        .note-editor pre {
          background: color-mix(in srgb, var(--muted) 60%, transparent);
          padding: 0.6rem 0.8rem;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13px;
          overflow-x: auto;
          margin: 0.5rem 0;
        }
        .note-editor code {
          background: color-mix(in srgb, var(--muted) 50%, transparent);
          padding: 0.1em 0.35em;
          border-radius: 4px;
          font-size: 0.92em;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .note-editor pre code {
          background: transparent;
          padding: 0;
        }
        .note-editor a {
          color: var(--primary);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .note-editor ul, .note-editor ol {
          padding-left: 1.6rem;
          margin: 0.3rem 0;
        }
        /* Restore markers — Tailwind's preflight resets ul/ol to
           list-style: none, which would hide bullets/numbers. The dashed and
           checklist variants below re-override these with higher specificity. */
        .note-editor ul { list-style: disc; }
        .note-editor ol { list-style: decimal; }
        .note-editor ul ul { list-style: circle; }
        .note-editor ul ul ul { list-style: square; }
        .note-editor li { margin: 0.15rem 0; }
        /* Bold/italic — preflight can flatten these inside the editor, so set
           them explicitly. (font-weight: bolder resolves to 400 here.) */
        .note-editor b, .note-editor strong { font-weight: 700; }
        .note-editor i, .note-editor em { font-style: italic; }

        /* Dashed list: replace the default disc with an em-dash to match
           Note' "— Dashed List" option in the style picker. */
        .note-editor ul[data-style="dashed"] { list-style: none; padding-left: 1.2rem; }
        .note-editor ul[data-style="dashed"] > li { position: relative; padding-left: 0.6rem; }
        .note-editor ul[data-style="dashed"] > li::before {
          content: "—";
          position: absolute;
          left: -0.8rem;
          top: 0;
          color: var(--muted-foreground);
        }

        /* Tables — minimal Note-style ruled table. Editable cells.
           table-layout: fixed keeps columns evenly sized so typing into a
           cell doesn't widen its column and shift the grid; long content
           wraps inside the fixed width instead. */
        .note-editor table[data-note-table="true"] {
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0.5rem 0;
          width: 100%;
          max-width: 100%;
        }
        .note-editor table[data-note-table="true"] th,
        .note-editor table[data-note-table="true"] td {
          border: 1px solid var(--border);
          padding: 0.4rem 0.6rem;
          text-align: left;
          vertical-align: top;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .note-editor table[data-note-table="true"] th {
          font-weight: 600;
        }
        /* Rectangular cell selection (drag across cells) → merge candidate. */
        .note-editor table[data-note-table="true"] td[data-cell-sel="true"],
        .note-editor table[data-note-table="true"] th[data-cell-sel="true"] {
          background: color-mix(in srgb, var(--accent-default) 28%, transparent);
        }

        /* Alignment via data-align attribute (style="text-align" is normalized away) */
        .note-editor [data-align="center"] { text-align: center; }
        .note-editor [data-align="right"]  { text-align: right;  }

        /* Checklist row — visually identical to an ElementTableRow:
           [status ○] [AtomIcon] [text]. Both markers are pure CSS
           pseudo-elements. Every item is a task: un-linked items show the
           Backlog dashed ring; → Element 化 links one to an Element and the
           ○ then mirrors that Element's live status. */
        .note-editor ul[data-checklist="true"] {
          list-style: none;
          padding-left: 0.25rem;
        }
        .note-editor ul[data-checklist="true"] > li {
          position: relative;
          padding-left: 2.5rem; /* 16px checkbox + 6px gap + 14px atom + 4px gap */
          cursor: text;
        }
        /* ::before = the status ○. Default (un-linked) = Backlog dashed
           ring; the linked-bullet rules below override it per status. */
        .note-editor ul[data-checklist="true"] > li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0.5lh; /* center on the line — uses CSS lh unit so it tracks line-height */
          transform: translateY(-50%);
          width: 1rem;
          height: 1rem;
          cursor: default;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5' stroke-dasharray='2 2'/></svg>");
        }
        /* ::after = the AtomIcon (the same orbital marker used in Element List rows) */
        .note-editor ul[data-checklist="true"] > li::after {
          content: "";
          position: absolute;
          left: 1.4rem;
          top: 0.5lh;
          transform: translateY(-50%);
          width: 14px;
          height: 14px;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='2' fill='%23888' stroke='none'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5' transform='rotate(60 12 12)'/><ellipse cx='12' cy='12' rx='9.5' ry='3.5' transform='rotate(120 12 12)'/><circle cx='21.5' cy='12' r='1.2' fill='%23888' stroke='none'/><circle cx='6.8' cy='4.4' r='1.2' fill='%23888' stroke='none'/><circle cx='6.8' cy='19.6' r='1.2' fill='%23888' stroke='none'/></svg>");
        }
        /* Linked bullet — set by → Element 化. The checkbox ::before is
           replaced by a read-only ○ mirroring the linked Element's status
           (data-element-status, applied from live data; never persisted).
           A linked bullet is never struck through even if data-checked
           lingers from before it was linked. */
        .note-editor ul[data-checklist="true"] > li[data-element-id] {
          color: inherit;
          text-decoration: none;
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id]::before,
        .note-editor ul[data-checklist="true"] > li[data-element-id]:hover::before {
          cursor: default;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5' stroke-dasharray='2 2'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="todo"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="in_progress"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23d49a1a' stroke-width='1.5'/><path d='M8 8 L8 3.1 A4.9 4.9 0 0 1 8 12.9 Z' fill='%23d49a1a'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="review"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%233b82f6' stroke-width='1.5'/><circle cx='8' cy='8' r='2.6' fill='%233b82f6'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="done"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7.4' fill='%233d7a4a'/><path d='M4.5 8.3 L7 10.8 L11.5 5.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="blocked"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7.4' fill='%23f43f5e'/><path d='M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5' stroke='white' stroke-width='1.8' stroke-linecap='round'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="cancelled"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5'/><path d='M4.5 11.5 L11.5 4.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/></svg>");
        }
      `}</style>
    </>
  );
});

// =============================================================
// Floating toolbar — text-style dropdown + bold/italic/underline
// + alignment + lists + link.
// =============================================================
// =============================================================
// Table editing — pure DOM helpers used by the cell context menu.
// The grid is treated as a plain rectangle (column ops are index-based);
// horizontal merge adds colspan, which the sanitizer is taught to keep.
// =============================================================

function tblCellIndex(cell: HTMLTableCellElement): number {
  return Array.from(cell.parentElement?.children ?? []).indexOf(cell);
}
function tblNewCell(doc: Document, tag: 'td' | 'th'): HTMLTableCellElement {
  const c = doc.createElement(tag);
  c.appendChild(doc.createElement('br'));
  return c;
}
function tblColumnCount(table: Element): number {
  let max = 0;
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    let n = 0;
    for (const c of Array.from(row.children)) n += parseInt(c.getAttribute('colspan') || '1', 10);
    max = Math.max(max, n);
  }
  return max;
}

function tblDeleteRow(cell: HTMLTableCellElement) {
  const row = cell.parentElement as HTMLTableRowElement;
  const table = cell.closest('table')!;
  if (table.querySelectorAll('tr').length <= 1) { table.remove(); return; }
  row.remove();
}

function tblDeleteCol(cell: HTMLTableCellElement) {
  const table = cell.closest('table')!;
  if (tblColumnCount(table) <= 1) { table.remove(); return; }
  const idx = tblCellIndex(cell);
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    row.children[idx]?.remove();
  }
}

function tblMoveRow(cell: HTMLTableCellElement, dir: -1 | 1) {
  const row = cell.parentElement as HTMLTableRowElement;
  const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sib || sib.parentElement !== row.parentElement) return;
  if (dir < 0) row.parentElement!.insertBefore(row, sib);
  else row.parentElement!.insertBefore(sib, row);
}

function tblMoveCol(cell: HTMLTableCellElement, dir: -1 | 1) {
  const table = cell.closest('table')!;
  const idx = tblCellIndex(cell);
  const target = idx + dir;
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const a = row.children[idx];
    const b = row.children[target];
    if (!a || !b) continue;
    if (dir < 0) row.insertBefore(a, b);
    else row.insertBefore(b, a);
  }
}

// Cells touched by the current selection (drag across cells). Used to decide
// whether "結合する" is available and what to merge.
function tblSelectedCells(root: Element): HTMLTableCellElement[] {
  const sel = (root.ownerDocument.defaultView ?? window).getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  return Array.from(root.querySelectorAll<HTMLTableCellElement>('table[data-note-table="true"] td, table[data-note-table="true"] th'))
    .filter((c) => range.intersectsNode(c));
}

// Merge the bounding rectangle of the given cells into the top-left one,
// using colspan/rowspan. We span the whole bounding box (not just the linearly
// selected cells) so the result is always a clean rectangle even though an
// HTML text selection across a table is linear. Assumes the box has no
// pre-existing spans (DOM-index based).
function tblMergeCells(cells: HTMLTableCellElement[]) {
  if (cells.length < 2) return;
  const table = cells[0].closest('table');
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr'));
  const posOf = (cell: HTMLTableCellElement) => {
    const tr = cell.closest('tr')!;
    return { r: rows.indexOf(tr), c: Array.from(tr.children).indexOf(cell) };
  };
  const ps = cells.map(posOf);
  const minR = Math.min(...ps.map((p) => p.r)), maxR = Math.max(...ps.map((p) => p.r));
  const minC = Math.min(...ps.map((p) => p.c)), maxC = Math.max(...ps.map((p) => p.c));
  const anchor = rows[minR]?.children[minC] as HTMLTableCellElement | undefined;
  if (!anchor) return;
  const anchorEmpty = () => anchor.childNodes.length === 1 && anchor.firstChild?.nodeName === 'BR';
  for (let r = minR; r <= maxR; r++) {
    const tr = rows[r];
    // Walk right-to-left so removals don't shift the indices we still need.
    for (let c = maxC; c >= minC; c--) {
      const cell = tr?.children[c] as HTMLTableCellElement | undefined;
      if (!cell || cell === anchor) continue;
      const empty = cell.childNodes.length === 1 && cell.firstChild?.nodeName === 'BR';
      if (!empty) {
        if (anchorEmpty()) anchor.firstChild?.remove();
        while (cell.firstChild) anchor.appendChild(cell.firstChild);
      }
      cell.remove();
    }
  }
  const colspan = maxC - minC + 1, rowspan = maxR - minR + 1;
  if (colspan > 1) anchor.setAttribute('colspan', String(colspan)); else anchor.removeAttribute('colspan');
  if (rowspan > 1) anchor.setAttribute('rowspan', String(rowspan)); else anchor.removeAttribute('rowspan');
}

// Split a merged cell back into individual cells, refilling the spanned box.
function tblUnmerge(cell: HTMLTableCellElement) {
  const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
  const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
  if (colspan <= 1 && rowspan <= 1) return;
  const table = cell.closest('table')!;
  const rows = Array.from(table.querySelectorAll('tr'));
  const tr = cell.closest('tr')!;
  const rowIdx = rows.indexOf(tr);
  const colIdx = Array.from(tr.children).indexOf(cell);
  const doc = cell.ownerDocument;
  cell.removeAttribute('colspan');
  cell.removeAttribute('rowspan');
  // Anchor row: re-add the columns that were absorbed to its right.
  const isHead = tr.parentElement?.tagName === 'THEAD';
  for (let i = 1; i < colspan; i++) tr.insertBefore(tblNewCell(doc, isHead ? 'th' : 'td'), cell.nextSibling);
  // Rows below (rowspan): re-add a full run of cells at the anchor column.
  for (let r = 1; r < rowspan; r++) {
    const lower = rows[rowIdx + r];
    if (!lower) continue;
    const lowerHead = lower.parentElement?.tagName === 'THEAD';
    const ref = lower.children[colIdx] ?? null;
    for (let i = 0; i < colspan; i++) lower.insertBefore(tblNewCell(doc, lowerHead ? 'th' : 'td'), ref);
  }
}

// Index-based inserts used by the hover "+" handles (the context menu uses
// the cell-relative variants above).
function tblInsertColAtIndex(table: Element, index: number) {
  const doc = table.ownerDocument;
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const isHead = row.parentElement?.tagName === 'THEAD';
    row.insertBefore(tblNewCell(doc, isHead ? 'th' : 'td'), row.children[index] ?? null);
  }
}
function tblInsertRowAfter(rowEl: HTMLTableRowElement) {
  const table = rowEl.closest('table')!;
  const doc = table.ownerDocument;
  const tbody = table.querySelector('tbody') ?? table;
  const cols = tblColumnCount(table);
  const tr = doc.createElement('tr');
  for (let i = 0; i < cols; i++) tr.appendChild(tblNewCell(doc, 'td'));
  if (rowEl.parentElement?.tagName === 'THEAD') tbody.insertBefore(tr, tbody.firstChild);
  else rowEl.parentElement!.insertBefore(tr, rowEl.nextElementSibling);
}

export interface TableHandleGeom {
  table: HTMLTableElement;
  // Full-width "+" bar just below the table — appends a row at the end.
  bottomBar: { left: number; top: number; width: number; rowIndex: number };
  // Full-height "+" bar just right of the table — appends a column at the end.
  rightBar: { left: number; top: number; height: number; colIndex: number };
  // "+" at the nearest column gridline (only when the cursor is near one) —
  // inserts a column there, including between existing columns.
  col: { x: number; top: number; index: number } | null;
  // "+" at the nearest internal row gridline (between rows) — inserts there.
  rowBetween: { y: number; left: number; rowIndex: number } | null;
}

// Notion-style insert affordances. The bottom bar is always present while the
// table is hovered; the column/row "+" appear only as the cursor approaches a
// gridline, so a single "+" shows at the boundary you're pointing at rather
// than every boundary at once. Coordinates are relative to the editor's
// content box. The overlay is click-through except on the buttons.
function TableInsertHandles({
  geom,
  onInsertCol,
  onInsertRow,
}: {
  geom: TableHandleGeom;
  onInsertCol: (table: HTMLTableElement, index: number) => void;
  onInsertRow: (table: HTMLTableElement, rowIndex: number) => void;
}) {
  const dot =
    'pointer-events-auto absolute w-[18px] h-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-card border border-border text-muted-foreground shadow-sm flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all z-10';
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      <button
        type="button"
        title="行を追加"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onInsertRow(geom.table, geom.bottomBar.rowIndex)}
        className="pointer-events-auto absolute h-[16px] flex items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
        style={{ left: geom.bottomBar.left, top: geom.bottomBar.top + 4, width: geom.bottomBar.width }}
      >
        <Plus size={12} />
      </button>
      <button
        type="button"
        title="列を追加"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onInsertCol(geom.table, geom.rightBar.colIndex)}
        className="pointer-events-auto absolute w-[16px] flex items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
        style={{ left: geom.rightBar.left + 4, top: geom.rightBar.top, height: geom.rightBar.height }}
      >
        <Plus size={12} />
      </button>
      {geom.col && (
        <button
          type="button"
          title="列を追加"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertCol(geom.table, geom.col!.index)}
          className={dot}
          style={{ left: geom.col.x, top: geom.col.top }}
        >
          <Plus size={11} />
        </button>
      )}
      {geom.rowBetween && (
        <button
          type="button"
          title="行を追加"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertRow(geom.table, geom.rowBetween!.rowIndex)}
          className={dot}
          style={{ left: geom.rowBetween.left, top: geom.rowBetween.y }}
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  );
}

// A row of buttons in the table context menu.
function TblMenuItem({ label, onSelect, danger }: { label: string; onSelect: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left px-2.5 py-1 text-[12px] rounded transition-colors',
        danger ? 'text-red-500 hover:bg-red-500/10' : 'text-foreground/80 hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function TableContextMenu({
  x,
  y,
  canMerge,
  canUnmerge,
  onAction,
  onMerge,
  onClose,
}: {
  x: number;
  y: number;
  canMerge: boolean;
  canUnmerge: boolean;
  onAction: (op: (cell: HTMLTableCellElement) => void) => void;
  onMerge: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-table-menu]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Clamp horizontally so the menu stays on-screen.
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 320);

  return createPortal(
    <div
      data-table-menu
      className="fixed z-50 min-w-[180px] py-1 bg-popover border border-border rounded-lg shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {(canMerge || canUnmerge) && (
        <>
          {canMerge && <TblMenuItem label="セルを結合する" onSelect={onMerge} />}
          {canUnmerge && <TblMenuItem label="結合を解除" onSelect={() => onAction(tblUnmerge)} />}
          <TblDivider />
        </>
      )}
      <TblMenuItem label="行を上へ移動" onSelect={() => onAction((c) => tblMoveRow(c, -1))} />
      <TblMenuItem label="行を下へ移動" onSelect={() => onAction((c) => tblMoveRow(c, 1))} />
      <TblMenuItem label="列を左へ移動" onSelect={() => onAction((c) => tblMoveCol(c, -1))} />
      <TblMenuItem label="列を右へ移動" onSelect={() => onAction((c) => tblMoveCol(c, 1))} />
      <TblDivider />
      <TblMenuItem label="行を削除" danger onSelect={() => onAction(tblDeleteRow)} />
      <TblMenuItem label="列を削除" danger onSelect={() => onAction(tblDeleteCol)} />
      <TblMenuItem label="表を削除" danger onSelect={() => onAction((c) => c.closest('table')?.remove())} />
    </div>,
    document.body,
  );
}

function TblDivider() {
  return <div className="my-1 h-px bg-border" />;
}

function FloatingToolbar({
  x,
  y,
  onCommand,
  onChecklist,
  onLink,
  onToggleBlock,
}: {
  x: number;
  y: number;
  onCommand: (cmd: string, value?: string) => void;
  onChecklist: () => void;
  onLink: () => void;
  onToggleBlock: (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE') => void;
}) {
  // Constrain the toolbar to the viewport horizontally.
  const width = 444;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
  const top = Math.max(8, y - 40);

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg px-1 py-1"
      style={{ left, top, width }}
      onMouseDown={(e) => e.preventDefault() /* keep selection */}
    >
      <TbStyleDropdown onToggleBlock={onToggleBlock} />
      <TbDivider />
      <TbBtn icon={Bold} title="太字 (⌘B)" onClick={() => onCommand('bold')} />
      <TbBtn icon={Italic} title="斜体 (⌘I)" onClick={() => onCommand('italic')} />
      <TbBtn icon={UnderlineIcon} title="下線 (⌘U)" onClick={() => onCommand('underline')} />
      <TbBtn icon={Strikethrough} title="取り消し線" onClick={() => onCommand('strikeThrough')} />
      <TbDivider />
      <TbBtn icon={AlignLeft} title="左揃え" onClick={() => onCommand('justifyLeft')} />
      <TbBtn icon={AlignCenter} title="中央揃え" onClick={() => onCommand('justifyCenter')} />
      <TbBtn icon={AlignRight} title="右揃え" onClick={() => onCommand('justifyRight')} />
      <TbDivider />
      <TbBtn icon={List} title="箇条書き" onClick={() => onCommand('insertUnorderedList')} />
      <TbBtn icon={ListOrdered} title="番号付き" onClick={() => onCommand('insertOrderedList')} />
      <TbBtn icon={AtomIcon} title="チェックリスト" onClick={onChecklist} />
      <TbDivider />
      <TbBtn icon={Quote} title="引用" onClick={() => onToggleBlock('BLOCKQUOTE')} />
      <TbBtn icon={LinkIcon} title="リンク" onClick={onLink} />
    </div>
  );
}

function HeaderToolbar({
  onCommand,
  onChecklist,
  onLink,
  onToggleBlock,
  onInsertTable,
  onCaptureSelection,
}: {
  onCommand: (cmd: string, value?: string) => void;
  onChecklist: () => void;
  onLink: () => void;
  onToggleBlock: (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE') => void;
  onInsertTable: () => void;
  /** Snapshot the editor selection at pointer-down, before the click can
   *  collapse it. Runs in the capture phase so it fires before preventDefault. */
  onCaptureSelection: () => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 bg-card border border-border/60 shadow-md rounded-2xl px-1 py-0.5"
      onMouseDownCapture={onCaptureSelection}
      onMouseDown={(e) => e.preventDefault()}
    >
      <TbStyleDropdown onToggleBlock={onToggleBlock} />
      <TbDivider />
      <TbBtn icon={Bold} title="太字 (⌘B)" onClick={() => onCommand('bold')} />
      <TbBtn icon={Italic} title="斜体 (⌘I)" onClick={() => onCommand('italic')} />
      <TbBtn icon={UnderlineIcon} title="下線 (⌘U)" onClick={() => onCommand('underline')} />
      <TbBtn icon={Strikethrough} title="取り消し線" onClick={() => onCommand('strikeThrough')} />
      <TbDivider />
      <TbBtn icon={AlignLeft} title="左揃え" onClick={() => onCommand('justifyLeft')} />
      <TbBtn icon={AlignCenter} title="中央揃え" onClick={() => onCommand('justifyCenter')} />
      <TbBtn icon={AlignRight} title="右揃え" onClick={() => onCommand('justifyRight')} />
      <TbDivider />
      <TbBtn icon={List} title="箇条書き" onClick={() => onCommand('insertUnorderedList')} />
      <TbBtn icon={ListOrdered} title="番号付き" onClick={() => onCommand('insertOrderedList')} />
      <TbBtn icon={AtomIcon} title="チェックリスト" onClick={onChecklist} />
      <TbDivider />
      <TbBtn icon={Quote} title="引用" onClick={() => onToggleBlock('BLOCKQUOTE')} />
      <TbBtn icon={TableIcon} title="表" onClick={onInsertTable} />
      <TbBtn icon={LinkIcon} title="リンク" onClick={onLink} />
    </div>
  );
}

function TbBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-accent text-foreground/80 hover:text-foreground"
    >
      <Icon size={14} />
    </button>
  );
}

function TbDivider() {
  return <span className="w-px h-4 bg-border mx-0.5" />;
}

const STYLE_OPTIONS: { tag: 'P' | 'H1' | 'H2' | 'H3'; label: string; className: string }[] = [
  { tag: 'P', label: 'Regular text', className: 'text-[13px]' },
  { tag: 'H1', label: 'Heading 1', className: 'text-[15px] font-bold' },
  { tag: 'H2', label: 'Heading 2', className: 'text-[14px] font-semibold' },
  { tag: 'H3', label: 'Heading 3', className: 'text-[13px] font-semibold' },
];

// Text-style picker for the floating toolbar — a single "Aa" dropdown
// replacing separate heading buttons. Rendered inside the toolbar so the
// click's mousedown hits the toolbar's preventDefault and the editor
// selection survives long enough for formatBlock to apply.
function TbStyleDropdown({
  onToggleBlock,
}: {
  onToggleBlock: (tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Text style"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-0.5 h-7 px-1.5 rounded hover:bg-accent text-foreground/80 hover:text-foreground"
      >
        <span className="text-[13px] font-semibold leading-none">Aa</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 py-1 bg-popover border border-border rounded-lg shadow-xl min-w-[160px]">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.tag}
              type="button"
              onClick={() => { onToggleBlock(opt.tag); setOpen(false); }}
              className={`w-full flex items-center px-3 py-1.5 text-foreground hover:bg-accent transition-colors ${opt.className}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

// Block-level tags we treat as a "current block" for toggle behaviour
// in the floating toolbar. Excludes <li>: those are list items whose
// surrounding <ul>/<ol> already convey the style.
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

/** Returns the uppercase tag name of the innermost block-level
 *  ancestor of the current selection inside `root`, or null when the
 *  selection isn't in the editor. */
function currentBlockTag(root: HTMLElement | null): string | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (node.nodeType === 1 && BLOCK_TAGS.has((node as HTMLElement).tagName)) {
      return (node as HTMLElement).tagName;
    }
    node = node.parentNode;
  }
  return null;
}

/** True when the current selection sits inside an element with the
 *  given uppercase tag name (e.g. 'A' for links). */
function selectionHasAncestor(root: HTMLElement | null, tag: string): boolean {
  if (!root) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (node.nodeType === 1 && (node as HTMLElement).tagName === tag) return true;
    node = node.parentNode;
  }
  return false;
}

/** True when the given <li> contains a heading / quote / pre child —
 *  used to gate the "bullet → Element" right-click menu so that only
 *  Regular-text bullets can be turned into Elements. */
function liIsRegularText(li: HTMLLIElement): boolean {
  const STYLED = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
  for (const child of Array.from(li.children)) {
    if (STYLED.has(child.tagName)) return false;
  }
  return true;
}

// True when the editor holds no user content — blank text and no embedded
// media. Empty paragraphs, empty headings, and stray empty bullets all
// count as empty so the "Start writing…" placeholder shows.
function isEditorEmpty(el: HTMLElement): boolean {
  if ((el.textContent ?? '').replace(/\u200B/g, '').trim() !== '') return false;
  return !el.querySelector('img, table, hr');
}

// Move a run of block elements into a single checklist <ul>, one <li> per
// block, and return the new <li> nodes (in order). Shared by the checklist
// toggle and "→ Element 化" so the two stay in lock-step.
function wrapBlocksAsChecklist(blocks: HTMLElement[]): HTMLLIElement[] {
  if (blocks.length === 0) return [];
  const doc = blocks[0].ownerDocument;
  const ul = doc.createElement('ul');
  ul.setAttribute('data-checklist', 'true');
  blocks[0].parentElement!.insertBefore(ul, blocks[0]);
  const lis: HTMLLIElement[] = [];
  for (const b of blocks) {
    const li = doc.createElement('li');
    li.setAttribute('data-checked', 'false');
    li.innerHTML = b.innerHTML;
    ul.appendChild(li);
    b.remove();
    lis.push(li);
  }
  return lis;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// Convert any inline `style="text-align: x"` produced by execCommand justify*
// to `data-align="x"`. Keeps the DB shape consistent.
function normalizeAlignment(root: HTMLElement | null): void {
  if (!root) return;
  const all = root.querySelectorAll<HTMLElement>('[style*="text-align"]');
  for (const el of Array.from(all)) {
    const m = el.getAttribute('style')?.match(/text-align\s*:\s*(left|center|right)/i);
    if (!m) continue;
    const align = m[1].toLowerCase();
    el.style.removeProperty('text-align');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    if (align === 'left') el.removeAttribute('data-align');
    else el.setAttribute('data-align', align);
  }
}

// Find the block-level elements that the given range touches.
function collectSelectedBlocks(root: HTMLElement, range: Range): HTMLElement[] {
  const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV']);
  const startBlock = closestBlock(range.startContainer, root, blockTags);
  const endBlock = closestBlock(range.endContainer, root, blockTags);
  if (!startBlock) return [];
  if (startBlock === endBlock || !endBlock) return [startBlock];

  // Walk forward in document order from startBlock to endBlock.
  const all = Array.from(root.querySelectorAll<HTMLElement>('p, h1, h2, h3, li, blockquote, pre, div'));
  const startIdx = all.indexOf(startBlock);
  const endIdx = all.indexOf(endBlock);
  if (startIdx < 0 || endIdx < 0) return [startBlock];
  return all.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
}

function closestBlock(node: Node, root: HTMLElement, blockTags: Set<string>): HTMLElement | null {
  let cur: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (cur && cur !== root) {
    if (cur.nodeType === 1 && blockTags.has((cur as HTMLElement).tagName)) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return null;
}
