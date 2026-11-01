'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Cell, WorkSheet } from './sheetLayout';
import { cellKey, type EditSession } from './officeEdits';
import { cellRef, cellValue, type SheetChanges } from './officeDiff';
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
 *  sheets as tabs along the bottom. With an edit session, a double-click
 *  types into a cell (Enter goes down, Tab across, Esc leaves it as it
 *  was); a formula's cell keeps its formula. */
export function SheetView({ sheets, edit = null, changes = null }: {
  sheets: WorkSheet[]; edit?: EditSession | null;
  /** Cells that differ from another version: changed ringed amber, filled-in green. */
  changes?: SheetChanges | null;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  // The cell being typed in, on the sheet it belongs to.
  const [typing, setTypingAt] = useState<{ sheet: number; r: number; c: number } | null>(null);
  const setTyping = (at: { r: number; c: number } | null) => setTypingAt(at ? { sheet: active, ...at } : null);
  const sheet = sheets[active];
  const commit = (r: number, c: number, cell: Cell | undefined, value: string) => {
    if (!edit || !sheet) return;
    edit.set({ kind: 'cell', sheet: sheet.name, ref: cellRef(r, c), from: rawOf(cell), to: value });
  };
  const head = 'sticky z-10 border-b border-r border-[var(--sheet-grid)] bg-[var(--sheet-head)] text-[11px] font-normal text-[var(--sheet-head-text)]';
  const rowCount = sheet ? Math.max(sheet.rows.length + 5, 30, ...sheet.charts.map((c) => {
    let y = 0, r = 0;
    while (y < c.y + c.h) { y += sheet.rows[r]?.h ?? sheet.defaultRow; r++; }
    return r + 2;
  })) : 0;
  const grid = sheet?.gridLines ? 'var(--sheet-grid)' : 'transparent';

  // Only the rows in sight (and a margin) are drawn; spacer rows keep the
  // scroll height true. A merge reaching into sight from above is drawn
  // from its first row.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, h: 800 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [active]);
  const rowH = (r: number) => sheet?.rows[r]?.h ?? sheet?.defaultRow ?? 20;
  const tops = useMemo(() => {
    const out = [0];
    for (let r = 0; r < rowCount; r++) out.push(out[r] + (sheet?.rows[r]?.h ?? sheet?.defaultRow ?? 20));
    return out;
  }, [sheet, rowCount]);
  let first = 0, last = rowCount;
  if (rowCount > 200) {
    const from = view.top - HEAD_H - 400, to = view.top + view.h + 400;
    while (first < rowCount && tops[first + 1] < from) first++;
    last = first;
    while (last < rowCount && tops[last] < to) last++;
    for (let r = first - 1; r >= Math.max(0, first - 200); r--) {
      if (sheet?.rows[r]?.cells.some((c) => c && c.rowSpan > 1 && r + c.rowSpan > first)) first = r;
    }
  }
  const spacer = (h: number, key: string) => h > 0 ? <tr key={key} aria-hidden><td colSpan={(sheet?.cols.length ?? 0) + 1} style={{ height: h, padding: 0, border: 0 }} /></tr> : null;

  return (
    <div className="flex h-full flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)]">
      <div className="h-1 shrink-0 bg-[var(--sheet-accent)]" />
      <div ref={scrollRef} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })} className="min-h-0 flex-1 overflow-auto">
        {!sheet ? <p className="p-4 text-[13px]">{t('This sheet is empty.')}</p> : (
          <div className="relative w-max">
            <table className="border-collapse text-[12.5px]" style={{ tableLayout: 'fixed', width: HEAD_W + sheet.cols.reduce((a, b) => a + b, 0) }}>
              <colgroup>
                <col style={{ width: HEAD_W }} />
                {sheet.cols.map((w, c) => <col key={c} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr style={{ height: HEAD_H }}>
                  <th className={`${head} top-0 left-0 z-20`} />
                  {sheet.cols.map((w, c) => <th key={c} className={`${head} top-0 overflow-hidden text-center`}>{w > 12 ? columnName(c) : ''}</th>)}
                </tr>
              </thead>
              <tbody>
                {spacer(tops[first], 'above')}
                {Array.from({ length: last - first }, (_, i) => {
                  const r = first + i;
                  const row = sheet.rows[r];
                  return (
                    <tr key={r} style={{ height: rowH(r) }}>
                      <th className={`${head} left-0 px-1 text-center tabular-nums`}>{r + 1}</th>
                      {sheet.cols.map((_, c) => {
                        const cell = row?.cells[c];
                        if (cell?.hidden) return null;
                        const st = cell?.style;
                        // Text runs on over empty neighbours, as in Excel;
                        // it is cut where the next cell holds something.
                        const next = row?.cells[c + 1];
                        const spill = !!cell?.text && !st?.wrap && !cell.numeric && (st?.align ?? 'left') === 'left' && !next?.text && !next?.hidden;
                        const pending = edit?.pending.get(cellKey(sheet.name, cellRef(r, c)));
                        const here = !!edit && typing?.sheet === active && typing.r === r && typing.c === c;
                        const locked = !!cell?.formula;
                        const was = changes?.cells.get(sheet.name)?.get(cellRef(r, c));
                        return (
                          <td key={c} colSpan={cell?.colSpan} rowSpan={cell?.rowSpan}
                            title={was !== undefined ? t('Before: {value}', { value: was || t('(empty)') }) : edit && locked ? t('A formula cannot be edited here yet.') : cell?.text || undefined}
                            onDoubleClick={edit && !locked ? () => setTyping({ r, c }) : undefined}
                            className={`px-1 ${here ? 'relative' : spill ? 'relative z-[1] overflow-visible' : 'overflow-hidden'}`}
                            style={{
                              // An edited cell, until it is saved, is ringed in the sheet's colour.
                              boxShadow: pending ? 'inset 0 0 0 2px var(--sheet-accent)'
                                : was !== undefined ? `inset 0 0 0 2px ${was ? 'var(--status-warning)' : 'var(--status-success)'}` : undefined,
                              cursor: edit ? (locked ? 'not-allowed' : 'cell') : undefined,
                              // Longhands only: React warns when a shorthand and its
                              // longhands change together between renders.
                              borderTop: st?.borders.top ?? `1px solid ${grid}`, borderRight: st?.borders.right ?? `1px solid ${grid}`,
                              borderBottom: st?.borders.bottom ?? `1px solid ${grid}`, borderLeft: st?.borders.left ?? `1px solid ${grid}`,
                              ...(st ? runCss(st) : {}),
                              backgroundColor: st?.bg ?? undefined,
                              // A data bar fills the cell from the left by its share.
                              backgroundImage: cell?.bar ? `linear-gradient(90deg, ${cell.bar.color} ${cell.bar.pct * 100}%, transparent ${cell.bar.pct * 100}%)` : undefined,
                              textAlign: st?.align ?? (cell?.numeric ? 'right' : 'left'),
                              verticalAlign: st?.valign ?? 'bottom',
                              whiteSpace: st?.wrap ? 'normal' : 'nowrap',
                              fontVariantNumeric: cell?.numeric ? 'tabular-nums' : undefined,
                            }}>
                            {here ? (
                              <CellInput initial={pending?.to ?? rawOf(cell)}
                                onDone={(value, move) => {
                                  if (value !== null) commit(r, c, cell, value);
                                  // Moving on stops at a formula's cell, which is not typed in.
                                  const to = move ? { r: Math.max(0, r + move[0]), c: Math.max(0, c + move[1]) } : null;
                                  setTyping(to && !sheet.rows[to.r]?.cells[to.c]?.formula ? to : null);
                                }} />
                            ) : pending ? pending.to : cell?.runs ? cell.runs.map((run, k) => (
                              <span key={k} style={runCss(run)}>{run.text}</span>
                            )) : cell?.text}
                          </td>
                        );
                      })}
                    </tr>
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

/** The box a cell is typed in. Done with the value (null: left unchanged)
 *  and where to go next ([rows, columns]), if anywhere. */
function CellInput({ initial, onDone }: { initial: string; onDone: (value: string | null, move?: [number, number]) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null, move?: [number, number]) => {
    if (done.current) return;
    done.current = true;
    onDone(v, move);
  };
  return (
    <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(value, [e.shiftKey ? -1 : 1, 0]); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(value, [0, e.shiftKey ? -1 : 1]); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      }}
      className="absolute inset-0 z-20 w-full bg-[var(--sheet-paper)] px-1 text-inherit outline outline-2 outline-[var(--sheet-accent)]" />
  );
}
