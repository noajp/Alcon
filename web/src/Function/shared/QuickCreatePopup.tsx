'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from '@/ui/icons';
import { QUICK_CREATE } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isCommitEnter, isSubmitChord, useEscapeLayer } from '@/Function/shared/keyboard';

export interface QuickCreateInput {
  name: string;
  description: string | null;
}

interface QuickCreatePopupProps {
  open: boolean;
  /** Small icon before the context label — the concept being created. */
  icon: ReactNode;
  /** "New Notebook", "New Initiative", … */
  contextLabel: string;
  ariaLabel: string;
  namePlaceholder: string;
  nameAriaLabel?: string;
  /** The description field is on by default; a concept without one turns it off. */
  description?: boolean;
  descriptionPlaceholder?: string;
  /** Small note at the footer's left. */
  hint?: string;
  submitLabel?: string;
  onClose: () => void;
  /** Resolves when the thing exists; the popup closes on success and shows
   *  the error otherwise. */
  onSubmit: (input: QuickCreateInput) => void | Promise<void>;
  /** The property pills, rendered in the row under the description. */
  children?: ReactNode;
}

/**
 * The one shape every quick-create surface shares — the card lifted at the
 * bottom of the viewport with a context label, a big name field, an optional
 * description, a row of property pills and a Create button. Objects and
 * Elements set the pattern (QuickAddObjectPopup / QuickAddElementPopup); the
 * Notebook, Initiative and Table popups are built on this so a "+" anywhere
 * opens the same kind of surface. Linear-style: no dimmer behind.
 */
export function QuickCreatePopup({
  open,
  icon,
  contextLabel,
  ariaLabel,
  namePlaceholder,
  nameAriaLabel,
  description = true,
  descriptionPlaceholder = 'Add description…',
  hint,
  submitLabel = 'Create',
  onClose,
  onSubmit,
  children,
}: QuickCreatePopupProps) {
  // Callers pass English labels; translate them here (a no-op when already translated).
  const { t: tr } = useI18n();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  // Every opening starts blank. Reset during render on the open edge (the
  // "adjust state from a prop" pattern) rather than in an effect, so the
  // blank fields never paint once with the previous text.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setName(''); setDesc(''); setError(null); }
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => nameRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  // Close on Esc — as a layer, so a picker opened from inside the popup takes
  // the key first and the popup gets the next one.
  useEscapeLayer(open, onClose);

  useEffect(() => {
    const ta = nameRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [name]);
  useEffect(() => {
    const ta = descRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, QUICK_CREATE.descriptionMinHeight), 240)}px`;
  }, [desc]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

  if (!open) return null;

  const handleSubmit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: trimmedName, description: desc.trim() || null });
      onClose();
    } catch (e) {
      console.error('Quick create failed:', e);
      setError(e instanceof Error ? e.message : tr('Could not create it. Please try again.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div className={QUICK_CREATE.panel} role="dialog" aria-label={tr(ariaLabel)}>
        <div className={QUICK_CREATE.header}>
          <span className={QUICK_CREATE.context}>
            {icon}
            <span className="truncate max-w-[200px]">{tr(contextLabel)}</span>
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label={tr('Close')}
          >
            <X size={14} />
          </button>
        </div>

        <textarea
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // The name is the one single-line field: Enter creates (IME-safe
            // via the shared helper), Shift+Enter still wraps a long name.
            if (isCommitEnter(e) || isSubmitChord(e)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={tr(namePlaceholder)}
          aria-label={tr(nameAriaLabel ?? namePlaceholder)}
          rows={1}
          className={QUICK_CREATE.title}
        />

        {description && (
          <textarea
            ref={descRef}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              // Multi-line: Enter is a newline, ⌘/Ctrl+Enter creates.
              if (isSubmitChord(e)) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder={tr(descriptionPlaceholder)}
            aria-label={tr('Description')}
            rows={2}
            className={QUICK_CREATE.description}
          />
        )}

        {children && <div className={QUICK_CREATE.properties}>{children}</div>}

        {error && <p role="alert" className="pt-2 text-xs text-destructive">{error}</p>}

        <div className={QUICK_CREATE.footer}>
          {hint && <span className="mr-auto min-w-0 text-[11px] text-muted-foreground">{tr(hint)}</span>}
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {busy ? tr('Creating…') : tr(submitLabel)}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The property-pill look every quick-create surface shares (mirrors the
 *  Properties panel chips: semibold, brighter text, soft fill at rest). */
export function quickCreatePillClass(active: boolean): string {
  return [
    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-semibold transition-colors border',
    active
      ? 'bg-muted/60 border-border/60 text-foreground hover:bg-muted'
      : 'bg-muted/30 border-border/40 text-foreground/85 hover:bg-muted/60 hover:text-foreground',
  ].join(' ');
}
