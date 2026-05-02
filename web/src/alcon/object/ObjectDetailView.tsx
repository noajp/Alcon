'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType, Worker, Section, SectionKind } from '@/hooks/useSupabase';
import {
  createElement, addElementToObject, updateElement, deleteElement, addElementAssignee,
  fetchAllWorkers, groupElementsBySection, fetchCustomColumnsWithValues,
  createCustomColumn, updateCustomColumn, deleteCustomColumn, setCustomColumnValue,
  useObjectTabs, createObjectTab, updateObjectTab, deleteObjectTab, reorderElements,
  createObject as createObjectRow, createElement as createElementRow, moveObject, deleteObject, updateObject,
  fetchSectionsForObject, createSection, updateSection, deleteSection,
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
import { SectionHeader } from '@/alcon/object/ObjectsView';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';

type SortableListeners = ReturnType<typeof useSortable>['listeners'];

// Display label for the virtual "no section" bucket — items with section_id
// = null are grouped under this heading. Section CRUD is disabled for it.
const NO_SECTION_LABEL = 'Section';
// Synthetic id used for the virtual "no section" group that holds items
// whose section_id is null. Section CRUD on this id is a no-op.
const NO_SECTION_ID = '__no_section__';

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

export function ObjectDetailView({ object, onNavigate, onRefresh, explorerData }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  // refetch may be async; allowing Promise here lets inline-add awaits the
  // refresh so the typed text stays visible until the new row appears.
  onRefresh?: () => void | Promise<void>;
  explorerData: ExplorerData;
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  // Sections live in the DB (sections table) keyed by parent object_id. Items
  // (elements / child objects) reference one of these via section_id, or null
  // for "no section". CRUD goes through the supabase hooks; UI state below
  // only handles transient input/menu state.
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  // Inline add: tracks which row is in input mode.
  // Keys: "add:section" | "add:object" | "section:<id>" | "section:__no_section__"
  const [inlineAddKey, setInlineAddKey] = useState<string | null>(null);
  const [inlineAddText, setInlineAddText] = useState('');
  // Intended kind for a section being created via the "+ Element" / "+ Object"
  // → "name new section" flow. When set, the next add:section submit creates
  // a Section row with this kind so its InlineAddRow opens locked from the
  // first keystroke.
  const [creatingSectionWithIntent, setCreatingSectionWithIntent] = useState<SectionKind | null>(null);
  // In-app section rename / delete state (replaces native window.prompt/confirm)
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingSectionId, setDeletingSectionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Element detail view state
  const [detailElementId, setDetailElementId] = useState<string | null>(null);

  // Breadcrumb right-click delete
  const [breadcrumbCtx, setBreadcrumbCtx] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch the sections for this Object whenever the Object changes. Local
  // mutations (create/rename/delete) update `sections` directly so the UI
  // doesn't have to wait for a network round-trip — onRefresh keeps the
  // parent's ExplorerData (items grouped by section_id) in sync separately.
  const reloadSections = useCallback(async () => {
    setSectionsLoading(true);
    try {
      const fresh = await fetchSectionsForObject(object.id);
      setSections(fresh);
    } catch (e) {
      console.error('Failed to load sections:', e);
    } finally {
      setSectionsLoading(false);
    }
  }, [object.id]);
  useEffect(() => { reloadSections(); }, [reloadSections]);

  // Quick lookup: section_id → Section
  const sectionById = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.id, s);
    return m;
  }, [sections]);

  const handleBreadcrumbContextMenu = (e: React.MouseEvent, seg: { id: string; name: string }) => {
    e.preventDefault();
    setBreadcrumbCtx({ id: seg.id, name: seg.name, x: e.clientX, y: e.clientY });
  };

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

  // Optimistic element order (set on drag, cleared on object change or element add/delete)
  const [optimisticElements, setOptimisticElements] = useState<ElementWithDetails[] | null>(null);
  useEffect(() => { setOptimisticElements(null); }, [object.id, object.elements?.length]);

  // Multi-select elements state (scoped to section)
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [lastSelectedElementIndex, setLastSelectedElementIndex] = useState<number | null>(null);
  const [selectionSectionIndex, setSelectionSectionIndex] = useState<number | null>(null);

  // Section collapse state (key = section name; '__no_section__' for elements without one)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Section CRUD — sections are first-class DB rows, so the handlers just
  // call the supabase hooks and reload locally. Items reference sections via
  // section_id, so renames don't require touching item rows.
  const handleRenameSection = (id: string) => {
    const s = sectionById.get(id);
    if (!s) return;
    setRenamingSectionId(id);
    setRenameDraft(s.name);
  };

  const commitRenameSection = async (id: string, newNameRaw: string) => {
    const newName = newNameRaw.trim();
    const current = sectionById.get(id);
    if (!current || !newName || newName === current.name) {
      setRenamingSectionId(null);
      setRenameDraft('');
      return;
    }
    try {
      await updateSection(id, { name: newName });
      await reloadSections();
    } catch (e) {
      console.error('Failed to rename section:', e);
    } finally {
      setRenamingSectionId(null);
      setRenameDraft('');
    }
  };

  const handleDuplicateSection = async (id: string) => {
    const src = sectionById.get(id);
    if (!src) return;
    const inSection = elements.filter((e) => e.section_id === id);
    try {
      const dup = await createSection({
        object_id: object.id,
        name: `${src.name} (copy)`,
        kind: src.kind,
      });
      await Promise.all(
        inSection.map((e) =>
          createElement({
            title: e.title,
            description: e.description,
            object_id: object.id,
            section_id: dup.id,
            status: e.status || 'todo',
            priority: e.priority || 'medium',
          }),
        ),
      );
      await reloadSections();
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate section:', e);
    }
  };

  const handleDeleteSection = (id: string) => {
    setDeletingSectionId(id);
  };

  const confirmDeleteSection = async () => {
    const id = deletingSectionId;
    if (!id) return;
    try {
      // Cascade delete: remove all items in this section, then the section row.
      await deleteSection(id, { cascade: true });
      await reloadSections();
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to delete section:', e);
    } finally {
      setDeletingSectionId(null);
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

  // Bulk action UI state (opened from the selection toolbar)
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);

  const clearSelection = React.useCallback(() => {
    setSelectedElementIds(new Set());
    setLastSelectedElementIndex(null);
    setSelectionSectionIndex(null);
  }, []);

  // Escape clears selection
  useEffect(() => {
    if (selectedElementIds.size === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedElementIds.size, clearSelection]);

  // Fetch workers lazily when the bulk Assign picker is opened
  useEffect(() => {
    if (!bulkAssignOpen || allWorkers.length > 0) return;
    fetchAllWorkers().then(setAllWorkers).catch(console.error);
  }, [bulkAssignOpen, allWorkers.length]);

  const bulkIds = React.useMemo(() => Array.from(selectedElementIds), [selectedElementIds]);

  const handleBulkDelete = async () => {
    try {
      await Promise.all(bulkIds.map((id) => deleteElement(id)));
      setBulkDeleteConfirmOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk delete:', e);
    }
  };

  const handleBulkMoveTo = async (targetObjectId: string) => {
    try {
      await Promise.all(bulkIds.map((id) => updateElement(id, { object_id: targetObjectId })));
      setBulkMoveOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk move:', e);
    }
  };

  // Multi-home: register the SAME Element in another Object (no copy).
  const handleBulkAddTo = async (targetObjectId: string) => {
    try {
      await Promise.all(bulkIds.map((id) => addElementToObject(id, targetObjectId, false)));
      setBulkAddOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk add-to-object:', e);
    }
  };

  const handleBulkAssign = async (workerId: string) => {
    try {
      await Promise.all(
        bulkIds.map((id) => addElementAssignee({ element_id: id, worker_id: workerId, role: 'assignee' }))
      );
      setBulkAssignOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk assign:', e);
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

  // Default to List (elements) tab on Object change or first tab load.
  // Don't reset on every `tabs` change — that would clobber view switches
  // triggered by the LayoutGrid dropdown when a new tab is created.
  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTabId(null);
      return;
    }
    setActiveTabId((prev) => {
      if (prev && tabs.some((t) => t.id === prev)) return prev;
      const elementsTab = tabs.find((t) => t.tab_type === 'elements');
      return (elementsTab ?? tabs[0]).id;
    });
  }, [object.id, tabs]);

  const activeTab = tabs.find(t => t.id === activeTabId);

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
  const allElements = optimisticElements ?? (object.elements || []);
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
  const elementsBySection = groupElementsBySection(elements);

  // Objects grouped by section_id — mirrors elementsBySection so we can
  // render child Objects under the same section headers as Elements.
  const objectsBySection = useMemo(() => {
    const grouped = new Map<string | null, AlconObjectWithChildren[]>();
    for (const child of object.children ?? []) {
      const sid = child.section_id ?? null;
      if (!grouped.has(sid)) grouped.set(sid, []);
      grouped.get(sid)!.push(child);
    }
    return grouped;
  }, [object.children]);

  // Unified, ordered section list (section_id keyed).
  // - Real DB sections come from `sections` (already sorted by order_index).
  // - If there are items with section_id=null, append a synthetic "no section"
  //   bucket so they still render under a header.
  const allSectionIds = useMemo(() => {
    const ids: string[] = sections.map((s) => s.id);
    const hasNullObjects = (objectsBySection.get(null)?.length ?? 0) > 0;
    const hasNullElements = elementsBySection.some((g) => g.section_id === null && g.elements.length > 0);
    if (hasNullObjects || hasNullElements) ids.push(NO_SECTION_ID);
    return ids;
  }, [sections, objectsBySection, elementsBySection]);

  // Get the kind a section is locked to. Real sections have an explicit
  // `kind` column on the row; the synthetic NO_SECTION bucket and rows with
  // null `kind` are unlocked (mixed/undecided).
  const sectionLockedType = (id: string): SectionKind | undefined => {
    if (id === NO_SECTION_ID) return undefined;
    return sectionById.get(id)?.kind ?? undefined;
  };

  // Find a real section that can host an item of the given kind. Returns
  // null when no real section qualifies — caller should prompt for a new
  // section name in that case.
  const findFriendlySection = useCallback((kind: SectionKind): Section | null => {
    // Prefer sections explicitly typed for this kind
    const explicit = sections.find((s) => s.kind === kind);
    if (explicit) return explicit;
    // Then any section with no kind constraint that happens to have items
    // of the matching kind already (won't conflict with the kind lock UI)
    const mixed = sections.find((s) => s.kind == null);
    if (mixed) return mixed;
    return null;
  }, [sections]);

  // DnD sensors for element row reorder
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Per-section drag handler — reorders only within the dragged row's section.
  // Section elements occupy specific slots in the global array; we preserve those
  // slots and just permute the section elements in place.
  const handleSectionDragEnd = async (event: DragEndEvent, sectionElements: ElementWithDetails[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = sectionElements.findIndex(e => e.id === active.id);
    const newIdx = sectionElements.findIndex(e => e.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reorderedSection = arrayMove(sectionElements, oldIdx, newIdx);
    const sectionIds = new Set(sectionElements.map(e => e.id));

    const base = optimisticElements ?? (object.elements || []);
    const sectionGlobalPositions: number[] = [];
    base.forEach((e, i) => { if (sectionIds.has(e.id)) sectionGlobalPositions.push(i); });

    const newBase = [...base];
    reorderedSection.forEach((e, i) => {
      newBase[sectionGlobalPositions[i]] = e;
    });

    setOptimisticElements(newBase);  // Immediate UI update

    const updates = newBase.map((e, idx) => ({ id: e.id, order_index: idx }));

    try {
      await reorderElements(updates);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reorder elements:', err);
      setOptimisticElements(null);  // Revert on error
    }
  };

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

  // Parse bulk paste — each non-empty line becomes one item title. Bullet
  // markers ("- ", "* ", "• ", "[ ]", "[x]") are stripped. The section is
  // determined by the row that owns the InlineAddRow (caller passes section_id).
  const parseBulkInput = (raw: string): string[] => {
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const items: string[] = [];
    for (const line of lines) {
      const cleaned = line
        .replace(/^[-*•]\s+/, '')
        .replace(/^\[\s*[xX ]?\s*\]\s+/, '')
        .trim();
      if (cleaned) items.push(cleaned);
    }
    return items;
  };

  // Inline add submission — Elements only. Objects are added via the Add dropdown.
  // Parallel inserts, single refresh at the end.
  const handleInlineAddSubmit = async (key: string, raw: string) => {
    if (!raw.trim() || !key.startsWith('section:')) return;

    try {
      const sectionId = key.slice('section:'.length);
      const targetSectionId = sectionId === NO_SECTION_ID ? null : sectionId;
      const titles = parseBulkInput(raw);

      // Fetch max order_index once to avoid race condition on parallel inserts
      const { data: existing } = await supabase
        .from('elements')
        .select('order_index')
        .eq('object_id', object.id)
        .order('order_index', { ascending: false })
        .limit(1);
      const baseOrder = (existing?.[0]?.order_index ?? -1) + 1;

      await Promise.all(
        titles.map((title, idx) =>
          createElement({
            title,
            object_id: object.id,
            section_id: targetSectionId,
            status: 'todo',
            priority: 'medium',
            order_index: baseOrder + idx,
          })
        )
      );
      // Await the refresh so callers (InlineAddRow) only resolve once the new
      // rows are actually in `object.elements` — without this, the input
      // would clear before the list re-renders, causing a brief flash.
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to inline-add:', e);
    }
  };

  // Legacy: handleAddSubObject still used by Object tree contextual creation
  const handleAddSubObject = async () => {
    setIsLoading(true);
    try {
      await createObjectRow({
        name: 'New Object',
        parent_object_id: object.id,
        domain_id: object.domain_id ?? null,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create sub-object:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Top-level "+ Object" submit — picks the friendly section as target.
  const handleInlineObjectSubmit = async (name: string) => {
    if (!name.trim()) return;
    try {
      const target = findFriendlySection('object');
      await createObjectRow({
        name: name.trim(),
        parent_object_id: object.id,
        domain_id: object.domain_id ?? null,
        section_id: target?.id ?? null,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create object:', e);
    } finally {
      setInlineAddKey(null);
      setInlineAddText('');
    }
  };

  // Inline-add an Object directly into a specific section (used by the
  // per-section InlineAddRow when the user toggles its type selector to Object).
  const handleInlineAddObjectInSection = async (sectionId: string, name: string) => {
    if (!name.trim()) return;
    try {
      await createObjectRow({
        name: name.trim(),
        parent_object_id: object.id,
        domain_id: object.domain_id ?? null,
        section_id: sectionId === NO_SECTION_ID ? null : sectionId,
      });
      // Await the refresh so the InlineAddRow's submit promise only resolves
      // once the new Object actually appears in the list.
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to inline-add object:', e);
    }
  };

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
      {/* Breadcrumb + Tab Bar + Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
          {/* Breadcrumb path — parents only; the current Object becomes a title row below */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-1 min-h-[28px]">
            {objectPath.slice(0, -1).map((seg, i) => (
              <div key={seg.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />}
                <button
                  onClick={() => onNavigate({ objectId: seg.id })}
                  onContextMenu={(e) => handleBreadcrumbContextMenu(e, seg)}
                  className="flex items-center gap-1 text-[13px] truncate max-w-[200px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ObjectIcon size={12} />
                  <span className="truncate">{seg.name}</span>
                </button>
              </div>
            ))}
          </div>
          {/* Current Object — title row */}
          <div
            className="flex items-center gap-3 px-4 pb-3 min-w-0"
            onContextMenu={(e) => handleBreadcrumbContextMenu(e, { id: object.id, name: object.name })}
          >
            <span className="text-foreground/80 shrink-0"><ObjectIcon size={22} /></span>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight truncate">
              {object.name}
            </h1>
            <span
              className="font-mono text-[11px] px-2 py-0.5 bg-muted rounded text-muted-foreground/80 cursor-pointer hover:bg-muted/80 transition-colors shrink-0"
              title="Click to copy Object ID"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(object.display_id ?? `obj-${object.id.slice(0, 8)}`);
              }}
            >
              {object.display_id ?? `obj-${object.id.slice(0, 8)}`}
            </span>
          </div>
          {/* Tab Bar hidden — view switching now happens via the LayoutGrid
              dropdown in the action bar below. Tabs are still kept in state so
              per-view configuration (gantt range, calendar mode, etc.) survives
              view switches. Default active tab is the Elements (List) tab. */}

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
              onClick={() => {
                // If no existing section can host an Object (e.g. all sections
                // are Element-locked), prompt the user for a new section name
                // first — then drop into Object-add mode in that new section.
                const friendly = findFriendlySection('object');
                if (!friendly) {
                  setCreatingSectionWithIntent('object');
                  setInlineAddKey('add:section');
                  setInlineAddText('');
                  return;
                }
                setInlineAddKey('add:object');
                setInlineAddText('');
              }}
              className="gap-2.5 items-center py-1.5 text-[13px]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-foreground/70 shrink-0">
                <ObjectIcon size={16} />
              </span>
              <span>Object</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (activeTab?.tab_type !== 'elements') {
                  const elementsTab = tabs.find((t) => t.tab_type === 'elements');
                  if (elementsTab) setActiveTabId(elementsTab.id);
                }
                // No existing Element-friendly section → prompt for a new
                // section name first. Once named, the InlineAddRow under it
                // opens locked to 'element' so the user can type the Element
                // name immediately.
                const friendly = findFriendlySection('element');
                if (!friendly) {
                  setCreatingSectionWithIntent('element');
                  setInlineAddKey('add:section');
                  setInlineAddText('');
                  return;
                }
                setInlineAddKey(`section:${friendly.id}`);
                setInlineAddText('');
              }}
              className="gap-2.5 items-center py-1.5 text-[13px]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-foreground/70 shrink-0">
                <AtomIcon className="size-4" />
              </span>
              <span>Element</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (activeTab?.tab_type !== 'elements') {
                  const elementsTab = tabs.find((t) => t.tab_type === 'elements');
                  if (elementsTab) setActiveTabId(elementsTab.id);
                }
                // Plain "+ Section" — no kind intent. Clear any stale intent
                // left over from a previous "+ Element"/"+ Object" cancel.
                setCreatingSectionWithIntent(null);
                setInlineAddKey('add:section');
                setInlineAddText('');
              }}
              className="gap-2.5 items-center py-1.5 text-[13px]"
            >
              <span className="w-5 h-5 flex items-center justify-center text-foreground/70 shrink-0">
                <Heading size={15} strokeWidth={1.75} />
              </span>
              <span>Section</span>
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
        {/* Elements Tab Content */}
        {activeTab?.tab_type === 'elements' && (
          <>
          <div className="flex-1 flex flex-col relative">
            {/* Floating bulk-action island — shown when rows are multi-selected */}
            <AnimatePresence>
              {selectedElementIds.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                  className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-3 py-2 rounded-2xl shadow-xl border border-border/60 bg-popover/95 backdrop-blur-md whitespace-nowrap"
                >
                  <span className="text-[12px] font-semibold tabular-nums text-foreground pr-2 border-r border-border/60 mr-1">
                    {selectedElementIds.size} selected
                  </span>
                  <DropdownMenu open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-xl hover:bg-muted transition-colors"
                        title="Assign a worker to selected elements"
                      >
                        <Users size={13} />
                        Assign
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" side="top" className="min-w-[200px] max-h-72 overflow-y-auto mb-1">
                      <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Add assignee to {selectedElementIds.size}
                      </DropdownMenuLabel>
                      {allWorkers.length === 0 ? (
                        <DropdownMenuItem disabled className="text-[12px] text-muted-foreground">
                          Loading workers…
                        </DropdownMenuItem>
                      ) : (
                        allWorkers.map((w) => (
                          <DropdownMenuItem
                            key={w.id}
                            onClick={() => handleBulkAssign(w.id)}
                            className="text-[12px]"
                          >
                            {w.name}
                            <span className="ml-auto text-[10px] text-muted-foreground capitalize">{w.type}</span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    onClick={() => setBulkAddOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-xl hover:bg-muted transition-colors whitespace-nowrap"
                    title="Multi-home selected elements in another Object (same Elements, new parent)"
                  >
                    <Link2 size={13} />
                    Add to…
                  </button>
                  <button
                    onClick={() => setBulkMoveOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-xl hover:bg-muted transition-colors whitespace-nowrap"
                    title="Move selected elements to another primary Object"
                  >
                    <ArrowRight size={13} />
                    Move to…
                  </button>
                  <div className="w-px h-4 bg-border/60 mx-1" />
                  <button
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-500 hover:text-red-400 px-2.5 py-1.5 rounded-xl hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                  <div className="w-px h-4 bg-border/60 mx-1" />
                  <button
                    onClick={clearSelection}
                    className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear selection (Esc)"
                  >
                    <X size={13} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main scrollable content */}
            <div className="flex-1 overflow-auto">
        <div className="px-5 pt-8 pb-12">

        {/* Inline Object add row is now rendered inside the section loop
             (at the top of objectAddTargetSection) so it shares the table
             layout with existing rows. */}

        {/* Elements by Section — driven entirely by the DB-backed `sections`
             list. Items with section_id=null fall into a synthetic
             "no section" bucket so they still render with a header. */}
        {(
          <div className="overflow-x-auto">
            <table className="w-full min-w-max bg-card border-collapse">
              {/* Column Headers - Asana style sticky header */}
              <thead className="sticky top-0 z-20 bg-card">
                <tr>
                  <th className="w-8 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card"></th>
                  <th className="w-7 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card"></th>
                  <th
                    className={`md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has('0-0') ? 'bg-muted/60' : 'bg-card'}`}
                    onClick={(e) => handleColumnHeaderClick(0, 0, e)}
                  >
                    Name
                  </th>
                  {/* Built-in Columns - hidden on small screens */}
                  {builtInColumns.filter(col => col.isVisible).map((col, idx) => {
                    const colIndex = idx + 1;
                    return (
                      <th
                        key={col.id}
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-muted/60' : 'bg-card'}`}
                        style={{ width: col.width }}
                        onClick={(e) => handleColumnHeaderClick(0, colIndex, e)}
                      >
                        <BuiltInColumnHeader
                          column={col}
                          onUpdate={(updates) => handleUpdateBuiltInColumn(col.id, updates)}
                          onDelete={() => handleDeleteBuiltInColumn(col.id)}
                        />
                      </th>
                    );
                  })}
                  {/* Custom Columns - hidden on small screens */}
                  {customColumns.map((col, idx) => {
                    const colIndex = builtInColumns.filter(c => c.isVisible).length + 1 + idx;
                    return (
                      <th
                        key={col.id}
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-muted/60' : 'bg-card'}`}
                        style={{ width: col.width || 120 }}
                        onClick={(e) => handleColumnHeaderClick(0, colIndex, e)}
                      >
                        <ColumnHeader
                          column={col}
                          onRename={(name) => handleRenameColumn(col.id, name)}
                          onDelete={() => handleDeleteColumn(col.id)}
                          onUpdate={(updates) => handleUpdateColumn(col.id, updates)}
                          onDuplicate={() => handleDuplicateColumn(col)}
                        />
                      </th>
                    );
                  })}
                  {/* Rightmost action column — Add column (desktop) */}
                  <th className="w-10 px-1 py-2.5 text-center bg-card">
                    <button
                      onClick={() => setShowAddColumnModal(true)}
                      className="hidden md:inline-flex w-6 h-6 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      title="Add column"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let globalRowIndex = 0;
                  return allSectionIds.map((sectionKey, sectionIndex) => {
                    const isCollapsed = collapsedSections.has(sectionKey);
                    const isVirtualNoSection = sectionKey === NO_SECTION_ID;
                    const sectionRow = isVirtualNoSection ? null : sectionById.get(sectionKey);
                    const sectionName = isVirtualNoSection
                      ? NO_SECTION_LABEL
                      : (sectionRow?.name ?? '');
                    // Look up items for this bucket. The synthetic NO_SECTION
                    // bucket holds items with section_id === null.
                    const lookupKey: string | null = isVirtualNoSection ? null : sectionKey;
                    const objsInSection = objectsBySection.get(lookupKey) ?? [];
                    const sectionElements = elementsBySection.find((g) => g.section_id === lookupKey)?.elements ?? [];

                    return (
                      <React.Fragment key={sectionKey}>
                        {/* Section Header Row — "..." menu handles rename / duplicate / delete.
                             Layout mirrors the Element/Object row name cell so the chevron + name
                             column-align with the rows below. First section has no top padding so
                             it sits flush under the column header. */}
                        <tr className="group">
                            <td className={`w-8 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}></td>
                            <td className={`w-7 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}></td>
                            <td colSpan={totalColumns - 2} className={`pb-1.5 pl-1 pr-2 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}>
                              <div className="flex items-center gap-1.5 min-w-0">
                                {/* Subelement-expand gutter (matches Element/Object rows) */}
                                <div className="w-3 shrink-0" />
                                <button
                                  type="button"
                                  onClick={() => toggleSectionCollapse(sectionKey)}
                                  className="size-3.5 shrink-0 flex items-center justify-center rounded hover:bg-muted transition-colors"
                                  aria-label={isCollapsed ? 'セクションを展開' : 'セクションを折りたたむ'}
                                >
                                  <ChevronDown
                                    size={12}
                                    className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                                  />
                                </button>
                                {renamingSectionId === sectionKey && !isVirtualNoSection ? (
                                  <input
                                    autoFocus
                                    value={renameDraft}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    onBlur={() => commitRenameSection(sectionKey, renameDraft)}
                                    onKeyDown={(e) => {
                                      if (e.nativeEvent.isComposing) return;
                                      if (e.key === 'Enter') { e.preventDefault(); commitRenameSection(sectionKey, renameDraft); }
                                      if (e.key === 'Escape') { e.preventDefault(); setRenamingSectionId(null); setRenameDraft(''); }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-base font-bold bg-transparent outline-none border-b border-foreground/30 focus:border-foreground/60 text-foreground placeholder:text-muted-foreground/40 min-w-0 max-w-full transition-colors"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => toggleSectionCollapse(sectionKey)}
                                    className="text-base font-bold text-foreground hover:bg-muted/40 -mx-1 px-1 py-0.5 rounded transition-colors min-w-0 truncate text-left"
                                  >
                                    {sectionName}
                                    <span className="ml-1.5 text-muted-foreground/60 font-normal text-sm tabular-nums">
                                      {objsInSection.length + sectionElements.length}
                                    </span>
                                  </button>
                                )}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-opacity shrink-0"
                                      aria-label="セクション操作"
                                    >
                                      <MoreHorizontal size={12} />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="min-w-[180px]">
                                    <DropdownMenuItem
                                      onClick={() => handleRenameSection(sectionKey)}
                                      disabled={isVirtualNoSection}
                                      className="gap-2 text-[13px]"
                                    >
                                      <Pencil size={12} />
                                      セクション名を変更
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDuplicateSection(sectionKey)}
                                      disabled={isVirtualNoSection}
                                      className="gap-2 text-[13px]"
                                    >
                                      <Copy size={12} />
                                      セクションを複製
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteSection(sectionKey)}
                                      disabled={isVirtualNoSection}
                                      className="gap-2 text-[13px] text-destructive focus:text-destructive"
                                    >
                                      <Trash2 size={12} />
                                      セクションを削除
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </td>
                          </tr>

                        {/* Inline Object name input — renders at the top of the
                             friendly Object section so new Objects appear above
                             existing rows in their section, sharing the column
                             layout. */}
                        {!isCollapsed && inlineAddKey === 'add:object' && (() => {
                          const friendly = findFriendlySection('object');
                          return friendly && friendly.id === sectionKey;
                        })() && (
                          <InlineAddRow
                            active={true}
                            text={inlineAddText}
                            setText={setInlineAddText}
                            onActivate={() => {}}
                            onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                            onSubmit={handleInlineObjectSubmit}
                            placeholder="Object name..."
                            colSpan={totalColumns}
                            isLoading={isLoading}
                          />
                        )}

                        {/* Object rows in this section — render before Elements so child
                             Objects always sit at the top of their section. */}
                        {!isCollapsed && objsInSection.map((childObj) => (
                          <tr
                            key={`child-obj-${childObj.id}`}
                            className="group hover:bg-muted/30 transition-colors cursor-pointer tracking-[-0.3px] leading-[1.4]"
                            onClick={() => onNavigate({ objectId: childObj.id })}
                          >
                            {/* Drag handle gutter — placeholder dots */}
                            <td className="w-8 px-1 py-2">
                              <div className="flex items-center justify-center text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                                <GripVertical size={12} />
                              </div>
                            </td>
                            {/* Checkbox gutter — placeholder square */}
                            <td className="w-7 px-1 py-2">
                              <div className="flex items-center justify-center">
                                <div className="w-4 h-4 rounded-[2px] border border-muted-foreground/15 group-hover:border-muted-foreground/30 transition-colors" />
                              </div>
                            </td>
                            {/* Name cell — min-h matches Element row's effective
                                 height (driven by the Assignees cell's py-2.5 button)
                                 so Object and Element rows have equal vertical rhythm. */}
                            <td className="pl-1 pr-2 py-2 min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                                <div className="w-3 shrink-0" />
                                <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70">
                                  <ObjectIcon size={14} />
                                </span>
                                <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">
                                  {childObj.name}
                                </span>
                              </div>
                            </td>
                            {/* Built-in column placeholders — Object doesn't carry these */}
                            {builtInColumns.filter(col => col.isVisible).map((col) => (
                              <td key={`obj-builtin-${childObj.id}-${col.id}`} className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                            ))}
                            {/* Custom column placeholders */}
                            {customColumns.map((col) => (
                              <td key={`obj-custom-${childObj.id}-${col.id}`} className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                            ))}
                            {/* Right-most action gutter */}
                            <td className="w-10 px-1 py-2"></td>
                          </tr>
                        ))}

                        {/* Element Rows */}
                        {!isCollapsed && sectionElements.length > 0 && (
                          <DndContext
                            sensors={dndSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => handleSectionDragEnd(event, sectionElements)}
                          >
                            <SortableContext
                              items={sectionElements.map(e => e.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {sectionElements.map((element, index) => {
                                const localIndex = index;
                                const currentGlobalRowIndex = globalRowIndex++;
                                return (
                                  <ElementTableRow
                                    key={element.id}
                                    element={element}
                                    rowNumber={index + 1}
                                    rowIndex={currentGlobalRowIndex}
                                    isSelected={currentSelectedElement?.id === element.id}
                                    isMultiSelected={selectedElementIds.has(element.id)}
                                    onSelect={(event) => {
                                      if (event?.shiftKey) {
                                        if (lastSelectedElementIndex !== null && selectionSectionIndex === sectionIndex) {
                                          const start = Math.min(lastSelectedElementIndex, localIndex);
                                          const end = Math.max(lastSelectedElementIndex, localIndex);
                                          const newSelection = new Set<string>();
                                          for (let i = start; i <= end; i++) {
                                            if (sectionElements[i]) newSelection.add(sectionElements[i].id);
                                          }
                                          setSelectedElementIds(newSelection);
                                        } else {
                                          setSelectedElementIds(new Set([element.id]));
                                          setLastSelectedElementIndex(localIndex);
                                          setSelectionSectionIndex(sectionIndex);
                                        }
                                      } else if (event?.ctrlKey || event?.metaKey) {
                                        if (selectionSectionIndex === null || selectionSectionIndex === sectionIndex) {
                                          const newSelection = new Set(selectedElementIds);
                                          if (newSelection.has(element.id)) {
                                            newSelection.delete(element.id);
                                          } else {
                                            newSelection.add(element.id);
                                          }
                                          setSelectedElementIds(newSelection);
                                          setLastSelectedElementIndex(localIndex);
                                          setSelectionSectionIndex(sectionIndex);
                                        } else {
                                          setSelectedElementIds(new Set([element.id]));
                                          setLastSelectedElementIndex(localIndex);
                                          setSelectionSectionIndex(sectionIndex);
                                        }
                                      } else {
                                        setSelectedElementIds(new Set());
                                        setSelectedCells(new Set());
                                        setLastSelectedElementIndex(localIndex);
                                        setSelectionSectionIndex(sectionIndex);
                                        setDetailElementId(element.id);
                                      }
                                    }}
                                    onStatusChange={(status) => handleStatusChange(element.id, status)}
                                    onRefresh={onRefresh}
                                    allElements={elements}
                                    customColumns={customColumns}
                                    onColumnValueChange={handleColumnValueChange}
                                    totalColumns={totalColumns}
                                    builtInColumns={builtInColumns}
                                    selectedCells={selectedCells}
                                    onCellMouseDown={handleCellMouseDown}
                                    onCellMouseEnter={handleCellMouseEnter}
                                    explorerData={explorerData}
                                  />
                                );
                              })}
                            </SortableContext>
                          </DndContext>
                        )}

                        {/* Inline-add row scoped to this section. Type selector
                             (atom / cube icon) lets the user choose Element vs
                             Object before submitting — unless the section is
                             already locked to a single kind (Objects-only or
                             Elements-only), in which case the @-menu is hidden
                             and the row enforces the locked kind. */}
                        {!isCollapsed && (() => {
                          const locked = sectionLockedType(sectionKey);
                          const placeholder =
                            locked === 'object' ? 'Add Object'
                            : locked === 'element' ? 'Add Element'
                            : 'Add @';
                          return (
                            <InlineAddRow
                              active={inlineAddKey === `section:${sectionKey}`}
                              text={inlineAddText}
                              setText={setInlineAddText}
                              onActivate={() => {
                                setInlineAddKey(`section:${sectionKey}`);
                                setInlineAddText('');
                              }}
                              onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                              onSubmit={(t) => handleInlineAddSubmit(`section:${sectionKey}`, t)}
                              onSubmitObject={(name) => handleInlineAddObjectInSection(sectionKey, name)}
                              placeholder={placeholder}
                              colSpan={totalColumns}
                              isLoading={isLoading}
                              lockedType={locked}
                            />
                          );
                        })()}
                      </React.Fragment>
                    );
                  });
                })()}

                {/* Inline section name input row — layout matches the section
                     header above so the > chevron and input align with item names.
                     On Enter, creates a new section in the DB (with the
                     pending intent's kind, if set) and immediately switches
                     into add-mode for that section. */}
                {inlineAddKey === 'add:section' && (
                  <React.Fragment>
                    <tr>
                      <td className="w-8 px-1"></td>
                      <td className="w-7 px-1"></td>
                      <td colSpan={totalColumns - 2} className="pt-4 pb-1.5 pl-1 pr-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-3 shrink-0" />
                          <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground">
                            <ChevronRight size={12} />
                          </span>
                          <input
                            autoFocus
                            className="text-base font-bold bg-transparent outline-none border-b border-foreground/30 focus:border-foreground/60 text-foreground placeholder:text-muted-foreground/40 w-64 transition-colors"
                            placeholder={
                              creatingSectionWithIntent === 'element' ? 'New section for Elements'
                              : creatingSectionWithIntent === 'object' ? 'New section for Objects'
                              : 'Section name'
                            }
                            value={inlineAddText}
                            onChange={(e) => setInlineAddText(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.nativeEvent.isComposing) return;
                              if (e.key === 'Enter' && inlineAddText.trim()) {
                                e.preventDefault();
                                const name = inlineAddText.trim();
                                const intent = creatingSectionWithIntent;
                                try {
                                  const created = await createSection({
                                    object_id: object.id,
                                    name,
                                    kind: intent,
                                  });
                                  await reloadSections();
                                  setInlineAddKey(`section:${created.id}`);
                                } catch (err) {
                                  console.error('Failed to create section:', err);
                                  setInlineAddKey(null);
                                }
                                setInlineAddText('');
                                setCreatingSectionWithIntent(null);
                              }
                              if (e.key === 'Escape') {
                                setInlineAddKey(null);
                                setInlineAddText('');
                                setCreatingSectionWithIntent(null);
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                    {/* Preview row — shows what the new section will host.
                         Visible only when "+ Element" / "+ Object" launched the
                         add:section flow. After Enter, this disappears as the
                         real section + InlineAddRow take over. */}
                    {creatingSectionWithIntent && (
                      <tr>
                        <td className="w-8 px-1 py-2"></td>
                        <td className="w-7 px-1 py-2"></td>
                        <td colSpan={totalColumns - 2} className="pl-1 pr-2 py-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-3 shrink-0" />
                            <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/40">
                              {creatingSectionWithIntent === 'object'
                                ? <ObjectIcon size={13} />
                                : <AtomIcon className="size-3.5" />}
                            </span>
                            <span className="text-[13px] font-medium text-muted-foreground/40">
                              {creatingSectionWithIntent === 'object' ? 'Add Object' : 'Add Element'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )}
              </tbody>
            </table>
          </div>
        )}
        </div>
            </div>
          </div>

          </>
        )}

        {/* Overview Tab Content — Project Overview (Asana-style) */}
        {activeTab?.tab_type === 'overview' && (
          <div className="flex-1 overflow-auto bg-card">
            <OverviewView
              elements={allDescendantElements}
              object={object}
              explorerData={explorerData}
              onRefresh={onRefresh}
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

      {/* Section Delete Confirmation Dialog */}
      <Dialog open={deletingSectionId !== null} onOpenChange={(open) => { if (!open) setDeletingSectionId(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogTitle>セクションを削除</DialogTitle>
          {deletingSectionId && (() => {
            const target = sectionById.get(deletingSectionId);
            const elCount = elements.filter((e) => e.section_id === deletingSectionId).length;
            const objCount = (object.children ?? []).filter((c) => c.section_id === deletingSectionId).length;
            return (
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                セクション <span className="text-foreground font-medium">"{target?.name ?? ''}"</span> の
                Element {elCount}件 / Object {objCount}件をすべて削除します。
                <br />
                この操作は取り消せません。
              </p>
            );
          })()}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeletingSectionId(null)}
              className="px-3 py-1.5 text-[13px] text-foreground hover:bg-muted rounded-md transition-colors"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={confirmDeleteSection}
              className="px-3 py-1.5 text-[13px] text-destructive-foreground bg-destructive hover:bg-destructive/90 rounded-md transition-colors"
            >
              削除
            </button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Bulk Move — change primary Object for all selected */}
      {bulkMoveOpen && (
        <ObjectPicker
          open={bulkMoveOpen}
          onClose={() => setBulkMoveOpen(false)}
          onSelect={handleBulkMoveTo}
          title={`Move ${selectedElementIds.size} element${selectedElementIds.size === 1 ? '' : 's'}`}
          description="Choose the new primary Object. Each element's primary parent will be replaced."
          excludeIds={[object.id]}
          explorerData={explorerData}
        />
      )}

      {/* Bulk Multi-Home — register the same Elements in another Object */}
      {bulkAddOpen && (
        <ObjectPicker
          open={bulkAddOpen}
          onClose={() => setBulkAddOpen(false)}
          onSelect={handleBulkAddTo}
          title={`Add ${selectedElementIds.size} element${selectedElementIds.size === 1 ? '' : 's'} to…`}
          description="The same Elements will also belong to the chosen Object. No copies are created; edits stay synchronized."
          excludeIds={[object.id]}
          explorerData={explorerData}
        />
      )}

      {/* Bulk Delete confirmation */}
      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[360px] p-6" showCloseButton={false}>
          <div className="text-center">
            <DialogTitle className="text-[15px] font-semibold mb-1">
              Delete {selectedElementIds.size} element{selectedElementIds.size === 1 ? '' : 's'}?
            </DialogTitle>
            <p className="text-[13px] text-muted-foreground mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleBulkDelete}
                className="w-full bg-destructive hover:bg-destructive/90 text-white"
              >
                Delete
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkDeleteConfirmOpen(false)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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


