'use client';

import { useState } from 'react';
import { formatError } from '@/Function/shared/formatError';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { updateStrategy, useStrategiesInSpace } from '@/hooks/strategyData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { StrategyDelegation } from '@/types/database';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { Button } from '@/ui/button';
import { SETTINGS_ISLAND } from '@/shared/designTokens';
import { useAutomations } from '@/hooks/automationData';
import { setStrategyDefinition, useDefinitions } from '@/hooks/definitionData';
import { AutomationsSection } from './AutomationsSection';

// Settings › Automation: the work that runs by itself. The automations, one
// row each — open one for its Overview and its Flow — and, for each
// Strategy's AI work, the harness it follows and whether a verified result
// goes on by itself or waits for a person.

/** The harness picker's value for "no harness of its own". */
const SPACE_DEFAULT = '__space';

const CHOICES: { value: StrategyDelegation; label: string }[] = [
  { value: 'manual', label: 'A person reviews each result' },
  { value: 'auto', label: 'Verified results go on to the next step' },
];

export function AutomationSettings({ onOpenElement }: {
  /** Opens an Element a start made (the main Automation screen passes
   *  its navigation; Settings passes none, and starts then just read). */
  onOpenElement?: (id: string) => void;
} = {}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const automations = useAutomations(spaceId);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? automations.data.find((a) => a.id === openId) ?? null : null;

  if (opened) {
    // The builder carries its own header (back, the automation's name,
    // its verbs) — no second breadcrumb above it.
    return (
      <div className={`${SETTINGS_ISLAND} flex flex-col overflow-hidden`}>
        <AutomationsSection spaceId={spaceId} creating={false} onCreatingChange={setCreating} openId={opened.id} onOpen={setOpenId} onOpenElement={onOpenElement} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium text-foreground">{t('Automations')}</h3>
          {!creating && <Button size="sm" variant="secondary" disabled={!spaceId} onClick={() => setCreating(true)}>{t('New automation')}</Button>}
        </div>
        <div className={`${SETTINGS_ISLAND} overflow-hidden`}>
          <AutomationsSection spaceId={spaceId} creating={creating} onCreatingChange={setCreating} openId={null} onOpen={setOpenId} onOpenElement={onOpenElement} />
        </div>
      </section>
      <StrategyRunSettings />
    </div>
  );
}

/** What each Strategy's AI work does when a run finishes. */
function StrategyRunSettings() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: strategies, loading, refetch } = useStrategiesInSpace();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const library = useDefinitions(spaceId);

  const change = async (id: string, delegation: StrategyDelegation) => {
    setSaving(id); setError(null);
    try { await updateStrategy(id, { delegation }); refetch(); }
    catch (e) { setError(formatError(e)); }
    finally { setSaving(null); }
  };
  const changeHarness = async (id: string, definitionId: string | null) => {
    setSaving(id); setError(null);
    try { await setStrategyDefinition(id, definitionId); refetch(); }
    catch (e) { setError(formatError(e)); }
    finally { setSaving(null); }
  };

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-[13px] font-medium text-foreground">{t('When a run finishes')}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{t('What each Strategy’s AI work does when a run finishes.')}</p>
      </div>
      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      <div className={SETTINGS_ISLAND}>
        {loading ? (
          <p role="status" className="px-4 py-3 text-[13px] text-muted-foreground">{t('Loading…')}</p>
        ) : strategies.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">{t('No Strategies yet.')}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {strategies.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span className="flex min-w-[12rem] flex-1 items-center gap-2">
                  <ItemIcon icon={s.icon} color={s.color} size={14} fallback={<NavStrategyIcon size={14} />} />
                  <span className="min-w-0 truncate text-[13px] text-foreground">{s.name}</span>
                </span>
                {(() => {
                  const harness = library.data.find((d) => d.id === s.definition_id) ?? null;
                  return (
                    <OptionMenu label={t('Harness')} value={harness?.id ?? SPACE_DEFAULT} disabled={saving === s.id}
                      onChange={(v) => void changeHarness(s.id, v === SPACE_DEFAULT ? null : v)}
                      options={[
                        { value: SPACE_DEFAULT, label: t("The Space's default") },
                        // A binding to an off harness stays stored and is shown as such.
                        ...(harness && !harness.enabled ? [{ value: harness.id, label: `${harness.name} · ${t('Off')}` }] : []),
                        ...library.data.filter((d) => d.enabled).map((d) => ({ value: d.id, label: d.name })),
                      ]} />
                  );
                })()}
                <div role="radiogroup" aria-label={t('When an AI finishes')} className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
                  {CHOICES.map((c) => {
                    const on = (s.delegation ?? 'manual') === c.value;
                    return (
                      <button key={c.value} type="button" role="radio" aria-checked={on} disabled={saving === s.id || on}
                        onClick={() => void change(s.id, c.value)}
                        className={`rounded px-2 py-1 text-[12px] transition-colors ${on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        {t(c.label)}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
