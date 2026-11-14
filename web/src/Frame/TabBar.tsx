'use client';

import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { constrainTabDrag } from './tabDrag';
import { Plus, List, Calendar, Users, BarChart3, GanttChart, ClipboardList, Trash2, FileText, Columns3 } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { CollapsingTabs } from '@/Function/shared/CollapsingTabs';
import type { ObjectTab, ObjectTabType } from '@/types/database';

interface TabBarProps {
  tabs: ObjectTab[];
  activeTabId: string | null;
  onTabReorder?: (ids: string[]) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCreate: (type: ObjectTabType, title: string) => void;
  /** Optional content rendered at the right edge of the tab strip — used
   *  to inline view-scoped controls (e.g. Filter / Display buttons). */
  rightSlot?: React.ReactNode;
  /** Restrict which tab types appear in the "+" create menu. Defaults to
   *  the full TAB_OPTIONS catalogue. Callers like ElementsListView
   *  pass a subset to hide entries (e.g. Overview / Resource) their
   *  addTab handler would silently ignore. */
  createOptions?: ObjectTabType[];
  /** The "+" menu's name for a type, when the host names it its own way
   *  (the list is Objects on a Domain, Elements on an Object). */
  createTitle?: (type: ObjectTabType) => string;
}

// Single source of truth for ObjectTabType display metadata — the tab icon
// (rendered in the strip), the title used when a tab is created, and whether
// the type appears in the "+" create menu. Replaces the old TAB_ICONS +
// TAB_OPTIONS + defaultTitles triplication that had to be kept in sync.
// A stored tab can still carry a retired type (a 'board' row the migration
// has not rewritten), so the strip's icon lookup falls back to the List
// icon rather than reading meta for a type that no longer exists.
type TabMeta = { title: string; Icon: React.ComponentType<{ size?: number }> };
const OBJECT_TAB_META: Record<ObjectTabType, TabMeta> = {
  summary:     { title: 'Dashboard',  Icon: BarChart3 },
  elements:    { title: 'List',       Icon: List },
  overview:    { title: 'Overview',   Icon: ClipboardList },
  gantt:       { title: 'Timeline',   Icon: GanttChart },
  calendar:    { title: 'Calendar',   Icon: Calendar },
  workers:     { title: 'Member',     Icon: Users },
  resource:    { title: 'Team',       Icon: Users },
  note:        { title: 'Note',       Icon: FileText },
  flow:        { title: 'Board',      Icon: Columns3 },
};

// Order of the "+" create-tab menu. 'summary' is structural (auto-created,
// not user-addable); 'elements' is the list (Objects on a Domain, Elements
// on an Object); 'resource' is Team ('workers') now;
// 'note' is omitted because its UX flow
// (open NotePicker → persist note_id → render embed) isn't wired here yet —
// the type stays in the union for the Element detail's Note link.
const CREATE_TAB_ORDER: ObjectTabType[] = [
  'overview', 'elements', 'flow', 'gantt', 'calendar', 'workers',
];

export function TabBar({ tabs, activeTabId, onTabSelect, onTabClose, onTabCreate, rightSlot, createOptions, createTitle, onTabReorder }: TabBarProps) {
  const { t } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // A tab already in the strip is not offered again.
  const visibleCreateOptions = (createOptions
    ? CREATE_TAB_ORDER.filter((t) => createOptions.includes(t))
    : CREATE_TAB_ORDER).filter((type) => !tabs.some((tab) => tab.tab_type === type));
  const handleCreate = (type: ObjectTabType) => {
    onTabCreate(type, OBJECT_TAB_META[type].title);
  };

  return (
    <div className="flex items-center gap-1.5 py-2 pl-[19px] pr-4 bg-transparent">
      {/* Tabs — a quiet strip, folded into one menu when they do not fit */}
      <CollapsingTabs
        menuLabel={t('Views')}
        items={tabs.map((tab) => ({ id: tab.id, label: t(tab.title), icon: (OBJECT_TAB_META[tab.tab_type] ?? OBJECT_TAB_META.elements).Icon }))}
        activeId={activeTabId ?? tabs[0]?.id ?? ''}
        onSelect={onTabSelect}
        strip={(
        <DndContext sensors={sensors} modifiers={[constrainTabDrag]} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
          if (!onTabReorder || !over || active.id === over.id) return;
          const from = tabs.findIndex(t => t.id === active.id);
          const to = tabs.findIndex(t => t.id === over.id);
          if (from >= 0 && to >= 0) onTabReorder(arrayMove(tabs.map(t => t.id), from, to));
        }}>
          <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
            <div className="min-w-0 overflow-x-auto">
              <div className="flex w-max items-center gap-1.5">
              {tabs.map(tab => <SortableViewTab key={tab.id} tab={tab} active={tab.id === activeTabId}
                sortable={!!onTabReorder} onSelect={() => onTabSelect(tab.id)} onClose={() => onTabClose(tab.id)} />)}
              </div>
            </div>
          </SortableContext>
        </DndContext>
        )}
        trailing={visibleCreateOptions.length === 0 ? undefined : (
        <div className="relative flex items-center flex-shrink-0">
          {/* The shared menu: arrow keys move through it, Escape closes it
              and focus returns to the "+". */}
          <DropdownMenu>
            <ButtonAppearanceProvider appearance="navigation">
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t('Add tab')} title={t('Add tab')}>
                  <Plus size={14} />
                </Button>
              </DropdownMenuTrigger>
            </ButtonAppearanceProvider>
            <DropdownMenuContent align="start" className="min-w-[150px]">
              {visibleCreateOptions.map((type) => {
                const meta = OBJECT_TAB_META[type];
                const OptionIcon = meta.Icon;
                return (
                  <DropdownMenuItem key={type} onSelect={() => handleCreate(type)} className="gap-2 whitespace-nowrap">
                    <span className="text-muted-foreground"><OptionIcon size={16} /></span>
                    {t(createTitle?.(type) ?? meta.title)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        )}
      />

      {rightSlot}

    </div>
  );
}

function SortableViewTab({ tab, active, sortable, onSelect, onClose }: {
  tab: ObjectTab; active: boolean; sortable: boolean; onSelect: () => void; onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id, disabled: !sortable });
  const { t } = useI18n();
  // Right-click, or the keyboard's menu key (Shift+F10), opens the tab's menu.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button ref={setNodeRef} type="button" shape="tab" variant={active ? 'secondary' : 'ghost'}
          {...attributes} {...listeners} aria-pressed={active} onClick={onSelect}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          className={sortable ? `touch-none ${isDragging ? 'relative z-10 opacity-70' : ''}` : undefined}>
          {t(tab.title)}
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px]">
        {tab.tab_type !== 'elements' ? (
          <ContextMenuItem variant="destructive" onSelect={onClose} className="gap-2">
            <Trash2 size={14} />{t('Delete tab')}
          </ContextMenuItem>
        ) : (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('The List tab cannot be deleted')}</div>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
