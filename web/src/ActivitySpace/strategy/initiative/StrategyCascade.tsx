'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BoardColumn, BoardLane, CHAIN_COLUMN_WIDTH, Chip } from '@/ActivitySpace/execution/element/board/BoardColumn';
import { ThickArrowRight } from '@/ActivitySpace/execution/element/board/ElementCard';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import { useElementChainRows } from '@/hooks/initiativeMissionData';
import { useNowMinute } from '@/Function/shared/useNow';
import { displayIdOf } from '@/Function/shared/element/displayId';
import { ExecutePlanDialog, type ExecuteTarget, type ObjectExecuteTarget } from '@/ActivitySpace/execution/element/agent';
import { waitingReason, type WaitingReason } from '@/ActivitySpace/execution/chain/waiting';
import {
  fleetCard, fleetCardContext, latestRuns, missionElementRow,
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';
import { formatMeasureValue } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import { CARD_FLAT } from '@/shared/designTokens';
import type { AlconObject, AlconObjectWithChildren, Intent, StrategyWithObjects } from '@/types/database';
import { cascadeLineage, cascadeObjectChips } from './cascadeModel';

// The Cascade tab: this Strategy's whole lineage, drawn with the
// Execution Chain's own columns and card ground. The Strategy itself
// stands in its own column; the columns before it are its ancestry —
// parents, grandparents, ancestors up to the root — and each column
// after it is one generation further down — children, grandchildren,
// descendants — each card saying what that Strategy is for (its
// description) and the first of its success conditions. Read-only:
// nesting is written on the Overview and in the Strategy list; this tab
// is where the shape of it is read. A card opens its Strategy, so the
// lineage can be walked up as well as down. Under each card stand the
// Objects that Strategy holds, as the pill chips the Chain teaches —
// descent goes right, contents stay home — and a pill opens its Object.
// The one act this tab allows stands beside the pill, never inside it:
// the execute segment (card hover-execute, PR3) opens that Object's
// execute manifest — the same ExecutePlanDialog the Chain's chip
// segment opens (PR2), hosted here, never forked.
// Like every board, it stands vertical or lies horizontal — the page's
// tabs-row toggle decides, on the one shared orientation preference.

/** The column a generation stands in, by its signed depth from this
 *  Strategy: negative is up (parents, grandparents, and every higher
 *  generation as ancestors), 0 is this Strategy itself (its card already
 *  carries its name), positive is down (children, grandchildren, and
 *  every deeper generation as descendants). */
function levelLabel(depth: number, t: ReturnType<typeof useI18n>['t']): string {
  if (depth <= -3) return t('Ancestor Strategies');
  if (depth === -2) return t('Grandparent Strategies');
  if (depth === -1) return t('Parent Strategies');
  if (depth === 0) return t('This Strategy');
  if (depth === 1) return t('Child Strategies');
  if (depth === 2) return t('Grandchild Strategies');
  return t('Descendant Strategies');
}

/** One quiet line for a Strategy's first success condition: its name and
 *  where the reading stands against the target, in the measure's unit. */
function measureLine(measure: Intent): string {
  const actual = formatMeasureValue(measure.actual_value, measure.unit);
  const target = formatMeasureValue(measure.target_value, measure.unit);
  if (target) return `${measure.title} — ${actual ?? '–'}/${target}`;
  if (actual) return `${measure.title} — ${actual}`;
  return measure.title;
}

/** A Strategy as a card of the cascade: its mark and name, what it is
 *  for, and the first of its success conditions. */
function CascadeCard({ strategy, measures, onOpen }: {
  strategy: StrategyWithObjects;
  measures: Intent[];
  onOpen: () => void;
}) {
  const description = strategy.description?.trim() ?? '';
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD_FLAT, 'block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/40')}>
      <div className="flex items-start gap-2">
        <ItemIcon icon={strategy.icon} color={strategy.color} size={15} className="mt-0.5"
          fallback={<NavStrategyIcon size={15} />} />
        <p className="min-w-0 flex-1 break-words text-[13px] font-medium leading-5 line-clamp-2">{strategy.name}</p>
      </div>
      {description && (
        <p className="mt-1 break-words text-[12px] leading-5 text-muted-foreground line-clamp-3">{description}</p>
      )}
      {measures.length > 0 && (
        <p className="mt-1.5 truncate text-[12px] tabular-nums text-muted-foreground">{measureLine(measures[0])}</p>
      )}
    </button>
  );
}

/** The Objects one Strategy holds, as pills under its card: descent
 *  goes right, contents stay home. The pill is the Object's face
 *  everywhere else — the Chain's cards name their Object with it — so
 *  the kind difference needs no caption: a card is a Strategy, a pill
 *  is an Object. Capped, with the rest counted on a plain chip (the
 *  full list stands on the Strategy's Overview); a Strategy holding no
 *  Objects grows no group at all. The pills are their own buttons,
 *  siblings of the card's button, never nested inside it.
 *
 *  The execute segment is a sibling button after the navigating pill —
 *  never nested inside it, per the nesting rule above — carrying the
 *  rail's thick arrow at the chip segment's 11px, with the Chain
 *  segment's reveal discipline (§3.5): shown while its entry block is
 *  hovered or focused within, always where there is no hover. The
 *  pill's own click keeps its one meaning (open the Object); the
 *  segment's click opens the Object's execute manifest instead. */
function CascadeObjectChips({ strategy, objectsById, onOpenObject, onExecuteObject }: {
  strategy: StrategyWithObjects;
  objectsById: ReadonlyMap<string, AlconObject>;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onExecuteObject?: (objectId: string) => void;
}) {
  const { t } = useI18n();
  const { chips, overflow } = cascadeObjectChips(strategy.objectIds, objectsById);
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((object) => {
        const chip = (
          <Chip title={object.name} className="max-w-full transition-colors group-hover:bg-muted">
            <ItemIcon icon={object.icon ?? null} color={object.color ?? null} size={11} fallback={<ObjectIcon size={11} />} />
            <span className="truncate">{object.name}</span>
          </Chip>
        );
        const navigating = !onOpenObject
          ? <span className="inline-flex min-w-0">{chip}</span>
          : (
            <button type="button" className="group inline-flex min-w-0"
              onClick={() => onOpenObject(object.id, object.domain_id)}>
              {chip}
            </button>
          );
        if (!onExecuteObject) {
          return <span key={object.id} className="inline-flex min-w-0">{navigating}</span>;
        }
        return (
          <span key={object.id} className="group/chip inline-flex min-w-0 items-center gap-0.5">
            {navigating}
            <button type="button" aria-label={t('Execute Object')} title={t('Execute Object')}
              onClick={() => onExecuteObject(object.id)}
              className="flex h-5 shrink-0 items-center rounded-md border border-border/60 bg-muted/40 px-1 text-muted-foreground transition-opacity hover:text-foreground opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 [@media(hover:none)]:opacity-100">
              <ThickArrowRight size={11} />
            </button>
          </span>
        );
      })}
      {overflow > 0 && <Chip>+{overflow}</Chip>}
    </div>
  );
}

export function StrategyCascade({ strategy, allStrategies, onOpenStrategy, orientation, objects, onOpenObject }: {
  /** The Strategy this page is about — the cascade's centre. */
  strategy: StrategyWithObjects;
  /** Every Strategy, so the lineage can be read off the nesting links. */
  allStrategies: StrategyWithObjects[];
  /** Open a Strategy of the cascade (drill into it, in this shell). */
  onOpenStrategy: (id: string) => void;
  /** The board's orientation, from the page's tabs-row toggle. */
  orientation: BoardOrientation;
  /** Every Object, so each Strategy's held Objects can stand as chips
   *  under its card — with their Elements, so a chip's execute segment
   *  can build its Object's manifest from the same rows. Omit to draw
   *  Strategies only. */
  objects?: readonly AlconObjectWithChildren[];
  /** Open an Object chip (the shell's Object view). */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { t } = useI18n();
  // The one Execute popup for this board (card hover-execute, PR3): a
  // chip's segment names its Object, the dialog does the rest — the
  // same Object mode the Chain boards open from their chip segment.
  const [executeTarget, setExecuteTarget] = useState<ExecuteTarget | null>(null);
  const lineage = useMemo(() => cascadeLineage(strategy.id, allStrategies), [strategy.id, allStrategies]);
  const byId = useMemo(() => new Map(allStrategies.map((s) => [s.id, s] as const)), [allStrategies]);
  const objectsById = useMemo(
    () => new Map((objects ?? []).map((o) => [o.id, o] as const)),
    [objects],
  );
  const visibleIds = useMemo(() => lineage.flat(), [lineage]);

  // The manifest's readings, over the Objects the lineage actually
  // shows: their Elements (from the Object rows the shell already
  // loads), and their runs and depends_on edges — the rows a Domain's
  // chain reads through the same hook, so a manifest opened here can
  // never disagree with a board. Ticks, so a lease that lapses while
  // the tab is open stops reading as held.
  const now = useNowMinute(true);
  const visibleElements = useMemo(() => {
    const objectIds = new Set<string>();
    for (const id of visibleIds) for (const oid of byId.get(id)?.objectIds ?? []) objectIds.add(oid);
    const seen = new Set<string>();
    const out: NonNullable<AlconObjectWithChildren['elements']>[number][] = [];
    for (const o of objects ?? []) {
      if (!objectIds.has(o.id)) continue;
      for (const e of o.elements ?? []) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }, [objects, visibleIds, byId]);
  const elementIds = useMemo(() => visibleElements.map((e) => e.id), [visibleElements]);
  const chainRows = useElementChainRows(elementIds);
  const { runs, edges } = chainRows.data;
  const rows = useMemo(
    () => visibleElements.map((e) => missionElementRow(e, e.object_id ?? null, now)),
    [visibleElements, now],
  );
  // Each Element's waiting reason, built the Domain chain's way — the
  // fleet core over the same rows, runs and edges — so the manifest's
  // waiting words are the chain's own.
  const reasonMap = useMemo(() => {
    const ctx = fleetCardContext({ elements: rows, measures: [], bindings: [], edges, runs });
    const latest = latestRuns(runs);
    const out = new Map<string, WaitingReason | null>();
    for (const r of rows) {
      const card = fleetCard(ctx, r);
      out.set(r.id, waitingReason({ element: card, latestRun: latest.get(r.id), blockers: card.blockers }));
    }
    return out;
  }, [rows, edges, runs]);

  // The Object popup's target, built at the press from what this board
  // already reads: the Object's own Elements (its row's, read under
  // that Object), every visible Element as the blocker lookup's
  // upstreams, the edges, the runs, and the waiting map above. This
  // host knows the Object's Domain only by id, not by name, so the
  // header's Domain line stays out — its prefix stands instead.
  const objectTargetFor = (objectId: string): ObjectExecuteTarget | null => {
    const object = objectsById.get(objectId);
    if (!object) return null;
    return {
      id: object.id, name: object.name, icon: object.icon ?? null, color: object.color ?? null,
      prefixLabel: displayIdOf(object) ?? object.prefix ?? null,
      manifest: {
        elements: (object.elements ?? []).map((e) => missionElementRow(e, objectId, now)),
        upstreams: rows, edges, runs, waiting: reasonMap,
      },
    };
  };
  const { measures } = useInitiativeMeasures(visibleIds);
  const measuresByStrategy = useMemo(() => {
    const out = new Map<string, Intent[]>();
    for (const m of measures) {
      const list = out.get(m.strategy_id) ?? [];
      list.push(m);
      out.set(m.strategy_id, list);
    }
    return out;
  }, [measures]);

  // The level this Strategy itself stands in. A level's signed depth is
  // its distance from that level — negative toward the ancestors,
  // positive toward the descendants.
  const rootAt = lineage.findIndex((level) => level.includes(strategy.id));

  // A Strategy with nothing nested under it still shows the shape: its
  // own column, and the empty child column the next generation would
  // stand in — the columns are always shown, as on the chain. Ancestors
  // standing before it do not change that; the ancestor side itself
  // gets no synthetic empty column — lineage is context, not a place
  // waiting to be filled.
  const shown = lineage.length === 0 || rootAt < lineage.length - 1
    ? lineage
    : [...lineage.slice(0, rootAt + 1), [], ...lineage.slice(rootAt + 1)];

  // The unit of a column is an entry: the Strategy's card with its
  // Objects group as one block, so the column's rhythm separates
  // entries — never a card from its own Objects.
  const cardsOf = (ids: string[]) => ids.flatMap((id) => {
    const s = byId.get(id);
    if (!s) return [];
    return [{
      id,
      node: (
        <div key={id}>
          <CascadeCard strategy={s} measures={measuresByStrategy.get(id) ?? []}
            onOpen={() => onOpenStrategy(id)} />
          <CascadeObjectChips strategy={s} objectsById={objectsById} onOpenObject={onOpenObject}
            onExecuteObject={(objectId) => { const target = objectTargetFor(objectId); if (target) setExecuteTarget({ kind: 'object', object: target }); }} />
        </div>
      ),
    }];
  });
  const groupProps = (depth: number, ids: string[]) => ({
    mark: depth === 0
      ? <ItemIcon icon={strategy.icon} color={strategy.color} size={14} fallback={<NavStrategyIcon size={14} />} />
      : <NavStrategyIcon size={14} />,
    label: levelLabel(depth, t),
    count: ids.length,
    empty: depth === 1 ? t('No child Strategies yet') : undefined,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {orientation === 'horizontal' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {shown.map((ids, index) => (
            <BoardLane key={index} {...groupProps(index - rootAt, ids)}>
              {cardsOf(ids).map((c) => (
                <div key={c.id} className={cn(CHAIN_COLUMN_WIDTH, 'shrink-0')}>{c.node}</div>
              ))}
            </BoardLane>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {shown.map((ids, index) => (
            <BoardColumn key={index} {...groupProps(index - rootAt, ids)}>
              {cardsOf(ids).map((c) => c.node)}
            </BoardColumn>
          ))}
        </div>
      )}
      <ExecutePlanDialog target={executeTarget} open={executeTarget !== null}
        onOpenChange={(next) => { if (!next) setExecuteTarget(null); }}
        onFinished={() => chainRows.refetch()} />
    </div>
  );
}
