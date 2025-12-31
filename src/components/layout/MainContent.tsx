'use client';

import { useState } from 'react';
import type { NavigationState } from './Sidebar';
import type { AlconObjectWithChildren, ElementWithDetails, ElementsBySection } from '@/hooks/useSupabase';
import {
  createElement,
  updateElement,
  toggleSubelementComplete,
  groupElementsBySection,
} from '@/hooks/useSupabase';

// Object icon (3D box - shallow angle, thinner lines)
const ObjectIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    {/* Top face (shallow diamond) */}
    <path d="M12 3 L21 7 L12 11 L3 7 Z" />
    {/* Left face */}
    <path d="M3 7 L3 16 L12 20 L12 11" />
    {/* Right face */}
    <path d="M21 7 L21 16 L12 20 L12 11" />
  </svg>
);

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  objects: AlconObjectWithChildren[];
  onRefresh?: () => void;
}

// ============================================
// Helper: Find object by ID
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
// Helper: Collect all elements from objects
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

export function MainContent({ activeActivity, navigation, onNavigate, objects, onRefresh }: MainContentProps) {
  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {activeActivity === 'home' && <HomeView objects={objects} />}
      {activeActivity === 'projects' && (
        <ObjectsView
          objects={objects}
          navigation={navigation}
          onNavigate={onNavigate}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

// ============================================
// HOME View
// ============================================
function HomeView({ objects }: { objects: AlconObjectWithChildren[] }) {
  const allElements = collectAllElements(objects);

  const blockedElements = allElements.filter(e => e.status === 'blocked');
  const inProgressElements = allElements.filter(e => e.status === 'in_progress');
  const doneElements = allElements.filter(e => e.status === 'done');
  const urgentElements = allElements.filter(e => e.priority === 'urgent' && e.status !== 'done');

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
        <p className="text-[var(--text-muted)] mt-1">{objects.length} objects · {allElements.length} elements</p>
      </div>

      <div className="p-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard title="Blocked" value={blockedElements.length} color="red" subtitle="Requires attention" />
          <StatCard title="In Progress" value={inProgressElements.length} color="yellow" subtitle="Currently working" />
          <StatCard title="Completed" value={doneElements.length} color="green" subtitle="This period" />
          <StatCard title="Urgent" value={urgentElements.length} color="purple" subtitle="High priority" />
        </div>

        {/* Objects Overview */}
        <div className="card p-6">
          <h2 className="font-semibold text-[var(--text-primary)] mb-4">Objects Overview</h2>
          <div className="space-y-3">
            {objects.map(obj => {
              const elements = obj.elements || [];
              const childElements = collectAllElements(obj.children || []);
              const allObjElements = [...elements, ...childElements];
              const done = allObjElements.filter(e => e.status === 'done').length;
              const progress = allObjElements.length > 0 ? Math.round((done / allObjElements.length) * 100) : 0;

              return (
                <div key={obj.id} className="flex items-center gap-3">
                  <span className="text-[#9a9a9a]"><ObjectIcon size={12} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#1a1a1a] truncate">{obj.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-[#e8e8e8] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#22c55e] rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[#6b6b6b]">{progress}%</span>
                    </div>
                  </div>
                  <span className="text-xs text-[#6b6b6b]">{allObjElements.length} elements</span>
                </div>
              );
            })}
            {objects.length === 0 && (
              <div className="text-sm text-[var(--text-muted)]">No objects created yet</div>
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
  const colors = {
    red: 'from-red-500/20 to-red-600/10 text-red-400',
    yellow: 'from-yellow-500/20 to-yellow-600/10 text-yellow-400',
    green: 'from-green-500/20 to-green-600/10 text-green-400',
    purple: 'from-purple-500/20 to-purple-600/10 text-purple-400',
  };

  return (
    <div className={`card p-4 bg-gradient-to-br ${colors[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl font-bold text-[var(--text-primary)]">{value}</span>
      </div>
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</div>
    </div>
  );
}

// ============================================
// Objects View - Shows object contents
// ============================================
function ObjectsView({ objects, navigation, onNavigate, onRefresh }: {
  objects: AlconObjectWithChildren[];
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  // If no object is selected, show overview
  if (!navigation.objectId) {
    return <OverviewView objects={objects} onNavigate={onNavigate} />;
  }

  // Find the selected object
  const selectedObject = findObjectById(objects, navigation.objectId);

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

// ============================================
// Overview View - Shows all root objects
// ============================================
function OverviewView({ objects, onNavigate }: {
  objects: AlconObjectWithChildren[];
  onNavigate: (nav: Partial<NavigationState>) => void;
}) {
  const allElements = collectAllElements(objects);

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="px-5 py-4 border-b border-[#e8e8e8]">
        <div className="flex items-center gap-3">
          <span className="text-[#9a9a9a]"><ObjectIcon size={24} /></span>
          <div>
            <h1 className="text-xl font-semibold text-[#1a1a1a]">All Objects</h1>
            <p className="text-sm text-[#6b6b6b]">
              {objects.length} objects · {allElements.length} elements
            </p>
          </div>
        </div>
      </div>

      <div className="p-5">
        {objects.length === 0 ? (
          <div className="text-center py-12 text-[#6b6b6b]">
            <p>No objects yet.</p>
            <p className="text-sm mt-2">Create an Object to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {objects.map(obj => (
              <ObjectCard
                key={obj.id}
                object={obj}
                onClick={() => onNavigate({ objectId: obj.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Object Card
// ============================================
function ObjectCard({ object, onClick }: {
  object: AlconObjectWithChildren;
  onClick: () => void;
}) {
  const childCount = object.children?.length || 0;
  const elementCount = (object.elements?.length || 0) + collectAllElements(object.children || []).length;

  return (
    <div
      className="p-4 border border-[#e8e8e8] rounded-lg cursor-pointer hover:bg-black/[0.02] hover:border-[#d1d5db] transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span className="text-[#9a9a9a]"><ObjectIcon size={16} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[#1a1a1a]">{object.name}</div>
          <div className="text-xs text-[#6b6b6b] mt-0.5">
            {childCount > 0 ? `${childCount} sub-objects · ` : ''}{elementCount} elements
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Section Header Component (with line design)
// ============================================
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-end mb-0 pt-4">
      {/* Left part: horizontal line + rounded corner up */}
      <svg className="w-10 h-[36px] flex-shrink-0" viewBox="0 0 40 36" fill="none">
        <path
          d="M0 34 H24 Q32 34 32 26 V8 Q32 0 40 0"
          stroke="#94a3b8"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      {/* Label box with left, top, right borders */}
      <div className="border-l-2 border-t-2 border-r-2 border-[#94a3b8] rounded-t-lg px-4 pt-2 pb-3 -ml-[1px] -mr-[1px]">
        <div className="text-[13px] font-semibold text-[#6b6b6b] whitespace-nowrap">
          {label}
        </div>
      </div>
      {/* Right part: from label box down + rounded corner to horizontal line */}
      <svg className="flex-1 h-[36px] min-w-[40px]" viewBox="0 0 100 36" preserveAspectRatio="xMinYMax meet" fill="none">
        <path
          d="M0 0 Q8 0 8 8 V26 Q8 34 16 34 H100"
          stroke="#94a3b8"
          strokeWidth="2"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
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

  const elements = object.elements || [];
  const children = object.children || [];
  const elementsBySection = groupElementsBySection(elements);

  // Get unique sections for dropdown
  const existingSections = [...new Set(elements.map(e => e.section).filter(Boolean))] as string[];

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

  return (
    <div className="flex-1 overflow-auto bg-white">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e8] bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[#9a9a9a]"><ObjectIcon size={20} /></span>
            <div>
              <h1 className="text-xl font-semibold text-[#1a1a1a]">{object.name}</h1>
              <p className="text-sm text-[#6b6b6b]">
                {children.length > 0 ? `${children.length} sub-objects · ` : ''}{elements.length} elements
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddingElement(true)}
            className="px-3 py-1.5 bg-[#22c55e] text-white text-sm font-medium rounded-md hover:bg-[#16a34a] transition-colors flex items-center gap-1.5"
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
          <div className="mb-4 p-4 bg-[#f8f7f4] rounded-lg border border-[#e8e8e8]">
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
                className="w-full px-3 py-2 bg-white border border-[#e8e8e8] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/20 focus:border-[#22c55e]"
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
                  className="flex-1 px-3 py-2 bg-white border border-[#e8e8e8] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#22c55e]/20 focus:border-[#22c55e]"
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
                  className="px-3 py-2 bg-[#22c55e] text-white text-sm rounded-md hover:bg-[#16a34a] transition-colors disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsAddingElement(false);
                    setNewTitle('');
                    setNewSection('');
                  }}
                  className="px-3 py-2 text-[#6b6b6b] text-sm hover:bg-[#f5f5f5] rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Objects */}
        {children.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-[#6b6b6b] mb-3">Sub-Objects</h3>
            <div className="grid gap-2">
              {children.map(child => (
                <ObjectCard
                  key={child.id}
                  object={child}
                  onClick={() => onNavigate({ objectId: child.id })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Elements by Section */}
        {elements.length === 0 ? (
          <div className="text-center py-12 text-[#6b6b6b]">
            <p>No elements in this object yet.</p>
            <button
              onClick={() => setIsAddingElement(true)}
              className="mt-2 text-sm text-[#22c55e] hover:underline"
            >
              Add your first element
            </button>
          </div>
        ) : (
          <div className="space-y-0">
            {elementsBySection.map(({ section, elements: sectionElements }, sectionIndex) => (
              <div key={section || '__no_section__'}>
                {/* Section Header with line design */}
                {section && <SectionHeader label={section} />}

                {/* Elements Table */}
                <table className="w-full bg-white border-collapse">
                  <thead>
                    <tr>
                      <th className="w-10 px-4 py-3 text-left text-xs font-medium text-[#9a9a9a] border-b border-[#e8e8e8]"></th>
                      <th className="min-w-[200px] px-3 py-3 text-left text-xs font-medium text-[#9a9a9a] border-b border-[#e8e8e8]">Name</th>
                      <th className="w-20 px-3 py-3 text-left text-xs font-medium text-[#9a9a9a] border-b border-[#e8e8e8]">Priority</th>
                      <th className="w-28 px-3 py-3 text-left text-xs font-medium text-[#9a9a9a] border-b border-[#e8e8e8]">Status</th>
                      <th className="w-28 px-3 py-3 text-left text-xs font-medium text-[#9a9a9a] border-b border-[#e8e8e8]">Due date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionElements.map((element, index) => (
                      <ElementTableRow
                        key={element.id}
                        element={element}
                        rowNumber={index + 1}
                        onStatusChange={(status) => handleStatusChange(element.id, status)}
                        onRefresh={onRefresh}
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
  );
}

// ============================================
// Element Table Row (new table format)
// ============================================
function ElementTableRow({ element, rowNumber, onStatusChange, onRefresh }: {
  element: ElementWithDetails;
  rowNumber: number;
  onStatusChange: (status: string) => void;
  onRefresh?: () => void;
}) {
  const priorityBadges: Record<string, { bg: string; text: string; label: string }> = {
    urgent: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'Urgent' },
    high: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'High' },
    medium: { bg: 'bg-[#f0fdf4]', text: 'text-[#16a34a]', label: 'Normal' },
    low: { bg: 'bg-[#eff6ff]', text: 'text-[#2563eb]', label: 'Low' },
  };

  const statusBadges: Record<string, { bg: string; text: string; label: string }> = {
    todo: { bg: 'bg-[#f5f5f5]', text: 'text-[#6b6b6b]', label: 'To Do' },
    in_progress: { bg: 'bg-[#fef3c7]', text: 'text-[#d97706]', label: 'In Progress' },
    review: { bg: 'bg-[#e0e7ff]', text: 'text-[#4f46e5]', label: 'Review' },
    done: { bg: 'bg-[#f0fdf4]', text: 'text-[#16a34a]', label: 'Done' },
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

  return (
    <tr className="border-b border-[#e8e8e8] hover:bg-[#fafafa] transition-colors">
      {/* Row number */}
      <td className="px-4 py-3 text-xs text-[#9a9a9a]">{rowNumber}</td>

      {/* Name cell */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          {/* Checkbox */}
          <button
            onClick={() => onStatusChange(element.status === 'done' ? 'todo' : 'done')}
            className={`w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${
              element.status === 'done'
                ? 'bg-[#22c55e] border-[#22c55e] text-white'
                : 'border-[#d1d5db] hover:border-[#22c55e]'
            }`}
          >
            {element.status === 'done' && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>

          {/* Title */}
          <span className={`text-[13px] ${element.status === 'done' ? 'text-[#9a9a9a] line-through' : 'text-[#1a1a1a]'}`}>
            {element.title}
          </span>
        </div>
      </td>

      {/* Priority */}
      <td className="px-3 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${priority.bg} ${priority.text}`}>
          {priority.label}
        </span>
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </td>

      {/* Due date */}
      <td className="px-3 py-3">
        {element.due_date ? (
          <span className="text-xs text-[#6b6b6b]">{formatDueDate(element.due_date)}</span>
        ) : (
          <span className="text-xs text-[#9a9a9a] flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add date
          </span>
        )}
      </td>
    </tr>
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
            ? 'bg-green-500 border-green-500 text-white'
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
