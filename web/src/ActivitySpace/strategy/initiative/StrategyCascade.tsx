'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BoardColumn, BoardLane } from '@/ActivitySpace/execution/element/board/BoardColumn';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import { formatMeasureValue } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import { CARD_FLAT } from '@/shared/designTokens';
import type { Intent, StrategyWithObjects } from '@/types/database';
import { cascadeLevels } from './cascadeModel';

// The Cascade down tab: how this Strategy decomposes, drawn with the
// Execution Chain's own columns and card ground. The Strategy itself
// stands in the first column; each column to the right is one generation
// further down — children, grandchildren, descendants — each card saying
// what that Strategy is for (its description) and the first of its
// success conditions. Read-only: nesting is written on the Overview and
// in the Strategy list; this tab is where the shape of it is read.
// A card opens its Strategy, so the descent can be walked. Like every
// board, it stands vertical or lies horizontal — the page's tabs-row
// toggle decides, on the one shared orientation preference.

/** The column a generation stands in: the root by its own name, then
 *  children, grandchildren, and every deeper generation as descendants. */
function levelLabel(depth: number, rootName: string, t: ReturnType<typeof useI18n>['t']): string {
  if (depth === 0) return rootName;
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

export function StrategyCascade({ strategy, allStrategies, onOpenStrategy, orientation }: {
  /** The Strategy this page is about — the cascade's root. */
  strategy: StrategyWithObjects;
  /** Every Strategy, so the descent can be read off the nesting links. */
  allStrategies: StrategyWithObjects[];
  /** Open a Strategy of the cascade (drill into it, in this shell). */
  onOpenStrategy: (id: string) => void;
  /** The board's orientation, from the page's tabs-row toggle. */
  orientation: BoardOrientation;
}) {
  const { t } = useI18n();
  const levels = useMemo(() => cascadeLevels(strategy.id, allStrategies), [strategy.id, allStrategies]);
  const byId = useMemo(() => new Map(allStrategies.map((s) => [s.id, s] as const)), [allStrategies]);
  const visibleIds = useMemo(() => levels.flat(), [levels]);
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

  // A Strategy with nothing nested under it still shows the shape: its
  // own column, and the empty child column the next generation would
  // stand in — the columns are always shown, as on the chain.
  const shown = levels.length === 1 ? [...levels, []] : levels;

  const cardsOf = (ids: string[]) => ids.flatMap((id) => {
    const s = byId.get(id);
    if (!s) return [];
    return [{
      id,
      node: (
        <CascadeCard key={id} strategy={s} measures={measuresByStrategy.get(id) ?? []}
          onOpen={() => onOpenStrategy(id)} />
      ),
    }];
  });
  const groupProps = (depth: number, ids: string[]) => ({
    mark: depth === 0
      ? <ItemIcon icon={strategy.icon} color={strategy.color} size={14} fallback={<NavStrategyIcon size={14} />} />
      : <NavStrategyIcon size={14} />,
    label: levelLabel(depth, strategy.name, t),
    count: ids.length,
    empty: depth === 1 ? t('No child Strategies yet') : undefined,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {orientation === 'horizontal' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
          {shown.map((ids, depth) => (
            <BoardLane key={depth} {...groupProps(depth, ids)}>
              {cardsOf(ids).map((c) => (
                <div key={c.id} className="w-72 shrink-0">{c.node}</div>
              ))}
            </BoardLane>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {shown.map((ids, depth) => (
            <BoardColumn key={depth} {...groupProps(depth, ids)}>
              {cardsOf(ids).map((c) => c.node)}
            </BoardColumn>
          ))}
        </div>
      )}
    </div>
  );
}
