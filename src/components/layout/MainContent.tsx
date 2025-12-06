'use client';

import { useState, useCallback } from 'react';
import type { NavigationState } from './Sidebar';
import type { CompanyWithHierarchy, ProjectWithSections, SectionWithTasks, TaskWithDetails } from '@/hooks/useSupabase';
import { createTask, updateTask, deleteTask } from '@/hooks/useSupabase';

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  company: CompanyWithHierarchy | null;
  onRefresh?: () => void;
}

export function MainContent({ activeActivity, navigation, onNavigate, company, onRefresh }: MainContentProps) {
  if (!company) return null;

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {activeActivity === 'home' && <HomeView company={company} navigation={navigation} />}
      {activeActivity === 'projects' && (
        <ProjectsView company={company} navigation={navigation} onNavigate={onNavigate} onRefresh={onRefresh} />
      )}
      {activeActivity === 'tasks' && <TasksView company={company} />}
      {activeActivity === 'inbox' && <InboxView />}
      {activeActivity === 'agents' && <AgentsView company={company} />}
      {activeActivity === 'insights' && <InsightsView company={company} />}
      {activeActivity === 'team' && <TeamView company={company} />}
      {activeActivity === 'settings' && <SettingsView />}
    </div>
  );
}

// ============================================
// HOME View - Dashboard
// ============================================
function HomeView({ company, navigation }: { company: CompanyWithHierarchy; navigation: NavigationState }) {
  const allTasks = company.departments?.flatMap(d =>
    d.teams.flatMap(t => t.projects.flatMap(p => p.sections.flatMap(s => s.tasks)))
  ) || [];
  const allProjects = company.departments?.flatMap(d => d.teams.flatMap(t => t.projects)) || [];

  const blockedTasks = allTasks.filter(t => t.status === 'blocked');
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
  const doneTasks = allTasks.filter(t => t.status === 'done');
  const urgentTasks = allTasks.filter(t => t.priority === 'urgent' && t.status !== 'done');

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Dashboard</h1>
        <p className="text-[var(--text-muted)] mt-1">{company.name}</p>
      </div>

      <div className="p-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Blocked Tasks"
            value={blockedTasks.length}
            icon="alert"
            color="red"
            subtitle="Requires attention"
          />
          <StatCard
            title="In Progress"
            value={inProgressTasks.length}
            icon="play"
            color="yellow"
            subtitle="Currently working"
          />
          <StatCard
            title="Completed"
            value={doneTasks.length}
            icon="check"
            color="green"
            subtitle="This period"
          />
          <StatCard
            title="Urgent"
            value={urgentTasks.length}
            icon="clock"
            color="purple"
            subtitle="High priority"
          />
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Critical Path Alert */}
          <div className="col-span-2">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[var(--text-primary)]">Critical Path Analysis</h2>
                <span className="px-2 py-1 text-xs rounded-full bg-red-500/20 text-red-400">6 blocked</span>
              </div>

              {/* Dependency Chain Visualization */}
              <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 mb-4">
                <div className="text-xs text-[var(--text-muted)] mb-3">Hidden Dependency Chain Detected</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { name: 'Q4決算処理', dept: '経理', status: 'blocked' },
                    { name: '予算承認', dept: '予算管理', status: 'blocked' },
                    { name: 'ベンダー契約', dept: '調達', status: 'blocked' },
                    { name: 'インフラ構築', dept: 'インフラ', status: 'blocked' },
                    { name: '本番デプロイ', dept: '開発', status: 'blocked' },
                    { name: 'QA検証', dept: 'QA', status: 'blocked' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-red-500/30">
                        <div className="text-sm text-[var(--text-primary)]">{item.name}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{item.dept}</div>
                      </div>
                      {i < 5 && (
                        <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h14m-7-7l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-[var(--text-muted)]">Root cause: 決算遅延</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-[var(--text-muted)]">Impact: 3/15リリースに影響</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="space-y-4">
            <div className="card p-4">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Projects Overview</h3>
              <div className="space-y-3">
                {allProjects.slice(0, 4).map(project => {
                  const tasks = project.sections?.flatMap(s => s.tasks) || [];
                  const done = tasks.filter(t => t.status === 'done').length;
                  const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
                  const blocked = tasks.filter(t => t.status === 'blocked').length;

                  return (
                    <div key={project.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--text-primary)] truncate">{project.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[var(--status-success)] rounded-full"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)]">{progress}%</span>
                        </div>
                      </div>
                      {blocked > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded bg-red-500/20 text-red-400">
                          {blocked}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Departments</h3>
              <div className="space-y-2">
                {company.departments?.map(dept => {
                  const deptTasks = dept.teams.flatMap(t => t.projects.flatMap(p => p.sections.flatMap(s => s.tasks)));
                  const blocked = deptTasks.filter(t => t.status === 'blocked').length;

                  return (
                    <div key={dept.id} className="flex items-center gap-2 py-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: dept.color || '#3b82f6' }}
                      />
                      <span className="flex-1 text-sm text-[var(--text-primary)]">{dept.name}</span>
                      {blocked > 0 && (
                        <span className="text-xs text-red-400">{blocked} blocked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ title, value, icon, color, subtitle }: {
  title: string;
  value: number;
  icon: string;
  color: 'red' | 'yellow' | 'green' | 'blue' | 'purple';
  subtitle: string;
}) {
  const colors = {
    red: 'from-red-500/20 to-red-600/10 text-red-400',
    yellow: 'from-yellow-500/20 to-yellow-600/10 text-yellow-400',
    green: 'from-green-500/20 to-green-600/10 text-green-400',
    blue: 'from-blue-500/20 to-blue-600/10 text-blue-400',
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
// PROJECTS View
// ============================================
function ProjectsView({ company, navigation, onNavigate, onRefresh }: {
  company: CompanyWithHierarchy;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [viewType, setViewType] = useState<'list' | 'board'>('list');
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Find selected project
  const allProjects = company.departments?.flatMap(d => d.teams.flatMap(t => t.projects)) || [];
  const project = allProjects.find(p => p.id === navigation.projectId);

  // Get first section for adding tasks
  const firstSection = project?.sections?.[0];

  // Handle task creation
  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !firstSection) return;

    setIsLoading(true);
    try {
      await createTask({
        title: newTaskTitle.trim(),
        section_id: firstSection.id,
        status: 'todo',
        priority: 'medium',
        description: null,
        due_date: null,
        assignee_id: null,
        estimated_hours: null,
        actual_hours: null,
        order_index: (firstSection.tasks?.length || 0),
      });
      setNewTaskTitle('');
      setIsAddingTask(false);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle task status update
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    setIsLoading(true);
    try {
      await updateTask(taskId, { status: newStatus });
      onRefresh?.();
    } catch (error) {
      console.error('Failed to update task:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle task completion toggle
  const handleToggleComplete = async (task: TaskWithDetails) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    await handleStatusChange(task.id, newStatus);
  };

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1">Select a project</h3>
          <p className="text-sm text-[var(--text-muted)]">Choose a project from the sidebar to view tasks</p>
        </div>
      </div>
    );
  }

  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const doneTasks = allTasks.filter(t => t.status === 'done').length;
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

  return (
    <>
      {/* Project Header */}
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold shadow-lg">
              {project.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-[var(--text-primary)]">{project.name}</h1>
                {blockedTasks > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                    {blockedTasks} blocked
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--status-success)] rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">{progress}%</span>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{allTasks.length} tasks</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary text-sm"
              onClick={() => setIsAddingTask(true)}
              disabled={isLoading}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Task
            </button>
            <button className="btn btn-primary text-sm">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
              </svg>
              AI Analyze
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 px-6">
          {[
            { id: 'list', label: 'List', icon: 'list' },
            { id: 'board', label: 'Board', icon: 'board' },
            { id: 'timeline', label: 'Timeline', icon: 'timeline' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => (tab.id === 'list' || tab.id === 'board') && setViewType(tab.id as 'list' | 'board')}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                (tab.id === 'list' && viewType === 'list') || (tab.id === 'board' && viewType === 'board')
                  ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task Content */}
      <div className="flex-1 overflow-auto">
        {viewType === 'list' && (
          <TaskListView
            project={project}
            selectedTask={selectedTask}
            onTaskClick={setSelectedTask}
            activeSectionId={navigation.sectionId}
            onToggleComplete={handleToggleComplete}
          />
        )}
        {viewType === 'board' && (
          <TaskBoardView
            project={project}
            onTaskClick={setSelectedTask}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>

      {/* Add Task Modal */}
      {isAddingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-[400px] shadow-xl border border-[var(--border-color)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Add New Task</h3>
            <input
              type="text"
              className="input mb-4"
              placeholder="Task title..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setIsAddingTask(false);
                  setNewTaskTitle('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim() || isLoading}
              >
                {isLoading ? 'Adding...' : 'Add Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================
// Task List View
// ============================================
function TaskListView({ project, selectedTask, onTaskClick, activeSectionId, onToggleComplete }: {
  project: ProjectWithSections;
  selectedTask: string | null;
  onTaskClick: (id: string) => void;
  activeSectionId: string | null;
  onToggleComplete: (task: TaskWithDetails) => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(project.sections?.map(s => s.id) || [])
  );

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sectionsToShow = activeSectionId
    ? project.sections?.filter(s => s.id === activeSectionId)
    : project.sections;

  return (
    <div className="min-w-[800px]">
      {/* Column Headers */}
      <div className="sticky top-0 z-10 flex items-center h-10 px-6 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
        <div className="flex-1 min-w-[300px]">Task</div>
        <div className="w-32 px-2">Assignee</div>
        <div className="w-28 px-2">Due Date</div>
        <div className="w-24 px-2">Status</div>
        <div className="w-24 px-2">Priority</div>
      </div>

      {/* Sections */}
      {sectionsToShow?.map((section) => (
        <div key={section.id}>
          {/* Section Header */}
          <button
            className="w-full flex items-center gap-2 h-10 px-6 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => toggleSection(section.id)}
          >
            <span className={`text-[10px] text-[var(--text-muted)] transition-transform duration-200 ${expandedSections.has(section.id) ? 'rotate-90' : ''}`}>
              ▶
            </span>
            <span className="font-medium text-[var(--text-primary)]">{section.name}</span>
            <span className="text-xs text-[var(--text-muted)]">({section.tasks?.length || 0})</span>
            {section.tasks?.some(t => t.status === 'blocked') && (
              <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-red-500/20 text-red-400">
                {section.tasks.filter(t => t.status === 'blocked').length} blocked
              </span>
            )}
          </button>

          {/* Tasks */}
          {expandedSections.has(section.id) && section.tasks?.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={selectedTask === task.id}
              onClick={() => onTaskClick(task.id)}
              onToggleComplete={() => onToggleComplete(task)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Task Row Component
function TaskRow({ task, isSelected, onClick, onToggleComplete }: {
  task: TaskWithDetails;
  isSelected: boolean;
  onClick: () => void;
  onToggleComplete: () => void;
}) {
  const statusConfig = {
    todo: { label: 'To Do', color: 'text-gray-400 bg-gray-500/20' },
    in_progress: { label: 'In Progress', color: 'text-yellow-400 bg-yellow-500/20' },
    review: { label: 'Review', color: 'text-purple-400 bg-purple-500/20' },
    done: { label: 'Done', color: 'text-green-400 bg-green-500/20' },
    blocked: { label: 'Blocked', color: 'text-red-400 bg-red-500/20' },
  };

  const priorityConfig = {
    low: { label: 'Low', color: 'text-gray-400' },
    medium: { label: 'Medium', color: 'text-blue-400' },
    high: { label: 'High', color: 'text-orange-400' },
    urgent: { label: 'Urgent', color: 'text-red-400' },
  };

  const status = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
  const priority = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.medium;

  return (
    <div
      className={`flex items-center h-11 px-6 border-b border-[var(--border-subtle)] cursor-pointer transition-colors ${
        isSelected ? 'bg-[var(--bg-selection)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
      onClick={onClick}
    >
      {/* Task Name */}
      <div className="flex-1 min-w-[300px] flex items-center gap-3">
        <button
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] transition-colors ${
            task.status === 'done'
              ? 'bg-[var(--status-success)] border-[var(--status-success)] text-white'
              : task.status === 'blocked'
              ? 'border-red-400'
              : 'border-[var(--text-muted)] hover:border-[var(--status-success)]'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete();
          }}
        >
          {task.status === 'done' && '✓'}
        </button>
        <span className={`text-sm ${task.status === 'done' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
          {task.title}
        </span>
      </div>

      {/* Assignee */}
      <div className="w-32 px-2">
        {task.assignee ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[10px] text-white font-medium">
              {task.assignee.name.charAt(0)}
            </div>
            <span className="text-sm text-[var(--text-secondary)] truncate">{task.assignee.name}</span>
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </div>

      {/* Due Date */}
      <div className="w-28 px-2">
        {task.due_date ? (
          <span className="text-sm text-[var(--text-secondary)]">
            {new Date(task.due_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </div>

      {/* Status */}
      <div className="w-24 px-2">
        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Priority */}
      <div className="w-24 px-2">
        <span className={`text-xs font-medium ${priority.color}`}>
          {priority.label}
        </span>
      </div>
    </div>
  );
}

// ============================================
// Task Board View
// ============================================
function TaskBoardView({ project, onTaskClick, onStatusChange }: {
  project: ProjectWithSections;
  onTaskClick: (id: string) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const allTasks = project.sections?.flatMap(s => s.tasks) || [];

  const columns = [
    { id: 'todo', title: 'To Do', color: '#71717a' },
    { id: 'in_progress', title: 'In Progress', color: '#f59e0b' },
    { id: 'blocked', title: 'Blocked', color: '#ef4444' },
    { id: 'done', title: 'Done', color: '#22c55e' },
  ];

  const handleDragStart = (taskId: string) => {
    setDraggedTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
  };

  const handleDrop = (columnId: string) => {
    if (draggedTaskId) {
      onStatusChange(draggedTaskId, columnId);
      setDraggedTaskId(null);
    }
  };

  return (
    <div className="flex gap-4 p-6 overflow-x-auto h-full">
      {columns.map((column) => {
        const columnTasks = allTasks.filter(t => t.status === column.id);

        return (
          <div
            key={column.id}
            className="flex-shrink-0 w-72 flex flex-col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(column.id)}
          >
            {/* Column Header */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
              <span className="font-medium text-sm text-[var(--text-primary)]">{column.title}</span>
              <span className="text-xs text-[var(--text-muted)]">{columnTasks.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto min-h-[200px] bg-[var(--bg-tertiary)]/30 rounded-lg p-2">
              {columnTasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-3 card hover:border-[var(--accent-primary)] cursor-grab active:cursor-grabbing ${
                    draggedTaskId === task.id ? 'opacity-50' : ''
                  }`}
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onTaskClick(task.id)}
                >
                  <div className="text-sm text-[var(--text-primary)] mb-2">{task.title}</div>
                  <div className="flex items-center justify-between">
                    {task.due_date && (
                      <span className="text-xs text-[var(--text-muted)]">
                        {new Date(task.due_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {task.assignee && (
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[10px] text-white font-medium">
                        {task.assignee.name.charAt(0)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Other Views (Simplified)
// ============================================
function TasksView({ company }: { company: CompanyWithHierarchy }) {
  const allTasks = company.departments?.flatMap(d =>
    d.teams.flatMap(t => t.projects.flatMap(p => p.sections.flatMap(s => s.tasks)))
  ) || [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">My Tasks</h1>
        <p className="text-[var(--text-muted)] mt-1">{allTasks.length} tasks across all projects</p>
      </div>
      <div className="p-8">
        <div className="text-[var(--text-muted)]">Task list view coming soon...</div>
      </div>
    </div>
  );
}

function InboxView() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Inbox</h1>
      </div>
      <div className="p-8">
        <div className="text-[var(--text-muted)]">Inbox coming soon...</div>
      </div>
    </div>
  );
}

function AgentsView({ company }: { company: CompanyWithHierarchy }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">AI Agents</h1>
        <p className="text-[var(--text-muted)] mt-1">Autonomous agents analyzing your organization</p>
      </div>
      <div className="p-8">
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[var(--text-primary)]">Dependency Analyzer</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-dot" />
                  <span className="text-xs text-[var(--text-muted)]">Active</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Automatically discovers hidden dependencies between tasks across different teams and departments.
            </p>
            <div className="text-xs text-[var(--text-muted)]">Last analysis: 5 minutes ago</div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-[var(--text-primary)]">Risk Detector</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-dot" />
                  <span className="text-xs text-[var(--text-muted)]">Active</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Monitors blocked tasks and predicts potential delays before they cascade to other teams.
            </p>
            <div className="text-xs text-[var(--text-muted)]">Found 6 critical path issues</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightsView({ company }: { company: CompanyWithHierarchy }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Insights</h1>
      </div>
      <div className="p-8">
        <div className="text-[var(--text-muted)]">Analytics dashboard coming soon...</div>
      </div>
    </div>
  );
}

function TeamView({ company }: { company: CompanyWithHierarchy }) {
  const allMembers = company.departments?.flatMap(d => d.teams.flatMap(t => t.members)) || [];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Team</h1>
        <p className="text-[var(--text-muted)] mt-1">{allMembers.length} members</p>
      </div>
      <div className="p-8">
        <div className="grid grid-cols-3 gap-4">
          {allMembers.map(member => (
            <div key={member.id} className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium">
                {member.name.charAt(0)}
              </div>
              <div>
                <div className="font-medium text-[var(--text-primary)]">{member.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{member.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Settings</h1>
      </div>
      <div className="p-8">
        <div className="text-[var(--text-muted)]">Settings coming soon...</div>
      </div>
    </div>
  );
}
