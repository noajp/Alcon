'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { InitiativeRiskView } from '@/ActivitySpace/strategy/initiative/InitiativeRisk';
import { useInitiativeRisk } from '@/ActivitySpace/strategy/initiative/useInitiativeRisk';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { STATUS } from '@/shared/designTokens';
import { formatElementDate, parseDateOnly } from '@/Function/shared/dateUtils';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetHost } from '../types';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';

const ElementDetailView = dynamic(() => import('@/ActivitySpace/execution/element/ElementDetailView').then((m) => m.ElementDetailView), {
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading Element…</p>,
});

/** Risk and load are calculated from the Elements edited through this same surface. */
export function InitiativeRiskWidget({ host }: { host: WidgetHost }) {
  const initiativeId = host.subject.id ?? '';
  const { report, busFactor, elements, objects, loading, error, refetch } = useInitiativeRisk(initiativeId);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = elements.find((element) => element.id === selectedId);
  const selectedObject = objects.find((object) => object.id === selected?.object_id);
  const query = search.trim().toLocaleLowerCase();
  const visible = elements.filter((element) => !query || `${element.display_id ?? ''} ${element.title}`.toLocaleLowerCase().includes(query));
  const refresh = () => { refetch(); host.onRefresh?.(); };
  const close = () => setSelectedId(null);
  const openObject = (objectId: string, domainId?: string | null) => {
    close();
    host.onNavigate?.({ objectId, domainId });
  };

  useWidgetMeta(report && report.openTotal > 0 ? `${report.openTotal} open` : null);

  return (
    <>
      <WidgetHeaderAction>
        <Button variant="ghost" size="xs" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? 'Hide Elements' : 'Edit Elements'}
        </Button>
      </WidgetHeaderAction>
      <InitiativeRiskView
        report={report}
        busFactor={busFactor}
        loading={loading}
        error={error}
        onOpenObject={(objectId, domainId) => openObject(objectId, domainId)}
      />
      {error && <Button variant="ghost" size="sm" onClick={refresh}>Retry</Button>}
      {editing && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Open an Element to change its assignees, dates, or status. Manage Elements in an Object to add or remove work.
          </p>
          {objects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {objects.map((object) => (
                <Button key={object.id} variant="secondary" size="sm" disabled={!host.onNavigate}
                  onClick={() => openObject(object.id, object.domain_id)}>
                  <span className="truncate">Manage {object.name}</span>
                </Button>
              ))}
            </div>
          )}
          <input aria-label="Find source Elements" placeholder="Find an Element…" value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-full rounded-md bg-muted/40 px-2 text-sm focus:bg-muted/60" />
          <div className="max-h-80 overflow-y-auto">
            {visible.map((element) => (
              <Button key={element.id} variant="ghost" size="sm" align="start"
                className="h-auto min-h-8 w-full flex-wrap justify-start py-2"
                onClick={() => setSelectedId(element.id)}>
                {/* Id and title share one shrinkable span on purpose. This
                    Button wraps (flex-wrap) and its other children have no
                    min-w-0, so a separate shrink-0 id chip would make the
                    title absorb every deficit — measured down to 18px — and
                    push the row onto a second line under ~320px. The list
                    surfaces use DisplayIdChip; here the id is prose. */}
                <span className="min-w-0 flex-1 truncate">{displayIdOf(element) ? `${displayIdOf(element)} · ` : ''}{element.title}</span>
                <span className={`text-xs ${STATUS[element.status ?? 'todo'].color}`}>{STATUS[element.status ?? 'todo'].label}</span>
                <span className="text-xs text-muted-foreground">{formatElementDate(parseDateOnly(element.due_date)) ?? 'No due date'}</span>
                <span className="max-w-40 truncate text-xs text-muted-foreground">
                  {(element.assignees ?? []).map((assignee) => assignee.worker?.name ?? 'Unknown Worker').join(', ') || 'Unassigned'}
                </span>
              </Button>
            ))}
            {!loading && !error && visible.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                {elements.length ? 'No matching Elements.' : objects.length ? 'No Elements yet. Open an Object above to add work.' : 'Link an Object to this Initiative to add and manage its Elements.'}
              </p>
            )}
          </div>
        </div>
      )}
      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="flex h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-6xl" aria-describedby={undefined} showCloseButton={false}>
          <DialogTitle className="sr-only">Edit source Element</DialogTitle>
          {selected ? (
            <ElementDetailView key={selected.id} element={selected} objectName={selectedObject?.name}
              objectPath={selectedObject ? [{ id: selectedObject.id, name: selectedObject.name }] : []}
              onBack={close} onNavigateRoot={close} onRefresh={refresh}
              onNavigateObject={(objectId) => openObject(objectId, objects.find((object) => object.id === objectId)?.domain_id)}
              onOpenStrategy={(strategyId) => { close(); host.onNavigate?.({ strategyId }); }} />
          ) : (
            <div className="space-y-2 p-4">
              <p className="text-sm">This Element is no longer available in this Initiative.</p>
              <Button variant="ghost" size="sm" onClick={close}>Back to Initiative</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
