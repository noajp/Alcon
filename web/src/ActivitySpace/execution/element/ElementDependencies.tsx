'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from '@/ui/icons';
import { useNowWork } from '@/hooks/useNowWork';
import { setElementDependency } from '@/hooks/coordinationData';
import { useCurrentUserId } from '@/providers/authContext';
import { Button } from '@/ui/button';
import { Popover, PopoverAnchor } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { MenuShell } from '@/Function/shared/menu';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';

export interface ElementDependenciesProps {
  elementId: string;
  spaceId: string | null;
  onOpenElement?: (elementId: string) => void;
  onChanged?: () => void | Promise<void>;
  /** Bumped by the Element's "…" menu (Add dependency) to open the picker. */
  openSignal?: number;
}

/** Context changes discard a picker/error belonging to another Element/user. */
export function ElementDependencies(props: ElementDependenciesProps) {
  const userId = useCurrentUserId();
  return <DependencyEditor key={`${userId}:${props.spaceId}:${props.elementId}`} {...props} />;
}

function DependencyEditor({ elementId, spaceId, onOpenElement, onChanged, openSignal = 0 }: ElementDependenciesProps) {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useNowWork(spaceId);
  const [open, setOpen] = useState(false);
  // The menu asked for the picker: open it (and say why, if it can't be used).
  const [seenSignal, setSeenSignal] = useState(openSignal);
  const [asked, setAsked] = useState(false);
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    setAsked(true);
    setOpen(true);
  }
  const [relation, setRelation] = useState<'incoming' | 'outgoing'>('incoming');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const elements = useMemo(() => new Map(data.elements.map((element) => [element.id, element])), [data.elements]);
  const edges = data.edges.filter((edge) => edge.from_element === elementId || edge.to_element === elementId);
  const existingTargets = new Set(edges.filter((edge) => relation === 'incoming' ? edge.to_element === elementId : edge.from_element === elementId)
    .map((edge) => relation === 'incoming' ? edge.from_element : edge.to_element));
  const candidates = data.elements.filter((element) => element.id !== elementId && !existingTargets.has(element.id)
    && `${element.title} ${element.display_id ?? ''} ${element.objects?.map((object) => object.name).join(' ') ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  async function save(upstreamId: string, downstreamId: string, remove = false) {
    if (!spaceId || pending) return;
    setPending(true); setSaveError(null);
    try {
      await setElementDependency({ spaceId, upstreamId, downstreamId, remove });
      await refetch();
      setOpen(false); setSearch('');
      await onChanged?.();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : t('Unable to update this dependency.'));
    } finally { setPending(false); }
  }

  // Nothing to say until it has loaded — a "Loading…" line would flash in and
  // out of a section that is usually empty.
  if (loading) return null;
  if (error) return <div className="w-full flex items-center gap-2"><p role="alert" className={`${FONT.sm} text-muted-foreground`}>{error.message}</p>
    {spaceId && <Button size="xs" variant="ghost" onClick={() => { void refetch().catch(() => {}); }}>{t('Retry')}</Button>}</div>;
  if (!elements.has(elementId)) return !asked ? null : <p className={`${FONT.sm} w-full text-muted-foreground`}>{t('Space dependencies are available for Elements in this Space’s Objects.')}</p>;

  // Empty shows nothing — "Add dependency" lives in the Element's "…" menu,
  // and the picker opens from there, anchored here. Once there are
  // dependencies, the section has a heading and its own "+ Add dependency".
  // Empty, the section is only the picker's anchor: out of the flow, so it
  // does not open a blank line (and its row gap) in the page's wrapping row.
  const picker = (
  <MenuShell align="start">
    <div className="flex gap-1 p-1">
      <Button shape="tab" size="xs" variant={relation === 'incoming' ? 'secondary' : 'ghost'} aria-pressed={relation === 'incoming'} onClick={() => setRelation('incoming')}>{t('Waits for')}</Button>
      <Button shape="tab" size="xs" variant={relation === 'outgoing' ? 'secondary' : 'ghost'} aria-pressed={relation === 'outgoing'} onClick={() => setRelation('outgoing')}>{t('Unblocks')}</Button>
    </div>
    <Command shouldFilter={false}>
      <CommandInput placeholder={t('Find an Element…')} value={search} onValueChange={setSearch} className="focus:bg-muted/40" />
      <CommandList>
        <CommandEmpty>{t('No matching Elements.')}</CommandEmpty>
        {candidates.slice(0, 100).map((element) => <CommandItem key={element.id} value={element.id} disabled={pending}
          onSelect={() => { void save(relation === 'incoming' ? element.id : elementId, relation === 'incoming' ? elementId : element.id); }}>
          <div className="min-w-0"><div className="truncate">{element.title}</div>
            <div className={`${FONT.xs} truncate text-muted-foreground`}>{element.objects?.map((object) => object.name).join(', ')}</div></div>
        </CommandItem>)}
      </CommandList>
    </Command>
    {candidates.length > 100 && <p className={`${FONT.xs} p-2 text-muted-foreground`}>{t('Showing 100 matches. Type to narrow the list.')}</p>}
    {saveError && <p role="alert" className={`${FONT.sm} p-2 text-[var(--status-danger)]`}>{saveError}</p>}
  </MenuShell>
  );

  // In the Properties island: one row per direction, as the other
  // properties are drawn — the name at the left, the Elements at the right
  // (each opens; × removes it), "Add" when there are none. The picker opens
  // anchored to the rows, set to the row's direction.
  return <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div aria-label={t('Dependencies')}>
          {(['incoming', 'outgoing'] as const).map((direction) => {
            const matching = edges.filter((edge) => direction === 'incoming' ? edge.to_element === elementId : edge.from_element === elementId);
            const choose = () => { setRelation(direction); setSearch(''); setOpen(true); };
            return <div key={direction} className="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
              <span className="w-24 shrink-0 text-[12px] leading-5 text-muted-foreground">{direction === 'incoming' ? t('Waits for') : t('Unblocks')}</span>
              <div className="min-w-0 flex-1">
                {matching.map((edge) => {
                  const targetId = direction === 'incoming' ? edge.from_element : edge.to_element;
                  const target = elements.get(targetId);
                  return <div key={edge.id} className="group/dep flex min-w-0 items-center gap-1">
                    <button type="button" disabled={!target || !onOpenElement} onClick={() => target && onOpenElement?.(targetId)}
                      className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 text-foreground hover:underline disabled:cursor-default disabled:no-underline">
                      {target ? target.title : t('Dependency outside this view')}
                    </button>
                    {!pending && <button type="button" aria-label={t('Remove dependency with {name}', { name: target?.title ?? '' })}
                      onClick={() => { void save(edge.from_element, edge.to_element, true); }}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/dep:opacity-100">
                      <X className="size-3" />
                    </button>}
                  </div>;
                })}
                <button type="button" onClick={choose} disabled={pending}
                  className={`flex items-center gap-1 leading-5 text-muted-foreground hover:text-foreground ${matching.length ? 'text-[12px]' : 'text-[13px]'}`}>
                  {matching.length > 0 && <Plus size={11} strokeWidth={2.5} />}{t('Add')}
                </button>
              </div>
            </div>;
          })}
          {!open && saveError && <p role="alert" className={`${FONT.sm} px-2 text-[var(--status-danger)]`}>{saveError}</p>}
        </div>
      </PopoverAnchor>
      {picker}
    </Popover>;
}
