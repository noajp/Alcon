'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EyeOff, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { PageLayout } from '@/Function/shared/PageHead';
import { CollapsingTabs } from '@/Function/shared/CollapsingTabs';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { constrainTabDrag } from '@/shell/tabDrag';
import { arrangeViews, nextViewTabState, parseViewTabState, type ViewTabState } from './viewTabs';
import { IslandHeader, type IslandCrumb } from '@/Function/shared/MainIsland';

// =============================================================
// ToolPage — the page of a Sustainment tool (CRM).
//
// A tool is read the way an Object is: ONE SUBJECT seen through SEVERAL
// VIEWS.
//
//   subject  what the tool is about — a CRM pipeline or scope.
//            It has a title and a description, and Properties: the facts
//            and settings that decide what every view shows (the pipeline's
//            currency and what it calls a deal, the supply scope and
//            location, whether the autopilot runs).
//   views    the tabs — different readings of that subject (Today,
//            Pipeline, Deals… / Control tower, Exceptions, Orders…). The
//            viewer chooses which are tabs and in what order.
//   records  what is inside (a deal, an item) — opened in a panel or a
//            dialog over the view, never as a tab.
//
// The home view is the subject's Overview: the icon, title and description
// on the left, the Properties as islands on the right — the same page an
// Object, a Domain or an Element opens on. The other views are the reading
// itself, full width, under a one-line description of what it shows.
// =============================================================

export interface ToolView {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** One line under the tab strip saying what this view shows. */
  description?: string;
  /** The view needs every pixel of width (a board). */
  wide?: boolean;
  /** A count after the label, saying whether the view is worth opening. */
  badge?: ReactNode;
}

/** A view under the tab strip: the page column, closer to the tabs than an Overview's head. */
const VIEW_BODY = 'mx-auto w-full max-w-7xl px-8 pb-8 pt-6';

function useViewTabs(storageKey: string, views: readonly ToolView[], home: string) {
  const key = `tool-views:${storageKey}`;
  const [state, setState] = useState<ViewTabState | null>(() => {
    try { return parseViewTabState(window.localStorage.getItem(key)); } catch { return null; }
  });
  const arranged = useMemo(() => arrangeViews(views, state, home), [views, state, home]);
  const change = (c: Parameters<typeof nextViewTabState>[1]) => {
    const next = nextViewTabState(arranged, c);
    setState(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* the choice lasts this session */ }
  };
  return { ...arranged, change };
}

export function ToolPage({
  crumbs, actions, views, storageKey, home, activeView, onSelectView, viewControls,
  head, properties, panel, record, scrollKey, children,
}: {
  /** Where the page is, as a path: the tool or scope, then the subject (a pipeline, a workflow). */
  crumbs: IslandCrumb[];
  /** Header verbs at the right (Capture, New deal, Refresh). */
  actions?: ReactNode;
  views: readonly ToolView[];
  /** Where the viewer's tab choice is kept ("crm-deals"). */
  storageKey: string;
  /** The Overview view: first, cannot be hidden, and the only one with the head and Properties. */
  home: string;
  activeView: string;
  onSelectView: (id: string) => void;
  /** Controls for the active view, at the right of the tab strip. */
  viewControls?: ReactNode;
  /** The subject's icon, title and description (a PageHead) — on the
   *  Overview. Without one, the first tab is a view like the others (a
   *  pipeline opens on its board). */
  head?: ReactNode;
  /** The subject's Properties islands — on the Overview. */
  properties?: ReactNode;
  /** A record opened beside the view (a deal, a company). */
  panel?: ReactNode;
  /** A record opened in place of the view (a deal), full width, with its own way back. */
  record?: ReactNode;
  /** Changes when a different record opens, so the page starts at the top. */
  scrollKey?: string | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const tabs = useViewTabs(storageKey, views, home);
  // A view reached from elsewhere (a sidebar filter opens Deals) is shown as
  // a tab while it is open, even when the viewer has taken it off the strip.
  const strip = tabs.shown.some((v) => v.id === activeView) ? tabs.shown : [...tabs.shown, ...tabs.hidden.filter((v) => v.id === activeView)];
  const active = views.find((v) => v.id === activeView) ?? views.find((v) => v.id === home)!;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const movable = tabs.shown.filter((v) => v.id !== home).map((v) => v.id);
  // A new view or record starts at the top.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [active.id, scrollKey]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <IslandHeader crumbs={crumbs} actions={actions} />

      <div className="flex flex-shrink-0 items-center gap-1.5 px-4 py-2">
        <CollapsingTabs
          menuLabel={t('Views')}
          items={strip.map((view) => ({ id: view.id, label: t(view.label), icon: view.icon, badge: view.badge !== undefined && view.badge !== null && view.badge !== false
            ? <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{view.badge}</span> : undefined }))}
          activeId={active.id}
          onSelect={onSelectView}
          strip={(
          <DndContext sensors={sensors} modifiers={[constrainTabDrag]} collisionDetection={closestCenter} onDragEnd={({ active: dragged, over }) => {
            if (!over || dragged.id === over.id) return;
            const from = movable.indexOf(String(dragged.id));
            const to = movable.indexOf(String(over.id));
            if (from >= 0 && to >= 0) tabs.change({ reorder: [home, ...arrayMove(movable, from, to)] });
          }}>
            <SortableContext items={movable} strategy={horizontalListSortingStrategy}>
              <div className="min-w-0 overflow-x-auto">
                <div className="flex w-max items-center gap-1.5">
                  {strip.map((view) => (
                    <ViewTab key={view.id} view={view} active={view.id === active.id} pinned={view.id === home}
                      onSelect={() => onSelectView(view.id)} onHide={() => { tabs.change({ hide: view.id }); if (view.id === active.id) onSelectView(home); }} />
                  ))}
                </div>
              </div>
            </SortableContext>
          </DndContext>
          )}
          trailing={tabs.hidden.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-sm" aria-label={t('Show a view')} title={t('Show a view')}><Plus size={14} /></Button>
              </DropdownMenuTrigger>
              <MenuShell as="dropdown" align="start">
                {tabs.hidden.map((view) => (
                  <DropdownMenuItem key={view.id} onSelect={() => { tabs.change({ show: view.id }); onSelectView(view.id); }} className="gap-2">
                    <view.icon size={14} />{t(view.label)}
                  </DropdownMenuItem>
                ))}
              </MenuShell>
            </DropdownMenu>
          ) : undefined}
        />
        {viewControls}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
          {record ? (
            <div className={VIEW_BODY}>{record}</div>
          ) : active.id === home && head ? (
            <PageLayout rail={properties}>
              {head}
              {children}
            </PageLayout>
          ) : (
            <div className={active.wide ? 'px-8 pb-8 pt-6' : VIEW_BODY}>
              {active.description && <p className="mb-6 text-[13px] text-muted-foreground">{t(active.description)}</p>}
              {children}
            </div>
          )}
        </div>
        {panel}
      </div>
    </div>
  );
}

// A view tab: the same outlined tab as an Object's, draggable except the
// Overview, and taken off the strip from its context menu.
function ViewTab({ view, active, pinned, onSelect, onHide }: {
  view: ToolView; active: boolean; pinned: boolean; onSelect: () => void; onHide: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id, disabled: pinned });
  const tab = (
    <Button ref={setNodeRef} type="button" shape="tab" variant={active ? 'secondary' : 'ghost'}
      {...attributes} {...listeners} aria-pressed={active} onClick={onSelect}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={pinned ? undefined : `touch-none ${isDragging ? 'relative z-10 opacity-70' : ''}`}>
      <span className={active ? 'text-foreground' : 'text-muted-foreground'}><view.icon size={14} /></span>
      <span>{t(view.label)}</span>
      {view.badge !== undefined && view.badge !== null && view.badge !== false && (
        <span className="text-[11px] font-normal tabular-nums text-muted-foreground">{view.badge}</span>
      )}
    </Button>
  );
  if (pinned) return tab;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onHide}><EyeOff size={14} />{t('Hide this view')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
