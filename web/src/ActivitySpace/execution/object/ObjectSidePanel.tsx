'use client';

import { useMemo } from 'react';
import { ChevronRight, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { ObjectPropertiesWidget } from '@/Function/widget/widgets/ObjectPropertiesWidget';
import type { WidgetHost } from '@/Function/widget/types';
import type { AlconObjectWithChildren } from '@/types/database';

// An Object, read beside the timeline it was picked from: its name, what it
// is for, its properties (edited in place — the same island its own page
// carries) and its Elements. The name opens the Object itself.

export function ObjectSidePanel({ object, onOpen, onOpenElement, onClose, onRefresh }: {
  object: AlconObjectWithChildren;
  /** Opens the Object's own page. */
  onOpen: () => void;
  onOpenElement?: (elementId: string) => void;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const elements = useMemo(() => object.elements ?? [], [object.elements]);
  const host: WidgetHost = useMemo(() => ({
    subject: { kind: 'object', id: object.id }, object, elements, onRefresh,
  }), [object, elements, onRefresh]);
  const open = elements.filter((e) => e.status !== 'cancelled');
  const done = open.filter((e) => e.status === 'done').length;

  return (
    <aside aria-label={object.name} className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-card">
      <header className="flex items-start gap-2 px-4 pb-3 pt-4">
        <span className="mt-0.5 shrink-0"><ItemIcon icon={object.icon ?? null} color={object.color ?? null} size={16} fallback={<ObjectIcon size={16} />} /></span>
        <button type="button" onClick={onOpen} title={t('Open')}
          className="group/open flex min-w-0 flex-1 items-center gap-1 text-left text-[15px] font-semibold leading-snug text-foreground">
          <span className="min-w-0 truncate group-hover/open:underline">{object.name}</span>
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        </button>
        <Button variant="ghost" size="icon-xs" aria-label={t('Close')} onClick={onClose}><X size={14} /></Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5">
        {object.description && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{object.description}</p>}

        <section className="rounded-lg border border-border/60 p-3">
          <ObjectPropertiesWidget host={host} />
        </section>

        <section>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
            <span>{t('Elements')}</span>
            <span className="tabular-nums">{open.length === 0 ? '' : t('{done}/{total} done', { done, total: open.length })}</span>
          </div>
          {elements.length === 0
            ? <p className="text-[12px] text-muted-foreground/70">{t('No Elements')}</p>
            : (
              <ul className="flex flex-col">
                {elements.map((e) => (
                  <li key={e.id}>
                    <button type="button" disabled={!onOpenElement} onClick={() => onOpenElement?.(e.id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] text-foreground transition-colors enabled:hover:bg-muted/50">
                      <span className="flex shrink-0"><ElementProgressMark status={e.status} size={14} /></span>
                      <span className={`min-w-0 flex-1 truncate ${e.status === 'done' || e.status === 'cancelled' ? 'text-muted-foreground' : ''}`}>{e.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </aside>
  );
}
