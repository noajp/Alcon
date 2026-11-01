'use client';

import type { OfficePreview } from './officePreview';

/** What an Office file says: a document's paragraphs, a workbook's sheets
 *  (one tab each), a deck's slides as numbered cards. */
export function OfficeTextView({ preview }: { preview: OfficePreview }) {
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

