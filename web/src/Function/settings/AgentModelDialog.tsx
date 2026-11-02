'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from '@/ui/icons';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useIntegrations } from '@/Function/integrations/data';
import { agentModelDraft, agentModelPatch } from '@/Function/team/agentModel';
import { updateWorker } from '@/hooks/useSupabase';
import type { Worker } from '@/types/database';

// Settings › Team: which model an AI agent runs on — Anthropic, or one of the
// Space's model connections (Settings › Integrations › AI models) with the
// model's name there and, optionally, its price for the Space's budget.

export function AgentModelDialog({ worker, spaceId, onClose, onSaved }: {
  worker: Worker;
  /** The Space whose model connections can be chosen. */
  spaceId: string | null;
  onClose: () => void;
  onSaved: (worker: Worker) => void;
}) {
  const { t } = useI18n();
  const { data: integrations } = useIntegrations(spaceId);
  const providers = integrations.filter((i) => i.kind === 'model');
  const [draft, setDraft] = useState(() => agentModelDraft(worker));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = providers.find((p) => p.id === draft.providerId) ?? null;
  // A connection removed since it was chosen still shows, so the change is visible.
  const providerLabel = draft.providerId ? chosen?.name ?? t('Removed connection') : t('Anthropic (Alcon default)');

  const save = async () => {
    const built = agentModelPatch(worker.ai_config, draft);
    if (!built.ok) { setError(t(built.error)); return; }
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateWorker(worker.id, built.patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to save'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Model for {name}', { name: worker.name })}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('Runs on Anthropic by default. Add a model connection in Settings › Integrations to run this agent on another provider.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('Provider')}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" align="start">
                  <span>{providerLabel}</span>
                  <ChevronDown size={12} aria-hidden="true" className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[200px]">
                <DropdownMenuItem onSelect={() => setDraft({ ...draft, providerId: null })} className="gap-2 text-[12px]">
                  <span className="flex-1">{t('Anthropic (Alcon default)')}</span>
                  {!draft.providerId && <Check size={12} />}
                </DropdownMenuItem>
                {providers.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setDraft({ ...draft, providerId: p.id })} className="gap-2 text-[12px]">
                    <span className="flex-1">{p.name}{p.enabled ? '' : ` (${t('Off')})`}</span>
                    {draft.providerId === p.id && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <Field label={t('Model')}>
            <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder={draft.providerId ? t('The model name in the provider\'s docs') : 'claude-sonnet-5-5'}
              className="h-8 font-mono text-[12px] md:text-[12px]" />
          </Field>

          {draft.providerId && (
            <Field label={t('Price (USD per million tokens, optional)')}>
              <div className="flex items-center gap-2">
                <Input value={draft.priceInput} onChange={(e) => setDraft({ ...draft, priceInput: e.target.value })} inputMode="decimal"
                  aria-label={t('Input')} placeholder={t('Input')} className="h-8 text-[13px] md:text-[13px]" />
                <Input value={draft.priceOutput} onChange={(e) => setDraft({ ...draft, priceOutput: e.target.value })} inputMode="decimal"
                  aria-label={t('Output')} placeholder={t('Output')} className="h-8 text-[13px] md:text-[13px]" />
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {t('Without a price, runs are charged against the budget at Claude Sonnet\'s price.')}
              </p>
            </Field>
          )}
        </div>

        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? t('Saving…') : t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
