'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, Worker } from '@/hooks/useSupabase';
import {
  createElement, addElementToObject, removeElementFromObject, updateElement, deleteElement, addElementAssignee,
  fetchAllWorkers,
  useObjectTabs, useDomains, createObjectTab, deleteObjectTab, reorderElements,
  moveObject, deleteObject, updateObject, addDomainElementType, removeDomainElementType,
} from '@/hooks/useSupabase';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ObjectTabType, ElementStatus } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import { ObjectIcon } from '@/shell/icons';
import { TabBar } from '@/shell/TabBar';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { SummaryView } from '@/alcon/object/summary/SummaryView';
import { OverviewView } from '@/alcon/object/overview/OverviewView';
import { GanttView } from '@/alcon/element/gantt';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { ResourceView } from '@/alcon/element/actions/ResourceView';
import { CustomView } from '@/alcon/element/custom';
import { ColumnHeader, BuiltInColumnHeader, DEFAULT_BUILTIN_COLUMNS, useCustomColumns } from '@/alcon/property';
import type { BuiltInColumn } from '@/alcon/property';
import { ElementTableRow, ElementPropertiesPanel, ElementDetailView } from '@/alcon/element';
import { QuickAddElementPopup, type NewElementInput } from '@/alcon/element/QuickAddElementPopup';
import { BulkActionBar } from '@/alcon/element/BulkActionBar';
import { pushUndo } from '@/alcon/element/bulkUndo';
import { ObjectPicker } from '@/alcon/object/ObjectPicker';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem } from '@/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, ChevronDown, ListPlus, FolderPlus, Heading, X, Trash2, Users, Link2, ArrowRight, FileText, Filter, ArrowUpDown, MoreHorizontal, Copy, Pencil, GripVertical, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { collectAllObjects } from '@/alcon/object/ObjectsView';
import { ObjectMembersPanel } from '@/alcon/object/ObjectMembersPanel';
import { ObjectElementsView } from '@/alcon/object/ObjectElementsView';
import type { ListSection } from '@/alcon/object/ListTable';
import { useElementSelection } from '@/alcon/element/useElementSelection';
import { sectionGroupValues, type ListControlsState, type SectionGroup } from '@/alcon/shared/listControls';

type SortableListeners = ReturnType<typeof useSortable>['listeners'];

// Atom icon — Element marker (matches the icon used in ElementTableRow)

export function ObjectDetailView({ object, onNavigate, onRefresh, explorerData, tabTypeOverride, hideTabBar, hideActionBar, onElementDetailChange, domainName, onViewTypeChange, elementsControls, onViewChange }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  // refetch may be async; allowing Promise here lets inline-add awaits the
  // refresh so the typed text stays visible until the new row appears.
  onRefresh?: () => void | Promise<void>;
  explorerData: ExplorerData;
  /** When set, the Object's content is driven by this tab type (Domain-level
   *  tab control) instead of the Object's own tab state. */
  tabTypeOverride?: ObjectTabType;
  /** When true, the internal TabBar is not rendered (tabs are at the
   *  Domain level above this component). */
  hideTabBar?: boolean;
  /** When true, the action bar (レポート / + / LayoutGrid) is not rendered.
   *  Used by the Domain shell to hand the pane fully over to an empty state. */
  hideActionBar?: boolean;
  /** Notifies the parent (Domain shell) when the Element-detail panel
   *  opens/closes so the Domain-level breadcrumb + TabBar can be hidden. */
  onElementDetailChange?: (open: boolean) => void;
  /** Active Domain name — passed to ElementDetailView so the breadcrumb
   *  can render the full route (Domain › Object › Element). */
  domainName?: string | null;
  /** When DomainView owns the visible tab bar, this asks that shell to
   *  add/select another view type instead of mutating hidden Object tabs. */
  onViewTypeChange?: (type: ObjectTabType) => void;
  /** Filter / Display state for the Elements tab — owned by DomainView
   *  so its TabBar rightSlot can render the matching ListControls UI.
   *  Filters this Object's direct Elements (not the descendant rollup). */
  elementsControls?: ListControlsState;
  /** Switch the active top-level activity — passed through to the Overview
   *  tab's "Campaign" property row, which jumps out to the Strategy surface. */
  onViewChange?: (view: string) => void;
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Domain-shared Element types — option list for the Elements tab's `type` column.
  const { data: domains, refetch: refetchDomains } = useDomains();
  const elementTypes = useMemo<string[]>(
    () => domains.find((d) => d.id === object.domain_id)?.element_types ?? [],
    [domains, object.domain_id],
  );

  // Workers for the QuickAdd popup's Assignee pill. Fetched once per Domain.
  const [popupWorkers, setPopupWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    fetchAllWorkers(object.domain_id ?? null)
      .then(setPopupWorkers)
      .catch((e) => console.error('Failed to load workers for QuickAdd', e));
  }, [object.domain_id]);

  // Labels already used on this Object's Elements — surface them as
  // selectable suggestions in the QuickAdd popup's Labels pill.
  const popupLabels = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const el of object.elements ?? []) for (const l of el.labels ?? []) s.add(l);
    return Array.from(s).sort();
  }, [object.elements]);

  // Element detail view state. Notifies the Domain shell so it can hide
  // its breadcrumb + TabBar while the detail panel is open.
  const [detailElementId, setDetailElementIdRaw] = useState<string | null>(null);
  const setDetailElementId = (id: string | null) => {
    setDetailElementIdRaw(id);
    onElementDetailChange?.(id !== null);
  };
  // The Domain shell remounts this component (via key) on Object change, so
  // a mount-only effect is enough to clear the parent flag for the new Object.
  useEffect(() => { onElementDetailChange?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Breadcrumb right-click delete
  const [breadcrumbCtx, setBreadcrumbCtx] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteObjectConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteObject(deleteTarget.id);
      // Navigate to parent or root when the deleted object is current or an ancestor
      onNavigate({ objectId: null });
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete object:', err);
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Multi-select columns state (key: "sectionIndex-colIndex")
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [lastSelectedColumnKey, setLastSelectedColumnKey] = useState<{ sectionIndex: number; colIndex: number } | null>(null);

  // Tabs state
  const { tabs, loading: tabsLoading, refetch: refetchTabs } = useObjectTabs(object.id);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Track which objects we've already initialized default tabs for (ref to survive re-renders)
  const initializedTabsRef = React.useRef<Set<string>>(new Set());
  const creatingTabsRef = React.useRef(false);

  // Auto-create default tabs if none exist (wait for loading to complete first)
  useEffect(() => {
    const initializeDefaultTabs = async () => {
      if (tabsLoading) return;
      if (tabs.length > 0) return;
      if (initializedTabsRef.current.has(object.id)) return;
      if (creatingTabsRef.current) return;
      initializedTabsRef.current.add(object.id);
      creatingTabsRef.current = true;
      try {
        const defaults: { type: ObjectTabType; title: string }[] = [
          { type: 'overview', title: 'Overview' },
          { type: 'elements', title: 'All' },
          { type: 'workers',  title: 'Members' },
        ];
        for (let i = 0; i < defaults.length; i++) {
          await createObjectTab({
            object_id: object.id,
            tab_type: defaults[i].type,
            title: defaults[i].title,
            order_index: i,
          });
        }
        await refetchTabs();
      } catch (e) {
        console.error('Failed to create default tabs:', e);
        initializedTabsRef.current.delete(object.id);
      } finally {
        creatingTabsRef.current = false;
      }
    };
    initializeDefaultTabs();
  }, [tabsLoading, tabs.length, object.id, refetchTabs]);

  // Default to Overview tab on Object change or first tab load.
  // Don't reset on every `tabs` change — that would clobber view switches
  // triggered when a new tab is created.
  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTabId(null);
      return;
    }
    setActiveTabId((prev) => {
      if (prev && tabs.some((t) => t.id === prev)) return prev;
      const overviewTab = tabs.find((t) => t.tab_type === 'overview');
      return (overviewTab ?? tabs[0]).id;
    });
  }, [object.id, tabs]);

  const internalActiveTab = tabs.find(t => t.id === activeTabId);
  // When the Domain shell drives the active tab, synthesize a stand-in tab so
  // the per-tab content rendering below keeps working unchanged.
  const activeTab = tabTypeOverride
    ? (tabs.find(t => t.tab_type === tabTypeOverride)
        ?? { id: `__override_${tabTypeOverride}`, object_id: object.id, tab_type: tabTypeOverride, title: tabTypeOverride, order_index: 0, created_at: null, updated_at: null })
    : internalActiveTab;

  // 1 Object = 1 sheet. Existing rows keep their sheet_id values (we just stop
  // exposing the sheet picker), and new rows are written with sheet_id = null.

  const handleTabCreate = async (type: ObjectTabType, title: string) => {
    try {
      const newTab = await createObjectTab({
        object_id: object.id,
        tab_type: type,
        title,
      });
      await refetchTabs();
      setActiveTabId(newTab.id);
    } catch (e) {
      console.error('[MainContent] Failed to create tab:', e);
    }
  };

  const handleTabClose = async (tabId: string) => {
    try {
      await deleteObjectTab(tabId);
      await refetchTabs();
      // If we closed the active tab, switch to Elements tab
      if (tabId === activeTabId) {
        const elementsTab = tabs.find(t => t.tab_type === 'elements' && t.id !== tabId);
        setActiveTabId(elementsTab?.id || null);
      }
    } catch (e) {
      console.error('Failed to close tab:', e);
    }
  };

  // Quick-add Element popup (bottom-center). Opens directly from the
  // action bar's "+" — no menu, since adding an Element is the obvious
  // intent inside an Object.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // The band the popup was opened from, when the list is grouped by a field.
  // It seeds the popup's pills so a "+" pressed inside "In progress" opens on
  // "In progress" — the cursor already answered which one.
  const [quickAddGroup, setQuickAddGroup] = useState<SectionGroup | undefined>(undefined);
  const openQuickAddElement = React.useCallback(() => {
    if (activeTab?.tab_type !== 'elements') {
      if (tabTypeOverride && onViewTypeChange) {
        onViewTypeChange('elements');
      } else {
        const elementsTab = tabs.find((t) => t.tab_type === 'elements');
        if (elementsTab) setActiveTabId(elementsTab.id);
      }
    }
    setQuickAddGroup(undefined);
    setQuickAddOpen(true);
  }, [activeTab?.tab_type, onViewTypeChange, tabTypeOverride, tabs]);

  useEffect(() => {
    if (hideActionBar) return;
    const onQuickAdd = () => openQuickAddElement();
    window.addEventListener('alcon:quick-add-element', onQuickAdd);
    return () => {
      window.removeEventListener('alcon:quick-add-element', onQuickAdd);
    };
  }, [hideActionBar, openQuickAddElement]);

  // Bulk-select rows (checkbox / Shift-range / Cmd-click) — shared hook so
  // the behaviour matches the Domain Elements + My Elements lists.
  const { selectedRowIds, handleRowSelect, clearSelection } = useElementSelection();

  // Section "+" — every section belongs to this Object, so `object_id` is
  // fixed; what varies is the band, and the popup opens on that band's value
  // (status / assignee / label / …) rather than asking again.
  const openQuickAddForSection = (section?: ListSection) => {
    setQuickAddGroup(section?.group);
    setQuickAddOpen(true);
  };

  // The band's value, spread across the popup's pills. The "no value" bands
  // ("No status", "Unassigned", …) come back empty, so the popup opens unset —
  // it has no way to say "explicitly none", and an unset pill has always meant
  // the column default here.
  const quickAddDefaults = sectionGroupValues(quickAddGroup);

  // Bulk DB ops — sequential to keep error reporting simple. Refresh once
  // at the end so the list updates in a single render.
  const bulkDelete = async () => {
    for (const id of selectedRowIds) {
      try { await deleteElement(id); } catch (e) { console.error('Delete failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
  };
  const bulkDuplicate = async () => {
    const elements = object.elements ?? [];
    const created: string[] = [];
    for (const id of selectedRowIds) {
      const src = elements.find((e) => e.id === id);
      if (!src) continue;
      try {
        const dup = await createElement({
          title: `${src.title} (copy)`,
          object_id: object.id,
          description: src.description ?? null,
          status: src.status ?? undefined,
          priority: src.priority ?? undefined,
          start_date: src.start_date ?? null,
          due_date: src.due_date ?? null,
          estimated_hours: src.estimated_hours ?? null,
        });
        if (dup?.id) created.push(dup.id);
      } catch (e) { console.error('Duplicate failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    if (created.length > 0) {
      pushUndo({
        label: `Duplicate ${created.length} Elements`,
        undo: async () => {
          for (const id of created) { try { await deleteElement(id); } catch (e) { console.error(e); } }
          await onRefresh?.();
        },
      });
    }
  };
  const bulkMove = async (targetObjectId: string) => {
    const elements = object.elements ?? [];
    const prev = new Map<string, string | null>();
    for (const id of selectedRowIds) prev.set(id, elements.find((e) => e.id === id)?.object_id ?? null);
    for (const id of selectedRowIds) {
      try { await updateElement(id, { object_id: targetObjectId }); } catch (e) { console.error('Move failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    pushUndo({
      label: `Move ${prev.size} Elements`,
      undo: async () => {
        for (const [id, original] of prev) { try { await updateElement(id, { object_id: original }); } catch (e) { console.error(e); } }
        await onRefresh?.();
      },
    });
  };
  const bulkAddToObject = async (targetObjectId: string) => {
    const linked: string[] = [];
    for (const id of selectedRowIds) {
      try { await addElementToObject(id, targetObjectId); linked.push(id); } catch (e) { console.error('Multi-home failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    if (linked.length > 0) {
      pushUndo({
        label: `Add ${linked.length} Elements`,
        undo: async () => {
          for (const id of linked) { try { await removeElementFromObject(id, targetObjectId); } catch (e) { console.error(e); } }
          await onRefresh?.();
        },
      });
    }
  };
  const bulkSetField = async (
    field: 'status' | 'priority' | 'due_date',
    value: ElementWithDetails['status'] | ElementWithDetails['priority'] | string | null,
    label: string,
  ) => {
    const els = object.elements ?? [];
    const prev = new Map<string, unknown>();
    for (const id of selectedRowIds) prev.set(id, (els.find((e) => e.id === id) as Record<string, unknown> | undefined)?.[field] ?? null);
    for (const id of selectedRowIds) {
      try { await updateElement(id, { [field]: value }); } catch (e) { console.error('Bulk edit failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    pushUndo({
      label,
      undo: async () => {
        for (const [id, original] of prev) { try { await updateElement(id, { [field]: original }); } catch (e) { console.error(e); } }
        await onRefresh?.();
      },
    });
  };

  // Esc clears selection (when nothing else is consuming Esc).
  useEffect(() => {
    if (selectedRowIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedRowIds.size]);

  // Built-in columns state (stored globally in localStorage — shared across
  // all objects in the workspace).
  const configKey = 'global';
  const [builtInColumns, setBuiltInColumns] = useState<BuiltInColumn[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`builtInColumns_${configKey}`);
      return saved ? JSON.parse(saved) : DEFAULT_BUILTIN_COLUMNS;
    }
    return DEFAULT_BUILTIN_COLUMNS;
  });

  // Save built-in columns to localStorage (shared across all objects)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`builtInColumns_${configKey}`, JSON.stringify(builtInColumns));
    }
  }, [builtInColumns, configKey]);

  // Single-sheet model: every element on the Object shows up in the list.
  const allElements = object.elements || [];
  const elements = allElements;

  // Flat 2-level model — Objects have no children, so descendant ==
  // direct elements. Kept under this name for the call sites
  // (Gantt/Dashboard/Calendar/Overview) that read it.
  const allDescendantElements = allElements;

  // Update selected element when elements change
  const currentSelectedElement = selectedElement
    ? elements.find(e => e.id === selectedElement.id) || null
    : null;

  // Cell selection state for drag selection
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Handle mouse down to start drag selection
  const handleCellMouseDown = (rowIndex: number, colIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    setIsDragging(true);
    setDragStart({ rowIndex, colIndex });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  };

  // Handle mouse enter during drag to extend selection
  const handleCellMouseEnter = (rowIndex: number, colIndex: number) => {
    if (isDragging && dragStart) {
      const startRow = Math.min(dragStart.rowIndex, rowIndex);
      const endRow = Math.max(dragStart.rowIndex, rowIndex);
      const startCol = Math.min(dragStart.colIndex, colIndex);
      const endCol = Math.max(dragStart.colIndex, colIndex);

      const newSelection = new Set<string>();
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          newSelection.add(`${r}-${c}`);
        }
      }
      setSelectedCells(newSelection);
    }
  };

  // Handle mouse up to end drag selection
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Clear selection on click outside table
  const handleTableClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('td') && !target.closest('th')) {
      setSelectedCells(new Set());
    }
  };


  const handleUpdateBuiltInColumn = (columnId: string, updates: Partial<BuiltInColumn>) => {
    setBuiltInColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, ...updates } : col
    ));
  };

  const handleDeleteBuiltInColumn = (columnId: string) => {
    setBuiltInColumns(prev => prev.filter(col => col.id !== columnId));
  };

  // Add a built-in column back (for restoring deleted columns)
  const handleAddBuiltInColumn = (builtinType: 'assignees' | 'priority' | 'status' | 'due_date') => {
    const defaultCol = DEFAULT_BUILTIN_COLUMNS.find(c => c.builtinType === builtinType);
    if (defaultCol && !builtInColumns.find(c => c.builtinType === builtinType)) {
      setBuiltInColumns(prev => [...prev, { ...defaultCol }]);
    }
  };


  // (Inline add helpers removed alongside section grouping. Element / Object
  // creation is wired through ListTable's onAdd callbacks below.)

  const handleStatusChange = async (elementId: string, newStatus: ElementStatus) => {
    try {
      await updateElement(elementId, { status: newStatus });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update element:', e);
    }
  };

  // Custom (Property) columns — fetch + CRUD + the "+" picker all live in the
  // shared controller. Scoped to this Object so its columns tag this Object's
  // Elements. The same hook powers My Elements / Domain Elements with a
  // different scope, keeping the picker and column behaviour identical.
  const columns = useCustomColumns(
    { kind: 'object', objectId: object.id },
    {
      deletedBuiltInColumns: DEFAULT_BUILTIN_COLUMNS.filter(
        (defaultCol) => !builtInColumns.find((col) => col.builtinType === defaultCol.builtinType),
      ),
      onRestoreBuiltIn: handleAddBuiltInColumn,
    },
  );
  const customColumns = columns.customColumns;

  // Handle column header click for multi-select (scoped to section)
  const handleColumnHeaderClick = (sectionIndex: number, colIndex: number, event: React.MouseEvent) => {
    const key = `${sectionIndex}-${colIndex}`;

    if (event.shiftKey) {
      // Shift+click: range select columns within same section
      event.preventDefault();
      if (lastSelectedColumnKey !== null && lastSelectedColumnKey.sectionIndex === sectionIndex) {
        const start = Math.min(lastSelectedColumnKey.colIndex, colIndex);
        const end = Math.max(lastSelectedColumnKey.colIndex, colIndex);
        const newSelection = new Set<string>();
        for (let i = start; i <= end; i++) {
          newSelection.add(`${sectionIndex}-${i}`);
        }
        setSelectedColumnKeys(newSelection);
      } else {
        // Different section or no previous selection
        setSelectedColumnKeys(new Set([key]));
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: toggle column in selection (same section only)
      if (lastSelectedColumnKey === null || lastSelectedColumnKey.sectionIndex === sectionIndex) {
        const newSelection = new Set(selectedColumnKeys);
        if (newSelection.has(key)) {
          newSelection.delete(key);
        } else {
          newSelection.add(key);
        }
        setSelectedColumnKeys(newSelection);
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      } else {
        // Different section - start fresh
        setSelectedColumnKeys(new Set([key]));
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      }
    } else {
      // Normal click: single select
      setSelectedColumnKeys(new Set([key]));
      setLastSelectedColumnKey({ sectionIndex, colIndex });
    }
  };

  // Detail view check (computed AFTER all hooks to avoid hook-order violation)
  const detailElement = detailElementId ? allElements.find(e => e.id === detailElementId) : null;

  // Breadcrumb path. Flat 2-level model — the path is just [self] when
  // the Object is in the active domain, [] otherwise.
  const objectPath = useMemo(() => {
    const found = explorerData.objects.find(o => o.id === object.id);
    return found ? [{ id: found.id, name: found.name }] : [];
  }, [explorerData.objects, object.id]);

  // Early return AFTER all hooks have been called
  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        objectPath={objectPath}
        onBack={() => { setDetailElementId(null); setSelectedCells(new Set()); }}
        onRefresh={onRefresh}
        domainName={domainName ?? null}
        onNavigateRoot={() => {
          setDetailElementId(null);
          onNavigate({ objectId: null });
        }}
        onOpenStrategy={(strategyId) => {
          onNavigate({ strategyId });
          onViewChange?.('strategy');
        }}
        onNavigateObject={(id) => {
          setDetailElementId(null);
          onNavigate({ objectId: id });
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab Bar + Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Bar — hidden when a Domain-level shell drives the tabs. */}
          {!hideTabBar && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabSelect={setActiveTabId}
              onTabClose={handleTabClose}
              onTabCreate={handleTabCreate}
            />
          )}

      {/* Tab Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Elements tab — flat 2-level model: Domain > Object > Elements.
            Body lives in the shared ObjectElementsView so the markup +
            filter/grouping match the sidebar Elements view exactly. */}
        {activeTab?.tab_type === 'elements' && (
          <ObjectElementsView
            elements={object.elements ?? []}
            objectId={object.id}
            objectName={object.name}
            controls={elementsControls}
            elementTypes={elementTypes}
            customColumns={customColumns}
            onColumnValueChange={columns.onColumnValueChange}
            onAddColumn={columns.openAddColumn}
            selectedElementIds={selectedRowIds}
            onElementRowSelect={handleRowSelect}
            onSelectObject={(id) => onNavigate({ objectId: id })}
            onSelectElement={(id) => setDetailElementId(id)}
            onRefresh={onRefresh}
            onAddType={object.domain_id ? async (name) => {
              try { await addDomainElementType(object.domain_id!, name); await refetchDomains(); await onRefresh?.(); }
              catch (e) { console.error('Failed to add type:', e); }
            } : undefined}
            onRemoveType={object.domain_id ? async (name) => {
              try { await removeDomainElementType(object.domain_id!, name); await refetchDomains(); await onRefresh?.(); }
              catch (e) { console.error('Failed to remove type:', e); }
            } : undefined}
            onAddEmpty={() => openQuickAddForSection()}
            onAddElement={openQuickAddForSection}
          />
        )}

        {/* Overview Tab Content — Project Overview (Asana-style) */}
        {activeTab?.tab_type === 'overview' && (
          <div className="flex-1 overflow-auto bg-card">
            <OverviewView
              elements={allDescendantElements}
              object={object}
              explorerData={explorerData}
              onRefresh={onRefresh}
              onNavigate={onNavigate}
              onViewChange={onViewChange}
            />
          </div>
        )}

        {/* Summary/Dashboard Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'summary' && (
          <div className="flex-1 overflow-auto bg-card">
            <SummaryView elements={allDescendantElements} object={object} />
          </div>
        )}

        {/* Gantt Tab Content — this Object's Elements as a flat bar list.
            We deliberately do NOT pass `object`: passing it triggers
            GanttView's parent-Object grouping, but here every Element already
            belongs to the same Object, so the grouping just adds a noisy
            single-section header above the bars. Flat reads cleaner. */}
        {activeTab?.tab_type === 'gantt' && (
          <div className="flex-1 overflow-hidden bg-card">
            <GanttView
              elements={allDescendantElements}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Board (Kanban) Tab Content */}
        {activeTab?.tab_type === 'board' && (
          <div className="flex-1 overflow-hidden bg-card">
            <ElementBoardView
              elements={allDescendantElements}
              onRefresh={onRefresh}
              objectId={object.id}
            />
          </div>
        )}

        {/* Calendar Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'calendar' && (
          <div className="flex-1 overflow-hidden bg-card">
            <CalendarView
              elements={allDescendantElements}
              onElementClick={(element) => setSelectedElement(element)}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Members tab (uses tab_type='workers' so no schema/enum migration
            is needed). The display title is set via the tab record itself —
            defaults / backfill use 'Members'. */}
        {activeTab?.tab_type === 'workers' && (
          <ObjectMembersPanel objectId={object.id} domainId={object.domain_id} />
        )}

        {/* CustomView Tab Content */}
        {activeTab?.tab_type === 'custom_view' && (
          <div className="flex-1 h-full overflow-hidden bg-card">
            <CustomView
              key={`object:${object.id}`}
              scopeId={`object:${object.id}`}
              scopeLabel={object.name}
              elements={allDescendantElements}
            />
          </div>
        )}

        {/* Resource Tab Content — per-Worker capacity for this Object */}
        {activeTab?.tab_type === 'resource' && (
          <div className="flex-1 overflow-hidden bg-card">
            <ResourceView
              scopeOverride={{ objectIds: [object.id] }}
              hideHeader
            />
          </div>
        )}

      </div>

      {/* Add Column Modal — owned by the shared custom-columns controller. */}
      {columns.addColumnModal}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel={object.name}
        onClose={() => setQuickAddOpen(false)}
        types={elementTypes}
        workers={popupWorkers.map((w) => ({ id: w.id, name: w.name, avatar_url: w.avatar_url }))}
        availableLabels={popupLabels}
        defaultObjectId={object.id}
        defaultType={quickAddDefaults.type}
        defaultStatus={quickAddDefaults.status}
        defaultPriority={quickAddDefaults.priority}
        defaultAssigneeWorkerIds={quickAddDefaults.assigneeWorkerIds}
        defaultLabels={quickAddDefaults.labels}
        onSubmit={async (inputs: NewElementInput[]) => {
          for (const input of inputs) {
            try {
              const created = await createElement({
                title: input.title,
                object_id: input.objectId !== undefined ? input.objectId : object.id,
                description: input.description ?? null,
                type: input.type ?? null,
                labels: input.labels ?? [],
                status: input.status ?? undefined,
                priority: input.priority ?? undefined,
              });
              for (const wid of input.assigneeWorkerIds ?? []) {
                try {
                  await addElementAssignee({ element_id: created.id, worker_id: wid, role: 'assignee' });
                } catch (e) { console.warn('Could not assign Element:', e); }
              }
            } catch (e) { console.error('Failed to create Element', e); }
          }
          await onRefresh?.();
        }}
      />

      <BulkActionBar
        count={selectedRowIds.size}
        pickerObjects={explorerData.objects}
        excludeObjectId={object.id}
        onDelete={bulkDelete}
        onDuplicate={bulkDuplicate}
        onMove={bulkMove}
        onAddToObject={bulkAddToObject}
        onSetStatus={(s) => bulkSetField('status', s, `Set status of ${selectedRowIds.size} Elements`)}
        onSetPriority={(p) => bulkSetField('priority', p, `Set priority of ${selectedRowIds.size} Elements`)}
        onSetDueDate={(d) => bulkSetField('due_date', d, `Set due date of ${selectedRowIds.size} Elements`)}
        onClear={clearSelection}
      />

      {/* Breadcrumb right-click context menu */}
      {breadcrumbCtx && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setBreadcrumbCtx(null)} onContextMenu={(e) => { e.preventDefault(); setBreadcrumbCtx(null); }} />
          <div
            className="fixed bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
            style={{ left: breadcrumbCtx.x, top: breadcrumbCtx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left text-destructive hover:bg-accent cursor-pointer"
              onClick={() => { setDeleteTarget({ id: breadcrumbCtx.id, name: breadcrumbCtx.name }); setBreadcrumbCtx(null); }}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-[340px] p-6" showCloseButton={false}>
          <div className="text-center">
            <DialogTitle className="text-[15px] font-semibold mb-1">Delete &apos;{deleteTarget?.name}&apos;?</DialogTitle>
            <p className="text-[13px] text-muted-foreground mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <Button variant="danger" size="md" onClick={handleDeleteObjectConfirm} disabled={isDeleting} className="w-full">
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button variant="secondary" size="md" onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="w-full">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

