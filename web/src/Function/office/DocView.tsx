'use client';

import { useEffect } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { DocBlock, DocLayout, DocPara, DocRun } from './docLayout';
import { paraKey, type EditSession } from './officeEdits';
import type { DocChanges } from './officeDiff';
import { EditableRuns, OfficeCanvas, runCss } from './officeViewParts';

/** A document as Word lays it out: a white page at the document's width
 *  and margins on the grey canvas under Word's blue bar, scaled down to fit
 *  the preview; page breaks start a new sheet of paper. With an edit
 *  session, a paragraph of plain text can be retyped in place (Enter or a
 *  click elsewhere keeps it, Esc puts it back). */
export function DocView({ doc, edit = null, changes = null }: {
  doc: DocLayout; edit?: EditSession | null;
  /** Paragraphs that differ from another version: changed amber, added green. */
  changes?: DocChanges | null;
}) {
  const pages: DocBlock[][] = [[]];
  for (const b of doc.blocks) {
    if (b.kind === 'break') pages.push([]);
    else pages[pages.length - 1].push(b);
  }

  // The document's embedded fonts, registered under the names its text
  // asks for, for as long as the preview is open.
  useEffect(() => {
    const faces = doc.fonts.map((f) => new FontFace(f.family, f.data, { weight: f.bold ? '700' : '400', style: f.italic ? 'italic' : 'normal' }));
    for (const face of faces) face.load().then(() => document.fonts.add(face)).catch(() => {});
    return () => { for (const face of faces) document.fonts.delete(face); };
  }, [doc.fonts]);

  return (
    <OfficeCanvas accent="var(--doc-accent)">
      {(width) => pages.map((blocks, i) => (
          // zoom, not transform: the page's height follows the scale, so a
          // long page still pushes the next one down. Header and footer sit
          // in the margins; footnotes close the last page.
          <div key={i} className="relative flex shrink-0 flex-col bg-[var(--sheet-paper)] text-[var(--sheet-text)] shadow-md"
            style={{ width: doc.width, zoom: Math.min(1, (width - 48) / doc.width), padding: `${doc.margin.top}px ${doc.margin.right}px ${doc.margin.bottom}px ${doc.margin.left}px`, minHeight: doc.width * 1.414 }}>
            {doc.header.length > 0 && (
              <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ padding: `${Math.min(48, doc.margin.top / 2)}px ${doc.margin.right}px 0 ${doc.margin.left}px`, maxHeight: doc.margin.top }}>
                <DocBlocks blocks={doc.header} />
              </div>
            )}
            <div className="flow-root flex-1" style={{ columnCount: doc.columns > 1 ? doc.columns : undefined, columnGap: 32 }}>
              <DocBlocks blocks={blocks} edit={edit} changes={changes} />
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
    </OfficeCanvas>
  );
}

/** Pure. Whether a #rrggbb fill is dark enough to need light text. */
function isDark(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

function DocBlocks({ blocks, edit = null, changes = null }: { blocks: DocBlock[]; edit?: EditSession | null; changes?: DocChanges | null }) {
  const { t } = useI18n();
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
                    <DocBlocks blocks={cell.blocks} edit={edit} changes={changes} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    const size = b.runs.find((r) => r.text.trim())?.size ?? b.runs[0]?.size ?? 10.5;
    const mark = changes?.marks.get(b);
    return (
      // A div, not a p: a paragraph may hold a text box with paragraphs of its own.
      <div key={i} title={mark?.kind === 'changed' ? t('Before: {value}', { value: mark.before || t('(empty)') }) : mark ? t('Added')
        : edit && b.src === undefined && b.runs.some((r) => r.text.trim()) ? t('This paragraph has a tab, line break, picture, note or field, so it cannot be edited here yet.') : undefined} style={{
        ...(mark ? { backgroundColor: mark.kind === 'changed' ? 'var(--status-warning-subtle)' : 'var(--status-success-subtle)', boxShadow: `-6px 0 0 ${mark.kind === 'changed' ? 'var(--status-warning)' : 'var(--status-success)'}` } : {}),
        textAlign: b.align, margin: `${b.before}px 0 ${b.after}px`, paddingLeft: b.indent || undefined, textIndent: b.firstLine || undefined,
        lineHeight: b.line ? b.line * 1.15 : 1.15, minHeight: `${size * 4 / 3 * 1.15}px`, fontSize: `${size * 4 / 3}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }}>
        {b.marker && <span style={{ display: 'inline-block', minWidth: '1.5em' }}>{b.marker}</span>}
        {edit && b.src !== undefined ? <EditablePara para={b as DocPara & { src: number }} edit={edit} />
          : b.runs.map((run, j) => <DocRunView key={j} run={run} />)}
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
    <span style={runCss(run)}>{run.text === '\t' ? '\u2003' : run.text}</span>
  );
}


/** A Word paragraph of plain text, typed over in place. */
function EditablePara({ para, edit }: { para: DocPara & { src: number }; edit: EditSession }) {
  const original = para.runs.map((r) => r.text).join('');
  return (
    <EditableRuns original={original} edited={edit.pending.get(paraKey(para.src))?.to} accent="var(--doc-accent)"
      look={runCss(para.runs.find((r) => r.text) ?? {})}
      onChange={(to) => edit.set({ kind: 'para', index: para.src, from: original, to })}>
      {para.runs.map((run, j) => <DocRunView key={j} run={run} />)}
    </EditableRuns>
  );
}
