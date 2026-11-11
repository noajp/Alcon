'use client';

import { useMemo, useState } from 'react';
import { Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useObjectMilestones } from '@/hooks/useSupabase';
import { MilestoneList } from '@/Function/shared/milestones/MilestoneList';
import { WidgetHeaderAction, useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/** The Objects a board's milestones come from: the Object itself, or — on a
 *  Home or Strategy board — the Objects its Elements sit in. */
function scopeObjects(host: WidgetProps['host']): { ids: string[]; names: Map<string, string> } {
  const names = new Map<string, string>();
  if (host.subject.kind === 'object' && host.subject.id) {
    return { ids: [host.subject.id], names };
  }
  const ids = new Set<string>();
  for (const el of host.elements) {
    if (el.object_id) ids.add(el.object_id);
    for (const id of el.objectIds ?? []) ids.add(id);
    for (const o of el.objects ?? []) names.set(o.id, o.name);
  }
  return { ids: [...ids], names };
}

/**
 * The milestones of the Objects in scope (MilestoneList). On an Object board
 * they are edited here; elsewhere they are read across those Objects.
 */
export function MilestonesWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const { ids, names } = useMemo(() => scopeObjects(host), [host]);
  const { data: milestones, loading, error: loadError } = useObjectMilestones(ids);
  const objectId = host.subject.kind === 'object' && !host.readOnly ? host.subject.id : null;
  const [adding, setAdding] = useState(false);

  useWidgetMeta(milestones.length > 0 ? String(milestones.length) : null);
  // Read-only boards hide an empty widget; an Object's keeps its `+`. A read
  // that failed is not "no milestones", so it stays visible and says so.
  useWidgetEmpty(!objectId && !loading && !loadError && milestones.length === 0);

  return (
    <div className="max-h-[360px] overflow-y-auto">
      {objectId && (
        <WidgetHeaderAction>
          <Button variant="ghost" size="icon-xs" aria-label={t('Add milestone')} onClick={() => setAdding(true)}>
            <Plus size={14} />
          </Button>
        </WidgetHeaderAction>
      )}
      <MilestoneList objectIds={ids} objectId={objectId} names={names} adding={adding} onAddingChange={setAdding} />
    </div>
  );
}
