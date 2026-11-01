'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Deck, DeckItem, DeckSlide, TextBody } from './deckLayout';
import { presetPath } from './presetGeometry';
import SheetChartView from './SheetChart';
import { EditableRuns, OfficeCanvas, runCss, useElementSize } from './officeViewParts';
import { slideTextKey, type EditSession } from './officeEdits';

/** A deck as its slides — shapes, colours, pictures, type, tables, where
 *  the deck puts them (deckLayout) — on the grey canvas under PowerPoint's
 *  orange bar, one after another at the width of the preview; each slide
 *  is drawn at the deck's size and scaled to fit, so it follows the
 *  preview into full screen. (A deck that will not read is shown as its
 *  text instead — see readFile.) With an edit session, a slide's own
 *  paragraphs of plain text can be typed over in place. */
export function DeckView({ deck, present, edit = null }: { deck: Deck; present: boolean; edit?: EditSession | null }) {
  return present ? <SlideShow deck={deck} /> : <DeckList deck={deck} edit={edit} />;
}

/** Where a slide's text can be typed: the session, and which slide. */
interface SlideEdit { edit: EditSession; slide: number }

function DeckList({ deck, edit }: { deck: Deck; edit: EditSession | null }) {
  return (
    <OfficeCanvas accent="var(--slide-accent)">
      {(width) => {
        const scale = Math.min(1.5, (width - 48) / deck.width);
        return deck.slides.map((slide, i) => <Slide key={i} deck={deck} slide={slide} scale={scale} className="shadow-md" editAt={edit ? { edit, slide: i } : null} />);
      }}
    </OfficeCanvas>
  );
}

/** One slide, drawn at the deck's size and scaled. */
function Slide({ deck, slide, scale, className, editAt = null }: { deck: Deck; slide: DeckSlide; scale: number; className: string; editAt?: SlideEdit | null }) {
  return (
    <div className={`relative shrink-0 overflow-hidden ${className}`} style={{ width: deck.width * scale, height: deck.height * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: deck.width, height: deck.height, transform: `scale(${scale})`, background: slide.background ?? 'var(--sheet-paper)' }}>
        {slide.items.map((item, j) => <DeckItemView key={j} item={item} editAt={editAt} />)}
      </div>
    </div>
  );
}

/** A deck in full screen: one slide at a time, as large as the screen
 *  allows; arrow keys, Space, Page Up / Down, Home / End and a click move
 *  through it, with the slide number and arrows along the bottom. */
function SlideShow({ deck }: { deck: Deck }) {
  const { t } = useI18n();
  const [hostRef, size] = useElementSize<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  const count = deck.slides.length;
  const go = (n: number) => setIndex(Math.max(0, Math.min(count - 1, n)));
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
        {scale > 0 && slide && <Slide deck={deck} slide={slide} scale={scale} className="shadow-2xl" />}
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

function DeckText({ text, editAt = null, shape }: { text: TextBody; editAt?: SlideEdit | null; shape?: string }) {
  const { t: tr } = useI18n();
  const [t, r, b, l] = text.inset;
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ padding: `${t}px ${r}px ${b}px ${l}px`, justifyContent: text.anchor === 'middle' ? 'center' : text.anchor === 'bottom' ? 'flex-end' : 'flex-start', writingMode: text.vertical ? 'vertical-rl' : undefined }}>
      {text.paras.map((p, i) => (
        <p key={i} title={editAt && shape && p.src === undefined && p.runs.some((x) => x.text.trim()) ? tr('This paragraph has a line break or field, so it cannot be edited here yet.') : undefined} style={{
          textAlign: p.align, lineHeight: p.lineHeight ?? 1.2, margin: 0, minHeight: '1em', fontSize: `${(p.runs[0]?.size ?? 18) * 4 / 3}px`,
          paddingLeft: p.indent || undefined, textIndent: p.bullet && p.indent ? '-1em' : undefined, whiteSpace: text.wrap ? undefined : 'nowrap',
        }}>
          {p.bullet && <span style={{ color: p.runs[0]?.color ?? undefined }}>{p.bullet}{' '}</span>}
          {(() => {
            const look = (run: TextBody['paras'][number]['runs'][number]): React.CSSProperties => ({
              ...runCss(run), fontWeight: run.bold ? 700 : 400, color: run.color ?? 'var(--sheet-text)',
              letterSpacing: run.spacing ? `${run.spacing}px` : undefined, whiteSpace: 'pre-wrap',
            });
            const runs = p.runs.map((run, j) => run.text === '\n' ? <br key={j} /> : <span key={j} style={look(run)}>{run.text}</span>);
            if (!editAt || !shape || p.src === undefined) return runs;
            const original = p.runs.map((x) => x.text).join('');
            const at = { slide: editAt.slide, shape, para: p.src };
            return (
              <EditableRuns original={original} edited={editAt.edit.pending.get(slideTextKey(at.slide, at.shape, at.para))?.to}
                accent="var(--slide-accent)" look={p.runs[0] ? look(p.runs[0]) : {}}
                onChange={(to) => editAt.edit.set({ kind: 'slide', ...at, from: original, to })}>
                {runs}
              </EditableRuns>
            );
          })()}
        </p>
      ))}
    </div>
  );
}

function DeckItemView({ item, editAt = null }: { item: DeckItem; editAt?: SlideEdit | null }) {
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
          // A zero width or height stops an SVG drawing at all, which is every
          // straight horizontal or vertical line; the path is unchanged.
          <svg className="absolute inset-0 overflow-visible" width={Math.max(1, item.w)} height={Math.max(1, item.h)}>
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
      {item.text && <DeckText text={item.text} editAt={editAt} shape={item.spId} />}
    </div>
  );
}

