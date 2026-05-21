'use client';

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement, createElement, useDomains } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { NavDomainIcon, NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { QuickAddElementPopup } from '@/alcon/element/QuickAddElementPopup';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import type { NavigationState } from '@/types/navigation';

interface ElementsByObjectViewProps {
  explorerData?: ExplorerData;
  onRefresh?: () => void;
  activeDomainId?: string | null;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/**
 * Domain-wide Elements view. Renders every Object's Elements as
 * collapsible sections via the shared `ObjectListView` so the row
 * markup, hover styles, and column toggles stay in lockstep with the
 * Domain Object list and Object-detail Elements tab.
 *
 * The page only owns the toolbar, the empty-state, the Element-detail
 * drill-in, and the Domain-direct quick-add popup.
 */
export function ElementsByObjectView({ explorerData, onRefresh, activeDomainId, onNavigate, onViewChange }: ElementsByObjectViewProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Section-aware quick-add: null = Domain-direct, otherwise the target Object.
  const [quickAddTargetObjectId, setQuickAddTargetObjectId] = useState<string | null>(null);
  const [quickAddLabel, setQuickAddLabel] = useState<string | null>(null);

  // Active Domain — used as the popup's context label so users see which
  // Domain a Domain-direct Element will be created under.
  const { data: domains } = useDomains();
  const activeDomainName = useMemo(() => {
    const id = activeDomainId ?? null;
    return id ? domains.find((d) => d.id === id)?.name ?? null : null;
  }, [domains, activeDomainId]);

  const objectsWithElements = useMemo<AlconObjectWithChildren[]>(() => {
    if (!explorerData) return [];
    return explorerData.objects.filter((o) => (o.elements?.length ?? 0) > 0);
  }, [explorerData]);

  const domainElements = explorerData?.rootElements ?? [];

  const sections = useMemo<ListSection[]>(() => {
    const out: ListSection[] = [];
    if (domainElements.length > 0) {
      out.push({
        id: '__domain__',
        name: 'Domain',
        icon: <NavDomainIcon size={16} />,
        objects: [],
        elements: domainElements,
      });
    }
    for (const obj of objectsWithElements) {
      out.push({
        id: obj.id,
        name: obj.name,
        icon: <ObjectIcon size={14} />,
        objects: [],
        elements: obj.elements ?? [],
      });
    }
    return out;
  }, [domainElements, objectsWithElements]);

  const allElementsForLookup = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const sec of sections) for (const el of sec.elements ?? []) m.set(el.id, el);
    return m;
  }, [sections]);

  const detailElement = detailId ? allElementsForLookup.get(detailId) ?? null : null;
  const detailObject = detailElement?.object_id
    ? explorerData?.objects.find((obj) => obj.id === detailElement.object_id) ?? null
    : null;

  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        domainName={activeDomainName}
        objectPath={detailObject ? [{ id: detailObject.id, name: detailObject.name }] : []}
        onBack={() => setDetailId(null)}
        onRefresh={onRefresh}
        onNavigateRoot={() => {
          setDetailId(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId: null });
        }}
        onNavigateObject={(id) => {
          setDetailId(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId: id });
        }}
      />
    );
  }

  // Each section header has its own + button now. The Domain section's +
  // (and the header's + / empty-state CTA) creates Domain-direct Elements;
  // an Object section's + creates Elements under that Object. The popup
  // accepts multiple titles per submit (paste-many) regardless of target.
  const openQuickAddDomain = () => {
    setQuickAddTargetObjectId(null);
    setQuickAddLabel(activeDomainName ?? 'Domain');
    setQuickAddOpen(true);
  };
  const openQuickAddForSection = (section?: ListSection) => {
    if (!section || section.id === '__domain__') {
      openQuickAddDomain();
      return;
    }
    setQuickAddTargetObjectId(section.id);
    setQuickAddLabel(section.name);
    setQuickAddOpen(true);
  };

  const handleQuickAddSubmit = async (titles: string[]) => {
    const targetObjectId = quickAddTargetObjectId;
    for (const title of titles) {
      try {
        await createElement({ title, object_id: targetObjectId });
      } catch (e) { console.error('Failed to create Element', e); }
    }
    await onRefresh?.();
  };

  const handleElementUpdate = async (
    elementId: string,
    updates: Parameters<typeof updateElement>[1],
  ) => {
    try {
      await updateElement(elementId, updates);
      await onRefresh?.();
    } catch (e) { console.error('Failed to update element', e); }
  };

  const isEmpty = sections.length === 0;

  if (isEmpty) {
    // Empty state owns the pane — same 4-icon + heading + CTA pattern as the
    // Domain Objects / Object Elements empty states. Toolbar is suppressed so
    // the centered Create Element button is the only affordance.
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ElementsHierarchyHeader
          domainName={activeDomainName ?? 'Domain'}
          onDomainClick={() => {
            onViewChange?.('projects');
            onNavigate?.({ objectId: null });
          }}
        />
        <ElementsDomainEmptyState onAdd={openQuickAddDomain} />
        <QuickAddElementPopup
          open={quickAddOpen}
          contextLabel={quickAddLabel ?? activeDomainName ?? 'Domain'}
          onClose={() => setQuickAddOpen(false)}
          onSubmit={handleQuickAddSubmit}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ElementsHierarchyHeader
        domainName={activeDomainName ?? 'Domain'}
        onDomainClick={() => {
          onViewChange?.('projects');
          onNavigate?.({ objectId: null });
        }}
      />

      <div className="flex-1 overflow-auto">
        <ObjectListView
          sections={sections}
          onSelectObject={() => { /* sections never carry Objects here */ }}
          onSelectElement={(id) => setDetailId(id)}
          onElementUpdate={handleElementUpdate}
          onAddElement={openQuickAddForSection}
          colStorageKey="domain-elements"
        />
      </div>

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel={quickAddLabel ?? activeDomainName ?? 'Domain'}
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAddSubmit}
      />
    </div>
  );
}

function ElementsHierarchyHeader({
  domainName,
  onDomainClick,
}: {
  domainName: string;
  onDomainClick?: () => void;
}) {
  return (
    <div className="h-10 flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <button
        type="button"
        onClick={onDomainClick}
        className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground truncate max-w-[220px] transition-colors hover:text-foreground hover:bg-muted/40"
      >
        {domainName}
      </button>
    </div>
  );
}

function ElementsDomainEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavMyTasksIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Elements to this Domain</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        Domain-direct Elements live at the top level. Open an Object to add Elements there.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
