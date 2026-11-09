'use client';

import { useWorkspaceActions } from '@/Frame/WorkspaceActionsContext';

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, FileText, Inbox, Home, ListTodo, Plus, Settings } from '@/ui/icons';
import { ObjectIcon, ElementIcon, FilesIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BAR_TOOLS, MODE_META, TOOL_MODES } from '@/Frame/railApps';
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
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { openFoundFile } from '@/Function/shared/attachments/openOwner';
import type { ElementReturn, NavigationState } from '@/types/navigation';
import type { ViewId } from '@/Frame/viewRegistry';
import { CREATE_ELEMENT_EVENT } from '@/Frame/QuickAddElementLauncher';
import { filterCreateCommands, type CreateCommandId } from '@/Frame/paletteCreateCommands';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { usePageCommands } from '@/Function/shared/pageCommands';

interface CommandPaletteProps {
  /** Where an opened Element's Back returns to: what is open now. */
  returnTo: ElementReturn;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
  /** Item picks (a searched Element, Object or Note) open in a shell
   *  tab of their own; without it they navigate the active tab. */
  onOpenItem?: (view: string, nav?: Partial<NavigationState>) => void;
  /** The shell's New tab (the strip's "+"), offered as a command. */
  onNewTab?: () => void;
  /** Settings opens in its own tab rather than overwriting the active
   *  tab's view — see the rationale on page.tsx's handleOpenSettings. */
  onOpenSettings: () => void;
  /** The shell's Back, offered as a command when there is a screen to
   *  go back to. */
  canGoBack?: boolean;
  onGoBack?: () => void;
  /** The shell's Forward, offered as a command when there is a screen
   *  to go forward to. */
  canGoForward?: boolean;
  onGoForward?: () => void;
}

// Action-phrased labels here are intentionally distinct from the sidebar
// labels; only the `view` target is shared, and it's typed against ViewId
// so a typo'd destination is a compile error.
const NAV_COMMANDS = [
  { id: 'home',         label: 'Go to Now',         icon: Home,     view: 'home' },
  { id: 'my-elements',  label: 'My Elements',        icon: ListTodo, view: 'my-elements' },
  { id: 'calendar', label: 'Open Calendar', icon: MODE_META.calendar.icon, view: 'calendar' },
  { id: 'inbox',        label: 'Open Inbox',         icon: Inbox,    view: 'inbox' },
  { id: 'domain-elements',      label: 'Domain Elements',    icon: ListTodo, view: 'domain-elements' },
  { id: 'objects',     label: 'Objects',            icon: ObjectIcon, view: 'objects' },
  ...[...BAR_TOOLS, ...TOOL_MODES].map(mode => ({
    id: mode, label: `Open ${MODE_META[mode].label}`, icon: MODE_META[mode].icon, view: MODE_META[mode].defaultView,
  })),
  { id: 'settings',     label: 'Settings',           icon: Settings, view: 'settings' },
] satisfies { id: string; label: string; icon: React.ComponentType<{ size?: number }>; view: ViewId }[];

function kindIcon(kind: SearchResult['kind']): React.ComponentType<{ size?: number }> {
  switch (kind) {
    case 'element': return ElementIcon;
    case 'object':  return ObjectIcon;
    case 'note':    return FileText;
    case 'file': return FilesIcon;
  }
}

function createCommandIcon(id: CreateCommandId): React.ComponentType<{ size?: number }> {
  switch (id) {
    case 'create-element':  return ElementIcon;
    case 'create-object':   return ObjectIcon;
    case 'create-strategy': return NavStrategyIcon;
  }
}

export function CommandPalette({ returnTo, onNavigate, onViewChange, onOpenItem, onNewTab, onOpenSettings, canGoBack, onGoBack, canGoForward, onGoForward }: CommandPaletteProps) {
  const { t } = useI18n();
  const { openCreate } = useWorkspaceActions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);
  // What the open page offers to do to the thing on screen (the open Element).
  const pageCommands = usePageCommands();

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
    if (view === 'settings') {
      onOpenSettings();
    } else {
      onViewChange(view);
      if (nav) onNavigate(nav);
    }
    close();
  };

  // A picked item (a searched Element, Object or Note) gets a shell
  // tab of its own — the place the person was stays one click away.
  const handleItem = (view: string, nav?: Partial<NavigationState>) => {
    if (onOpenItem) {
      onOpenItem(view, nav);
      close();
    } else {
      handleNav(view, nav);
    }
  };

  // "New Strategy" is the one Create command that can't reach an existing
  // open hook: StrategyShell.tsx owns Strategy creation entirely internally
  // (a local `newOpen` state + an unexported dialog, no prop/callback/event
  // to trigger it from outside), and that file is out of scope for this
  // change. Landing on the Strategy list is the closest reachable
  // approximation — "+ Add Strategy" is one click away there — rather than
  // reaching into StrategyShell to add an opener.
  const handleCreateCommand = (id: CreateCommandId) => {
    if (id === 'create-strategy') {
      handleNav('strategy', { strategyId: null, strategyCreate: true });
      return;
    }
    close();
    if (id === 'create-element') window.dispatchEvent(new CustomEvent(CREATE_ELEMENT_EVENT));
    else openCreate('object');
  };

  const grouped = {
    element: results.filter(r => r.kind === 'element'),
    object:  results.filter(r => r.kind === 'object'),
    note:    results.filter(r => r.kind === 'note'),
    file:    results.filter(r => r.kind === 'file'),
  };
  const visibleCreateCommands = filterCreateCommands(query);
  const navCommands = NAV_COMMANDS;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('Search')}
      description={t('Search elements, objects, notes and artifacts. Press ⌘K to open.')}
    >
      <CommandInput
        placeholder={t('Search elements, objects, notes, artifacts…')}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {t(searching ? 'Searching…' : query ? 'No results.' : 'Type to search.')}
        </CommandEmpty>

        {pageCommands.length > 0 && (
          <>
            <CommandGroup heading={t('On this page')}>
              {pageCommands.map(({ icon: Icon, ...c }) => (
                <CommandItem
                  key={c.id}
                  value={`${c.id} ${c.label} ${t(c.label)} ${(c.keywords ?? []).join(' ')}`}
                  onSelect={() => { close(); c.run(); }}
                >
                  <Icon />
                  <span className="flex-1">{t(c.label)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {visibleCreateCommands.length > 0 && (
          <>
            <CommandGroup heading={t('Create')}>
              {visibleCreateCommands.map(c => {
                const Icon = createCommandIcon(c.id);
                return (
                  <CommandItem
                    key={c.id}
                    value={`${c.id} ${c.label} ${t(c.label)} ${query}`}
                    onSelect={() => handleCreateCommand(c.id)}
                  >
                    <Icon />
                    <span className="flex-1">{t(c.label)}</span>
                    {c.id === 'create-element' && <CommandShortcut>C</CommandShortcut>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {grouped.element.length > 0 && (
          <CommandGroup heading={t('Elements')}>
            {grouped.element.map(r => {
              const Icon = kindIcon(r.kind);
              return (
                <CommandItem
                  key={`element-${r.id}`}
                  // The id joins the value cmdk filters on, so typing
                  // `ELE_MED-001` keeps its own row rather than every row whose
                  // title happens to share a word with it.
                  value={`element-${r.displayId ?? ''} ${r.title}`}
                  // Opens the Element itself over its Domain's Elements,
                  // switching to that Domain first; Back returns here.
                  onSelect={() => handleItem('domain-elements', {
                    elementId: r.id,
                    elementReturn: returnTo,
                    objectId: r.objectId ?? null,
                    ...(r.objectId && r.domainId ? { objectDomainId: r.domainId } : {}),
                  })}
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
            <CommandGroup heading={t('Objects')}>
              {grouped.object.map(r => {
                const Icon = kindIcon(r.kind);
                return (
                  <CommandItem
                    key={`object-${r.id}`}
                    value={`object-${r.title}`}
                    onSelect={() => handleItem('objects', r.domainId ? { objectId: r.id, objectDomainId: r.domainId } : { objectId: r.id })}
                  >
                    <Icon />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{r.title}</span>
                        {r.archived && <span className="shrink-0 text-[11px] text-muted-foreground">{t('Archived')}</span>}
                      </div>
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
            <CommandGroup heading={t('Notes')}>
              {grouped.note.map(r => {
                const Icon = kindIcon(r.kind);
                return (
                  <CommandItem
                    key={`note-${r.id}`}
                    value={`note-${r.title}`}
                    onSelect={() => handleItem('note', { noteId: r.id, noteSectionId: null })}
                  >
                    <Icon />
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {grouped.file.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('Artifacts')}>
              {grouped.file.map(r => (
                // A file opens the file itself, in the Files view; the line
                // under its name is where its words matched (or what it is
                // attached to), and the citation at the right names the
                // host — by its display_id where the host is an Element.
                <CommandItem key={`file-${r.id}`} value={`file-${r.id} ${r.title} ${r.snippet ?? ''} ${r.file?.owner_label ?? ''} ${r.file?.element_display_id ?? ''}`}
                  onSelect={() => { close(); if (r.file) void openFoundFile(r.file); }}>
                  <FileTypeIcon name={r.title} mime={r.file?.mime_type ?? null} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{r.title}</div>
                    {r.snippet && <div className="text-[11px] text-muted-foreground truncate">{r.snippet}</div>}
                  </div>
                  {(r.file?.element_display_id || r.file?.owner_label) && (
                    <span className="shrink-0 max-w-40 truncate text-[11px] text-muted-foreground">
                      {r.file?.element_display_id ? `${r.file.element_display_id} · ` : ''}{r.file?.owner_label ?? ''}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading={t('Navigation')}>
          {canGoBack && onGoBack && (
            <CommandItem
              value={`nav-go-back ${t('Go back')}`}
              onSelect={() => { close(); onGoBack(); }}
            >
              <ArrowLeft />
              <span>{t('Go back')}</span>
            </CommandItem>
          )}
          {canGoForward && onGoForward && (
            <CommandItem
              value={`nav-go-forward ${t('Go forward')}`}
              onSelect={() => { close(); onGoForward(); }}
            >
              <ArrowRight />
              <span>{t('Go forward')}</span>
            </CommandItem>
          )}
          {onNewTab && (
            <CommandItem
              value={`nav-new-tab ${t('New tab')}`}
              onSelect={() => { close(); onNewTab(); }}
            >
              <Plus />
              <span>{t('New tab')}</span>
            </CommandItem>
          )}
          {navCommands.map(c => (
            <CommandItem
              key={c.id}
              value={`nav-${c.label}-${t(c.label)}`}
              onSelect={() => handleNav(c.view)}
            >
              <c.icon />
              <span>{t(c.label)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
