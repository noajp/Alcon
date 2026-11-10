'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BoardColumn, BoardLane, CHAIN_COLUMN_WIDTH, Chip } from '@/ActivitySpace/execution/element/board/BoardColumn';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import { formatMeasureValue } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import { CARD_FLAT } from '@/shared/designTokens';
import type { AlconObject, Intent, StrategyWithObjects } from '@/types/database';
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
 *  siblings of the card's button, never nested inside it. */
function CascadeObjectChips({ strategy, objectsById, onOpenObject }: {
  strategy: StrategyWithObjects;
  objectsById: ReadonlyMap<string, AlconObject>;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
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
        if (!onOpenObject) return <span key={object.id} className="inline-flex min-w-0">{chip}</span>;
        return (
          <button key={object.id} type="button" className="group inline-flex min-w-0"
            onClick={() => onOpenObject(object.id, object.domain_id)}>
            {chip}
          </button>
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
   *  under its card. Omit to draw Strategies only. */
  objects?: readonly AlconObject[];
  /** Open an Object chip (the shell's Object view). */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { t } = useI18n();
  const lineage = useMemo(() => cascadeLineage(strategy.id, allStrategies), [strategy.id, allStrategies]);
  const byId = useMemo(() => new Map(allStrategies.map((s) => [s.id, s] as const)), [allStrategies]);
  const objectsById = useMemo(
    () => new Map((objects ?? []).map((o) => [o.id, o] as const)),
    [objects],
  );
  const visibleIds = useMemo(() => lineage.flat(), [lineage]);
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
          <CascadeObjectChips strategy={s} objectsById={objectsById} onOpenObject={onOpenObject} />
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
    </div>
  );
}
