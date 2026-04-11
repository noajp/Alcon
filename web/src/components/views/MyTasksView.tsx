'use client';

import { useState } from 'react';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send, Flag, Calendar, ChevronDown } from 'lucide-react';
import { useMyTasks } from '@/hooks/useMyTasks';
import type { MyTask } from '@/hooks/useMyTasks';
import { updateElement } from '@/hooks/useSupabase';

// Status config
const STATUS_CONFIG: Record<string, { label: string; icon: typeof Circle; color: string; bgColor: string }> = {
  backlog: { label: 'Backlog', icon: Circle, color: 'text-neutral-400', bgColor: 'bg-neutral-100' },
  todo: { label: 'To Do', icon: Circle, color: 'text-neutral-500', bgColor: 'bg-neutral-100' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-yellow-500', bgColor: 'bg-yellow-50' },
  review: { label: 'In Review', icon: Send, color: 'text-cyan-500', bgColor: 'bg-cyan-50' },
  done: { label: 'Done', icon: CheckCircle2, color: 'text-green-500', bgColor: 'bg-green-50' },
  blocked: { label: 'Blocked', icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50' },
  cancelled: { label: 'Cancelled', icon: Ban, color: 'text-neutral-400', bgColor: 'bg-neutral-100' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-500' },
  high: { label: 'High', color: 'text-orange-500' },
  medium: { label: 'Medium', color: 'text-yellow-600' },
  low: { label: 'Low', color: 'text-neutral-400' },
};

// Group by options
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

  // Sort groups
  if (groupBy === 'status') {
    const order = ['in_progress', 'todo', 'backlog', 'review', 'blocked', 'done', 'cancelled'];
    return order
      .filter(k => groups.has(k))
      .map(k => ({ label: STATUS_CONFIG[k]?.label || k, tasks: groups.get(k)!, key: k }));
  }

  if (groupBy === 'priority') {
    const order = ['urgent', 'high', 'medium', 'low'];
    return order
      .filter(k => groups.has(k))
      .map(k => ({ label: PRIORITY_CONFIG[k]?.label || k, tasks: groups.get(k)!, key: k }));
  }

  return Array.from(groups.entries()).map(([key, tasks]) => ({ label: key, tasks, key }));
}

export function MyTasksView() {
  const { tasks, loading, refetch } = useMyTasks();
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      await updateElement(taskId, { status: newStatus as 'todo' });
      refetch();
    } catch (e) { console.error(e); }
  };

  const grouped = groupTasks(tasks, groupBy);
  const activeTasks = tasks.filter(t => t.status !== 'done' && (t.status as string) !== 'cancelled');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-[var(--content-bg)] p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header stats */}
        <div className="bg-card rounded-lg border border-border shadow-[var(--shadow-island)] p-5">
          <h1 className="text-xl font-bold text-foreground mb-4">My Tasks</h1>
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-bold text-foreground">{activeTasks.length}</div>
              <div className="text-[12px] text-muted-foreground">Active</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{doneTasks.length}</div>
              <div className="text-[12px] text-muted-foreground">Completed</div>
            </div>
            {overdueTasks.length > 0 && (
              <div>
                <div className="text-2xl font-bold text-red-500">{overdueTasks.length}</div>
                <div className="text-[12px] text-red-500">Overdue</div>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowGroupMenu(!showGroupMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors shadow-[var(--shadow-xs)]"
            >
              Group by {groupBy === 'none' ? 'None' : groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
              <ChevronDown size={14} />
            </button>
            {showGroupMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowGroupMenu(false)} />
                <div className="absolute top-full left-0 mt-1 py-1 bg-popover border border-border rounded-lg shadow-lg z-50 min-w-[140px]">
                  {(['status', 'priority', 'object', 'none'] as GroupBy[]).map(opt => (
                    <button
                      key={opt}
                      onClick={() => { setGroupBy(opt); setShowGroupMenu(false); }}
                      className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                        groupBy === opt ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {opt === 'none' ? 'None' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Task groups */}
        {tasks.length === 0 ? (
          <div className="bg-card rounded-lg border border-border shadow-[var(--shadow-island)] p-12 text-center">
            <div className="text-muted-foreground mb-2">No tasks assigned to you yet</div>
            <div className="text-sm text-muted-foreground/70">Tasks will appear here when you're assigned to elements</div>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.key} className="bg-card rounded-lg border border-border shadow-[var(--shadow-island)] overflow-hidden">
              {/* Group header */}
              {group.label && (
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border hover:bg-muted/30 transition-colors"
                >
                  <ChevronDown
                    size={14}
                    className={`text-muted-foreground transition-transform ${collapsedGroups.has(group.key) ? '-rotate-90' : ''}`}
                  />
                  {groupBy === 'status' && STATUS_CONFIG[group.key] && (
                    <>
                      {(() => { const Icon = STATUS_CONFIG[group.key].icon; return <Icon size={14} className={STATUS_CONFIG[group.key].color} />; })()}
                    </>
                  )}
                  <span className="text-sm font-medium text-foreground">{group.label}</span>
                  <span className="text-[12px] text-muted-foreground ml-1">{group.tasks.length}</span>
                </button>
              )}

              {/* Task rows */}
              {!collapsedGroups.has(group.key) && (
                <div>
                  {group.tasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      showStatus={groupBy !== 'status'}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================
// Task Row
// ============================================
function TaskRow({ task, showStatus, onStatusChange }: {
  task: MyTask;
  showStatus: boolean;
  onStatusChange: (taskId: string, status: string) => void;
}) {
  const statusConf = STATUS_CONFIG[task.status || 'todo'] || STATUS_CONFIG.todo;
  const priorityConf = PRIORITY_CONFIG[task.priority || 'medium'] || PRIORITY_CONFIG.medium;
  const StatusIcon = statusConf.icon;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';
  const completedSubs = task.subelements?.filter(s => s.is_completed).length || 0;
  const totalSubs = task.subelements?.length || 0;

  return (
    <div className="flex items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors group">
      {/* Status icon - clickable to toggle done */}
      <button
        onClick={() => onStatusChange(task.id, task.status === 'done' ? 'todo' : 'done')}
        className="mr-3 flex-shrink-0"
        title={task.status === 'done' ? 'Mark as todo' : 'Mark as done'}
      >
        <StatusIcon size={16} className={statusConf.color} />
      </button>

      {/* Title + Object name */}
      <div className="flex-1 min-w-0 mr-4">
        <div className={`text-sm font-medium truncate ${task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {task.title}
        </div>
        {task.object_name && (
          <div className="text-[11px] text-muted-foreground truncate">{task.object_name}</div>
        )}
      </div>

      {/* Subelements progress */}
      {totalSubs > 0 && (
        <div className="flex items-center gap-1.5 mr-4 flex-shrink-0">
          <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${(completedSubs / totalSubs) * 100}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground">{completedSubs}/{totalSubs}</span>
        </div>
      )}

      {/* Priority badge */}
      <div className="mr-4 flex-shrink-0">
        <span className={`text-[12px] font-medium ${priorityConf.color}`}>
          {priorityConf.label}
        </span>
      </div>

      {/* Status badge (when not grouped by status) */}
      {showStatus && (
        <div className="mr-4 flex-shrink-0">
          <span className={`text-[12px] px-2 py-0.5 rounded-full ${statusConf.bgColor} ${statusConf.color} font-medium`}>
            {statusConf.label}
          </span>
        </div>
      )}

      {/* Due date */}
      <div className="flex items-center gap-1 flex-shrink-0 w-24 justify-end">
        {task.due_date ? (
          <span className={`text-[12px] ${isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/40">No date</span>
        )}
      </div>

      {/* Assignee avatars */}
      <div className="flex items-center -space-x-1.5 ml-3 flex-shrink-0">
        {task.assignees?.slice(0, 3).map(a => (
          <div
            key={a.id}
            className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground"
            title={a.worker?.name}
          >
            {a.worker?.name?.charAt(0) || '?'}
          </div>
        ))}
      </div>
    </div>
  );
}
