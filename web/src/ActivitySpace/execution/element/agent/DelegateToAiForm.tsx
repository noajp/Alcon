'use client';

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { AgentStartOutcome, Worker } from '@/hooks/useSupabase';

// Handing an Element to the in-app agent (Claude): an optional note and,
// when the Space has more than one AI Worker, which one. The AI Worker
// already assigned to the Element is preselected. Opened from the Element's
// "Open in" menu.

export function DelegateToAiForm({
  aiWorkers,
  defaultWorkerId,
  starting,
  error,
  onStart,
  onStarted,
}: {
  aiWorkers: Worker[];
  defaultWorkerId: string | null;
  starting?: boolean;
  /** Why the last start failed, shown under the form. */
  error?: string | null;
  /** Unless the run started, the form stays with the note kept for another try. */
  onStart: (opts: { workerId: string | null; prompt: string }) => Promise<AgentStartOutcome>;
  /** The run started; the caller closes the form. */
  onStarted: () => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [outcome, setOutcome] = useState<AgentStartOutcome | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(defaultWorkerId ?? aiWorkers[0]?.id ?? null);
  const chosen = aiWorkers.find((w) => w.id === workerId) ?? null;

  const run = async () => {
    const result = await onStart({ workerId, prompt });
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
          <Button variant="primary" size="sm" disabled={starting} onClick={() => void run()}>
            {starting && <Loader2 size={13} className="animate-spin" />}{t('Run')}
          </Button>
        }
      />
      {outcome === 'busy' && (
        <p className="mt-2 text-[12px] text-muted-foreground">{t('The agent is already working on this Element. Stop it or wait for it to finish, then ask again.')}</p>
      )}
      {outcome === 'failed' && error && <p className="mt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
    </>
  );
}
