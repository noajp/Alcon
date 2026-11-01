'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';
import { officeKindOf, readOffice, type OfficePreview } from './officePreview';
import { readDeck, type Deck, type DeckItem, type TextBody } from './deckLayout';
import { readWorkbook, type WorkSheet } from './sheetLayout';
import SheetChartView from './SheetChart';

// An attached file, previewed in place under its row (the row's ▶ opens it): images and PDFs as themselves,
// text as text, audio and video in their players, and Word / Excel /
// PowerPoint as what they say (officePreview — read here, never handed to a
// viewer service). Anything else offers to open it in a new tab. The file
// is read through a short-lived signed link.

type Kind = 'image' | 'pdf' | 'html' | 'text' | 'video' | 'audio' | 'office' | 'other';

function kindOf(file: ElementFile): Kind {
  const mime = file.mime_type ?? '';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (officeKindOf(file.name)) return 'office';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime === 'text/html' || ext === 'html' || ext === 'htm') return 'html';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['md', 'markdown', 'txt', 'csv', 'json', 'log', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'other';
}

export function ElementFilePreview({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const kind = kindOf(file);
  const officeKind = officeKindOf(file.name);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [office, setOffice] = useState<OfficePreview | null>(null);
  const [workbook, setWorkbook] = useState<WorkSheet[] | null>(null);
  const [deck, setDeck] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let live = true;
    elementFileUrl(file)
      .then(async (signed) => {
        if (!live) return;
        setUrl(signed);
        if (kind === 'text' || kind === 'html') {
          const body = await (await fetch(signed)).text();
          if (live) setText(body.slice(0, 2_000_000));
        } else if (kind === 'office') {
          const bytes = await (await fetch(signed)).arrayBuffer();
          // A deck is laid out as slides (DeckView); its text is read too,
          // as the fallback should the layout fail.
          if (officeKind === 'xlsx') {
            const sheets = await readWorkbook(bytes);
            if (live) setWorkbook(sheets);
            return;
          }
          if (officeKind === 'pptx' && live) setDeck(bytes);
          const read = await readOffice(officeKind!, bytes);
          if (live) setOffice(read);
        }
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [file, kind, officeKind]);

  // Full screen is the app's own layer over the whole window, not the
  // browser's Fullscreen API — that is refused inside embedded browsers
  // (the desktop app's pane among them).
  useEffect(() => {
    if (!fullscreen) return;
    // Captured first and stopped, so Esc leaves full screen only — the page
    // under it (which closes on Esc) never sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullscreen]);
  const toggleFullscreen = () => setFullscreen((f) => !f);
  const spinner = <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>;
  const zoomable = kind === 'html';

  const frame = (
    <div
      className={fullscreen
        ? 'group/preview fixed inset-0 z-[100] overflow-hidden bg-background'
        : 'group/preview relative mt-1 h-[480px] overflow-hidden rounded-lg border border-border/60 bg-background'}>
      {/* Tools float over the preview's corner and show on hover: zoom for
          a page, full screen for everything. */}
      <div className={`absolute right-2 top-2.5 z-30 flex items-center gap-0.5 rounded-md border border-border/60 bg-[var(--surface-overlay)] p-0.5 shadow-sm transition-opacity ${fullscreen ? '' : 'opacity-0 group-hover/preview:opacity-100 focus-within:opacity-100'}`}>
        {zoomable && <>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom <= 0.25}
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}><Minus size={13} /></Button>
          <button type="button" onClick={() => setZoom(1)} title={t('Reset zoom')} aria-label={t('Reset zoom')}
            className="h-6 min-w-11 rounded px-1 text-[11.5px] tabular-nums text-muted-foreground transition-colors hover:bg-[var(--surface-strong)] hover:text-foreground">
            {Math.round(zoom * 100)}%
          </button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom >= 3}
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))}><Plus size={13} /></Button>
          <span className="mx-0.5 h-4 w-px bg-border/60" />
        </>}
        <Button type="button" variant="ghost" size="icon-xs" onClick={toggleFullscreen}
          aria-label={t(fullscreen ? 'Exit full screen' : 'Full screen')} title={t(fullscreen ? 'Exit full screen' : 'Full screen')}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Button>
      </div>
      <div className="h-full overflow-auto">
        {error ? (
          <p className="p-6 text-[13px] text-[var(--status-danger)]">{error}</p>
        ) : !url ? spinner : kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="mx-auto max-h-full max-w-full object-contain p-4" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={file.name} className="h-full w-full border-0" />
        ) : kind === 'html' ? (
          // The page as it is, scripts and all, in a sandbox with no origin of
          // its own: it can run, but cannot reach this app, its storage or
          // the person's session. (Storage serves HTML as text, so the page
          // is handed over as srcdoc rather than by its link.) Zoom scales
          // the frame and gives it the room the scale takes away, so the page
          // lays itself out for a wider or narrower window.
          text === null ? spinner : (
            <iframe srcDoc={text} sandbox="allow-scripts" title={file.name}
              style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
              className="border-0 bg-[var(--sheet-paper)]" />
          )
        ) : kind === 'video' ? (
          <video src={url} controls className="mx-auto max-h-full max-w-full p-4" />
        ) : kind === 'audio' ? (
          <div className="flex h-full items-center justify-center"><audio src={url} controls /></div>
        ) : kind === 'office' ? (
          officeKind === 'xlsx' ? (workbook ? <SheetView sheets={workbook} /> : spinner)
          : deck ? <DeckView bytes={deck} fallback={office ? <OfficeView preview={office} /> : spinner} />
            : office === null ? spinner : <OfficeView preview={office} />
        ) : kind === 'text' ? (
          text === null ? spinner
            : <pre className="whitespace-pre-wrap break-words p-6 font-mono text-[12.5px] leading-relaxed text-foreground">{text}</pre>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
            <p>{t('This file cannot be previewed here.')}</p>
            <Button variant="secondary" size="sm" onClick={() => { void openElementFile(file); }}>
              <ExternalLink size={13} />{t('Open in new tab')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
  // In full screen the frame is portalled to <body>, so no ancestor's
  // transform or overflow can clip the fixed layer; a quiet placeholder
  // keeps the row's place meanwhile.
  return fullscreen
    ? <><div className="mt-1 h-[480px] rounded-lg border border-dashed border-border/60" />{createPortal(frame, document.body)}</>
    : frame;
}

/** A deck as its slides — shapes, colours, pictures, type, tables, where
 *  the deck puts them (deckLayout) — on the grey canvas under PowerPoint's
 *  orange bar, one after another at the width of the preview; each slide
 *  is drawn at the deck's size and scaled to fit, so it follows the
 *  preview into full screen. Should a deck not read, its text is shown. */
function DeckView({ bytes, fallback }: { bytes: ArrayBuffer; fallback: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    readDeck(bytes).then((d) => { if (live) setDeck(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (failed || deck?.slides.length === 0) return <>{fallback}</>;
  const scale = deck && width ? Math.min(1.5, (width - 48) / deck.width) : 0;
  return (
    <div className="flex min-h-full flex-col bg-[var(--sheet-head)]">
      <div className="sticky top-0 z-20 h-1 shrink-0 bg-[var(--slide-accent)]" />
      <div ref={hostRef} className="flex flex-1 flex-col items-center gap-4 py-6">
        {!deck || !scale ? <Loader2 size={16} className="mt-10 animate-spin text-[var(--sheet-head-text)]" /> : deck.slides.map((slide, i) => (
          <div key={i} className="relative shrink-0 overflow-hidden shadow-md" style={{ width: deck.width * scale, height: deck.height * scale }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: deck.width, height: deck.height, transform: `scale(${scale})`, background: slide.background ?? 'var(--sheet-paper)' }}>
              {slide.items.map((item, j) => <DeckItemView key={j} item={item} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeckText({ text }: { text: TextBody }) {
  const [t, r, b, l] = text.inset;
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ padding: `${t}px ${r}px ${b}px ${l}px`, justifyContent: text.anchor === 'middle' ? 'center' : text.anchor === 'bottom' ? 'flex-end' : 'flex-start', writingMode: text.vertical ? 'vertical-rl' : undefined }}>
      {text.paras.map((p, i) => (
        <p key={i} style={{ textAlign: p.align, lineHeight: p.lineHeight ?? 1.2, margin: 0, minHeight: '1em', fontSize: `${(p.runs[0]?.size ?? 18) * 4 / 3}px` }}>
          {p.bullet && '• '}
          {p.runs.map((run, j) => run.text === '\n' ? <br key={j} /> : (
            <span key={j} style={{
              fontSize: `${run.size * 4 / 3}px`, fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : undefined,
              textDecoration: run.underline ? 'underline' : undefined, color: run.color ?? 'var(--sheet-text)',
              fontFamily: run.font ? `"${run.font}", sans-serif` : undefined, letterSpacing: run.spacing ? `${run.spacing}px` : undefined,
              whiteSpace: 'pre-wrap',
            }}>{run.text}</span>
          ))}
        </p>
      ))}
    </div>
  );
}

function DeckItemView({ item }: { item: DeckItem }) {
  const box: React.CSSProperties = { left: item.x, top: item.y, width: item.w, height: item.h, transform: item.rot ? `rotate(${item.rot}deg)` : undefined };
  if (item.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.src} alt="" className="absolute object-fill" style={box} />;
  }
  if (item.kind === 'table') {
    return (
      <table className="absolute border-collapse" style={{ ...box, tableLayout: 'fixed' }}>
        <colgroup>{item.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <tbody>
          {item.rows.map((row, i) => (
            <tr key={i} style={{ height: row.h }}>
              {row.cells.map((cell, j) => cell.skip ? null : (
                <td key={j} colSpan={cell.span} className="relative align-top" style={{ background: cell.fill ?? undefined }}>
                  <DeckText text={cell.text} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (item.geom === 'line') {
    const s = item.stroke ?? { color: null, width: 1, dash: false };
    const [x1, x2] = item.flipH ? [item.w, 0] : [0, item.w];
    const [y1, y2] = item.flipV ? [item.h, 0] : [0, item.h];
    return (
      <svg className="absolute overflow-visible" style={box}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: s.color ?? 'var(--sheet-text)' }} strokeWidth={s.width} strokeDasharray={s.dash ? `${s.width * 3} ${s.width * 2}` : undefined} />
      </svg>
    );
  }
  return (
    <div className="absolute" style={{
      ...box, background: item.fill ?? undefined,
      border: item.stroke ? `${item.stroke.width}px ${item.stroke.dash ? 'dashed' : 'solid'} ${item.stroke.color ?? 'var(--sheet-text)'}` : undefined,
      borderRadius: item.geom === 'ellipse' ? '50%' : item.geom === 'roundRect' ? Math.min(item.w, item.h) * 0.16 : undefined,
      boxSizing: 'border-box',
    }}>
      {item.text && <DeckText text={item.text} />}
    </div>
  );
}

/** What an Office file says: a document's paragraphs, a workbook's sheets
 *  (one tab each), a deck's slides as numbered cards. */
function OfficeView({ preview }: { preview: OfficePreview }) {
  if (preview.kind === 'docx') {
    return (
      <article className="mx-auto max-w-3xl space-y-2 px-8 py-8 text-[14px] leading-relaxed text-foreground">
        {preview.paragraphs.map((p, i) => p.heading
          ? <h3 key={i} className={`${p.heading === 1 ? 'text-[18px]' : 'text-[15px]'} pt-2 font-semibold`}>{p.text}</h3>
          : p.text ? <p key={i} className="whitespace-pre-wrap">{p.text}</p> : <div key={i} className="h-2" />)}
      </article>
    );
  }
  return (
    <div className="min-h-full bg-[var(--sheet-head)]">
    <div className="sticky top-0 z-20 h-1 bg-[var(--slide-accent)]" />
    <div className="mx-auto grid max-w-4xl gap-3 p-6">
      {preview.slides.map((s, i) => (
        <section key={i} className="rounded-md bg-[var(--sheet-paper)] p-4 text-[var(--sheet-text)] shadow-sm">
          <div className="mb-2 text-[11px] tabular-nums text-[var(--sheet-head-text)]">{i + 1}</div>
          {s.lines.length === 0
            ? <p className="text-[13px] text-[var(--sheet-head-text)]">—</p>
            : s.lines.map((line, j) => <p key={j} className={j === 0 ? 'text-[15px] font-semibold' : 'text-[13px]'}>{line}</p>)}
        </section>
      ))}
    </div>
    </div>
  );
}

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
 *  sheets as tabs along the bottom. */
function SheetView({ sheets }: { sheets: WorkSheet[] }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  const head = 'sticky z-10 border-b border-r border-[var(--sheet-grid)] bg-[var(--sheet-head)] text-[11px] font-normal text-[var(--sheet-head-text)]';
  const rowCount = sheet ? Math.max(sheet.rows.length + 5, 30, ...sheet.charts.map((c) => {
    let y = 0, r = 0;
    while (y < c.y + c.h) { y += sheet.rows[r]?.h ?? sheet.defaultRow; r++; }
    return r + 2;
  })) : 0;
  const grid = sheet?.gridLines ? 'var(--sheet-grid)' : 'transparent';
  return (
    <div className="flex h-full flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)]">
      <div className="h-1 shrink-0 bg-[var(--sheet-accent)]" />
      <div className="min-h-0 flex-1 overflow-auto">
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
                {Array.from({ length: rowCount }, (_, r) => {
                  const row = sheet.rows[r];
                  return (
                    <tr key={r} style={{ height: row?.h ?? sheet.defaultRow }}>
                      <th className={`${head} left-0 px-1 text-center tabular-nums`}>{r + 1}</th>
                      {sheet.cols.map((_, c) => {
                        const cell = row?.cells[c];
                        if (cell?.hidden) return null;
                        const st = cell?.style;
                        // Text runs on over empty neighbours, as in Excel;
                        // it is cut where the next cell holds something.
                        const next = row?.cells[c + 1];
                        const spill = !!cell?.text && !st?.wrap && !cell.numeric && (st?.align ?? 'left') === 'left' && !next?.text && !next?.hidden;
                        return (
                          <td key={c} colSpan={cell?.colSpan} rowSpan={cell?.rowSpan} title={cell?.text || undefined}
                            className={`px-1 ${spill ? 'relative z-[1] overflow-visible' : 'overflow-hidden'}`}
                            style={{
                              border: `1px solid ${grid}`,
                              borderTop: st?.borders.top ?? undefined, borderRight: st?.borders.right ?? undefined,
                              borderBottom: st?.borders.bottom ?? undefined, borderLeft: st?.borders.left ?? undefined,
                              background: st?.bg ?? undefined, color: st?.color ?? undefined,
                              fontWeight: st?.bold ? 700 : undefined, fontStyle: st?.italic ? 'italic' : undefined,
                              textDecoration: [st?.underline && 'underline', st?.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                              fontSize: st?.size ? `${st.size * 4 / 3}px` : undefined,
                              fontFamily: st?.font ? `"${st.font}", var(--font-sans)` : undefined,
                              textAlign: st?.align ?? (cell?.numeric ? 'right' : 'left'),
                              verticalAlign: st?.valign ?? 'bottom',
                              whiteSpace: st?.wrap ? 'normal' : 'nowrap',
                              fontVariantNumeric: cell?.numeric ? 'tabular-nums' : undefined,
                            }}>
                            {cell?.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
