'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, List, ListOrdered,
  ChevronDown, Quote, Link as LinkIcon, Plus,
} from '@/ui/icons';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Align, BlockTag, ListKind } from './commands';

// The Note editor's menus: the toolbar over selected text, "/", a table
// cell's right-click menu and the "+" beside a table.

// ── Toolbar over selected text ───────────────────────────────────────────

export type Mark = 'bold' | 'italic' | 'underline' | 'strike';

export function FloatingToolbar({ x, y, markdownOnly, onMark, onAlign, onList, onBlock, onLink }: {
  x: number;
  y: number;
  /** Text kept as Markdown: no underline or alignment, which it cannot say. */
  markdownOnly?: boolean;
  onMark: (mark: Mark) => void;
  onAlign: (align: Align) => void;
  onList: (kind: ListKind) => void;
  onBlock: (tag: BlockTag) => void;
  onLink: () => void;
}) {
  const width = markdownOnly ? 330 : 444;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
  const top = Math.max(8, y - 40);
  return createPortal(
    <div className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg"
      style={{ left, top, width }}
      onMouseDown={(e) => e.preventDefault() /* keep the selection */}>
      <TbStyleDropdown onBlock={onBlock} />
      <TbDivider />
      <TbBtn icon={Bold} title="Bold (⌘B)" onClick={() => onMark('bold')} />
      <TbBtn icon={Italic} title="Italic (⌘I)" onClick={() => onMark('italic')} />
      {!markdownOnly && <TbBtn icon={UnderlineIcon} title="Underline (⌘U)" onClick={() => onMark('underline')} />}
      <TbBtn icon={Strikethrough} title="Strikethrough" onClick={() => onMark('strike')} />
      <TbDivider />
      {!markdownOnly && <>
        <TbBtn icon={AlignLeft} title="Align left" onClick={() => onAlign('left')} />
        <TbBtn icon={AlignCenter} title="Align center" onClick={() => onAlign('center')} />
        <TbBtn icon={AlignRight} title="Align right" onClick={() => onAlign('right')} />
        <TbDivider />
      </>}
      <TbBtn icon={List} title="Bulleted list" onClick={() => onList('bullet')} />
      <TbBtn icon={ListOrdered} title="Numbered list" onClick={() => onList('numbered')} />
      <TbBtn icon={ElementIcon} title="Checklist" onClick={() => onList('check')} />
      <TbDivider />
      <TbBtn icon={Quote} title="Quote" onClick={() => onBlock('BLOCKQUOTE')} />
      <TbBtn icon={LinkIcon} title="Link" onClick={onLink} />
    </div>,
    document.body,
  );
}

function TbBtn({ icon: Icon, title, onClick }: { icon: React.ComponentType<{ size?: number }>; title: string; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" title={t(title)} aria-label={t(title)} onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-foreground/80 hover:bg-accent hover:text-foreground">
      <Icon size={14} />
    </button>
  );
}

function TbDivider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
}

const STYLE_OPTIONS: { tag: BlockTag; label: string; className: string }[] = [
  { tag: 'P', label: 'Regular text', className: 'text-[13px]' },
  { tag: 'H1', label: 'Heading 1', className: 'text-[15px] font-bold' },
  { tag: 'H2', label: 'Heading 2', className: 'text-[14px] font-semibold' },
  { tag: 'H3', label: 'Heading 3', className: 'text-[13px] font-semibold' },
];

function TbStyleDropdown({ onBlock }: { onBlock: (tag: BlockTag) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" title={t('Text style')} aria-label={t('Text style')} onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center justify-center gap-0.5 rounded px-1.5 text-foreground/80 hover:bg-accent hover:text-foreground">
        <span className="text-[13px] font-semibold leading-none">Aa</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 min-w-[160px] rounded-lg border border-border bg-popover py-1 shadow-xl">
          {STYLE_OPTIONS.map((opt) => (
            <button key={opt.tag} type="button" onClick={() => { onBlock(opt.tag); setOpen(false); }}
              className={`flex w-full items-center px-3 py-1.5 text-foreground transition-colors hover:bg-accent ${opt.className}`}>
              {t(opt.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── "/" ──────────────────────────────────────────────────────────────────

/** One thing "/" offers. */
export interface SlashItem {
  id: string; group: string; label: string; hint?: string; icon: ReactNode;
  /** Words that also find it. */
  keywords?: string;
  /** Its label and hint are already in the reader's language (a page's own block). */
  translated?: boolean;
  run: (at: { x: number; y: number }) => void;
}

const SLASH_MENU_HEIGHT = 340;

export function filterSlash(items: SlashItem[], query: string, t: (s: string) => string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => `${item.translated ? item.label : t(item.label)} ${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(q));
}

export function SlashMenu({ x, y, query, items, index, onHover, onPick, onClose }: {
  x: number; y: number; query: string; items: SlashItem[]; index: number;
  onHover: (i: number) => void; onPick: (item: SlashItem) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  // Opens upward when the line is low on the screen.
  const top = y + SLASH_MENU_HEIGHT > window.innerHeight ? Math.max(8, y - SLASH_MENU_HEIGHT - 28) : y;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onMouseDown={(e) => { e.preventDefault(); onClose(); }} />
      <div role="listbox" aria-label={t('Insert a block')}
        className="fixed z-50 w-64 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl"
        style={{ left: Math.min(x, window.innerWidth - 272), top, maxHeight: SLASH_MENU_HEIGHT }}
        onMouseDown={(e) => e.preventDefault()}>
        {query && <p className="px-3 pb-1 pt-0.5 text-[11.5px] text-muted-foreground">/{query}</p>}
        {items.map((item, i) => (
          <div key={item.id}>
            {!query && item.group !== items[i - 1]?.group && (
              <p className={`px-3 pb-1 text-[11px] font-medium text-muted-foreground ${i ? 'mt-1 border-t border-border/50 pt-2' : 'pt-1'}`}>{t(item.group)}</p>
            )}
            <button type="button" role="option" aria-selected={i === index}
              ref={i === index ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseEnter={() => { if (i !== index) onHover(i); }}
              onClick={() => onPick(item)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === index ? 'bg-muted' : ''}`}>
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-foreground">{item.translated ? item.label : t(item.label)}</span>
                {item.hint && <span className="block truncate text-[11px] text-muted-foreground">{item.translated ? item.hint : t(item.hint)}</span>}
              </span>
            </button>
          </div>
        ))}
        {!items.length && <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('Nothing matches.')}</p>}
      </div>
    </>,
    document.body,
  );
}

// ── A table cell's right-click menu ──────────────────────────────────────

export type TableAction = 'merge' | 'split' | 'row-up' | 'row-down' | 'col-left' | 'col-right' | 'delete-row' | 'delete-col' | 'delete-table';

export function TableContextMenu({ x, y, canMerge, canSplit, onAction, onClose }: {
  x: number; y: number; canMerge: boolean; canSplit: boolean;
  onAction: (action: TableAction) => void; onClose: () => void;
}) {
  useEscapeLayer(true, onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-table-menu]')) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 320);
  return createPortal(
    <div data-table-menu className="fixed z-50 w-max min-w-[180px] rounded-lg border border-border bg-popover py-1 shadow-xl"
      style={{ left, top }} onMouseDown={(e) => e.preventDefault()}>
      {(canMerge || canSplit) && <>
        {canMerge && <TblMenuItem label="Merge cells" onSelect={() => onAction('merge')} />}
        {canSplit && <TblMenuItem label="Split cell" onSelect={() => onAction('split')} />}
        <TblDivider />
      </>}
      <TblMenuItem label="Move row up" onSelect={() => onAction('row-up')} />
      <TblMenuItem label="Move row down" onSelect={() => onAction('row-down')} />
      <TblMenuItem label="Move column left" onSelect={() => onAction('col-left')} />
      <TblMenuItem label="Move column right" onSelect={() => onAction('col-right')} />
      <TblDivider />
      <TblMenuItem label="Delete row" danger onSelect={() => onAction('delete-row')} />
      <TblMenuItem label="Delete column" danger onSelect={() => onAction('delete-col')} />
      <TblMenuItem label="Delete table" danger onSelect={() => onAction('delete-table')} />
    </div>,
    document.body,
  );
}

function TblMenuItem({ label, onSelect, danger }: { label: string; onSelect: () => void; danger?: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onSelect}
      className={['w-full rounded px-2.5 py-1 text-left text-[12px] transition-colors',
        danger ? 'text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10' : 'text-foreground/80 hover:bg-accent hover:text-foreground'].join(' ')}>
      {t(label)}
    </button>
  );
}

function TblDivider() {
  return <div className="my-1 h-px bg-border" />;
}

// ── "+" beside a table ───────────────────────────────────────────────────

export interface TableHandles {
  table: HTMLTableElement;
  /** Below the table, when the pointer is in its last row: adds a row at the end. */
  bottomBar: { left: number; top: number; width: number; rowIndex: number } | null;
  /** Right of the table, when the pointer is in its last column: adds a column at the end. */
  rightBar: { left: number; top: number; height: number; colIndex: number } | null;
  /** At the column line nearest the pointer: adds a column there. */
  col: { x: number; top: number; index: number } | null;
  /** At the row line nearest the pointer: adds a row there. */
  rowBetween: { y: number; left: number; rowIndex: number } | null;
}

/** Pure but for layout. Where the "+" go for the table under the pointer,
 *  relative to `frame`; null when the pointer is not near a table. */
export function measureTableHandles(root: HTMLElement, frame: HTMLElement, clientX: number, clientY: number): TableHandles | null {
  const M = 28;
  const table = Array.from(root.querySelectorAll<HTMLTableElement>('table')).find((t) => {
    const r = t.getBoundingClientRect();
    return clientX >= r.left - M && clientX <= r.right + M && clientY >= r.top - M && clientY <= r.bottom + M;
  });
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll('tr'));
  const headerCells = Array.from(rows[0]?.children ?? []);
  if (!rows.length || !headerCells.length) return null;
  const er = frame.getBoundingClientRect();
  const top = rows[0].getBoundingClientRect().top - er.top;
  const left = headerCells[0].getBoundingClientRect().left - er.left;
  const colXs: { x: number; index: number }[] = [];
  let idx = 0;
  for (const c of headerCells) {
    colXs.push({ x: c.getBoundingClientRect().left - er.left, index: idx });
    idx += parseInt(c.getAttribute('colspan') || '1', 10);
  }
  const rightX = headerCells[headerCells.length - 1].getBoundingClientRect().right - er.left;
  const rowBottoms = rows.map((tr, j) => ({ y: tr.getBoundingClientRect().bottom - er.top, rowIndex: j }));
  const tableBottom = rowBottoms[rowBottoms.length - 1].y;
  const SNAP = 12;
  const relX = clientX - er.left;
  const relY = clientY - er.top;
  let col: TableHandles['col'] = null;
  { let bd = SNAP; for (const c of colXs) { const d = Math.abs(c.x - relX); if (d < bd) { bd = d; col = { x: c.x, top, index: c.index }; } } }
  let rowBetween: TableHandles['rowBetween'] = null;
  { let bd = SNAP; for (let j = 0; j < rowBottoms.length - 1; j++) { const d = Math.abs(rowBottoms[j].y - relY); if (d < bd) { bd = d; rowBetween = { y: rowBottoms[j].y, left, rowIndex: j }; } } }
  const lastRowTop = rowBottoms.length >= 2 ? rowBottoms[rowBottoms.length - 2].y : top;
  const lastColLeft = colXs[colXs.length - 1]?.x ?? left;
  return {
    table,
    bottomBar: relY >= lastRowTop ? { left, top: tableBottom, width: rightX - left, rowIndex: rows.length - 1 } : null,
    rightBar: relX >= lastColLeft ? { left: rightX, top, height: tableBottom - top, colIndex: idx } : null,
    col,
    rowBetween,
  };
}

/** Pure. What tells one placing of the "+" from another. */
export const handlesKey = (h: TableHandles | null) => (h ? [
  h.col?.index ?? '-', h.rowBetween?.rowIndex ?? '-',
  ...[h.col?.x, h.col?.top, h.rowBetween?.y, h.rowBetween?.left, h.bottomBar?.left, h.bottomBar?.top, h.bottomBar?.width,
    h.rightBar?.left, h.rightBar?.top, h.rightBar?.height].map((n) => (n === undefined ? '-' : Math.round(n))),
].join('|') : '');

export function TableInsertHandles({ geom, onInsertCol, onInsertRow }: {
  geom: TableHandles;
  onInsertCol: (table: HTMLTableElement, index: number) => void;
  /** Adds a row after row `rowIndex`. */
  onInsertRow: (table: HTMLTableElement, rowIndex: number) => void;
}) {
  const { t } = useI18n();
  const dot = 'pointer-events-auto absolute z-10 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-70 shadow-sm transition-all hover:border-primary hover:bg-primary hover:text-primary-foreground hover:opacity-100';
  const bar = 'flex items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground';
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {geom.bottomBar && (
        <button type="button" title={t('Add row')} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertRow(geom.table, geom.bottomBar!.rowIndex)}
          className={`pointer-events-auto absolute h-[16px] ${bar}`}
          style={{ left: geom.bottomBar.left, top: geom.bottomBar.top + 4, width: geom.bottomBar.width }}>
          <Plus size={12} />
        </button>
      )}
      {geom.rightBar && (
        <div className="pointer-events-auto absolute flex items-stretch"
          style={{ left: geom.rightBar.left, top: geom.rightBar.top, width: 20, height: geom.rightBar.height }}>
          <button type="button" title={t('Add column')} onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsertCol(geom.table, geom.rightBar!.colIndex)} className={`ml-1 w-[16px] ${bar}`}>
            <Plus size={12} />
          </button>
        </div>
      )}
      {geom.col && (
        <button type="button" title={t('Add column')} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertCol(geom.table, geom.col!.index)} className={dot} style={{ left: geom.col.x, top: geom.col.top }}>
          <Plus size={11} />
        </button>
      )}
      {geom.rowBetween && (
        <button type="button" title={t('Add row')} onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsertRow(geom.table, geom.rowBetween!.rowIndex)} className={dot} style={{ left: geom.rowBetween.left, top: geom.rowBetween.y }}>
          <Plus size={11} />
        </button>
      )}
    </div>
  );
}
