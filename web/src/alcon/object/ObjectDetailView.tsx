'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType, Worker } from '@/hooks/useSupabase';
import {
  createElement, addElementToObject, updateElement, deleteElement, addElementAssignee,
  fetchAllWorkers, fetchCustomColumnsWithValues,
  createCustomColumn, updateCustomColumn, deleteCustomColumn, setCustomColumnValue,
  useObjectTabs, useDomains, createObjectTab, deleteObjectTab, reorderElements,
  moveObject, deleteObject, updateObject,
} from '@/hooks/useSupabase';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ObjectTabType, Json, ElementStatus } from '@/types/database';
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
import { ReportPreview } from '@/alcon/brief/documents/ReportPreview';
import { AddColumnModal, ColumnHeader, BuiltInColumnHeader, DEFAULT_BUILTIN_COLUMNS } from '@/alcon/tag';
import type { BuiltInColumn } from '@/alcon/tag';
import { ElementTableRow, ElementPropertiesPanel, ElementDetailView, InlineAddRow } from '@/alcon/element';
import { QuickAddElementPopup } from '@/alcon/element/QuickAddElementPopup';
import { BulkActionBar } from '@/alcon/element/BulkActionBar';
import { ObjectPicker } from '@/alcon/object/ObjectPicker';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuCheckboxItem } from '@/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, ListPlus, FolderPlus, Heading, X, Trash2, Users, Link2, ArrowRight, FileText, Loader2, Sparkles, Filter, ArrowUpDown, MoreHorizontal, Copy, Pencil, GripVertical, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { collectAllObjects } from '@/alcon/object/ObjectsView';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import { ObjectMembersPanel } from '@/alcon/object/ObjectMembersPanel';
import { ElementsList } from '@/alcon/element/ElementsList';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import type { ListControlsState } from '@/alcon/shared/listControls';

type SortableListeners = ReturnType<typeof useSortable>['listeners'];

// Atom icon — Element marker (matches the icon used in ElementTableRow)

export function ObjectDetailView({ object, onNavigate, onRefresh, explorerData, tabTypeOverride, hideTabBar, hideActionBar, onElementDetailChange, domainName, onViewTypeChange, elementsControls }: {
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
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Domain-shared Element types — option list for the Elements tab's `type` column.
  const { data: domains } = useDomains();
  const elementTypes = useMemo<string[]>(
    () => domains.find((d) => d.id === object.domain_id)?.element_types ?? [],
    [domains, object.domain_id],
  );

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

  // Object-level AI report (opened from the action bar button)
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [report, setReport] = useState<{ signedUrl: string; filename: string } | null>(null);

  const handleGenerateObjectReport = React.useCallback(async () => {
    setReportOpen(true);
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-object-report', {
        body: { object_id: object.id },
      });
      if (error) throw error;
      if (!data?.signed_url) throw new Error('No signed URL returned');
      setReport({ signedUrl: data.signed_url, filename: data.filename ?? 'report.docx' });
    } catch (e: any) {
      setReportError(String(e?.message ?? e));
    } finally {
      setReportLoading(false);
    }
  }, [object.id]);

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
    console.log('[MainContent] handleTabCreate called:', { type, title, objectId: object.id });
    try {
      const newTab = await createObjectTab({
        object_id: object.id,
        tab_type: type,
        title,
      });
      console.log('[MainContent] Tab created successfully:', newTab);
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
  const openQuickAddElement = React.useCallback(() => {
    if (activeTab?.tab_type !== 'elements') {
      if (tabTypeOverride && onViewTypeChange) {
        onViewTypeChange('elements');
      } else {
        const elementsTab = tabs.find((t) => t.tab_type === 'elements');
        if (elementsTab) setActiveTabId(elementsTab.id);
      }
    }
    setQuickAddOpen(true);
  }, [activeTab?.tab_type, onViewTypeChange, tabTypeOverride, tabs]);

  useEffect(() => {
    if (hideActionBar) return;
    const onReport = () => { void handleGenerateObjectReport(); };
    const onQuickAdd = () => openQuickAddElement();
    window.addEventListener('alcon:generate-object-report', onReport);
    window.addEventListener('alcon:quick-add-element', onQuickAdd);
    return () => {
      window.removeEventListener('alcon:generate-object-report', onReport);
      window.removeEventListener('alcon:quick-add-element', onQuickAdd);
    };
  }, [handleGenerateObjectReport, hideActionBar, openQuickAddElement]);

  // Bulk-select rows (Shift / Cmd-click). Tracks selected Element ids
  // + the most-recent anchor for Shift-range extension.
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  // Elements-tab filter / grouping pipeline now lives inside the
  // shared <ElementsList /> component below (see the activeTab ===
  // 'elements' branch).

  const handleRowSelect = (elementId: string, mode: 'single' | 'range' | 'replace') => {
    const elements = object.elements ?? [];
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (mode === 'single') {
        if (next.has(elementId)) next.delete(elementId);
        else next.add(elementId);
        setSelectionAnchor(elementId);
        return next;
      }
      if (mode === 'range') {
        const ids = elements.map((e) => e.id);
        const anchor = selectionAnchor ?? (next.size > 0 ? Array.from(next).pop() ?? null : null);
        if (!anchor) {
          next.add(elementId);
          setSelectionAnchor(elementId);
          return next;
        }
        const aIdx = ids.indexOf(anchor);
        const bIdx = ids.indexOf(elementId);
        if (aIdx === -1 || bIdx === -1) {
          next.add(elementId);
          return next;
        }
        const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
        return next;
      }
      // 'replace' — plain click while something is selected
      const fresh = new Set<string>([elementId]);
      setSelectionAnchor(elementId);
      return fresh;
    });
  };
  const clearSelection = () => { setSelectedRowIds(new Set()); setSelectionAnchor(null); };

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
    for (const id of selectedRowIds) {
      const src = elements.find((e) => e.id === id);
      if (!src) continue;
      try {
        await createElement({
          title: `${src.title} (copy)`,
          object_id: object.id,
          description: src.description ?? null,
          status: src.status ?? undefined,
          priority: src.priority ?? undefined,
          start_date: src.start_date ?? null,
          due_date: src.due_date ?? null,
          estimated_hours: src.estimated_hours ?? null,
        });
      } catch (e) { console.error('Duplicate failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
  };
  const bulkMove = async (targetObjectId: string) => {
    for (const id of selectedRowIds) {
      try { await updateElement(id, { object_id: targetObjectId }); } catch (e) { console.error('Move failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
  };
  const bulkAddToObject = async (targetObjectId: string) => {
    for (const id of selectedRowIds) {
      try { await addElementToObject(id, targetObjectId); } catch (e) { console.error('Multi-home failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
  };

  // Esc clears selection (when nothing else is consuming Esc).
  useEffect(() => {
    if (selectedRowIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedRowIds.size]);

  // Custom columns state
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);

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

  // Fetch custom columns (shared across project - use first object's columns as template)
  useEffect(() => {
    fetchCustomColumnsWithValues(object.id).then(setCustomColumns).catch(console.error);
  }, [object.id]);

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
  // creation is wired through ObjectListView's onAdd callbacks below.)

  const handleStatusChange = async (elementId: string, newStatus: ElementStatus) => {
    try {
      await updateElement(elementId, { status: newStatus });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update element:', e);
    }
  };

  const handleAddColumn = async (name: string, type: CustomColumnType) => {
    try {
      let options: Record<string, unknown> = {};

      if (type === 'select' || type === 'multi_select' || type === 'status') {
        options = { options: [{ value: 'Option 1' }, { value: 'Option 2' }] };
      }

      await createCustomColumn({
        object_id: object.id,
        name,
        column_type: type,
        options,
      });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
      setShowAddColumnModal(false);
    } catch (e) {
      console.error('Failed to create column:', e);
    }
  };

  const handleRenameColumn = async (columnId: string, name: string) => {
    try {
      await updateCustomColumn(columnId, { name });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to rename column:', e);
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    try {
      await deleteCustomColumn(columnId);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to delete column:', e);
    }
  };

  const handleUpdateColumn = async (columnId: string, updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => {
    try {
      await updateCustomColumn(columnId, updates);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to update column:', e);
    }
  };

  const handleDuplicateColumn = async (column: CustomColumnWithValues) => {
    try {
      await createCustomColumn({
        object_id: object.id,
        name: `${column.name} (copy)`,
        column_type: column.column_type,
        options: column.options,
      });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to duplicate column:', e);
    }
  };

  const handleColumnValueChange = async (columnId: string, elementId: string, value: Json) => {
    try {
      await setCustomColumnValue(columnId, elementId, value);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to update column value:', e);
    }
  };

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

  // Calculate total table columns: row num + name + visible built-in columns + custom columns + add button
  const visibleBuiltInCount = builtInColumns.filter(col => col.isVisible).length;
  const totalColumns = 3 + visibleBuiltInCount + customColumns.length + 1;

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
        {/* List tab — flat 2-level model: Domain > Object > Elements.
            Renders this Object's direct Elements via the shared
            ObjectListView so the markup matches the Domain root list
            (drag handle gutter + checkbox + atom icon, no borders). */}
        {activeTab?.tab_type === 'elements' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-card">
            {(object.elements ?? []).length === 0 ? (
              <ElementsEmptyState onAdd={() => setQuickAddOpen(true)} />
            ) : elementsControls ? (
              // Domain-shell case: route through the shared <ElementsList />
              // so filter / grouping behaviour matches the sidebar
              // Elements view exactly.
              <ElementsList
                elements={object.elements ?? []}
                controls={elementsControls}
                onSelectObject={(id) => onNavigate({ objectId: id })}
                onSelectElement={(id) => setDetailElementId(id)}
                onRefresh={onRefresh}
                colStorageKey={`object:${object.id}`}
                elementTypes={elementTypes}
                customColumns={customColumns}
                onCustomColumnValueChange={handleColumnValueChange}
                onAddColumn={() => setShowAddColumnModal(true)}
                selectedElementIds={selectedRowIds}
                onElementRowSelect={handleRowSelect}
                onElementUpdateOverride={async (elementId, updates) => {
                  try {
                    await updateElement(elementId, updates);
                    await onRefresh?.();
                  } catch (e) { console.error('Failed to update element:', e); }
                }}
              />
            ) : (
              // Stand-alone fallback when no controls are wired (legacy
              // embedding without the Domain shell). Preserves the
              // single-section layout this view used to ship with.
              <ObjectListView
                sections={[
                  {
                    id: '_all',
                    name: object.name,
                    objects: [],
                    elements: object.elements ?? [],
                  } satisfies ListSection,
                ]}
                onSelectObject={(id) => onNavigate({ objectId: id })}
                onSelectElement={(id) => setDetailElementId(id)}
                hideSectionHeaders
                colStorageKey={`object:${object.id}`}
                elementTypes={elementTypes}
                customColumns={customColumns}
                onCustomColumnValueChange={handleColumnValueChange}
                onAddColumn={() => setShowAddColumnModal(true)}
                onElementUpdate={async (elementId, updates) => {
                  try {
                    await updateElement(elementId, updates);
                    await onRefresh?.();
                  } catch (e) { console.error('Failed to update element:', e); }
                }}
                selectedElementIds={selectedRowIds}
                onElementRowSelect={handleRowSelect}
              />
            )}
          </div>
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
            />
          </div>
        )}

        {/* Summary/Dashboard Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'summary' && (
          <div className="flex-1 overflow-auto bg-card">
            <SummaryView elements={allDescendantElements} object={object} />
          </div>
        )}

        {/* Gantt Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'gantt' && (
          <div className="flex-1 overflow-hidden bg-card">
            <GanttView
              elements={allDescendantElements}
              object={object}
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

      {/* Add Column Modal */}
      {showAddColumnModal && (
        <AddColumnModal
          onClose={() => setShowAddColumnModal(false)}
          onAdd={handleAddColumn}
          deletedBuiltInColumns={DEFAULT_BUILTIN_COLUMNS.filter(
            defaultCol => !builtInColumns.find(col => col.builtinType === defaultCol.builtinType)
          )}
          onRestoreBuiltIn={handleAddBuiltInColumn}
        />
      )}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel={object.name}
        onClose={() => setQuickAddOpen(false)}
        onSubmit={async (titles) => {
          for (const title of titles) {
            try {
              await createElement({ title, object_id: object.id });
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
        onClear={clearSelection}
      />

      {/* Object Report — Word-style preview in a wide modal */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-[1080px] w-[96vw] p-0 gap-0 overflow-hidden" showCloseButton={false}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={14} className="text-foreground shrink-0" />
              <DialogTitle className="text-[14px] font-semibold truncate">
                {object.name} のレポート
              </DialogTitle>
            </div>
            <button
              onClick={() => setReportOpen(false)}
              className="p-1 rounded-md hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-4 bg-card">
            {reportLoading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-[13px] py-16">
                <Loader2 size={14} className="animate-spin" />
                Claude が docx を生成中… (10〜60秒程度かかります)
              </div>
            ) : reportError ? (
              <div className="text-[13px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
                {reportError}
              </div>
            ) : report ? (
              <ReportPreview signedUrl={report.signedUrl} filename={report.filename} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

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
              <Button onClick={handleDeleteObjectConfirm} disabled={isDeleting} className="w-full bg-destructive hover:bg-destructive/90 text-white">
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="w-full">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

// ============================================
// Elements empty state
// ============================================
function ElementsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavMyTasksIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Elements to this Object</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        You can also add sections, set priorities, assignees, and due dates.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
