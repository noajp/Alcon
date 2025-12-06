'use client';

import { useState } from 'react';
import { sampleData, getProjectById, getTasksBySection, getTasksByProject } from '../../data/alconSampleData';
import type { NavigationState } from './Sidebar';
import type { Task, Project, Section, Member } from '../../types/workspace';

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onTaskSelect?: (taskId: string) => void;
}

export function MainContent({ activeActivity, navigation, onNavigate, onTaskSelect }: MainContentProps) {
  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {activeActivity === 'home' && <HomeView navigation={navigation} />}
      {activeActivity === 'projects' && (
        <ProjectsView navigation={navigation} onNavigate={onNavigate} onTaskSelect={onTaskSelect} />
      )}
      {activeActivity === 'tasks' && <TasksView onTaskSelect={onTaskSelect} />}
      {activeActivity === 'inbox' && <InboxView />}
      {activeActivity === 'agents' && <AgentsView />}
      {activeActivity === 'version' && <VersionView />}
      {activeActivity === 'team' && <TeamView />}
      {activeActivity === 'settings' && <SettingsView />}
    </div>
  );
}

// ============================================
// HOME View - Dashboard
// ============================================
interface HomeViewProps {
  navigation: NavigationState;
}

function HomeView({ navigation }: HomeViewProps) {
  const { tasks, projects, members } = sampleData;
  const myTasks = tasks.filter(t => t.assignee?.id === 'member-1');
  const todayTasks = myTasks.filter(t => {
    if (!t.dueDate) return false;
    const today = new Date();
    return t.dueDate.toDateString() === today.toDateString();
  });
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const completedThisWeek = tasks.filter(t => t.status === 'completed');

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-1">おはようございます、中野さん</h1>
        <p className="text-[var(--text-muted)]">2024年12月6日（金）</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Task Summary */}
        <div className="col-span-2 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard title="今日のタスク" value={String(todayTasks.length)} color="#007ACC" icon="📅" />
            <StatCard title="進行中" value={String(inProgressTasks.length)} color="#F59E0B" icon="🔄" />
            <StatCard title="今週完了" value={String(completedThisWeek.length)} color="#10B981" icon="✅" />
            <StatCard title="要注意" value="2" color="#EF4444" icon="⚠️" />
          </div>

          {/* My Tasks Today */}
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <h2 className="font-medium text-[var(--text-primary)]">今日のタスク</h2>
              <button className="text-sm text-[var(--accent-primary)] hover:underline">すべて見る</button>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              {myTasks.filter(t => t.status !== 'completed').slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] cursor-pointer">
                  <button className={`w-4 h-4 rounded-full border-2 ${
                    task.status === 'completed'
                      ? 'bg-[var(--status-success)] border-[var(--status-success)]'
                      : 'border-[var(--text-muted)] hover:border-[var(--status-success)]'
                  }`} />
                  <span className="flex-1 text-[var(--text-primary)]">{task.name}</span>
                  {task.dueDate && (
                    <span className="text-sm text-[var(--text-muted)]">
                      {task.dueDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {task.tags?.[0] && (
                    <span
                      className="px-2 py-0.5 text-[10px] rounded"
                      style={{ backgroundColor: `${task.tags[0].color}30`, color: task.tags[0].color }}
                    >
                      {task.tags[0].name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Projects Overview */}
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <h2 className="font-medium text-[var(--text-primary)]">アクティブなプロジェクト</h2>
              <button className="text-sm text-[var(--accent-primary)] hover:underline">すべて見る</button>
            </div>
            <div className="grid grid-cols-2 gap-4 p-4">
              {projects.map((project) => (
                <div key={project.id} className="p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] cursor-pointer">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center text-[10px]"
                      style={{ backgroundColor: `${project.color}30`, color: project.color }}
                    >
                      {project.icon}
                    </div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{project.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${project.progress || 0}%`, backgroundColor: project.color }}
                      />
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{project.progress || 0}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Calendar & Activity */}
        <div className="space-y-6">
          {/* Mini Calendar */}
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-[var(--text-primary)]">2024年12月</h2>
              <div className="flex gap-1">
                <button className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded">
                  ‹
                </button>
                <button className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded">
                  ›
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['日', '月', '火', '水', '木', '金', '土'].map((day, i) => (
                <div key={i} className="py-1 text-[var(--text-muted)]">{day}</div>
              ))}
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  className={`py-1 rounded hover:bg-[var(--bg-hover)] ${
                    day === 6
                      ? 'bg-[var(--accent-primary)] text-white'
                      : 'text-[var(--text-secondary)]'
                  } ${[10, 12, 15].includes(day) ? 'underline decoration-[var(--accent-primary)]' : ''}`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <h2 className="font-medium text-[var(--text-primary)]">最近のアクティビティ</h2>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              {[
                { user: '田中', action: '完了', task: 'データベース設計', time: '2時間前' },
                { user: 'AI Agent', action: '提案', task: 'API設計の分割', time: '3時間前' },
                { user: '山田', action: 'コメント', task: 'UI/UXデザイン', time: '5時間前' },
              ].map((activity, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[var(--text-primary)]">{activity.user}</span>
                    <span className="text-[var(--text-muted)]">{activity.action}</span>
                  </div>
                  <div className="text-sm text-[var(--text-secondary)] mt-0.5">{activity.task}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-1">{activity.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color, icon }: { title: string; value: string; color: string; icon: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        <span className="text-2xl font-bold" style={{ color }}>{value}</span>
      </div>
      <div className="text-sm text-[var(--text-muted)]">{title}</div>
    </div>
  );
}

// ============================================
// PROJECTS View
// ============================================
interface ProjectsViewProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onTaskSelect?: (taskId: string) => void;
}

function ProjectsView({ navigation, onNavigate, onTaskSelect }: ProjectsViewProps) {
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [viewType, setViewType] = useState<'list' | 'board'>('list');

  const project = navigation.projectId ? getProjectById(navigation.projectId) : null;
  const tasks = navigation.sectionId
    ? getTasksBySection(navigation.sectionId)
    : navigation.projectId
    ? getTasksByProject(navigation.projectId)
    : [];

  const handleTaskClick = (taskId: string) => {
    setSelectedTask(taskId);
    onTaskSelect?.(taskId);
  };

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        プロジェクトを選択してください
      </div>
    );
  }

  // Get team members for this project
  const team = sampleData.teams.find(t => t.projects.some(p => p.id === project.id));
  const teamMembers = team?.members.map(tm => sampleData.members.find(m => m.id === tm.memberId)).filter(Boolean) || [];

  return (
    <>
      {/* Project Header - Asana style */}
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
        {/* Project Title */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg"
              style={{ backgroundColor: project.color }}
            >
              {project.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-[var(--text-primary)]">{project.name}</h1>
                <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">▼</button>
                <button className="text-yellow-400 hover:text-yellow-300">☆</button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm px-2 py-0.5 rounded ${
                  project.status === 'active' ? 'bg-green-500/20 text-green-400' :
                  project.status === 'on-hold' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {project.status === 'active' ? '進行中' : project.status === 'on-hold' ? '保留' : project.status}
                </span>
                {project.progress !== undefined && (
                  <span className="text-sm text-[var(--text-muted)]">{project.progress}% 完了</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Team Avatars */}
            <div className="flex -space-x-2">
              {teamMembers.slice(0, 4).map((member, i) => (
                <div
                  key={member!.id}
                  className="w-7 h-7 rounded-full border-2 border-[var(--bg-primary)] flex items-center justify-center text-xs text-white"
                  style={{ backgroundColor: member!.avatarColor }}
                  title={member!.name}
                >
                  {member!.name.charAt(0)}
                </div>
              ))}
              {teamMembers.length > 4 && (
                <div className="w-7 h-7 rounded-full border-2 border-[var(--bg-primary)] bg-[var(--bg-tertiary)] flex items-center justify-center text-xs text-[var(--text-muted)]">
                  +{teamMembers.length - 4}
                </div>
              )}
            </div>
            <button className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)] flex items-center gap-1">
              共有
            </button>
            <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-secondary)] flex items-center gap-1">
              🤖 AIに聞く
            </button>
          </div>
        </div>

        {/* View Tabs - Asana style */}
        <div className="flex items-center gap-1 px-6 border-b border-[var(--border-color)]">
          {[
            { id: 'overview', label: '概要', icon: '📊' },
            { id: 'list', label: 'リスト', icon: '☰' },
            { id: 'board', label: 'ボード', icon: '▤' },
            { id: 'timeline', label: 'タイムライン', icon: '📅' },
            { id: 'calendar', label: 'カレンダー', icon: '📆' },
            { id: 'files', label: 'ファイル', icon: '📁' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => tab.id === 'list' || tab.id === 'board' ? setViewType(tab.id as 'list' | 'board') : null}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
                (tab.id === 'list' && viewType === 'list') || (tab.id === 'board' && viewType === 'board')
                  ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
          <button className="px-2 py-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">+</button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-6 py-2">
          <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded flex items-center gap-1">
            + タスクを追加
          </button>
          <div className="h-4 w-px bg-[var(--border-color)]" />
          <button className="px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded flex items-center gap-1">
            🔍 フィルター
          </button>
          <button className="px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded flex items-center gap-1">
            ↕ 並び替え
          </button>
          <button className="px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded flex items-center gap-1">
            ▤ グループ化
          </button>
        </div>
      </div>

      {/* Task List - Asana style */}
      <div className="flex-1 overflow-auto">
        {viewType === 'list' && (
          <AlconTaskListView
            project={project}
            tasks={tasks}
            selectedTask={selectedTask}
            onTaskClick={handleTaskClick}
            activeSectionId={navigation.sectionId}
          />
        )}
        {viewType === 'board' && (
          <AlconBoardView project={project} tasks={tasks} onTaskClick={handleTaskClick} />
        )}
      </div>
    </>
  );
}

// ============================================
// Alcon Task List View
// ============================================
interface AlconTaskListViewProps {
  project: Project;
  tasks: Task[];
  selectedTask: string | null;
  onTaskClick: (taskId: string) => void;
  activeSectionId: string | null;
}

function AlconTaskListView({ project, tasks, selectedTask, onTaskClick, activeSectionId }: AlconTaskListViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(project.sections.map(s => s.id))
  );

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // If a specific section is selected, only show that section
  const sectionsToShow = activeSectionId
    ? project.sections.filter(s => s.id === activeSectionId)
    : project.sections;

  return (
    <div className="min-w-[900px]">
      {/* Column Headers */}
      <div className="sticky top-0 z-10 flex items-center h-9 px-6 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] text-xs text-[var(--text-muted)] uppercase tracking-wide">
        <div className="flex-1 min-w-[300px]">タスク名</div>
        <div className="w-32 px-2">担当者</div>
        <div className="w-28 px-2">期日</div>
        <div className="w-24 px-2">ステータス</div>
        <div className="w-28 px-2">優先度</div>
        <div className="w-32 px-2">タグ</div>
        <div className="w-8 px-2">+</div>
      </div>

      {/* Task Sections */}
      {sectionsToShow.map((section) => {
        const sectionTasks = section.tasks || [];

        return (
          <div key={section.id}>
            {/* Section Header */}
            <div
              className="flex items-center h-10 px-6 bg-[var(--bg-primary)] border-b border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-hover)]"
              onClick={() => toggleSection(section.id)}
            >
              <span className={`mr-2 text-[var(--text-muted)] transition-transform ${expandedSections.has(section.id) ? 'rotate-90' : ''}`}>
                ▶
              </span>
              <span className="font-medium text-[var(--text-primary)]">{section.name}</span>
              <span className="ml-2 text-sm text-[var(--text-muted)]">({sectionTasks.length})</span>
            </div>

            {/* Tasks in Section */}
            {expandedSections.has(section.id) && sectionTasks.map((task) => (
              <AlconTaskRow
                key={task.id}
                task={task}
                isSelected={selectedTask === task.id}
                onClick={() => onTaskClick(task.id)}
              />
            ))}

            {/* Add task row */}
            {expandedSections.has(section.id) && (
              <div className="flex items-center h-9 px-6 border-b border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] cursor-pointer">
                <span className="ml-6">+ タスクを追加...</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Alcon Task Row
// ============================================
interface AlconTaskRowProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
}

function AlconTaskRow({ task, isSelected, onClick }: AlconTaskRowProps) {
  const isCompleted = task.status === 'completed';

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'not-started': return '未着手';
      case 'in-progress': return '進行中';
      case 'in-review': return 'レビュー中';
      case 'blocked': return 'ブロック';
      case 'completed': return '完了';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not-started': return '#6B7280';
      case 'in-progress': return '#F59E0B';
      case 'in-review': return '#8B5CF6';
      case 'blocked': return '#EF4444';
      case 'completed': return '#10B981';
      default: return '#6B7280';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return '緊急';
      case 'high': return '高';
      case 'medium': return '中';
      case 'low': return '低';
      default: return priority;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#EF4444';
      case 'high': return '#F59E0B';
      case 'medium': return '#3B82F6';
      case 'low': return '#6B7280';
      default: return '#6B7280';
    }
  };

  return (
    <div
      className={`flex items-center h-9 px-6 border-b border-[var(--border-color)] cursor-pointer transition-colors ${
        isSelected ? 'bg-[var(--bg-selection)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
      onClick={onClick}
    >
      {/* Task Name */}
      <div className="flex-1 min-w-[300px] flex items-center gap-2">
        <button
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-xs transition-colors ${
            isCompleted
              ? 'bg-[var(--status-success)] border-[var(--status-success)] text-white'
              : 'border-[var(--text-muted)] hover:border-[var(--status-success)]'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {isCompleted && '✓'}
        </button>
        <span className={`${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
          {task.name}
        </span>
      </div>

      {/* Assignee */}
      <div className="w-32 px-2">
        {task.assignee ? (
          <div className="flex items-center gap-1.5">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white"
              style={{ backgroundColor: task.assignee.avatarColor }}
            >
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
        {task.dueDate ? (
          <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)]">
            <span>📅</span>
            <span>{task.dueDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}</span>
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </div>

      {/* Status */}
      <div className="w-24 px-2">
        <span
          className="px-2 py-0.5 text-[10px] rounded"
          style={{ backgroundColor: `${getStatusColor(task.status)}30`, color: getStatusColor(task.status) }}
        >
          {getStatusLabel(task.status)}
        </span>
      </div>

      {/* Priority */}
      <div className="w-28 px-2">
        <span
          className="px-2 py-0.5 text-[10px] rounded"
          style={{ backgroundColor: `${getPriorityColor(task.priority)}30`, color: getPriorityColor(task.priority) }}
        >
          {getPriorityLabel(task.priority)}
        </span>
      </div>

      {/* Tags */}
      <div className="w-32 px-2 flex gap-1 overflow-hidden">
        {task.tags?.slice(0, 2).map((tag, i) => (
          <span
            key={i}
            className="px-1.5 py-0.5 text-[10px] rounded truncate"
            style={{ backgroundColor: `${tag.color}30`, color: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>

      {/* More */}
      <div className="w-8 px-2">
        <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">⋯</button>
      </div>
    </div>
  );
}

// ============================================
// Alcon Board View
// ============================================
interface AlconBoardViewProps {
  project: Project;
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
}

function AlconBoardView({ project, tasks, onTaskClick }: AlconBoardViewProps) {
  const columns = [
    { id: 'not-started', title: '未着手', color: '#6B7280' },
    { id: 'in-progress', title: '進行中', color: '#F59E0B' },
    { id: 'in-review', title: 'レビュー中', color: '#8B5CF6' },
    { id: 'completed', title: '完了', color: '#10B981' },
  ];

  const getColumnTasks = (status: string) => tasks.filter(t => t.status === status);

  return (
    <div className="flex gap-4 p-6 overflow-x-auto h-full">
      {columns.map((column) => (
        <div key={column.id} className="flex-shrink-0 w-72 flex flex-col">
          {/* Column Header */}
          <div className="flex items-center gap-2 mb-3 px-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: column.color }} />
            <span className="font-medium text-[var(--text-primary)]">{column.title}</span>
            <span className="text-sm text-[var(--text-muted)]">{getColumnTasks(column.id).length}</span>
          </div>

          {/* Cards */}
          <div className="flex-1 space-y-2 overflow-y-auto">
            {getColumnTasks(column.id).map((task) => (
              <div
                key={task.id}
                className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] cursor-pointer"
                onClick={() => onTaskClick(task.id)}
              >
                <div className="flex items-start gap-2 mb-2">
                  <button className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 ${
                    task.status === 'completed'
                      ? 'bg-[var(--status-success)] border-[var(--status-success)]'
                      : 'border-[var(--text-muted)]'
                  }`} />
                  <span className={`text-sm ${task.status === 'completed' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                    {task.name}
                  </span>
                </div>
                {task.dueDate && (
                  <div className="text-xs text-[var(--text-muted)] mb-2">
                    📅 {task.dueDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    {task.tags?.slice(0, 1).map((tag, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 text-[10px] rounded"
                        style={{ backgroundColor: `${tag.color}30`, color: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  {task.assignee && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white"
                      style={{ backgroundColor: task.assignee.avatarColor }}
                      title={task.assignee.name}
                    >
                      {task.assignee.name.charAt(0)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Add task */}
            <button className="w-full p-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg text-left">
              + タスクを追加
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// TASKS View - My Tasks
// ============================================
interface TasksViewProps {
  onTaskSelect?: (taskId: string) => void;
}

function TasksView({ onTaskSelect }: TasksViewProps) {
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const handleTaskClick = (taskId: string) => {
    setSelectedTask(taskId);
    onTaskSelect?.(taskId);
  };

  const myTasks = sampleData.tasks.filter(t => t.assignee?.id === 'member-1');

  return (
    <>
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">マイタスク</h1>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded">
              + タスクを追加
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 px-6 pb-2">
          <button className="text-sm text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)] pb-2">
            予定
          </button>
          <button className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] pb-2">
            期限切れ
          </button>
          <button className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] pb-2">
            完了
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <MyTasksListView tasks={myTasks} selectedTask={selectedTask} onTaskClick={handleTaskClick} />
      </div>
    </>
  );
}

function MyTasksListView({ tasks, selectedTask, onTaskClick }: { tasks: Task[]; selectedTask: string | null; onTaskClick: (id: string) => void }) {
  return (
    <div className="min-w-[600px]">
      {/* Column Headers */}
      <div className="sticky top-0 z-10 flex items-center h-9 px-6 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] text-xs text-[var(--text-muted)] uppercase tracking-wide">
        <div className="flex-1 min-w-[300px]">タスク名</div>
        <div className="w-32 px-2">プロジェクト</div>
        <div className="w-28 px-2">期日</div>
        <div className="w-24 px-2">ステータス</div>
      </div>

      {tasks.map((task) => (
        <div
          key={task.id}
          className={`flex items-center h-9 px-6 border-b border-[var(--border-color)] cursor-pointer transition-colors ${
            selectedTask === task.id ? 'bg-[var(--bg-selection)]' : 'hover:bg-[var(--bg-hover)]'
          }`}
          onClick={() => onTaskClick(task.id)}
        >
          <div className="flex-1 min-w-[300px] flex items-center gap-2">
            <button className={`w-4 h-4 rounded-full border-2 ${
              task.status === 'completed'
                ? 'bg-[var(--status-success)] border-[var(--status-success)]'
                : 'border-[var(--text-muted)]'
            }`} />
            <span className="text-[var(--text-primary)]">{task.name}</span>
          </div>
          <div className="w-32 px-2 text-sm text-[var(--text-muted)]">
            {sampleData.projects.find(p => p.id === task.projectId)?.name || '—'}
          </div>
          <div className="w-28 px-2 text-sm text-[var(--text-secondary)]">
            {task.dueDate ? task.dueDate.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '—'}
          </div>
          <div className="w-24 px-2">
            <span className={`px-2 py-0.5 text-[10px] rounded ${
              task.status === 'completed' ? 'bg-green-500/20 text-green-400' :
              task.status === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-gray-500/20 text-gray-400'
            }`}>
              {task.status === 'completed' ? '完了' : task.status === 'in-progress' ? '進行中' : '未着手'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// INBOX View
// ============================================
function InboxView() {
  const notifications = [
    { id: 1, type: 'mention', user: '田中', message: 'API設計であなたをメンション', time: '10分前', read: false },
    { id: 2, type: 'assign', user: '鈴木', message: 'データベース設計をあなたに割り当て', time: '1時間前', read: false },
    { id: 3, type: 'comment', user: '山田', message: 'UI/UXデザインにコメント', time: '2時間前', read: true },
    { id: 4, type: 'complete', user: 'AI Agent', message: 'タスク分割を完了', time: '3時間前', read: true },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-6 py-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">受信トレイ</h1>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className={`flex items-start gap-3 px-6 py-4 hover:bg-[var(--bg-hover)] cursor-pointer ${
              !notif.read ? 'bg-[var(--bg-secondary)]' : ''
            }`}
          >
            {!notif.read && (
              <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)] mt-2" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--text-primary)]">{notif.user}</span>
                <span className="text-[var(--text-secondary)]">{notif.message}</span>
              </div>
              <div className="text-sm text-[var(--text-muted)] mt-1">{notif.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// AGENTS View
// ============================================
function AgentsView() {
  const agents = [
    { id: 1, name: 'タスク分析', description: 'タスクを分析し、分割を提案', status: 'active', lastRun: '5分前' },
    { id: 2, name: 'スケジュール最適化', description: '優先度に基づいてスケジュールを最適化', status: 'active', lastRun: '15分前' },
    { id: 3, name: 'ドキュメント編集', description: 'ドキュメントの作成・編集を支援', status: 'idle', lastRun: '2時間前' },
    { id: 4, name: 'コードレビュー', description: 'コード変更をレビューし改善を提案', status: 'idle', lastRun: '1日前' },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">AIエージェント</h1>
        <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded">
          + エージェントを作成
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] cursor-pointer"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  agent.status === 'active' ? 'bg-[var(--status-success)]' : 'bg-[var(--text-muted)]'
                }`} />
                <h3 className="font-medium text-[var(--text-primary)]">{agent.name}</h3>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{agent.lastRun}</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-3">{agent.description}</p>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
                設定
              </button>
              <button className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)]">
                実行
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// VERSION View
// ============================================
function VersionView() {
  const versions = [
    { version: 'v24', message: 'AIによるタスク分割', type: 'ai', author: 'AI Agent', time: '2時間前', changes: 3 },
    { version: 'v23', message: 'Sprint 2の期日を更新', type: 'manual', author: '中野', time: '5時間前', changes: 5 },
    { version: 'v22', message: 'タスク依存関係を追加', type: 'manual', author: '田中', time: '1日前', changes: 8 },
    { version: 'v21', message: 'プロジェクト初期設定', type: 'manual', author: '中野', time: '2日前', changes: 15 },
  ];

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">バージョン履歴</h1>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded hover:bg-[var(--bg-hover)]">
            比較
          </button>
          <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded">
            ブランチを作成
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.version}
            className="flex items-center gap-4 p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] cursor-pointer"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              v.type === 'ai' ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
            }`}>
              {v.type === 'ai' ? '🤖' : '👤'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-[var(--accent-primary)]">{v.version}</span>
                <span className="font-medium text-[var(--text-primary)]">{v.message}</span>
              </div>
              <div className="text-sm text-[var(--text-muted)]">
                {v.author} · {v.time} · {v.changes}件の変更
              </div>
            </div>
            <button className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded">
              復元
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// TEAM View
// ============================================
function TeamView() {
  const { members } = sampleData;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">チーム</h1>
        <button className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded">
          + メンバーを招待
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {members.map((member) => {
          const memberTasks = sampleData.tasks.filter(t => t.assignee?.id === member.id);
          const memberProjects = new Set(memberTasks.map(t => t.projectId)).size;

          return (
            <div
              key={member.id}
              className="flex items-center gap-4 p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] cursor-pointer"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
                style={{ backgroundColor: member.avatarColor }}
              >
                {member.name.charAt(0)}
              </div>
              <div className="flex-1">
                <h3 className="font-medium text-[var(--text-primary)]">{member.name}</h3>
                <p className="text-sm text-[var(--text-muted)]">{member.title}</p>
              </div>
              <div className="text-right text-sm">
                <div className="text-[var(--text-secondary)]">{memberTasks.length} タスク</div>
                <div className="text-[var(--text-muted)]">{memberProjects} プロジェクト</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// SETTINGS View
// ============================================
function SettingsView() {
  const currentUser = sampleData.members.find(m => m.id === 'member-1');

  return (
    <div className="flex-1 overflow-auto p-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-6">設定</h1>

      <div className="max-w-2xl space-y-6">
        {/* Profile Section */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <h2 className="font-medium text-[var(--text-primary)] mb-4">プロフィール</h2>
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl"
              style={{ backgroundColor: currentUser?.avatarColor }}
            >
              {currentUser?.name.charAt(0)}
            </div>
            <div>
              <div className="text-[var(--text-primary)] font-medium">{currentUser?.name}</div>
              <div className="text-[var(--text-muted)]">{currentUser?.email}</div>
            </div>
          </div>
          <button className="text-sm text-[var(--accent-primary)] hover:underline">プロフィールを編集</button>
        </div>

        {/* Appearance Section */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <h2 className="font-medium text-[var(--text-primary)] mb-4">外観</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">テーマ</span>
              <select className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-1.5 text-[var(--text-primary)]">
                <option>ダーク</option>
                <option>ライト</option>
                <option>システム</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">アクセントカラー</span>
              <div className="flex gap-2">
                {['#007ACC', '#10B981', '#F59E0B', '#EF4444', '#AA62E3'].map((color) => (
                  <button
                    key={color}
                    className="w-6 h-6 rounded-full border-2 border-transparent hover:border-white"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notifications Section */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4">
          <h2 className="font-medium text-[var(--text-primary)] mb-4">通知</h2>
          <div className="space-y-3">
            {['メール通知', 'プッシュ通知', 'AIの提案'].map((setting) => (
              <div key={setting} className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">{setting}</span>
                <button className="w-10 h-5 bg-[var(--accent-primary)] rounded-full relative">
                  <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
