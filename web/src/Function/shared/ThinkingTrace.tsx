'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Sparkles } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { HoverGroup, ListItem } from '@/ui/list-item';

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

  // The glyph keeps the key color; the label rolls in when the state changes.
  const line = (
    <>
      <Sparkles size={14} aria-hidden="true" className="text-[var(--accent-default)]" />
      <span role="status" key={working ? 'busy' : 'done'} className="flex min-w-0 items-baseline gap-1.5 animate-slide-up">
        {working
          ? <span className="animate-shimmer">{t('Thinking…')}</span>
          : <span className="text-muted-foreground">{doneLabel}</span>}
        {!working && failed > 0 && <span className="text-[var(--status-danger)]">· {t('{n} failed', { n: failed })}</span>}
      </span>
    </>
  );

  return (
    <div className={cn('grid text-[13px] leading-5', className)}>
      {steps.length > 0 ? (
        <Button variant="ghost" size="xs" align="start" aria-expanded={expanded} aria-controls={`${id}-trace`}
          onClick={() => setManual(!expanded)} className="-ml-1.5 max-w-full justify-self-start">
          {line}
          <ChevronDown size={12} aria-hidden="true"
            className={cn('transition-transform duration-300', expanded && 'rotate-180')} />
        </Button>
      ) : <div className="flex min-h-6 items-center gap-1.5">{line}</div>}

      <div id={`${id}-trace`} inert={!expanded}
        className={cn('grid transition-[grid-template-rows,opacity] duration-300', expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="min-h-0 overflow-hidden">
          {/* The line down the side ties the steps to the header's glyph. */}
          <HoverGroup className="ml-[6px] mt-0.5 grid border-l border-[var(--border-subtle)] py-0.5 pl-2">
            {steps.map((step) => {
              const open = openStep === step.key;
              return (
                <div key={step.key} className="min-w-0">
                  <ListItem inline className="animate-slide-up text-[12.5px]"
                    leading={<StepMark status={step.status} />}
                    title={step.primary} description={step.secondary}
                    expanded={step.detail != null ? open : undefined}
                    onClick={step.detail != null ? () => setOpenStep(open ? null : step.key) : undefined} />
                  {open && step.detail != null && <div className="pb-1 pl-2 pt-1 animate-fade-in">{step.detail}</div>}
                </div>
              );
            })}
          </HoverGroup>
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
