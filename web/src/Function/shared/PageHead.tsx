'use client';

import { DescriptionEditor } from '@/Function/shared/DescriptionEditor';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';

// =============================================================
// The shape of a concept's own page — the one Element detail has: a title,
// the description under it, then what you can do with it below.
//
//   <div className={PAGE_BODY}>
//     <PageHead … />            title + description, edited in place
//     …inline actions, then <PageSection>s…
//   </div>
//
// Domain and Strategy are built this way, so moving between them
// (and into an Element) never changes where the title sits or how wide the
// page is. A section is a small muted heading and flat rows — no box.
// =============================================================

/** The concept's icon, above its title — on every concept page, in the same
 *  place: icon, then title, then description. */
export function PageIcon({ children }: { children: ReactNode }) {
  return (
    <span className="mb-3 flex h-6 items-center text-muted-foreground">{children}</span>
  );
}

/** The page frame: one width and one set of margins for every concept page,
 *  Element detail's — the text starts 30px in, under the header's path. */
const PAGE_BODY = 'w-full max-w-7xl py-8 pl-[30px] pr-8';

/** A concept page's title type — the one place its size, tracking and colour
 *  are set. Pages that edit their title in a field of their own (Element,
 *  Object, Strategy, Phase) use it too, so every title sits the same. The
 *  weight is set inline (`PAGE_TITLE_WEIGHT`): the base resets typed content
 *  to 400, which beats a utility. */
export const PAGE_TITLE = 'text-2xl leading-tight tracking-[-0.012em] text-foreground';
export const PAGE_TITLE_WEIGHT = { fontWeight: 600 } as const;

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
  onSaveTitle, onSaveDescription, under,
}: {
  /** A line between the title and the description — where it sits
   *  ("Inside …"). */
  under?: ReactNode;
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
  /** Omit when the description is not the subject's own (a tool's fixed
   *  explanation): it is then shown as text even while the title edits. */
  onSaveDescription?: (value: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [titleDraft, setTitleDraft, savedTitle] = useDraft(title);
  const [error, setError] = useState<string | null>(null);

  const commitTitle = async () => {
    const next = titleDraft.replace(/\s*\n\s*/g, ' ').trim();
    // A title is required: emptying it puts the saved one back.
    if (!next) { setTitleDraft(savedTitle); return; }
    setTitleDraft(next);
    if (next === savedTitle.trim()) return;
    try { await onSaveTitle(next); setError(null); } catch (e) { setError(message(e, t("Couldn't save"))); }
  };
  const commitDescription = async (markdown: string) => {
    const next = markdown.trim();
    if (!onSaveDescription || next === description.trim()) return;
    try { await onSaveDescription(next); setError(null); } catch (e) { setError(message(e, t("Couldn't save"))); }
  };

  if (!canEdit) {
    return (
      <div>
        {icon && <PageIcon>{icon}</PageIcon>}
        <h1 className={PAGE_TITLE} style={PAGE_TITLE_WEIGHT}>{title}</h1>
        {under && <div className="mt-2">{under}</div>}
        <div className="mt-4">
          <DescriptionEditor readOnly value={description} emptyText={emptyDescription} placeholder="" onSave={() => {}} />
        </div>
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
        className={`w-full resize-none overflow-hidden border-none bg-transparent focus:outline-none ${PAGE_TITLE}`}
        style={PAGE_TITLE_WEIGHT} />
      {under && <div className="mt-2">{under}</div>}
      <div className="mt-3" aria-label={descriptionLabel}>
        <DescriptionEditor value={description} readOnly={!onSaveDescription}
          placeholder={descriptionPlaceholder} onSave={commitDescription} />
      </div>
      {error && <div role="alert" className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}

/** A section of a concept's page: a heading and what is under it, held
 *  together by spacing rather than a box (the same heading as a widget's).
 *  `action` is the heading's own verb ("+ Add") and sits at its right. */
export function PageSection({ title, action, children, className = '' }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={className} aria-label={title}>
      <div className="mb-1 flex h-8 items-center gap-2">
        <h2 className={`${FONT.lg} text-foreground`}>{title}</h2>
        {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}
