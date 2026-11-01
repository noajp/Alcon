'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Cell, WorkSheet } from './sheetLayout';
import type { EditSession } from './officeEdits';
import { cellRef, cellValue, refPosition, type SheetChanges } from './officeDiff';
import { runCss } from './officeViewParts';
import SheetChartView from './SheetChart';

const rawOf = cellValue;

/** Pure. A column's letters, as Excel heads it (0 → A, 26 → AA). */
function columnName(i: number): string {
  let name = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const HEAD_W = 40;
const HEAD_H = 24;

/** A workbook as Excel draws it: Excel's green bar along the top; each
 *  cell with the workbook's own fill, font, borders, alignment and number
 *  format, at its column width and row height, merged cells merged; the
 *  gridlines only where the sheet shows them; its charts over the cells
 *  where the sheet places them; lettered columns, numbered rows, and the
 *  sheets as tabs along the bottom. The grid runs on past the sheet's own
 *  columns and rows to fill the view, as Excel's does.
 *
 *  With an edit session it works as Excel does: a click selects a cell and
 *  the arrows, Tab and Enter move the selection; typing replaces what the
 *  cell holds, Enter, F2 or a double-click edits it in place, Delete empties
 *  it, Esc while typing leaves it as it was. A formula's cell keeps its
 *  formula. */
export function SheetView({ sheets, edit = null, changes = null }: {
  sheets: WorkSheet[]; edit?: EditSession | null;
  /** Cells that differ from another version: changed ringed amber, filled-in green. */
  changes?: SheetChanges | null;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  // The selected cell, on its sheet, in this editing session; `typing` when
  // it was opened to edit what it holds (a double-click). `seq` makes a fresh
  // box each time the same cell is selected again.
  const [sel, setSelAt] = useState<{ session: string; sheet: number; r: number; c: number; typing: boolean; seq: number } | null>(null);
  const sheet = sheets[active];
  const at = edit && sel?.session === edit.id && sel.sheet === active ? sel : null;
  // Only the rows in sight (and a margin) are drawn; spacer rows keep the
  // scroll height true. A merge reaching into sight from above is drawn
  // from its first row.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, h: 800, w: 1200 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, h: el.clientHeight, w: el.clientWidth }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Scrolling re-reads the view only every so far (the rows drawn reach well
  // past it), not on every pixel — a redraw per pixel is what made it heavy.
  const lastTop = useRef(0);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (Math.abs(el.scrollTop - lastTop.current) < 240) return;
    lastTop.current = el.scrollTop;
    setView({ top: el.scrollTop, h: el.clientHeight, w: el.clientWidth });
  };
  const commit = (r: number, c: number, cell: Cell | undefined, value: string) => {
    if (!edit || !sheet) return;
    edit.set({ kind: 'cell', sheet: sheet.name, ref: cellRef(r, c), from: rawOf(cell), to: value });
  };
  // The sheet's columns, then empty ones of the default width to fill the view.
  const cols = useMemo(() => {
    if (!sheet) return [];
    const out = [...sheet.cols];
    const width = sheet.defaultCol || 64;
    let total = out.reduce((a, b) => a + b, 0);
    while (total < view.w + width * 2 || out.length < 10) { out.push(width); total += width; }
    return out;
  }, [sheet, view.w]);
  const head = 'sticky z-10 border-b border-r border-[var(--sheet-grid)] bg-[var(--sheet-head)] text-[11px] font-normal text-[var(--sheet-head-text)]';
  // Rows run on past the sheet's (in steps of 50, as the view scrolls down).
  const reach = Math.ceil((view.top + view.h * 2) / (sheet?.defaultRow || 20) / 50) * 50;
  const rowCount = sheet ? Math.max(sheet.rows.length + 5, reach, ...sheet.charts.map((c) => {
    let y = 0, r = 0;
    while (y < c.y + c.h) { y += sheet.rows[r]?.h ?? sheet.defaultRow; r++; }
    return r + 2;
  })) : 0;
  const grid = sheet?.gridLines ? 'var(--sheet-grid)' : 'transparent';

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [active]);
  const rowH = (r: number) => sheet?.rows[r]?.h ?? sheet?.defaultRow ?? 20;
  const tops = useMemo(() => {
    const out = [0];
    for (let r = 0; r < rowCount; r++) out.push(out[r] + (sheet?.rows[r]?.h ?? sheet?.defaultRow ?? 20));
    return out;
  }, [sheet, rowCount]);
  let first = 0, last = rowCount;
  {
    const from = view.top - HEAD_H - 600, to = view.top + view.h + 600;
    while (first < rowCount && tops[first + 1] < from) first++;
    last = first;
    while (last < rowCount && tops[last] < to) last++;
    for (let r = first - 1; r >= Math.max(0, first - 200); r--) {
      if (sheet?.rows[r]?.cells.some((c) => c && c.rowSpan > 1 && r + c.rowSpan > first)) first = r;
    }
  }
  const spacer = (h: number, key: string) => h > 0 ? <tr key={key} aria-hidden><td colSpan={cols.length + 1} style={{ height: h, padding: 0, border: 0 }} /></tr> : null;

  const select = (r: number, c: number, typing = false) => {
    if (edit) setSelAt((prev) => ({ session: edit.id, sheet: active, r: Math.max(0, r), c: Math.max(0, c), typing, seq: (prev?.seq ?? 0) + 1 }));
  };
  // Rows are drawn by a memoized row, so a selection or an edit redraws only
  // the rows it touches; the handlers it is handed never change identity.
  const latest = useRef({ select, commit, sheet });
  useEffect(() => { latest.current = { select, commit, sheet }; });
  const onSelect = useCallback((r: number, c: number, typing?: boolean) => latest.current.select(r, c, typing), []);
  const onCommit = useCallback((r: number, c: number, value: string) => latest.current.commit(r, c, latest.current.sheet?.rows[r]?.cells[c], value), []);
  const byRow = (entries: Iterable<[string, string]>) => {
    const out = new Map<number, Map<number, string>>();
    for (const [ref, v] of entries) {
      const at = refPosition(ref);
      if (!at) continue;
      if (!out.has(at[0])) out.set(at[0], new Map());
      out.get(at[0])!.set(at[1], v);
    }
    return out;
  };
  const pendingByRow = useMemo(() => byRow(edit && sheet
    ? [...edit.pending.values()].flatMap((e) => (e.kind === 'cell' && e.sheet === sheet.name ? [[e.ref, e.to] as [string, string]] : []))
    : []), [edit, sheet]);
  const changedByRow = useMemo(() => byRow(sheet ? changes?.cells.get(sheet.name)?.entries() ?? [] : []), [changes, sheet]);
  // The selection stays in sight.
  useEffect(() => {
    if (at) scrollRef.current?.querySelector(`[data-cell="${at.r}:${at.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [at]);

  return (
    <div className="flex h-full flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)]">
      <div className="h-1 shrink-0 bg-[var(--sheet-accent)]" />
      <div ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto outline-none">
        {!sheet ? <p className="p-4 text-[13px]">{t('This sheet is empty.')}</p> : (
          <div className="relative w-max">
            <table className="border-collapse text-[12.5px]" style={{ tableLayout: 'fixed', width: HEAD_W + cols.reduce((a, b) => a + b, 0) }}>
              <colgroup>
                <col style={{ width: HEAD_W }} />
                {cols.map((w, c) => <col key={c} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr style={{ height: HEAD_H }}>
                  <th className={`${head} top-0 left-0 z-20`} />
                  {cols.map((w, c) => <th key={c} className={`${head} top-0 overflow-hidden text-center`}>{w > 12 ? columnName(c) : ''}</th>)}
                </tr>
              </thead>
              <tbody>
                {spacer(tops[first], 'above')}
                {Array.from({ length: last - first }, (_, i) => {
                  const r = first + i;
                  return (
                    <SheetRow key={r} r={r} row={sheet.rows[r]} h={rowH(r)} cols={cols} grid={grid} head={head} editable={!!edit}
                      chosen={at?.r === r ? at : null} pending={pendingByRow.get(r)} changed={changedByRow.get(r)}
                      onSelect={onSelect} onCommit={onCommit} />
                  );
                })}
                {spacer(tops[rowCount] - tops[last], 'below')}
              </tbody>
            </table>
            {sheet.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`img${i}`} src={img.src} alt="" className="absolute z-[5]" style={{ left: HEAD_W + img.x, top: HEAD_H + img.y, width: img.w, height: img.h }} />
            ))}
            {sheet.charts.map((chart, i) => (
              <div key={i} className="absolute z-[5]" style={{ left: HEAD_W + chart.x, top: HEAD_H + chart.y, width: chart.w, height: chart.h }}>
                <SheetChartView chart={chart} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-t border-[var(--sheet-grid)] bg-[var(--sheet-head)] pl-10">
        {sheets.map((s, i) => (
          <button key={i} type="button" onClick={() => setActive(i)} aria-pressed={i === active}
            className={`whitespace-nowrap border-b-2 px-4 text-[12px] transition-colors ${i === active
              ? 'border-[var(--sheet-accent)] bg-[var(--sheet-paper)] font-semibold text-[var(--sheet-accent)]'
              : 'border-transparent text-[var(--sheet-head-text)] hover:bg-[var(--sheet-paper)]'}`}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SheetRowProps {
  r: number; row: WorkSheet['rows'][number] | undefined; h: number; cols: number[]; grid: string; head: string; editable: boolean;
  /** The selection, when it is in this row. */
  chosen: { c: number; seq: number; typing: boolean } | null;
  /** This row's unsaved edits, and its changes from another version (column → value / value before). */
  pending: Map<number, string> | undefined; changed: Map<number, string> | undefined;
  onSelect: (r: number, c: number, typing?: boolean) => void;
  onCommit: (r: number, c: number, value: string) => void;
}

/** One row of the grid. Memoized: it redraws only when its own cells, its
 *  edits, its changes or the selection in it change. */
const SheetRow = memo(function SheetRow({ r, row, h, cols, grid, head, editable, chosen, pending, changed, onSelect, onCommit }: SheetRowProps) {
  const { t } = useI18n();
  return (
    <tr style={{ height: h }}>
      <th className={`${head} left-0 px-1 text-center tabular-nums`}>{r + 1}</th>
      {cols.map((_, c) => {
        const cell = row?.cells[c];
        if (cell?.hidden) return null;
        const st = cell?.style;
        // Text runs on over empty neighbours, as in Excel;
        // it is cut where the next cell holds something.
        const next = row?.cells[c + 1];
        const spill = !!cell?.text && !st?.wrap && !cell.numeric && (st?.align ?? 'left') === 'left' && !next?.text && !next?.hidden;
        const edited = pending?.get(c);
        const isChosen = chosen?.c === c;
        const locked = !!cell?.formula;
        const was = changed?.get(c);
        const look: CSSProperties = {
          ...(st ? runCss(st) : {}),
          textAlign: st?.align ?? (cell?.numeric ? 'right' : 'left'),
          fontVariantNumeric: cell?.numeric ? 'tabular-nums' : undefined,
        };
        return (
          <td key={c} colSpan={cell?.colSpan} rowSpan={cell?.rowSpan}
            title={was !== undefined ? t('Before: {value}', { value: was || t('(empty)') }) : editable && locked ? t('A formula cannot be edited here yet.') : cell?.text || undefined}
            data-cell={`${r}:${c}`}
            onClick={editable ? () => { if (!isChosen) onSelect(r, c); } : undefined}
            onDoubleClick={editable && !locked ? () => onSelect(r, c, true) : undefined}
            className={`px-1 ${isChosen ? 'relative' : spill ? 'relative z-[1] overflow-visible' : 'overflow-hidden'}`}
            style={{
              // An edited cell, until it is saved, is ringed in the sheet's colour.
              boxShadow: edited !== undefined ? 'inset 0 0 0 2px var(--sheet-accent)'
                : was !== undefined ? `inset 0 0 0 2px ${was ? 'var(--status-warning)' : 'var(--status-success)'}` : undefined,
              cursor: editable ? 'cell' : undefined,
              // The selected cell, outlined as Excel does.
              outline: isChosen ? '2px solid var(--sheet-accent)' : undefined, outlineOffset: isChosen ? -2 : undefined,
              // Longhands only: React warns when a shorthand and its
              // longhands change together between renders.
              borderTop: st?.borders.top ?? `1px solid ${grid}`, borderRight: st?.borders.right ?? `1px solid ${grid}`,
              borderBottom: st?.borders.bottom ?? `1px solid ${grid}`, borderLeft: st?.borders.left ?? `1px solid ${grid}`,
              ...look,
              backgroundColor: st?.bg ?? undefined,
              // A data bar fills the cell from the left by its share.
              backgroundImage: cell?.bar ? `linear-gradient(90deg, ${cell.bar.color} ${cell.bar.pct * 100}%, transparent ${cell.bar.pct * 100}%)` : undefined,
              verticalAlign: st?.valign ?? 'bottom',
              whiteSpace: st?.wrap ? 'normal' : 'nowrap',
            }}>
            {edited !== undefined ? edited : cell?.runs ? cell.runs.map((run, k) => (
              <span key={k} style={runCss(run)}>{run.text}</span>
            )) : cell?.text}
            {isChosen && (
              <CellBox key={chosen.seq} raw={edited ?? rawOf(cell)} startTyping={chosen.typing} locked={locked}
                look={{ ...look, backgroundColor: st?.bg ?? 'var(--sheet-paper)' }}
                onCommit={(value) => onCommit(r, c, value)}
                onMove={(dr, dc) => onSelect(r + dr, c + dc)} />
            )}
          </td>
        );
      })}
    </tr>
  );
});

/**
 * The selected cell's own box, as Excel's: always there and focused, unseen
 * until something is typed. A key (or an IME composition) starts typing
 * over what the cell holds; Enter or F2 opens what it holds to edit. While
 * not typing, the arrows, Tab and Enter move the selection and Delete
 * empties the cell; Esc then belongs to the page (ending the editing).
 * While typing, Enter and Tab keep the value and move on, Esc drops it.
 */
function CellBox({ raw, startTyping, locked, look, onCommit, onMove }: {
  raw: string; startTyping: boolean; locked: boolean;
  /** The cell's own look, so typing shows as the cell will. */
  look: CSSProperties;
  onCommit: (value: string) => void; onMove: (dr: number, dc: number) => void;
}) {
  const [typing, setTyping] = useState(startTyping && !locked);
  const [value, setValue] = useState(startTyping && !locked ? raw : '');
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const open = (v: string) => {
    if (locked) return;
    setTyping(true);
    setValue(v);
    requestAnimationFrame(() => ref.current?.setSelectionRange(v.length, v.length));
  };
  const keep = (dr: number, dc: number) => { onCommit(value); onMove(dr, dc); };
  return (
    <input ref={ref} value={value} aria-label="cell"
      onChange={(e) => { if (locked) return; if (!typing) setTyping(true); setValue(e.target.value); }}
      onCompositionStart={() => { if (!typing && !locked) setTyping(true); }}
      onBlur={() => { if (typing) onCommit(value); }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        const step: [number, number] | null = e.key === 'Enter' ? [e.shiftKey ? -1 : 1, 0] : e.key === 'Tab' ? [0, e.shiftKey ? -1 : 1] : null;
        if (typing) {
          if (step) { e.preventDefault(); keep(...step); }
          else if (e.key === 'Escape') { e.preventDefault(); setTyping(false); setValue(''); }
          return;
        }
        const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (e.key === 'F2' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey)) { e.preventDefault(); open(raw); }
        else if (arrows[e.key] || step) { e.preventDefault(); onMove(...(arrows[e.key] ?? step!)); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && !locked) { e.preventDefault(); onCommit(''); }
      }}
      style={typing ? look : { opacity: 0, caretColor: 'transparent', pointerEvents: 'none' }}
      className="absolute inset-0 z-20 m-0 w-full border-0 px-1 outline outline-2 -outline-offset-2 outline-[var(--sheet-accent)]" />
  );
}
