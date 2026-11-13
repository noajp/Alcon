'use client';

import { useMemo, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { completionOf } from '@/Function/shared/completion';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { requestElementDetail } from '@/Function/shared/element/elementDetailRequest';
import { GanttChart } from '@/ui/icons';
import { updateObject, type ClaywareObjectWithChildren, type ElementWithDetails } from '@/hooks/useSupabase';
import type { EmbedHost, EmbedSpec } from '@/Function/notebook/editor/embedBlocks';
import { objectToGanttBar } from '@/ActivitySpace/execution/domain/DomainView';

// The blocks a Strategy's description can hold: how far its work has come,
// its Elements, and its Objects on a Gantt. Each reads the Strategy's own
// Objects and Elements, so a block written once stays current.

const GanttView = dynamic(() => import('@/ActivitySpace/execution/element/gantt').then((m) => m.GanttView), { ssr: false });

function Progress({ elements }: { elements: ElementWithDetails[] }) {
  const { t } = useI18n();
  const c = completionOf(elements);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
      <ElementProgressMark size={16} status={c.total > 0 && c.done === c.total ? 'done' : c.done > 0 ? 'in_progress' : 'todo'} progress={c.pct} />
      <SegmentedProgress value={c.pct} className="flex-1" />
      <span className="shrink-0 text-[13px] tabular-nums text-foreground">{c.done}/{c.total}</span>
      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{t('{pct}% done', { pct: c.pct })}</span>
    </div>
  );
}

function ElementList({ elements, onOpen }: { elements: ElementWithDetails[]; onOpen: (el: ElementWithDetails) => void }) {
  const { t } = useI18n();
  if (!elements.length) return <p className="rounded-md border border-border/60 px-3 py-2.5 text-[13px] text-muted-foreground">{t('No Elements yet.')}</p>;
  return (
    <ul className="divide-y divide-border/50 rounded-md border border-border/60">
      {elements.map((el) => (
        <li key={el.id}>
          <button type="button" onClick={() => onOpen(el)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-foreground/[0.04]">
            <ElementProgressMark size={14} status={el.status} progress={getElementProgress(el)} />
            {el.display_id && <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{el.display_id}</span>}
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{el.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ObjectsGantt({ objects, onChanged }: { objects: ClaywareObjectWithChildren[]; onChanged: () => void }) {
  const { t } = useI18n();
  const bars = useMemo(() => objects.map(objectToGanttBar), [objects]);
  if (!objects.length) return <p className="rounded-md border border-border/60 px-3 py-2.5 text-[13px] text-muted-foreground">{t('No Objects yet.')}</p>;
  return (
    <div className="h-[320px] overflow-hidden rounded-md border border-border/60">
      <GanttView defaultZoom="quarter" rowScale="object" elements={bars} leftHeaderLabel="Objects" onRefresh={onChanged}
        onItemUpdate={(id, u) => updateObject(id, { start_date: u.start_date, due_date: u.due_date })} />
    </div>
  );
}

/** What "/" offers in a Strategy's description, and how each block draws. */
export function useStrategyEmbeds({ elements, objects, onOpenObject, onChanged }: {
  elements: ElementWithDetails[];
  objects: ClaywareObjectWithChildren[];
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onChanged: () => void;
}): EmbedHost {
  const { t } = useI18n();
  return useMemo<EmbedHost>(() => {
    const openElement = (el: ElementWithDetails) => {
      const object = objects.find((o) => o.id === el.object_id);
      requestElementDetail(el.id);
      if (object) onOpenObject?.(object.id, object.domain_id ?? null);
    };
    const render = (spec: EmbedSpec): ReactNode => {
      switch (spec.view) {
        case 'progress': return <Progress elements={elements} />;
        case 'elements': return <ElementList elements={elements} onOpen={openElement} />;
        case 'gantt': return <ObjectsGantt objects={objects} onChanged={onChanged} />;
        default: return <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('This block is not offered here.')}</p>;
      }
    };
    return {
      views: [
        { id: 'progress', label: t('Progress'), hint: t('How far its Elements have come'), icon: <ElementProgressMark size={14} status="in_progress" progress={50} /> },
        { id: 'elements', label: t('Elements'), hint: t('Every Element under its Objects'), icon: <ElementIcon size={14} /> },
        { id: 'gantt', label: t('Timeline'), hint: t('Its Objects on a timeline'), icon: <GanttChart size={14} /> },
      ],
      render,
    };
  }, [elements, objects, onOpenObject, onChanged, t]);
}
