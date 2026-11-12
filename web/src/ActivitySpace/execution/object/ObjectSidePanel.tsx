'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Plus, X } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { addObjectDependency, removeObjectDependency } from '@/hooks/objectDependencyData';
import { linkConflicts, linkWouldLoop } from '@/Function/shared/objectDependencyModel';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { ObjectPropertiesWidget } from '@/Function/widget/widgets/ObjectPropertiesWidget';
import { ProgressPanel } from '@/Function/shared/ProgressPanel';
import type { WidgetHost } from '@/Function/widget/types';
import type { AlconObjectWithChildren, ObjectDependency } from '@/types/database';

// An Object, read beside the timeline it was picked from: its name, what it
// is for, its properties (edited in place — the same island its own page
// carries) and its Elements. The name opens the Object itself.

export function ObjectSidePanel({ object, objects, links, onOpen, onOpenElement, onClose, onRefresh }: {
  object: AlconObjectWithChildren;
  /** The Objects a dependency can name (the Domain's). */
  objects: AlconObjectWithChildren[];
  /** Every dependency among them. */
  links: ObjectDependency[];
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

        {elements.length > 0 && (
          <section className="rounded-lg border border-border/60 p-3">
            <h3 className="mb-2.5 text-[12px] font-medium text-muted-foreground">{t('Progress')}</h3>
            <ProgressPanel elements={elements} end={object.due_date} />
          </section>
        )}

        <DependencyList title={t('Waits for')} object={object} objects={objects} links={links} side="blocker" />
        <DependencyList title={t('Blocks')} object={object} objects={objects} links={links} side="blocked" />

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

/** One side of an Object's dependencies: the Objects it waits for
 *  (`side="blocker"`) or the ones waiting for it (`side="blocked"`), each
 *  removable, with a "+" that offers the Objects a link would not loop on. */
function DependencyList({ title, object, objects, links, side }: {
  title: string;
  object: AlconObjectWithChildren;
  objects: AlconObjectWithChildren[];
  links: ObjectDependency[];
  side: 'blocker' | 'blocked';
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const mine = links.filter((l) => (side === 'blocker' ? l.blocked_object_id : l.blocker_object_id) === object.id);
  const otherOf = (l: ObjectDependency) => (side === 'blocker' ? l.blocker_object_id : l.blocked_object_id);
  const pairs = links.map((l) => ({ blocker: l.blocker_object_id, blocked: l.blocked_object_id }));
  const taken = new Set(mine.map(otherOf));
  const candidates = objects.filter((o) => o.id !== object.id && !taken.has(o.id)
    && !(side === 'blocker' ? linkWouldLoop(pairs, o.id, object.id) : linkWouldLoop(pairs, object.id, o.id)));
  const run = async (work: () => Promise<void>) => {
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <section>
      <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <span className="flex-1">{title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`${title}: ${t('Add Object')}`} disabled={candidates.length === 0}><Plus size={13} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[280px] min-w-[220px] overflow-y-auto">
            {candidates.map((o) => (
              <DropdownMenuItem key={o.id} className="gap-2 text-[13px]"
                onSelect={() => void run(() => (side === 'blocker' ? addObjectDependency(o.id, object.id) : addObjectDependency(object.id, o.id)))}>
                <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={13} fallback={<ObjectIcon size={13} />} />
                <span className="min-w-0 truncate">{o.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mine.length === 0
        ? <p className="text-[12px] text-muted-foreground/70">{t('None')}</p>
        : (
          <ul className="flex flex-col gap-1">
            {mine.map((l) => {
              const other = byId.get(otherOf(l));
              const blocker = byId.get(l.blocker_object_id);
              const blocked = byId.get(l.blocked_object_id);
              const conflict = linkConflicts(blocker?.due_date, blocked?.start_date);
              return (
                <li key={l.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-[13px]">
                  <ItemIcon icon={other?.icon ?? null} color={other?.color ?? null} size={13} fallback={<ObjectIcon size={13} />} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{other?.name ?? t('An Object')}</span>
                  {conflict && <span className="shrink-0 text-[11px] text-[var(--status-danger)]">{t('Dates overlap')}</span>}
                  <button type="button" aria-label={t('Remove')} className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => void run(() => removeObjectDependency(l.id))}>
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      {error && <p role="alert" className="mt-1 text-[12px] text-[var(--status-danger)]">{error}</p>}
    </section>
  );
}
