'use client';

import { useState } from 'react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/components/icons';
import { StatCard } from './StatCard';

// Helper: Collect all elements from objects (recursive for nested objects)
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

// Helper: Collect all objects (flatten nested structure)
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

// Status display config
const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  todo: { label: 'To Do', color: '#6B7280', bg: 'bg-gray-100' },
  in_progress: { label: 'In Progress', color: '#f59e0b', bg: 'bg-amber-50' },
  review: { label: 'In Review', color: '#8b5cf6', bg: 'bg-violet-50' },
  done: { label: 'Completed', color: '#22c55e', bg: 'bg-emerald-50' },
  blocked: { label: 'Blocked', color: '#ef4444', bg: 'bg-red-50' },
};

// Priority colors
const priorityColors: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#6B7280',
};

type FilterTab = 'all' | 'in_progress' | 'done' | 'blocked';

interface HomeViewProps {
  explorerData: ExplorerData;
}

export function HomeView({ explorerData }: HomeViewProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const allObjects = collectAllObjects(explorerData);
  const allElements = collectAllElements(allObjects);

  const blockedElements = allElements.filter(e => e.status === 'blocked');
  const inProgressElements = allElements.filter(e => e.status === 'in_progress');
  const doneElements = allElements.filter(e => e.status === 'done');
  const urgentElements = allElements.filter(e => e.priority === 'urgent' && e.status !== 'done');

  // Filter elements based on active tab
  const filteredElements = allElements.filter(e => {
    switch (activeFilter) {
      case 'in_progress': return e.status === 'in_progress';
      case 'done': return e.status === 'done';
      case 'blocked': return e.status === 'blocked';
      default: return true;
    }
  });

  const filterTabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All Elements', count: allElements.length },
    { id: 'in_progress', label: 'In Progress', count: inProgressElements.length },
    { id: 'done', label: 'Completed', count: doneElements.length },
    { id: 'blocked', label: 'Blocked', count: blockedElements.length },
  ];

  // Find parent object name for an element
  const findObjectName = (objectId: string | null): string | null => {
    if (!objectId) return null;
    const obj = allObjects.find(o => o.id === objectId);
    return obj?.name ?? null;
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      {/* Welcome Header */}
      <div className="px-10 pt-8 pb-2">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Welcome back!
        </h1>
        <p className="text-muted-foreground mt-1.5 text-base">
          {allObjects.length} objects · {allElements.length} elements across your workspace
        </p>
      </div>

      <div className="px-10 py-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard title="Blocked" value={blockedElements.length} color="red" subtitle="Requires attention" />
          <StatCard title="In Progress" value={inProgressElements.length} color="yellow" subtitle="Currently working" />
          <StatCard title="Completed" value={doneElements.length} color="green" subtitle="This period" />
          <StatCard title="Urgent" value={urgentElements.length} color="purple" subtitle="High priority" />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-muted/50 rounded-xl p-1 w-fit">
          {filterTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                activeFilter === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              <span className={`ml-2 text-xs ${
                activeFilter === tab.id ? 'text-muted-foreground' : 'text-muted-foreground/60'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Elements as Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {filteredElements.slice(0, 12).map(element => {
            const status = statusConfig[element.status || 'todo'] ?? statusConfig.todo;
            const objectName = findObjectName(element.object_id);
            const subelementsDone = element.subelements?.filter(s => s.is_completed).length ?? 0;
            const subelementsTotal = element.subelements?.length ?? 0;
            const priorityColor = priorityColors[element.priority || 'low'] ?? '#6B7280';

            return (
              <div
                key={element.id}
                className="bg-card rounded-2xl p-5 border border-border/50 hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer group"
              >
                {/* Top row: title + status dot */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-semibold text-foreground text-[15px] leading-snug group-hover:text-primary transition-colors">
                    {element.title}
                  </h3>
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                    style={{ backgroundColor: status.color }}
                    title={status.label}
                  />
                </div>

                {/* Object & priority badge */}
                <div className="flex items-center gap-2 mb-3">
                  {objectName && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <ObjectIcon size={10} />
                      {objectName}
                    </span>
                  )}
                  {element.priority && (
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${priorityColor}12`,
                        color: priorityColor,
                      }}
                    >
                      {element.priority}
                    </span>
                  )}
                </div>

                {/* Description (truncated) */}
                {element.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {element.description}
                  </p>
                )}

                {/* Bottom: subelements progress + due date + status badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {subelementsTotal > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {subelementsDone}/{subelementsTotal} subtasks
                      </span>
                    )}
                    {element.due_date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(element.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg"
                    style={{
                      backgroundColor: `${status.color}12`,
                      color: status.color,
                    }}
                  >
                    {status.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {filteredElements.length === 0 && (
          <div className="text-center py-16">
            <div className="text-muted-foreground text-sm">No elements found</div>
          </div>
        )}

        {/* Objects Overview */}
        <div className="bg-card rounded-2xl p-6 border border-border/50">
          <h2 className="font-semibold text-foreground mb-5 text-base">Objects Overview</h2>
          <div className="space-y-4">
            {explorerData.objects.map(obj => {
              const objElements = obj.elements || [];
              const childElements = obj.children ? collectAllElements(obj.children) : [];
              const allObjElements = [...objElements, ...childElements];
              const done = allObjElements.filter(e => e.status === 'done').length;
              const progress = allObjElements.length > 0 ? Math.round((done / allObjElements.length) * 100) : 0;
              const childCount = obj.children ? obj.children.length : 0;

              return (
                <div key={obj.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: obj.color || '#6366f1' }}
                  >
                    {obj.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground font-medium truncate">{obj.name}</div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${progress}%`,
                            backgroundColor: obj.color || '#6366f1',
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{progress}%</span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {childCount > 0 ? `${childCount} children · ` : ''}{allObjElements.length} elements
                  </span>
                </div>
              );
            })}
            {explorerData.objects.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No objects created yet. Start by creating your first Object.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
