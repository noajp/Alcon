'use client';

import { useMemo } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { useLatestRunStatuses } from '@/hooks/elementRunData';
import { ElementCard } from '@/ActivitySpace/execution/element/board/ElementCard';
import { ActionIcon } from '@/Function/shared/elementAction';
import { isElementAction } from '@/Function/shared/elementActionKinds';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { FLOW_COLUMNS, FLOW_COLUMN_LABEL, groupByFlowColumn, type FlowColumn } from './flowColumn';

// A Domain's Elements in columns by where they stand, left to right, so a
// person sees at a glance what waits on them. The columns follow from each
// Element's Status, action and latest AI run (flowColumnOf); cards are not
// dragged between them.

const WARNING = 'var(--status-warning)';

interface FlowBoardProps {
  elements: ElementWithDetails[];
  onRefresh?: () => void;
  onElementClick: (element: ElementWithDetails) => void;
}

export function FlowBoard({ elements, onRefresh, onElementClick }: FlowBoardProps) {
  const ids = useMemo(() => elements.map((e) => e.id), [elements]);
  const { data: runs } = useLatestRunStatuses(ids);
  const columns = useMemo(() => groupByFlowColumn(elements, (id) => runs[id] ?? null), [elements, runs]);

  return (
    <div className="flex h-full gap-3 overflow-x-auto px-4 pb-4 pt-1">
      {FLOW_COLUMNS.map((column) => (
        <FlowColumnView key={column} column={column} elements={columns[column]} onRefresh={onRefresh} onElementClick={onElementClick} />
      ))}
    </div>
  );
}

function FlowColumnView({ column, elements, onRefresh, onElementClick }: {
  column: FlowColumn;
  elements: ElementWithDetails[];
  onRefresh?: () => void;
  onElementClick: (element: ElementWithDetails) => void;
}) {
  const { t } = useI18n();
  const waiting = column === 'waiting';
  return (
    <section
      aria-label={t(FLOW_COLUMN_LABEL[column])}
      className={cn('flex h-full w-[272px] shrink-0 flex-col rounded-lg border', waiting ? '' : 'border-transparent bg-muted/40')}
      style={waiting ? { borderColor: `color-mix(in srgb, ${WARNING} 45%, transparent)`, background: `color-mix(in srgb, ${WARNING} 8%, transparent)` } : undefined}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5 text-[12px] font-medium">
        <span className={waiting ? '' : 'text-foreground'} style={waiting ? { color: WARNING } : undefined}>{t(FLOW_COLUMN_LABEL[column])}</span>
        <span className="tabular-nums text-muted-foreground">{elements.length}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {elements.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-muted-foreground">{t('No Elements')}</p>
        ) : elements.map((element) => (
          <ElementCard
            key={element.id}
            element={element}
            onRefresh={onRefresh}
            onOpen={onElementClick}
            lead={isElementAction(element.action) ? <ActionIcon action={element.action} size={14} /> : undefined}
          />
        ))}
      </div>
    </section>
  );
}
