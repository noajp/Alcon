'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useNowMinute } from '@/Function/shared/useNow';
import { advanceFromElement } from '@/AIP/ai/agentData';
import { updateElement, type ElementWithDetails } from '@/hooks/useSupabase';
import { CREATE_ELEMENT_EVENT, type CreateElementDetail } from '@/Frame/QuickAddElementLauncher';
import { useElementChainRows } from '@/hooks/initiativeMissionData';
import { useRunRounds } from '@/hooks/definitionData';
import { ExecutionChain, chainStatusOf, emptyChain, type ChainStatus } from '@/ActivitySpace/execution/chain/ExecutionChain';
import { BoardOrientationToggle, useBoardOrientation } from '@/Function/shared/boardOrientation';
import { AddElementMenu, ChainCard } from '@/ActivitySpace/execution/chain/ChainCard';
import { ExecutePlanDialog, type ExecuteTarget, type ObjectExecuteTarget } from '@/ActivitySpace/execution/element/agent';
import { waitingReason, type WaitingReason } from '@/ActivitySpace/execution/chain/waiting';
import {
  fleetCard, fleetCardContext, handOverLabels, latestRuns, missionElementRow, orderFleetCards,
  type FleetElement, type FleetObjectRow,
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';

// An Object's Board: its Elements in their Status columns — the same
// chain a Strategy draws while the Planner's draft is open, the same
// cards, the same fleet readings — with no Strategy around them. What a Strategy
// adds and a Domain has no meaning for is left out, not faked: there are
// no measures to serve and no cost to total, and the cards' serves lines
// stay empty.
//
// A drop takes the Strategy chain's path — write the Status, let
// acceptance land when the work closes (advanceFromElement on done /
// cancelled), refetch — so a drag here and a drag there can never
// diverge, and a failed move says so instead of snapping back silently.

export function DomainChain({ elements, objects, domainId, canEdit, onRefresh, onOpenElement, nameObjects = true }: {
  /** The Domain's Elements — its Objects' and its own root Elements. */
  elements: ElementWithDetails[];
  /** The Domain's Objects, for the cards that name theirs and the "+". */
  objects: { id: string; name: string; icon?: string | null; color?: string | null }[];
  domainId: string | null;
  /** A Domain viewer reads; the drops and adds would only be refused. */
  canEdit: boolean;
  onRefresh?: () => void;
  /** Open an Element's detail (the drilldown this tab borrows). */
  onOpenElement: (elementId: string) => void;
  /** False inside one Object, where every card would name the same one. */
  nameObjects?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The one Execute popup for this board (card hover-execute, PR1/PR2):
  // a card's rail names its Element, its Object chip's segment names
  // the Object, the dialog does the rest.
  const [executeTarget, setExecuteTarget] = useState<ExecuteTarget | null>(null);
  // The board's orientation — the one preference every board shares.
  const [orientation, setOrientation] = useBoardOrientation();
  // Ticks, so a lease that lapses while the tab is open stops reading as running.
  const now = useNowMinute(true);

  const rows = useMemo(
    () => elements.map((e) => missionElementRow(e, e.object_id ?? null, now)),
    [elements, now],
  );
  const details = useMemo(() => new Map(elements.map((e) => [e.id, e] as const)), [elements]);
  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);
  const chainRows = useElementChainRows(elementIds);
  const { runs, edges } = chainRows.data;
  const rounds = useRunRounds(elementIds);

  const refetch = () => { chainRows.refetch(); onRefresh?.(); };

  // The fleet readings, flat: no Objects group the cards here — the
  // columns do — but each card is built by the same core the Strategy's
  // buildFleet uses, from the same context over the Domain's Elements.
  const cards = useMemo(() => {
    const ctx = fleetCardContext({ elements: rows, measures: [], bindings: [], edges, runs });
    return orderFleetCards(rows.map((r) => fleetCard(ctx, r)));
  }, [rows, edges, runs]);
  const latest = useMemo(() => latestRuns(runs), [runs]);
  const reasonMap = useMemo(() => {
    const out = new Map<string, WaitingReason | null>();
    for (const c of cards) {
      if (!c.elementId) continue;
      out.set(c.elementId, waitingReason({ element: c, latestRun: latest.get(c.elementId), blockers: c.blockers }));
    }
    return out;
  }, [cards, latest]);
  const objectRows = useMemo<FleetObjectRow[]>(
    () => objects.map((o) => ({ id: o.id, name: o.name, domain_id: domainId, icon: o.icon ?? null, color: o.color ?? null })),
    [objects, domainId],
  );
  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);

  // The Object popup's target, built at the press from what this board
  // already reads: the Object's Elements (the rows), every row as the
  // blocker lookup's upstreams, the depends_on edges, the runs, and
  // the same waiting map the cards' chips read. This host knows its
  // Domain's id, not its name, so the header's Domain line stays out.
  const objectTargetFor = (objectId: string): ObjectExecuteTarget | null => {
    const object = objectById.get(objectId);
    if (!object) return null;
    return {
      id: object.id, name: object.name, icon: object.icon ?? null, color: object.color ?? null,
      manifest: {
        elements: rows.filter((r) => r.object_id === objectId),
        upstreams: rows, edges, runs, waiting: reasonMap,
      },
    };
  };

  const dropToStatus = async (status: ChainStatus, elementId: string) => {
    const written = details.get(elementId);
    if (!written || written.status === status) return;
    setError(null);
    try {
      await updateElement(elementId, { status });
      if (status === 'done' || status === 'cancelled') await advanceFromElement(elementId);
      refetch();
    } catch {
      setError(t('Could not move {title}', { title: written.title }));
    }
  };

  // A column's "+" opens the new-Element popup with the Object and the
  // column's Status preset.
  const addToColumn = (status: ChainStatus, objectId: string) => {
    window.dispatchEvent(new CustomEvent<CreateElementDetail>(CREATE_ELEMENT_EVENT, { detail: { objectId, status } }));
  };

  const handOver = async (element: FleetElement) => {
    if (!element.elementId) return;
    setBusy(element.elementId); setError(null);
    try {
      const detail = details.get(element.elementId);
      await updateElement(element.elementId, { labels: handOverLabels(detail?.labels) });
    } catch {
      setError(t('{n} could not be handed to Claude Code.', { n: 1 }));
    }
    setBusy(null);
    refetch();
  };

  const columns = emptyChain<{ key: string; node: React.ReactNode }>();
  for (const c of cards) {
    const detail = c.elementId ? details.get(c.elementId) : undefined;
    if (!c.elementId || !detail) continue;
    const object = nameObjects && detail.object_id ? objectById.get(detail.object_id) ?? null : null;
    columns[chainStatusOf(detail.status)].push({
      key: c.key,
      node: (
        <ChainCard element={c} detail={detail}
          object={object ? { id: object.id, name: object.name, icon: object.icon ?? null, color: object.color ?? null } : null}
          busy={busy !== null && busy === c.elementId}
          reason={reasonMap.get(c.elementId) ?? null}
          rounds={rounds.get(c.elementId)}
          latestRun={latest.get(c.elementId) ?? null}
          onRefresh={refetch}
          onOpen={() => onOpenElement(c.elementId!)}
          onOpenElement={onOpenElement}
          onExecute={(el) => setExecuteTarget({ kind: 'element', element: el })}
          onExecuteObject={(objectId) => { const target = objectTargetFor(objectId); if (target) setExecuteTarget({ kind: 'object', object: target }); }}
          onHandOver={c.handable ? () => void handOver(c) : undefined} />
      ),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
      {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      <div className="flex items-start gap-2">
        <BoardOrientationToggle orientation={orientation} onChange={setOrientation} className="ml-auto" />
      </div>
      <ExecutionChain orientation={orientation}
        className={orientation === 'horizontal' ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2' : 'flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2'}
        onDropStatus={canEdit ? (status, id) => void dropToStatus(status, id) : undefined}
        columnAction={canEdit && objectRows.length > 0 ? (status) => <AddElementMenu status={status} objects={objectRows} onAdd={addToColumn} /> : undefined}
        columns={columns} />
      <ExecutePlanDialog target={executeTarget} open={executeTarget !== null}
        onOpenChange={(next) => { if (!next) setExecuteTarget(null); }}
        onFinished={refetch} />
    </div>
  );
}
