'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// The shape of a concept's own page — the one Element detail has: a title,
// the description under it, then what you can do with it below.
//
//   <div className={PAGE_BODY}>
//     <PageHead … />            title + description, edited in place
//     …inline actions, then <PageSection>s…
//   </div>
//
// Domain, Portfolio and Vision are built this way, so moving between them
// (and into an Element) never changes where the title sits or how wide the
// page is. A section is a small muted heading and flat rows — no box.
// =============================================================

/** The concept's icon, above its title — on every concept page, in the same
 *  place: icon, then title, then description. */
export function PageIcon({ children }: { children: ReactNode }) {
  return (
    <span className="mb-4 -ml-2 flex size-9 items-center justify-center rounded-lg bg-muted/40 text-foreground/70">{children}</span>
  );
}

/** The page frame: centred, one width and one set of margins for every
 *  concept page. */
const PAGE_BODY = 'mx-auto w-full max-w-7xl px-8 py-8';

/**
 * Every concept page's layout: the document on the left (icon, title,
 * description, then what you can do), the concept's facts on the right as
 * islands (Properties, …). Below the `lg` breakpoint the rail drops under the
 * document instead of disappearing, so no field is ever out of reach.
 */
export function PageLayout({ rail, children }: { rail?: ReactNode; children: ReactNode }) {
  return (
    <div className={PAGE_BODY}>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-8">{children}</div>
        {rail && <aside className="w-full shrink-0 space-y-4 lg:w-72">{rail}</aside>}
      </div>
    </div>
  );
}

/** A textarea that is as tall as its text — and stays so when the column
 *  is resized (a sidebar toggled, a split pane dragged). */
function AutoField({ value, onChange, onBlur, onKeyDown, className, style, label, placeholder }: {
  value: string; onChange: (v: string) => void; onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className: string; style?: React.CSSProperties; label: string; placeholder: string;
}) {
  const ref: Ref<HTMLTextAreaElement> & { current: HTMLTextAreaElement | null } = useRef<HTMLTextAreaElement | null>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea ref={ref} value={value} rows={1} aria-label={label} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown}
      className={className} style={style} />
  );
}

/** A saved value and its draft. A refetch replaces the draft unless it holds
 *  an unsaved edit. */
function useDraft(saved: string) {
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    if (text === seen) setText(saved);
  }
  return [text, setText, seen] as const;
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function PageHead({
  icon, title, description, canEdit, titleLabel, titlePlaceholder, descriptionLabel, descriptionPlaceholder, emptyDescription,
  onSaveTitle, onSaveDescription,
}: {
  /** The concept's icon, shown above the title (18px). */
  icon?: ReactNode;
  title: string;
  description: string;
  /** Read-only, the title and description are plain text. */
  canEdit: boolean;
  titleLabel: string;
  titlePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  /** What a read-only page says when there is no description. */
  emptyDescription?: string;
  /** Called with the trimmed value when it changed. Throw to report a failure. */
  onSaveTitle: (value: string) => void | Promise<void>;
  onSaveDescription: (value: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [titleDraft, setTitleDraft, savedTitle] = useDraft(title);
  const [descDraft, setDescDraft, savedDesc] = useDraft(description);
  const [error, setError] = useState<string | null>(null);

  const commitTitle = async () => {
    const next = titleDraft.replace(/\s*\n\s*/g, ' ').trim();
    // A title is required: emptying it puts the saved one back.
    if (!next) { setTitleDraft(savedTitle); return; }
    setTitleDraft(next);
    if (next === savedTitle.trim()) return;
    try { await onSaveTitle(next); setError(null); } catch (e) { setError(message(e, t("Couldn't save"))); }
  };
  const commitDescription = async () => {
    const next = descDraft.trim();
    if (next === savedDesc.trim()) return;
    try { await onSaveDescription(next); setError(null); } catch (e) { setError(message(e, t("Couldn't save"))); }
  };

  if (!canEdit) {
    return (
      <div>
        {icon && <PageIcon>{icon}</PageIcon>}
        <h1 className="text-2xl leading-tight text-foreground" style={{ fontWeight: 600 }}>{title}</h1>
        {description
          ? <p className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground">{description}</p>
          : emptyDescription && <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">{emptyDescription}</p>}
      </div>
    );
  }
  return (
    <div>
      {icon && <PageIcon>{icon}</PageIcon>}
      {/* The global base resets typed content to weight 400, which beats a
          `font-semibold` utility — so the title's weight is set inline, as it
          is on Element detail. */}
      <AutoField label={titleLabel} placeholder={titlePlaceholder} value={titleDraft} onChange={setTitleDraft} onBlur={() => void commitTitle()}
        onKeyDown={(e) => {
          // Enter, ⌘Enter and Escape end the edit, which saves it.
          if (isCommitEnter(e) || isSubmitChord(e) || isCancelKey(e)) { e.preventDefault(); e.currentTarget.blur(); }
        }}
        className="w-full resize-none overflow-hidden border-none bg-transparent text-2xl leading-tight text-foreground focus:outline-none"
        style={{ fontWeight: 600 }} />
      <div className="mt-3">
        <AutoField label={descriptionLabel} placeholder={descriptionPlaceholder} value={descDraft} onChange={setDescDraft} onBlur={() => void commitDescription()}
          onKeyDown={(e) => {
            // Enter is a newline; ⌘Enter and Escape end the edit, which saves it.
            if (isSubmitChord(e) || isCancelKey(e)) { e.preventDefault(); e.currentTarget.blur(); }
          }}
          className="min-h-[36px] w-full resize-none overflow-hidden border-none bg-transparent text-[14px] leading-relaxed text-foreground focus:outline-none" />
      </div>
      {error && <div role="alert" className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/** A group of rows under a small muted heading. `action` is the heading's
 *  own verb ("+ Add") and sits at its right. */
export function PageSection({ title, action, children, className = '' }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={className} aria-label={title}>
      <div className="mb-1 flex h-7 items-center gap-2">
        <h2 className="text-[12px] font-medium text-muted-foreground">{title}</h2>
        {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}
