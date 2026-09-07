'use client';

import { useExplorerData } from '@/alcon/shared/ExplorerDataContext';

import { useWorkspaceActions } from '@/shell/WorkspaceActionsContext';

import React, { useEffect, useState } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, Worker } from '@/hooks/useSupabase';
import { updateObject, addDomainObjectType, fetchAllWorkers, useDomains } from '@/hooks/useSupabase';
import { applyObjectFilter, orderObjects, DEFAULT_STATE, type ListControlsState } from '@/alcon/shared/listControls';
import { getActiveDomainId } from '@/alcon/domain/domainsStore';
import { hydrateLabelColors } from '@/alcon/shared/labelColor';
import { useElementSelection } from '@/alcon/element/useElementSelection';
import { NavObjectsIcon } from '@/shell/sidebar/NavIcons';
import { Plus } from 'lucide-react';
import { ListTable, type ListSection } from '@/alcon/object/ListTable';

// Objects are a flat list within the Domain.

export function findObjectById(objects: AlconObjectWithChildren[], objectId: string): AlconObjectWithChildren | null {
  return objects.find(o => o.id === objectId) ?? null;
}

/** Flattens every Object's Elements into one list for Domain-wide aggregate
 *  views (Board / Calendar / …). A multi-homed Element surfaces in each
 *  Object it belongs to, so a plain flatMap counts it once per home — dedupe
 *  by id or the same row collides with itself (e.g. a duplicate React key
 *  in a status column that only groups by status, not by home). */
export function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  const seen = new Set<string>();
  const out: ElementWithDetails[] = [];
  for (const el of objects.flatMap(o => o.elements ?? [])) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    out.push(el);
  }
  return out;
}

export function findObjectInExplorerData(explorerData: ExplorerData, objectId: string): AlconObjectWithChildren | null {
  return findObjectById(explorerData.objects, objectId);
}

export function ObjListView({
  onSelect,
  onRefresh,
  controls,
}: {
  onSelect: (objectId: string) => void;
  onRefresh?: () => void;
  /** Filter / Display state, owned by DomainView so the controls UI can
   *  live inline in the TabBar. When omitted, falls back to defaults. */
  controls?: ListControlsState;
}) {
  const explorerData = useExplorerData();
  const objects = explorerData.objects;
  const domainId = getActiveDomainId();
  // Reuse the element-selection hook for Objects too — the logic is just
  // id-based multi-select with Shift-range and Esc-to-clear, doesn't care
  // whether the ids belong to Elements or Objects.
  const { selectedRowIds: selectedObjectIds, handleRowSelect: handleObjectRowSelect } = useElementSelection();
  const { data: domains } = useDomains();
  // Object (Project-level) Type catalog — its OWN list, never the Element
  // (Task-level) one, so "Task" can't show up as an Object Type.
  const objectTypes = React.useMemo<string[]>(
    () => (domainId ? domains.find((d) => d.id === domainId)?.object_types ?? [] : []),
    [domains, domainId],
  );
  // Assignable Workers for the Lead column picker (resolves lead_id → name +
  // the dropdown options). Fetched once per Domain.
  const [leadWorkers, setLeadWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    fetchAllWorkers(domainId).then(setLeadWorkers).catch((e) => console.error('Failed to load workers', e));
  }, [domainId]);
  // Feed the Domain's Label colour catalogue into the shared store so chips
  // render the picked colours.
  const activeDomain = domainId ? domains.find((d) => d.id === domainId) : undefined;
  useEffect(() => {
    if (activeDomain) hydrateLabelColors(activeDomain.id, activeDomain.label_colors);
  }, [activeDomain]);
  const effectiveControls = controls ?? DEFAULT_STATE;
  if (objects.length === 0) {
    // h-full (not flex-1) so the pane fills the full height even though the
    // parent (DomainTabContent) isn't a flex column — centers the empty state
    // in the whole page.
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <ObjectsEmptyState />
      </div>
    );
  }

  // Filter + order via the controls passed in from DomainView. The buttons
  // themselves are rendered inline in the TabBar (DomainView).
  const filteredObjects = orderObjects(applyObjectFilter(objects, effectiveControls.filter), effectiveControls.display);

  // No synthetic section header at the Domain root — sections are gone.
  // Top-level Objects render flat under the column header, with the Add
  // Object footer at the bottom.
  const sections: ListSection[] = [
    { id: '_objects_root', name: '', objects: filteredObjects },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card">
      <div className="flex-1 overflow-auto">
        <ListTable
          sections={sections}
          entity="object"
          onSelectObject={onSelect}
          hideSectionHeaders
          colStorageKey="domain"
          elementTypes={objectTypes}
          onAddType={domainId ? async (name) => {
            try { await addDomainObjectType(domainId, name); await onRefresh?.(); }
            catch (e) { console.error('Failed to add type:', e); }
          } : undefined}
          onObjectUpdate={async (objectId, updates) => {
            try {
              await updateObject(objectId, updates);
              await onRefresh?.();
            } catch (e) {
              console.error('Failed to update object:', e);
            }
          }}
          objectWorkers={leadWorkers}
          selectedObjectIds={selectedObjectIds}
          onObjectRowSelect={handleObjectRowSelect}
        />
      </div>

    </div>
  );
}

function ObjectsEmptyState() {
  const { openCreate } = useWorkspaceActions();
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavObjectsIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Objects to this Domain</h2>
      <p className="text-[13px] text-muted-foreground text-left max-w-xs mb-2">
        Objects are mid-level structural units — projects, departments, or any container you want to organise.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-left max-w-xs mb-6">
        Objects live directly under a Domain (no nesting) and can be shared across multiple Domains.
      </p>
      <button
        onClick={() => openCreate('object')}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--rail-active)] text-white text-[13px] font-medium hover:brightness-110 transition"
      >
        <Plus size={14} />
        Create Object
      </button>
    </div>
  );
}
