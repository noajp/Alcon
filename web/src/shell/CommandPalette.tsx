'use client';

import { useEffect, useState, useRef } from 'react';
import { Box, FileText, Layers, MessageSquareText, Inbox, Home, ListTodo, Settings } from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/ui/command';
import { globalSearch, type SearchResult } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';

interface CommandPaletteProps {
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}

const NAV_COMMANDS = [
  { id: 'home',     label: 'Go to Home',     icon: Home,            view: 'home' },
  { id: 'inbox',    label: 'Open Inbox',     icon: Inbox,           view: 'inbox' },
  { id: 'mytasks',  label: 'My Elements',    icon: ListTodo,        view: 'mytasks' },
  { id: 'projects', label: 'Objects',        icon: Box,             view: 'projects' },
  { id: 'note',     label: 'Notes',          icon: FileText,        view: 'note' },
  { id: 'brief',    label: 'Briefs',         icon: MessageSquareText, view: 'brief' },
  { id: 'settings', label: 'Settings',       icon: Settings,        view: 'settings' },
];

function kindIcon(kind: SearchResult['kind']) {
  switch (kind) {
    case 'element': return Layers;
    case 'object':  return Box;
    case 'note':    return FileText;
    case 'brief':   return MessageSquareText;
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

  const grouped = {
    element: results.filter(r => r.kind === 'element'),
    object:  results.filter(r => r.kind === 'object'),
    note:    results.filter(r => r.kind === 'note'),
    brief:   results.filter(r => r.kind === 'brief'),
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search elements, objects, notes & briefs. Press ⌘K to open."
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

        {grouped.element.length > 0 && (
          <CommandGroup heading="Elements">
            {grouped.element.map(r => {
              const Icon = kindIcon(r.kind);
              return (
                <CommandItem
                  key={`element-${r.id}`}
                  value={`element-${r.title}`}
                  onSelect={() => handleNav('mytasks', { objectId: r.objectId ?? null })}
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

        {grouped.brief.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Briefs">
              {grouped.brief.map(r => {
                const Icon = kindIcon(r.kind);
                return (
                  <CommandItem
                    key={`brief-${r.id}`}
                    value={`brief-${r.title}`}
                    onSelect={() => handleNav('brief')}
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
