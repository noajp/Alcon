'use client';

import { useState, useEffect, ReactNode } from 'react';
import type { NavigationState } from './Sidebar';
import type { AlconObjectWithChildren, ElementWithDetails, ElementsBySection, ExplorerData, Worker, ElementEdgeWithElement, EdgeType, CustomColumnWithValues, CustomColumnType, Note, NoteWithChildren, Document, DocumentWithChildren, Canvas } from '@/hooks/useSupabase';
import {
  createElement,
  updateElement,
  deleteElement,
  createSubelement,
  toggleSubelementComplete,
  groupElementsBySection,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  createElementEdge,
  deleteElementEdge,
  getElementEdges,
  fetchCustomColumnsWithValues,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  setCustomColumnValue,
  useObjectTabs,
  createObjectTab,
  updateObjectTab,
  deleteObjectTab,
  useNotes,
  createNote,
  updateNote,
  deleteNote,
  useDocuments,
  updateDocument,
  useCanvases,
  createCanvas,
  updateCanvas,
  deleteCanvas,
  fetchCanvas,
} from '@/hooks/useSupabase';
import type { ObjectTab, ObjectTabType } from '@/types/database';
import { TabBar } from './TabBar';
import type { Json } from '@/types/database';
import { NoteExplorer } from '@/components/notes/NoteExplorer';
import { ObjectIcon } from '@/components/icons';
import dynamic from 'next/dynamic';

// Dynamic import for BlockNote (SSR disabled)
const BlockEditor = dynamic(() => import('@/components/editor/BlockEditor').then(mod => mod.BlockEditor), {
  ssr: false,
  loading: () => <div className="p-4 text-muted-foreground">Loading editor...</div>,
});

// Dynamic import for CanvasEditor (SSR disabled)
const CanvasEditor = dynamic(() => import('@/components/canvas/CanvasEditor').then(mod => mod.CanvasEditor), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">Loading canvas...</div>,
});

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
          explorerData={explorerData}
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
// HOME View
// ============================================
function HomeView({ explorerData }: { explorerData: ExplorerData }) {
  const allObjects = collectAllObjects(explorerData);
  const allElements = collectAllElements(allObjects);

  const blockedElements = allElements.filter(e => e.status === 'blocked');
  const inProgressElements = allElements.filter(e => e.status === 'in_progress');
  const doneElements = allElements.filter(e => e.status === 'done');
  const urgentElements = allElements.filter(e => e.priority === 'urgent' && e.status !== 'done');

  return (
    <div className="flex-1 overflow-auto bg-background">
      {/* Header */}
      <div className="px-8 py-6 bg-card">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">{allObjects.length} objects · {allElements.length} elements</p>
      </div>

      <div className="p-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-5 mb-8">
          <StatCard title="Blocked" value={blockedElements.length} color="red" subtitle="Requires attention" />
          <StatCard title="In Progress" value={inProgressElements.length} color="yellow" subtitle="Currently working" />
          <StatCard title="Completed" value={doneElements.length} color="green" subtitle="This period" />
          <StatCard title="Urgent" value={urgentElements.length} color="purple" subtitle="High priority" />
        </div>

        {/* Objects Overview */}
        <div className="bg-card rounded-xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          <h2 className="font-semibold text-foreground mb-4">Overview</h2>
          <div className="space-y-3">
            {explorerData.objects.map(obj => {
              const objElements = obj.elements || [];
              const childElements = obj.children ? collectAllElements(obj.children) : [];
              const allObjElements = [...objElements, ...childElements];
              const done = allObjElements.filter(e => e.status === 'done').length;
              const progress = allObjElements.length > 0 ? Math.round((done / allObjElements.length) * 100) : 0;
              const childCount = obj.children ? obj.children.length : 0;

              return (
                <div key={obj.id} className="flex items-center gap-3">
                  <span className="text-[#1e3a5f]"><ObjectIcon size={12} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate font-medium">{obj.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#1e3a5f] rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{progress}%</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{childCount > 0 ? `${childCount} children · ` : ''}{allObjElements.length} elements</span>
                </div>
              );
            })}
            {explorerData.objects.length === 0 && (
              <div className="text-sm text-[var(--text-muted)]">No items created yet</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ title, value, color, subtitle }: {
  title: string;
  value: number;
  color: 'red' | 'yellow' | 'green' | 'purple';
  subtitle: string;
}) {
  const colorConfig = {
    red: { dot: 'bg-red-500', text: 'text-red-600' },
    yellow: { dot: 'bg-amber-500', text: 'text-amber-600' },
    green: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
    purple: { dot: 'bg-purple-500', text: 'text-purple-600' },
  };

  return (
    <div className="bg-card rounded-xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
      {/* Large number - hero element */}
      <div className="text-5xl font-bold text-foreground tracking-tight mb-3">
        {value}
      </div>
      {/* Title with status dot */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${colorConfig[color].dot}`}></span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      {/* Subtitle - muted */}
      <div className="text-xs text-muted-foreground mt-1 ml-4">{subtitle}</div>
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
    <div className="flex-1 overflow-auto bg-[#1e1e1e]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#333] bg-[#1e1e1e]">
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
      <div className="bg-[#1e1e1e]">
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
                <tr className="border-b border-[#333]">
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
      className="flex items-center px-4 py-3 border-b border-[#333] cursor-pointer hover:bg-[#252525] transition-colors"
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
      className="border-b border-[#333] cursor-pointer hover:bg-[#252525] transition-colors"
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

// ============================================
// Column Type Icons and Labels
// ============================================
const COLUMN_TYPES: { type: CustomColumnType; label: string; icon: ReactNode; category: 'suggested' | 'basic' | 'advanced' }[] = [
  { type: 'progress', label: 'Progress', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>, category: 'suggested' },
  { type: 'budget', label: 'Budget', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M8 14h8"/></svg>, category: 'suggested' },
  { type: 'text', label: 'Text', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>, category: 'basic' },
  { type: 'number', label: 'Number', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><text x="5" y="17" fontSize="14" fill="currentColor">#</text></svg>, category: 'basic' },
  { type: 'select', label: 'Select', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 8"/></svg>, category: 'basic' },
  { type: 'multi_select', label: 'Multi-select', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>, category: 'basic' },
  { type: 'status', label: 'Status', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="4 2"/></svg>, category: 'basic' },
  { type: 'date', label: 'Date', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, category: 'basic' },
  { type: 'person', label: 'Person', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, category: 'basic' },
  { type: 'checkbox', label: 'Checkbox', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>, category: 'basic' },
  { type: 'url', label: 'URL', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>, category: 'basic' },
  { type: 'email', label: 'Email', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>, category: 'basic' },
  { type: 'phone', label: 'Phone', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>, category: 'basic' },
  { type: 'files', label: 'Files & media', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>, category: 'basic' },
  { type: 'relation', label: 'Relation', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>, category: 'advanced' },
  { type: 'rollup', label: 'Rollup', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, category: 'advanced' },
  { type: 'formula', label: 'Formula', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><text x="4" y="17" fontSize="16" fill="currentColor">&Sigma;</text></svg>, category: 'advanced' },
];

// ============================================
// Add Column Modal
// ============================================
function AddColumnModal({
  onClose,
  onAdd,
  deletedBuiltInColumns,
  onRestoreBuiltIn
}: {
  onClose: () => void;
  onAdd: (name: string, type: CustomColumnType) => void;
  deletedBuiltInColumns?: { id: string; name: string; builtinType: 'assignees' | 'priority' | 'status' | 'due_date' }[];
  onRestoreBuiltIn?: (builtinType: 'assignees' | 'priority' | 'status' | 'due_date') => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<CustomColumnType | null>(null);
  const [columnName, setColumnName] = useState('');

  const filteredTypes = COLUMN_TYPES.filter(t =>
    t.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter deleted built-in columns based on search
  const filteredDeletedBuiltIn = (deletedBuiltInColumns || []).filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const suggestedTypes = filteredTypes.filter(t => t.category === 'suggested');
  const basicTypes = filteredTypes.filter(t => t.category === 'basic');
  const advancedTypes = filteredTypes.filter(t => t.category === 'advanced');

  const handleSelectType = (type: CustomColumnType) => {
    setSelectedType(type);
    const typeInfo = COLUMN_TYPES.find(t => t.type === type);
    setColumnName(typeInfo?.label || '');
  };

  const handleAdd = () => {
    if (selectedType && columnName.trim()) {
      onAdd(columnName.trim(), selectedType);
    }
  };

  // Icons for built-in columns
  const builtInIcons: Record<string, React.ReactNode> = {
    assignees: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
    priority: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
    status: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>,
    due_date: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-[320px] max-h-[500px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {!selectedType ? (
          <>
            {/* Search */}
            <div className="p-3 border-b border-[#333]">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search for a property type"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-card rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
                  autoFocus
                />
              </div>
            </div>

            {/* Type List */}
            <div className="overflow-y-auto max-h-[400px]">
              {/* Deleted Built-in Columns - Restore section */}
              {filteredDeletedBuiltIn.length > 0 && (
                <div className="p-2">
                  <div className="text-xs text-muted-foreground px-2 py-1">Restore default columns</div>
                  {filteredDeletedBuiltIn.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => {
                        onRestoreBuiltIn?.(col.builtinType);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{builtInIcons[col.builtinType]}</span>
                      <span className="text-sm text-foreground">{col.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Built-in</span>
                    </button>
                  ))}
                </div>
              )}

              {suggestedTypes.length > 0 && (
                <div className={`p-2 ${filteredDeletedBuiltIn.length > 0 ? 'border-t border-[#333]' : ''}`}>
                  <div className="text-xs text-muted-foreground px-2 py-1">Suggested</div>
                  {suggestedTypes.map(({ type, label, icon }) => (
                    <button
                      key={type}
                      onClick={() => handleSelectType(type)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-foreground">{label}</span>
                    </button>
                  ))}
                </div>
              )}

              {basicTypes.length > 0 && (
                <div className="p-2 border-t border-[#333]">
                  <div className="text-xs text-muted-foreground px-2 py-1">Select type</div>
                  <div className="grid grid-cols-2 gap-1">
                    {basicTypes.map(({ type, label, icon }) => (
                      <button
                        key={type}
                        onClick={() => handleSelectType(type)}
                        className="flex items-center gap-2 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                      >
                        <span className="text-muted-foreground">{icon}</span>
                        <span className="text-sm text-foreground">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {advancedTypes.length > 0 && (
                <div className="p-2 border-t border-[#333]">
                  {advancedTypes.map(({ type, label, icon }) => (
                    <button
                      key={type}
                      onClick={() => handleSelectType(type)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-foreground">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setSelectedType(null)}
                className="p-1 hover:bg-card rounded"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <span className="text-sm font-medium">New {COLUMN_TYPES.find(t => t.type === selectedType)?.label} column</span>
            </div>

            <input
              type="text"
              value={columnName}
              onChange={e => setColumnName(e.target.value)}
              placeholder="Column name"
              className="w-full px-3 py-2 border border-[#333] rounded-md text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') onClose();
              }}
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-card rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!columnName.trim()}
                className="px-3 py-1.5 text-sm bg-[#1e3a5f] text-white rounded hover:bg-[#152a45] transition-colors disabled:opacity-50"
              >
                Add column
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Edit Property Modal (Notion-like column settings)
// ============================================
function EditPropertyModal({
  column,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  column: CustomColumnWithValues;
  onClose: () => void;
  onUpdate: (updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [options, setOptions] = useState<{ value: string; color?: string }[]>(
    column.options?.options || []
  );
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');

  const isSelectType = column.column_type === 'select' || column.column_type === 'multi_select' || column.column_type === 'status';

  // Status type has predefined groups
  const statusGroups = column.column_type === 'status' ? [
    { label: 'To-do', options: options.filter(o => ['Not started', 'Todo', 'To Do', 'Backlog'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
    { label: 'In progress', options: options.filter(o => ['In progress', 'In Progress', 'Working', 'Active'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
    { label: 'Complete', options: options.filter(o => ['Done', 'Complete', 'Completed', 'Finished'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
  ] : null;

  const handleNameSave = () => {
    if (name.trim() && name !== column.name) {
      onUpdate({ name: name.trim() });
    }
  };

  const handleAddOption = (groupLabel?: string) => {
    if (!newOptionValue.trim()) return;
    const newOption = { value: newOptionValue.trim(), color: getRandomColor() };
    const newOptions = [...options, newOption];
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
    setNewOptionValue('');
  };

  const handleUpdateOption = (index: number, newValue: string) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], value: newValue };
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
    setEditingOptionIndex(null);
  };

  const handleDeleteOption = (index: number) => {
    const newOptions = options.filter((_, i) => i !== index);
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
  };

  const getRandomColor = () => {
    const colors = ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0', '#fce4ec', '#e0f2f1', '#f5f5f5'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const getStatusColor = (value: string) => {
    const lowerValue = value.toLowerCase();
    if (['done', 'complete', 'completed', 'finished'].some(s => lowerValue.includes(s))) return '#22c55e';
    if (['in progress', 'working', 'active'].some(s => lowerValue.includes(s))) return '#3b82f6';
    return '#888';
  };

  const typeInfo = COLUMN_TYPES.find(t => t.type === column.column_type);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-[340px] max-h-[600px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1 hover:bg-card rounded">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="text-sm font-medium">Edit property</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-card rounded">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Property Name */}
        <div className="p-3 border-b border-[#333]">
          <div className="flex items-center gap-2 bg-card rounded-lg p-2">
            <span className="text-muted-foreground">{typeInfo?.icon}</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); }}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
            />
            <button className="p-1 hover:bg-muted rounded">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Type */}
        <div className="px-3 py-2 border-b border-[#333]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              Type
            </div>
            <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {typeInfo?.label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Options for Select/Status types */}
        {isSelectType && (
          <div className="overflow-y-auto max-h-[300px]">
            {column.column_type === 'status' && statusGroups ? (
              // Status type with groups
              statusGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="border-b border-[#333] last:border-b-0">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">{group.label}</span>
                    <button
                      onClick={() => {
                        const defaultValue = group.label === 'To-do' ? 'New status' : group.label === 'In progress' ? 'In progress' : 'Done';
                        const newOption = { value: defaultValue, color: getStatusColor(defaultValue) };
                        const newOptions = [...options, newOption];
                        setOptions(newOptions);
                        onUpdate({ options: { options: newOptions } });
                      }}
                      className="p-0.5 hover:bg-muted rounded"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </div>
                  {options.filter((_, i) => {
                    const opt = options[i];
                    if (group.label === 'To-do') return ['Not started', 'Todo', 'To Do', 'Backlog'].some(s => opt.value.toLowerCase().includes(s.toLowerCase())) || (!['In progress', 'Working', 'Active', 'Done', 'Complete', 'Completed', 'Finished'].some(s => opt.value.toLowerCase().includes(s.toLowerCase())) && groupIdx === 0);
                    if (group.label === 'In progress') return ['In progress', 'Working', 'Active'].some(s => opt.value.toLowerCase().includes(s.toLowerCase()));
                    return ['Done', 'Complete', 'Completed', 'Finished'].some(s => opt.value.toLowerCase().includes(s.toLowerCase()));
                  }).map((option, idx) => {
                    const realIndex = options.findIndex(o => o.value === option.value);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                        <button className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                          </svg>
                        </button>
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getStatusColor(option.value) }}
                        />
                        {editingOptionIndex === realIndex ? (
                          <input
                            type="text"
                            defaultValue={option.value}
                            autoFocus
                            onBlur={e => handleUpdateOption(realIndex, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleUpdateOption(realIndex, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingOptionIndex(null);
                            }}
                            className="flex-1 text-sm bg-transparent border border-[#1e3a5f] rounded px-1 focus:outline-none"
                          />
                        ) : (
                          <span
                            className="flex-1 text-sm cursor-pointer"
                            onClick={() => setEditingOptionIndex(realIndex)}
                          >
                            {option.value}
                          </span>
                        )}
                        {realIndex === 0 && group.label === 'To-do' && (
                          <span className="text-[10px] text-muted-foreground">DEFAULT</span>
                        )}
                        <button
                          onClick={() => handleDeleteOption(realIndex)}
                          className="p-1 hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              // Regular select/multi-select
              <div className="p-2">
                <div className="text-xs text-muted-foreground px-2 py-1 mb-1">Options</div>
                {options.map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-card rounded group">
                    <button className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                      </svg>
                    </button>
                    <span
                      className="px-2 py-0.5 rounded text-xs"
                      style={{ backgroundColor: option.color || '#f5f5f5' }}
                    >
                      {editingOptionIndex === idx ? (
                        <input
                          type="text"
                          defaultValue={option.value}
                          autoFocus
                          onBlur={e => handleUpdateOption(idx, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdateOption(idx, (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') setEditingOptionIndex(null);
                          }}
                          className="bg-transparent border-none focus:outline-none w-20"
                        />
                      ) : (
                        <span onClick={() => setEditingOptionIndex(idx)} className="cursor-pointer">
                          {option.value}
                        </span>
                      )}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleDeleteOption(idx)}
                      className="p-1 hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
                {/* Add new option */}
                <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                  <input
                    type="text"
                    value={newOptionValue}
                    onChange={e => setNewOptionValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddOption(); }}
                    placeholder="Add option..."
                    className="flex-1 text-sm bg-transparent border-b border-[#333] focus:border-[#1e3a5f] focus:outline-none py-1"
                  />
                  <button
                    onClick={() => handleAddOption()}
                    disabled={!newOptionValue.trim()}
                    className="p-1 hover:bg-card rounded disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="border-t border-[#333] p-2">
          <button
            onClick={onDuplicate}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-card rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Duplicate property
          </button>
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-900/20 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete property
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Column Header with menu
// ============================================
function ColumnHeader({
  column,
  onRename,
  onDelete,
  onUpdate,
  onDuplicate,
}: {
  column: CustomColumnWithValues;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdate: (updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => void;
  onDuplicate: () => void;
}) {
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={() => setShowEditModal(true)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {column.name}
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showEditModal && (
        <EditPropertyModal
          column={column}
          onClose={() => setShowEditModal(false)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      )}
    </div>
  );
}

// ============================================
// Custom Column Cell Editor
// ============================================
function CustomColumnCell({
  column,
  elementId,
  value,
  onChange,
  displayMode = 'table',
}: {
  column: CustomColumnWithValues;
  elementId: string;
  value: Json;
  onChange: (value: Json) => void;
  displayMode?: 'table' | 'pill';
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value || ''));

  // Show column name in pill mode
  const renderWithLabel = (content: React.ReactNode) => {
    if (displayMode === 'pill') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{column.name}:</span>
          {content}
        </div>
      );
    }
    return content;
  };

  const handleSave = () => {
    if (column.column_type === 'number') {
      onChange(editValue ? Number(editValue) : null);
    } else if (column.column_type === 'checkbox') {
      // Checkbox is handled differently
    } else {
      onChange(editValue || null);
    }
    setIsEditing(false);
  };

  // Checkbox type
  if (column.column_type === 'checkbox') {
    return renderWithLabel(
      <button
        onClick={() => onChange(!value)}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          value ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white' : 'border-[#555] hover:border-[#1e3a5f]'
        }`}
      >
        {value && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </button>
    );
  }

  // Date type
  if (column.column_type === 'date') {
    return renderWithLabel(
      <input
        type="date"
        value={String(value || '')}
        onChange={e => onChange(e.target.value || null)}
        className={`${displayMode === 'pill' ? 'w-auto' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20 rounded`}
      />
    );
  }

  // Select type
  if (column.column_type === 'select' || column.column_type === 'status') {
    const options = column.options?.options || [];
    return renderWithLabel(
      <select
        value={String(value || '')}
        onChange={e => onChange(e.target.value || null)}
        className={`${displayMode === 'pill' ? 'w-auto' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20 rounded appearance-none cursor-pointer`}
      >
        <option value="">-</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.value}</option>
        ))}
      </select>
    );
  }

  // Number type
  if (column.column_type === 'number' || column.column_type === 'progress' || column.column_type === 'budget') {
    if (isEditing) {
      return renderWithLabel(
        <input
          type="number"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') {
              setEditValue(String(value || ''));
              setIsEditing(false);
            }
          }}
          className={`${displayMode === 'pill' ? 'w-16' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-[#1e1e1e] border border-[#1e3a5f] rounded focus:outline-none`}
          autoFocus
        />
      );
    }
    return renderWithLabel(
      <span
        onClick={() => {
          setEditValue(String(value || ''));
          setIsEditing(true);
        }}
        className="text-xs text-foreground cursor-text hover:bg-card px-1 py-0.5 rounded min-w-[30px] inline-block"
      >
        {value !== null && value !== undefined ? String(value) : '-'}
      </span>
    );
  }

  // Text type (default)
  if (isEditing) {
    return renderWithLabel(
      <input
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setEditValue(String(value || ''));
            setIsEditing(false);
          }
        }}
        className={`${displayMode === 'pill' ? 'w-24' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-[#1e1e1e] border border-[#1e3a5f] rounded focus:outline-none`}
        autoFocus
      />
    );
  }

  return renderWithLabel(
    <span
      onClick={() => {
        setEditValue(String(value || ''));
        setIsEditing(true);
      }}
      className="text-xs text-foreground cursor-text hover:bg-card px-1 py-0.5 rounded min-w-[30px] inline-block truncate"
    >
      {value ? String(value) : <span className="text-muted-foreground">-</span>}
    </span>
  );
}

// ============================================
// Built-in column definitions
// ============================================
interface BuiltInColumn {
  id: string;
  name: string;
  type: 'builtin';
  builtinType: 'assignees' | 'priority' | 'status' | 'due_date';
  width: number;
  isVisible: boolean;
  options?: { value: string; color?: string }[];
}

const DEFAULT_BUILTIN_COLUMNS: BuiltInColumn[] = [
  {
    id: 'builtin_assignees',
    name: 'Assignees',
    type: 'builtin',
    builtinType: 'assignees',
    width: 96,
    isVisible: true,
  },
  {
    id: 'builtin_priority',
    name: 'Priority',
    type: 'builtin',
    builtinType: 'priority',
    width: 80,
    isVisible: true,
    options: [
      { value: 'low', color: '#eff6ff' },
      { value: 'medium', color: '#f0fdf4' },
      { value: 'high', color: '#fef2f2' },
      { value: 'urgent', color: '#fef2f2' },
    ],
  },
  {
    id: 'builtin_status',
    name: 'Status',
    type: 'builtin',
    builtinType: 'status',
    width: 112,
    isVisible: true,
    options: [
      { value: 'todo', color: '#f5f5f5' },
      { value: 'in_progress', color: '#fef3c7' },
      { value: 'review', color: '#e0e7ff' },
      { value: 'done', color: '#f0fdf4' },
      { value: 'blocked', color: '#fef2f2' },
    ],
  },
  {
    id: 'builtin_due_date',
    name: 'Due date',
    type: 'builtin',
    builtinType: 'due_date',
    width: 112,
    isVisible: true,
  },
];

// ============================================
// Edit Built-in Property Modal
// ============================================
function EditBuiltInPropertyModal({
  column,
  onClose,
  onUpdate,
}: {
  column: BuiltInColumn;
  onClose: () => void;
  onUpdate: (updates: Partial<BuiltInColumn>) => void;
}) {
  const [name, setName] = useState(column.name);
  const [options, setOptions] = useState<{ value: string; color?: string }[]>(column.options || []);
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);

  const handleNameSave = () => {
    if (name.trim() && name !== column.name) {
      onUpdate({ name: name.trim() });
    }
  };

  const handleUpdateOption = (index: number, newValue: string) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], value: newValue };
    setOptions(newOptions);
    onUpdate({ options: newOptions });
    setEditingOptionIndex(null);
  };

  const getTypeLabel = () => {
    switch (column.builtinType) {
      case 'assignees': return 'Person';
      case 'priority': return 'Select';
      case 'status': return 'Status';
      case 'due_date': return 'Date';
      default: return 'Unknown';
    }
  };

  const getTypeIcon = () => {
    switch (column.builtinType) {
      case 'assignees':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
      case 'priority':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 8"/></svg>;
      case 'status':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="4 2"/></svg>;
      case 'due_date':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
      default:
        return null;
    }
  };

  const getPriorityLabel = (value: string) => {
    switch (value) {
      case 'low': return 'Low';
      case 'medium': return 'Normal';
      case 'high': return 'High';
      case 'urgent': return 'Urgent';
      default: return value;
    }
  };

  const getStatusLabel = (value: string) => {
    switch (value) {
      case 'todo': return 'To Do';
      case 'in_progress': return 'In Progress';
      case 'review': return 'Review';
      case 'done': return 'Done';
      case 'blocked': return 'Blocked';
      default: return value;
    }
  };

  const getStatusColor = (value: string) => {
    switch (value) {
      case 'done': return '#22c55e';
      case 'in_progress': return '#f59e0b';
      case 'review': return '#6366f1';
      case 'blocked': return '#ef4444';
      default: return '#888';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] rounded-lg shadow-xl w-[340px] max-h-[600px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1 hover:bg-card rounded">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="text-sm font-medium">Edit property</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-card rounded">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Property Name */}
        <div className="p-3 border-b border-[#333]">
          <div className="flex items-center gap-2 bg-card rounded-lg p-2">
            <span className="text-muted-foreground">{getTypeIcon()}</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); }}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
            />
          </div>
        </div>

        {/* Type */}
        <div className="px-3 py-2 border-b border-[#333]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              Type
            </div>
            <span className="text-sm text-muted-foreground">{getTypeLabel()}</span>
          </div>
        </div>

        {/* Options for Priority/Status */}
        {(column.builtinType === 'priority' || column.builtinType === 'status') && options.length > 0 && (
          <div className="overflow-y-auto max-h-[300px]">
            {column.builtinType === 'status' ? (
              // Status with groups
              <>
                <div className="border-b border-[#333]">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">To-do</span>
                  </div>
                  {options.filter(o => o.value === 'todo').map((option, idx) => {
                    const realIndex = options.findIndex(o => o.value === option.value);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                        {editingOptionIndex === realIndex ? (
                          <input
                            type="text"
                            defaultValue={getStatusLabel(option.value)}
                            autoFocus
                            onBlur={e => handleUpdateOption(realIndex, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleUpdateOption(realIndex, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingOptionIndex(null);
                            }}
                            className="flex-1 text-sm bg-transparent border border-[#1e3a5f] rounded px-1 focus:outline-none"
                          />
                        ) : (
                          <span className="flex-1 text-sm cursor-pointer" onClick={() => setEditingOptionIndex(realIndex)}>
                            {getStatusLabel(option.value)}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">DEFAULT</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-b border-[#333]">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">In progress</span>
                  </div>
                  {options.filter(o => ['in_progress', 'review'].includes(o.value)).map((option, idx) => {
                    const realIndex = options.findIndex(o => o.value === option.value);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                        <span className="flex-1 text-sm">{getStatusLabel(option.value)}</span>
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">Complete</span>
                  </div>
                  {options.filter(o => ['done', 'blocked'].includes(o.value)).map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                      <span className="flex-1 text-sm">{getStatusLabel(option.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              // Priority options
              <div className="p-2">
                <div className="text-xs text-muted-foreground px-2 py-1 mb-1">Options</div>
                {options.map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-card rounded group">
                    <span
                      className="px-2 py-0.5 rounded text-xs"
                      style={{ backgroundColor: option.color || '#f5f5f5' }}
                    >
                      {getPriorityLabel(option.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info for Assignees/Date */}
        {(column.builtinType === 'assignees' || column.builtinType === 'due_date') && (
          <div className="p-4 text-sm text-muted-foreground">
            {column.builtinType === 'assignees'
              ? 'Assign team members to elements. Click on the cell to add or remove assignees.'
              : 'Set due dates for elements. Click on the cell to pick a date.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Built-in Column Header
// ============================================
function BuiltInColumnHeader({
  column,
  onUpdate,
  onDelete,
}: {
  column: BuiltInColumn;
  onUpdate: (updates: Partial<BuiltInColumn>) => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {column.name}
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
          <div className="absolute left-0 top-full mt-1 w-48 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-lg py-1 z-40">
            <button
              onClick={() => {
                setShowMenu(false);
                setShowEditModal(true);
              }}
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-card flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit property
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                onUpdate({ isVisible: false });
              }}
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-card flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              Hide in view
            </button>
            <div className="border-t border-[#333] my-1" />
            <button
              onClick={() => {
                setShowMenu(false);
                onDelete();
              }}
              className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-red-900/20 flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete property
            </button>
          </div>
        </>
      )}

      {showEditModal && (
        <EditBuiltInPropertyModal
          column={column}
          onClose={() => setShowEditModal(false)}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

// ============================================
// Object Detail View - Shows Object with Elements by Section
// ============================================
function ObjectDetailView({ object, onNavigate, onRefresh }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  const [isAddingElement, setIsAddingElement] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

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

  // Notes state (for OneNote-like folder/file structure)
  const { noteTree, refetch: refetchNotes } = useNotes(object.id);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  // Find selected note in tree
  const findNoteById = (notes: NoteWithChildren[], id: string): Note | null => {
    for (const note of notes) {
      if (note.id === id) return note;
      if (note.children) {
        const found = findNoteById(note.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Update selected note when selection changes
  useEffect(() => {
    if (selectedNoteId) {
      const note = findNoteById(noteTree, selectedNoteId);
      setSelectedNote(note);
    } else {
      setSelectedNote(null);
    }
  }, [selectedNoteId, noteTree]);

  const handleCreateNote = async (parentId: string | null, type: 'folder' | 'note') => {
    try {
      const newNote = await createNote({
        object_id: object.id,
        parent_id: parentId,
        type,
        title: type === 'folder' ? 'New Folder' : 'Untitled',
      });
      await refetchNotes();
      if (type === 'note') {
        setSelectedNoteId(newNote.id);
      }
    } catch (e) {
      console.error('Failed to create note:', e);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNote(noteId);
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
      }
      await refetchNotes();
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  };

  const handleRenameNote = async (noteId: string, newTitle: string) => {
    try {
      await updateNote(noteId, { title: newTitle });
      await refetchNotes();
    } catch (e) {
      console.error('Failed to rename note:', e);
    }
  };

  const handleNoteContentChange = async (content: string) => {
    if (!selectedNote || selectedNote.type !== 'note') return;
    try {
      await updateNote(selectedNote.id, { content: JSON.parse(content) });
      await refetchNotes();
    } catch (e) {
      console.error('Failed to save note:', e);
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

  const elements = object.elements || [];
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
      await createCustomColumn({
        object_id: object.id,
        name,
        column_type: type,
        options: type === 'select' || type === 'multi_select' || type === 'status'
          ? { options: [{ value: 'Option 1' }, { value: 'Option 2' }] }
          : {},
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

  // Calculate total table columns: row num + name + visible built-in columns + custom columns + add button
  const visibleBuiltInCount = builtInColumns.filter(col => col.isVisible).length;
  const totalColumns = 2 + visibleBuiltInCount + customColumns.length + 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
      {/* Object Header */}
      <div className="px-5 py-3 border-b border-[#333] bg-[#1e1e1e]">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground"><ObjectIcon size={20} /></span>
          <h1 className="text-lg font-semibold text-foreground">{object.name}</h1>
        </div>
      </div>

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
          <div className={`flex-1 overflow-auto ${currentSelectedElement ? 'border-r border-[#333]' : ''}`}>
            {/* Elements Header */}
            <div className="px-5 py-3 border-b border-[#333] bg-[#1e1e1e] sticky top-0 z-10">
              <div className="flex items-center justify-between">
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
            </div>

        <div className="p-5">
        {/* Add Element Form */}
        {isAddingElement && (
          <div className="mb-4 p-4 bg-[#252525] rounded-lg border border-[#333]">
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
                className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#333] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
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
                  className="flex-1 px-3 py-2 bg-[#1e1e1e] border border-[#333] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
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
          <div className="space-y-0">
            {elementsBySection.map(({ section, elements: sectionElements }) => (
              <div key={section || '__no_section__'}>
                {/* Section Header with line design */}
                {section && <SectionHeader label={section} />}

                {/* Elements Table */}
                <table className="w-full bg-[#1e1e1e] border-collapse">
                  <thead>
                    <tr>
                      <th className="w-12 px-4 py-3 text-left text-xs font-medium text-muted-foreground border-b border-[#333]"></th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground border-b border-[#333]">Name</th>
                      {/* Built-in Columns with Edit capability */}
                      {builtInColumns.filter(col => col.isVisible).map(col => (
                        <th
                          key={col.id}
                          className="px-3 py-3 text-left border-b border-[#333]"
                          style={{ width: col.width }}
                        >
                          <BuiltInColumnHeader
                            column={col}
                            onUpdate={(updates) => handleUpdateBuiltInColumn(col.id, updates)}
                            onDelete={() => handleDeleteBuiltInColumn(col.id)}
                          />
                        </th>
                      ))}
                      {/* Custom Columns */}
                      {customColumns.map(col => (
                        <th
                          key={col.id}
                          className="px-3 py-3 text-left border-b border-[#333]"
                          style={{ width: col.width || 120 }}
                        >
                          <ColumnHeader
                            column={col}
                            onRename={(name) => handleRenameColumn(col.id, name)}
                            onDelete={() => handleDeleteColumn(col.id)}
                            onUpdate={(updates) => handleUpdateColumn(col.id, updates)}
                            onDuplicate={() => handleDuplicateColumn(col)}
                          />
                        </th>
                      ))}
                      {/* Add Column Button */}
                      <th className="w-10 px-2 py-3 text-left border-b border-[#333]">
                        <button
                          onClick={() => setShowAddColumnModal(true)}
                          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-card rounded transition-colors"
                          title="Add column"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionElements.map((element, index) => (
                      <ElementTableRow
                        key={element.id}
                        element={element}
                        rowNumber={index + 1}
                        isSelected={currentSelectedElement?.id === element.id}
                        onSelect={() => setSelectedElement(currentSelectedElement?.id === element.id ? null : element)}
                        onStatusChange={(status) => handleStatusChange(element.id, status)}
                        onRefresh={onRefresh}
                        allElements={elements}
                        customColumns={customColumns}
                        onColumnValueChange={handleColumnValueChange}
                        totalColumns={totalColumns}
                        builtInColumns={builtInColumns}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
        )}

        {/* Note Tab Content */}
        {activeTab?.tab_type === 'note' && (
          <div className="flex-1 flex overflow-hidden bg-[#1e1e1e]">
            {/* Left: Note Explorer (folder tree) */}
            <div className="w-56 border-r border-[#333] flex-shrink-0 overflow-hidden">
              <NoteExplorer
                notes={noteTree}
                selectedNoteId={selectedNoteId}
                onSelectNote={setSelectedNoteId}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onRenameNote={handleRenameNote}
              />
            </div>

            {/* Right: Editor */}
            <div className="flex-1 overflow-auto">
              {selectedNote && selectedNote.type === 'note' ? (
                <div className="max-w-4xl mx-auto py-8 px-6">
                  <h2 className="text-lg font-medium text-foreground mb-4">{selectedNote.title}</h2>
                  <BlockEditor
                    key={selectedNote.id}
                    initialContent={Array.isArray(selectedNote.content) ? JSON.stringify(selectedNote.content) : undefined}
                    onChange={handleNoteContentChange}
                  />
                </div>
              ) : selectedNote && selectedNote.type === 'folder' ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <p>Folder: {selectedNote.title}</p>
                    <p className="text-sm mt-1">Select a note to edit</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <p>Select a note to start editing</p>
                    <p className="text-sm mt-1">or create a new one</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary Tab Content */}
        {activeTab?.tab_type === 'summary' && (
          <div className="flex-1 overflow-auto bg-[#1e1e1e] p-8">
            <div className="text-center text-muted-foreground">
              <p>Summary view coming soon...</p>
            </div>
          </div>
        )}

        {/* Gantt Tab Content */}
        {activeTab?.tab_type === 'gantt' && (
          <div className="flex-1 overflow-auto bg-[#1e1e1e] p-8">
            <div className="text-center text-muted-foreground">
              <p>Gantt chart coming soon...</p>
            </div>
          </div>
        )}

        {/* Calendar Tab Content */}
        {activeTab?.tab_type === 'calendar' && (
          <div className="flex-1 overflow-auto bg-[#1e1e1e] p-8">
            <div className="text-center text-muted-foreground">
              <p>Calendar view coming soon...</p>
            </div>
          </div>
        )}

        {/* Workers Tab Content */}
        {activeTab?.tab_type === 'workers' && (
          <div className="flex-1 overflow-auto bg-[#1e1e1e] p-8">
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
    </div>
  );
}

// ============================================
// Element Table Row (new table format)
// ============================================
function ElementTableRow({ element, rowNumber, isSelected, onSelect, onStatusChange, onRefresh, allElements, customColumns, onColumnValueChange, totalColumns, builtInColumns }: {
  element: ElementWithDetails;
  rowNumber: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onStatusChange: (status: string) => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
  customColumns?: CustomColumnWithValues[];
  onColumnValueChange?: (columnId: string, elementId: string, value: Json) => void;
  totalColumns?: number;
  builtInColumns?: BuiltInColumn[];
}) {
  const [isSubelementsExpanded, setIsSubelementsExpanded] = useState(false);
  const hasSubelements = element.subelements && element.subelements.length > 0;

  const priorityBadges: Record<string, { bg: string; text: string; label: string }> = {
    urgent: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'Urgent' },
    high: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'High' },
    medium: { bg: 'bg-[#f0fdf4]', text: 'text-[#152a45]', label: 'Normal' },
    low: { bg: 'bg-[#eff6ff]', text: 'text-[#2563eb]', label: 'Low' },
  };

  const statusBadges: Record<string, { bg: string; text: string; label: string }> = {
    todo: { bg: 'bg-card', text: 'text-muted-foreground', label: 'To Do' },
    in_progress: { bg: 'bg-[#fef3c7]', text: 'text-[#d97706]', label: 'In Progress' },
    review: { bg: 'bg-[#e0e7ff]', text: 'text-[#4f46e5]', label: 'Review' },
    done: { bg: 'bg-[#f0fdf4]', text: 'text-[#152a45]', label: 'Done' },
    blocked: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'Blocked' },
  };

  const priority = priorityBadges[element.priority || 'medium'] || priorityBadges.medium;
  const status = statusBadges[element.status || 'todo'] || statusBadges.todo;

  // Format due date
  const formatDueDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Render built-in column cell
  const renderBuiltInCell = (col: BuiltInColumn) => {
    switch (col.builtinType) {
      case 'assignees':
        return (
          <div className="flex items-center -space-x-1">
            {element.assignees && element.assignees.length > 0 ? (
              <>
                {element.assignees.slice(0, 3).map((assignee, idx) => (
                  <div
                    key={assignee.id}
                    className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground border-2 border-white"
                    title={assignee.worker?.name || 'Unknown'}
                    style={{ zIndex: 3 - idx }}
                  >
                    {assignee.worker?.type === 'human' ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    ) : assignee.worker?.type === 'ai_agent' ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="10" rx="2" />
                        <circle cx="12" cy="5" r="2" />
                        <path d="M12 7v4" />
                      </svg>
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="8" width="20" height="14" rx="2" />
                        <path d="M12 2v6" />
                      </svg>
                    )}
                  </div>
                ))}
                {element.assignees.length > 3 && (
                  <div className="w-6 h-6 rounded-full bg-card flex items-center justify-center text-[10px] text-muted-foreground border-2 border-white font-medium">
                    +{element.assignees.length - 3}
                  </div>
                )}
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">-</span>
            )}
          </div>
        );
      case 'priority':
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${priority.bg} ${priority.text}`}>
            {priority.label}
          </span>
        );
      case 'status':
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        );
      case 'due_date':
        return element.due_date ? (
          <span className="text-xs text-muted-foreground">{formatDueDate(element.due_date)}</span>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add date
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <tr
        className={`border-b border-[#333] hover:bg-[#252525] transition-colors cursor-pointer ${isSelected ? 'bg-[#e4e6f1]' : ''}`}
        onClick={onSelect}
      >
        {/* Row number */}
        <td className="px-4 py-3 text-xs text-muted-foreground">{rowNumber}</td>

        {/* Name cell */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            {/* Expand/Collapse button for subelements */}
            {hasSubelements ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSubelementsExpanded(!isSubelementsExpanded);
                }}
                className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-[#f0f0f0] rounded transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${isSubelementsExpanded ? 'rotate-90' : ''}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : (
              <div className="w-5" />
            )}

            {/* Checkbox */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(element.status === 'done' ? 'todo' : 'done');
              }}
              className={`w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${
                element.status === 'done'
                  ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                  : 'border-[#555] hover:border-[#1e3a5f]'
              }`}
            >
              {element.status === 'done' && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>

            {/* Title */}
            <span className={`text-[13px] ${element.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {element.title}
            </span>

            {/* Subelement count badge */}
            {hasSubelements && (
              <span className="text-[10px] text-muted-foreground bg-card px-1.5 py-0.5 rounded">
                {element.subelements!.filter(s => s.is_completed).length}/{element.subelements!.length}
              </span>
            )}
          </div>
        </td>

        {/* Built-in Columns (dynamically rendered) */}
        {builtInColumns?.filter(col => col.isVisible).map(col => (
          <td key={col.id} className="px-3 py-3">
            {renderBuiltInCell(col)}
          </td>
        ))}

        {/* Custom Columns */}
        {customColumns?.map(col => (
          <td key={col.id} className="px-3 py-3" onClick={e => e.stopPropagation()}>
            <CustomColumnCell
              column={col}
              elementId={element.id}
              value={col.values?.[element.id]?.value ?? null}
              onChange={(value) => onColumnValueChange?.(col.id, element.id, value)}
            />
          </td>
        ))}

        {/* Empty cell for add column button */}
        <td className="px-2 py-3"></td>
      </tr>

      {/* Expanded Subelements */}
      {isSubelementsExpanded && hasSubelements && element.subelements!.map((subelement) => (
        <tr key={subelement.id} className="bg-[#252525] border-b border-[#333]">
          <td className="px-4 py-2 text-xs text-muted-foreground"></td>
          <td className="px-3 py-2" colSpan={(totalColumns || 7) - 1}>
            <div className="flex items-center gap-2 pl-7">
              <SubelementRow subelement={subelement} onRefresh={onRefresh} />
            </div>
          </td>
        </tr>
      ))}

      {/* Inline Detail Panel */}
      {isSelected && (
        <tr>
          <td colSpan={totalColumns || 7} className="p-0">
            <ElementInlineDetail
              element={element}
              onClose={onSelect!}
              onRefresh={onRefresh}
              allElements={allElements}
              customColumns={customColumns}
              onColumnValueChange={onColumnValueChange}
              builtInColumns={builtInColumns}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================
// Subelement Row
// ============================================
function SubelementRow({ subelement, onRefresh }: {
  subelement: { id: string; title: string; is_completed: boolean | null };
  onRefresh?: () => void;
}) {
  const handleToggle = async () => {
    try {
      await toggleSubelementComplete(subelement.id, !subelement.is_completed);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to toggle subelement:', e);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={handleToggle}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          subelement.is_completed
            ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        {subelement.is_completed && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <span className={subelement.is_completed ? 'text-gray-400 line-through' : 'text-[var(--text-secondary)]'}>
        {subelement.title}
      </span>
    </div>
  );
}

// ============================================
// Element Inline Detail - Expands below the row
// ============================================
function ElementInlineDetail({ element, onClose, onRefresh, allElements, customColumns, onColumnValueChange, builtInColumns }: {
  element: ElementWithDetails;
  onClose: () => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
  customColumns?: CustomColumnWithValues[];
  onColumnValueChange?: (columnId: string, elementId: string, value: Json) => void;
  builtInColumns?: BuiltInColumn[];
}) {
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [newSubelementTitle, setNewSubelementTitle] = useState('');
  const [isAddingSubelement, setIsAddingSubelement] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Assignees state
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Edges state
  const [edges, setEdges] = useState<{ incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] }>({ incoming: [], outgoing: [] });
  const [showEdgeModal, setShowEdgeModal] = useState(false);
  const [newEdgeType, setNewEdgeType] = useState<EdgeType>('depends_on');
  const [newEdgeTargetId, setNewEdgeTargetId] = useState('');
  const [edgeSearchQuery, setEdgeSearchQuery] = useState('');

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
  }, [element.id, element.title, element.description]);

  // Fetch workers on mount
  useEffect(() => {
    fetchAllWorkers().then(setAllWorkers).catch(console.error);
  }, []);

  // Fetch edges
  useEffect(() => {
    getElementEdges(element.id).then(setEdges).catch(console.error);
  }, [element.id]);

  const handleTitleSave = async () => {
    if (title.trim() && title !== element.title) {
      try {
        await updateElement(element.id, { title: title.trim() });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update title:', e);
      }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== element.description) {
      try {
        await updateElement(element.id, { description: description || null });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update description:', e);
      }
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateElement(element.id, { status: newStatus as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleDueDateChange = async (newDate: string) => {
    try {
      await updateElement(element.id, { due_date: newDate || null });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update due date:', e);
    }
  };

  const handleAddSubelement = async () => {
    if (!newSubelementTitle.trim()) return;
    try {
      await createSubelement({
        element_id: element.id,
        title: newSubelementTitle.trim(),
      });
      setNewSubelementTitle('');
      setIsAddingSubelement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add subelement:', e);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteElement(element.id);
      onClose();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete element:', e);
    }
  };

  const handleDuplicate = async () => {
    try {
      await createElement({
        title: `${element.title} (copy)`,
        object_id: element.object_id,
        description: element.description,
        section: element.section,
        status: element.status || 'todo',
        priority: element.priority || 'medium',
        due_date: element.due_date,
      });
      setShowActionsMenu(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate element:', e);
    }
  };

  // Assignee handlers
  const handleAddAssignee = async (workerId: string) => {
    try {
      await addElementAssignee({
        element_id: element.id,
        worker_id: workerId,
        role: 'assignee',
      });
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add assignee:', e);
    }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to remove assignee:', e);
    }
  };

  // Edge handlers
  const handleAddEdge = async () => {
    if (!newEdgeTargetId) return;
    try {
      await createElementEdge({
        from_element: element.id,
        to_element: newEdgeTargetId,
        edge_type: newEdgeType,
      });
      setShowEdgeModal(false);
      setNewEdgeTargetId('');
      setEdgeSearchQuery('');
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add edge:', e);
    }
  };

  const handleRemoveEdge = async (edgeId: string) => {
    try {
      await deleteElementEdge(edgeId);
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
    } catch (e) {
      console.error('Failed to remove edge:', e);
    }
  };

  // Get worker icon
  const getWorkerIcon = (type: string) => {
    switch (type) {
      case 'human':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
      case 'ai_agent':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></svg>;
      case 'robot':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="8" width="20" height="14" rx="2" /><path d="M12 2v6" /></svg>;
      default:
        return null;
    }
  };

  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));

  const edgeTypeLabels: Record<EdgeType, string> = {
    spawns: 'Spawns',
    depends_on: 'Depends On',
    merges_into: 'Merges Into',
    splits_to: 'Splits To',
    references: 'References',
    cancels: 'Cancels',
  };

  const filteredElements = (allElements || []).filter(e =>
    e.id !== element.id &&
    e.title.toLowerCase().includes(edgeSearchQuery.toLowerCase())
  ).slice(0, 10);

  const statusOptions = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
    { value: 'blocked', label: 'Blocked' },
  ];

  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  return (
    <div className="bg-[#252525] border-b border-[#333] animate-in slide-in-from-top-2 duration-200">
      <div className="p-5">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }}
            className="text-lg font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 w-full"
            placeholder="Element title"
          />
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded transition-colors ml-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <div className="mb-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescriptionSave}
            placeholder="Brief describe the goal of this element..."
            className="w-full px-3 py-3 text-sm text-muted-foreground bg-[#1e1e1e] border border-[#333] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] min-h-[80px] resize-none"
          />
        </div>

        {/* Property Pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Assignees Pill */}
          <div className="relative">
            <button
              onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm hover:bg-card transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="text-[#333]">
                {element.assignees && element.assignees.length > 0
                  ? element.assignees.map(a => a.worker?.name).filter(Boolean).join(', ')
                  : 'Assignee'}
              </span>
            </button>
            {showAssigneeDropdown && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                {element.assignees?.map(assignee => (
                  <div key={assignee.id} className="px-3 py-2 flex items-center justify-between hover:bg-card">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        {assignee.worker && getWorkerIcon(assignee.worker.type)}
                      </span>
                      <span className="text-sm">{assignee.worker?.name}</span>
                    </div>
                    <button onClick={() => handleRemoveAssignee(assignee.id)} className="text-muted-foreground hover:text-[#dc2626]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
                {availableWorkers.length > 0 && (
                  <>
                    {element.assignees && element.assignees.length > 0 && <div className="border-t border-[#333] my-1" />}
                    {availableWorkers.map(worker => (
                      <button
                        key={worker.id}
                        onClick={() => handleAddAssignee(worker.id)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-card flex items-center gap-2"
                      >
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                          {getWorkerIcon(worker.type)}
                        </span>
                        {worker.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Due Date Pill */}
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm hover:bg-card transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[#333]">
              {element.due_date ? new Date(element.due_date).toLocaleDateString() : 'Due Date'}
            </span>
            <input
              type="date"
              value={element.due_date?.split('T')[0] || ''}
              onChange={(e) => handleDueDateChange(e.target.value)}
              className="sr-only"
            />
          </label>

          {/* Status Pill */}
          <select
            value={element.status || 'todo'}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm hover:bg-card transition-colors cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b6b6b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
          >
            {statusOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Priority Pill */}
          <select
            value={element.priority || 'medium'}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm hover:bg-card transition-colors cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b6b6b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
          >
            {priorityOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Dependencies Pill */}
          <button
            onClick={() => setShowEdgeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm hover:bg-card transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            <span className="text-[#333]">
              {edges.incoming.length + edges.outgoing.length > 0
                ? `${edges.incoming.length + edges.outgoing.length} linked`
                : 'Dependencies'}
            </span>
          </button>

          {/* Custom Columns Pills */}
          {customColumns?.filter(col => col.is_visible !== false).map(col => (
            <div key={col.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border border-[#333] rounded-full text-sm">
              <CustomColumnCell
                column={col}
                elementId={element.id}
                value={col.values?.[element.id]?.value ?? null}
                onChange={(value) => onColumnValueChange?.(col.id, element.id, value)}
                displayMode="pill"
              />
            </div>
          ))}
        </div>

        {/* Subelements Section */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">Subelements</span>
            <button
              onClick={() => setIsAddingSubelement(true)}
              className="text-xs text-[#1e3a5f] hover:underline"
            >
              + Add
            </button>
          </div>
          <div className="space-y-1">
            {element.subelements?.map(sub => (
              <SubelementRow key={sub.id} subelement={sub} onRefresh={onRefresh} />
            ))}
            {isAddingSubelement && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubelementTitle}
                  onChange={(e) => setNewSubelementTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddSubelement();
                    if (e.key === 'Escape') { setNewSubelementTitle(''); setIsAddingSubelement(false); }
                  }}
                  placeholder="Subelement title..."
                  className="flex-1 px-2 py-1 text-sm border border-[#333] rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
                  autoFocus
                />
                <button onClick={handleAddSubelement} className="px-2 py-1 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#152a45]">Add</button>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-[#333]">
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-muted rounded transition-colors text-muted-foreground" title="Attach file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="p-2 hover:bg-muted rounded transition-colors text-muted-foreground"
                title="More actions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
              {showActionsMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-40 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-lg py-1 z-20">
                  <button onClick={handleDuplicate} className="w-full px-3 py-2 text-left text-sm hover:bg-card">Duplicate</button>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?element=${element.id}`); setShowActionsMenu(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-card">Copy link</button>
                  <div className="border-t border-[#333] my-1" />
                  <button onClick={() => { setShowActionsMenu(false); setShowDeleteConfirm(true); }} className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-red-900/20">Delete</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e1e1e] rounded-lg p-6 w-[340px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-center mb-1">Delete &apos;{element.title}&apos;?</h3>
            <p className="text-[13px] text-muted-foreground text-center mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDelete} className="w-full py-2 bg-[#ff3b30] text-white rounded-md hover:bg-[#ff3b30]/90 font-medium">Delete</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="w-full py-2 border border-[#333] rounded-md hover:bg-card">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Edge Modal */}
      {showEdgeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e1e1e] rounded-lg p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold mb-4">Add Dependency</h3>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <select value={newEdgeType} onChange={(e) => setNewEdgeType(e.target.value as EdgeType)} className="w-full px-3 py-2 text-sm border border-[#333] rounded-md">
                <option value="depends_on">Depends On</option>
                <option value="spawns">Spawns</option>
                <option value="references">References</option>
                <option value="merges_into">Merges Into</option>
                <option value="splits_to">Splits To</option>
                <option value="cancels">Cancels</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Target Element</label>
              <input type="text" value={edgeSearchQuery} onChange={(e) => { setEdgeSearchQuery(e.target.value); setNewEdgeTargetId(''); }} placeholder="Search elements..." className="w-full px-3 py-2 text-sm border border-[#333] rounded-md" />
              {edgeSearchQuery && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-[#333] rounded-md">
                  {filteredElements.map(el => (
                    <button key={el.id} onClick={() => { setNewEdgeTargetId(el.id); setEdgeSearchQuery(el.title); }} className={`w-full px-3 py-2 text-left text-sm hover:bg-card ${newEdgeTargetId === el.id ? 'bg-[#f0fdf4]' : ''}`}>{el.title}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowEdgeModal(false); setNewEdgeTargetId(''); setEdgeSearchQuery(''); }} className="px-4 py-2 text-sm border border-[#333] rounded-md hover:bg-card">Cancel</button>
              <button onClick={handleAddEdge} disabled={!newEdgeTargetId} className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-md hover:bg-[#152a45] disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Element Detail Panel - Right sidebar for element details (LEGACY - kept for reference)
// ============================================
function ElementDetailPanel({ element, onClose, onRefresh, allElements }: {
  element: ElementWithDetails;
  onClose: () => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [newSubelementTitle, setNewSubelementTitle] = useState('');
  const [isAddingSubelement, setIsAddingSubelement] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Assignees state
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Edges state
  const [edges, setEdges] = useState<{ incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] }>({ incoming: [], outgoing: [] });
  const [showEdgeModal, setShowEdgeModal] = useState(false);
  const [newEdgeType, setNewEdgeType] = useState<EdgeType>('depends_on');
  const [newEdgeTargetId, setNewEdgeTargetId] = useState('');
  const [edgeSearchQuery, setEdgeSearchQuery] = useState('');

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
  }, [element.id, element.title, element.description]);

  // Fetch workers on mount
  useEffect(() => {
    fetchAllWorkers().then(setAllWorkers).catch(console.error);
  }, []);

  // Fetch edges on mount and when element changes
  useEffect(() => {
    getElementEdges(element.id).then(setEdges).catch(console.error);
  }, [element.id]);

  const handleTitleSave = async () => {
    if (title.trim() && title !== element.title) {
      try {
        await updateElement(element.id, { title: title.trim() });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update title:', e);
      }
    }
    setIsEditingTitle(false);
  };

  const handleDescriptionSave = async () => {
    if (description !== element.description) {
      try {
        await updateElement(element.id, { description: description || null });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update description:', e);
      }
    }
    setIsEditingDescription(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateElement(element.id, { status: newStatus as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleDueDateChange = async (newDate: string) => {
    try {
      await updateElement(element.id, { due_date: newDate || null });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update due date:', e);
    }
  };

  const handleAddSubelement = async () => {
    if (!newSubelementTitle.trim()) return;
    try {
      await createSubelement({
        element_id: element.id,
        title: newSubelementTitle.trim(),
      });
      setNewSubelementTitle('');
      setIsAddingSubelement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add subelement:', e);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteElement(element.id);
      onClose();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete element:', e);
    }
  };

  const handleDuplicate = async () => {
    try {
      await createElement({
        title: `${element.title} (copy)`,
        object_id: element.object_id,
        description: element.description,
        section: element.section,
        status: element.status || 'todo',
        priority: element.priority || 'medium',
        due_date: element.due_date,
      });
      setShowActionsMenu(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate element:', e);
    }
  };

  // Assignee handlers
  const handleAddAssignee = async (workerId: string) => {
    try {
      await addElementAssignee({
        element_id: element.id,
        worker_id: workerId,
        role: 'assignee',
      });
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add assignee:', e);
    }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to remove assignee:', e);
    }
  };

  // Edge handlers
  const handleAddEdge = async () => {
    if (!newEdgeTargetId) return;
    try {
      await createElementEdge({
        from_element: element.id,
        to_element: newEdgeTargetId,
        edge_type: newEdgeType,
      });
      setShowEdgeModal(false);
      setNewEdgeTargetId('');
      setEdgeSearchQuery('');
      // Refresh edges
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add edge:', e);
    }
  };

  const handleRemoveEdge = async (edgeId: string) => {
    try {
      await deleteElementEdge(edgeId);
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
    } catch (e) {
      console.error('Failed to remove edge:', e);
    }
  };

  // Get worker icon based on type
  const getWorkerIcon = (type: string) => {
    switch (type) {
      case 'human':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
      case 'ai_agent':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" />
            <line x1="16" y1="16" x2="16" y2="16" />
          </svg>
        );
      case 'robot':
        return (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="8" width="20" height="14" rx="2" />
            <path d="M12 2v6" />
            <circle cx="8" cy="14" r="2" />
            <circle cx="16" cy="14" r="2" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Filter available workers (exclude already assigned)
  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));

  // Edge type labels
  const edgeTypeLabels: Record<EdgeType, string> = {
    spawns: 'Spawns',
    depends_on: 'Depends On',
    merges_into: 'Merges Into',
    splits_to: 'Splits To',
    references: 'References',
    cancels: 'Cancels',
  };

  // Filter elements for edge search
  const filteredElements = (allElements || []).filter(e =>
    e.id !== element.id &&
    e.title.toLowerCase().includes(edgeSearchQuery.toLowerCase())
  ).slice(0, 10);

  const statusOptions = [
    { value: 'todo', label: 'To Do', color: '#6b6b6b' },
    { value: 'in_progress', label: 'In Progress', color: '#d97706' },
    { value: 'review', label: 'Review', color: '#4f46e5' },
    { value: 'done', label: 'Done', color: '#152a45' },
    { value: 'blocked', label: 'Blocked', color: '#dc2626' },
  ];

  const priorityOptions = [
    { value: 'low', label: 'Low', color: '#2563eb' },
    { value: 'medium', label: 'Normal', color: '#152a45' },
    { value: 'high', label: 'High', color: '#dc2626' },
    { value: 'urgent', label: 'Urgent', color: '#dc2626' },
  ];

  return (
    <div className="w-[400px] flex-shrink-0 bg-[#1e1e1e] overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#333] flex items-center justify-between sticky top-0 bg-[#1e1e1e] z-10">
        <div className="flex items-center gap-2">
          {/* Complete checkbox */}
          <button
            onClick={() => handleStatusChange(element.status === 'done' ? 'todo' : 'done')}
            className={`w-5 h-5 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${
              element.status === 'done'
                ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white'
                : 'border-[#555] hover:border-[#1e3a5f]'
            }`}
          >
            {element.status === 'done' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <span className="text-sm font-medium text-foreground">Element Details</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Actions menu button */}
          <div className="relative">
            <button
              onClick={() => setShowActionsMenu(!showActionsMenu)}
              className="p-1.5 hover:bg-card rounded transition-colors"
              title="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            {/* Actions dropdown */}
            {showActionsMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-lg py-1 z-20">
                <button
                  onClick={handleDuplicate}
                  className="w-full px-3 py-2 text-left text-sm text-[#333] hover:bg-card flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Duplicate
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}?element=${element.id}`);
                    setShowActionsMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-[#333] hover:bg-card flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                  Copy link
                </button>
                <div className="border-t border-[#333] my-1" />
                <button
                  onClick={() => {
                    setShowActionsMenu(false);
                    setShowDeleteConfirm(true);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-red-900/20 flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  Delete
                </button>
              </div>
            )}
          </div>
          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-card rounded transition-colors"
            title="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Title */}
        <div>
          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') {
                  setTitle(element.title);
                  setIsEditingTitle(false);
                }
              }}
              className="w-full text-lg font-semibold text-foreground bg-transparent border-b-2 border-[#1e3a5f] focus:outline-none"
              autoFocus
            />
          ) : (
            <h2
              className={`text-lg font-semibold cursor-pointer hover:bg-card px-1 py-0.5 -mx-1 rounded ${element.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
              onClick={() => setIsEditingTitle(true)}
            >
              {element.title}
            </h2>
          )}
        </div>

        {/* Status & Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <select
              value={element.status || 'todo'}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
            <select
              value={element.priority || 'medium'}
              onChange={(e) => handlePriorityChange(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
            >
              {priorityOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Due Date */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
          <input
            type="date"
            value={element.due_date?.split('T')[0] || ''}
            onChange={(e) => handleDueDateChange(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Description</label>
          {isEditingDescription ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionSave}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDescription(element.description || '');
                  setIsEditingDescription(false);
                }
              }}
              placeholder="Add description..."
              className="w-full px-2 py-1.5 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] min-h-[100px] resize-none"
              autoFocus
            />
          ) : (
            <div
              className="w-full px-2 py-1.5 text-sm border border-[#333] rounded-md bg-[#1e1e1e] min-h-[60px] cursor-pointer hover:bg-card"
              onClick={() => setIsEditingDescription(true)}
            >
              {element.description || <span className="text-muted-foreground">Add description...</span>}
            </div>
          )}
        </div>

        {/* Assignees (Multiple) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Assignees</label>
            <div className="relative">
              <button
                onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                className="text-xs text-[#1e3a5f] hover:underline"
              >
                + Add assignee
              </button>
              {showAssigneeDropdown && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-[#1e1e1e] border border-[#333] rounded-lg shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                  {availableWorkers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No available workers</p>
                  ) : (
                    availableWorkers.map(worker => (
                      <button
                        key={worker.id}
                        onClick={() => handleAddAssignee(worker.id)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-card flex items-center gap-2"
                      >
                        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                          {getWorkerIcon(worker.type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[#333] truncate">{worker.name}</div>
                          <div className="text-[10px] text-muted-foreground capitalize">{worker.type.replace('_', ' ')}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {element.assignees?.map(assignee => (
              <div key={assignee.id} className="flex items-center gap-2 py-1 px-2 bg-card rounded group">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  {assignee.worker && getWorkerIcon(assignee.worker.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#333] truncate">{assignee.worker?.name || 'Unknown'}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{assignee.worker?.type.replace('_', ' ')}</div>
                </div>
                <button
                  onClick={() => handleRemoveAssignee(assignee.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-opacity"
                  title="Remove assignee"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            {(!element.assignees || element.assignees.length === 0) && (
              <p className="text-xs text-muted-foreground">No assignees</p>
            )}
          </div>
        </div>

        {/* Dependencies (Edges) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Dependencies</label>
            <button
              onClick={() => setShowEdgeModal(true)}
              className="text-xs text-[#1e3a5f] hover:underline"
            >
              + Add dependency
            </button>
          </div>
          <div className="space-y-2">
            {/* Outgoing edges */}
            {edges.outgoing.length > 0 && (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">→ This element...</div>
                {edges.outgoing.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 py-1 px-2 bg-[#f0fdf4] rounded text-sm group mb-1">
                    <span className="text-[10px] text-[#152a45] font-medium">{edgeTypeLabels[edge.edge_type]}</span>
                    <span className="text-[#333] truncate flex-1">{edge.related_element?.title || 'Unknown'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      edge.related_element?.status === 'done' ? 'bg-[#dcfce7] text-[#152a45]' : 'bg-card text-muted-foreground'
                    }`}>
                      {edge.related_element?.status || 'unknown'}
                    </span>
                    <button
                      onClick={() => handleRemoveEdge(edge.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#dcfce7] rounded transition-opacity"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Incoming edges */}
            {edges.incoming.length > 0 && (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">← Other elements...</div>
                {edges.incoming.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 py-1 px-2 bg-[#eff6ff] rounded text-sm group mb-1">
                    <span className="text-[10px] text-[#2563eb] font-medium">{edgeTypeLabels[edge.edge_type]}</span>
                    <span className="text-[#333] truncate flex-1">{edge.related_element?.title || 'Unknown'}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      edge.related_element?.status === 'done' ? 'bg-[#dcfce7] text-[#152a45]' : 'bg-card text-muted-foreground'
                    }`}>
                      {edge.related_element?.status || 'unknown'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {edges.incoming.length === 0 && edges.outgoing.length === 0 && (
              <p className="text-xs text-muted-foreground">No dependencies</p>
            )}
          </div>
        </div>

        {/* Subelements */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted-foreground">Subelements</label>
            <button
              onClick={() => setIsAddingSubelement(true)}
              className="text-xs text-[#1e3a5f] hover:underline"
            >
              + Add subelement
            </button>
          </div>
          <div className="space-y-1">
            {element.subelements?.map(sub => (
              <SubelementRow key={sub.id} subelement={sub} onRefresh={onRefresh} />
            ))}
            {isAddingSubelement && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubelementTitle}
                  onChange={(e) => setNewSubelementTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddSubelement();
                    if (e.key === 'Escape') {
                      setNewSubelementTitle('');
                      setIsAddingSubelement(false);
                    }
                  }}
                  placeholder="Subelement title..."
                  className="flex-1 px-2 py-1 text-sm border border-[#333] rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                  autoFocus
                />
                <button
                  onClick={handleAddSubelement}
                  className="px-2 py-1 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#152a45]"
                >
                  Add
                </button>
              </div>
            )}
            {(!element.subelements || element.subelements.length === 0) && !isAddingSubelement && (
              <p className="text-xs text-muted-foreground">No subelements yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e1e1e] rounded-lg p-6 w-[340px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-center mb-1">
              Delete &apos;{element.title}&apos;?
            </h3>
            <p className="text-[13px] text-muted-foreground text-center mb-5">
              This action cannot be undone.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDelete}
                className="w-full py-2 bg-[#ff3b30] text-white rounded-md hover:bg-[#ff3b30]/90 font-medium"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-2 border border-[#333] rounded-md hover:bg-card"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Edge Modal */}
      {showEdgeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1e1e1e] rounded-lg p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold mb-4">Add Dependency</h3>

            {/* Edge Type */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <select
                value={newEdgeType}
                onChange={(e) => setNewEdgeType(e.target.value as EdgeType)}
                className="w-full px-3 py-2 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              >
                <option value="depends_on">Depends On</option>
                <option value="spawns">Spawns</option>
                <option value="references">References</option>
                <option value="merges_into">Merges Into</option>
                <option value="splits_to">Splits To</option>
                <option value="cancels">Cancels</option>
              </select>
            </div>

            {/* Target Element Search */}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Target Element</label>
              <input
                type="text"
                value={edgeSearchQuery}
                onChange={(e) => {
                  setEdgeSearchQuery(e.target.value);
                  setNewEdgeTargetId('');
                }}
                placeholder="Search elements..."
                className="w-full px-3 py-2 text-sm border border-[#333] rounded-md bg-[#1e1e1e] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              />
              {edgeSearchQuery && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-[#333] rounded-md">
                  {filteredElements.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No elements found</p>
                  ) : (
                    filteredElements.map(el => (
                      <button
                        key={el.id}
                        onClick={() => {
                          setNewEdgeTargetId(el.id);
                          setEdgeSearchQuery(el.title);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-card flex items-center justify-between ${
                          newEdgeTargetId === el.id ? 'bg-[#f0fdf4]' : ''
                        }`}
                      >
                        <span className="truncate">{el.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          el.status === 'done' ? 'bg-[#dcfce7] text-[#152a45]' : 'bg-card text-muted-foreground'
                        }`}>
                          {el.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowEdgeModal(false);
                  setNewEdgeTargetId('');
                  setEdgeSearchQuery('');
                }}
                className="px-4 py-2 text-sm border border-[#333] rounded-md hover:bg-card"
              >
                Cancel
              </button>
              <button
                onClick={handleAddEdge}
                disabled={!newEdgeTargetId}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-md hover:bg-[#152a45] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// NOTES/DOCUMENTS View - Notion-like full page editor
// ============================================
interface NotesViewProps {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
}

import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { FileText, Folder } from 'lucide-react';

function NotesView({ navigation, onNavigate }: NotesViewProps) {
  const { documents, documentTree, refetch: refetchDocs } = useDocuments();
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // Find document by ID in the tree
  const findDocById = (docs: DocumentWithChildren[], docId: string): Document | null => {
    for (const doc of docs) {
      if (doc.id === docId) return doc;
      if (doc.children) {
        const found = findDocById(doc.children, docId);
        if (found) return found;
      }
    }
    return null;
  };

  // Update selected document when documentId or tree changes
  useEffect(() => {
    if (navigation.documentId) {
      const doc = findDocById(documentTree, navigation.documentId);
      setSelectedDoc(doc);
      if (doc) {
        setTitleValue(doc.title || '');
      }
    } else {
      setSelectedDoc(null);
      setTitleValue('');
    }
  }, [navigation.documentId, documentTree]);

  const handleContentChange = async (content: string) => {
    if (!selectedDoc || selectedDoc.type !== 'page') return;
    try {
      await updateDocument(selectedDoc.id, { content: JSON.parse(content) });
    } catch (err) {
      console.error('Failed to save document content:', err);
    }
  };

  const handleTitleChange = async () => {
    if (!selectedDoc) return;
    if (titleValue !== selectedDoc.title) {
      try {
        await updateDocument(selectedDoc.id, { title: titleValue });
        refetchDocs();
      } catch (err) {
        console.error('Failed to update title:', err);
      }
    }
    setEditingTitle(false);
  };

  // Notion-like empty state
  if (!navigation.documentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background">
        <Card className="border-none bg-transparent shadow-none">
          <CardContent className="text-center pt-6">
            <div className="text-6xl mb-4">
              <FileText size={64} className="mx-auto text-muted-foreground" />
            </div>
            <h2 className="text-xl font-medium mb-2">Select a page</h2>
            <p className="text-sm text-muted-foreground">
              Choose a page from the sidebar or create a new one to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Folder view
  if (selectedDoc && selectedDoc.type === 'folder') {
    const childDocs = documents.filter(d => d.parent_id === selectedDoc.id);
    return (
      <div className="flex-1 flex flex-col bg-background">
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto w-full px-24 pt-20 pb-32">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-4xl">{selectedDoc.icon || <Folder size={48} className="text-muted-foreground" />}</span>
            </div>
            <h1 className="text-4xl font-bold mb-8">
              {selectedDoc.title || 'Untitled'}
            </h1>

            {/* Child pages */}
            <div className="space-y-1">
              {childDocs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pages inside this folder yet.</p>
              ) : (
                childDocs.map(child => (
                  <Card
                    key={child.id}
                    className="cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => onNavigate({ documentId: child.id })}
                  >
                    <CardContent className="flex items-center gap-3 p-3">
                      {child.icon ? (
                        <span className="text-lg">{child.icon}</span>
                      ) : child.type === 'folder' ? (
                        <Folder size={18} className="text-muted-foreground" />
                      ) : (
                        <FileText size={18} className="text-muted-foreground" />
                      )}
                      <span className="text-sm">{child.title || 'Untitled'}</span>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Page view - Notion-like
  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Fixed Toolbar at top */}
      <div
        id="notes-toolbar-container"
        className="border-b border-border bg-card px-4 py-1 flex items-center gap-1 min-h-[44px]"
      />

      <ScrollArea className="flex-1">
        <div className="max-w-4xl w-full px-12 pt-12 pb-32">
          {/* Icon & Title */}
          <div className="mb-4">
            {selectedDoc?.icon && (
              <span className="text-6xl block mb-4">{selectedDoc.icon}</span>
            )}

            {/* Editable title */}
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTitleChange();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Untitled"
              className="no-focus-ring text-4xl font-bold w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* BlockNote Editor */}
          <div className="notion-editor">
            <BlockEditor
              key={selectedDoc?.id}
              initialContent={
                selectedDoc && Array.isArray(selectedDoc.content)
                  ? JSON.stringify(selectedDoc.content)
                  : undefined
              }
              onChange={handleContentChange}
              toolbarContainerId="notes-toolbar-container"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================
// ACTIONS View (Miro-like Canvas)
// ============================================

import { Plus, Trash2, Edit2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ActionsViewProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
}

function ActionsView({ navigation, onNavigate }: ActionsViewProps) {
  const { canvases, loading, refetch } = useCanvases();
  const [selectedCanvas, setSelectedCanvas] = useState<Canvas | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Load selected canvas
  useEffect(() => {
    async function loadCanvas() {
      if (navigation.canvasId) {
        const canvas = await fetchCanvas(navigation.canvasId);
        setSelectedCanvas(canvas);
      } else {
        setSelectedCanvas(null);
      }
    }
    loadCanvas();
  }, [navigation.canvasId]);

  // Create new canvas
  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const newCanvas = await createCanvas();
      refetch();
      onNavigate({ canvasId: newCanvas.id });
    } catch (err) {
      console.error('Failed to create canvas:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // Delete canvas
  const handleDelete = async (canvasId: string) => {
    try {
      await deleteCanvas(canvasId);
      if (navigation.canvasId === canvasId) {
        onNavigate({ canvasId: null });
      }
      refetch();
    } catch (err) {
      console.error('Failed to delete canvas:', err);
    }
  };

  // Rename canvas
  const handleRename = async (canvasId: string) => {
    if (!editingName.trim()) return;
    try {
      await updateCanvas(canvasId, { name: editingName.trim() });
      setEditingId(null);
      setEditingName('');
      refetch();
    } catch (err) {
      console.error('Failed to rename canvas:', err);
    }
  };

  // Save canvas snapshot
  const handleSave = async (snapshot: object) => {
    if (!navigation.canvasId) return;
    try {
      await updateCanvas(navigation.canvasId, { snapshot: snapshot as Json });
    } catch (err) {
      console.error('Failed to save canvas:', err);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Canvas List Sidebar */}
      <div className="w-60 border-r border-border bg-sidebar flex flex-col">
        {/* Header */}
        <div className="h-10 flex items-center justify-between px-3 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Canvases
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCreate}
            disabled={isCreating}
          >
            <Plus size={14} />
          </Button>
        </div>

        {/* Canvas List */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
            </div>
          ) : canvases.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">No canvases yet</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreate}
                disabled={isCreating}
              >
                <Plus size={14} className="mr-1.5" />
                New Canvas
              </Button>
            </div>
          ) : (
            canvases.map((canvas) => (
              <div
                key={canvas.id}
                className={`
                  group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors
                  ${navigation.canvasId === canvas.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                  }
                `}
                onClick={() => onNavigate({ canvasId: canvas.id })}
              >
                {editingId === canvas.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRename(canvas.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(canvas.id);
                      if (e.key === 'Escape') {
                        setEditingId(null);
                        setEditingName('');
                      }
                    }}
                    className="flex-1 text-sm bg-background border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="flex-1 text-sm truncate">
                      {canvas.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(canvas.id);
                            setEditingName(canvas.name);
                          }}
                        >
                          <Edit2 size={14} className="mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(canvas.id);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 size={14} className="mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Canvas Editor */}
      <div className="flex-1 bg-background">
        {navigation.canvasId && selectedCanvas ? (
          <CanvasEditor
            key={selectedCanvas.id}
            initialSnapshot={selectedCanvas.snapshot as object}
            onSave={handleSave}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="mb-3">Select a canvas or create a new one</p>
              <Button onClick={handleCreate} disabled={isCreating}>
                <Plus size={16} className="mr-2" />
                New Canvas
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
