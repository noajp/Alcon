'use client';


import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useWorkspaceActions } from '@/Frame/WorkspaceActionsContext';

import React, { useEffect, useState } from 'react';
import type { ClaywareObjectWithChildren, ElementWithDetails, ExplorerData, Worker } from '@/hooks/useSupabase';
import { updateObject, addDomainObjectType, fetchAllWorkers, useDomains } from '@/hooks/useSupabase';
import { applyObjectFilter, orderObjects, DEFAULT_STATE, type ListControlsState } from '@/Function/shared/listControls';
import { getActiveDomainId, CREATE_DOMAIN_EVENT } from '@/Function/space/domainsStore';
import { hydrateLabelColors } from '@/Function/shared/labelColor';
import { EmptyState } from '@/Function/shared/EmptyState';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { deleteDomain, useDomainRole } from '@/hooks/domainData';
import { ListTable } from '@/Function/shared/listTable/ListTable';
import type { ListSection } from '@/Function/shared/listTable/shared';
import { ArchivedObjectsSection } from '@/ActivitySpace/execution/object/ArchivedObjects';

// Objects are a flat list within the Domain.

function findObjectById(objects: ClaywareObjectWithChildren[], objectId: string): ClaywareObjectWithChildren | null {
  return objects.find(o => o.id === objectId) ?? null;
}

/** Flattens every Object's Elements into one list for Domain-wide aggregate
 *  views (Board / Calendar / …). A multi-homed Element surfaces in each
 *  Object it belongs to, so a plain flatMap counts it once per home — dedupe
 *  by id or the same row collides with itself (e.g. a duplicate React key
 *  in a status column that only groups by status, not by home). */
export function collectAllElements(objects: ClaywareObjectWithChildren[]): ElementWithDetails[] {
  const seen = new Set<string>();
  const out: ElementWithDetails[] = [];
  for (const el of objects.flatMap(o => o.elements ?? [])) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    out.push(el);
  }
  return out;
}

export function findObjectInExplorerData(explorerData: ExplorerData, objectId: string): ClaywareObjectWithChildren | null {
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
  const { data: domains, guestDomains, loading: domainsLoading } = useDomains();
  // An Object needs a Domain to live in, so a Space without one asks for that first.
  const noDomains = !domainsLoading && domains.length === 0 && guestDomains.length === 0;
  // Object (Project-level) Type catalog — its OWN list, never the Element
  // Element-level one, so it cannot show up as an Object Type.
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
        <div className="flex-1 min-h-0">
          {noDomains ? <NoDomainEmptyState /> : <ObjectsEmptyState />}
        </div>
        <ArchivedObjectsSection domainId={domainId} onOpen={onSelect} />
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
          density={effectiveControls.display.density}
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
        />
        <ArchivedObjectsSection domainId={domainId} onOpen={onSelect} />
      </div>

    </div>
  );
}

function ObjectsEmptyState() {
  const { openCreate } = useWorkspaceActions();
  const { t } = useI18n();
  const domainId = getActiveDomainId();
  const role = useDomainRole(domainId ?? null);
  const { data: domains } = useDomains();
  const domain = domains.find((d) => d.id === domainId);
  // A Domain with nothing in it can be removed from here. Only its owner may
  // (the database says so too); one that still holds Objects, archived ones
  // included, is refused with the count.
  const remove = async () => {
    if (!domain) return;
    if (!await appDialog.confirm(t('Delete “{name}”? This can’t be undone.', { name: domain.name }))) return;
    try { await deleteDomain(domain.id); }
    catch (e) { await appDialog.alert(e instanceof Error && e.message ? e.message : t('The Domain could not be deleted. Try again.')); }
  };
  return (
    <EmptyState
      art="objects"
      title="Add Objects to this Domain"
      description="Objects are mid-level structural units — projects, departments, or any container you want to organise."
      cta="Create Object"
      onCta={() => openCreate('object')}
      secondary={role.data === 'owner' && domain ? { label: 'Delete', variant: 'destructive', onClick: () => { void remove(); } } : undefined}
    />
  );
}

function NoDomainEmptyState() {
  return (
    <EmptyState
      art="domain"
      title="Create your first Domain"
      description="A Domain is where work happens — a company, a department, or a project portfolio. Objects and Elements live inside it."
      cta="Create Domain"
      onCta={() => { window.dispatchEvent(new CustomEvent(CREATE_DOMAIN_EVENT)); }}
    />
  );
}
