'use client';

import { useState, useCallback, useEffect } from 'react';
import type { NavigationState } from './Sidebar';
import type {
  CompanyWithHierarchy,
  CompanyWithUnits,
  DepartmentWithTeams,
  TeamWithProjects,
  ProjectWithSections,
  SectionWithTasks,
  TaskWithDetails,
  TaskValidationResult,
  ChangeAnalysisResult,
  OrganizationUnitWithChildren,
  Section,
  Subtask,
  Member,
} from '@/hooks/useSupabase';
import {
  createTask,
  updateTask,
  deleteTask,
  validateTask,
  analyzeTaskChange,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createTeam,
  updateTeam,
  moveTeamToDepartment,
  moveTeamsToDepartment,
  deleteTeam,
  createOrganizationUnit,
  updateOrganizationUnit,
  deleteOrganizationUnit,
  moveOrganizationUnit,
  createProject,
  updateProject,
  deleteProject,
  createSection,
  updateSection,
  deleteSection,
  createSubtask,
  updateSubtask,
  deleteSubtask,
  toggleSubtaskComplete,
} from '@/hooks/useSupabase';
import { supabase } from '@/lib/supabase';

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  company: CompanyWithHierarchy | null;
  companyWithUnits?: CompanyWithUnits | null;
  onRefresh?: () => void;
}

export function MainContent({ activeActivity, navigation, onNavigate, company, companyWithUnits, onRefresh }: MainContentProps) {
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
      {activeActivity === 'settings' && <SettingsView company={company} companyWithUnits={companyWithUnits} onRefresh={onRefresh} />}
    </div>
  );
}

// ============================================
// Helper: Recursively collect all data from nested departments
// ============================================
function collectDepartmentData(departments: DepartmentWithTeams[]): {
  allTasks: TaskWithDetails[];
  allProjects: ProjectWithSections[];
  allTeams: TeamWithProjects[];
  allMembers: Member[];
} {
  let allTasks: TaskWithDetails[] = [];
  let allProjects: ProjectWithSections[] = [];
  let allTeams: TeamWithProjects[] = [];
  let allMembers: Member[] = [];

  const collectFromDepartment = (dept: DepartmentWithTeams) => {
    // Collect from this department's teams
    for (const team of dept.teams || []) {
      allTeams.push(team);
      allMembers.push(...(team.members || []));
      for (const project of team.projects || []) {
        allProjects.push(project);
        for (const section of project.sections || []) {
          allTasks.push(...(section.tasks || []));
        }
      }
    }
    // Recursively collect from children
    for (const child of dept.children || []) {
      collectFromDepartment(child);
    }
  };

  for (const dept of departments) {
    collectFromDepartment(dept);
  }

  return { allTasks, allProjects, allTeams, allMembers };
}

// Helper to collect all tasks from a single department (including children)
function collectTasksFromDepartment(dept: DepartmentWithTeams): TaskWithDetails[] {
  let tasks: TaskWithDetails[] = [];

  // Collect from this department's teams
  for (const team of dept.teams || []) {
    for (const project of team.projects || []) {
      for (const section of project.sections || []) {
        tasks.push(...(section.tasks || []));
      }
    }
  }

  // Recursively collect from children
  for (const child of dept.children || []) {
    tasks.push(...collectTasksFromDepartment(child));
  }

  return tasks;
}

// Helper to flatten all departments (including nested ones)
function flattenDepartments(departments: DepartmentWithTeams[]): DepartmentWithTeams[] {
  let result: DepartmentWithTeams[] = [];

  for (const dept of departments) {
    result.push(dept);
    if (dept.children && dept.children.length > 0) {
      result.push(...flattenDepartments(dept.children));
    }
  }

  return result;
}

// Helper: Find a department by ID (including nested)
function findDepartmentById(departments: DepartmentWithTeams[], deptId: string): DepartmentWithTeams | undefined {
  for (const dept of departments) {
    if (dept.id === deptId) return dept;
    if (dept.children && dept.children.length > 0) {
      const found = findDepartmentById(dept.children, deptId);
      if (found) return found;
    }
  }
  return undefined;
}

// Helper: Check if a folder has tasks (directly or via teams)
// A folder "has tasks" if it has teams with projects (teams are execution units)
function folderHasTasks(dept: DepartmentWithTeams): boolean {
  // If this department has teams, it's an execution-level folder
  if (dept.teams && dept.teams.length > 0) {
    return true;
  }
  return false;
}

// Helper: Check if a folder only has subfolders (no direct tasks)
function folderHasOnlySubfolders(dept: DepartmentWithTeams): boolean {
  // Has children (subfolders) but no teams
  const hasChildren = dept.children && dept.children.length > 0;
  const hasTeams = dept.teams && dept.teams.length > 0;
  return hasChildren && !hasTeams;
}

// ============================================
// HOME View - Dashboard
// ============================================
function HomeView({ company, navigation }: { company: CompanyWithHierarchy; navigation: NavigationState }) {
  const { allTasks, allProjects, allTeams } = collectDepartmentData(company.departments || []);

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
                    { name: 'Q4 Settlement', dept: 'Accounting', status: 'blocked' },
                    { name: 'Budget Approval', dept: 'Finance', status: 'blocked' },
                    { name: 'Vendor Contract', dept: 'Procurement', status: 'blocked' },
                    { name: 'Infra Setup', dept: 'Infrastructure', status: 'blocked' },
                    { name: 'Prod Deploy', dept: 'Development', status: 'blocked' },
                    { name: 'QA Verification', dept: 'QA', status: 'blocked' },
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
                  <span className="text-[var(--text-muted)]">Root cause: Settlement delay</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-[var(--text-muted)]">Impact: Affects 3/15 release</span>
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
                {flattenDepartments(company.departments || []).map(dept => {
                  const deptTasks = collectTasksFromDepartment(dept);
                  const blocked = deptTasks.filter(t => t.status === 'blocked').length;
                  const total = deptTasks.length;

                  return (
                    <div key={dept.id} className="flex items-center gap-2 py-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: dept.color || '#3b82f6' }}
                      />
                      <span className="flex-1 text-sm text-[var(--text-primary)]">{dept.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">{total} tasks</span>
                      {blocked > 0 && (
                        <span className="text-xs text-red-400">{blocked} blocked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Teams</h3>
              <div className="space-y-2">
                {allTeams.slice(0, 6).map(team => {
                  const teamTasks = team.projects.flatMap(p => p.sections.flatMap(s => s.tasks));
                  const inProgress = teamTasks.filter(t => t.status === 'in_progress').length;
                  const done = teamTasks.filter(t => t.status === 'done').length;

                  return (
                    <div key={team.id} className="flex items-center gap-2 py-1">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{team.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">{team.members?.length || 0} members</span>
                      {inProgress > 0 && (
                        <span className="text-xs text-yellow-400">{inProgress} active</span>
                      )}
                    </div>
                  );
                })}
                {allTeams.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)]">No teams yet</div>
                )}
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
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<TaskValidationResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ChangeAnalysisResult | null>(null);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  // Project creation state
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  // Section management state
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editSectionName, setEditSectionName] = useState('');

  // Create project handler
  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !selectedTeamId) return;
    setIsLoading(true);
    try {
      const newProject = await createProject({
        name: newProjectName.trim(),
        team_id: selectedTeamId,
        description: newProjectDesc.trim() || null,
      });
      // Create a default section
      await createSection({
        name: 'To Do',
        project_id: newProject.id,
      });
      setNewProjectName('');
      setNewProjectDesc('');
      setSelectedTeamId('');
      setShowCreateProject(false);
      onRefresh?.();
      // Navigate to the new project
      onNavigate({ projectId: newProject.id });
    } catch (e) {
      console.error('Failed to create project:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Section handlers
  const handleCreateSection = async (projectId: string) => {
    if (!newSectionName.trim()) return;
    setIsLoading(true);
    try {
      await createSection({
        name: newSectionName.trim(),
        project_id: projectId,
      });
      setNewSectionName('');
      setIsAddingSection(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create section:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSection = async (sectionId: string) => {
    if (!editSectionName.trim()) return;
    setIsLoading(true);
    try {
      await updateSection(sectionId, { name: editSectionName.trim() });
      setEditingSection(null);
      setEditSectionName('');
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update section:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm('Delete this section and all its tasks?')) return;
    setIsLoading(true);
    try {
      await deleteSection(sectionId);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete section:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if a department is selected (without a specific project) - including nested departments
  const findDepartmentWithTeam = (depts: DepartmentWithTeams[], teamId: string): DepartmentWithTeams | undefined => {
    for (const dept of depts) {
      if (dept.teams.some(t => t.id === teamId)) {
        return dept;
      }
      if (dept.children && dept.children.length > 0) {
        const found = findDepartmentWithTeam(dept.children, teamId);
        if (found) return found;
      }
    }
    return undefined;
  };
  const selectedDepartment = navigation.teamId ? findDepartmentWithTeam(company.departments || [], navigation.teamId) : undefined;
  const selectedTeam = selectedDepartment?.teams.find(t => t.id === navigation.teamId);

  // If department is selected (without team or project), show folder dashboard
  if (navigation.departmentId && !navigation.teamId && !navigation.projectId) {
    const dept = findDepartmentById(company.departments || [], navigation.departmentId);
    if (dept) {
      // Determine dashboard type based on folder contents
      if (folderHasTasks(dept)) {
        // This folder has teams (execution units) - show task-focused dashboard
        return <FolderTaskDashboard department={dept} company={company} />;
      } else {
        // This folder only has subfolders - show executive/summary dashboard
        return <FolderSummaryDashboard department={dept} company={company} />;
      }
    }
  }

  // If team is selected but no project, show team dashboard
  if (navigation.teamId && !navigation.projectId && selectedTeam) {
    return <TeamDashboard team={selectedTeam} department={selectedDepartment!} company={company} />;
  }

  // Find selected project (including nested departments)
  const { allProjects } = collectDepartmentData(company.departments || []);
  const project = allProjects.find(p => p.id === navigation.projectId);

  // Get first section for adding tasks
  const firstSection = project?.sections?.[0];

  // Handle task validation (before creation)
  const handleValidateTask = async () => {
    if (!newTaskTitle.trim() || !firstSection || !project) return;

    setIsLoading(true);
    setValidationResult(null);
    try {
      const result = await validateTask(
        { title: newTaskTitle.trim(), due_date: newTaskDueDate || null, priority: 'medium' },
        project.id,
        firstSection.id
      );
      setValidationResult(result);
    } catch (error) {
      console.error('Failed to validate task:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
        due_date: newTaskDueDate || null,
        assignee_id: null,
        worker_id: null,
        estimated_hours: null,
        actual_hours: null,
        order_index: (firstSection.tasks?.length || 0),
      });
      setNewTaskTitle('');
      setNewTaskDueDate('');
      setIsAddingTask(false);
      setValidationResult(null);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle task status update with AI analysis
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    // Find the original task
    const allTasks = project?.sections?.flatMap(s => s.tasks) || [];
    const originalTask = allTasks.find(t => t.id === taskId);
    const oldStatus = originalTask?.status;

    setIsLoading(true);
    try {
      await updateTask(taskId, { status: newStatus });

      // Trigger AI analysis for significant status changes
      if (oldStatus && (newStatus === 'blocked' || newStatus === 'done' || oldStatus === 'blocked')) {
        try {
          const analysis = await analyzeTaskChange(taskId, 'status', oldStatus, newStatus);
          if (analysis && (analysis.severity === 'critical' || analysis.severity === 'high')) {
            setAnalysisResult(analysis);
            setShowAnalysisModal(true);
          }
        } catch (e) {
          console.error('AI analysis failed:', e);
        }
      }

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

  // Get all teams for project creation dropdown
  const allTeams = company.departments?.flatMap(d =>
    d.teams.map(t => ({ ...t, departmentName: d.name }))
  ) || [];

  if (!project) {
    return (
      <>
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
            <p className="text-sm text-[var(--text-muted)] mb-4">Choose a project from the sidebar to view tasks</p>
            <button
              onClick={() => setShowCreateProject(true)}
              className="btn btn-primary"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Project
            </button>
          </div>
        </div>

        {/* Create Project Modal */}
        {showCreateProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-[500px] shadow-xl border border-[var(--border-color)]">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create New Project</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">Project Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Enter project name..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">Team</label>
                  <select
                    className="input"
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                  >
                    <option value="">Select a team...</option>
                    {allTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.departmentName} / {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">Description (optional)</label>
                  <textarea
                    className="input min-h-[80px] resize-none"
                    placeholder="Project description..."
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowCreateProject(false);
                    setNewProjectName('');
                    setNewProjectDesc('');
                    setSelectedTeamId('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim() || !selectedTeamId || isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const doneTasks = allTasks.filter(t => t.status === 'done').length;
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

  return (
    <>
      {/* Project Header */}
      <div className="border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-semibold shadow-sm">
              {project.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-gray-800">{project.name}</h1>
                {blockedTasks > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-rose-50 text-rose-500 border border-rose-100">
                    {blockedTasks} blocked
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{progress}%</span>
                </div>
                <span className="text-xs text-gray-400">{allTasks.length} tasks</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              onClick={() => setIsAddingTask(true)}
              disabled={isLoading}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Task
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
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
                  ? 'border-gray-800 text-gray-800 font-medium'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task Content */}
      <div className="flex-1 overflow-auto bg-white">
        {viewType === 'list' && (
          <TaskListView
            project={project}
            selectedTask={selectedTask}
            onTaskClick={setSelectedTask}
            activeSectionId={navigation.sectionId}
            onToggleComplete={handleToggleComplete}
            onAddSection={() => setIsAddingSection(true)}
            onEditSection={(sectionId, name) => {
              updateSection(sectionId, { name }).then(() => onRefresh?.());
            }}
            onDeleteSection={handleDeleteSection}
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

      {/* Add Section Modal */}
      {isAddingSection && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-[400px] shadow-xl border border-[var(--border-color)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Add New Section</h3>
            <input
              type="text"
              className="input mb-4"
              placeholder="Section name..."
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSection(project.id);
                if (e.key === 'Escape') {
                  setIsAddingSection(false);
                  setNewSectionName('');
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setIsAddingSection(false);
                  setNewSectionName('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleCreateSection(project.id)}
                disabled={!newSectionName.trim() || isLoading}
              >
                {isLoading ? 'Creating...' : 'Create Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal with AI Validation */}
      {isAddingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-[500px] shadow-xl border border-[var(--border-color)]">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Add New Task</h3>

            <input
              type="text"
              className="input mb-3"
              placeholder="Task title..."
              value={newTaskTitle}
              onChange={(e) => {
                setNewTaskTitle(e.target.value);
                setValidationResult(null);
              }}
              autoFocus
            />

            <input
              type="date"
              className="input mb-4"
              value={newTaskDueDate}
              onChange={(e) => {
                setNewTaskDueDate(e.target.value);
                setValidationResult(null);
              }}
            />

            {/* AI Validation Result */}
            {validationResult && (
              <div className={`mb-4 p-3 rounded-lg border ${
                validationResult.valid
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-yellow-500/10 border-yellow-500/30'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationResult.valid ? (
                    <span className="text-green-400 text-sm font-medium">AI Check Passed</span>
                  ) : (
                    <span className="text-yellow-400 text-sm font-medium">AI Warnings</span>
                  )}
                </div>

                {validationResult.duplicates && validationResult.duplicates.length > 0 && (
                  <div className="text-xs text-[var(--text-secondary)] mb-2">
                    <div className="font-medium text-yellow-400">Similar tasks found:</div>
                    {validationResult.duplicates.map((d, i) => (
                      <div key={i} className="ml-2">- {d.title}</div>
                    ))}
                  </div>
                )}

                {validationResult.conflicts && validationResult.conflicts.length > 0 && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    <div className="font-medium text-red-400">Potential conflicts:</div>
                    {validationResult.conflicts.map((c, i) => (
                      <div key={i} className="ml-2">- {c.message} ({c.department})</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between gap-2">
              <button
                className="btn btn-ghost text-sm"
                onClick={handleValidateTask}
                disabled={!newTaskTitle.trim() || isLoading}
              >
                {isLoading ? 'Checking...' : 'AI Check'}
              </button>

              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setIsAddingTask(false);
                    setNewTaskTitle('');
                    setNewTaskDueDate('');
                    setValidationResult(null);
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
        </div>
      )}

      {/* AI Analysis Result Modal */}
      {showAnalysisModal && analysisResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-6 w-[550px] max-h-[80vh] overflow-auto shadow-xl border border-[var(--border-color)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                Impact Analysis
              </h3>
              <span className={`px-2 py-1 text-xs rounded-full ${
                analysisResult.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                analysisResult.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                analysisResult.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-green-500/20 text-green-400'
              }`}>
                {analysisResult.severity.toUpperCase()}
              </span>
            </div>

            <div className="space-y-4">
              {/* Impacts */}
              {analysisResult.impacts && analysisResult.impacts.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Affected Tasks</h4>
                  <div className="space-y-2">
                    {analysisResult.impacts.map((impact, i) => (
                      <div key={i} className="p-2 bg-[var(--bg-tertiary)] rounded-lg text-sm">
                        <div className="font-medium text-[var(--text-primary)]">{impact.task_title}</div>
                        <div className="text-xs text-[var(--text-muted)]">{impact.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cross-department alerts */}
              {analysisResult.cross_department_alerts && analysisResult.cross_department_alerts.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Cross-Department Alerts</h4>
                  <div className="space-y-2">
                    {analysisResult.cross_department_alerts.map((alert, i) => (
                      <div key={i} className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm">
                        <div className="font-medium text-red-400">{alert.from_dept} → {alert.to_dept}</div>
                        <div className="text-xs text-[var(--text-secondary)]">{alert.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Analysis Raw (for debugging) */}
              {analysisResult.ai_analysis && (
                <details className="text-xs">
                  <summary className="text-[var(--text-muted)] cursor-pointer">View AI Analysis (TOON)</summary>
                  <pre className="mt-2 p-2 bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)] overflow-auto max-h-40">
                    {analysisResult.ai_analysis}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowAnalysisModal(false);
                  setAnalysisResult(null);
                }}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Panel */}
      {selectedTask && project && (() => {
        const allMembers = company.departments?.flatMap(d =>
          d.teams.flatMap(t => t.members)
        ) || [];
        const selectedTaskData = project.sections?.flatMap(s => s.tasks).find(t => t.id === selectedTask);
        if (!selectedTaskData) return null;

        return (
          <TaskDetailPanel
            task={selectedTaskData}
            members={allMembers}
            onClose={() => setSelectedTask(null)}
            onUpdate={async (updates) => {
              await updateTask(selectedTask, updates);
              setSelectedTask(null);
            }}
            onDelete={async () => {
              if (confirm('Are you sure you want to delete this task?')) {
                await deleteTask(selectedTask);
                setSelectedTask(null);
                onRefresh?.();
              }
            }}
            onRefresh={onRefresh}
          />
        );
      })()}
    </>
  );
}

// ============================================
// Task List View - New Arc Design
// ============================================

// Section Arc Component - Mountain curve for visual grouping
function SectionArc({ taskCount, color }: { taskCount: number; color: string }) {
  const rowHeight = 48;
  const totalHeight = taskCount * rowHeight;
  const arcWidth = 28;
  const midY = totalHeight / 2;

  if (taskCount === 0) return null;

  return (
    <svg
      className="absolute left-0 top-0 pointer-events-none"
      width={arcWidth}
      height={totalHeight}
      style={{ zIndex: 5 }}
    >
      <path
        d={`M 4 0 Q ${arcWidth - 4} ${midY}, 4 ${totalHeight}`}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

const sectionColorPalette = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

function TaskListView({ project, selectedTask, onTaskClick, activeSectionId, onToggleComplete, onAddSection, onEditSection, onDeleteSection }: {
  project: ProjectWithSections;
  selectedTask: string | null;
  onTaskClick: (id: string) => void;
  activeSectionId: string | null;
  onToggleComplete: (task: TaskWithDetails) => void;
  onAddSection?: () => void;
  onEditSection?: (sectionId: string, name: string) => void;
  onDeleteSection?: (sectionId: string) => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(project.sections?.map(s => s.id) || [])
  );
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStartEdit = (section: SectionWithTasks) => {
    setEditingSectionId(section.id);
    setEditName(section.name);
  };

  const handleSaveEdit = () => {
    if (editingSectionId && editName.trim() && onEditSection) {
      onEditSection(editingSectionId, editName.trim());
    }
    setEditingSectionId(null);
    setEditName('');
  };

  const sectionsToShow = activeSectionId
    ? project.sections?.filter(s => s.id === activeSectionId)
    : project.sections;

  // Calculate continuous row numbers
  let rowNumber = 0;

  return (
    <div className="min-w-[800px] bg-white">
      {/* Column Headers */}
      <div className="sticky top-0 z-10 flex items-center h-11 pl-16 pr-6 bg-white border-b border-gray-100">
        <div className="w-10 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">#</div>
        <div className="w-8"></div>
        <div className="flex-1 pl-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Name</div>
        <div className="w-32 text-xs font-medium text-gray-400 uppercase tracking-wider text-center">Assignee</div>
        <div className="w-28 text-xs font-medium text-gray-400 uppercase tracking-wider text-center">Due Date</div>
        <div className="w-24 text-xs font-medium text-gray-400 uppercase tracking-wider text-center">Status</div>
        <div className="w-24 text-xs font-medium text-gray-400 uppercase tracking-wider text-center">Priority</div>
      </div>

      {/* Sections with Arc Lines */}
      <div className="relative">
        {sectionsToShow?.map((section, sectionIndex) => {
          const isExpanded = expandedSections.has(section.id);
          const taskCount = section.tasks?.length || 0;
          const blockedCount = section.tasks?.filter(t => t.status === 'blocked').length || 0;
          const sectionColor = sectionColorPalette[sectionIndex % sectionColorPalette.length];

          return (
            <div key={section.id} className="relative">
              {/* Section Header */}
              <div
                className="flex items-center h-11 pl-16 pr-6 cursor-pointer hover:bg-gray-50/50 transition-colors border-b border-gray-50 group"
                onClick={() => toggleSection(section.id)}
              >
                <div className="w-10"></div>
                <div className="w-8 flex items-center justify-center">
                  <svg
                    className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
                <div className="flex items-center gap-3 flex-1 pl-3">
                  {editingSectionId === section.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') {
                          setEditingSectionId(null);
                          setEditName('');
                        }
                      }}
                      className="bg-white border border-gray-200 rounded px-2 py-0.5 text-sm font-medium text-gray-700 focus:outline-none focus:border-gray-400"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-gray-600">{section.name}</span>
                      <span className="text-xs text-gray-400">({taskCount})</span>
                      {blockedCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-50 text-rose-500 border border-rose-100">
                          {blockedCount} blocked
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Section actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(section);
                    }}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                    title="Edit section"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSection?.(section.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded"
                    title="Delete section"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Tasks with Arc */}
              {isExpanded && section.tasks && section.tasks.length > 0 && (
                <div className="relative pl-10">
                  {/* Arc line for the section */}
                  <SectionArc taskCount={section.tasks.length} color={sectionColor} />

                  {/* Section label on arc */}
                  <div
                    className="absolute left-8 text-[10px] font-medium whitespace-nowrap pointer-events-none"
                    style={{
                      top: (section.tasks.length * 48) / 2,
                      color: sectionColor,
                      transform: 'translateY(-50%) rotate(-90deg)',
                      transformOrigin: 'left center',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {section.name}
                  </div>

                  {section.tasks.map((task, index) => {
                    rowNumber++;
                    const currentRow = rowNumber;

                    return (
                      <div
                        key={task.id}
                        className={`flex items-center h-12 pl-6 pr-6 cursor-pointer transition-colors border-b border-gray-50 ${
                          selectedTask === task.id ? 'bg-gray-50' : 'hover:bg-gray-50/30'
                        }`}
                        onClick={() => onTaskClick(task.id)}
                      >
                        {/* Row Number */}
                        <div className="w-10 text-center text-xs text-gray-300 font-mono tabular-nums">
                          {currentRow}
                        </div>

                        {/* Checkbox */}
                        <div className="w-8 flex items-center justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleComplete(task);
                            }}
                            className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-all ${
                              task.status === 'done'
                                ? 'bg-gray-700 border-gray-700'
                                : 'border-gray-300 hover:border-gray-400 bg-white'
                            }`}
                          >
                            {task.status === 'done' && (
                              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M5 12l5 5L20 7" />
                              </svg>
                            )}
                          </button>
                        </div>

                        {/* Task Name */}
                        <div className="flex-1 pl-3">
                          <span className={`text-sm ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {task.title}
                          </span>
                        </div>

                        {/* Assignee */}
                        <div className="w-32 flex justify-center">
                          {task.assignee ? (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-medium">
                                {task.assignee.name.charAt(0)}
                              </div>
                              <span className="text-xs text-gray-500 truncate max-w-[80px]">{task.assignee.name}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>

                        {/* Due Date */}
                        <div className="w-28 text-center">
                          {task.due_date ? (
                            <span className="text-xs text-gray-500">
                              {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>

                        {/* Status Badge */}
                        <div className="w-24 flex justify-center">
                          <span className={`text-[11px] px-2.5 py-1 rounded font-medium ${
                            task.status === 'done'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              : task.status === 'in_progress'
                              ? 'bg-sky-50 text-sky-600 border border-sky-100'
                              : task.status === 'blocked'
                              ? 'bg-rose-50 text-rose-600 border border-rose-100'
                              : 'bg-gray-50 text-gray-500 border border-gray-100'
                          }`}>
                            {task.status === 'done' ? 'done' :
                             task.status === 'in_progress' ? 'in progress' :
                             task.status === 'blocked' ? 'blocked' : 'to do'}
                          </span>
                        </div>

                        {/* Priority Badge */}
                        <div className="w-24 flex justify-center">
                          <span className={`text-[11px] px-2.5 py-1 rounded font-medium ${
                            task.priority === 'urgent'
                              ? 'bg-rose-50 text-rose-600 border border-rose-100'
                              : task.priority === 'high'
                              ? 'bg-orange-50 text-orange-600 border border-orange-100'
                              : task.priority === 'medium'
                              ? 'bg-sky-50 text-sky-600 border border-sky-100'
                              : 'bg-gray-50 text-gray-500 border border-gray-100'
                          }`}>
                            {task.priority || 'low'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Section Button */}
      {onAddSection && (
        <button
          onClick={onAddSection}
          className="w-full flex items-center gap-2 h-10 px-6 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span className="text-sm">Add Section</span>
        </button>
      )}
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
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                        {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
// Folder Summary Dashboard (for folders with only subfolders - executive view)
// ============================================
function FolderSummaryDashboard({ department, company }: {
  department: DepartmentWithTeams;
  company: CompanyWithHierarchy;
}) {
  // Collect all data from this folder and its children
  const { allTasks, allProjects, allTeams, allMembers } = collectDepartmentData([department]);

  // Calculate stats
  const totalTasks = allTasks.length;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked');
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
  const doneTasks = allTasks.filter(t => t.status === 'done');
  const todoTasks = allTasks.filter(t => t.status === 'todo');
  const progress = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;
  const urgentTasks = allTasks.filter(t => t.priority === 'urgent' && t.status !== 'done');

  // Get child folders stats
  const childFolders = department.children || [];

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-muted)]">
            <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
          </svg>
          <span className="text-xs text-[var(--text-faint)] uppercase tracking-wider">Folder</span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{department.name}</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-[var(--text-muted)]">
          <span>{childFolders.length} subfolders</span>
          <span>{allTeams.length} teams</span>
          <span>{allMembers.length} members</span>
          <span>{totalTasks} tasks</span>
        </div>
      </div>

      <div className="p-8">
        {/* Overview Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="card p-5 bg-gradient-to-br from-red-500/10 to-red-600/5">
            <div className="text-3xl font-bold text-[var(--text-primary)]">{blockedTasks.length}</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">Blocked</div>
            <div className="text-xs text-red-400 mt-2">Requires attention</div>
          </div>
          <div className="card p-5 bg-gradient-to-br from-yellow-500/10 to-yellow-600/5">
            <div className="text-3xl font-bold text-[var(--text-primary)]">{inProgressTasks.length}</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">In Progress</div>
            <div className="text-xs text-yellow-400 mt-2">Currently active</div>
          </div>
          <div className="card p-5 bg-gradient-to-br from-green-500/10 to-green-600/5">
            <div className="text-3xl font-bold text-[var(--text-primary)]">{doneTasks.length}</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">Completed</div>
            <div className="text-xs text-green-400 mt-2">{progress}% done</div>
          </div>
          <div className="card p-5 bg-gradient-to-br from-purple-500/10 to-purple-600/5">
            <div className="text-3xl font-bold text-[var(--text-primary)]">{urgentTasks.length}</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">Urgent</div>
            <div className="text-xs text-purple-400 mt-2">High priority</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="card p-4 mb-8 bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--text-secondary)]">Overall Progress</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">{progress}%</span>
          </div>
          <div className="h-3 bg-[var(--bg-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Subfolders */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Subfolders</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {childFolders.map((child) => {
                const childData = collectDepartmentData([child]);
                const childProgress = childData.allTasks.length > 0
                  ? Math.round((childData.allTasks.filter(t => t.status === 'done').length / childData.allTasks.length) * 100)
                  : 0;
                const childBlocked = childData.allTasks.filter(t => t.status === 'blocked').length;

                return (
                  <div key={child.id} className="p-4 flex items-center gap-4 hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-secondary)]">
                      <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">{child.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {childData.allTeams.length} teams · {childData.allTasks.length} tasks
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {childBlocked > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                          {childBlocked} blocked
                        </span>
                      )}
                      <div className="w-16 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${childProgress}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-8">{childProgress}%</span>
                    </div>
                  </div>
                );
              })}
              {childFolders.length === 0 && (
                <div className="p-8 text-center text-[var(--text-muted)]">
                  No subfolders
                </div>
              )}
            </div>
          </div>

          {/* Members Overview */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Members ({allMembers.length})</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden">
              <div className="divide-y divide-[var(--border-subtle)] max-h-[400px] overflow-auto">
                {allMembers.slice(0, 10).map((member) => {
                  const memberTasks = allTasks.filter(t => t.assignee_id === member.id);
                  const memberBlocked = memberTasks.filter(t => t.status === 'blocked').length;
                  const memberInProgress = memberTasks.filter(t => t.status === 'in_progress').length;

                  return (
                    <div key={member.id} className="p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-500 to-gray-600 flex items-center justify-center text-white text-sm font-medium">
                        {member.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--text-primary)] truncate">{member.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">{member.role || 'Member'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {memberBlocked > 0 && (
                          <span className="text-xs text-red-400">{memberBlocked} blocked</span>
                        )}
                        {memberInProgress > 0 && (
                          <span className="text-xs text-yellow-400">{memberInProgress} active</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {allMembers.length === 0 && (
                  <div className="p-8 text-center text-[var(--text-muted)]">
                    No members
                  </div>
                )}
                {allMembers.length > 10 && (
                  <div className="p-3 text-center text-xs text-[var(--text-muted)]">
                    +{allMembers.length - 10} more members
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Blocked Tasks Alert */}
        {blockedTasks.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Blocked Tasks</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {blockedTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="p-4 flex items-center gap-4">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-primary)]">{task.title}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {task.assignee?.name || 'Unassigned'}
                    </div>
                  </div>
                  {task.due_date && (
                    <span className="text-xs text-[var(--text-muted)]">
                      Due: {new Date(task.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
              {blockedTasks.length > 5 && (
                <div className="p-3 text-center text-xs text-[var(--text-muted)]">
                  +{blockedTasks.length - 5} more blocked tasks
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Folder Task Dashboard (for folders with teams - execution view)
// ============================================
function FolderTaskDashboard({ department, company }: {
  department: DepartmentWithTeams;
  company: CompanyWithHierarchy;
}) {
  // This folder has teams directly - show team-focused dashboard
  const teams = department.teams || [];
  const { allTasks, allProjects, allMembers } = collectDepartmentData([department]);

  const totalTasks = allTasks.length;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked');
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
  const doneTasks = allTasks.filter(t => t.status === 'done');
  const todoTasks = allTasks.filter(t => t.status === 'todo');
  const progress = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-muted)]">
            <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
          </svg>
          <span className="text-xs text-[var(--text-faint)] uppercase tracking-wider">Execution Unit</span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{department.name}</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-[var(--text-muted)]">
          <span>{teams.length} teams</span>
          <span>{allMembers.length} members</span>
          <span>{allProjects.length} projects</span>
          <span>{totalTasks} tasks</span>
        </div>
      </div>

      <div className="p-8">
        {/* Task Stats */}
        <div className="grid grid-cols-5 gap-4 mb-8">
          <div className="card p-4 bg-[var(--bg-surface)]">
            <div className="text-2xl font-bold text-[var(--text-primary)]">{totalTasks}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Total Tasks</div>
          </div>
          <div className="card p-4 bg-[var(--bg-surface)]">
            <div className="text-2xl font-bold text-[var(--text-primary)]">{todoTasks.length}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">To Do</div>
          </div>
          <div className="card p-4 bg-[var(--bg-surface)]">
            <div className="text-2xl font-bold text-yellow-400">{inProgressTasks.length}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">In Progress</div>
          </div>
          <div className="card p-4 bg-[var(--bg-surface)]">
            <div className="text-2xl font-bold text-red-400">{blockedTasks.length}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Blocked</div>
          </div>
          <div className="card p-4 bg-[var(--bg-surface)]">
            <div className="text-2xl font-bold text-green-400">{doneTasks.length}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Completed</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="card p-4 mb-8 bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--text-secondary)]">Overall Progress</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">{progress}%</span>
          </div>
          <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Teams */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Teams</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {teams.map((team) => {
                const teamTasks = team.projects.flatMap(p => p.sections?.flatMap(s => s.tasks) || []);
                const teamProgress = teamTasks.length > 0
                  ? Math.round((teamTasks.filter(t => t.status === 'done').length / teamTasks.length) * 100)
                  : 0;
                const teamBlocked = teamTasks.filter(t => t.status === 'blocked').length;
                const teamInProgress = teamTasks.filter(t => t.status === 'in_progress').length;

                return (
                  <div key={team.id} className="p-4 flex items-center gap-4 hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-medium">
                      {team.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">{team.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {team.members?.length || 0} members · {team.projects.length} projects
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {teamBlocked > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                          {teamBlocked}
                        </span>
                      )}
                      {teamInProgress > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                          {teamInProgress}
                        </span>
                      )}
                      <div className="w-12 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${teamProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {teams.length === 0 && (
                <div className="p-8 text-center text-[var(--text-muted)]">
                  No teams
                </div>
              )}
            </div>
          </div>

          {/* Projects */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Projects</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {allProjects.slice(0, 6).map((project) => {
                const projectTasks = project.sections?.flatMap(s => s.tasks) || [];
                const projectProgress = projectTasks.length > 0
                  ? Math.round((projectTasks.filter(t => t.status === 'done').length / projectTasks.length) * 100)
                  : 0;
                const projectBlocked = projectTasks.filter(t => t.status === 'blocked').length;

                return (
                  <div key={project.id} className="p-4 flex items-center gap-4 hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">
                    <div className="w-2 h-8 rounded-full bg-gradient-to-b from-purple-500 to-blue-500" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">{project.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {projectTasks.length} tasks
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {projectBlocked > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                          {projectBlocked}
                        </span>
                      )}
                      <div className="w-12 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${projectProgress}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-8">{projectProgress}%</span>
                    </div>
                  </div>
                );
              })}
              {allProjects.length === 0 && (
                <div className="p-8 text-center text-[var(--text-muted)]">
                  No projects
                </div>
              )}
              {allProjects.length > 6 && (
                <div className="p-3 text-center text-xs text-[var(--text-muted)]">
                  +{allProjects.length - 6} more projects
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Tasks */}
        {allTasks.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Recent Tasks</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden divide-y divide-[var(--border-subtle)]">
              {allTasks.slice(0, 8).map((task) => (
                <div key={task.id} className="p-4 flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${
                    task.status === 'blocked' ? 'bg-red-500' :
                    task.status === 'in_progress' ? 'bg-yellow-500' :
                    task.status === 'done' ? 'bg-green-500' : 'bg-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-primary)]">{task.title}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {task.assignee?.name || 'Unassigned'}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    task.status === 'blocked' ? 'bg-red-500/20 text-red-400' :
                    task.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    task.status === 'done' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {(task.status || 'todo').replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Team Dashboard View
// ============================================
function TeamDashboard({ team, department, company }: {
  team: { id: string; name: string; projects: ProjectWithSections[]; members: { id: string; name: string; role: string | null; avatar_url?: string | null }[] };
  department: { id: string; name: string; color?: string | null };
  company: CompanyWithHierarchy;
}) {
  // Collect all tasks from all projects in this team
  const allTasks = team.projects.flatMap(p => p.sections?.flatMap(s => s.tasks) || []);
  const totalTasks = allTasks.length;
  const blockedTasks = allTasks.filter(t => t.status === 'blocked');
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress');
  const doneTasks = allTasks.filter(t => t.status === 'done');
  const todoTasks = allTasks.filter(t => t.status === 'todo');
  const progress = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;

  // Get urgent tasks
  const urgentTasks = allTasks.filter(t => t.priority === 'urgent' && t.status !== 'done');

  // Calculate member workloads
  const memberWorkloads = team.members.map(member => {
    const assignedTasks = allTasks.filter(t => t.assignee_id === member.id);
    const inProgress = assignedTasks.filter(t => t.status === 'in_progress').length;
    const blocked = assignedTasks.filter(t => t.status === 'blocked').length;
    return {
      ...member,
      totalTasks: assignedTasks.length,
      inProgress,
      blocked,
    };
  });

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: department.color || '#6b7280' }}
          />
          <span className="text-sm text-[var(--text-muted)]">{department.name}</span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{team.name}</h1>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-sm text-[var(--text-muted)]">{team.members.length} members</span>
          <span className="text-sm text-[var(--text-muted)]">{team.projects.length} projects</span>
          <span className="text-sm text-[var(--text-muted)]">{totalTasks} tasks</span>
        </div>
      </div>

      <div className="p-8">
        {/* Overview Stats */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Overview</h2>
          <div className="grid grid-cols-5 gap-4">
            <div className="card p-4 bg-[var(--bg-surface)]">
              <div className="text-2xl font-bold text-[var(--text-primary)]">{totalTasks}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Total Tasks</div>
            </div>
            <div className="card p-4 bg-[var(--bg-surface)]">
              <div className="text-2xl font-bold text-[var(--text-primary)]">{todoTasks.length}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">To Do</div>
            </div>
            <div className="card p-4 bg-[var(--bg-surface)]">
              <div className="text-2xl font-bold text-yellow-400">{inProgressTasks.length}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">In Progress</div>
            </div>
            <div className="card p-4 bg-[var(--bg-surface)]">
              <div className="text-2xl font-bold text-red-400">{blockedTasks.length}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Blocked</div>
            </div>
            <div className="card p-4 bg-[var(--bg-surface)]">
              <div className="text-2xl font-bold text-green-400">{doneTasks.length}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Completed</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4 card p-4 bg-[var(--bg-surface)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--text-secondary)]">Overall Progress</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">{progress}%</span>
            </div>
            <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Members Section */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Members</h2>
            <div className="card bg-[var(--bg-surface)] overflow-hidden">
              <div className="divide-y divide-[var(--border-subtle)]">
                {memberWorkloads.map((member) => (
                  <div key={member.id} className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-white font-medium">
                      {member.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--text-primary)]">{member.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{member.role || 'Member'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.blocked > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                          {member.blocked} blocked
                        </span>
                      )}
                      {member.inProgress > 0 && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                          {member.inProgress} active
                        </span>
                      )}
                      <span className="text-xs text-[var(--text-muted)]">
                        {member.totalTasks} tasks
                      </span>
                    </div>
                  </div>
                ))}
                {memberWorkloads.length === 0 && (
                  <div className="p-4 text-center text-[var(--text-muted)] text-sm">
                    No members assigned
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Agents & Projects Section */}
          <div className="space-y-6">
            {/* AI Agents */}
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Active AI Agents</h2>
              <div className="space-y-3">
                <div className="card p-4 bg-[var(--bg-surface)] flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-[var(--text-primary)]">Dependency Analyzer</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-[var(--text-muted)]">Monitoring {team.name}</span>
                    </div>
                  </div>
                </div>
                <div className="card p-4 bg-[var(--bg-surface)] flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-[var(--text-primary)]">Risk Detector</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-[var(--text-muted)]">
                        {blockedTasks.length > 0 ? `Found ${blockedTasks.length} risks` : 'No risks detected'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Risks & Blockers */}
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Risks & Blockers</h2>
              <div className="card bg-[var(--bg-surface)] overflow-hidden">
                {blockedTasks.length > 0 ? (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {blockedTasks.slice(0, 5).map((task) => (
                      <div key={task.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full bg-red-500 mt-2" />
                          <div className="flex-1">
                            <div className="font-medium text-[var(--text-primary)]">{task.title}</div>
                            {task.assignee && (
                              <div className="text-xs text-[var(--text-muted)] mt-1">
                                Assigned to {task.assignee.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {blockedTasks.length > 5 && (
                      <div className="p-3 text-center text-xs text-[var(--text-muted)]">
                        +{blockedTasks.length - 5} more blocked tasks
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    </div>
                    <div className="text-sm text-[var(--text-primary)] font-medium">No blockers</div>
                    <div className="text-xs text-[var(--text-muted)] mt-1">All tasks are running smoothly</div>
                  </div>
                )}
              </div>
            </div>

            {/* Urgent Tasks */}
            {urgentTasks.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Urgent Tasks</h2>
                <div className="card bg-[var(--bg-surface)] overflow-hidden">
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {urgentTasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full bg-orange-500 mt-2" />
                          <div className="flex-1">
                            <div className="font-medium text-[var(--text-primary)]">{task.title}</div>
                            {task.due_date && (
                              <div className="text-xs text-orange-400 mt-1">
                                Due: {new Date(task.due_date).toLocaleDateString('en-US')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Projects List */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Projects</h2>
          <div className="grid grid-cols-3 gap-4">
            {team.projects.map((project) => {
              const tasks = project.sections?.flatMap(s => s.tasks) || [];
              const done = tasks.filter(t => t.status === 'done').length;
              const projectProgress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
              const blocked = tasks.filter(t => t.status === 'blocked').length;

              return (
                <div key={project.id} className="card p-4 bg-[var(--bg-surface)]">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-white text-sm font-medium">
                      {project.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--text-primary)] truncate">{project.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{tasks.length} tasks</div>
                    </div>
                    {blocked > 0 && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                        {blocked}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--text-primary)] rounded-full"
                        style={{ width: `${projectProgress}%` }}
                      />
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{projectProgress}%</span>
                  </div>
                </div>
              );
            })}
            {team.projects.length === 0 && (
              <div className="col-span-3 card p-8 bg-[var(--bg-surface)] text-center">
                <div className="text-[var(--text-muted)]">No projects yet</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Other Views (Simplified)
// ============================================
// ============================================
// TasksView - Payroll Table Style with Arc Groups
// ============================================

interface TaskGroup {
  id: string;
  name: string;
  color: string;
  tasks: TaskWithDetails[];
}

// Arc curve component for group visualization
function GroupArc({ taskCount, color, isFirst, isLast }: { taskCount: number; color: string; isFirst: boolean; isLast: boolean }) {
  const rowHeight = 44; // Height per task row
  const totalHeight = taskCount * rowHeight;
  const arcWidth = 24;
  const startY = 0;
  const endY = totalHeight;
  const peakX = arcWidth; // How far the arc extends to the right
  const midY = totalHeight / 2;

  return (
    <svg
      className="absolute left-0 top-0 pointer-events-none"
      width={arcWidth + 4}
      height={totalHeight}
      style={{ zIndex: 5 }}
    >
      <path
        d={`M 2 ${startY}
            Q ${peakX} ${midY}, 2 ${endY}`}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TasksView({ company }: { company: CompanyWithHierarchy }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['all']));

  // Collect all tasks and group by section/project
  const { allTasks, allProjects } = collectDepartmentData(company.departments || []);

  // Group tasks by their section for display
  const taskGroups: TaskGroup[] = [];
  const sectionColors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];

  allProjects.forEach((project, pIndex) => {
    project.sections?.forEach((section, sIndex) => {
      if (section.tasks && section.tasks.length > 0) {
        taskGroups.push({
          id: section.id,
          name: section.name,
          color: sectionColors[(pIndex + sIndex) % sectionColors.length],
          tasks: section.tasks,
        });
      }
    });
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Calculate row numbers continuously
  let rowNumber = 0;

  return (
    <div className="flex-1 overflow-auto bg-white">
      {/* Header */}
      <div className="px-10 py-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800 tracking-tight">Task Table</h1>
            <p className="text-gray-400 text-sm mt-0.5">{allTasks.length} tasks</p>
          </div>
        </div>
      </div>

      {/* Table Header */}
      <div className="sticky top-0 bg-white z-10 border-b border-gray-100">
        <div className="flex items-center pl-14 pr-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">
          <div className="w-10 text-center">#</div>
          <div className="w-8"></div>
          <div className="flex-1 pl-3">Name</div>
          <div className="w-32 text-center">Task ID</div>
          <div className="w-28 text-right">Status</div>
        </div>
      </div>

      {/* Task Groups with Arc Lines */}
      <div className="relative pl-10">
        {taskGroups.map((group, groupIndex) => {
          const isExpanded = expandedGroups.has(group.id) || expandedGroups.has('all');

          return (
            <div key={group.id} className="relative">
              {/* Group Header with colored indicator */}
              <div
                className="flex items-center pl-4 pr-6 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors"
                onClick={() => toggleGroup(group.id)}
              >
                <div className="w-10"></div>
                <div className="w-8 flex items-center justify-center">
                  <svg
                    className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
                <div className="flex items-center gap-3 flex-1 pl-3">
                  <span className="text-sm font-semibold text-gray-600">{group.name}</span>
                  <span className="text-xs text-gray-400 font-normal">({group.tasks.length})</span>
                </div>
              </div>

              {/* Tasks in Group with Arc */}
              {isExpanded && (
                <div className="relative">
                  {/* Arc line for the group */}
                  <div className="absolute left-0 top-0" style={{ height: group.tasks.length * 44 }}>
                    <GroupArc
                      taskCount={group.tasks.length}
                      color={group.color}
                      isFirst={true}
                      isLast={true}
                    />
                  </div>

                  {/* Group label on the arc */}
                  <div
                    className="absolute left-6 text-xs font-medium whitespace-nowrap"
                    style={{
                      top: (group.tasks.length * 44) / 2 - 8,
                      color: group.color,
                      transform: 'translateY(-50%)',
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {group.name}
                  </div>

                  {group.tasks.map((task, taskIndex) => {
                    rowNumber++;
                    const currentRow = rowNumber;

                    return (
                      <div
                        key={task.id}
                        className="flex items-center pl-4 pr-6 py-2.5 hover:bg-gray-50/30 transition-colors group/row relative"
                        style={{ minHeight: 44 }}
                      >
                        {/* Row Number */}
                        <div className="w-10 text-center text-xs text-gray-300 font-mono tabular-nums">
                          {currentRow}
                        </div>

                        {/* Checkbox */}
                        <div className="w-8 flex items-center justify-center">
                          <div
                            className={`w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-all ${
                              task.status === 'done'
                                ? 'bg-gray-700 border-gray-700'
                                : 'border-gray-300 hover:border-gray-400 bg-white'
                            }`}
                          >
                            {task.status === 'done' && (
                              <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M5 12l5 5L20 7" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* Task Name */}
                        <div className="flex-1 pl-3">
                          <span className={`text-sm ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {task.title}
                          </span>
                        </div>

                        {/* Task ID */}
                        <div className="w-32 text-center">
                          <span className="text-xs font-mono text-gray-400 tracking-wide">
                            ALN{task.id.slice(-4).toUpperCase()}
                          </span>
                        </div>

                        {/* Status Badge */}
                        <div className="w-28 flex justify-end">
                          <span className={`text-[11px] px-2.5 py-1 rounded font-medium tracking-wide ${
                            task.status === 'done'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              : task.status === 'in_progress'
                              ? 'bg-sky-50 text-sky-600 border border-sky-100'
                              : task.status === 'blocked'
                              ? 'bg-rose-50 text-rose-600 border border-rose-100'
                              : 'bg-gray-50 text-gray-500 border border-gray-100'
                          }`}>
                            {task.status === 'done' ? 'done' :
                             task.status === 'in_progress' ? 'in progress' :
                             task.status === 'blocked' ? 'blocked' : 'to do'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {taskGroups.length === 0 && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            No tasks yet
          </div>
        )}
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

function SettingsView({ company, companyWithUnits, onRefresh }: { company: CompanyWithHierarchy; companyWithUnits?: CompanyWithUnits | null; onRefresh?: () => void }) {
  const [activeTab, setActiveTab] = useState<'units' | 'organization' | 'general'>('units');
  const [isAddingDepartment, setIsAddingDepartment] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptColor, setNewDeptColor] = useState('#6b7280');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [moveToDeptId, setMoveToDeptId] = useState<string | null>(null);
  const [editingDept, setEditingDept] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState('');

  // New schema state
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [addingToParentId, setAddingToParentId] = useState<string | null>(null);
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitType, setNewUnitType] = useState<'folder' | 'execute'>('folder');
  const [newUnitColor, setNewUnitColor] = useState('#6b7280');
  const [editingUnit, setEditingUnit] = useState<string | null>(null);
  const [editUnitName, setEditUnitName] = useState('');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  // Toggle expanded state
  const toggleExpanded = (unitId: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  };

  // Create organization unit
  const handleCreateUnit = async () => {
    if (!newUnitName.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await createOrganizationUnit({
        name: newUnitName.trim(),
        type: newUnitType,
        company_id: company.id,
        parent_id: addingToParentId,
        color: newUnitColor,
      });
      setNewUnitName('');
      setNewUnitType('folder');
      setNewUnitColor('#6b7280');
      setIsAddingUnit(false);
      setAddingToParentId(null);
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Update organization unit
  const handleUpdateUnit = async (unitId: string) => {
    if (!editUnitName.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await updateOrganizationUnit(unitId, { name: editUnitName.trim() });
      setEditingUnit(null);
      setEditUnitName('');
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete organization unit
  const handleDeleteUnit = async (unitId: string) => {
    if (!confirm('Are you sure you want to delete this organization unit?')) return;
    setIsLoading(true);
    setError(null);
    try {
      await deleteOrganizationUnit(unitId);
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Render organization unit tree recursively
  const renderUnitTree = (units: OrganizationUnitWithChildren[], level: number = 0) => {
    return units.map(unit => (
      <div key={unit.id} style={{ marginLeft: level * 24 }}>
        <div className={`flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-muted)] group ${
          unit.type === 'folder' ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-subtle)]'
        }`}>
          {/* Expand/Collapse */}
          {unit.children.length > 0 ? (
            <button
              onClick={() => toggleExpanded(unit.id)}
              className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)]"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`transition-transform ${expandedUnits.has(unit.id) ? 'rotate-90' : ''}`}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ) : (
            <div className="w-5" />
          )}

          {/* Type icon */}
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-xs"
            style={{ backgroundColor: unit.color || '#6b7280' }}
          >
            {unit.type === 'folder' ? (
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                <path d="M2 17L12 22L22 17" />
                <path d="M2 12L12 17L22 12" />
              </svg>
            )}
          </div>

          {/* Name */}
          {editingUnit === unit.id ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={editUnitName}
                onChange={(e) => setEditUnitName(e.target.value)}
                className="input text-sm py-1 flex-1"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateUnit(unit.id)}
              />
              <button
                onClick={() => handleUpdateUnit(unit.id)}
                disabled={isLoading}
                className="text-green-400 hover:text-green-300"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4" />
                </svg>
              </button>
              <button
                onClick={() => {
                  setEditingUnit(null);
                  setEditUnitName('');
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm text-[var(--text-primary)] font-medium">{unit.name}</span>
              <span className="text-xs text-[var(--text-muted)] px-2 py-0.5 rounded bg-[var(--bg-overlay)]">
                {unit.type}
              </span>
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Add child */}
            <button
              onClick={() => {
                setIsAddingUnit(true);
                setAddingToParentId(unit.id);
                setExpandedUnits(prev => new Set(prev).add(unit.id));
              }}
              className="p-1 rounded hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Add child unit"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {/* Edit */}
            <button
              onClick={() => {
                setEditingUnit(unit.id);
                setEditUnitName(unit.name);
              }}
              className="p-1 rounded hover:bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Edit"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            {/* Delete */}
            <button
              onClick={() => handleDeleteUnit(unit.id)}
              className="p-1 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400"
              title="Delete"
              disabled={unit.children.length > 0}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Children */}
        {expandedUnits.has(unit.id) && unit.children.length > 0 && (
          <div className="mt-1">
            {renderUnitTree(unit.children, level + 1)}
          </div>
        )}

        {/* Add child form */}
        {isAddingUnit && addingToParentId === unit.id && (
          <div className="mt-2 p-3 rounded-lg bg-[var(--bg-surface)] border border-dashed border-[var(--border-strong)]" style={{ marginLeft: (level + 1) * 24 }}>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                placeholder="Unit name..."
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                className="input flex-1 text-sm"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateUnit()}
              />
              <select
                value={newUnitType}
                onChange={(e) => setNewUnitType(e.target.value as 'folder' | 'execute')}
                className="input text-sm py-2"
              >
                <option value="folder">Folder</option>
                <option value="execute">Execute</option>
              </select>
              <input
                type="color"
                value={newUnitColor}
                onChange={(e) => setNewUnitColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer bg-transparent"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateUnit}
                disabled={!newUnitName.trim() || isLoading}
                className="btn btn-primary text-sm"
              >
                {isLoading ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setIsAddingUnit(false);
                  setAddingToParentId(null);
                  setNewUnitName('');
                }}
                className="btn btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    ));
  };

  // Handle create department
  const handleCreateDepartment = async () => {
    if (!newDeptName.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await createDepartment({
        name: newDeptName.trim(),
        company_id: company.id,
        color: newDeptColor,
      });
      setNewDeptName('');
      setNewDeptColor('#6b7280');
      setIsAddingDepartment(false);
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle update department name
  const handleUpdateDepartment = async (deptId: string) => {
    if (!editDeptName.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await updateDepartment(deptId, { name: editDeptName.trim() });
      setEditingDept(null);
      setEditDeptName('');
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle delete department
  const handleDeleteDepartment = async (deptId: string) => {
    if (!confirm('Are you sure you want to delete this department?')) return;
    setIsLoading(true);
    setError(null);
    try {
      await deleteDepartment(deptId);
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle move teams to department
  const handleMoveTeams = async () => {
    if (!moveToDeptId || selectedTeams.size === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      await moveTeamsToDepartment(Array.from(selectedTeams), moveToDeptId);
      setSelectedTeams(new Set());
      setMoveToDeptId(null);
      onRefresh?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle team selection
  const toggleTeamSelection = (teamId: string) => {
    setSelectedTeams(prev => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  // Select all teams in a department
  const selectAllTeamsInDept = (deptId: string) => {
    const dept = company.departments?.find(d => d.id === deptId);
    if (!dept) return;
    setSelectedTeams(prev => {
      const next = new Set(prev);
      dept.teams.forEach(t => next.add(t.id));
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 py-6 border-b border-[var(--border-subtle)]">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="px-8 border-b border-[var(--border-subtle)]">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('units')}
            className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'units'
                ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Organization Units
          </button>
          <button
            onClick={() => setActiveTab('organization')}
            className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'organization'
                ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Legacy (Dept/Team)
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'general'
                ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            General
          </button>
        </div>
      </div>

      <div className="p-8">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Organization Units Tab (New Schema) */}
        {activeTab === 'units' && (
          <div className="space-y-6">
            {/* Description */}
            <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <h3 className="font-medium text-[var(--text-primary)] mb-2">Organization Structure</h3>
              <p className="text-sm text-[var(--text-muted)] mb-3">
                Build your organization hierarchy using <strong>Folder</strong> (for grouping) and <strong>Execute</strong> (for teams that can have projects and tasks) units.
              </p>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-gray-500 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
                    </svg>
                  </div>
                  <span className="text-[var(--text-secondary)]">Folder - Groups other units</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                      <path d="M2 17L12 22L22 17" />
                      <path d="M2 12L12 17L22 12" />
                    </svg>
                  </div>
                  <span className="text-[var(--text-secondary)]">Execute - Can have projects, tasks, and workers</span>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setIsAddingUnit(true);
                  setAddingToParentId(null);
                }}
                className="btn btn-primary text-sm"
                disabled={isLoading}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Root Unit
              </button>
            </div>

            {/* Add Root Unit Form */}
            {isAddingUnit && addingToParentId === null && (
              <div className="p-4 rounded-lg bg-[var(--bg-surface)] border-2 border-dashed border-[var(--border-strong)]">
                <h3 className="font-medium text-[var(--text-primary)] mb-3">Create Root Organization Unit</h3>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Unit name..."
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    className="input flex-1"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateUnit()}
                  />
                  <select
                    value={newUnitType}
                    onChange={(e) => setNewUnitType(e.target.value as 'folder' | 'execute')}
                    className="input"
                  >
                    <option value="folder">Folder</option>
                    <option value="execute">Execute</option>
                  </select>
                  <input
                    type="color"
                    value={newUnitColor}
                    onChange={(e) => setNewUnitColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer bg-transparent"
                    title="Unit color"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateUnit}
                    disabled={!newUnitName.trim() || isLoading}
                    className="btn btn-primary"
                  >
                    {isLoading ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingUnit(false);
                      setAddingToParentId(null);
                      setNewUnitName('');
                    }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Units Tree */}
            <div className="space-y-2">
              {companyWithUnits?.organization_units && companyWithUnits.organization_units.length > 0 ? (
                renderUnitTree(companyWithUnits.organization_units)
              ) : (
                <div className="text-center py-12 text-[var(--text-muted)]">
                  <p className="mb-2">No organization units yet.</p>
                  <p className="text-sm">Create a root unit to get started building your organization structure.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'organization' && (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsAddingDepartment(true)}
                  className="btn btn-primary text-sm"
                  disabled={isLoading}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New Department
                </button>

                {selectedTeams.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-muted)]">
                      {selectedTeams.size} team{selectedTeams.size > 1 ? 's' : ''} selected
                    </span>
                    <select
                      value={moveToDeptId || ''}
                      onChange={(e) => setMoveToDeptId(e.target.value || null)}
                      className="input text-sm py-1.5"
                    >
                      <option value="">Move to...</option>
                      {company.departments?.map(dept => (
                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleMoveTeams}
                      disabled={!moveToDeptId || isLoading}
                      className="btn btn-secondary text-sm"
                    >
                      Move
                    </button>
                    <button
                      onClick={() => setSelectedTeams(new Set())}
                      className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Add Department Modal */}
            {isAddingDepartment && (
              <div className="card p-4 bg-[var(--bg-surface)] border-2 border-dashed border-[var(--border-strong)]">
                <h3 className="font-medium text-[var(--text-primary)] mb-3">Create New Department</h3>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="Department name..."
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    className="input flex-1"
                    autoFocus
                  />
                  <input
                    type="color"
                    value={newDeptColor}
                    onChange={(e) => setNewDeptColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer bg-transparent"
                    title="Department color"
                  />
                  <button
                    onClick={handleCreateDepartment}
                    disabled={!newDeptName.trim() || isLoading}
                    className="btn btn-primary"
                  >
                    {isLoading ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingDepartment(false);
                      setNewDeptName('');
                    }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Departments List */}
            <div className="space-y-4">
              {company.departments?.map(dept => (
                <div key={dept.id} className="card bg-[var(--bg-surface)] overflow-hidden">
                  {/* Department Header */}
                  <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: dept.color || '#6b7280' }}
                      />
                      {editingDept === dept.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editDeptName}
                            onChange={(e) => setEditDeptName(e.target.value)}
                            className="input text-sm py-1"
                            autoFocus
                          />
                          <button
                            onClick={() => handleUpdateDepartment(dept.id)}
                            disabled={isLoading}
                            className="text-green-400 hover:text-green-300"
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 11l3 3L22 4" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setEditingDept(null);
                              setEditDeptName('');
                            }}
                            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <span className="font-medium text-[var(--text-primary)]">{dept.name}</span>
                      )}
                      <span className="text-xs text-[var(--text-muted)]">
                        {dept.teams.length} teams
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => selectAllTeamsInDept(dept.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        Select all
                      </button>
                      <button
                        onClick={() => {
                          setEditingDept(dept.id);
                          setEditDeptName(dept.name);
                        }}
                        className="p-1.5 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        title="Edit department"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteDepartment(dept.id)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400"
                        title="Delete department"
                        disabled={dept.teams.length > 0}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Teams List */}
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {dept.teams.map(team => (
                      <div
                        key={team.id}
                        className={`p-3 pl-8 flex items-center gap-3 hover:bg-[var(--bg-muted)] cursor-pointer transition-colors ${
                          selectedTeams.has(team.id) ? 'bg-[var(--bg-muted)]' : ''
                        }`}
                        onClick={() => toggleTeamSelection(team.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTeams.has(team.id)}
                          onChange={() => toggleTeamSelection(team.id)}
                          className="w-4 h-4 rounded border-[var(--border-default)] bg-[var(--bg-overlay)]"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-sm text-[var(--text-primary)]">{team.name}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {team.projects.length} projects, {team.members.length} members
                        </span>
                      </div>
                    ))}
                    {dept.teams.length === 0 && (
                      <div className="p-3 pl-8 text-sm text-[var(--text-muted)]">
                        No teams in this department
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {(!company.departments || company.departments.length === 0) && (
                <div className="text-center py-12 text-[var(--text-muted)]">
                  No departments yet. Create one to get started.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'general' && (
          <div className="text-[var(--text-muted)]">General settings coming soon...</div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Task Detail Panel
// ============================================
interface TaskDetailPanelProps {
  task: TaskWithDetails;
  members: Member[];
  onClose: () => void;
  onUpdate: (updates: Partial<TaskWithDetails>) => void;
  onDelete: () => void;
  onRefresh?: () => void;
}

function TaskDetailPanel({ task, members, onClose, onUpdate, onDelete, onRefresh }: TaskDetailPanelProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [status, setStatus] = useState(task.status || 'todo');
  const [priority, setPriority] = useState(task.priority || 'medium');
  const [dueDate, setDueDate] = useState(task.due_date || '');
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || '');
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSubtasks, setLoadingSubtasks] = useState(true);

  // Load subtasks
  useEffect(() => {
    async function loadSubtasks() {
      try {
        const { data, error } = await supabase
          .from('subtasks')
          .select('*')
          .eq('task_id', task.id)
          .order('order_index');
        if (!error && data) {
          setSubtasks(data);
        }
      } catch (e) {
        console.error('Failed to load subtasks:', e);
      } finally {
        setLoadingSubtasks(false);
      }
    }
    loadSubtasks();
  }, [task.id]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await onUpdate({
        title,
        description: description || null,
        status,
        priority,
        due_date: dueDate || null,
        assignee_id: assigneeId || null,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update task:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    setIsLoading(true);
    try {
      const newSubtask = await createSubtask({
        title: newSubtaskTitle.trim(),
        task_id: task.id,
      });
      setSubtasks([...subtasks, newSubtask]);
      setNewSubtaskTitle('');
    } catch (e) {
      console.error('Failed to create subtask:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSubtask = async (subtask: Subtask) => {
    try {
      await toggleSubtaskComplete(subtask.id, !subtask.is_completed);
      setSubtasks(subtasks.map(s =>
        s.id === subtask.id ? { ...s, is_completed: !s.is_completed } : s
      ));
    } catch (e) {
      console.error('Failed to toggle subtask:', e);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    try {
      await deleteSubtask(subtaskId);
      setSubtasks(subtasks.filter(s => s.id !== subtaskId));
    } catch (e) {
      console.error('Failed to delete subtask:', e);
    }
  };

  const completedSubtasks = subtasks.filter(s => s.is_completed).length;
  const subtaskProgress = subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 w-[500px] bg-[var(--bg-surface)] border-l border-[var(--border-default)] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Task Details</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onDelete}
              className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              title="Delete task"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] rounded transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input text-lg font-medium"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              className="input min-h-[100px] resize-none"
            />
          </div>

          {/* Status & Priority Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input"
            />
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Assignee</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="input"
            >
              <option value="">Unassigned</option>
              {members.map(member => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                Subtasks {subtasks.length > 0 && `(${completedSubtasks}/${subtasks.length})`}
              </label>
              {subtasks.length > 0 && (
                <span className="text-xs text-[var(--text-muted)]">{subtaskProgress}%</span>
              )}
            </div>

            {subtasks.length > 0 && (
              <div className="h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-[var(--status-success)] rounded-full transition-all"
                  style={{ width: `${subtaskProgress}%` }}
                />
              </div>
            )}

            <div className="space-y-2 mb-3">
              {loadingSubtasks ? (
                <div className="text-sm text-[var(--text-muted)]">Loading subtasks...</div>
              ) : (
                subtasks.map(subtask => (
                  <div key={subtask.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => handleToggleSubtask(subtask)}
                      className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] transition-colors ${
                        subtask.is_completed
                          ? 'bg-[var(--status-success)] border-[var(--status-success)] text-white'
                          : 'border-[var(--text-muted)] hover:border-[var(--status-success)]'
                      }`}
                    >
                      {subtask.is_completed && '✓'}
                    </button>
                    <span className={`flex-1 text-sm ${subtask.is_completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                      {subtask.title}
                    </span>
                    <button
                      onClick={() => handleDeleteSubtask(subtask.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-red-400 rounded transition-all"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add Subtask */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
                placeholder="Add a subtask..."
                className="flex-1 bg-[var(--bg-muted)] border border-[var(--border-default)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--text-muted)]"
              />
              <button
                onClick={handleAddSubtask}
                disabled={!newSubtaskTitle.trim() || isLoading}
                className="p-2 bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded transition-colors disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-default)] flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !title.trim()}
            className="btn btn-primary"
          >
            {isLoading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
