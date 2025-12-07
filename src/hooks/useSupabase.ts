'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

// Types - Legacy (for backward compatibility)
export type Company = Tables<'companies'>;
export type Department = Tables<'departments'>;
export type Team = Tables<'teams'>;
export type Member = Tables<'members'>;
export type Project = Tables<'projects'>;
export type Section = Tables<'sections'>;
export type Task = Tables<'tasks'>;
export type Subtask = Tables<'subtasks'>;

// Types - New Schema
export type OrganizationUnit = Tables<'organization_units'>;
export type Worker = Tables<'workers'>;
export type Goal = Tables<'goals'>;
export type ProjectLink = Tables<'project_links'>;
export type TaskLink = Tables<'task_links'>;
export type TaskDependency = Tables<'task_dependencies'>;

// Extended types with relations
export interface DepartmentWithTeams extends Department {
  teams: TeamWithProjects[];
  children: DepartmentWithTeams[];
}

export interface TeamWithProjects extends Team {
  projects: ProjectWithSections[];
  members: Member[];
}

export interface ProjectWithSections extends Project {
  sections: SectionWithTasks[];
}

export interface SectionWithTasks extends Section {
  tasks: TaskWithDetails[];
}

export interface TaskWithDetails extends Task {
  assignee?: Member | null;
  subtasks?: Subtask[];
}

export interface CompanyWithHierarchy extends Company {
  departments: DepartmentWithTeams[];
}

// Hook: Fetch company with full hierarchy
export function useCompanyHierarchy(companyId?: string) {
  const [data, setData] = useState<CompanyWithHierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch company
      let companyQuery = supabase.from('companies').select('*');
      if (companyId) {
        companyQuery = companyQuery.eq('id', companyId);
      }
      const { data: companies, error: companyError } = await companyQuery.limit(1).single();

      if (companyError) throw companyError;
      if (!companies) throw new Error('Company not found');

      // Fetch departments
      const { data: departments, error: deptError } = await supabase
        .from('departments')
        .select('*')
        .eq('company_id', companies.id)
        .order('name');

      if (deptError) throw deptError;

      // Fetch teams
      const { data: teams, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .in('department_id', departments?.map(d => d.id) || [])
        .order('name');

      if (teamError) throw teamError;

      // Fetch members
      const { data: members, error: memberError } = await supabase
        .from('members')
        .select('*')
        .in('team_id', teams?.map(t => t.id) || []);

      if (memberError) throw memberError;

      // Fetch projects
      const { data: projects, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .in('team_id', teams?.map(t => t.id) || [])
        .order('name');

      if (projectError) throw projectError;

      // Fetch sections
      const { data: sections, error: sectionError } = await supabase
        .from('sections')
        .select('*')
        .in('project_id', projects?.map(p => p.id) || [])
        .order('order_index');

      if (sectionError) throw sectionError;

      // Fetch tasks
      const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .in('section_id', sections?.map(s => s.id) || [])
        .order('order_index');

      if (taskError) throw taskError;

      // Build hierarchy
      const sectionsWithTasks: SectionWithTasks[] = (sections || []).map(section => ({
        ...section,
        tasks: (tasks || [])
          .filter(t => t.section_id === section.id)
          .map(task => ({
            ...task,
            assignee: members?.find(m => m.id === task.assignee_id) || null,
          })),
      }));

      const projectsWithSections: ProjectWithSections[] = (projects || []).map(project => ({
        ...project,
        sections: sectionsWithTasks.filter(s => s.project_id === project.id),
      }));

      const teamsWithProjects: TeamWithProjects[] = (teams || []).map(team => ({
        ...team,
        projects: projectsWithSections.filter(p => p.team_id === team.id),
        members: (members || []).filter(m => m.team_id === team.id),
      }));

      // Build nested department tree
      const buildDepartmentTree = (parentId: string | null): DepartmentWithTeams[] => {
        return (departments || [])
          .filter(dept => dept.parent_id === parentId)
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
          .map(dept => ({
            ...dept,
            teams: teamsWithProjects.filter(t => t.department_id === dept.id),
            children: buildDepartmentTree(dept.id),
          }));
      };

      const departmentsWithTeams = buildDepartmentTree(null);

      const companyWithHierarchy: CompanyWithHierarchy = {
        ...companies,
        departments: departmentsWithTeams,
      };

      setData(companyWithHierarchy);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// Hook: Fetch all members
export function useMembers() {
  const [data, setData] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchMembers() {
      try {
        const { data: members, error } = await supabase
          .from('members')
          .select('*')
          .order('name');

        if (error) throw error;
        setData(members || []);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchMembers();
  }, []);

  return { data, loading, error };
}

// Hook: Fetch tasks by project
export function useTasksByProject(projectId: string | null) {
  const [data, setData] = useState<TaskWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchTasks() {
      if (!projectId) {
        setData([]);
        setLoading(false);
        return;
      }

      try {
        // Get sections for this project
        const { data: sections, error: sectionError } = await supabase
          .from('sections')
          .select('id')
          .eq('project_id', projectId);

        if (sectionError) throw sectionError;

        const sectionIds = sections?.map(s => s.id) || [];
        if (sectionIds.length === 0) {
          setData([]);
          setLoading(false);
          return;
        }

        // Get tasks
        const { data: tasks, error: taskError } = await supabase
          .from('tasks')
          .select('*')
          .in('section_id', sectionIds)
          .order('order_index');

        if (taskError) throw taskError;

        // Get members for assignees
        const assigneeIds = (tasks?.map(t => t.assignee_id).filter((id): id is string => id !== null) || []);
        let members: Member[] = [];
        if (assigneeIds.length > 0) {
          const { data: memberData } = await supabase
            .from('members')
            .select('*')
            .in('id', assigneeIds);
          members = memberData || [];
        }

        const tasksWithDetails: TaskWithDetails[] = (tasks || []).map(task => ({
          ...task,
          assignee: members.find(m => m.id === task.assignee_id) || null,
        }));

        setData(tasksWithDetails);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchTasks();
  }, [projectId]);

  return { data, loading, error };
}

// Mutations
export async function createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('tasks')
    .insert(task)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTask(id: string, updates: Partial<Task>) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTask(id: string) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Project CRUD
// ============================================

export async function createProject(project: {
  name: string;
  team_id: string;
  owner_unit_id?: string | null;
  description?: string | null;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
}) {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: project.name,
      team_id: project.team_id,
      owner_unit_id: project.owner_unit_id || null,
      description: project.description || null,
      status: project.status || 'active',
      start_date: project.start_date || null,
      end_date: project.end_date || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProject(id: string, updates: Partial<Project>) {
  const { data, error } = await supabase
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteProject(id: string) {
  // First delete all sections and tasks in this project
  const { data: sections } = await supabase
    .from('sections')
    .select('id')
    .eq('project_id', id);

  if (sections && sections.length > 0) {
    const sectionIds = sections.map(s => s.id);
    // Delete tasks in these sections
    await supabase.from('tasks').delete().in('section_id', sectionIds);
    // Delete sections
    await supabase.from('sections').delete().eq('project_id', id);
  }

  // Delete project
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Section CRUD
// ============================================

export async function createSection(section: {
  name: string;
  project_id: string;
  description?: string | null;
  order_index?: number;
}) {
  // Get max order_index for this project
  const { data: existing } = await supabase
    .from('sections')
    .select('order_index')
    .eq('project_id', section.project_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('sections')
    .insert({
      name: section.name,
      project_id: section.project_id,
      description: section.description || null,
      order_index: section.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSection(id: string, updates: Partial<Section>) {
  const { data, error } = await supabase
    .from('sections')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSection(id: string) {
  // First delete all tasks in this section
  await supabase.from('tasks').delete().eq('section_id', id);

  // Delete section
  const { error } = await supabase
    .from('sections')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function reorderSections(projectId: string, sectionIds: string[]) {
  // Update each section with its new order
  const updates = sectionIds.map((id, index) => ({
    id,
    order_index: index,
    updated_at: new Date().toISOString(),
  }));

  for (const update of updates) {
    await supabase
      .from('sections')
      .update({ order_index: update.order_index, updated_at: update.updated_at })
      .eq('id', update.id);
  }
}

// ============================================
// Subtask CRUD
// ============================================

export async function createSubtask(subtask: {
  title: string;
  task_id: string;
  is_completed?: boolean;
  order_index?: number;
}) {
  // Get max order_index for this task
  const { data: existing } = await supabase
    .from('subtasks')
    .select('order_index')
    .eq('task_id', subtask.task_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('subtasks')
    .insert({
      title: subtask.title,
      task_id: subtask.task_id,
      is_completed: subtask.is_completed ?? false,
      order_index: subtask.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSubtask(id: string, updates: Partial<Subtask>) {
  const { data, error } = await supabase
    .from('subtasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSubtask(id: string) {
  const { error } = await supabase
    .from('subtasks')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleSubtaskComplete(id: string, isCompleted: boolean) {
  return updateSubtask(id, { is_completed: isCompleted });
}

// ============================================
// AI Edge Functions
// ============================================

export interface TaskValidationResult {
  valid: boolean;
  duplicates?: Array<{ id: string; title: string; similarity: string }>;
  conflicts?: Array<{
    task_id: string;
    task_title?: string;
    department: string;
    conflict_type: string;
    message: string;
  }>;
  suggestions?: string[];
  ai_analysis?: string;
}

export interface ChangeAnalysisResult {
  task_id: string;
  change_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  analysis_id?: string;
  impacts?: Array<{
    task_id: string;
    task_title: string;
    impact_type: string;
    severity: string;
    message: string;
  }>;
  cross_department_alerts?: Array<{
    from_dept: string;
    to_dept: string;
    alert_type: string;
    message: string;
    urgency: string;
  }>;
  recommendations?: Array<{
    priority: number;
    action: string;
    target: string;
    reason: string;
  }>;
  ai_analysis?: string;
}

// Validate a new task before creation
export async function validateTask(
  task: { title: string; due_date?: string | null; priority?: string },
  projectId: string,
  sectionId: string
): Promise<TaskValidationResult> {
  const { data, error } = await supabase.functions.invoke('validate-task', {
    body: { task, projectId, sectionId }
  });

  if (error) throw error;
  return data;
}

// Analyze the impact of a task change
export async function analyzeTaskChange(
  taskId: string,
  changeType: 'status' | 'due_date' | 'priority' | 'assignee' | 'title',
  oldValue: any,
  newValue: any
): Promise<ChangeAnalysisResult> {
  const { data, error } = await supabase.functions.invoke('analyze-change', {
    body: { taskId, changeType, oldValue, newValue }
  });

  if (error) throw error;
  return data;
}

// Create task with AI validation
export async function createTaskWithValidation(
  task: Omit<Task, 'id' | 'created_at' | 'updated_at'>,
  projectId: string
): Promise<{ task: Task; validation: TaskValidationResult }> {
  // First validate
  const validation = await validateTask(
    { title: task.title, due_date: task.due_date, priority: task.priority || 'medium' },
    projectId,
    task.section_id
  );

  // Create task regardless (user can decide based on validation)
  const createdTask = await createTask(task);

  return { task: createdTask, validation };
}

// Update task with impact analysis
export async function updateTaskWithAnalysis(
  id: string,
  updates: Partial<Task>,
  originalTask: Task
): Promise<{ task: Task; analysis: ChangeAnalysisResult | null }> {
  // Determine what changed
  let changeType: 'status' | 'due_date' | 'priority' | 'assignee' | 'title' = 'status';
  let oldValue: any = null;
  let newValue: any = null;

  if (updates.status && updates.status !== originalTask.status) {
    changeType = 'status';
    oldValue = originalTask.status;
    newValue = updates.status;
  } else if (updates.due_date && updates.due_date !== originalTask.due_date) {
    changeType = 'due_date';
    oldValue = originalTask.due_date;
    newValue = updates.due_date;
  } else if (updates.priority && updates.priority !== originalTask.priority) {
    changeType = 'priority';
    oldValue = originalTask.priority;
    newValue = updates.priority;
  } else if (updates.assignee_id && updates.assignee_id !== originalTask.assignee_id) {
    changeType = 'assignee';
    oldValue = originalTask.assignee_id;
    newValue = updates.assignee_id;
  } else if (updates.title && updates.title !== originalTask.title) {
    changeType = 'title';
    oldValue = originalTask.title;
    newValue = updates.title;
  }

  // Update the task
  const updatedTask = await updateTask(id, updates);

  // Analyze impact (only for significant changes)
  let analysis: ChangeAnalysisResult | null = null;
  if (changeType === 'status' || changeType === 'due_date') {
    try {
      analysis = await analyzeTaskChange(id, changeType, oldValue, newValue);
    } catch (e) {
      console.error('Failed to analyze change:', e);
    }
  }

  return { task: updatedTask, analysis };
}

// ============================================
// Organization Management
// ============================================

// Create a new department
export async function createDepartment(department: {
  name: string;
  company_id: string;
  color?: string;
  description?: string;
}) {
  const { data, error } = await supabase
    .from('departments')
    .insert({
      name: department.name,
      company_id: department.company_id,
      color: department.color || '#6b7280',
      description: department.description || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a department
export async function updateDepartment(id: string, updates: Partial<Department>) {
  const { data, error } = await supabase
    .from('departments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a department (only if empty)
export async function deleteDepartment(id: string) {
  // Check if department has teams
  const { data: teams } = await supabase
    .from('teams')
    .select('id')
    .eq('department_id', id);

  if (teams && teams.length > 0) {
    throw new Error('Cannot delete department with teams. Move or delete teams first.');
  }

  // Check if department has children
  const { data: children } = await supabase
    .from('departments')
    .select('id')
    .eq('parent_id', id);

  if (children && children.length > 0) {
    throw new Error('Cannot delete department with children. Move or delete children first.');
  }

  const { error } = await supabase
    .from('departments')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Move department to a new parent (nested hierarchy)
export async function moveDepartmentToParent(departmentId: string, newParentId: string | null) {
  // Prevent moving a department into itself or its own children
  if (newParentId) {
    // Check if newParentId is a descendant of departmentId
    const isDescendant = async (potentialParentId: string, targetId: string): Promise<boolean> => {
      const { data } = await supabase
        .from('departments')
        .select('parent_id')
        .eq('id', potentialParentId)
        .single();

      if (!data) return false;
      if (data.parent_id === targetId) return true;
      if (data.parent_id) return isDescendant(data.parent_id, targetId);
      return false;
    };

    if (newParentId === departmentId || await isDescendant(newParentId, departmentId)) {
      throw new Error('Cannot move department into itself or its descendants');
    }
  }

  const { data, error } = await supabase
    .from('departments')
    .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
    .eq('id', departmentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Create a new team
export async function createTeam(team: {
  name: string;
  department_id: string;
  description?: string;
}) {
  const { data, error } = await supabase
    .from('teams')
    .insert({
      name: team.name,
      department_id: team.department_id,
      description: team.description || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a team (including moving to different department)
export async function updateTeam(id: string, updates: Partial<Team>) {
  const { data, error } = await supabase
    .from('teams')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Move team to a different department
export async function moveTeamToDepartment(teamId: string, newDepartmentId: string) {
  return updateTeam(teamId, { department_id: newDepartmentId });
}

// Move multiple teams to a department
export async function moveTeamsToDepartment(teamIds: string[], newDepartmentId: string) {
  const { data, error } = await supabase
    .from('teams')
    .update({ department_id: newDepartmentId, updated_at: new Date().toISOString() })
    .in('id', teamIds)
    .select();

  if (error) throw error;
  return data;
}

// Delete a team (only if empty)
export async function deleteTeam(id: string) {
  // Check if team has projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('team_id', id);

  if (projects && projects.length > 0) {
    throw new Error('Cannot delete team with projects. Move or delete projects first.');
  }

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// New Schema: Organization Units
// ============================================

// Extended types for organization units
export interface OrganizationUnitWithChildren extends OrganizationUnit {
  children: OrganizationUnitWithChildren[];
  workers?: Worker[];
  projects?: Project[];
}

export interface WorkerWithDetails extends Worker {
  organization_unit?: OrganizationUnit | null;
}

export interface CompanyWithUnits extends Company {
  organization_units: OrganizationUnitWithChildren[];
}

// Build tree structure from flat list
function buildUnitTree(units: OrganizationUnit[], parentId: string | null = null): OrganizationUnitWithChildren[] {
  return units
    .filter(unit => unit.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(unit => ({
      ...unit,
      children: buildUnitTree(units, unit.id),
    }));
}

// Hook: Fetch organization units hierarchy
export function useOrganizationUnits(companyId?: string) {
  const [data, setData] = useState<OrganizationUnitWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase.from('organization_units').select('*');
      if (companyId) {
        query = query.eq('company_id', companyId);
      }

      const { data: units, error: unitError } = await query.order('order_index');

      if (unitError) throw unitError;

      const tree = buildUnitTree(units || []);
      setData(tree);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// Hook: Fetch workers
export function useWorkers(organizationUnitId?: string) {
  const [data, setData] = useState<WorkerWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchWorkers() {
      try {
        let query = supabase.from('workers').select('*');
        if (organizationUnitId) {
          query = query.eq('organization_unit_id', organizationUnitId);
        }

        const { data: workers, error: workerError } = await query.order('name');

        if (workerError) throw workerError;
        setData(workers || []);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchWorkers();
  }, [organizationUnitId]);

  return { data, loading, error };
}

// Hook: Fetch company with new organization structure
export function useCompanyWithUnits(companyId?: string) {
  const [data, setData] = useState<CompanyWithUnits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch company
      let companyQuery = supabase.from('companies').select('*');
      if (companyId) {
        companyQuery = companyQuery.eq('id', companyId);
      }
      const { data: company, error: companyError } = await companyQuery.limit(1).single();

      if (companyError) throw companyError;
      if (!company) throw new Error('Company not found');

      // Fetch organization units
      const { data: units, error: unitError } = await supabase
        .from('organization_units')
        .select('*')
        .eq('company_id', company.id)
        .order('order_index');

      if (unitError) throw unitError;

      // Fetch workers
      const { data: workers, error: workerError } = await supabase
        .from('workers')
        .select('*')
        .in('organization_unit_id', units?.map(u => u.id) || []);

      if (workerError) throw workerError;

      // Fetch projects
      const { data: projects, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .in('owner_unit_id', units?.map(u => u.id) || []);

      if (projectError) throw projectError;

      // Build tree with workers and projects
      const unitsWithDetails: OrganizationUnitWithChildren[] = (units || []).map(unit => ({
        ...unit,
        children: [],
        workers: workers?.filter(w => w.organization_unit_id === unit.id) || [],
        projects: projects?.filter(p => p.owner_unit_id === unit.id) || [],
      }));

      const tree = buildUnitTree(unitsWithDetails);

      // Manually attach workers and projects to tree nodes
      function attachDetails(nodes: OrganizationUnitWithChildren[]): OrganizationUnitWithChildren[] {
        return nodes.map(node => {
          const original = unitsWithDetails.find(u => u.id === node.id);
          return {
            ...node,
            workers: original?.workers || [],
            projects: original?.projects || [],
            children: attachDetails(node.children),
          };
        });
      }

      const treeWithDetails = attachDetails(tree);

      setData({
        ...company,
        organization_units: treeWithDetails,
      });
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ============================================
// Organization Unit CRUD
// ============================================

// Create organization unit
export async function createOrganizationUnit(unit: {
  name: string;
  type: 'folder' | 'execute';
  company_id: string;
  parent_id?: string | null;
  color?: string;
  description?: string;
  order_index?: number;
}) {
  const { data, error } = await supabase
    .from('organization_units')
    .insert({
      name: unit.name,
      type: unit.type,
      company_id: unit.company_id,
      parent_id: unit.parent_id || null,
      color: unit.color || null,
      description: unit.description || null,
      order_index: unit.order_index || 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update organization unit
export async function updateOrganizationUnit(id: string, updates: Partial<OrganizationUnit>) {
  const { data, error } = await supabase
    .from('organization_units')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Move organization unit to new parent
export async function moveOrganizationUnit(unitId: string, newParentId: string | null) {
  return updateOrganizationUnit(unitId, { parent_id: newParentId });
}

// Delete organization unit (only if no children and no projects)
export async function deleteOrganizationUnit(id: string) {
  // Check for children
  const { data: children } = await supabase
    .from('organization_units')
    .select('id')
    .eq('parent_id', id);

  if (children && children.length > 0) {
    throw new Error('Cannot delete unit with children. Move or delete children first.');
  }

  // Check for projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('owner_unit_id', id);

  if (projects && projects.length > 0) {
    throw new Error('Cannot delete unit with projects. Move or delete projects first.');
  }

  const { error } = await supabase
    .from('organization_units')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Worker CRUD
// ============================================

// Create worker
export async function createWorker(worker: {
  name: string;
  type: 'human' | 'ai_agent';
  organization_unit_id?: string;
  role?: string;
  email?: string;
  avatar_url?: string;
  ai_model?: string;
  ai_config?: Record<string, string | number | boolean | null>;
}) {
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: worker.name,
      type: worker.type,
      organization_unit_id: worker.organization_unit_id || null,
      role: worker.role || null,
      email: worker.email || null,
      avatar_url: worker.avatar_url || null,
      ai_model: worker.ai_model || null,
      ai_config: worker.ai_config ? worker.ai_config : null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update worker
export async function updateWorker(id: string, updates: Partial<Worker>) {
  const { data, error } = await supabase
    .from('workers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Move worker to different unit
export async function moveWorkerToUnit(workerId: string, newUnitId: string | null) {
  return updateWorker(workerId, { organization_unit_id: newUnitId });
}

// Delete worker
export async function deleteWorker(id: string) {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Task Links & Dependencies
// ============================================

// Add task link (for cross-department collaboration)
export async function addTaskLink(link: {
  task_id: string;
  target_type: 'unit' | 'worker' | 'goal';
  target_id: string;
  role?: 'contributor' | 'reviewer' | 'blocker' | 'watcher';
}) {
  const { data, error } = await supabase
    .from('task_links')
    .insert({
      task_id: link.task_id,
      target_type: link.target_type,
      target_id: link.target_id,
      role: link.role || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove task link
export async function removeTaskLink(id: string) {
  const { error } = await supabase
    .from('task_links')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Add task dependency
export async function addTaskDependency(dependency: {
  task_id: string;
  depends_on_task_id: string;
  dependency_type?: 'blocks' | 'requires' | 'related';
}) {
  const { data, error } = await supabase
    .from('task_dependencies')
    .insert({
      task_id: dependency.task_id,
      depends_on_task_id: dependency.depends_on_task_id,
      dependency_type: dependency.dependency_type || 'requires',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove task dependency
export async function removeTaskDependency(id: string) {
  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Get task dependencies
export async function getTaskDependencies(taskId: string) {
  const { data, error } = await supabase
    .from('task_dependencies')
    .select('*, depends_on:depends_on_task_id(id, title, status)')
    .eq('task_id', taskId);

  if (error) throw error;
  return data;
}

// Get tasks that depend on this task
export async function getTaskDependents(taskId: string) {
  const { data, error } = await supabase
    .from('task_dependencies')
    .select('*, task:task_id(id, title, status)')
    .eq('depends_on_task_id', taskId);

  if (error) throw error;
  return data;
}
