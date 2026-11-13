'use client';

import { DescriptionEditor } from '@/Function/shared/DescriptionEditor';
import { appDialog } from '@/Function/shared/appDialogStore';
import { formatError } from '@/Function/shared/formatError';
import { setActiveDomainId } from '@/Function/space/domainsStore';

import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ElementWithDetails, ClaywareObjectWithChildren } from '@/hooks/useSupabase';
import { toggleReaction, updateObject, useWorkers } from '@/hooks/useSupabase';
import { useObjectReactions } from '@/hooks/commentData';
import { useAuthContext } from '@/providers/AuthProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { FileText, MoreHorizontal, Plus } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { NavSlidesIcon } from '@/Frame/sidebar/NavIcons';
import { requestNewDeck } from '@/ActivitySpace/artifacts/slides/newDeckRequest';
import { openInApp } from '@/Function/shared/appNavigation';
import { NotePicker } from '@/ActivitySpace/artifacts/notebook/NotePicker';
import { LinkedNoteEmbed } from '@/ActivitySpace/artifacts/notebook/LinkedNoteEmbed';
import { ReactionChips, ReactionPicker } from '@/Function/shared/ReactionControls';
import { AttachButton } from '@/Function/shared/attachments/AttachButton';
import { AttachmentList } from '@/Function/shared/attachments/AttachmentList';
import { PageSection } from '@/Function/shared/PageHead';
import { MilestoneList } from '@/Function/widget/widgets/MilestonesWidget';
import { ObjectCommentsPanel } from '../ObjectCommentsPanel';
import { ObjectIcon } from '@/Frame/icons';
import { PageIcon, PAGE_FRAME, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { ItemIconButton, useItemLook } from '@/Function/shared/itemIcon/IconPicker';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  OBJECT_OVERVIEW_BOARD,
  type WidgetHost,
  type Zone,
} from '@/Function/widget';

/** The rail beside; the document column is fixed, as on an Element's page.
 *  Nothing sits under the name, so there is no band. */
const SURFACE_ZONES: Zone[] = ['main', 'rail'];
const CANVAS_ONLY = ['generated-app'];

// =============================================================
// Object Overview — read like an Element's page.
//
// The document column is fixed: the Object's icon and name, its
// description, one quiet row (reactions, attaching a file) with the
// attached files right under it, its Milestones, then its Updates — the
// thread people and agents leave on it. The rail beside (Properties,
// Strategy intent, …) stays a widget board.
// =============================================================

interface OverviewViewProps {
  elements: ElementWithDetails[];
  object: ClaywareObjectWithChildren;
  onRefresh?: () => void;
  onNavigate?: (nav: { objectId?: string | null; strategyId?: string }) => void;
  /** Switch the active top-level activity — the Strategy rows use this to
   *  jump out to the Strategy surface. */
  onViewChange?: (view: string) => void;
}

/**
 * Auto-grow a textarea to fit its content. Robust against the "measured
 * while the column was 0-width → wrapped into 14 lines → stuck at 400px"
 * bug: re-measures on `value` change AND whenever the element's WIDTH
 * changes (via ResizeObserver). Width-only guard prevents the height we
 * write from feeding back into an observer loop.
 */
function useAutoGrowTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    measure();
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w !== lastWidth) {
        lastWidth = w;
        measure();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, value]);
}

export function OverviewView({
  elements,
  object,
  onRefresh,
  onNavigate,
  onViewChange,
}: OverviewViewProps) {
  const { t } = useI18n();
  const explorerData = useExplorerData();
  // The name as an always-editable seamless textarea, mirroring
  // ElementDetailView's inline header (transparent, no border/ring,
  // auto-grow, save on blur — no Edit button, no view/edit toggle); the
  // description is the shared DescriptionEditor.
  const [title, setTitle] = useState(object.name);
  const [look, changeLook] = useItemLook({ icon: object.icon ?? null, color: object.color },
    async (next) => { await updateObject(object.id, next); onRefresh?.(); });
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(titleRef, title);

  // Re-sync from props when the Object switches or is saved elsewhere.
  useEffect(() => {
    setTitle(object.name);
  }, [object.id, object.name]);

  const handleTitleSave = async () => {
    const next = title.trim();
    if (next && next !== object.name) {
      try {
        await updateObject(object.id, { name: next });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save name:', err);
      }
    }
  };

  const handleDescriptionSave = async (description: string) => {
    if (description !== (object.description || '')) {
      try {
        await updateObject(object.id, { description: description || null });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save description:', err);
      }
    }
  };

  const board = useBoard('object-overview', OBJECT_OVERVIEW_BOARD, object.id);
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const { reactions, refresh: refreshReactions } = useObjectReactions(object.id);
  const reactWith = async (emoji: string) => {
    if (!userId) return;
    try {
      await toggleReaction({ userId, emoji, objectId: object.id });
      await refreshReactions();
    } catch (err) {
      console.error('Failed to react:', err);
    }
  };
  const { data: workers } = useWorkers();
  const [addingMilestone, setAddingMilestone] = useState(false);
  const milestoneIds = useMemo(() => [object.id], [object.id]);
  const milestoneNames = useMemo(() => new Map([[object.id, object.name]]), [object.id, object.name]);

  const host = useMemo<WidgetHost>(
    () => ({
      subject: { kind: 'object', id: object.id },
      elements,
      object,
      explorerData,
      onRefresh,
      onNavigate: nav => {
        if (nav.domainId && !nav.objectId) {
          setActiveDomainId(nav.domainId);
          onNavigate?.({ objectId: null });
          onViewChange?.('domain-overview');
        } else onNavigate?.(nav);
      },
      onViewChange,
    }),
    [object, elements, explorerData, onRefresh, onNavigate, onViewChange],
  );

  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const linkNote = async (noteId: string | null) => {
    try { await updateObject(object.id, { note_id: noteId }); onRefresh?.(); }
    catch (e) { await appDialog.alert(formatError(e)); }
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className={PAGE_FRAME}>
        <WidgetSurface board={board} host={host} zones={SURFACE_ZONES}>
          {/* items-start: don't let the (often taller) rail stretch the main
              column. A stretched block column was the layout that made the
              title/description textareas mis-measure and balloon. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
            {/* ───────────── Main column ───────────── */}
            {/* pl-6: indent the editorial content off the left rail so it
                reads as a document rather than flush against the sidebar. */}
            <div className="space-y-6 min-w-0">
              {/* Icon stacked above the name; the name sits flush with the
                  column's left edge so it lines up with the description. */}
              <div>
                <PageIcon>
                  <ItemIconButton value={look} onChange={changeLook} defaultIcon={<ObjectIcon size={18} />} />
                </PageIcon>
                <textarea
                  ref={titleRef}
                  value={title}
                  rows={1}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      (e.currentTarget as HTMLTextAreaElement).blur();
                    }
                  }}
                  className={`w-full bg-transparent border-none resize-none overflow-hidden ${PAGE_TITLE}`}
                  style={PAGE_TITLE_WEIGHT}
                  placeholder={t('Object name')}
                />
              </div>

              <section>
                <DescriptionEditor key={object.id} value={object.description ?? ''}
                  placeholder={t('Add description…')} onSave={handleDescriptionSave} />
              </section>

              {/* Under the description, as on an Element: one quiet row —
                  reactions and attaching a file — then the attached files. */}
              <div className="relative -ml-2.5 flex flex-wrap items-start gap-x-0.5 gap-y-5 [&>*.w-full]:pl-2.5">
                <ButtonAppearanceProvider appearance="inline">
                  <div className="flex items-center gap-0.5">
                    <ReactionPicker onToggle={(e) => void reactWith(e)} />
                    <AttachButton owner={{ kind: 'object', id: object.id }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" />
                    {/* More to attach, as on an Element: a Note (Document), a new deck (Slide). */}
                    <div className="relative">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" title={t('More')} aria-label={t('More')}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground">
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[200px]">
                          {!object.note_id && (
                            <DropdownMenuItem onSelect={() => setTimeout(() => setNotePickerOpen(true), 0)} className="gap-2.5 py-1.5 text-[13px]">
                              <FileText size={15} className="text-muted-foreground" />{t('Document')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => { requestNewDeck(object.name); openInApp('slides'); }} className="gap-2.5 py-1.5 text-[13px]">
                            <NavSlidesIcon size={15} />{t('Slide')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <NotePicker open={notePickerOpen} onClose={() => setNotePickerOpen(false)}
                        onPick={(noteId) => { setNotePickerOpen(false); void linkNote(noteId); }}
                        anchorClassName="absolute top-full left-0 mt-1" />
                    </div>
                    <ReactionChips reactions={reactions} userId={userId} onToggle={(e) => void reactWith(e)} />
                  </div>
                </ButtonAppearanceProvider>
                <AttachmentList owner={{ kind: 'object', id: object.id }} />
              </div>

              {/* The Note pinned to this Object, shown in place. */}
              {object.note_id && <LinkedNoteEmbed noteId={object.note_id} onUnlink={() => void linkNote(null)} />}

              {/* Canvases: what was asked to be drawn for this Object. */}
              {board.layout.main.some((w) => w.type === 'generated-app') && <WidgetZone zone="main" only={CANVAS_ONLY} />}

              <PageSection title={t('Milestones')} action={
                <Button variant="ghost" size="icon-xs" aria-label={t('Add milestone')} onClick={() => setAddingMilestone(true)}>
                  <Plus size={14} />
                </Button>
              }>
                <MilestoneList ids={milestoneIds} names={milestoneNames} objectId={object.id} editable
                  adding={addingMilestone} onAddingChange={setAddingMilestone} />
              </PageSection>

              <PageSection title={t('Updates')}>
                <ObjectCommentsPanel objectId={object.id} objectName={object.name} workers={workers} />
              </PageSection>
            </div>

            {/* ───────────── Side column ───────────── */}
            <aside className="min-w-0 space-y-3">
              <WidgetZone zone="rail" />
            </aside>
          </div>
        </WidgetSurface>
      </div>
    </div>
  );
}
