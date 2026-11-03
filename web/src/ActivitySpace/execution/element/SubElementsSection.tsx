'use client';

import { FoldSection, FoldSectionAddRow } from '@/Function/shared/FoldSection';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { createSubElement, noticeElementSaveFailed, updateElement, useParentElement, useSubElements } from '@/hooks/useSupabase';
import type { Element } from '@/types/database';

// An Element's Sub-elements — Elements with it as their parent, each with a
// page of its own (the row opens it). The status mark checks one off; the
// grey line under them takes a title and Enter.
export function SubElementsSection({ element, onOpen, onAdded }: {
  element: Pick<Element, 'id' | 'object_id' | 'owner_id'>;
  /** Open a Sub-element's page. */
  onOpen: (id: string) => void;
  /** After a Sub-element is made (its title, for the activity line). */
  onAdded?: (title: string) => void;
}) {
  const { t } = useI18n();
  const { data: subs = [], refetch } = useSubElements(element.id);
  const done = subs.filter((s) => s.status === 'done').length;
  const toggle = async (sub: Element) => {
    try {
      await updateElement(sub.id, { status: sub.status === 'done' ? 'todo' : 'done' });
      await refetch();
    } catch (e) { noticeElementSaveFailed(e); }
  };
  return (
    <FoldSection title={t('Sub-elements')} count={subs.length ? `${done}/${subs.length}` : undefined}>
      {subs.map((sub) => (
        <div key={sub.id} className="group flex min-h-[2.125rem] items-center gap-2 rounded-md px-2 transition-colors hover:bg-muted/40">
          <button type="button" onClick={() => void toggle(sub)} className="flex shrink-0"
            aria-label={sub.status === 'done' ? t('Mark as not done') : t('Mark as done')}>
            <ElementProgressMark status={sub.status} size={16} />
          </button>
          <button type="button" onClick={() => onOpen(sub.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left">
            {sub.display_id && <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{sub.display_id}</span>}
            <span className={`truncate text-[14px] ${sub.status === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>{sub.title}</span>
          </button>
        </div>
      ))}
      <FoldSectionAddRow icon={<ElementProgressMark status="todo" size={16} />} placeholder={t('Add sub-element')}
        onAdd={async (title) => {
          try {
            await createSubElement(element, title);
            await refetch();
            onAdded?.(title);
          } catch (e) { noticeElementSaveFailed(e); }
        }} />
    </FoldSection>
  );
}

/** "Sub-element of ◯ ELE-012 Parent title" under a Sub-element's title; the
 *  parent opens on a click. */
export function ParentLine({ parentId, onOpen }: { parentId: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { data: parent } = useParentElement(parentId);
  if (!parent) return null;
  return (
    <button type="button" onClick={() => onOpen(parent.id)}
      className="mt-2 flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
      {t('Sub-element of')}
      <ElementProgressMark status={parent.status} size={14} />
      {parent.display_id && <span className="tabular-nums">{parent.display_id}</span>}
      <span className="font-medium text-foreground">{parent.title}</span>
    </button>
  );
}
