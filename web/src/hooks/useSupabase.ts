'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  Document,
  DocumentInsert,
  DocumentUpdate,
  DocumentWithChildren,
  ObjectParent,
  ElementObject,
  Domain,
  DomainInsert,
  DomainUpdate,
  ObjectDomain,
  Section,
  SectionKind,
  ElementComment,
  ElementCommentInsert,
  ElementCommentUpdate,
  ElementReaction,
  ElementReactionInsert,
  Notification,
  NotificationInsert,
  NotificationKind,
  ElementApproval,
  ElementApprovalInsert,
  ApprovalState,
  TimeEntry,
  TimeEntryInsert,
  TimeEntryUpdate,
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
  Document,
  DocumentWithChildren,
  ObjectParent,
  ElementObject,
  Domain,
  ObjectDomain,
  Section,
  SectionKind,
  ElementComment,
  ElementReaction,
  Notification,
  NotificationKind,
  ElementApproval,
  ApprovalState,
  TimeEntry,
};

// ============================================
// Group elements by section_id
// ============================================
export function groupElementsBySection(elements: ElementWithDetails[]): ElementsBySection[] {
  const grouped = new Map<string | null, ElementWithDetails[]>();

  for (const element of elements) {
    const sectionId = element.section_id;
    if (!grouped.has(sectionId)) {
      grouped.set(sectionId, []);
    }
    grouped.get(sectionId)!.push(element);
  }

  // Sort: items with a section first (by section_id for stable ordering),
  // null section last. Display order is decided by the caller using
  // sections.order_index, this just produces a consistent grouping.
  const sectionIds = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });

  return sectionIds.map(sectionId => ({
    section_id: sectionId,
    elements: grouped.get(sectionId)!,
  }));
}

// ============================================
// Build object tree using object_parents junction table
// Objects with multiple parents appear in multiple branches
// ============================================
function buildObjectTree(
  objects: AlconObjectWithChildren[],
  parentRelations: ObjectParent[],
  parentId: string | null = null,
  visited: Set<string> = new Set()
): AlconObjectWithChildren[] {
  // Find child object IDs for this parent
  const childIds = parentId === null
    // Root: objects that have NO entries in parentRelations
    ? objects.filter(o => !parentRelations.some(r => r.object_id === o.id)).map(o => o.id)
    // Non-root: objects whose parent is parentId
    : parentRelations.filter(r => r.parent_object_id === parentId).map(r => r.object_id);

  const objectMap = new Map(objects.map(o => [o.id, o]));

  return childIds
    .map(id => objectMap.get(id))
    .filter((o): o is AlconObjectWithChildren => !!o)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(obj => {
      // Cycle guard: skip if already visited in THIS branch
      if (visited.has(obj.id)) return { ...obj, children: [] };
      const branchVisited = new Set(visited);
      branchVisited.add(obj.id);
      return {
        ...obj,
        children: buildObjectTree(objects, parentRelations, obj.id, branchVisited),
      };
    });
}

// ============================================
// Data structure for explorer (nested objects)
// ============================================
export interface ExplorerData {
  objects: AlconObjectWithChildren[];  // Root objects (parent_object_id = null) with nested children
}

// ============================================
// Hook: Fetch All Objects (hierarchical tree)
// ============================================
export function useObjects(domainId?: string | null) {
  const [data, setData] = useState<ExplorerData>({ objects: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const mountedRef = useRef(false);

  const fetchData = useCallback(async (showLoading = false) => {
    try {
      // Only show loading on initial load, not on refresh
      if (showLoading || isInitialLoad) {
        setLoading(true);
      }

      // Fetch objects filtered by domain (via object_domains junction for multi-homing).
      // Also surfaces orphan objects (no junction entry AND no legacy domain_id) under
      // the active domain so pre-domain-migration data doesn't disappear from the UI.
      const { data: objectsData, error: objectsError } = await supabase
        .from('objects')
        .select('*')
        .order('order_index');
      if (objectsError) throw objectsError;
      let objects = (objectsData || []) as AlconObject[];

      if (domainId) {
        const [{ data: linksForDomain }, { data: anyLinks }] = await Promise.all([
          supabase.from('object_domains').select('object_id').eq('domain_id', domainId),
          supabase.from('object_domains').select('object_id'),
        ]);
        const linkedIds = new Set(
          (linksForDomain || []).map((r: { object_id: string }) => r.object_id)
        );
        const anyLinkedIds = new Set(
          (anyLinks || []).map((r: { object_id: string }) => r.object_id)
        );
        objects = objects.filter(o =>
          linkedIds.has(o.id) ||
          o.domain_id === domainId ||
          (o.domain_id == null && !anyLinkedIds.has(o.id))
        );
      }

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

      // Fetch junction tables for multi-homing
      const { data: objectParentsData } = await supabase
        .from('object_parents')
        .select('*')
        .order('order_index');
      const objectParents = (objectParentsData || []) as ObjectParent[];

      const { data: elementObjectsData } = await supabase
        .from('element_objects')
        .select('*')
        .order('order_index');
      const elementObjects = (elementObjectsData || []) as ElementObject[];

      // Build parent/object ID sets for multi-homing info
      const objectParentMap = new Map<string, string[]>();
      for (const r of objectParents) {
        if (!objectParentMap.has(r.object_id)) objectParentMap.set(r.object_id, []);
        objectParentMap.get(r.object_id)!.push(r.parent_object_id);
      }
      const elementObjectMap = new Map<string, string[]>();
      for (const r of elementObjects) {
        if (!elementObjectMap.has(r.element_id)) elementObjectMap.set(r.element_id, []);
        elementObjectMap.get(r.element_id)!.push(r.object_id);
      }

      // Build elements with details + multi-homing info
      const elementsWithDetails: ElementWithDetails[] = elements.map(element => {
        const objIds = elementObjectMap.get(element.id) || (element.object_id ? [element.object_id] : []);
        return {
          ...element,
          subelements: subelements.filter(s => s.element_id === element.id),
          assignees: assignees
            .filter(a => a.element_id === element.id)
            .map(a => ({
              ...a,
              worker: workers.find(w => w.id === a.worker_id),
            })),
          objectIds: objIds,
          isMultiHomed: objIds.length > 1,
        };
      });

      // Build reverse map: objectId → elementIds (from junction table)
      const objectElementMap = new Map<string, string[]>();
      for (const r of elementObjects) {
        if (!objectElementMap.has(r.object_id)) objectElementMap.set(r.object_id, []);
        objectElementMap.get(r.object_id)!.push(r.element_id);
      }
      const elementById = new Map(elementsWithDetails.map(e => [e.id, e]));

      // Build objects with elements + multi-homing info
      const objectsWithElements: AlconObjectWithChildren[] = objects.map(obj => {
        const parentIds = objectParentMap.get(obj.id) || (obj.parent_object_id ? [obj.parent_object_id] : []);
        // Get elements from junction table
        const objElementIds = objectElementMap.get(obj.id) || [];
        const objElements = objElementIds.map(eid => elementById.get(eid)).filter((e): e is ElementWithDetails => !!e);
        return {
          ...obj,
          elements: objElements,
          children: [],
          parentIds,
          isMultiHomed: parentIds.length > 1,
        };
      });

      // Build hierarchical object tree using junction table
      const objectTree = buildObjectTree(objectsWithElements, objectParents, null);

      setData({ objects: objectTree });
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    }
  }, [isInitialLoad, domainId]);

  useEffect(() => {
    const isFirst = !mountedRef.current;
    mountedRef.current = true;
    fetchData(isFirst); // full-screen spinner only on first mount
  }, [domainId]); // re-fetch silently when domain changes

  // Refetch without showing loading spinner. Returns the in-flight promise
  // so callers can await the data refresh (used by inline-add submission to
  // keep the typed text visible until the new row materializes in the list).
  const refetch = useCallback(() => fetchData(false), [fetchData]);

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
  section_id?: string | null;
  order_index?: number;
  system_id?: string | null;  // legacy
  domain_id?: string | null;  // primary domain (UUID FK)
  domain_ids?: string[];      // multi-homing: all domains this object belongs to
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
      section_id: obj.section_id ?? null,
      order_index: obj.order_index ?? maxOrder + 1,
      domain_id: obj.domain_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  // Write to object_parents junction table for parent multi-homing
  if (obj.parent_object_id) {
    await supabase.from('object_parents').insert({
      object_id: data.id,
      parent_object_id: obj.parent_object_id,
      order_index: obj.order_index ?? maxOrder + 1,
      is_primary: true,
    });
  }

  // Write to object_domains junction table for domain multi-homing
  const domainIds = obj.domain_ids && obj.domain_ids.length > 0
    ? obj.domain_ids
    : obj.domain_id ? [obj.domain_id] : [];
  if (domainIds.length > 0) {
    await supabase.from('object_domains').insert(
      domainIds.map((did, i) => ({
        object_id: data.id,
        domain_id: did,
        is_primary: i === 0,
        order_index: i,
      }))
    );
  }

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
  // Find child objects via junction table
  const { data: childRelations } = await supabase
    .from('object_parents')
    .select('object_id')
    .eq('parent_object_id', id);

  if (childRelations && childRelations.length > 0) {
    for (const rel of childRelations) {
      // Check if child has OTHER parents (multi-homed)
      const { data: otherParents } = await supabase
        .from('object_parents')
        .select('id')
        .eq('object_id', rel.object_id)
        .neq('parent_object_id', id);

      if (otherParents && otherParents.length > 0) {
        // Multi-homed: just remove this parent link, child survives
        await supabase.from('object_parents').delete()
          .eq('object_id', rel.object_id).eq('parent_object_id', id);
        // If this was primary, promote another parent
        await supabase.from('objects').update({
          parent_object_id: otherParents[0] ? rel.object_id : null,
          updated_at: new Date().toISOString(),
        }).eq('id', rel.object_id);
      } else {
        // Single parent: cascade delete child
        await deleteObject(rel.object_id);
      }
    }
  }

  // Handle elements via junction table
  const { data: elementRelations } = await supabase
    .from('element_objects')
    .select('element_id')
    .eq('object_id', id);

  if (elementRelations && elementRelations.length > 0) {
    for (const rel of elementRelations) {
      const { data: otherObjects } = await supabase
        .from('element_objects')
        .select('id')
        .eq('element_id', rel.element_id)
        .neq('object_id', id);

      if (otherObjects && otherObjects.length > 0) {
        // Multi-homed: just unlink, element survives
        await supabase.from('element_objects').delete()
          .eq('element_id', rel.element_id).eq('object_id', id);
      } else {
        // Single parent: delete element + subelements
        await supabase.from('subelements').delete().eq('element_id', rel.element_id);
        await supabase.from('elements').delete().eq('id', rel.element_id);
      }
    }
  }

  // Clean up any remaining junction entries (CASCADE handles most)
  await supabase.from('object_parents').delete().eq('object_id', id);

  // Delete the object itself
  const { error } = await supabase
    .from('objects')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Section CRUD
// ============================================
// Section is a first-class entity scoped to its parent Object. The parent
// Object owns an ordered list of named sections; child Elements / child
// Objects reference one of these sections via section_id (or null = no
// section). A section's `kind` locks it to host only Elements or only
// Objects (or null = mixed/undecided).
//
// Sections persist independently of items, so emptying a section does NOT
// remove the section header — the user has to delete the section explicitly.

export async function fetchSectionsForObject(objectId: string): Promise<Section[]> {
  // Sort by (order_index, created_at) ascending so newer sections always
  // land at the bottom even if multiple rows share the same order_index
  // (e.g. concurrent inserts that race on the max-lookup below).
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Section[];
}

export async function createSection(section: {
  object_id: string;
  name: string;
  kind?: 'element' | 'object' | null;
  order_index?: number;
}): Promise<Section> {
  // Append to the end if no order_index is provided. We always materialize
  // the order_index here so the column's DEFAULT 0 doesn't accidentally
  // collapse multiple new sections to the same value (which would let the
  // DB's secondary ordering decide their position — typically newest first,
  // surfacing the new section at the TOP of the list).
  let order_index = section.order_index;
  if (order_index === undefined) {
    const { data: existing } = await supabase
      .from('sections')
      .select('order_index')
      .eq('object_id', section.object_id)
      .order('order_index', { ascending: false })
      .limit(1);
    order_index = (existing?.[0]?.order_index ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from('sections')
    .insert({
      object_id: section.object_id,
      name: section.name,
      kind: section.kind ?? null,
      order_index,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Section;
}

export async function updateSection(
  id: string,
  updates: { name?: string; kind?: 'element' | 'object' | null; order_index?: number }
): Promise<Section> {
  const { data, error } = await supabase
    .from('sections')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Section;
}

export async function deleteSection(id: string, opts?: { cascade?: boolean }): Promise<void> {
  // ON DELETE SET NULL on FKs orphans items in this section by default.
  // When cascade=true, hard-delete items in this section first.
  if (opts?.cascade) {
    await supabase.from('elements').delete().eq('section_id', id);
    await supabase.from('objects').delete().eq('section_id', id);
  }
  const { error } = await supabase.from('sections').delete().eq('id', id);
  if (error) throw error;
}

// ============================================
// Element CRUD
// ============================================

export async function createElement(element: {
  title: string;
  object_id: string;  // Element は必ず Object に格納される
  description?: string | null;
  section_id?: string | null;
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  estimated_hours?: number | null;
  order_index?: number;
}): Promise<Element> {
  // Get max order_index for the same scope (same object_id)
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
      section_id: element.section_id || null,
      status: element.status || 'todo',
      priority: element.priority || 'medium',
      start_date: element.start_date || null,
      start_time: element.start_time || null,
      due_date: element.due_date || null,
      due_time: element.due_time || null,
      estimated_hours: element.estimated_hours || null,
      order_index: element.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;

  // Dual-write: also insert into element_objects junction table.
  await supabase.from('element_objects').insert({
    element_id: data.id,
    object_id: element.object_id,
    order_index: element.order_index ?? maxOrder + 1,
    is_primary: true,
  });

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

export async function reorderElements(updates: { id: string; order_index: number }[]) {
  await Promise.all(updates.map(u =>
    supabase.from('elements').update({ order_index: u.order_index }).eq('id', u.id)
  ));
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

  // Sync junction table: replace primary parent
  // Remove old primary parent entry
  await supabase.from('object_parents').delete()
    .eq('object_id', objectId)
    .eq('is_primary', true);
  // Add new primary parent (if not moving to root)
  if (newParentId) {
    await supabase.from('object_parents').upsert({
      object_id: objectId,
      parent_object_id: newParentId,
      order_index: newIndex,
      is_primary: true,
    }, { onConflict: 'object_id,parent_object_id' });
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
// Matrix View - Intersection CRUD
// ============================================

// Get all intersections between row elements and column elements
export async function getIntersections(
  rowElementIds: string[],
  colElementIds: string[]
): Promise<ElementEdge[]> {
  if (rowElementIds.length === 0 || colElementIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('element_edges')
    .select('*')
    .eq('edge_type', 'intersection')
    .in('from_element', rowElementIds)
    .in('to_element', colElementIds);

  if (error) throw error;
  return (data || []) as ElementEdge[];
}

// Create or update an intersection (upsert)
export async function upsertIntersection(
  fromElement: string,
  toElement: string,
  attributes: Record<string, unknown>
): Promise<ElementEdge> {
  // Try to find existing intersection
  const { data: existing } = await supabase
    .from('element_edges')
    .select('*')
    .eq('from_element', fromElement)
    .eq('to_element', toElement)
    .eq('edge_type', 'intersection')
    .single();

  if (existing) {
    // Update existing
    const { data, error } = await supabase
      .from('element_edges')
      .update({ attributes })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data as ElementEdge;
  } else {
    // Create new
    const { data, error } = await supabase
      .from('element_edges')
      .insert({
        from_element: fromElement,
        to_element: toElement,
        edge_type: 'intersection',
        attributes,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ElementEdge;
  }
}

// Delete an intersection
export async function deleteIntersection(
  fromElement: string,
  toElement: string
): Promise<void> {
  const { error } = await supabase
    .from('element_edges')
    .delete()
    .eq('from_element', fromElement)
    .eq('to_element', toElement)
    .eq('edge_type', 'intersection');

  if (error) throw error;
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

// Move document to a new parent (drag and drop)
export async function moveDocument(docId: string, newParentId: string | null): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update({ parent_id: newParentId })
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
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
// Multi-homing: Object Parents CRUD
// ============================================

export async function addObjectParent(objectId: string, parentObjectId: string, isPrimary = false) {
  const { data, error } = await supabase
    .from('object_parents')
    .insert({ object_id: objectId, parent_object_id: parentObjectId, is_primary: isPrimary })
    .select()
    .single();
  if (error) throw error;
  // If setting as primary, sync legacy column
  if (isPrimary) {
    await supabase.from('objects').update({ parent_object_id: parentObjectId }).eq('id', objectId);
  }
  return data;
}

export async function removeObjectParent(objectId: string, parentObjectId: string) {
  // Check if this is the primary parent
  const { data: row } = await supabase
    .from('object_parents')
    .select('is_primary')
    .eq('object_id', objectId)
    .eq('parent_object_id', parentObjectId)
    .single();

  await supabase.from('object_parents').delete()
    .eq('object_id', objectId).eq('parent_object_id', parentObjectId);

  if (row?.is_primary) {
    // Find next parent to promote, or set to null
    const { data: remaining } = await supabase
      .from('object_parents')
      .select('parent_object_id')
      .eq('object_id', objectId)
      .order('created_at', { ascending: true })
      .limit(1);
    const newPrimary = remaining?.[0]?.parent_object_id ?? null;
    await supabase.from('objects').update({ parent_object_id: newPrimary }).eq('id', objectId);
    if (newPrimary) {
      await supabase.from('object_parents').update({ is_primary: true })
        .eq('object_id', objectId).eq('parent_object_id', newPrimary);
    }
  }
}

export async function getObjectParents(objectId: string): Promise<ObjectParent[]> {
  const { data, error } = await supabase
    .from('object_parents')
    .select('*')
    .eq('object_id', objectId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ============================================
// Multi-homing: Element Objects CRUD
// ============================================

export async function addElementToObject(elementId: string, objectId: string, isPrimary = false) {
  const { data, error } = await supabase
    .from('element_objects')
    .insert({ element_id: elementId, object_id: objectId, is_primary: isPrimary })
    .select()
    .single();
  if (error) throw error;
  if (isPrimary) {
    await supabase.from('elements').update({ object_id: objectId }).eq('id', elementId);
  }
  return data;
}

export async function removeElementFromObject(elementId: string, objectId: string) {
  const { data: row } = await supabase
    .from('element_objects')
    .select('is_primary')
    .eq('element_id', elementId)
    .eq('object_id', objectId)
    .single();

  await supabase.from('element_objects').delete()
    .eq('element_id', elementId).eq('object_id', objectId);

  if (row?.is_primary) {
    const { data: remaining } = await supabase
      .from('element_objects')
      .select('object_id')
      .eq('element_id', elementId)
      .order('created_at', { ascending: true })
      .limit(1);
    const newPrimary = remaining?.[0]?.object_id ?? null;
    await supabase.from('elements').update({ object_id: newPrimary }).eq('id', elementId);
    if (newPrimary) {
      await supabase.from('element_objects').update({ is_primary: true })
        .eq('element_id', elementId).eq('object_id', newPrimary);
    }
  }
}

export async function getElementObjects(elementId: string): Promise<ElementObject[]> {
  const { data, error } = await supabase
    .from('element_objects')
    .select('*')
    .eq('element_id', elementId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Cycle detection for object hierarchy
export async function wouldCreateCycle(objectId: string, proposedParentId: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [proposedParentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === objectId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const { data: parents } = await supabase
      .from('object_parents')
      .select('parent_object_id')
      .eq('object_id', current);
    for (const p of (parents || [])) {
      queue.push(p.parent_object_id);
    }
  }
  return false;
}

// ============================================
// Domain CRUD + useDomains hook
// ============================================

export async function createDomain(domain: DomainInsert & { user_id: string }): Promise<Domain> {
  const { data, error } = await supabase
    .from('domains')
    .insert(domain)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDomain(id: string, updates: DomainUpdate): Promise<Domain> {
  const { data, error } = await supabase
    .from('domains')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDomain(id: string): Promise<void> {
  const { error } = await supabase.from('domains').delete().eq('id', id);
  if (error) throw error;
}

export function useDomains() {
  const [data, setData] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDomains = useCallback(async () => {
    try {
      const { data: rows, error: err } = await supabase
        .from('domains')
        .select('*')
        .order('order_index');
      if (err) throw err;
      setData((rows || []) as Domain[]);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  const refetch = useCallback(() => fetchDomains(), [fetchDomains]);

  return { data, loading, error, refetch };
}

// ============================================
// Element comments (Asana-style threaded comments + @mentions)
// ============================================
export async function fetchElementComments(elementId: string): Promise<ElementComment[]> {
  const { data, error } = await supabase
    .from('element_comments')
    .select('*')
    .eq('element_id', elementId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ElementComment[];
}

export async function createElementComment(input: ElementCommentInsert): Promise<ElementComment> {
  const { data, error } = await supabase
    .from('element_comments')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementComment;
}

export async function updateElementComment(id: string, updates: ElementCommentUpdate): Promise<ElementComment> {
  const { data, error } = await supabase
    .from('element_comments')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementComment;
}

export async function deleteElementComment(id: string): Promise<void> {
  const { error } = await supabase.from('element_comments').delete().eq('id', id);
  if (error) throw error;
}

export function useElementComments(elementId: string | null) {
  const [comments, setComments] = useState<ElementComment[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!elementId) { setComments([]); return; }
    setLoading(true);
    try {
      const list = await fetchElementComments(elementId);
      setComments(list);
    } finally { setLoading(false); }
  }, [elementId]);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  return { comments, loading, reload, setComments };
}

// ============================================
// Reactions (emoji on Element OR Comment)
// ============================================
export async function fetchCommentReactions(commentIds: string[]): Promise<ElementReaction[]> {
  if (commentIds.length === 0) return [];
  const { data, error } = await supabase
    .from('element_reactions')
    .select('*')
    .in('comment_id', commentIds);
  if (error) throw error;
  return (data || []) as ElementReaction[];
}

export async function addReaction(input: ElementReactionInsert): Promise<ElementReaction> {
  const { data, error } = await supabase
    .from('element_reactions')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementReaction;
}

export async function removeReaction(reactionId: string): Promise<void> {
  const { error } = await supabase.from('element_reactions').delete().eq('id', reactionId);
  if (error) throw error;
}

export async function toggleReaction(params: {
  userId: string;
  emoji: string;
  elementId?: string | null;
  commentId?: string | null;
}): Promise<'added' | 'removed'> {
  const { userId, emoji, elementId, commentId } = params;
  let q = supabase.from('element_reactions').select('id').eq('user_id', userId).eq('emoji', emoji);
  q = elementId ? q.eq('element_id', elementId) : q.eq('comment_id', commentId!);
  const { data: existing } = await q.maybeSingle();
  if (existing) {
    await removeReaction(existing.id);
    return 'removed';
  }
  await addReaction({
    user_id: userId,
    emoji,
    element_id: elementId ?? null,
    comment_id: commentId ?? null,
  });
  return 'added';
}

// ============================================
// Notifications (Inbox)
// ============================================
export async function fetchNotifications(opts: {
  recipientId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', opts.recipientId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (opts.unreadOnly) q = q.eq('is_read', false);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Notification[];
}

export async function createNotification(input: NotificationInsert): Promise<Notification | null> {
  const { data, error } = await supabase
    .from('notifications')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    console.error('createNotification failed:', error);
    return null;
  }
  return data as Notification;
}

export async function markNotificationRead(id: string, isRead = true): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: isRead })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', recipientId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function archiveNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_archived: true })
    .eq('id', id);
  if (error) throw error;
}

export function useNotifications(recipientId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!recipientId) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    try {
      const list = await fetchNotifications({ recipientId });
      setNotifications(list);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [recipientId]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime
  useEffect(() => {
    if (!recipientId) return;
    const channel = supabase
      .channel(`notifications:${recipientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
        () => { reload(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [recipientId, reload]);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  return { notifications, unreadCount, loading, reload, setNotifications };
}

export async function notifyMany(
  recipients: string[],
  payload: Omit<NotificationInsert, 'recipient_id'>
): Promise<void> {
  const unique = Array.from(new Set(recipients.filter(Boolean)));
  if (unique.length === 0) return;
  const rows = unique.map(rid => ({ ...payload, recipient_id: rid }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('notifyMany failed:', error);
}

// ============================================
// Approvals
// ============================================
export async function fetchElementApprovals(elementId: string): Promise<ElementApproval[]> {
  const { data, error } = await supabase
    .from('element_approvals')
    .select('*')
    .eq('element_id', elementId)
    .order('decided_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ElementApproval[];
}

export async function decideApproval(input: ElementApprovalInsert): Promise<ElementApproval> {
  const { data, error } = await supabase
    .from('element_approvals')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementApproval;
}

export async function setElementIsApproval(elementId: string, isApproval: boolean): Promise<void> {
  const updates: Partial<{ is_approval: boolean; approval_state: ApprovalState | null }> = {
    is_approval: isApproval,
  };
  if (isApproval) updates.approval_state = 'pending';
  else updates.approval_state = null;
  const { error } = await supabase.from('elements').update(updates).eq('id', elementId);
  if (error) throw error;
}

// ============================================
// Time entries
// ============================================
export async function fetchTimeEntries(elementId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('element_id', elementId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntry[];
}

export async function getRunningTimer(userId: string): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as TimeEntry | null;
}

export async function stopTimer(id: string): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function startTimer(input: { elementId: string; userId: string; userName?: string | null }): Promise<TimeEntry> {
  const running = await getRunningTimer(input.userId);
  if (running) await stopTimer(running.id);
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      element_id: input.elementId,
      user_id: input.userId,
      user_name: input.userName ?? null,
      started_at: new Date().toISOString(),
    } satisfies TimeEntryInsert)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function logTime(input: {
  elementId: string;
  userId: string;
  userName?: string | null;
  durationSec: number;
  note?: string | null;
}): Promise<TimeEntry> {
  const now = new Date();
  const started = new Date(now.getTime() - input.durationSec * 1000);
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      element_id: input.elementId,
      user_id: input.userId,
      user_name: input.userName ?? null,
      started_at: started.toISOString(),
      ended_at: now.toISOString(),
      duration_sec: input.durationSec,
      note: input.note ?? null,
    } satisfies TimeEntryInsert)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const { error } = await supabase.from('time_entries').delete().eq('id', id);
  if (error) throw error;
}

export async function updateTimeEntry(id: string, updates: TimeEntryUpdate): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

// ============================================
// Global Search (⌘K) — searches Elements, Objects, Notes, Briefs
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'brief';
  id: string;
  title: string;
  snippet?: string | null;
  objectId?: string | null;
}

export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const [elementsRes, objectsRes, notesRes, briefsRes] = await Promise.all([
    supabase
      .from('elements')
      .select('id, title, description, object_id')
      .or(`title.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('objects')
      .select('id, name, description')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('notes')
      .select('id, title, parent_id')
      .ilike('title', like)
      .limit(limit),
    supabase
      .from('briefs')
      .select('id, title, summary')
      .or(`title.ilike.${like},summary.ilike.${like}`)
      .limit(limit),
  ]);

  const out: SearchResult[] = [];
  for (const r of (elementsRes.data || [])) {
    out.push({ kind: 'element', id: r.id, title: r.title, snippet: r.description, objectId: r.object_id });
  }
  for (const r of (objectsRes.data || [])) {
    out.push({ kind: 'object', id: r.id, title: r.name, snippet: r.description });
  }
  for (const r of (notesRes.data || [])) {
    out.push({ kind: 'note', id: r.id, title: r.title || 'Untitled' });
  }
  for (const r of (briefsRes.data || [])) {
    out.push({ kind: 'brief', id: r.id, title: r.title || 'Untitled', snippet: r.summary });
  }
  return out;
}

