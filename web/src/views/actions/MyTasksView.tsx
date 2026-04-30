'use client';

import { useState } from 'react';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send, ChevronDown, Search } from 'lucide-react';
import { useMyTasks } from '@/hooks/useMyTasks';
import type { MyTask } from '@/hooks/useMyTasks';
import { updateElement } from '@/hooks/useSupabase';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';

// Use unified design tokens
const STATUS_CONFIG: Record<string, { label: string; icon: typeof Circle; color: string; dotColor: string }> = {
  backlog:     { label: 'Backlog',     icon: Circle,       color: 'text-neutral-400', dotColor: 'bg-neutral-300' },
  todo:        { label: 'To Do',       icon: Circle,       color: 'text-neutral-500', dotColor: 'bg-neutral-400' },
  in_progress: { label: 'In Progress', icon: Clock,        color: 'text-amber-600',   dotColor: 'bg-amber-400' },
  review:      { label: 'In Review',   icon: Send,         color: 'text-blue-600',    dotColor: 'bg-blue-400' },
  done:        { label: 'Done',        icon: CheckCircle2, color: 'text-emerald-600', dotColor: 'bg-emerald-400' },
  blocked:     { label: 'Blocked',     icon: XCircle,      color: 'text-red-600',     dotColor: 'bg-red-400' },
  cancelled:   { label: 'Cancelled',   icon: Ban,          color: 'text-neutral-400', dotColor: 'bg-neutral-300' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; badgeBg: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-700',    badgeBg: 'bg-red-50 text-red-700' },
  high:   { label: 'High',   color: 'text-amber-700',  badgeBg: 'bg-amber-50 text-amber-700' },
  medium: { label: 'Medium', color: 'text-neutral-600', badgeBg: 'bg-neutral-100 text-neutral-600' },
  low:    { label: 'Low',    color: 'text-neutral-400', badgeBg: 'bg-neutral-100 text-neutral-400' },
};

type GroupBy = 'status' | 'priority' | 'object' | 'none';

function groupTasks(tasks: MyTask[], groupBy: GroupBy): { label: string; tasks: MyTask[]; key: string }[] {
  if (groupBy === 'none') return [{ label: '', tasks, key: 'all' }];
  const groups = new Map<string, MyTask[]>();
  for (const task of tasks) {
    let key: string;
    switch (groupBy) {
      case 'status': key = task.status || 'todo'; break;
      case 'priority': key = task.priority || 'medium'; break;
      case 'object': key = task.object_name || 'Personal'; break;
      default: key = 'all';
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  if (groupBy === 'status') {
    const order = ['in_progress', 'todo', 'backlog', 'review', 'blocked', 'done', 'cancelled'];
    return order.filter(k => groups.has(k)).map(k => ({ label: STATUS_CONFIG[k]?.label || k, tasks: groups.get(k)!, key: k }));
  }
  if (groupBy === 'priority') {
    const order = ['urgent', 'high', 'medium', 'low'];
    return order.filter(k => groups.has(k)).map(k => ({ label: PRIORITY_CONFIG[k]?.label || k, tasks: groups.get(k)!, key: k }));
  }
  return Array.from(groups.entries()).map(([key, tasks]) => ({ label: key, tasks, key }));
}

export function MyTasksView() {
  const { tasks, loading, refetch } = useMyTasks();
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try { await updateElement(taskId, { status: newStatus as 'todo' }); refetch(); } catch (e) { console.error(e); }
  };

  const grouped = groupTasks(tasks, groupBy);

  // Detail view
  const detailTask = detailTaskId ? tasks.find(t => t.id === detailTaskId) : null;
  if (detailTask) {
    return (
      <ElementDetailView
        element={detailTask}
        objectName={detailTask.object_name}
        onBack={() => setDetailTaskId(null)}
        onRefresh={refetch}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar: title + toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-foreground">My Tasks</h1>
          <span className="text-[12px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Group by */}
          <div className="relative">
            <button
              onClick={() => setShowGroupMenu(!showGroupMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            >
              Group by {groupBy === 'none' ? 'None' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
              <ChevronDown size={13} />
            </button>
            {showGroupMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowGroupMenu(false)} />
                <div className="absolute right-0 top-full mt-1 py-1 bg-popover border border-border rounded-lg shadow-lg z-50 min-w-[130px]">
                  {(['status', 'priority', 'object', 'none'] as GroupBy[]).map(opt => (
                    <button
                      key={opt}
                      onClick={() => { setGroupBy(opt); setShowGroupMenu(false); }}
                      className={`w-full px-3 py-1.5 text-[13px] text-left transition-colors ${groupBy === opt ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'}`}
                    >
                      {opt === 'none' ? 'None' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="flex items-center gap-1.5 px-2.5 py-1 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors">
            <Search size={13} />
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto">
        {tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-sm">No tasks assigned to you yet</p>
            <p className="text-[12px] mt-1 text-muted-foreground/60">Tasks will appear here when you&apos;re assigned</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="flex items-center px-6 py-2 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 z-10 bg-card">
              <div className="w-8" />
              <div className="w-20">ID</div>
              <div className="flex-1">Name</div>
              <div className="w-24 text-center">Priority</div>
              <div className="w-32">Object</div>
              <div className="w-32">Due date</div>
              <div className="w-20 text-right">Assignee</div>
            </div>

            {grouped.map(group => (
              <div key={group.key}>
                {/* Group header */}
                {group.label && (
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 px-6 py-2 bg-muted/30 border-b border-border hover:bg-muted/50 transition-colors"
                  >
                    <ChevronDown size={14} className={`text-muted-foreground transition-transform ${collapsedGroups.has(group.key) ? '-rotate-90' : ''}`} />
                    {groupBy === 'status' && STATUS_CONFIG[group.key] && (() => {
                      const Icon = STATUS_CONFIG[group.key].icon;
                      return <Icon size={14} className={STATUS_CONFIG[group.key].color} />;
                    })()}
                    <span className="text-[13px] font-semibold text-foreground">{group.label}</span>
                    <span className="text-[12px] text-muted-foreground">{group.tasks.length}</span>
                  </button>
                )}

                {/* Rows */}
                {!collapsedGroups.has(group.key) && group.tasks.map((task, i) => (
                  <TaskRow key={task.id} task={task} index={i} showStatus={groupBy !== 'status'} onStatusChange={handleStatusChange} onClick={() => setDetailTaskId(task.id)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, index, showStatus, onStatusChange, onClick }: {
  task: MyTask; index: number; showStatus: boolean;
  onStatusChange: (taskId: string, status: string) => void;
  onClick: () => void;
}) {
  const statusConf = STATUS_CONFIG[task.status || 'todo'] || STATUS_CONFIG.todo;
  const priorityConf = PRIORITY_CONFIG[task.priority || 'medium'] || PRIORITY_CONFIG.medium;
  const StatusIcon = statusConf.icon;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';
  const shortId = task.display_id || task.id.substring(0, 6).toUpperCase();

  return (
    <div className={`flex items-center px-6 py-2.5 border-b border-border hover:bg-muted/20 transition-colors group cursor-pointer ${task.status === 'done' ? 'opacity-60' : ''}`} onClick={onClick}>
      {/* Status icon */}
      <div className="w-8 flex-shrink-0">
        <button onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, task.status === 'done' ? 'todo' : 'done'); }}>
          <StatusIcon size={16} className={statusConf.color} />
        </button>
      </div>

      {/* ID */}
      <div className="w-20 flex-shrink-0">
        <span className="text-[12px] text-muted-foreground font-mono">{shortId}</span>
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 mr-3">
        <span className={`text-[13px] truncate block ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {task.title}
        </span>
      </div>

      {/* Priority */}
      <div className="w-24 flex-shrink-0 text-center">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${priorityConf.badgeBg}`}>
          {priorityConf.label}
        </span>
      </div>

      {/* Object */}
      <div className="w-32 flex-shrink-0">
        {task.object_name ? (
          <span className="text-[12px] text-muted-foreground truncate block">{task.object_name}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Due date */}
      <div className="w-32 flex-shrink-0">
        {task.due_date ? (
          <span className={`text-[12px] ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
            {new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/40">Add date</span>
        )}
      </div>

      {/* Assignee */}
      <div className="w-20 flex justify-end flex-shrink-0">
        <div className="flex -space-x-1.5">
          {task.assignees?.slice(0, 3).map(a => (
            <div key={a.id} className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground" title={a.worker?.name}>
              {a.worker?.name?.charAt(0) || '?'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
