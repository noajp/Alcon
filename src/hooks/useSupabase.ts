'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementWithDetails,
  Subelement,
  Worker,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementsBySection,
  Json,
} from '@/types/database';

// Re-export types
export type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementWithDetails,
  Subelement,
  Worker,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementsBySection,
};

// ============================================
// Build Object Tree (recursive)
// ============================================
function buildObjectTree(
  objects: AlconObject[],
  elements: ElementWithDetails[],
  parentId: string | null = null
): AlconObjectWithChildren[] {
  return objects
    .filter(obj => obj.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(obj => ({
      ...obj,
      children: buildObjectTree(objects, elements, obj.id),
      elements: elements.filter(e => e.object_id === obj.id),
    }));
}

// ============================================
// Group elements by section
// ============================================
export function groupElementsBySection(elements: ElementWithDetails[]): ElementsBySection[] {
  const grouped = new Map<string | null, ElementWithDetails[]>();

  for (const element of elements) {
    const section = element.section;
    if (!grouped.has(section)) {
      grouped.set(section, []);
    }
    grouped.get(section)!.push(element);
  }

  // Sort: sections first (alphabetically), then null section last
  const sections = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  return sections.map(section => ({
    section,
    elements: grouped.get(section)!,
  }));
}

// ============================================
// Hook: Fetch All Objects with Hierarchy
// ============================================
export function useObjects() {
  const [data, setData] = useState<AlconObjectWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch all objects
      const { data: objectsData, error: objectsError } = await supabase
        .from('objects')
        .select('*')
        .order('order_index');

      if (objectsError) throw objectsError;
      const objects = (objectsData || []) as AlconObject[];

      // Get all object IDs
      const objectIds = objects.map(o => o.id);

      // Fetch elements for all objects
      let elements: Element[] = [];
      if (objectIds.length > 0) {
        const { data: elementsData, error: elementsError } = await supabase
          .from('elements')
          .select('*')
          .in('object_id', objectIds)
          .order('order_index');

        if (elementsError) throw elementsError;
        elements = (elementsData || []) as Element[];
      }

      // Fetch subelements
      const elementIds = elements.map(e => e.id);
      let subelements: Subelement[] = [];
      if (elementIds.length > 0) {
        const { data: subelementsData, error: subelementsError } = await supabase
          .from('subelements')
          .select('*')
          .in('element_id', elementIds)
          .order('order_index');

        if (subelementsError) throw subelementsError;
        subelements = (subelementsData || []) as Subelement[];
      }

      // Fetch element assignees
      let assignees: ElementAssignee[] = [];
      if (elementIds.length > 0) {
        const { data: assigneesData, error: assigneesError } = await supabase
          .from('element_assignees')
          .select('*')
          .in('element_id', elementIds);

        if (assigneesError) throw assigneesError;
        assignees = (assigneesData || []) as ElementAssignee[];
      }

      // Fetch workers for assignees
      const workerIds = assignees.map(a => a.worker_id);
      let workers: Worker[] = [];
      if (workerIds.length > 0) {
        const { data: workersData, error: workersError } = await supabase
          .from('workers')
          .select('*')
          .in('id', workerIds);

        if (workersError) throw workersError;
        workers = (workersData || []) as Worker[];
      }

      // Build elements with details
      const elementsWithDetails: ElementWithDetails[] = elements.map(element => ({
        ...element,
        subelements: subelements.filter(s => s.element_id === element.id),
        assignees: assignees
          .filter(a => a.element_id === element.id)
          .map(a => ({
            ...a,
            worker: workers.find(w => w.id === a.worker_id),
          })),
      }));

      // Build object tree
      const objectTree = buildObjectTree(objects || [], elementsWithDetails);

      setData(objectTree);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ============================================
// Hook: Fetch Workers
// ============================================
export function useWorkers(objectId?: string) {
  const [data, setData] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchWorkers() {
      try {
        let query = supabase.from('workers').select('*');
        if (objectId) {
          query = query.eq('object_id', objectId);
        }
        const { data: workersData, error } = await query.order('name');

        if (error) throw error;
        setData((workersData || []) as Worker[]);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchWorkers();
  }, [objectId]);

  return { data, loading, error };
}

// ============================================
// Hook: Fetch Elements by Object
// ============================================
export function useElementsByObject(objectId: string | null) {
  const [data, setData] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchElements() {
      if (!objectId) {
        setData([]);
        setLoading(false);
        return;
      }

      try {
        // Fetch elements
        const { data: elementsData, error: elementsError } = await supabase
          .from('elements')
          .select('*')
          .eq('object_id', objectId)
          .order('order_index');

        if (elementsError) throw elementsError;

        const elements = (elementsData || []) as Element[];
        const elementIds = elements.map(e => e.id);

        // Fetch subelements
        let subelements: Subelement[] = [];
        if (elementIds.length > 0) {
          const { data: subelementsData, error: subelementsError } = await supabase
            .from('subelements')
            .select('*')
            .in('element_id', elementIds)
            .order('order_index');

          if (subelementsError) throw subelementsError;
          subelements = (subelementsData || []) as Subelement[];
        }

        // Fetch assignees
        let assignees: ElementAssignee[] = [];
        if (elementIds.length > 0) {
          const { data: assigneesData, error: assigneesError } = await supabase
            .from('element_assignees')
            .select('*')
            .in('element_id', elementIds);

          if (assigneesError) throw assigneesError;
          assignees = (assigneesData || []) as ElementAssignee[];
        }

        // Fetch workers
        const workerIds = assignees.map(a => a.worker_id);
        let workers: Worker[] = [];
        if (workerIds.length > 0) {
          const { data: workersData, error: workersError } = await supabase
            .from('workers')
            .select('*')
            .in('id', workerIds);

          if (workersError) throw workersError;
          workers = (workersData || []) as Worker[];
        }

        // Build elements with details
        const elementsWithDetails: ElementWithDetails[] = elements.map(element => ({
          ...element,
          subelements: subelements.filter(s => s.element_id === element.id),
          assignees: assignees
            .filter(a => a.element_id === element.id)
            .map(a => ({
              ...a,
              worker: workers.find(w => w.id === a.worker_id),
            })),
        }));

        setData(elementsWithDetails);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchElements();
  }, [objectId]);

  return { data, loading, error };
}

// ============================================
// Object CRUD
// ============================================

export async function createObject(obj: {
  name: string;
  parent_id?: string | null;
  color?: string | null;
  description?: string | null;
  order_index?: number;
}): Promise<AlconObject> {
  // Get max order_index for siblings
  let query = supabase
    .from('objects')
    .select('order_index');

  if (obj.parent_id) {
    query = query.eq('parent_id', obj.parent_id);
  } else {
    query = query.is('parent_id', null);
  }

  const { data: existing } = await query
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('objects')
    .insert({
      name: obj.name,
      parent_id: obj.parent_id || null,
      color: obj.color || null,
      description: obj.description || null,
      order_index: obj.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateObject(
  id: string,
  updates: Partial<Omit<AlconObject, 'id' | 'created_at'>>
): Promise<AlconObject> {
  const { data, error } = await supabase
    .from('objects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function moveObject(objectId: string, newParentId: string | null): Promise<AlconObject> {
  // Prevent moving an object into itself or its descendants
  if (newParentId) {
    const isDescendant = async (potentialParentId: string, targetId: string): Promise<boolean> => {
      const { data } = await supabase
        .from('objects')
        .select('parent_id')
        .eq('id', potentialParentId)
        .single();

      if (!data) return false;
      if (data.parent_id === targetId) return true;
      if (data.parent_id) return isDescendant(data.parent_id, targetId);
      return false;
    };

    if (newParentId === objectId || await isDescendant(newParentId, objectId)) {
      throw new Error('Cannot move object into itself or its descendants');
    }
  }

  return updateObject(objectId, { parent_id: newParentId });
}

export async function deleteObject(id: string): Promise<void> {
  // Check for children
  const { data: children } = await supabase
    .from('objects')
    .select('id')
    .eq('parent_id', id);

  if (children && children.length > 0) {
    throw new Error('Cannot delete object with children. Move or delete children first.');
  }

  // Check for elements
  const { data: elements } = await supabase
    .from('elements')
    .select('id')
    .eq('object_id', id);

  if (elements && elements.length > 0) {
    throw new Error('Cannot delete object with elements. Move or delete elements first.');
  }

  const { error } = await supabase
    .from('objects')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Element CRUD
// ============================================

export async function createElement(element: {
  title: string;
  object_id: string;
  description?: string | null;
  section?: string | null;
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string | null;
  estimated_hours?: number | null;
  order_index?: number;
}): Promise<Element> {
  // Get max order_index
  const { data: existing } = await supabase
    .from('elements')
    .select('order_index')
    .eq('object_id', element.object_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('elements')
    .insert({
      title: element.title,
      object_id: element.object_id,
      description: element.description || null,
      section: element.section || null,
      status: element.status || 'todo',
      priority: element.priority || 'medium',
      due_date: element.due_date || null,
      estimated_hours: element.estimated_hours || null,
      order_index: element.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateElement(
  id: string,
  updates: Partial<Omit<Element, 'id' | 'created_at'>>
): Promise<Element> {
  const { data, error } = await supabase
    .from('elements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteElement(id: string): Promise<void> {
  // Delete subelements first
  await supabase.from('subelements').delete().eq('element_id', id);

  // Delete assignees
  await supabase.from('element_assignees').delete().eq('element_id', id);

  // Delete element
  const { error } = await supabase
    .from('elements')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Subelement CRUD
// ============================================

export async function createSubelement(subelement: {
  title: string;
  element_id: string;
  is_completed?: boolean;
  order_index?: number;
}): Promise<Subelement> {
  const { data: existing } = await supabase
    .from('subelements')
    .select('order_index')
    .eq('element_id', subelement.element_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('subelements')
    .insert({
      title: subelement.title,
      element_id: subelement.element_id,
      is_completed: subelement.is_completed ?? false,
      order_index: subelement.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSubelement(
  id: string,
  updates: Partial<Omit<Subelement, 'id' | 'created_at'>>
): Promise<Subelement> {
  const { data, error } = await supabase
    .from('subelements')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSubelement(id: string): Promise<void> {
  const { error } = await supabase
    .from('subelements')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleSubelementComplete(id: string, isCompleted: boolean): Promise<Subelement> {
  return updateSubelement(id, { is_completed: isCompleted });
}

// ============================================
// Worker CRUD
// ============================================

export async function createWorker(worker: {
  name: string;
  type: 'human' | 'ai_agent';
  object_id?: string | null;
  role?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  ai_model?: string | null;
  ai_config?: Json | null;
}): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: worker.name,
      type: worker.type,
      object_id: worker.object_id || null,
      role: worker.role || null,
      email: worker.email || null,
      avatar_url: worker.avatar_url || null,
      ai_model: worker.ai_model || null,
      ai_config: worker.ai_config || null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateWorker(
  id: string,
  updates: Partial<Omit<Worker, 'id' | 'created_at'>>
): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Element Assignee CRUD
// ============================================

export async function addElementAssignee(assignee: {
  element_id: string;
  worker_id: string;
  role?: 'assignee' | 'reviewer' | 'collaborator';
}): Promise<ElementAssignee> {
  const { data, error } = await supabase
    .from('element_assignees')
    .insert({
      element_id: assignee.element_id,
      worker_id: assignee.worker_id,
      role: assignee.role || 'assignee',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeElementAssignee(id: string): Promise<void> {
  const { error } = await supabase
    .from('element_assignees')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getElementAssignees(elementId: string): Promise<ElementAssigneeWithWorker[]> {
  const { data: assignees, error: assigneesError } = await supabase
    .from('element_assignees')
    .select('*')
    .eq('element_id', elementId);

  if (assigneesError) throw assigneesError;

  if (!assignees || assignees.length === 0) return [];

  const workerIds = assignees.map(a => a.worker_id);
  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('*')
    .in('id', workerIds);

  if (workersError) throw workersError;

  return assignees.map(a => ({
    ...a,
    worker: workers?.find(w => w.id === a.worker_id),
  }));
}
