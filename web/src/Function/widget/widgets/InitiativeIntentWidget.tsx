'use client';

import { useMemo, useState } from 'react';
import { linkObjectToStrategy, useStrategies, useStrategiesInSpace } from '@/hooks/useSupabase';
import { StrategyIntentBody } from '@/ActivitySpace/execution/object/overview/StrategyIntentBody';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WidgetHost } from '../types';

/**
 * Initiative intent — the strategic "why" behind this Object, excerpted from
 * the description of the Initiative(s) it feeds.
 *
 * Fetches its own Initiative list rather than being handed one: the host
 * resolves the subject (this Object and its Elements) and nothing more, so a
 * widget that needs Initiatives is the widget that asks for them.
 */
export function InitiativeIntentWidget({ host }: { host: WidgetHost }) {
  const { data: allStrategies } = useStrategies();
  const objectId = host.object?.id;

  const owning = useMemo(
    () => (objectId ? allStrategies.filter((s) => s.objectIds.includes(objectId)) : []),
    [allStrategies, objectId],
  );

  // An Object in no Initiative is work no intent explains. Say so, and offer
  // the link, rather than hiding the island — the gap is the thing to see.
  if (owning.length === 0) return objectId ? <NoInitiative objectId={objectId} /> : null;

  return (
    <StrategyIntentBody
      strategies={owning}
      onOpenStrategy={(strategyId) => {
        host.onNavigate?.({ strategyId });
        host.onViewChange?.('strategy');
      }}
    />
  );
}

function NoInitiative({ objectId }: { objectId: string }) {
  const { t } = useI18n();
  const { data: strategies } = useStrategiesInSpace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = async (strategyId: string) => {
    if (!strategyId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await linkObjectToStrategy(strategyId, objectId);
    } catch (e) {
      // A PostgREST error is a plain object: read its code and message.
      const failure = e as { code?: string; message?: string } | null;
      setError(failure?.code === '42501'
        ? t('Only the Initiative’s owner or an owner of its Space can link Objects to it.')
        : failure?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 px-2 py-1.5">
      <p className="text-[12px] text-muted-foreground">{t('This Object contributes to no Initiative yet.')}</p>
      {strategies.length > 0 && (
        <select aria-label={t('Link to an Initiative')} value="" disabled={busy}
          onChange={(e) => void link(e.target.value)}
          className="h-7 w-full rounded-md bg-muted/30 px-1.5 text-[12px] text-foreground outline-none hover:bg-muted/40 focus:bg-muted/60 disabled:opacity-50">
          <option value="">{t('Link to an Initiative…')}</option>
          {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {error && <p role="alert" className="text-[11px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}
