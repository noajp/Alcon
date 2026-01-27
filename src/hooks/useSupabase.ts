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
  ElementEdge,
  ElementEdgeWithElement,
  EdgeType,
  Json,
  CustomColumn,
  CustomColumnInsert,
  CustomColumnUpdate,
  CustomColumnValue,
  CustomColumnWithValues,
  CustomColumnType,
  ObjectTab,
  ObjectTabInsert,
  ObjectTabUpdate,
  ObjectTabType,
  Note,
  NoteInsert,
  NoteUpdate,
  NoteWithChildren,
  Document,
  DocumentInsert,
  DocumentUpdate,
  DocumentWithChildren,
  Canvas,
  CanvasInsert,
  CanvasUpdate,
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
  ElementEdge,
  ElementEdgeWithElement,
  EdgeType,
  CustomColumn,
  CustomColumnValue,
  CustomColumnWithValues,
  CustomColumnType,
  ObjectTab,
  ObjectTabType,
  Note,
  NoteWithChildren,
  Document,
  DocumentWithChildren,
  Canvas,
};

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
// Build object tree (recursive) using parent_object_id
// ============================================
function buildObjectTree(
  objects: AlconObjectWithChildren[],
  parentId: string | null = null
): AlconObjectWithChildren[] {
  return objects
    .filter(o => o.parent_object_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(obj => ({
      ...obj,
      children: buildObjectTree(objects, obj.id),
    }));
}

// ============================================
// Data structure for explorer (nested objects)
// ============================================
export interface ExplorerData {
  objects: AlconObjectWithChildren[];  // Root objects (parent_object_id = null) with nested children
  rootElements: ElementWithDetails[];  // Elements without object_id (user's personal tasks)
}

// ============================================
// Hook: Fetch All Objects (hierarchical tree)
// ============================================
export function useObjects() {
  const [data, setData] = useState<ExplorerData>({ objects: [], rootElements: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const fetchData = useCallback(async (showLoading = false) => {
    try {
      // Only show loading on initial load, not on refresh
      if (showLoading || isInitialLoad) {
        setLoading(true);
      }

      // Fetch all objects
      const { data: objectsData, error: objectsError } = await supabase
        .from('objects')
        .select('*')
        .order('order_index');

      if (objectsError) throw objectsError;
      const objects = (objectsData || []) as AlconObject[];

      // Get all object IDs
      const objectIds = objects.map(o => o.id);

      // Fetch all elements (including root-level ones with object_id = null)
      const { data: elementsData, error: elementsError } = await supabase
        .from('elements')
        .select('*')
        .order('order_index');

      if (elementsError) throw elementsError;
      const elements = (elementsData || []) as Element[];

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

      // Build objects with elements
      const objectsWithElements: AlconObjectWithChildren[] = objects.map(obj => ({
        ...obj,
        elements: elementsWithDetails.filter(e => e.object_id === obj.id),
        children: [],
      }));

      // Build hierarchical object tree
      const objectTree = buildObjectTree(objectsWithElements, null);

      // Get root-level elements (personal tasks without object_id)
      const rootElements = elementsWithDetails.filter(e => e.object_id === null);

      setData({ objects: objectTree, rootElements });
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    }
  }, [isInitialLoad]);

  useEffect(() => {
    fetchData(true); // Show loading on initial fetch
  }, []);

  // Refetch without showing loading spinner
  const refetch = useCallback(() => {
    fetchData(false);
  }, [fetchData]);

  return { data, loading, error, refetch };
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
  parent_object_id?: string | null;
  color?: string | null;
  description?: string | null;
  order_index?: number;
}): Promise<AlconObject> {
  // Get max order_index for objects with same parent
  let query = supabase
    .from('objects')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);

  if (obj.parent_object_id) {
    query = query.eq('parent_object_id', obj.parent_object_id);
  } else {
    query = query.is('parent_object_id', null);
  }

  const { data: existing } = await query;
  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('objects')
    .insert({
      name: obj.name,
      parent_object_id: obj.parent_object_id || null,
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

export async function deleteObject(id: string): Promise<void> {
  // First, recursively delete child objects
  const { data: childObjects } = await supabase
    .from('objects')
    .select('id')
    .eq('parent_object_id', id);

  if (childObjects && childObjects.length > 0) {
    for (const child of childObjects) {
      await deleteObject(child.id);
    }
  }

  // Delete all elements belonging to this object
  const { data: elements } = await supabase
    .from('elements')
    .select('id')
    .eq('object_id', id);

  if (elements && elements.length > 0) {
    // Delete subelements for each element
    for (const element of elements) {
      await supabase
        .from('subelements')
        .delete()
        .eq('element_id', element.id);
    }
    // Delete all elements
    await supabase
      .from('elements')
      .delete()
      .eq('object_id', id);
  }

  // Then delete the object
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
  object_id?: string | null;  // null = ユーザー直下の個人タスク
  description?: string | null;
  section?: string | null;
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string | null;
  estimated_hours?: number | null;
  order_index?: number;
}): Promise<Element> {
  // Get max order_index for the same scope (same object_id or root level)
  let query = supabase
    .from('elements')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);

  if (element.object_id) {
    query = query.eq('object_id', element.object_id);
  } else {
    query = query.is('object_id', null);
  }

  const { data: existing } = await query;
  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('elements')
    .insert({
      title: element.title,
      object_id: element.object_id || null,
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

// ============================================
// Reorder Functions (for drag and drop)
// ============================================

// Move an object to a new parent and/or position
export async function moveObject(
  objectId: string,
  newParentId: string | null,
  newIndex: number
): Promise<void> {
  // Get siblings at the destination
  let query = supabase
    .from('objects')
    .select('id, order_index')
    .order('order_index');

  if (newParentId) {
    query = query.eq('parent_object_id', newParentId);
  } else {
    query = query.is('parent_object_id', null);
  }

  const { data: siblings } = await query;

  // Filter out the object being moved
  const otherSiblings = (siblings || []).filter(s => s.id !== objectId);

  // Insert at new position
  otherSiblings.splice(newIndex, 0, { id: objectId, order_index: newIndex });

  // Update all order_indexes sequentially
  for (let i = 0; i < otherSiblings.length; i++) {
    const sibling = otherSiblings[i];
    if (sibling.id === objectId) {
      await supabase
        .from('objects')
        .update({ order_index: i, parent_object_id: newParentId })
        .eq('id', sibling.id);
    } else {
      await supabase
        .from('objects')
        .update({ order_index: i })
        .eq('id', sibling.id);
    }
  }

  // If the moved object wasn't in the list (moving from different parent)
  if (!siblings?.find(s => s.id === objectId)) {
    await supabase
      .from('objects')
      .update({ parent_object_id: newParentId, order_index: newIndex })
      .eq('id', objectId);
  }
}

// ============================================
// Element Edge CRUD (Dependencies)
// ============================================

export async function createElementEdge(edge: {
  from_element: string;
  to_element: string;
  edge_type: EdgeType;
  created_by?: string | null;
}): Promise<ElementEdge> {
  const { data, error } = await supabase
    .from('element_edges')
    .insert({
      from_element: edge.from_element,
      to_element: edge.to_element,
      edge_type: edge.edge_type,
      created_by: edge.created_by || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteElementEdge(id: string): Promise<void> {
  const { error } = await supabase
    .from('element_edges')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getElementEdges(elementId: string): Promise<{
  incoming: ElementEdgeWithElement[];
  outgoing: ElementEdgeWithElement[];
}> {
  // Get outgoing edges (from this element)
  const { data: outgoingEdges, error: outError } = await supabase
    .from('element_edges')
    .select('*')
    .eq('from_element', elementId);

  if (outError) throw outError;

  // Get incoming edges (to this element)
  const { data: incomingEdges, error: inError } = await supabase
    .from('element_edges')
    .select('*')
    .eq('to_element', elementId);

  if (inError) throw inError;

  // Get related element IDs
  const outgoingElementIds = (outgoingEdges || []).map(e => e.to_element);
  const incomingElementIds = (incomingEdges || []).map(e => e.from_element);
  const allRelatedIds = [...new Set([...outgoingElementIds, ...incomingElementIds])];

  // Fetch related elements
  let relatedElements: Element[] = [];
  if (allRelatedIds.length > 0) {
    const { data: elementsData, error: elementsError } = await supabase
      .from('elements')
      .select('*')
      .in('id', allRelatedIds);

    if (elementsError) throw elementsError;
    relatedElements = (elementsData || []) as Element[];
  }

  // Build edges with element info
  const outgoing: ElementEdgeWithElement[] = (outgoingEdges || []).map(edge => ({
    ...edge,
    related_element: relatedElements.find(e => e.id === edge.to_element),
  }));

  const incoming: ElementEdgeWithElement[] = (incomingEdges || []).map(edge => ({
    ...edge,
    related_element: relatedElements.find(e => e.id === edge.from_element),
  }));

  return { incoming, outgoing };
}

// Check if element can start (all depends_on are done)
export async function canElementStart(elementId: string): Promise<{
  can_start: boolean;
  blocking: ElementEdgeWithElement[];
}> {
  const { incoming } = await getElementEdges(elementId);

  // Filter to only depends_on edges where the source element is not done
  const blocking = incoming.filter(edge =>
    edge.edge_type === 'depends_on' &&
    edge.related_element?.status !== 'done'
  );

  return {
    can_start: blocking.length === 0,
    blocking,
  };
}

// ============================================
// Fetch All Workers (for actor selection)
// ============================================
export async function fetchAllWorkers(): Promise<Worker[]> {
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .order('name');

  if (error) throw error;
  return (data || []) as Worker[];
}

// ============================================
// Custom Columns CRUD
// ============================================

// Fetch all custom columns for an object
export async function fetchCustomColumns(objectId: string): Promise<CustomColumn[]> {
  const { data, error } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index');

  if (error) throw error;
  return (data || []) as CustomColumn[];
}

// Fetch custom columns with all their values for an object
export async function fetchCustomColumnsWithValues(objectId: string): Promise<CustomColumnWithValues[]> {
  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('object_id', objectId)
    .eq('is_visible', true)
    .order('order_index');

  if (colError) throw colError;

  if (!columns || columns.length === 0) {
    return [];
  }

  const columnIds = columns.map(c => c.id);
  const { data: values, error: valError } = await supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columnIds);

  if (valError) throw valError;

  // Group values by column
  const valuesByColumn: Record<string, Record<string, CustomColumnValue>> = {};
  for (const val of (values || [])) {
    if (!valuesByColumn[val.column_id]) {
      valuesByColumn[val.column_id] = {};
    }
    valuesByColumn[val.column_id][val.element_id] = val as CustomColumnValue;
  }

  return columns.map(col => ({
    ...col,
    values: valuesByColumn[col.id] || {},
  })) as CustomColumnWithValues[];
}

// Create a new custom column
export async function createCustomColumn(column: CustomColumnInsert): Promise<CustomColumn> {
  // Get max order_index
  const { data: existing } = await supabase
    .from('custom_columns')
    .select('order_index')
    .eq('object_id', column.object_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxIndex = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('custom_columns')
    .insert({
      ...column,
      order_index: maxIndex + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumn;
}

// Update a custom column
export async function updateCustomColumn(id: string, updates: CustomColumnUpdate): Promise<CustomColumn> {
  const { data, error } = await supabase
    .from('custom_columns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumn;
}

// Delete a custom column
export async function deleteCustomColumn(id: string): Promise<void> {
  const { error } = await supabase
    .from('custom_columns')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Set a custom column value for an element
export async function setCustomColumnValue(
  columnId: string,
  elementId: string,
  value: Json
): Promise<CustomColumnValue> {
  const { data, error } = await supabase
    .from('custom_column_values')
    .upsert({
      column_id: columnId,
      element_id: elementId,
      value,
    }, {
      onConflict: 'column_id,element_id',
    })
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumnValue;
}

// Delete a custom column value
export async function deleteCustomColumnValue(columnId: string, elementId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('column_id', columnId)
    .eq('element_id', elementId);

  if (error) throw error;
}

// Reorder columns
export async function reorderCustomColumns(objectId: string, columnIds: string[]): Promise<void> {
  const updates = columnIds.map((id, index) => ({
    id,
    order_index: index,
  }));

  for (const update of updates) {
    await supabase
      .from('custom_columns')
      .update({ order_index: update.order_index })
      .eq('id', update.id);
  }
}

// ============================================
// Object Tabs - Chrome-like tabs for Objects
// ============================================

// Fetch all tabs for an object
export async function fetchObjectTabs(objectId: string): Promise<ObjectTab[]> {
  const { data, error } = await supabase
    .from('object_tabs')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create a new tab
export async function createObjectTab(tab: ObjectTabInsert): Promise<ObjectTab> {
  // Get the max order_index for this object
  const { data: existing } = await supabase
    .from('object_tabs')
    .select('order_index')
    .eq('object_id', tab.object_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('object_tabs')
    .insert({
      ...tab,
      order_index: tab.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a tab
export async function updateObjectTab(tabId: string, updates: ObjectTabUpdate): Promise<ObjectTab> {
  const { data, error } = await supabase
    .from('object_tabs')
    .update(updates)
    .eq('id', tabId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a tab
export async function deleteObjectTab(tabId: string): Promise<void> {
  const { error } = await supabase
    .from('object_tabs')
    .delete()
    .eq('id', tabId);

  if (error) throw error;
}

// Reorder tabs
export async function reorderObjectTabs(objectId: string, tabIds: string[]): Promise<void> {
  for (let i = 0; i < tabIds.length; i++) {
    await supabase
      .from('object_tabs')
      .update({ order_index: i })
      .eq('id', tabIds[i]);
  }
}

// Hook: Fetch tabs for an object
export function useObjectTabs(objectId: string | null) {
  const [tabs, setTabs] = useState<ObjectTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTabs = useCallback(async () => {
    if (!objectId) {
      setTabs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchObjectTabs(objectId);
      setTabs(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  return { tabs, loading, error, refetch: fetchTabs };
}

// ============================================
// Notes - OneNote-like folder/file structure
// ============================================

// Build note tree from flat list
function buildNoteTree(notes: Note[], parentId: string | null = null): NoteWithChildren[] {
  return notes
    .filter(n => n.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(note => ({
      ...note,
      children: buildNoteTree(notes, note.id),
    }));
}

// Fetch all notes for an object
export async function fetchNotes(objectId: string): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index');

  if (error) throw error;
  return data || [];
}

// Create a new note or folder
export async function createNote(note: NoteInsert): Promise<Note> {
  // Get max order_index for siblings
  let query = supabase
    .from('notes')
    .select('order_index')
    .eq('object_id', note.object_id)
    .order('order_index', { ascending: false })
    .limit(1);

  if (note.parent_id) {
    query = query.eq('parent_id', note.parent_id);
  } else {
    query = query.is('parent_id', null);
  }

  const { data: existing } = await query;
  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('notes')
    .insert({
      ...note,
      content: note.content || [],
      order_index: note.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a note
export async function updateNote(noteId: string, updates: NoteUpdate): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', noteId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a note (and its children due to CASCADE)
export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId);

  if (error) throw error;
}

// Hook: Fetch notes for an object as a tree
export function useNotes(objectId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTree, setNoteTree] = useState<NoteWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!objectId) {
      setNotes([]);
      setNoteTree([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchNotes(objectId);
      setNotes(data);
      setNoteTree(buildNoteTree(data));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { notes, noteTree, loading, error, refetch: fetchData };
}

// ============================================
// Documents CRUD (Notion-like global documents)
// ============================================

// Build document tree from flat list
function buildDocumentTree(documents: Document[], parentId: string | null = null): DocumentWithChildren[] {
  return documents
    .filter(d => d.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(doc => ({
      ...doc,
      children: buildDocumentTree(documents, doc.id),
    }));
}

// Fetch all documents
export async function fetchDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create document
export async function createDocument(doc: DocumentInsert): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update document
export async function updateDocument(docId: string, updates: DocumentUpdate): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete document (cascades to children)
export async function deleteDocument(docId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', docId);

  if (error) throw error;
}

// Hook: Fetch all documents as a tree
export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentTree, setDocumentTree] = useState<DocumentWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDocuments();
      setDocuments(data);
      setDocumentTree(buildDocumentTree(data));
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

  return { documents, documentTree, loading, error, refetch: fetchData };
}

// ============================================
// Canvas CRUD (tldraw whiteboard data)
// ============================================

// Fetch all canvases
export async function fetchCanvases(): Promise<Canvas[]> {
  const { data, error } = await supabase
    .from('canvases')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Fetch a single canvas by ID
export async function fetchCanvas(canvasId: string): Promise<Canvas | null> {
  const { data, error } = await supabase
    .from('canvases')
    .select('*')
    .eq('id', canvasId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

// Create canvas
export async function createCanvas(canvas: CanvasInsert = {}): Promise<Canvas> {
  const { data, error } = await supabase
    .from('canvases')
    .insert({
      name: canvas.name || 'Untitled Canvas',
      snapshot: canvas.snapshot || {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update canvas
export async function updateCanvas(canvasId: string, updates: CanvasUpdate): Promise<Canvas> {
  const { data, error } = await supabase
    .from('canvases')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', canvasId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete canvas
export async function deleteCanvas(canvasId: string): Promise<void> {
  const { error } = await supabase
    .from('canvases')
    .delete()
    .eq('id', canvasId);

  if (error) throw error;
}

// Hook: Fetch all canvases
export function useCanvases() {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCanvases();
      setCanvases(data);
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

  return { canvases, loading, error, refetch: fetchData };
}
