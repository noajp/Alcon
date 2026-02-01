'use client';

import React, { useState, useEffect } from 'react';
import type { NavigationState } from './Sidebar';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType } from '@/hooks/useSupabase';
import {
  createElement,
  updateElement,
  groupElementsBySection,
  fetchCustomColumnsWithValues,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  setCustomColumnValue,
  useObjectTabs,
  createObjectTab,
  updateObjectTab,
  deleteObjectTab,
  useElementSheets,
  createElementSheet,
  updateElementSheet,
  deleteElementSheet,
} from '@/hooks/useSupabase';
import type { ObjectTabType } from '@/types/database';
import type { Json } from '@/types/database';

// Layout components
import { TabBar } from './TabBar';

// Views
import { NotesView, ActionsView } from '@/components/views';
import { HomeView } from '@/components/home';

// Column components
import {
  AddColumnModal,
  ColumnHeader,
  BuiltInColumnHeader,
  DEFAULT_BUILTIN_COLUMNS,
} from '@/components/columns';
import type { BuiltInColumn } from '@/components/columns';

// Element components
import { SheetTabBar, ElementTableRow } from '@/components/elements';

// Other components
import { ObjectIcon } from '@/components/icons';
import { CalendarView } from '@/components/calendar/CalendarView';
import { MatrixView } from '@/components/matrix/MatrixView';
import { GanttView } from '@/components/gantt';

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  explorerData: ExplorerData;
  onRefresh?: () => void;
}

// ============================================
// Helper: Find object by ID (recursive for nested objects)
// ============================================
function findObjectById(objects: AlconObjectWithChildren[], objectId: string): AlconObjectWithChildren | null {
  for (const obj of objects) {
    if (obj.id === objectId) return obj;
    if (obj.children) {
      const found = findObjectById(obj.children, objectId);
      if (found) return found;
    }
  }
  return null;
}

// ============================================
// Helper: Collect all elements from objects (recursive for nested objects)
// ============================================
function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  let elements: ElementWithDetails[] = [];
  for (const obj of objects) {
    if (obj.elements) {
      elements = elements.concat(obj.elements);
    }
    if (obj.children) {
      elements = elements.concat(collectAllElements(obj.children));
    }
  }
  return elements;
}

// ============================================
// Helper: Collect all objects (flatten nested structure)
// ============================================
function collectAllObjects(explorerData: ExplorerData): AlconObjectWithChildren[] {
  function flatten(objects: AlconObjectWithChildren[]): AlconObjectWithChildren[] {
    let result: AlconObjectWithChildren[] = [];
    for (const obj of objects) {
      result.push(obj);
      if (obj.children) {
        result = result.concat(flatten(obj.children));
      }
    }
    return result;
  }
  return flatten(explorerData.objects);
}

// ============================================
// Helper: Find object in explorer data (recursive through nested objects)
// ============================================
function findObjectInExplorerData(explorerData: ExplorerData, objectId: string): AlconObjectWithChildren | null {
  return findObjectById(explorerData.objects, objectId);
}

export function MainContent({ activeActivity, navigation, onNavigate, explorerData, onRefresh }: MainContentProps) {
  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {activeActivity === 'home' && <HomeView explorerData={explorerData} />}
      {activeActivity === 'projects' && (
        <ObjectsView
          explorerData={explorerData}
          navigation={navigation}
          onNavigate={onNavigate}
          onRefresh={onRefresh}
        />
      )}
      {activeActivity === 'notes' && (
        <NotesView
          navigation={navigation}
          onNavigate={onNavigate}
        />
      )}
      {activeActivity === 'actions' && (
        <ActionsView
          navigation={navigation}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

// ============================================
// Objects View - Shows object contents
// ============================================
function ObjectsView({ explorerData, navigation, onNavigate, onRefresh }: {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  // If an object is selected, show object detail
  if (navigation.objectId) {
    const selectedObject = findObjectInExplorerData(explorerData, navigation.objectId);
    if (!selectedObject) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[var(--text-muted)]">Object not found</div>
        </div>
      );
    }
    return (
      <ObjectDetailView
        object={selectedObject}
        onNavigate={onNavigate}
        onRefresh={onRefresh}
        explorerData={explorerData}
      />
    );
  }

  // No selection - show message to select an object
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="text-muted-foreground mb-2">
          <ObjectIcon size={48} />
        </div>
        <p className="text-muted-foreground">Select an Object from the sidebar</p>
      </div>
    </div>
  );
}

// ============================================
// Overview View - Shows all objects in a flat list
// ============================================
function OverviewView({ explorerData, onNavigate }: {
  explorerData: ExplorerData;
  onNavigate: (nav: Partial<NavigationState>) => void;
}) {
  const allObjects = collectAllObjects(explorerData);
  const allElements = collectAllElements(explorerData.objects);

  return (
    <div className="flex-1 overflow-auto bg-background">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground"><ObjectIcon size={24} /></span>
          <div>
            <h1 className="text-xl font-semibold text-foreground">All Objects</h1>
            <p className="text-sm text-muted-foreground">
              {allObjects.length} objects · {allElements.length} elements
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-background">
        {explorerData.objects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No objects yet.</p>
            <p className="text-sm mt-2">Create an Object to get started.</p>
          </div>
        ) : (
          <div>
            {/* Objects Table */}
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-10 px-4 py-3 text-left text-xs font-medium text-muted-foreground"></th>
                  <th className="min-w-[200px] px-3 py-3 text-left text-xs font-medium text-muted-foreground">Name</th>
                  <th className="w-24 px-3 py-3 text-left text-xs font-medium text-muted-foreground">Elements</th>
                  <th className="w-28 px-3 py-3 text-left text-xs font-medium text-muted-foreground">Progress</th>
                </tr>
              </thead>
              <tbody>
                {explorerData.objects.map((obj, index) => (
                  <ObjectTableRow
                    key={obj.id}
                    object={obj}
                    rowNumber={index + 1}
                    onClick={() => onNavigate({ objectId: obj.id })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Object List Row
// ============================================
function ObjectListRow({ object, rowNumber, onClick }: {
  object: AlconObjectWithChildren;
  rowNumber: number;
  onClick: () => void;
}) {
  const elementCount = object.elements?.length || 0;
  const doneCount = object.elements?.filter(e => e.status === 'done').length || 0;
  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;

  return (
    <div
      className="flex items-center px-4 py-3 border-b border-border cursor-pointer hover:bg-muted transition-colors"
      onClick={onClick}
    >
      <span className="w-10 text-xs text-muted-foreground">{rowNumber}</span>
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="text-muted-foreground"><ObjectIcon size={16} /></span>
        <span className="text-[13px] text-foreground truncate">{object.name}</span>
      </div>
      <span className="w-24 text-xs text-muted-foreground">{elementCount} elements</span>
      <div className="w-28 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-[#1e3a5f] rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground w-8">{progress}%</span>
      </div>
    </div>
  );
}

// ============================================
// Object Table Row
// ============================================
function ObjectTableRow({ object, rowNumber, onClick }: {
  object: AlconObjectWithChildren;
  rowNumber: number;
  onClick: () => void;
}) {
  const elementCount = object.elements?.length || 0;
  const doneCount = object.elements?.filter(e => e.status === 'done').length || 0;
  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;

  return (
    <tr
      className="border-b border-border cursor-pointer hover:bg-muted transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3 text-xs text-muted-foreground">{rowNumber}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground"><ObjectIcon size={16} /></span>
          <span className="text-[13px] text-foreground">{object.name}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">{elementCount} elements</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1e3a5f] rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground w-8">{progress}%</span>
        </div>
      </td>
    </tr>
  );
}

// ============================================
// Section Header Component (simple)
// ============================================
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-6 pb-2">
      <div className="text-sm font-semibold text-foreground">
        {label}
      </div>
    </div>
  );
}

// Components imported from @/components/columns:
// - AddColumnModal, ColumnHeader, BuiltInColumnHeader, CustomColumnCell
// - EditPropertyModal, EditBuiltInPropertyModal
// - DEFAULT_BUILTIN_COLUMNS, BuiltInColumn type
// - COLUMN_TYPES

// Components imported from @/components/elements:
// - ElementTableRow, SubelementRow, ElementInlineDetail, SheetTabBar

// Components imported from @/components/home:
// - HomeView
// ============================================
// Object Detail View - Shows Object with Elements by Section
// ============================================
function ObjectDetailView({ object, onNavigate, onRefresh, explorerData }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  explorerData: ExplorerData;
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isAddingElement, setIsAddingElement] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Multi-select elements state (scoped to section)
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [lastSelectedElementIndex, setLastSelectedElementIndex] = useState<number | null>(null);
  const [selectionSectionIndex, setSelectionSectionIndex] = useState<number | null>(null);

  // Multi-select columns state (key: "sectionIndex-colIndex")
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [lastSelectedColumnKey, setLastSelectedColumnKey] = useState<{ sectionIndex: number; colIndex: number } | null>(null);

  // Tabs state
  const { tabs, refetch: refetchTabs } = useObjectTabs(object.id);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Set default active tab when tabs load
  useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      const elementsTab = tabs.find(t => t.tab_type === 'elements');
      setActiveTabId(elementsTab?.id || tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Sheets state (Excel-like sheets within Elements tab)
  const { sheets, loading: sheetsLoading, initialLoadComplete, refetch: refetchSheets } = useElementSheets(object.id);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [createdSheetForObjectId, setCreatedSheetForObjectId] = useState<string | null>(null);

  // Create default sheet if none exist (only after initial load completes)
  useEffect(() => {
    const initializeSheets = async () => {
      // Wait for initial load to complete
      if (!initialLoadComplete) return;

      // Don't create if already created for this object
      if (createdSheetForObjectId === object.id) return;

      if (sheets.length === 0) {
        setCreatedSheetForObjectId(object.id);
        try {
          const newSheet = await createElementSheet({
            object_id: object.id,
            name: 'Sheet 1',
          });
          await refetchSheets();
          setActiveSheetId(newSheet.id);
        } catch (e) {
          console.error('Failed to create default sheet:', e);
          setCreatedSheetForObjectId(null); // Reset on error to allow retry
        }
      } else if (!activeSheetId || !sheets.find(s => s.id === activeSheetId)) {
        setActiveSheetId(sheets[0].id);
      }
    };
    initializeSheets();
  }, [sheets, initialLoadComplete, activeSheetId, object.id, refetchSheets, createdSheetForObjectId]);

  const handleSheetCreate = async () => {
    try {
      const newSheet = await createElementSheet({
        object_id: object.id,
        name: `Sheet ${sheets.length + 1}`,
      });
      await refetchSheets();
      setActiveSheetId(newSheet.id);
    } catch (e) {
      console.error('Failed to create sheet:', e);
    }
  };

  const handleSheetRename = async (sheetId: string, name: string) => {
    try {
      await updateElementSheet(sheetId, { name });
      await refetchSheets();
    } catch (e) {
      console.error('Failed to rename sheet:', e);
    }
  };

  const handleSheetDelete = async (sheetId: string) => {
    if (sheets.length <= 1) return; // Don't delete last sheet
    try {
      await deleteElementSheet(sheetId);
      await refetchSheets();
      if (sheetId === activeSheetId) {
        const remainingSheets = sheets.filter(s => s.id !== sheetId);
        setActiveSheetId(remainingSheets[0]?.id || null);
      }
    } catch (e) {
      console.error('Failed to delete sheet:', e);
    }
  };

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

  const allElements = object.elements || [];
  // Filter elements by active sheet (null sheet_id elements show on first/default sheet)
  const elements = allElements.filter(e =>
    activeSheetId ? (e.sheet_id === activeSheetId || (!e.sheet_id && sheets[0]?.id === activeSheetId)) : true
  );
  const elementsBySection = groupElementsBySection(elements);

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

  const handleAddElement = async () => {
    if (!newTitle.trim()) return;

    setIsLoading(true);
    try {
      await createElement({
        title: newTitle.trim(),
        object_id: object.id,
        sheet_id: activeSheetId,
        section: newSection.trim() || null,
        status: 'todo',
        priority: 'medium',
      });
      setNewTitle('');
      setNewSection('');
      setIsAddingElement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create element:', e);
    } finally {
      setIsLoading(false);
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
  const totalColumns = 2 + visibleBuiltInCount + customColumns.length + 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTabId}
        onTabClose={handleTabClose}
        onTabCreate={handleTabCreate}
      />

      {/* Tab Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Elements Tab Content */}
        {activeTab?.tab_type === 'elements' && (
          <div className={`flex-1 flex flex-col ${currentSelectedElement ? 'border-r border-border' : ''}`}>
            {/* Elements Action Bar - Fixed */}
            <div className="px-5 py-2 border-b border-border bg-background flex items-center justify-between flex-shrink-0">
              <p className="text-sm text-muted-foreground">{elements.length} elements</p>
              <button
                onClick={() => setIsAddingElement(true)}
                className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-md hover:bg-[#152a45] transition-colors flex items-center gap-1.5"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                Add Element
              </button>
            </div>

            {/* Main scrollable content */}
            <div className="flex-1 overflow-auto">
        <div className="px-5 pt-4 pb-5">
        {/* Add Element Form */}
        {isAddingElement && (
          <div className="mb-4 p-4 bg-[#252525] rounded-lg border border-border">
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) handleAddElement();
                  if (e.key === 'Escape') {
                    setIsAddingElement(false);
                    setNewTitle('');
                    setNewSection('');
                  }
                }}
                placeholder="Element title..."
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                autoFocus
                disabled={isLoading}
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSection}
                  onChange={(e) => setNewSection(e.target.value)}
                  placeholder="Section (optional)"
                  list="sections"
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                  disabled={isLoading}
                />
                <datalist id="sections">
                  {existingSections.map(s => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <button
                  onClick={handleAddElement}
                  disabled={!newTitle.trim() || isLoading}
                  className="px-3 py-2 bg-[#1e3a5f] text-white text-sm rounded-md hover:bg-[#152a45] transition-colors disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsAddingElement(false);
                    setNewTitle('');
                    setNewSection('');
                  }}
                  className="px-3 py-2 text-muted-foreground text-sm hover:bg-card rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Elements by Section */}
        {elements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No elements in this object yet.</p>
            <button
              onClick={() => setIsAddingElement(true)}
              className="mt-2 text-sm text-[#1e3a5f] hover:underline"
            >
              Add your first element
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-background border-collapse">
              {/* Column Headers - Asana style sticky header */}
              <thead className="sticky top-0 z-20 bg-background">
                <tr className="border-b border-border">
                  <th className="w-10 px-2 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-background"></th>
                  <th
                    className={`md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has('0-0') ? 'bg-primary/10' : 'bg-background'}`}
                    onClick={(e) => handleColumnHeaderClick(0, 0, e)}
                  >
                    Task name
                  </th>
                  {/* Built-in Columns - hidden on small screens */}
                  {builtInColumns.filter(col => col.isVisible).map((col, idx) => {
                    const colIndex = idx + 1;
                    return (
                      <th
                        key={col.id}
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-primary/10' : 'bg-background'}`}
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
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-primary/10' : 'bg-background'}`}
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
                  {/* Add Column Button - hidden on small screens */}
                  <th className="hidden md:table-cell w-10 px-2 py-2.5 text-left bg-background">
                    <button
                      onClick={() => setShowAddColumnModal(true)}
                      className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
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
                  return elementsBySection.map(({ section, elements: sectionElements }, sectionIndex) => (
                  <React.Fragment key={section || '__no_section__'}>
                    {/* Section Header Row - Asana style */}
                    {section && (
                      <tr className="group hover:bg-muted/30">
                        <td className="px-2 py-2.5 border-b border-border">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </td>
                        <td
                          colSpan={totalColumns - 1}
                          className="px-3 py-2.5 text-[13px] font-semibold text-foreground border-b border-border"
                        >
                          {section}
                        </td>
                      </tr>
                    )}
                    {/* Element Rows */}
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
                              setLastSelectedElementIndex(localIndex);
                              setSelectionSectionIndex(sectionIndex);
                              setSelectedElement(currentSelectedElement?.id === element.id ? null : element);
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
                        />
                      );
                    })}
                  </React.Fragment>
                ));
                })()}
              </tbody>
            </table>
          </div>
        )}
        </div>
            </div>
            {/* Sheet Tab Bar - Excel-like tabs at bottom */}
            <SheetTabBar
              sheets={sheets}
              activeSheetId={activeSheetId}
              onSheetSelect={setActiveSheetId}
              onSheetCreate={handleSheetCreate}
              onSheetRename={handleSheetRename}
              onSheetDelete={handleSheetDelete}
            />
          </div>
        )}

        {/* Note Tab Content - deprecated, use Actions > Notes instead */}
        {activeTab?.tab_type === 'note' && (
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="text-center text-muted-foreground">
              <p>Notes have been moved to Actions → Notes</p>
            </div>
          </div>
        )}

        {/* Summary Tab Content */}
        {activeTab?.tab_type === 'summary' && (
          <div className="flex-1 overflow-auto bg-background p-8">
            <div className="text-center text-muted-foreground">
              <p>Summary view coming soon...</p>
            </div>
          </div>
        )}

        {/* Gantt Tab Content */}
        {activeTab?.tab_type === 'gantt' && (
          <div className="flex-1 overflow-hidden bg-background">
            <GanttView
              elements={elements}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Calendar Tab Content */}
        {activeTab?.tab_type === 'calendar' && (
          <div className="flex-1 overflow-hidden bg-background">
            <CalendarView
              elements={elements}
              onElementClick={(element) => setSelectedElement(element)}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Workers Tab Content */}
        {activeTab?.tab_type === 'workers' && (
          <div className="flex-1 overflow-auto bg-background p-8">
            <div className="text-center text-muted-foreground">
              <p>Workers list coming soon...</p>
            </div>
          </div>
        )}

        {/* Matrix Tab Content */}
        {activeTab?.tab_type === 'matrix' && (
          <div className="flex-1 overflow-hidden bg-background relative">
            <MatrixView
              rowElements={elements}
              allObjects={allObjects}
              currentObjectId={object.id}
              tabContent={activeTab.content}
              onTabContentUpdate={async (content) => {
                await updateObjectTab(activeTab.id, { content });
                refetchTabs();
              }}
              onRefresh={onRefresh}
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
    </div>
  );
}

