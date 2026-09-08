'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useNowWork } from '@/hooks/useNowWork';
import { setElementDependency } from '@/hooks/coordinationData';
import { useCurrentUserId } from '@/providers/authContext';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { MenuShell } from '@/Function/shared/menu';
import { FONT, STATUS } from '@/shared/designTokens';

export interface ElementDependenciesProps {
  elementId: string;
  spaceId: string | null;
  onOpenElement?: (elementId: string) => void;
  onChanged?: () => void | Promise<void>;
}

/** Context changes discard a picker/error belonging to another Element/user. */
export function ElementDependencies(props: ElementDependenciesProps) {
  const userId = useCurrentUserId();
  return <DependencyEditor key={`${userId}:${props.spaceId}:${props.elementId}`} {...props} />;
}

function DependencyEditor({ elementId, spaceId, onOpenElement, onChanged }: ElementDependenciesProps) {
  const { data, loading, error, refetch } = useNowWork(spaceId);
  const [open, setOpen] = useState(false);
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
      setSaveError(caught instanceof Error ? caught.message : 'Unable to update this dependency.');
    } finally { setPending(false); }
  }

  if (loading) return <p className={`${FONT.sm} text-muted-foreground`}>Loading dependencies…</p>;
  if (error) return <div className="flex items-center gap-2"><p role="alert" className={`${FONT.sm} text-muted-foreground`}>{error.message}</p>
    {spaceId && <Button size="xs" variant="ghost" onClick={() => { void refetch().catch(() => {}); }}>Retry</Button>}</div>;
  if (!elements.has(elementId)) return <p className={`${FONT.sm} text-muted-foreground`}>Space dependencies are available for Elements in this Space’s Objects.</p>;

  return <div className="space-y-2">
    {(['incoming', 'outgoing'] as const).map((direction) => {
      const matching = edges.filter((edge) => direction === 'incoming' ? edge.to_element === elementId : edge.from_element === elementId);
      if (!matching.length) return null;
      return <div key={direction}>
        <p className={`${FONT.label} mb-1`}>{direction === 'incoming' ? 'Waits for' : 'Unblocks'}</p>
        {matching.map((edge) => {
          const targetId = direction === 'incoming' ? edge.from_element : edge.to_element;
          const target = elements.get(targetId);
          return <div key={edge.id} className="flex min-w-0 items-center gap-1">
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
            {target ? <Button variant="ghost" size="sm" align="start" className="min-w-0 flex-1" disabled={!onOpenElement} onClick={() => onOpenElement?.(targetId)}>
              <span className="truncate">{target.title}</span>
              <span className={`${FONT.xs} ml-auto shrink-0 text-muted-foreground`}>{target.status ? STATUS[target.status]?.label ?? 'Unspecified' : 'Unspecified'}</span>
            </Button> : <span className={`${FONT.sm} flex-1 py-2 text-muted-foreground`}>Dependency outside this view</span>}
            {target && <Button variant="ghost" size="icon-xs" disabled={pending} aria-label={`Remove dependency with ${target.title}`}
              onClick={() => { void save(edge.from_element, edge.to_element, true); }}><X className="size-3" /></Button>}
          </div>;
        })}
      </div>;
    })}
    {!edges.length && <p className={`${FONT.sm} text-muted-foreground`}>No dependencies recorded.</p>}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost" size="xs" disabled={pending}><Plus className="size-3" />Add dependency</Button></PopoverTrigger>
      <MenuShell align="start">
        <div className="flex gap-1 p-1">
          <Button size="xs" variant={relation === 'incoming' ? 'secondary' : 'ghost'} aria-pressed={relation === 'incoming'} onClick={() => setRelation('incoming')}>Waits for</Button>
          <Button size="xs" variant={relation === 'outgoing' ? 'secondary' : 'ghost'} aria-pressed={relation === 'outgoing'} onClick={() => setRelation('outgoing')}>Unblocks</Button>
        </div>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find an Element…" value={search} onValueChange={setSearch} className="focus:bg-muted/40" />
          <CommandList>
            <CommandEmpty>No matching Elements.</CommandEmpty>
            {candidates.slice(0, 100).map((element) => <CommandItem key={element.id} value={element.id} disabled={pending}
              onSelect={() => { void save(relation === 'incoming' ? element.id : elementId, relation === 'incoming' ? elementId : element.id); }}>
              <div className="min-w-0"><div className="truncate">{element.title}</div>
                <div className={`${FONT.xs} truncate text-muted-foreground`}>{element.objects?.map((object) => object.name).join(', ')}</div></div>
            </CommandItem>)}
          </CommandList>
        </Command>
        {candidates.length > 100 && <p className={`${FONT.xs} p-2 text-muted-foreground`}>Showing 100 matches. Type to narrow the list.</p>}
        {saveError && <p role="alert" className={`${FONT.sm} p-2 text-[var(--status-danger)]`}>{saveError}</p>}
      </MenuShell>
    </Popover>
    {!open && saveError && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{saveError}</p>}
  </div>;
}
