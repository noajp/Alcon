'use client';

import { useState } from 'react';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { updateStrategy, useStrategiesInSpace } from '@/hooks/strategyData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { StrategyDelegation } from '@/types/database';

// What runs on its own, in one place. For now that is each Strategy's AI
// work: whether a verified result goes on to the next step by itself, or
// waits for a person — the same choice its page offers under Execution.

const CHOICES: { value: StrategyDelegation; label: string }[] = [
  { value: 'manual', label: 'A person reviews each result' },
  { value: 'auto', label: 'Verified results go on to the next step' },
];

export function AutomationView({ onOpenStrategy }: { onOpenStrategy: (id: string) => void }) {
  const { t } = useI18n();
  const { data: strategies, loading, refetch } = useStrategiesInSpace();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (id: string, delegation: StrategyDelegation) => {
    setSaving(id); setError(null);
    try { await updateStrategy(id, { delegation }); refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(null); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <IslandHeader crumbs={[{ id: 'automation', label: t('Automation') }]} count={strategies.length} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <p className="mb-3 text-[13px] text-muted-foreground">{t('What each Strategy’s AI work does when a run finishes.')}</p>
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
    </div>
  );
}
