'use client';

import { useState } from 'react';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { updateStrategy, useStrategiesInSpace } from '@/hooks/strategyData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { StrategyDelegation } from '@/types/database';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { AutomationsSection } from './AutomationsSection';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { setStrategyDefinition, useDefinitions } from '@/hooks/definitionData';

/** The harness picker's value for "no harness of its own". */
const SPACE_DEFAULT = '__space';

// What runs on its own, in one place: the automations that start a harness
// by themselves, and, for each Strategy's AI work, the harness it follows and
// whether a verified result goes on to the next step by itself or waits for a
// person.

const CHOICES: { value: StrategyDelegation; label: string }[] = [
  { value: 'manual', label: 'A person reviews each result' },
  { value: 'auto', label: 'Verified results go on to the next step' },
];

export function AutomationView({ onOpenStrategy, onOpenElement }: { onOpenStrategy: (id: string) => void; onOpenElement?: (id: string) => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: strategies, loading, refetch } = useStrategiesInSpace();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const library = useDefinitions(spaceId);

  const change = async (id: string, delegation: StrategyDelegation) => {
    setSaving(id); setError(null);
    try { await updateStrategy(id, { delegation }); refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(null); }
  };
  const changeHarness = async (id: string, definitionId: string | null) => {
    setSaving(id); setError(null);
    try { await setStrategyDefinition(id, definitionId); refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(null); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <IslandHeader crumbs={[{ id: 'automation', label: t('Automation') }]} count={strategies.length} />
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-4">
        <AutomationsSection spaceId={spaceId} onOpenElement={onOpenElement} />
        <section>
        <h2 className="text-[14px] font-semibold text-foreground">{t('When a run finishes')}</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">{t('What each Strategy’s AI work does when a run finishes.')}</p>
        {error && <p role="alert" className="mb-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
        {loading ? (
          <p role="status" className="text-[13px] text-muted-foreground">{t('Loading…')}</p>
        ) : strategies.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('No Strategies yet.')}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {strategies.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <ItemIcon icon={s.icon} color={s.color} size={14} fallback={<NavStrategyIcon size={14} />} />
                <button type="button" onClick={() => onOpenStrategy(s.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground hover:underline">
                  {s.name}
                </button>
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
        </section>
      </div>
    </div>
  );
}
