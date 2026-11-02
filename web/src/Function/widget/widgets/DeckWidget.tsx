'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { SlideScaler, SlideView } from '@/ActivitySpace/sustainment/slides/kata/components/slides/SlideView';
import { deckLang, effectiveRoles, setSlidePath, updateSlide } from '@/ActivitySpace/sustainment/slides/kata/model/deck';
import { mixTokens } from '@/ActivitySpace/sustainment/slides/kata/theme/mix';
import { useKataLocale } from '@/ActivitySpace/sustainment/slides/useKataLocale';
import { useKata, useLookMap } from '@/ActivitySpace/sustainment/slides/kata/store/useKata';
import { AppShell } from '@/ActivitySpace/sustainment/slides/kata/components/shell/AppShell';
import { useSlidesSync } from '@/ActivitySpace/sustainment/slides/sync';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** Pick a deck of this Space. */
function DeckChoice({ value, onChange, disabled }: { value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const files = useKata((s) => s.files);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" align="start" disabled={disabled} aria-label={t('Deck')} className="max-w-full">
          <span className="truncate">{t('Deck: {name}', { name: files.find((d) => d.id === value)?.name ?? t('Choose…') })}</span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        {!files.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('No decks yet. Create one in Slides.')}</p>}
        {files.map((deck) => (
          <DropdownMenuItem key={deck.id} className={MENU_ROW} onSelect={() => onChange(deck.id)}>
            <span className="flex-1 truncate">{deck.name}</span>{deck.id === value && <span>✓</span>}
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );
}

/** The full editor over the app, opened on one deck. It closes from its own button: Escape belongs to the editor. */
function FullScreenEditor({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => { useKata.getState().selectFile(deckId); }, [deckId]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('Deck editor')} className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center justify-end px-3">
        <Button variant="ghost" size="sm" onClick={onClose}><X size={13} />{t('Close')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto"><AppShell /></div>
    </div>,
    document.body,
  );
}

/**
 * A Slides deck on a board (ADR 0042): its pages one at a time, with the
 * text editable in place, and the same editor as the Slides app when opened
 * full screen. The deck stays the Space's and is shared through the same sync
 * as the app, so an edit here is the deck's edit everywhere; the widget only
 * remembers which deck it shows.
 */
export function DeckWidget({ params, setParams, host }: WidgetProps) {
  useKataLocale();
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { ready, error } = useSlidesSync(spaceId);
  const deckId = typeof params.deckId === 'string' ? params.deckId : null;
  const file = useKata((s) => s.files.find((f) => f.id === deckId) ?? null);
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
  }, [file?.id]);

  const view = useMemo(() => file && ({ roles: effectiveRoles(file.deck), tokens: mixTokens(file.mix, looks), lang: deckLang(file.deck) }), [file, looks]);
  useWidgetMeta(file?.name ?? t('Deck'));
  const pages = file?.deck.slides.length ?? 0;
  const page = Math.max(0, Math.min(index, pages - 1));
  const slide = file?.deck.slides[page];
  const editable = !host.readOnly;

  return (
    <div className="space-y-2">
      <WidgetHeaderAction>
        {file && <Button variant="ghost" size="sm" disabled={!editable} onClick={() => setFull(true)}><Maximize2 size={13} />{t('Open full screen')}</Button>}
      </WidgetHeaderAction>
      <DeckChoice value={deckId} disabled={!editable || !ready} onChange={(id) => { setIndex(0); setParams({ deckId: id }); }} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {deckId && !ready && <p className="text-xs text-muted-foreground">{t('Loading deck…')}</p>}
      {deckId && ready && !file && <p className="text-xs text-muted-foreground">{t('This deck is not available. It may have been deleted, or it belongs to another Space.')}</p>}
      {file && view && slide && (
        <>
          <div ref={box} className="kata-root overflow-hidden rounded-md">
            <SlideScaler width={width}>
              <SlideView
                slide={slide} index={page} role={view.roles[page]} tokens={view.tokens} lang={view.lang}
                editable={editable} editObjects={false}
                onEdit={(path, value) => useKata.getState().editFile(file.id, (d) => updateSlide(d, slide.id, (s) => setSlidePath(s, path, value)))}
              />
            </SlideScaler>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setIndex(page - 1)} aria-label={t('Previous page')}><ChevronLeft size={13} /></Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= pages - 1} onClick={() => setIndex(page + 1)} aria-label={t('Next page')}><ChevronRight size={13} /></Button>
          </div>
        </>
      )}
      {full && file && <FullScreenEditor deckId={file.id} onClose={() => setFull(false)} />}
    </div>
  );
}
