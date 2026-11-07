'use client';

import { useMemo } from 'react';
import { RailRow } from '@/Function/shared/RailRow';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { OptionMenu } from '@/Function/shared/OptionMenu';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { completionOf } from '@/Function/shared/completion';
import { formatRelative } from '@/Function/shared/dateUtils';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { useSpaceRole } from '@/Function/space/data';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { updateStrategy, useStrategies, useWorkers } from '@/hooks/useSupabase';
import { setStrategyDefinition, useDefinitions } from '@/hooks/definitionData';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import { measureStateOf } from '@/ActivitySpace/strategy/initiative/mission/missionModel';
import type { StrategyDelegation } from '@/types/database';
import type { WidgetHost } from '../types';

// =============================================================
// Properties — a Strategy's facts, as the island beside its Overview: who
// owns it, how far its work has come, how many of its success conditions are
// met, what happens when an AI finishes, the harness its work follows, and
// when it was made and last changed. The same rail island an Object has.
// =============================================================

/** The harness picker's value for "no harness of its own". */
const SPACE_DEFAULT = '__space';

export function StrategyPropertiesWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const { data: strategies, refetch } = useStrategies();
  const { data: workers } = useWorkers();
  const strategy = strategies.find((s) => s.id === host.subject.id) ?? null;
  const ownsItsSpace = useSpaceRole(strategy?.activity_space_id ?? null) === 'owner';
  const library = useDefinitions(strategy?.activity_space_id ?? null);
  const intent = useInitiativeIntentContext();

  const progress = useMemo(() => completionOf(host.elements), [host.elements]);
  const measures = (intent?.data?.subs ?? []).filter((i) => i.kind === 'measure');
  const met = measures.filter((m) => measureStateOf({
    id: m.id, title: m.title, target_value: m.target_value, actual_value: m.actual_value, unit: m.unit, direction: m.direction,
  }) === 'met').length;

  if (!strategy) return null;
  const canEdit = canEditInitiative(user?.id ?? null, strategy.created_by, ownsItsSpace);
  const owner = workers.find((w) => w.user_id && w.user_id === strategy.created_by) ?? null;
  const harness = library.data.find((d) => d.id === strategy.definition_id) ?? null;
  const setHarness = async (definitionId: string | null) => {
    await setStrategyDefinition(strategy.id, definitionId);
    await refetch();
    host.onRefresh?.();
  };
  const setDelegation = async (delegation: StrategyDelegation) => {
    await updateStrategy(strategy.id, { delegation });
    await refetch();
    host.onRefresh?.();
  };

  return (
    <div className="py-1">
      <RailRow name={t('Owner')} placeholder={!owner}
        icon={owner ? <WorkerAvatar worker={owner} size={16} /> : undefined}
        label={owner?.name ?? t('Unknown')} />
      <RailRow name={t('Progress')} label={
        <span className="flex w-full items-center gap-2">
          <SegmentedProgress value={progress.pct} className="flex-1" />
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{progress.pct}%</span>
        </span>
      } />
      <RailRow name={t('Elements')} icon={<ElementIcon size={12} className="text-muted-foreground" />}
        label={<span className="tabular-nums">{t('{done} of {all} done', { done: progress.done, all: progress.total })}</span>} />
      <RailRow name={t('Success conditions')} placeholder={measures.length === 0}
        label={measures.length === 0 ? t('None yet') : <span className="tabular-nums">{t('{met} of {all} met', { met, all: measures.length })}</span>} />
      <RailRow name={t('When an AI finishes')} label={
        <OptionMenu label={t('When an AI finishes')} value={strategy.delegation ?? 'manual'} disabled={!canEdit}
          onChange={(v) => void setDelegation(v)}
          options={[
            { value: 'manual' as StrategyDelegation, label: t('A person reviews each result'), hint: t('Nothing starts until you approve the result.') },
            { value: 'auto' as StrategyDelegation, label: t('Verified results go on to the next step'), hint: t("Stops at a person's Element, an approval or a blocked run.") },
          ]} />
      } />
      <RailRow name={t('Harness')} label={
        <OptionMenu label={t('Harness')} value={harness?.id ?? SPACE_DEFAULT} disabled={!canEdit}
          onChange={(v) => void setHarness(v === SPACE_DEFAULT ? null : v)}
          options={[
            { value: SPACE_DEFAULT, label: t("The Space's default") },
            // A binding to an off harness stays stored and is shown as such;
            // new selections offer enabled harnesses only.
            ...(harness && !harness.enabled ? [{ value: harness.id, label: `${harness.name} · ${t('Off')}` }] : []),
            ...library.data.filter((d) => d.enabled).map((d) => ({ value: d.id, label: d.name })),
          ]} />
      } />
      <RailRow name={t('Created')} label={formatRelative(strategy.created_at)} />
      <RailRow name={t('Updated')} label={formatRelative(strategy.updated_at)} />
    </div>
  );
}
