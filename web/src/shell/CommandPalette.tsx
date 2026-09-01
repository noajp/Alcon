'use client';

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import { FileText, MessageSquareText, Inbox, Home, ListTodo, Settings } from 'lucide-react';
import { ObjectIcon, ElementIcon } from '@/alcon/shared/conceptIcons';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/ui/command';
import { globalSearch, type SearchResult } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';
import type { ViewId } from '@/shell/viewRegistry';
import { CREATE_ELEMENT_EVENT } from '@/shell/QuickAddElementLauncher';
import { filterCreateCommands, type CreateCommandId } from '@/shell/paletteCreateCommands';

interface CommandPaletteProps {
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}

// Action-phrased labels here are intentionally distinct from the sidebar
// labels; only the `view` target is shared, and it's typed against ViewId
// so a typo'd destination is a compile error.
const NAV_COMMANDS = [
  { id: 'home',         label: 'Go to Home',         icon: Home,     view: 'home' },
  { id: 'my-elements',  label: 'My Elements',        icon: ListTodo, view: 'my-elements' },
  { id: 'inbox',        label: 'Open Inbox',         icon: Inbox,    view: 'inbox' },
  { id: 'mytasks',      label: 'Domain Elements',    icon: ListTodo, view: 'mytasks' },
  { id: 'projects',     label: 'Objects',            icon: ObjectIcon, view: 'projects' },
  { id: 'note',         label: 'Notes',              icon: FileText, view: 'note' },
  { id: 'settings',     label: 'Settings',           icon: Settings, view: 'settings' },
] satisfies { id: string; label: string; icon: React.ComponentType<{ size?: number }>; view: ViewId }[];

function kindIcon(kind: SearchResult['kind']): React.ComponentType<{ size?: number }> {
  switch (kind) {
    case 'element': return ElementIcon;
    case 'object':  return ObjectIcon;
    case 'note':    return FileText;
    case 'brief':   return MessageSquareText;
  }
}

function createCommandIcon(id: CreateCommandId): React.ComponentType<{ size?: number }> {
  switch (id) {
    case 'create-element':  return ElementIcon;
    case 'create-object':   return ObjectIcon;
    case 'create-campaign': return NavStrategyIcon;
  }
}

export function CommandPalette({ onNavigate, onViewChange }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // ⌘K / Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await globalSearch(query, 6);
        setResults(r);
      } catch (e) {
        console.error('search failed:', e);
        setResults([]);
      } finally { setSearching(false); }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const close = () => { setOpen(false); setQuery(''); setResults([]); };

  const handleNav = (view: string, nav?: Partial<NavigationState>) => {
    onViewChange(view);
    if (nav) onNavigate(nav);
    close();
  };

  // "New Campaign" is the one Create command that can't reach an existing
  // open hook: StrategyShell.tsx owns Campaign creation entirely internally
  // (a local `newOpen` state + an unexported dialog, no prop/callback/event
  // to trigger it from outside), and that file is out of scope for this
  // change. Landing on the Campaign portfolio root is the closest reachable
  // approximation — "+ Add Campaign" is one click away there — rather than
  // reaching into StrategyShell to add an opener.
  const handleCreateCommand = (id: CreateCommandId) => {
    if (id === 'create-campaign') {
      handleNav('strategy', { strategyId: null });
      return;
    }
    close();
    window.dispatchEvent(new CustomEvent(id === 'create-element' ? CREATE_ELEMENT_EVENT : 'alcon:create-object'));
  };

  const grouped = {
    element: results.filter(r => r.kind === 'element'),
    object:  results.filter(r => r.kind === 'object'),
    note:    results.filter(r => r.kind === 'note'),
  };
  const visibleCreateCommands = filterCreateCommands(query);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search elements, objects, notes. Press ⌘K to open."
    >
      <CommandInput
        placeholder="Search elements, objects, notes…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? 'Searching…' : query ? 'No results.' : 'Type to search.'}
        </CommandEmpty>

        {visibleCreateCommands.length > 0 && (
          <>
            <CommandGroup heading="Create">
              {visibleCreateCommands.map(c => {
                const Icon = createCommandIcon(c.id);
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.id} ${c.label} ${query}`}
                    onSelect={() => handleCreateCommand(c.id)}
                  >
                    <Icon />
                    <span className="flex-1">{c.label}</span>
                    {c.id === 'create-element' && <CommandShortcut>C</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {grouped.element.length > 0 && (
          <CommandGroup heading="Elements">
            {grouped.element.map(r => {
              const Icon = kindIcon(r.kind);
              return (
                <CommandItem
                  key={`element-${r.id}`}
                  // The id joins the value cmdk filters on, so typing
                  // `ELE_MED-001` keeps its own row rather than every row whose
                  // title happens to share a word with it.
                  value={`element-${r.displayId ?? ''} ${r.title}`}
                  onSelect={() => handleNav('mytasks', { objectId: r.objectId ?? null })}
                >
                  <Icon />
                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    {r.displayId && (
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/60">
                        {r.displayId}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.title}</div>
                      {r.snippet && (
                        <div className="text-[11px] text-muted-foreground truncate">{r.snippet}</div>
                      )}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {grouped.object.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Objects">
              {grouped.object.map(r => {
                const Icon = kindIcon(r.kind);
                return (
                  <CommandItem
                    key={`object-${r.id}`}
                    value={`object-${r.title}`}
                    onSelect={() => handleNav('projects', { objectId: r.id })}
                  >
                    <Icon />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{r.title}</div>
                      {r.snippet && (
                        <div className="text-[11px] text-muted-foreground truncate">{r.snippet}</div>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {grouped.note.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {grouped.note.map(r => {
                const Icon = kindIcon(r.kind);
                return (
                  <CommandItem
                    key={`note-${r.id}`}
                    value={`note-${r.title}`}
                    onSelect={() => handleNav('note', { noteId: r.id })}
                  >
                    <Icon />
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Navigation">
          {NAV_COMMANDS.map(c => (
            <CommandItem
              key={c.id}
              value={`nav-${c.label}`}
              onSelect={() => handleNav(c.view)}
            >
              <c.icon />
              <span>{c.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
