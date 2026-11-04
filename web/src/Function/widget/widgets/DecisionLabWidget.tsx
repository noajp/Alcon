'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useDecisionLab } from '@/hooks/useDecisionLab';
import { recordDecisionLabDecision } from '@/hooks/decisionLabDecision';
import { DecisionLab, type DecisionLabChoice } from '@/ActivitySpace/strategy/initiative/DecisionLab';
import { decisionLabRecord } from '@/ActivitySpace/strategy/initiative/decisionLabRecord';
import { compareDecisionLab } from '@/ActivitySpace/strategy/initiative/decisionLabModel';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { translate, useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import type { WidgetHost } from '../types';

const ElementDetailView = dynamic(() => import('@/ActivitySpace/execution/element/ElementDetailView').then((module) => module.ElementDetailView), {
  loading: () => <p className="p-4 text-sm text-muted-foreground">{translate('Loading Element…')}</p>,
});

export function DecisionLabWidget({ host }: { host: WidgetHost }) {
  const query = useDecisionLab(host.subject.id);
  return <DecisionLabSession key={query.contextKey} host={host} query={query} />;
}

function DecisionLabSession({ host, query }: { host: WidgetHost; query: ReturnType<typeof useDecisionLab> }) {
  const { t } = useI18n();
  const initiative = useInitiativeIntentContext();
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const identity = useRef<{ key: string; decisionId: string; bindingId: string; at: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const data = query.data;
  const input = useMemo(() => data ? { ...data, today: toDateOnlyString(new Date()) } : null, [data]);
  const selected = data?.elements.find((element) => element.id === openId);
  const selectedObject = data?.objects.find((object) => object.id === selected?.object_id || selected?.objectIds?.includes(object.id));
  const records = (initiative?.data?.subs ?? []).filter((intent) => intent.slug === 'decision-lab')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function refresh() {
    setRefreshing(true);
    try { return await query.refresh(); }
    finally { setRefreshing(false); }
  }

  async function record(choice: DecisionLabChoice) {
    if (!initiative || !data || !input) throw new Error(t('The Strategy is not ready. Refresh and try again.'));
    if (!query.canRecord) throw new Error(t('Only the Strategy owner can record decisions.'));
    if (initiative.initiativeId !== host.subject.id) throw new Error(t('The Strategy changed. Reopen Decision Lab.'));
    const record = decisionLabRecord(choice.input, choice.comparison, choice.scenario, choice.label, choice.reason);
    if (!record.targetId) throw new Error(t('Choose an Element first.'));
    const key = JSON.stringify([host.subject.id, choice.comparison.fingerprint, record]);
    const retry = identity.current?.key === key;
    if (!retry) {
      const latest = await refresh();
      if (!alive.current) throw new Error(t('The Strategy changed. Reopen Decision Lab.'));
      const current = compareDecisionLab({ ...latest, today: toDateOnlyString(new Date()), workweek: choice.input.workweek }, choice.scenario);
      if (current.fingerprint !== choice.comparison.fingerprint) throw new Error(t('The source plan changed. The comparison has been refreshed; review it before recording.'));
      identity.current = { key, decisionId: crypto.randomUUID(), bindingId: crypto.randomUUID(), at: new Date().toISOString() };
    }
    const pending = identity.current!;
    const parentId = await initiative.ensureRoot();
    if (!alive.current) throw new Error(t('The Strategy changed. Reopen Decision Lab.'));
    await recordDecisionLabDecision({
      id: pending.decisionId, strategy_id: initiative.initiativeId, parent_intent_id: parentId,
      kind: 'decision', slug: 'decision-lab', title: record.title, subtitle: record.subtitle,
      abandoned: record.abandoned, decided_at: pending.at, status: 'on_track',
      order_index: (initiative.data?.subs.length ?? 0) + 1,
    }, pending.bindingId, record.targetId);
    initiative.refetch();
  }

  const close = () => setOpenId(null);
  const navigate = (objectId: string, domainId?: string | null) => { close(); host.onNavigate?.({ objectId, domainId }); };

  return <>
    {query.error && data.readAt && <p role="alert" className="mb-2 text-sm text-[var(--status-danger)]">{t('Could not refresh the plan. This comparison uses the last complete reading.')}</p>}
    {!query.enabled ? <p className="py-2 text-sm text-muted-foreground">{t('Select an Activity Space and sign in to compare its work.')}</p> : query.error && !data.readAt ? <div className="space-y-2 py-2">
      <p role="alert" className="text-sm text-[var(--status-danger)]">{t('Could not read the complete plan. No comparison is shown.')}</p>
      <Button variant="secondary" size="sm" onClick={() => { void refresh().catch(() => undefined); }} disabled={refreshing}>{t('Retry')}</Button>
    </div> : query.loading || !input || !data ? <p className="py-2 text-sm text-muted-foreground">{t('Reading shared work and capacity…')}</p> :
      <DecisionLab input={input} objects={data.objects} canRecord={query.canRecord} refreshing={refreshing || query.refreshing} onRefresh={refresh} onOpenElement={setOpenId} onRecord={record} />}

    {records.length > 0 && <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-3">
      <p className="text-sm font-medium">{t('Recorded plans')}</p>
      {records.map((saved) => <details key={saved.id} className="text-sm">
        <summary className="cursor-pointer rounded-md py-1 focus-visible:bg-muted">{saved.title}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">{saved.subtitle}</p>
      </details>)}
    </div>}

    <Dialog open={openId !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="flex h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-6xl" aria-describedby={undefined} showCloseButton={false}>
        <DialogTitle className="sr-only">{t('Put the decision into action')}</DialogTitle>
        {selected ? <ElementDetailView key={selected.id} element={selected} objectName={selectedObject?.name}
          objectPath={selectedObject ? [{ id: selectedObject.id, name: selectedObject.name }] : []}
          onBack={close} onNavigateRoot={close}
          onRefresh={() => { void refresh().catch(() => undefined); host.onRefresh?.(); }}
          onNavigateObject={(id) => navigate(id, data?.objects.find((object) => object.id === id)?.domain_id)}
          onOpenStrategy={(strategyId) => { close(); host.onNavigate?.({ strategyId }); }} /> : <div className="space-y-2 p-4">
            <p className="text-sm">{t('This Element is no longer available.')}</p><Button variant="ghost" size="sm" onClick={close}>{t('Back to comparison')}</Button>
          </div>}
      </DialogContent>
    </Dialog>
  </>;
}
