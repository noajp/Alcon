'use client';

import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, PanelLeft, Plus, X } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { AppTab } from '@/Frame/appTab';
import { VIEW_REGISTRY, type ViewId } from '@/Frame/viewRegistry';
import { constrainTabDrag } from '@/Frame/tabDrag';
import { ObjectIcon, ElementIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon, NavNoteIcon, NavTableIcon } from '@/Frame/sidebar/NavIcons';
import { useExplorerData } from '@/Function/shared/ExplorerDataContext';
import { useObjectById } from '@/hooks/useObjectArchive';
import { useStrategies } from '@/hooks/strategyData';
import { useNoteHeader } from '@/hooks/useNotesDb';
import { useDataTables } from '@/hooks/tableData';

// The strip across the top of the content column: the shell's history
// controls (‹ ›) and the sidebar's toggle lead, then the open screens
// as tabs. The buttons dim when there is nowhere to go rather than
// appearing and disappearing and shifting what sits beside them.
// Glyphs only in the cluster: where the person came from is never
// written out as text here. A tab's face names its own screen — the
// entity it shows, or the view — and nothing else (no path, no Domain).

const clusterButton = (enabled: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
    enabled
      ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
      : 'pointer-events-none text-muted-foreground/40'
  }`;

export function ShellTabStrip({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  sidebarVisible,
  onToggleSidebar,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onReorderTabs,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  /** Whether the sidebar is on screen (pinned, or peeked as a drawer). */
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  tabs: AppTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onReorderTabs: (tabIds: string[]) => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onGoBack}
        disabled={!canGoBack}
        aria-disabled={!canGoBack}
        title={t('Back')}
        aria-label={t('Back')}
        className={clusterButton(canGoBack)}
      >
        <ArrowLeft size={15} />
      </button>
      <button
        type="button"
        onClick={onGoForward}
        disabled={!canGoForward}
        aria-disabled={!canGoForward}
        title={t('Forward')}
        aria-label={t('Forward')}
        className={clusterButton(canGoForward)}
      >
        <ArrowRight size={15} />
      </button>
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-pressed={sidebarVisible}
        title={t(sidebarVisible ? 'Hide sidebar' : 'Show sidebar')}
        aria-label={t(sidebarVisible ? 'Hide sidebar' : 'Show sidebar')}
        className={clusterButton(true)}
      >
        <PanelLeft size={15} />
      </button>

      <div className="mx-1.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

      {/* The tabs: one row, shrinking to a min width and then scrolling —
          no cap, because a cap that silently reuses a tab destroys a
          place the person is keeping. */}
      <div className="min-w-0 flex-1 self-stretch overflow-x-auto">
        <DndContext
          sensors={sensors}
          modifiers={[constrainTabDrag]}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            const from = tabs.findIndex((tab) => tab.id === active.id);
            const to = tabs.findIndex((tab) => tab.id === over.id);
            if (from >= 0 && to >= 0) onReorderTabs(arrayMove(tabs.map((tab) => tab.id), from, to));
          }}
        >
          <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex h-full w-max min-w-full items-center gap-1">
              {tabs.map((tab) => (
                <SortableShellTab
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  onSelect={() => onSelectTab(tab.id)}
                  onClose={() => onCloseTab(tab.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <button
        type="button"
        onClick={onNewTab}
        title={t('New tab')}
        aria-label={t('New tab')}
        className={clusterButton(true)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function SortableShellTab({ tab, active, onSelect, onClose }: {
  tab: AppTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const nodeRef = useRef<HTMLElement | null>(null);

  // Keep the tab being looked at in view when the row overflows.
  useEffect(() => {
    if (active) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div
      ref={(node) => { nodeRef.current = node; setNodeRef(node); }}
      {...attributes}
      {...listeners}
      aria-current={active || undefined}
      onClick={onSelect}
      onAuxClick={(e) => {
        // Middle-click closes, like a browser tab.
        if (e.button === 1) { e.preventDefault(); onClose(); }
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex h-[26px] min-w-[120px] max-w-[200px] flex-1 cursor-pointer touch-none items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors ${
        active
          ? 'bg-[var(--surface-rail)] text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      } ${isDragging ? 'relative z-10 opacity-70' : ''}`}
    >
      <ShellTabFace tab={tab} />
      <button
        type="button"
        aria-label={t('Close tab')}
        title={t('Close tab')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm transition-opacity hover:bg-accent hover:text-foreground ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── A tab's face: derived from its current screen, never stored ────────
// The entity's own name and concept icon when the screen names a thing
// and the name resolves from data the app already holds; the view's
// label and icon otherwise (and while a by-id read is still out).

type FaceIcon = React.ComponentType<{ size?: number }>;

function FaceContents({ icon: Icon, label }: { icon?: FaceIcon; label: string }) {
  return (
    <>
      {Icon && (
        <span className="shrink-0 text-muted-foreground">
          <Icon size={13} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
    </>
  );
}

function ShellTabFace({ tab }: { tab: AppTab }) {
  const n = tab.navigation;
  if (tab.activeView === 'domain-elements' && n.elementId) return <ElementTabFace tab={tab} />;
  if (tab.activeView === 'objects' && n.objectId) return <ObjectTabFace tab={tab} />;
  if (tab.activeView === 'strategy' && n.strategyId) return <StrategyTabFace tab={tab} />;
  if (tab.activeView === 'note' && n.noteId) return <NoteTabFace tab={tab} />;
  if (tab.activeView === 'tables' && n.tableId) return <TableTabFace tab={tab} />;
  return <ViewTabFace tab={tab} />;
}

function ViewTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const meta = VIEW_REGISTRY[tab.activeView as ViewId] as { label: string; icon?: FaceIcon } | undefined;
  return <FaceContents icon={meta?.icon} label={t(meta?.label ?? tab.activeView)} />;
}

function ObjectTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const explorer = useExplorerData();
  const objectId = tab.navigation.objectId!;
  // The active Domain's explorer list first; an Object of another Domain
  // resolves through the same by-id read DomainView falls back to.
  const listed = explorer.objects.find((o) => o.id === objectId) ?? null;
  const byId = useObjectById(listed ? null : objectId);
  return <FaceContents icon={ObjectIcon} label={listed?.name ?? byId.object?.name ?? t(VIEW_REGISTRY.objects.label)} />;
}

function ElementTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const explorer = useExplorerData();
  const elementId = tab.navigation.elementId!;
  const objectId = tab.navigation.objectId ?? null;
  // The active Domain's Elements (its Objects' Elements + the
  // Domain-direct ones) first; an Element of another Domain rides in on
  // its Object's by-id read, which carries the Object's Elements.
  const inDomain = useMemo(
    () => [...explorer.objects.flatMap((o) => o.elements ?? []), ...explorer.rootElements]
      .find((el) => el.id === elementId) ?? null,
    [explorer, elementId],
  );
  const byId = useObjectById(inDomain || !objectId ? null : objectId);
  const element = inDomain ?? byId.object?.elements?.find((el) => el.id === elementId) ?? null;
  return <FaceContents icon={ElementIcon} label={element?.title ?? t(VIEW_REGISTRY['domain-elements'].label)} />;
}

function StrategyTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const { data: strategies } = useStrategies();
  const strategy = strategies.find((s) => s.id === tab.navigation.strategyId) ?? null;
  return <FaceContents icon={NavStrategyIcon} label={strategy?.name ?? t(VIEW_REGISTRY.strategy.label)} />;
}

function NoteTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const { data: header } = useNoteHeader(tab.navigation.noteId ?? null);
  return <FaceContents icon={NavNoteIcon} label={header?.name ?? t(VIEW_REGISTRY.note.label)} />;
}

function TableTabFace({ tab }: { tab: AppTab }) {
  const { t } = useI18n();
  const { data: tables } = useDataTables();
  const table = tables.find((row) => row.id === tab.navigation.tableId) ?? null;
  return <FaceContents icon={NavTableIcon} label={table?.name ?? t(VIEW_REGISTRY.tables.label)} />;
}
