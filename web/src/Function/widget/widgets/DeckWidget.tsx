'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { supabase } from '@/lib/supabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { SlideScaler, SlideView } from '@/ActivitySpace/sustainment/slides/kata/components/slides/SlideView';
import { deckLang, effectiveRoles } from '@/ActivitySpace/sustainment/slides/kata/model/deck';
import { mixTokens } from '@/ActivitySpace/sustainment/slides/kata/theme/mix';
import { useKata, useLookMap } from '@/ActivitySpace/sustainment/slides/kata/store/useKata';
import { AppShell } from '@/ActivitySpace/sustainment/slides/kata/components/shell/AppShell';
import { fileFromRow, useSlidesSync, type DeckRow } from '@/ActivitySpace/sustainment/slides/sync';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

const DECK_COLUMNS = 'id, activity_space_id, folder_id, name, deck, mix, chat, updated_at';

/** Pick a deck of this Space. */
function DeckChoice({ spaceId, value, onChange, disabled }: { spaceId: string | null; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const decks = useQuery({
    queryKey: ['slides-decks', spaceId],
    enabled: !!spaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('decks').select('id, name').eq('activity_space_id', spaceId!).order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const options = decks.data ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" align="start" disabled={disabled} aria-label="Deck" className="max-w-full">
          <span className="truncate">Deck: {options.find((d) => d.id === value)?.name ?? 'Choose…'}</span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        {!options.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No decks yet. Create one in Slides.</p>}
        {options.map((deck) => (
          <DropdownMenuItem key={deck.id} className={MENU_ROW} onSelect={() => onChange(deck.id)}>
            <span className="flex-1 truncate">{deck.name}</span>{deck.id === value && <span>✓</span>}
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );
}

/** The full editor over the app, opened on one deck. */
function FullScreenEditor({ spaceId, deckId, onClose }: { spaceId: string; deckId: string; onClose: () => void }) {
  const { ready, error } = useSlidesSync(spaceId);
  useEffect(() => {
    if (ready) useKata.getState().selectFile(deckId);
  }, [ready, deckId]);
  useEscapeLayer(true, onClose);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Deck editor" className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 px-3">
        {error && <p role="alert" className="mr-auto text-xs text-destructive">{error}</p>}
        <Button variant="ghost" size="sm" onClick={onClose}><X size={13} />Close</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {ready ? <AppShell /> : <p className="p-6 text-sm text-muted-foreground">Loading deck…</p>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A Slides deck on a board (docs/adr/0042): its pages one at a time, and the
 * same editor as the Slides app when opened full screen. The deck stays the
 * Space's; the widget only remembers which one it shows.
 */
export function DeckWidget({ params, setParams, host }: WidgetProps) {
  const spaceId = useActiveSpaceId();
  const deckId = typeof params.deckId === 'string' ? params.deckId : null;
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const looks = useLookMap();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [deckId]);

  const row = useQuery({
    queryKey: ['slides-deck', deckId],
    enabled: !!deckId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('decks').select(DECK_COLUMNS).eq('id', deckId!).limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as DeckRow | null;
    },
  });
  // Edits from the full-screen editor or anyone else land here when it closes or on focus.
  useEffect(() => { if (!full) void row.refetch(); }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => {
    if (!row.data) return null;
    const file = fileFromRow(row.data);
    return { file, roles: effectiveRoles(file.deck), tokens: mixTokens(file.mix, looks), lang: deckLang(file.deck) };
  }, [row.data, looks]);
  useWidgetMeta(view?.file.name ?? 'Deck');
  const pages = view?.file.deck.slides.length ?? 0;
  const page = Math.max(0, Math.min(index, pages - 1));

  return (
    <div className="space-y-2">
      <WidgetHeaderAction>
        {view && spaceId && <Button variant="ghost" size="sm" disabled={host.readOnly} onClick={() => setFull(true)}><Maximize2 size={13} />Open full screen</Button>}
      </WidgetHeaderAction>
      <DeckChoice spaceId={spaceId} value={deckId} disabled={host.readOnly} onChange={(id) => { setIndex(0); setParams({ deckId: id }); }} />
      {deckId && row.isPending && <p className="text-xs text-muted-foreground">Loading deck…</p>}
      {deckId && !row.isPending && !view && <p className="text-xs text-muted-foreground">This deck is not available. It may have been deleted, or it belongs to another Space.</p>}
      {view && pages > 0 && (
        <>
          <div ref={box} className="overflow-hidden rounded-md">
            <SlideScaler width={width}>
              <SlideView slide={view.file.deck.slides[page]} index={page} role={view.roles[page]} tokens={view.tokens} lang={view.lang} />
            </SlideScaler>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setIndex(page - 1)} aria-label="Previous page"><ChevronLeft size={13} /></Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setIndex(page + 1)} aria-label="Next page"><ChevronRight size={13} /></Button>
          </div>
        </>
      )}
      {full && spaceId && deckId && <FullScreenEditor spaceId={spaceId} deckId={deckId} onClose={() => setFull(false)} />}
    </div>
  );
}
