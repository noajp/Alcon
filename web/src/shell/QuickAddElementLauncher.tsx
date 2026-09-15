'use client';

import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QuickAddElementPopup, type NewElementInput } from '@/ActivitySpace/execution/element/QuickAddElementPopup';
import {
  addElementAssignee,
  createElement,
  fetchAllWorkers,
  useDomains,
  type Worker,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { getQueryClient } from '@/lib/queryClient';

// Last Object an Element was quick-added to — pressing C on a screen with no
// Object context (Home, Notes, …) targets this Object again.
const LAST_OBJECT_KEY = 'alcon.quickAddElement.lastObjectId';

// Mirrors the alcon:create-object / alcon:create-domain / alcon:create-space
// convention (ObjectsView.tsx, domainsStore.ts, activeSpaceStore.ts) — lets
// an external caller (⌘K's Create group) raise this popup without a prop or
// a real keypress.
export const CREATE_ELEMENT_EVENT = 'alcon:create-element';
/** Optional detail on CREATE_ELEMENT_EVENT — the Calendar's "+" presets the
 *  day the grid is on. */
export interface CreateElementDetail { dueDate?: string | null }

function readLastObjectId(): string | null {
  try { return localStorage.getItem(LAST_OBJECT_KEY); } catch { return null; }
}
function writeLastObjectId(id: string) {
  try { localStorage.setItem(LAST_OBJECT_KEY, id); } catch { /* ignore */ }
}

// True while the user is typing somewhere — a single-letter shortcut must
// never steal keystrokes from a text field.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// True while any dialog / menu-style overlay is open (⌘K palette, modals,
// dropdown menus, pickers). Radix unmounts closed overlays, so DOM presence
// means "open".
function hasOpenOverlay(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

interface QuickAddElementLauncherProps {
  activeDomainId: string;
  /** Object the visible screen is scoped to (Object detail open in the
   *  active tab), or null when the screen has no Object context. */
  contextObjectId: string | null;
  onRefresh?: () => void | Promise<void>;
}

/**
 * Global "C → new Element" — press C anywhere (outside text fields and open
 * overlays) to raise the QuickAddElementPopup, mirroring CommandPalette's
 * ⌘K window listener. The save target resolves to the Object in view when
 * there is one, else the last quick-added Object; the popup's "Save to" pill
 * can always re-point it (incl. My Elements / Domain-direct).
 */
export function QuickAddElementLauncher({
  activeDomainId,
  contextObjectId,
  onRefresh,
}: QuickAddElementLauncherProps) {
  const explorerData = useExplorerData();
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  // Save target resolved at press time (context Object → last-used Object →
  // none) so the popup's reset-on-open lands on the right "Save to" value.
  const [defaultObjectId, setDefaultObjectId] = useState<string | null>(null);
  // Due date handed in by the opener (the Calendar's "+"); null for a plain C.
  const [presetDueDate, setPresetDueDate] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const { data: domains } = useDomains();

  const objectIds = useMemo(
    () => new Set((explorerData?.objects ?? []).map((o) => o.id)),
    [explorerData],
  );

  // Resolves the save target (context Object → last-used Object → none) and
  // raises the popup. Shared by the physical `C` key and the programmatic
  // CREATE_ELEMENT_EVENT below.
  const openQuickAdd = useCallback((detail?: CreateElementDetail) => {
    setPresetDueDate(detail?.dueDate ?? null);
    const last = readLastObjectId();
    setDefaultObjectId(
      contextObjectId && objectIds.has(contextObjectId)
        ? contextObjectId
        : last && objectIds.has(last) ? last : null,
    );
    setOpen(true);
  }, [contextObjectId, objectIds]);

  // C single-key open — same window-keydown shape (incl. cleanup) as the
  // CommandPalette ⌘K toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return; // C alone, not a chord
      if (e.isComposing) return;                                    // mid-IME composition
      if (isTypingTarget(e.target)) return;                         // typing in a field
      if (hasOpenOverlay()) return;                                 // palette / modal / menu open
      e.preventDefault();
      openQuickAdd();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openQuickAdd]);

  // Programmatic open (⌘K's "New Element" Create command) — bypasses the
  // typing/overlay guards above since it isn't a real keystroke; the caller
  // (CommandPalette) has already closed itself before dispatching.
  useEffect(() => {
    const handler = (e: Event) => openQuickAdd((e as CustomEvent<CreateElementDetail>).detail ?? undefined);
    window.addEventListener(CREATE_ELEMENT_EVENT, handler);
    return () => window.removeEventListener(CREATE_ELEMENT_EVENT, handler);
  }, [openQuickAdd]);

  // Fetch the active Domain's workers when the popup opens (lazy — keeps the
  // first paint cheap; same pattern as the Object quick-add popup).
  useEffect(() => {
    if (!open) return;
    fetchAllWorkers(activeDomainId || null)
      .then(setWorkers)
      .catch((e) => console.error('Failed to load workers for Element popup', e));
  }, [open, activeDomainId]);

  // Domain-shared Element types for the Type pill.
  const elementTypes = useMemo<string[]>(
    () => (activeDomainId ? domains.find((d) => d.id === activeDomainId)?.element_types ?? [] : []),
    [domains, activeDomainId],
  );

  // Known labels — distinct values across the Domain's Elements (same
  // derivation as the list surfaces).
  const availableLabels = useMemo<string[]>(() => {
    if (!explorerData) return [];
    const s = new Set<string>();
    for (const el of explorerData.rootElements) for (const l of el.labels ?? []) s.add(l);
    for (const obj of explorerData.objects) {
      for (const el of obj.elements ?? []) for (const l of el.labels ?? []) s.add(l);
    }
    return Array.from(s).sort();
  }, [explorerData]);

  const objectOptions = useMemo<{ id: string; name: string }[]>(
    () => (explorerData?.objects ?? []).map((o) => ({ id: o.id, name: o.name })),
    [explorerData],
  );

  const contextLabel = defaultObjectId
    ? objectOptions.find((o) => o.id === defaultObjectId)?.name
    : domains.find((d) => d.id === activeDomainId)?.name ?? undefined;

  // Same three save scopes as the list views' quick-add handlers:
  // personal (owner_id = me) / Object / Domain-direct (object_id = null).
  const handleSubmit = async (inputs: NewElementInput[]) => {
    for (const input of inputs) {
      try {
        const created = await createElement({
          title: input.title,
          object_id: input.personal ? null : input.objectId ?? null,
          owner_id: input.personal ? userId : null,
          description: input.description ?? null,
          type: input.type ?? null,
          status: input.status ?? undefined,
          priority: input.priority ?? undefined,
          due_date: presetDueDate ?? undefined,
        });
        for (const wid of input.assigneeWorkerIds ?? []) {
          try {
            await addElementAssignee({ element_id: created.id, worker_id: wid, role: 'assignee' });
          } catch (e) { console.warn('Could not assign Element:', e); }
        }
      } catch (e) { console.error('Failed to create Element', e); }
    }
    // Remember the landing Object so the next context-less C targets it too.
    const first = inputs[0];
    if (first && !first.personal && first.objectId) writeLastObjectId(first.objectId);
    // The Calendar and My Elements read react-query caches, not the Domain
    // refetch below — drop them so a just-added Element shows at once.
    const qc = getQueryClient();
    void qc.invalidateQueries({ queryKey: ['my-elements'] });
    void qc.invalidateQueries({ queryKey: ['explorer'] });
    await onRefresh?.();
  };

  return (
    <QuickAddElementPopup
      open={open}
      contextLabel={contextLabel}
      hint={presetDueDate ? `Due ${presetDueDate}` : undefined}
      onClose={() => setOpen(false)}
      onSubmit={handleSubmit}
      types={elementTypes}
      workers={workers.map((w) => ({ id: w.id, name: w.name, avatar_url: w.avatar_url }))}
      objects={objectOptions}
      availableLabels={availableLabels}
      defaultObjectId={defaultObjectId}
      canSaveToPersonal
    />
  );
}
