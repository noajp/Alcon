'use client';

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

interface HomeViewProps {
  explorerData: ExplorerData;
}

export function HomeView({ explorerData }: HomeViewProps) {
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
