'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

// Types
export type Company = Tables<'companies'>;
export type Department = Tables<'departments'>;
export type Team = Tables<'teams'>;
export type Member = Tables<'members'>;
export type Project = Tables<'projects'>;
export type Section = Tables<'sections'>;
export type Task = Tables<'tasks'>;
export type Subtask = Tables<'subtasks'>;

// Extended types with relations
export interface DepartmentWithTeams extends Department {
  teams: TeamWithProjects[];
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

      const departmentsWithTeams: DepartmentWithTeams[] = (departments || []).map(dept => ({
        ...dept,
        teams: teamsWithProjects.filter(t => t.department_id === dept.id),
      }));

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
