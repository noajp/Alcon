'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { downloadElementFile, elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';
import { officeKindOf, readOffice, type OfficePreview } from './officePreview';
import { readDeck, type Deck, type DeckItem, type TextBody } from './deckLayout';
import { readWorkbook, type WorkSheet } from './sheetLayout';
import { readDocLayout, type DocBlock, type DocLayout, type DocRun } from './docLayout';
import { fontStack } from './officeFonts';
import { presetPath } from './presetGeometry';
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

/** What a file reads to, for the kinds that are read rather than shown by
 *  the browser itself. */
interface Loaded { text?: string; office?: OfficePreview; workbook?: WorkSheet[]; doc?: DocLayout; deck?: Deck }

// A file's bytes never change (each upload gets a new path), so what it
// read to is kept for the session: reopening a preview is instant. Only the
// few most recent are kept, so memory stays bounded.
const READ_CACHE = new Map<string, Promise<Loaded>>();
const READ_CACHE_SIZE = 8;

/** Fetches a file through a signed link and reads it — text as text, a
 *  workbook, document or deck into its layout (with the text-only reading
 *  as the fallback where a layout will not read). */
function readFile(file: ElementFile, kind: Kind): Promise<Loaded> {
  const hit = READ_CACHE.get(file.id);
  if (hit) { READ_CACHE.delete(file.id); READ_CACHE.set(file.id, hit); return hit; }
  const officeKind = officeKindOf(file.name);
  const read = (async (): Promise<Loaded> => {
    const signed = await elementFileUrl(file);
    if (kind === 'text' || kind === 'html') return { text: (await (await fetch(signed)).text()).slice(0, 2_000_000) };
    const bytes = await (await fetch(signed)).arrayBuffer();
    if (officeKind === 'xlsx') return { workbook: await readWorkbook(bytes) };
    if (officeKind === 'docx') {
      const doc = await readDocLayout(bytes).catch(() => null);
      return doc ? { doc } : { office: await readOffice('docx', bytes) };
    }
    const deck = await readDeck(bytes).catch(() => null);
    return deck?.slides.length ? { deck } : { office: await readOffice('pptx', bytes) };
  })();
  read.catch(() => READ_CACHE.delete(file.id));
  READ_CACHE.set(file.id, read);
  while (READ_CACHE.size > READ_CACHE_SIZE) READ_CACHE.delete(READ_CACHE.keys().next().value!);
  return read;
}

export function ElementFilePreview({ file }: { file: ElementFile }) {
  const { t } = useI18n();
  const kind = kindOf(file);
  const officeKind = officeKindOf(file.name);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { text = null, office = null, workbook = null, doc: docLayout = null, deck = null } = loaded ?? {};
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); };
    if (kind === 'text' || kind === 'html' || kind === 'office') {
      readFile(file, kind).then((l) => { if (live) setLoaded(l); }).catch(fail);
    } else {
      // Shown by the browser itself (image, PDF, media) — only a link is needed.
      elementFileUrl(file).then((signed) => { if (live) setUrl(signed); }).catch(fail);
    }
    return () => { live = false; };
  }, [file, kind]);

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
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Download')} title={t('Download')}
          onClick={() => { void downloadElementFile(file).catch((e) => setError(e instanceof Error ? e.message : String(e))); }}>
          <Download size={13} />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" onClick={toggleFullscreen}
          aria-label={t(fullscreen ? 'Exit full screen' : 'Full screen')} title={t(fullscreen ? 'Exit full screen' : 'Full screen')}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Button>
      </div>
      <div className="h-full overflow-auto">
        {error ? (
          <p className="p-6 text-[13px] text-[var(--status-danger)]">{error}</p>
        ) : !url && !loaded ? spinner : kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url ?? undefined} alt={file.name} className="mx-auto max-h-full max-w-full object-contain p-4" />
        ) : kind === 'pdf' ? (
          <iframe src={url ?? undefined} title={file.name} className="h-full w-full border-0" />
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
          <video src={url ?? undefined} controls className="mx-auto max-h-full max-w-full p-4" />
        ) : kind === 'audio' ? (
          <div className="flex h-full items-center justify-center"><audio src={url ?? undefined} controls /></div>
        ) : kind === 'office' ? (
          officeKind === 'xlsx' ? (workbook ? <SheetView sheets={workbook} /> : spinner)
          : docLayout ? <DocView doc={docLayout} />
          : deck ? <DeckView deck={deck} present={fullscreen} />
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
 *  preview into full screen. (A deck that will not read is shown as its
 *  text instead — see readFile.) */
function DeckView({ deck, present }: { deck: Deck; present: boolean }) {
  return present ? <SlideShow deck={deck} /> : <DeckList deck={deck} />;
}

function DeckList({ deck }: { deck: Deck }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width ? Math.min(1.5, (width - 48) / deck.width) : 0;
  return (
    <div className="flex min-h-full flex-col bg-[var(--sheet-head)]">
      <div className="sticky top-0 z-20 h-1 shrink-0 bg-[var(--slide-accent)]" />
      <div ref={hostRef} className="flex flex-1 flex-col items-center gap-4 py-6">
        {!scale ? <Loader2 size={16} className="mt-10 animate-spin text-[var(--sheet-head-text)]" /> : deck.slides.map((slide, i) => (
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

/** A deck in full screen: one slide at a time, as large as the screen
 *  allows; arrow keys, Space, Page Up / Down, Home / End and a click move
 *  through it, with the slide number and arrows along the bottom. */
function SlideShow({ deck }: { deck: Deck }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0);
  const count = deck.slides.length;
  const go = (n: number) => setIndex(Math.max(0, Math.min(count - 1, n)));
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key);
      const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key);
      if (!next && !prev && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(count - 1, e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : next ? i + 1 : i - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);
  const slide = deck.slides[index];
  const scale = size.w ? Math.min((size.w - 48) / deck.width, (size.h - 24) / deck.height) : 0;
  return (
    <div className="flex h-full flex-col bg-[var(--sheet-text)]">
      <div ref={hostRef} className="flex min-h-0 flex-1 items-center justify-center" onClick={() => go(index + 1)}>
        {scale > 0 && slide && (
          <div className="relative overflow-hidden shadow-2xl" style={{ width: deck.width * scale, height: deck.height * scale }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: deck.width, height: deck.height, transform: `scale(${scale})`, background: slide.background ?? 'var(--sheet-paper)' }}>
              {slide.items.map((item, j) => <DeckItemView key={j} item={item} />)}
            </div>
          </div>
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center justify-center gap-3 text-[var(--sheet-paper)]">
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('Previous slide')} title={t('Previous slide')}
          className="flex size-7 items-center justify-center rounded-md opacity-80 transition-opacity hover:opacity-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
        <span className="min-w-14 text-center text-[12.5px] tabular-nums opacity-80">{index + 1} / {count}</span>
        <button type="button" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label={t('Next slide')} title={t('Next slide')}
          className="flex size-7 items-center justify-center rounded-md opacity-80 transition-opacity hover:opacity-100 disabled:opacity-30"><ChevronRight size={16} /></button>
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
        <p key={i} style={{
          textAlign: p.align, lineHeight: p.lineHeight ?? 1.2, margin: 0, minHeight: '1em', fontSize: `${(p.runs[0]?.size ?? 18) * 4 / 3}px`,
          paddingLeft: p.indent || undefined, textIndent: p.bullet && p.indent ? '-1em' : undefined, whiteSpace: text.wrap ? undefined : 'nowrap',
        }}>
          {p.bullet && <span style={{ color: p.runs[0]?.color ?? undefined }}>{p.bullet}{' '}</span>}
          {p.runs.map((run, j) => run.text === '\n' ? <br key={j} /> : (
            <span key={j} style={{
              fontSize: `${run.size * 4 / 3}px`, fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : undefined,
              textDecoration: run.underline ? 'underline' : undefined, color: run.color ?? 'var(--sheet-text)',
              fontFamily: fontStack(run.font) ?? undefined, letterSpacing: run.spacing ? `${run.spacing}px` : undefined,
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
    // A cropped picture: the whole image scaled so its kept part fills the
    // frame, shifted by the cropped-off share.
    const { l, t, r, b } = item.crop;
    const kw = 1 - l - r, kh = 1 - t - b;
    return (
      <div className="absolute overflow-hidden" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt="" className="absolute max-w-none"
          style={{ width: `${100 / (kw || 1)}%`, height: `${100 / (kh || 1)}%`, left: `${(-l / (kw || 1)) * 100}%`, top: `${(-t / (kh || 1)) * 100}%` }} />
      </div>
    );
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
  if (item.kind === 'chart') {
    return <div className="absolute" style={box}><SheetChartView chart={item.chart} framed={false} /></div>;
  }
  // A preset shape: its outline clips the fill (so gradients keep working),
  // an SVG draws the outline, its inner detail and any arrowheads, flipped
  // as the shape is; the text sits on top, unflipped.
  const geo = presetPath(item.geom, item.w, item.h, item.adj) ?? presetPath('rect', item.w, item.h)!;
  const stroke = item.stroke ?? (geo.line ? { color: null, width: 1, dash: false, head: false, tail: false } : null);
  const ink = stroke?.color ?? 'var(--sheet-text)';
  const flip = item.flipH || item.flipV ? `scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})` : undefined;
  const markerId = `m${Math.round(item.x)}-${Math.round(item.y)}-${Math.round(item.w)}`;
  return (
    <div className="absolute" style={box}>
      <div className="absolute inset-0" style={{ transform: flip }}>
        {!geo.line && item.fill && (
          <div className="absolute inset-0" style={{ background: item.fill, clipPath: `path(${geo.evenOdd ? 'evenodd, ' : ''}"${geo.fill}")` }} />
        )}
        {stroke && (
          <svg className="absolute inset-0 overflow-visible" width={item.w} height={item.h}>
            {(stroke.head || stroke.tail) && (
              <defs>
                <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 Z" style={{ fill: ink }} />
                </marker>
              </defs>
            )}
            <path d={geo.fill} fill="none" style={{ stroke: ink }} strokeWidth={stroke.width} strokeLinejoin="round"
              strokeDasharray={stroke.dash ? `${stroke.width * 3} ${stroke.width * 2}` : undefined}
              markerStart={stroke.head ? `url(#${markerId})` : undefined} markerEnd={stroke.tail ? `url(#${markerId})` : undefined} />
            {geo.detail && <path d={geo.detail} fill="none" style={{ stroke: ink }} strokeWidth={stroke.width} />}
          </svg>
        )}
      </div>
      {item.text && <DeckText text={item.text} />}
    </div>
  );
}

/** A document as Word lays it out: a white page at the document's width
 *  and margins on the grey canvas under Word's blue bar, scaled down to fit
 *  the preview; page breaks start a new sheet of paper. */
function DocView({ doc }: { doc: DocLayout }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pages: DocBlock[][] = [[]];
  for (const b of doc.blocks) {
    if (b.kind === 'break') pages.push([]);
    else pages[pages.length - 1].push(b);
  }
  const scale = width ? Math.min(1, (width - 48) / doc.width) : 0;

  // The document's embedded fonts, registered under the names its text
  // asks for, for as long as the preview is open.
  useEffect(() => {
    const faces = doc.fonts.map((f) => new FontFace(f.family, f.data, { weight: f.bold ? '700' : '400', style: f.italic ? 'italic' : 'normal' }));
    for (const face of faces) face.load().then(() => document.fonts.add(face)).catch(() => {});
    return () => { for (const face of faces) document.fonts.delete(face); };
  }, [doc.fonts]);

  return (
    <div className="flex min-h-full flex-col bg-[var(--sheet-head)]">
      <div className="sticky top-0 z-20 h-1 shrink-0 bg-[var(--doc-accent)]" />
      <div ref={hostRef} className="flex flex-1 flex-col items-center gap-4 py-6">
        {scale > 0 && pages.map((blocks, i) => (
          // zoom, not transform: the page's height follows the scale, so a
          // long page still pushes the next one down. Header and footer sit
          // in the margins; footnotes close the last page.
          <div key={i} className="relative flex shrink-0 flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)] shadow-md"
            style={{ width: doc.width, zoom: scale, padding: `${doc.margin.top}px ${doc.margin.right}px ${doc.margin.bottom}px ${doc.margin.left}px`, minHeight: doc.width * 1.414 }}>
            {doc.header.length > 0 && (
              <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ padding: `${Math.min(48, doc.margin.top / 2)}px ${doc.margin.right}px 0 ${doc.margin.left}px`, maxHeight: doc.margin.top }}>
                <DocBlocks blocks={doc.header} />
              </div>
            )}
            <div className="flow-root flex-1" style={{ columnCount: doc.columns > 1 ? doc.columns : undefined, columnGap: 32 }}>
              <DocBlocks blocks={blocks} />
            </div>
            {i === pages.length - 1 && doc.footnotes.length > 0 && (
              <div className="mt-6 border-t border-[var(--sheet-grid)] pt-2 text-[11px]">
                {doc.footnotes.map((note, n) => (
                  <div key={n} className="flex gap-1"><sup>{n + 1}</sup><div className="min-w-0 flex-1" style={{ zoom: 0.8 }}><DocBlocks blocks={note} /></div></div>
                ))}
              </div>
            )}
            {doc.footer.length > 0 && (
              <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ padding: `0 ${doc.margin.right}px ${Math.min(48, doc.margin.bottom / 2)}px ${doc.margin.left}px`, maxHeight: doc.margin.bottom }}>
                <DocBlocks blocks={doc.footer} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pure. Whether a #rrggbb fill is dark enough to need light text. */
function isDark(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return <>{blocks.map((b, i) => {
    if (b.kind === 'break') return null;
    if (b.kind === 'table') {
      return (
        <table key={i} className="my-1 border-collapse" style={{ tableLayout: 'fixed', width: b.cols.reduce((a, c) => a + c, 0) || '100%' }}>
          <colgroup>{b.cols.map((w, j) => <col key={j} style={{ width: w }} />)}</colgroup>
          <tbody>
            {b.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => cell.skip ? null : (
                  // Text left on "auto" colour turns light on a dark fill, as Word does.
                  <td key={c} colSpan={cell.span} rowSpan={cell.rowSpan} className="align-top"
                    style={{ background: cell.fill ?? undefined, color: cell.fill && isDark(cell.fill) ? 'var(--sheet-paper)' : undefined, border: cell.borders ? `1px solid ${cell.borderColor ?? 'var(--sheet-text)'}` : undefined, padding: '2px 7px' }}>
                    <DocBlocks blocks={cell.blocks} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    const size = b.runs.find((r) => r.text.trim())?.size ?? b.runs[0]?.size ?? 10.5;
    return (
      // A div, not a p: a paragraph may hold a text box with paragraphs of its own.
      <div key={i} style={{
        textAlign: b.align, margin: `${b.before}px 0 ${b.after}px`, paddingLeft: b.indent || undefined, textIndent: b.firstLine || undefined,
        lineHeight: b.line ? b.line * 1.15 : 1.15, minHeight: `${size * 4 / 3 * 1.15}px`, fontSize: `${size * 4 / 3}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }}>
        {b.marker && <span style={{ display: 'inline-block', minWidth: '1.5em' }}>{b.marker}</span>}
        {b.runs.map((run, j) => <DocRunView key={j} run={run} />)}
      </div>
    );
  })}</>;
}

function DocRunView({ run }: { run: DocRun }) {
  // A floating picture or box: floated to its side with the text running
  // around it, as Word wraps a square-wrapped drawing.
  const floatStyle = (f: 'left' | 'right' | null): React.CSSProperties => (f ? { float: f, margin: f === 'left' ? '0 12px 6px 0' : '0 0 6px 12px' } : {});
  if (run.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={run.image.src} alt="" className="inline-block max-w-full align-bottom" style={{ width: run.image.w || undefined, height: 'auto', ...floatStyle(run.image.float) }} />;
  }
  if (run.box) {
    return (
      <span className="inline-block border border-[var(--sheet-text)] p-2 align-top" style={{ width: run.box.w || undefined, maxWidth: '100%', ...floatStyle(run.box.float) }}>
        <DocBlocks blocks={run.box.blocks} />
      </span>
    );
  }
  return (
    <span style={{
      verticalAlign: run.script === 'super' ? 'super' : run.script === 'sub' ? 'sub' : undefined,
      ...(run.script ? { fontSize: `${run.size * 4 / 3 * 0.65}px` } : {}),
      fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? 'italic' : undefined,
      textDecoration: [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
      ...(run.script ? {} : { fontSize: `${run.size * 4 / 3}px` }), color: run.color ?? undefined, background: run.highlight ?? undefined,
      fontFamily: fontStack(run.font) ?? undefined,
    }}>{run.text === '\t' ? '\u2003' : run.text}</span>
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
                        return (
                          <td key={c} colSpan={cell?.colSpan} rowSpan={cell?.rowSpan} title={cell?.text || undefined}
                            className={`px-1 ${spill ? 'relative z-[1] overflow-visible' : 'overflow-hidden'}`}
                            style={{
                              border: `1px solid ${grid}`,
                              borderTop: st?.borders.top ?? undefined, borderRight: st?.borders.right ?? undefined,
                              borderBottom: st?.borders.bottom ?? undefined, borderLeft: st?.borders.left ?? undefined,
                              background: st?.bg ?? undefined, color: st?.color ?? undefined,
                              // A data bar fills the cell from the left by its share.
                              backgroundImage: cell?.bar ? `linear-gradient(90deg, ${cell.bar.color} ${cell.bar.pct * 100}%, transparent ${cell.bar.pct * 100}%)` : undefined,
                              fontWeight: st?.bold ? 700 : undefined, fontStyle: st?.italic ? 'italic' : undefined,
                              textDecoration: [st?.underline && 'underline', st?.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                              fontSize: st?.size ? `${st.size * 4 / 3}px` : undefined,
                              fontFamily: fontStack(st?.font) ?? undefined,
                              textAlign: st?.align ?? (cell?.numeric ? 'right' : 'left'),
                              verticalAlign: st?.valign ?? 'bottom',
                              whiteSpace: st?.wrap ? 'normal' : 'nowrap',
                              fontVariantNumeric: cell?.numeric ? 'tabular-nums' : undefined,
                            }}>
                            {cell?.runs ? cell.runs.map((run, k) => (
                              <span key={k} style={{
                                fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined,
                                color: run.color ?? undefined, fontSize: run.size ? `${run.size * 4 / 3}px` : undefined, fontFamily: fontStack(run.font) ?? undefined,
                              }}>{run.text}</span>
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
