'use client';

import { useState } from 'react';
import { Bot, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Worker } from '@/hooks/useSupabase';

// The inline verb that hands an Element to an agent: an optional note and,
// when the Space has more than one AI Worker, which one. The AI Worker
// already assigned to the Element is preselected.

export function DelegateToAiButton({
  aiWorkers,
  defaultWorkerId,
  disabled,
  starting,
  onStart,
}: {
  aiWorkers: Worker[];
  defaultWorkerId: string | null;
  disabled?: boolean;
  starting?: boolean;
  onStart: (opts: { workerId: string | null; prompt: string }) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [workerId, setWorkerId] = useState<string | null>(defaultWorkerId ?? aiWorkers[0]?.id ?? null);
  const chosen = aiWorkers.find((w) => w.id === workerId) ?? null;

  const run = async () => {
    await onStart({ workerId, prompt });
    setPrompt('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <Bot size={13} />{t('Delegate to AI')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-3">
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
      </PopoverContent>
    </Popover>
  );
}
