'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType, Worker } from '@/hooks/useSupabase';
import {
  createElement, addElementToObject, updateElement, deleteElement, addElementAssignee,
  fetchAllWorkers, groupElementsBySection, fetchCustomColumnsWithValues,
  createCustomColumn, updateCustomColumn, deleteCustomColumn, setCustomColumnValue,
  useObjectTabs, createObjectTab, updateObjectTab, deleteObjectTab, reorderElements,
  createObject as createObjectRow, createElement as createElementRow, moveObject,
} from '@/hooks/useSupabase';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ObjectTabType, Json } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import { ObjectIcon } from '@/components/icons';
import { TabBar } from '@/components/layout/TabBar';
import { CalendarView } from '@/views/calendar/CalendarView';
import { SummaryView } from '@/views/summary/SummaryView';
import { OverviewView } from '@/views/overview/OverviewView';
import { GanttView } from '@/views/gantt';
import { ElementBoardView } from '@/views/board/ElementBoardView';
import { ReportPreview } from '@/views/documents/ReportPreview';
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
import { ChildObjectsTable, collectAllObjects } from '@/alcon/object/ObjectsView';
import { SectionHeader } from '@/alcon/object/ObjectsView';

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

export function ObjectDetailView({ object, onNavigate, onRefresh, explorerData }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  explorerData: ExplorerData;
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isAddingElement, setIsAddingElement] = useState(false);
  const [addMode, setAddMode] = useState<'element' | 'object'>('element');
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState('');
  // Inline add: tracks which row is in input mode.
  // Keys: "add:section" | "add:object" | "section:NAME" | "section:__no_section__"
  const [inlineAddKey, setInlineAddKey] = useState<string | null>(null);
  const [inlineAddText, setInlineAddText] = useState('');
  // Sections that have been named inline but have no elements yet
  const [pendingSections, setPendingSections] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Element detail view state
  const [detailElementId, setDetailElementId] = useState<string | null>(null);

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

  // Section CRUD — sections live as a string column on Element rows, so each
  // operation fans out to the matching elements.
  const handleRenameSection = async (oldName: string) => {
    const newName = window.prompt('セクション名を変更', oldName);
    if (!newName || !newName.trim() || newName === oldName) return;
    const trimmed = newName.trim();
    const inSection = elements.filter((e) => e.section === oldName);
    try {
      await Promise.all(inSection.map((e) => updateElement(e.id, { section: trimmed })));
      onRefresh?.();
    } catch (e) {
      console.error('Failed to rename section:', e);
    }
  };

  const handleDuplicateSection = async (name: string) => {
    const newName = `${name} (copy)`;
    const inSection = elements.filter((e) => e.section === name);
    try {
      await Promise.all(
        inSection.map((e) =>
          createElement({
            title: e.title,
            description: e.description,
            object_id: object.id,
            section: newName,
            status: e.status || 'todo',
            priority: e.priority || 'medium',
          }),
        ),
      );
      onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate section:', e);
    }
  };

  const handleDeleteSection = async (name: string) => {
    const inSection = elements.filter((e) => e.section === name);
    if (inSection.length === 0) return;
    if (!window.confirm(`セクション "${name}" の Element ${inSection.length}件をすべて削除します。よろしいですか?`)) return;
    try {
      await Promise.all(inSection.map((e) => deleteElement(e.id)));
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete section:', e);
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

  // Get unique sections for dropdown
  const existingSections = [...new Set(elements.map(e => e.section).filter(Boolean))] as string[];

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

  // Parse bulk text input (Asana-style)
  // - Each non-empty line = one item
  // - Lines starting with "# " or "## " = section header for following items
  // - Strip leading bullet markers: "- ", "* ", "• ", "[ ] ", "[x] "
  const parseBulkInput = (raw: string, defaultSection: string | null) => {
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    let currentSection = defaultSection;
    const items: { title: string; section: string | null }[] = [];
    for (const line of lines) {
      if (/^#+\s+/.test(line)) {
        currentSection = line.replace(/^#+\s+/, '').trim();
        continue;
      }
      const cleaned = line
        .replace(/^[-*•]\s+/, '')
        .replace(/^\[\s*[xX ]?\s*\]\s+/, '')
        .trim();
      if (cleaned) items.push({ title: cleaned, section: currentSection });
    }
    return items;
  };

  // Compute parsed items for live preview
  const parsedAddItems = useMemo(
    () => parseBulkInput(newTitle, newSection.trim() || null),
    [newTitle, newSection]
  );

  const handleAddElement = async () => {
    const items = parsedAddItems;
    if (items.length === 0) return;

    setIsLoading(true);
    try {
      for (const item of items) {
        await createElement({
          title: item.title,
          object_id: object.id,
          section: item.section,
          status: 'todo',
          priority: 'medium',
        });
      }
      setNewTitle('');
      setNewSection('');
      setIsAddingElement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create element(s):', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddObjectsBulk = async () => {
    const items = parsedAddItems;
    if (items.length === 0) return;

    setIsLoading(true);
    try {
      for (const item of items) {
        await createObjectRow({
          name: item.title,
          parent_object_id: object.id,
        });
      }
      setNewTitle('');
      setNewSection('');
      setIsAddingElement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create object(s):', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Single-step open of bulk form
  const handleOpenAddForm = (mode: 'element' | 'object') => {
    setAddMode(mode);
    setNewTitle('');
    setNewSection('');
    setIsAddingElement(true);
  };

  // Inline add submission — Elements only. Objects are added via the Add dropdown.
  // Parallel inserts, single refresh at the end.
  const handleInlineAddSubmit = async (key: string, raw: string) => {
    if (!raw.trim() || !key.startsWith('section:')) return;

    try {
      const sectionName = key.slice('section:'.length);
      const defaultSection = sectionName === '__no_section__' ? null : sectionName;
      const items = parseBulkInput(raw, defaultSection);

      // Fetch max order_index once to avoid race condition on parallel inserts
      const { data: existing } = await supabase
        .from('elements')
        .select('order_index')
        .eq('object_id', object.id)
        .order('order_index', { ascending: false })
        .limit(1);
      const baseOrder = (existing?.[0]?.order_index ?? -1) + 1;

      await Promise.all(
        items.map((item, idx) =>
          createElement({
            title: item.title,
            object_id: object.id,
            section: item.section,
            status: 'todo',
            priority: 'medium',
            order_index: baseOrder + idx,
          })
        )
      );
      if (defaultSection) setPendingSections(prev => prev.filter(s => s !== defaultSection));
      onRefresh?.();
    } catch (e) {
      console.error('Failed to inline-add:', e);
    }
  };

  const handleSubmitAdd = () => {
    if (addMode === 'object') return handleAddObjectsBulk();
    return handleAddElement();
  };

  // Legacy: handleAddSubObject still used by Object tree contextual creation
  const handleAddSubObject = async () => {
    setIsLoading(true);
    try {
      await createObjectRow({
        name: 'New Object',
        parent_object_id: object.id,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create sub-object:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInlineObjectSubmit = async (name: string) => {
    if (!name.trim()) return;
    try {
      await createObjectRow({ name: name.trim(), parent_object_id: object.id });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create object:', e);
    } finally {
      setInlineAddKey(null);
      setInlineAddText('');
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
                  className="flex items-center gap-1 text-[13px] truncate max-w-[200px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ObjectIcon size={12} />
                  <span className="truncate">{seg.name}</span>
                </button>
              </div>
            ))}
          </div>
          {/* Current Object — title row */}
          <div className="flex items-center gap-3 px-4 pb-3 min-w-0">
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
              onClick={() => { setInlineAddKey('add:object'); setInlineAddText(''); }}
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
                setInlineAddKey('section:__no_section__');
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

      {/* Tab Content — animate only on tab-type change to avoid flicker
           when navigating between Objects of the same tab kind. */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={activeTab?.tab_type ?? 'no-tab'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: 'linear' }}
        className="flex-1 flex overflow-hidden"
      >
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
        {/* Bulk Add Form (Asana-style) */}
        {isAddingElement && (
          <div className="mb-5 rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
            {/* Header: mode toggle + status + close */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
              <div className="inline-flex items-center bg-background rounded-md p-0.5 border border-border/60 gap-0.5">
                {(['element', 'object'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAddMode(m)}
                    className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition-all capitalize ${
                      addMode === m
                        ? 'bg-foreground text-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'element' ? 'Element' : 'Object'}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <span className="text-[11px] text-muted-foreground/70">
                {parsedAddItems.length > 0 ? (
                  <>
                    <span className="font-semibold text-foreground tabular-nums">{parsedAddItems.length}</span>
                    {' '}{addMode}{parsedAddItems.length > 1 ? 's' : ''} queued
                  </>
                ) : (
                  '⌘↵ to add'
                )}
              </span>
              <button
                onClick={() => { setIsAddingElement(false); setNewTitle(''); setNewSection(''); }}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmitAdd();
                }
                if (e.key === 'Escape') {
                  setIsAddingElement(false);
                  setNewTitle('');
                  setNewSection('');
                }
              }}
              rows={Math.min(8, Math.max(2, newTitle.split('\n').length))}
              placeholder={
                addMode === 'element'
                  ? 'Title... (paste multiple lines to bulk add, # prefix to add as section)'
                  : 'Name... (paste multiple lines to add multiple objects)'
              }
              className="w-full px-4 py-3 bg-transparent text-[13px] leading-relaxed focus:outline-none resize-none text-foreground placeholder:text-muted-foreground/40"
              autoFocus
              disabled={isLoading}
            />

            {/* Footer: section + actions */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50 bg-muted/10">
              {addMode === 'element' && (
                <>
                  <input
                    type="text"
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    placeholder="Section (optional)"
                    list="sections"
                    className="flex-1 text-[12px] px-2.5 py-1 bg-transparent border border-border/60 rounded-md focus:outline-none focus:border-foreground/50 text-foreground placeholder:text-muted-foreground/40 transition-colors"
                    disabled={isLoading}
                  />
                  <datalist id="sections">
                    {existingSections.map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
              {addMode === 'object' && <div className="flex-1" />}
              <button
                onClick={handleSubmitAdd}
                disabled={parsedAddItems.length === 0 || isLoading}
                className="px-3.5 py-1 bg-foreground text-background text-[12px] font-medium rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-40"
              >
                {isLoading
                  ? 'Adding...'
                  : parsedAddItems.length > 1
                    ? `Add ${parsedAddItems.length}`
                    : 'Add'}
              </button>
              <button
                onClick={() => { setIsAddingElement(false); setNewTitle(''); setNewSection(''); }}
                className="px-3 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Child Objects Section */}
        {object.children && object.children.length > 0 && (
          <ChildObjectsTable
            parentObjectId={object.id}
            children={object.children}
            onNavigate={onNavigate}
            onRefresh={onRefresh}
          />
        )}

        {/* Inline Object add row */}
        {inlineAddKey === 'add:object' && (
          <div className="overflow-x-auto mb-2">
            <table className="w-full min-w-max bg-card border-collapse">
              <tbody>
                <InlineAddRow
                  active={true}
                  text={inlineAddText}
                  setText={setInlineAddText}
                  onActivate={() => {}}
                  onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                  onSubmit={handleInlineObjectSubmit}
                  placeholder="Object name..."
                  colSpan={3}
                  gutterCount={2}
                  isLoading={isLoading}
                />
              </tbody>
            </table>
          </div>
        )}

        {/* Elements by Section */}
        {elements.length === 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max bg-card border-collapse">
              <thead>
                <tr>
                  <th className="w-10 px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"></th>
                  <th className="min-w-[200px] px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Element</th>
                </tr>
              </thead>
              <tbody>
                <InlineAddRow
                  active={inlineAddKey === 'section:__no_section__'}
                  text={inlineAddText}
                  setText={setInlineAddText}
                  onActivate={() => { setInlineAddKey('section:__no_section__'); setInlineAddText(''); }}
                  onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                  onSubmit={(t) => handleInlineAddSubmit('section:__no_section__', t)}
                  placeholder="Add element... (paste multiple lines for bulk)"
                  colSpan={2}
                  gutterCount={1}
                  isLoading={isLoading}
                />
              </tbody>
            </table>
          </div>
        ) : (
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
                  return elementsBySection.map(({ section, elements: sectionElements }, sectionIndex) => {
                    const sectionKey = section || '__no_section__';
                    const isCollapsed = collapsedSections.has(sectionKey);
                    return (
                  <React.Fragment key={sectionKey}>
                    {/* Section Header Row — collapsible + context menu (rename/duplicate/delete).
                         Uses the same gutter + name-cell layout as element rows so the bold
                         section title lines up exactly with the ○ status icon below it. */}
                    {section && (
                      <tr className="group">
                        <td className="w-8 px-1 pt-4 pb-1.5"></td>
                        <td className="w-7 px-1 pt-4 pb-1.5"></td>
                        <td colSpan={totalColumns - 2} className="pt-4 pb-1.5 px-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleSectionCollapse(sectionKey)}
                              className="w-4 h-4 flex items-center justify-center rounded hover:bg-muted transition-colors shrink-0"
                              aria-label={isCollapsed ? 'セクションを展開' : 'セクションを折りたたむ'}
                            >
                              <ChevronDown
                                size={12}
                                className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleSectionCollapse(sectionKey)}
                              className="text-base font-bold text-foreground hover:bg-muted/40 px-1 py-0.5 rounded transition-colors min-w-0 truncate text-left"
                            >
                              {section}
                              <span className="ml-1.5 text-muted-foreground/60 font-normal text-sm tabular-nums">
                                {sectionElements.length}
                              </span>
                            </button>
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
                                <DropdownMenuItem onClick={() => handleRenameSection(section)} className="gap-2 text-[13px]">
                                  <Pencil size={12} />
                                  セクション名を変更
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDuplicateSection(section)} className="gap-2 text-[13px]">
                                  <Copy size={12} />
                                  セクションを複製
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDeleteSection(section)} className="gap-2 text-[13px] text-destructive focus:text-destructive">
                                  <Trash2 size={12} />
                                  セクションを削除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    )}
                    {/* Element Rows — hidden when section is collapsed */}
                    {!isCollapsed && (
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
                    {/* Inline add element row, scoped to this section. Hidden when collapsed. */}
                    {!isCollapsed && (
                    <InlineAddRow
                      active={inlineAddKey === `section:${section ?? '__no_section__'}`}
                      text={inlineAddText}
                      setText={setInlineAddText}
                      onActivate={() => {
                        setInlineAddKey(`section:${section ?? '__no_section__'}`);
                        setInlineAddText('');
                      }}
                      onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                      onSubmit={(t) => handleInlineAddSubmit(`section:${section ?? '__no_section__'}`, t)}
                      placeholder={section ? `Add element to ${section}...` : 'Add element... (paste multiple lines for bulk)'}
                      colSpan={totalColumns}
                      isLoading={isLoading}
                    />
                    )}
                  </React.Fragment>
                  );
                });
                })()}

                {/* Pending sections — named inline but no elements yet */}
                {pendingSections
                  .filter(s => !elementsBySection.some(({ section }) => section === s))
                  .map(sectionName => (
                    <React.Fragment key={`pending:${sectionName}`}>
                      <tr className="group">
                        <td colSpan={2}></td>
                        <td colSpan={totalColumns - 2} className="pt-4 pb-1.5 px-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base font-bold text-foreground px-1">{sectionName}</span>
                          </div>
                        </td>
                      </tr>
                      <InlineAddRow
                        active={inlineAddKey === `section:${sectionName}`}
                        text={inlineAddText}
                        setText={setInlineAddText}
                        onActivate={() => { setInlineAddKey(`section:${sectionName}`); setInlineAddText(''); }}
                        onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                        onSubmit={(t) => handleInlineAddSubmit(`section:${sectionName}`, t)}
                        placeholder={`Add element to ${sectionName}...`}
                        colSpan={totalColumns}
                        isLoading={isLoading}
                      />
                    </React.Fragment>
                  ))}

                {/* Inline section name input row */}
                {inlineAddKey === 'add:section' && (
                  <tr>
                    <td colSpan={2}></td>
                    <td colSpan={totalColumns - 2} className="pt-4 pb-1.5 px-2">
                      <input
                        autoFocus
                        className="text-base font-bold bg-transparent outline-none border-b border-foreground/30 focus:border-foreground/60 text-foreground placeholder:text-muted-foreground/40 w-64 transition-colors"
                        placeholder="Section name..."
                        value={inlineAddText}
                        onChange={(e) => setInlineAddText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          if (e.key === 'Enter' && inlineAddText.trim()) {
                            const name = inlineAddText.trim();
                            setPendingSections(prev => prev.includes(name) ? prev : [...prev, name]);
                            setInlineAddKey(`section:${name}`);
                            setInlineAddText('');
                          }
                          if (e.key === 'Escape') { setInlineAddKey(null); setInlineAddText(''); }
                        }}
                      />
                    </td>
                  </tr>
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

      </motion.div>
      </AnimatePresence>

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
      </div>
    </div>
  );
}

