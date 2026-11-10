'use client';

import { useState } from 'react';
import { Bot, Check, AlertTriangle, Loader2, Zap, ShieldCheck } from '@/ui/icons';
import { updateDomain, pingAgentRuntime } from '@/hooks/useSupabase';
import type { Domain, DomainAIConfig } from '@/hooks/useSupabase';
import { DOMAIN_AGENT_MODELS, DOMAIN_AGENT_TURNS, clampAgentTurns, domainAgentModel } from '@/Function/domain/domainAgentConfig';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SelectControl, SettingField, SettingRow, ToggleRow } from '@/Function/settings/SettingsControls';

type PingState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'missing' }
  | { status: 'error'; message: string };

// The Domain's "API Settings" screen — configures the autonomous agent for
// every Element in this Domain. The Anthropic API key itself is NOT entered
// here: it stays a server-side Edge Function secret (ANTHROPIC_API_KEY).
// "Test connection" verifies that secret is present. The controls are the
// shared settings primitives in their flush (dialog-embedded) form, and
// every string goes through t() (settings redesign PR4b).
export function DomainAgentSettings({
  domain,
  onSaved,
  canEdit = true,
}: {
  domain: Domain;
  onSaved?: () => void;
  /** False for a plain member: `domains` UPDATE is owner/admin-only, so the
   *  form shows the settings but every control is disabled. */
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const initial: DomainAIConfig = domain.ai_config ?? {};
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [model, setModel] = useState(domainAgentModel(initial.model));
  const [maxTurns, setMaxTurns] = useState(String(initial.max_turns ?? DOMAIN_AGENT_TURNS.default));
  const [instructions, setInstructions] = useState(initial.instructions ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ping, setPing] = useState<PingState>({ status: 'idle' });

  // The shared SelectControl speaks in labels (the approval-mode pattern):
  // the option strings are the models' i18n-key labels, mapped back to the
  // stored value on change.
  const modelLabel = DOMAIN_AGENT_MODELS.find((m) => m.value === model)?.label ?? DOMAIN_AGENT_MODELS[0].label;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const turns = clampAgentTurns(maxTurns);
      const ai_config: DomainAIConfig = {
        enabled,
        model,
        max_turns: turns,
        instructions: instructions.trim() || undefined,
      };
      await updateDomain(domain.id, { ai_config });
      setMaxTurns(String(turns));
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError((e as { message?: string } | null)?.message || t('Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setPing({ status: 'checking' });
    try {
      const res = await pingAgentRuntime();
      setPing({ status: res.ok && res.key_configured ? 'ok' : 'missing' });
    } catch (e) {
      setPing({ status: 'error', message: (e as Error).message });
    }
  };

  return (
    <fieldset disabled={!canEdit} className="rounded-lg border border-border/60 bg-card p-4 space-y-4 disabled:opacity-70">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">{t('AI agent')}</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
            {t("When you press Start on the board or in an Element's details, the agent carries out the Element's task using these settings.")}
          </p>
        </div>
      </div>

      {/* Enabled toggle — the one shared Switch, via ToggleRow */}
      <ToggleRow
        flush
        label={t('Enable agent execution')}
        desc={t('While disabled, Start does not work in this Domain.')}
        value={enabled}
        onChange={(v) => setEnabled(v)}
      />

      {/* Model */}
      <SettingRow flush label={t('Model')}>
        <SelectControl
          value={modelLabel}
          options={DOMAIN_AGENT_MODELS.map((m) => m.label)}
          onChange={(label) => {
            const next = DOMAIN_AGENT_MODELS.find((m) => m.label === label);
            if (next) setModel(next.value);
          }}
        />
      </SettingRow>

      {/* Max steps */}
      <SettingField
        flush
        label={t('Max turns')}
        hint={t('The maximum number of times the model can be called in a single run ({min}–{max}, default {default}). A limit set on an individual AI Worker takes precedence.', { min: DOMAIN_AGENT_TURNS.min, max: DOMAIN_AGENT_TURNS.max, default: DOMAIN_AGENT_TURNS.default })}
      >
        <input
          type="number"
          min={DOMAIN_AGENT_TURNS.min}
          max={DOMAIN_AGENT_TURNS.max}
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
          className="w-24 text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 focus:outline-none"
        />
      </SettingField>

      {/* Instructions */}
      <SettingField
        flush
        label={t('Additional instructions for the agent (optional)')}
        hint={t("Common rules for the agent, applied to every Element in this Domain. They are passed before any individual AI Worker's instructions.")}
      >
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t('Example: Always write deliverables as bullet points. The internal term “SEM” is short for Strategy Execution Manager.')}
          rows={3}
          className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-2 border border-border/60 focus:outline-none resize-none leading-snug"
        />
      </SettingField>

      {/* API key — server-side secret */}
      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-foreground">{t('Anthropic API key')}</div>
            <p className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">
              {t('The key is managed safely as a server-side Edge Function secret (ANTHROPIC_API_KEY). It is not stored here.')}
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleTest}
                disabled={ping.status === 'checking'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] bg-card border border-border/60 hover:bg-accent transition-colors disabled:opacity-50"
              >
                {ping.status === 'checking' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                {t('Test connection')}
              </button>
              {ping.status === 'ok' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-emerald-500">
                  <Check size={13} /> {t('API key is set — connection OK')}
                </span>
              )}
              {ping.status === 'missing' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-amber-500">
                  <AlertTriangle size={13} /> {t('No API key is set on the server')}
                </span>
              )}
              {ping.status === 'error' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-rose-500">
                  <AlertTriangle size={13} /> {t('Connection failed')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          {saving ? t('Saving…') : t('Save settings')}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[12px] text-emerald-500">
            <Check size={13} /> {t('Settings saved')}
          </span>
        )}
        {saveError && (
          <span role="alert" className="inline-flex items-center gap-1 text-[12px] text-destructive">
            <AlertTriangle size={13} /> {t("Couldn't save the settings: {error}", { error: saveError })}
          </span>
        )}
      </div>
    </fieldset>
  );
}
