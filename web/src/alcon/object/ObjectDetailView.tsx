'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType, Worker } from '@/hooks/useSupabase';
import {
  createElement, addElementToObject, updateElement, deleteElement, addElementAssignee,
  fetchAllWorkers, fetchCustomColumnsWithValues,
  createCustomColumn, updateCustomColumn, deleteCustomColumn, setCustomColumnValue,
  useObjectTabs, createObjectTab, deleteObjectTab, reorderElements,
  createObject as createObjectRow, moveObject, deleteObject, updateObject,
} from '@/hooks/useSupabase';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ObjectTabType, Json } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import { ObjectIcon } from '@/shell/icons';
import { TabBar } from '@/shell/TabBar';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { SummaryView } from '@/alcon/object/summary/SummaryView';
import { OverviewView } from '@/alcon/object/overview/OverviewView';
import { GanttView } from '@/alcon/element/gantt';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { ReportPreview } from '@/alcon/brief/documents/ReportPreview';
import { AddColumnModal, ColumnHeader, BuiltInColumnHeader, DEFAULT_BUILTIN_COLUMNS } from '@/alcon/tag';
import type { BuiltInColumn } from '@/alcon/tag';
import { ElementTableRow, ElementPropertiesPanel, ElementDetailView, InlineAddRow } from '@/alcon/element';
import { ObjectPicker } from '@/alcon/object/ObjectPicker';
import { BriefDialog, BriefViewDialog, ObjectDraftDialog, BriefsListView, type BriefStructured } from '@/alcon/brief';
import type { BriefDraft } from '@/alcon/brief/BriefDialog';
import type { ObjectDraftElement } from '@/alcon/brief/objectDraft';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem } from '@/ui/dropdown-menu';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, ListPlus, FolderPlus, Heading, X, Trash2, Users, Link2, ArrowRight, FileText, Loader2, Sparkles, Filter, ArrowUpDown, MoreHorizontal, Copy, Pencil, GripVertical, SlidersHorizontal, LayoutGrid, List, BarChart3, GanttChart, Calendar, ClipboardList, Kanban } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { collectAllObjects } from '@/alcon/object/ObjectsView';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';

type SortableListeners = ReturnType<typeof useSortable>['listeners'];

// Atom icon — Element marker (matches the icon used in ElementTableRow)
const AtomIcon = ({ className = '' }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
    <circle cx="21.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export function ObjectDetailView({ object, onNavigate, onRefresh, explorerData, tabTypeOverride, hideTabBar }: {
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
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Element detail view state
  const [detailElementId, setDetailElementId] = useState<string | null>(null);

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

  const handleGenerateObjectReport = async () => {
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
          { type: 'elements', title: 'List' },
          { type: 'board', title: 'Board' },
          { type: 'gantt', title: 'Gantt' },
          { type: 'summary', title: 'Dashboard' },
          { type: 'calendar', title: 'Calendar' },
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

  // Custom columns state
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);

  // Built-in columns state (stored globally in localStorage - shared across all objects)
  // Use parent_object_id if available, otherwise use 'global' to share across all objects
  const configKey = object.parent_object_id || 'global';
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

  // Collect ALL elements including children Objects (for Gantt/Dashboard/Calendar/Overview)
  // Uses Set for dedup (multi-homing) and cycle prevention
  const allDescendantElements = useMemo(() => {
    const seen = new Set<string>();
    const result: ElementWithDetails[] = [];
    const addElements = (els: ElementWithDetails[]) => {
      for (const el of els) {
        if (!seen.has(el.id)) { seen.add(el.id); result.push(el); }
      }
    };
    addElements(allElements);
    const visitedObjects = new Set<string>();
    const collectFromChildren = (children?: AlconObjectWithChildren[]) => {
      if (!children) return;
      for (const child of children) {
        if (visitedObjects.has(child.id)) continue; // cycle guard
        visitedObjects.add(child.id);
        if (child.elements) addElements(child.elements);
        collectFromChildren(child.children);
      }
    };
    collectFromChildren(object.children);
    return result;
  }, [allElements, object.children]);

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

  const handleStatusChange = async (elementId: string, newStatus: string) => {
    try {
      await updateElement(elementId, { status: newStatus as any });
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

  // Build breadcrumb path for this object
  const objectPath = useMemo(() => {
    const findPath = (objs: AlconObjectWithChildren[], path: { id: string; name: string }[]): { id: string; name: string }[] | null => {
      for (const obj of objs) {
        const currentPath = [...path, { id: obj.id, name: obj.name }];
        if (obj.id === object.id) return currentPath;
        if (obj.children) {
          const found = findPath(obj.children, currentPath);
          if (found) return found;
        }
      }
      return null;
    };
    return findPath(explorerData.objects, []) || [];
  }, [explorerData.objects, object.id]);

  // Early return AFTER all hooks have been called
  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        objectPath={objectPath}
        onBack={() => { setDetailElementId(null); setSelectedCells(new Set()); }}
        onRefresh={onRefresh}
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

      {/* Persistent action bar — visible across all views (List / Gantt /
           Calendar / etc). レポート + Add (+) + View switcher (LayoutGrid). */}
      <div className="px-5 py-2 bg-card flex items-center gap-2 flex-shrink-0">
        <div className="flex-1" />

        <button
          onClick={handleGenerateObjectReport}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 hover:text-foreground border border-border/60 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
          title="この Object のレポートを AI で生成"
        >
          <Sparkles size={13} />
          レポート
        </button>

        {/* Add (+) button — only on data-entry views (List / Gantt / Calendar). */}
        {(activeTab?.tab_type === 'elements' || activeTab?.tab_type === 'gantt' || activeTab?.tab_type === 'calendar' || activeTab?.tab_type === 'board') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center justify-center w-7 h-7 text-foreground/70 hover:text-foreground border border-border/60 hover:bg-muted rounded-md transition-colors data-[state=open]:bg-muted data-[state=open]:text-foreground"
              title="Add new"
            >
              <Plus size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Add to {object.name}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await createObjectRow({
                    name: 'New Object',
                    parent_object_id: object.id,
                    domain_id: object.domain_id ?? null,
                  });
                  await onRefresh?.();
                } catch (e) { console.error('Failed to create Object', e); }
              }}
              className="gap-2.5 items-center py-1.5 text-[13px]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-foreground/70 shrink-0">
                <ObjectIcon size={16} />
              </span>
              <span>Object</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                if (activeTab?.tab_type !== 'elements') {
                  const elementsTab = tabs.find((t) => t.tab_type === 'elements');
                  if (elementsTab) setActiveTabId(elementsTab.id);
                }
                try {
                  await createElement({
                    title: 'New Element',
                    object_id: object.id,
                  });
                  await onRefresh?.();
                } catch (e) { console.error('Failed to create Element', e); }
              }}
              className="gap-2.5 items-center py-1.5 text-[13px]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-foreground/70 shrink-0">
                <AtomIcon className="size-4" />
              </span>
              <span>Element</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}

        {/* View switcher — opens a menu to jump between views. The active
             view is highlighted so users can see what they're currently on. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center justify-center w-7 h-7 text-foreground/70 hover:text-foreground border border-border/60 hover:bg-muted rounded-md transition-colors data-[state=open]:bg-muted data-[state=open]:text-foreground"
              title="Switch view"
            >
              <LayoutGrid size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              View
            </DropdownMenuLabel>
            {([
              { type: 'overview' as const, label: 'Overview', icon: <ClipboardList size={14} strokeWidth={1.75} /> },
              { type: 'elements' as const, label: 'List', icon: <List size={14} strokeWidth={1.75} /> },
              { type: 'board' as const, label: 'Kanban', icon: <Kanban size={14} strokeWidth={1.75} /> },
              { type: 'gantt' as const, label: 'Gantt', icon: <GanttChart size={14} strokeWidth={1.75} /> },
              { type: 'summary' as const, label: 'Dashboard', icon: <BarChart3 size={14} strokeWidth={1.75} /> },
              { type: 'calendar' as const, label: 'Calendar', icon: <Calendar size={14} strokeWidth={1.75} /> },
              { type: 'workers' as const, label: 'Workers', icon: <Users size={14} strokeWidth={1.75} /> },
            ]).map((v) => {
              const existing = tabs.find((t) => t.tab_type === v.type);
              const isActive = activeTab?.tab_type === v.type;
              return (
                <DropdownMenuItem
                  key={v.type}
                  onClick={() => existing ? setActiveTabId(existing.id) : handleTabCreate(v.type, v.label)}
                  className={`gap-2.5 items-center py-1.5 text-[13px] ${isActive ? 'bg-blue-500/10 text-foreground font-medium focus:bg-blue-500/15' : ''}`}
                >
                  <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${isActive ? 'text-blue-500' : 'text-muted-foreground'}`}>
                    {v.icon}
                  </span>
                  <span>{v.label}</span>
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Elements Tab Content — flat list using the unified ObjectListView. */}
        {activeTab?.tab_type === 'elements' && (
          <div className="flex-1 overflow-hidden bg-card">
            <ObjectListView
              sections={[
                {
                  id: '_all',
                  name: object.name,
                  objects: object.children ?? [],
                  elements: object.elements ?? [],
                } satisfies ListSection,
              ]}
              onSelectObject={(id) => onNavigate({ objectId: id })}
              onSelectElement={(id) => setDetailElementId(id)}
              onAddObject={async () => {
                try {
                  await createObjectRow({
                    name: 'New Object',
                    parent_object_id: object.id,
                    domain_id: object.domain_id ?? null,
                  });
                  await onRefresh?.();
                } catch (e) { console.error('Failed to create Object', e); }
              }}
              onAddElement={async () => {
                try {
                  await createElement({
                    title: 'New Element',
                    object_id: object.id,
                  });
                  await onRefresh?.();
                } catch (e) { console.error('Failed to create Element', e); }
              }}
              hideSectionHeaders
            />
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

        {/* Workers Tab Content */}
        {activeTab?.tab_type === 'workers' && (
          <div className="flex-1 overflow-auto bg-card p-8">
            <div className="text-center text-muted-foreground">
              <p>Workers list coming soon...</p>
            </div>
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
        Elements are the smallest unit of work — tasks, records, or items you want to track.
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


