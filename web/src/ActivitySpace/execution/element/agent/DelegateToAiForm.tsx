'use client';

import { useState } from 'react';
import { ChevronDown, Loader2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { AgentStartOutcome, Worker } from '@/hooks/useSupabase';

// Handing an Element to the in-app agent (Claude): an optional note and,
// when the Space has more than one AI Worker, which one. The AI Worker
// already assigned to the Element is preselected. Opened from the Element's
// "…" menu and from ⌘K while the Element is open; while a run is going it
// says so and starts nothing.

export function DelegateToAiForm({
  aiWorkers,
  defaultWorkerId,
  defaultPrompt,
  busy,
  starting,
  error,
  onStart,
  onStarted,
  onViewRun,
}: {
  aiWorkers: Worker[];
  defaultWorkerId: string | null;
  /** The note to start from — the previous run's instructions. */
  defaultPrompt?: string | null;
  /** A run is already going on this Element. */
  busy?: boolean;
  starting?: boolean;
  /** Why the last start failed, shown under the form. */
  error?: string | null;
  /** Unless the run started, the form stays with the note kept for another try. */
  onStart: (opts: { workerId: string | null; prompt: string; planMode: boolean }) => Promise<AgentStartOutcome>;
  /** The run started; the caller closes the form. */
  onStarted: () => void;
  /** Go to the run already going (the caller closes the form onto the
   *  page's run panel). Offered in the busy state, so "already working"
   *  comes with a way to the work, not just a stopped form. */
  onViewRun?: () => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(defaultPrompt ?? '');
  const [outcome, setOutcome] = useState<AgentStartOutcome | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(defaultWorkerId ?? aiWorkers[0]?.id ?? null);
  // Plan mode (B8): the run first walks the task as a dry run — reads for
  // real, writes recorded as one plan — and only an approved plan applies.
  const [planMode, setPlanMode] = useState(false);
  const chosen = aiWorkers.find((w) => w.id === workerId) ?? null;

  const run = async () => {
    if (busy || starting) return;
    const result = await onStart({ workerId, prompt, planMode });
    setOutcome(result);
    if (result !== 'started') return;
    setPrompt('');
    onStarted();
  };

  return (
    <>
      <div className="mb-2 text-[12px] text-muted-foreground">
        {t('The agent works with your permissions. External writes wait for your approval.')}
      </div>
      {/* Busy is explained where the person lands, not discovered from a
          dead button: a run is already going, and here is the way to it. */}
      {busy && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">{t('The agent is already working on this Element. Stop it or wait for it to finish, then ask again.')}</p>
          {onViewRun && (
            <Button variant="secondary" size="sm" onClick={onViewRun}>{t('View the run')}</Button>
          )}
        </div>
      )}
      <TextComposer
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t('Instructions for the agent (optional)')}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); }
        }}
        hint={aiWorkers.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs">{t('Agent')}: {chosen?.name ?? '—'}<ChevronDown size={11} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {aiWorkers.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => setWorkerId(w.id)}>{w.name}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : chosen ? <span>{t('Agent')}: {chosen.name}</span> : null}
        action={
          <Button variant="primary" size="sm" disabled={starting || busy} onClick={() => void run()}>
            {starting && <Loader2 size={13} className="animate-spin" />}{t('Run')}
          </Button>
        }
      />
      {/* Plan mode is offered where the run is delegated: one checkbox
          with its consequence in plain words — nothing is written until
          the whole plan is approved. */}
      <label className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground">
        <input
          type="checkbox"
          checked={planMode}
          disabled={starting || busy}
          onChange={(e) => setPlanMode(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          {t('Plan first')}
          <span className="block">{t('The agent first works through the task without writing anything, and shows the whole plan as one approval. Nothing is written until you approve it.')}</span>
        </span>
      </label>
      {outcome === 'busy' && (
        <p className="mt-2 text-[12px] text-muted-foreground">{t('The agent is already working on this Element. Stop it or wait for it to finish, then ask again.')}</p>
      )}
      {outcome === 'failed' && error && <p className="mt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
    </>
  );
}
