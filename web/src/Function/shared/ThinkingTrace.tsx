'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Sparkles } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';

// Athena at work, as one line that opens into its trace. While it works the
// line reads "Thinking…" with light sweeping across it and the steps appear
// under it as they start: the running one spins, finished ones keep a quiet
// check. Once the work settles the line says how long it took (or how many
// tools it used) and folds, so the answer is the thing to read; it opens
// again on a click, and a step with detail opens to show it.

export type ThinkingStep = {
  key: string;
  /** What the step did, e.g. "Searched the web". */
  primary: ReactNode;
  /** What it was about: a query, a title, a file. */
  secondary?: ReactNode;
  status: 'running' | 'success' | 'error';
  /** Shown under the step when it is opened (arguments, result). */
  detail?: ReactNode;
};

export function ThinkingTrace({ working, steps = [], className }: {
  working: boolean;
  steps?: ThinkingStep[];
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  // Null until someone opens or folds it by hand: until then it follows the work.
  const [manual, setManual] = useState<boolean | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const seconds = useWorkedSeconds(working);

  if (!working && steps.length === 0) return null;
  const expanded = steps.length > 0 && (manual ?? working);
  const failed = steps.filter((s) => s.status === 'error').length;
  const doneLabel = seconds != null
    ? t('Thought for {n}s', { n: seconds })
    : steps.length === 1 ? t('Used 1 tool') : t('Used {n} tools', { n: steps.length });

  return (
    <div className={cn('grid text-[13px] leading-5', className)}>
      <button type="button" aria-expanded={expanded} aria-controls={`${id}-trace`}
        disabled={steps.length === 0}
        onClick={() => setManual(!expanded)}
        className="-ml-1.5 flex min-h-7 max-w-full items-center gap-2 justify-self-start rounded-[var(--radius-sm)] py-0.5 pl-1.5 pr-2 text-left transition-colors enabled:hover:bg-muted/50 focus-visible:bg-muted/60">
        <Sparkles size={14} aria-hidden="true"
          className={cn('shrink-0 text-[var(--accent-default)] transition-opacity', !working && 'opacity-70')} />
        <span role="status" key={working ? 'busy' : 'done'} className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap animate-fade-in">
          {working
            ? <span className="animate-shimmer font-medium">{t('Thinking…')}</span>
            : <span className="font-medium text-muted-foreground">{doneLabel}</span>}
          {!working && failed > 0 && <span className="shrink-0 text-[var(--status-danger)]">· {t('{n} failed', { n: failed })}</span>}
        </span>
        {steps.length > 0 && (
          <ChevronDown size={12} aria-hidden="true"
            className={cn('shrink-0 text-muted-foreground transition-transform duration-300', expanded && 'rotate-180')} />
        )}
      </button>

      <div id={`${id}-trace`} inert={!expanded}
        className={cn('grid transition-[grid-template-rows,opacity] duration-300', expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="min-h-0 overflow-hidden">
          {/* The line down the side ties the steps to the header's glyph. */}
          <div className="ml-[6px] mt-0.5 grid gap-0.5 border-l border-[var(--border-subtle)] py-0.5 pl-3">
            {steps.map((step) => {
              const open = openStep === step.key;
              const row = (
                <>
                  <StepMark status={step.status} />
                  <span className={cn('shrink-0 font-medium', step.status === 'error' ? 'text-[var(--status-danger)]' : 'text-foreground')}>{step.primary}</span>
                  {step.secondary != null && <span dir="auto" className="min-w-0 truncate text-muted-foreground">{step.secondary}</span>}
                </>
              );
              const rowClass = 'flex min-h-7 w-full min-w-0 items-center gap-2 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-left text-[12.5px] animate-slide-up';
              return (
                <div key={step.key} className="min-w-0">
                  {step.detail != null ? (
                    <button type="button" aria-expanded={open} onClick={() => setOpenStep(open ? null : step.key)}
                      className={cn(rowClass, 'transition-colors', open ? 'bg-muted/60' : 'hover:bg-muted/40')}>
                      {row}
                    </button>
                  ) : <div className={rowClass}>{row}</div>}
                  {open && step.detail != null && <div className="pb-1 pl-1.5 pt-1 animate-fade-in">{step.detail}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepMark({ status }: { status: ThinkingStep['status'] }) {
  if (status === 'running') {
    return <span aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--border-default)] border-t-muted-foreground" />;
  }
  if (status === 'error') return <AlertCircle size={13} aria-hidden="true" className="shrink-0 text-[var(--status-danger)]" />;
  return <Check size={13} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-muted-foreground/70" />;
}

/** Whole seconds a stretch of work took, once it is over. Null while it runs,
 *  and for work this view never saw running (a kept turn has no timing). */
function useWorkedSeconds(working: boolean): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!working) return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.max(1, Math.round((Date.now() - start) / 1000))), 500);
    return () => window.clearInterval(timer);
  }, [working]);
  return seconds;
}
