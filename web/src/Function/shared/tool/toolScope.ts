'use client';

import { useCallback, useSyncExternalStore } from 'react';

// =============================================================
// Whose records a Sustainment tool shows — its scope.
//
// A tool's records belong to a Domain or to the Space (the CRM's pipelines,
// companies and contacts carry a `domain_id`), so a tool is read through
// three scopes:
//
//   null      everything the viewer can see
//   'space'   the records shared by the Space (no Domain)
//   <id>      one Domain's records
//
// The choice is the viewer's and lasts, the way the active Domain does:
// kept per tool in localStorage, shared by the tool's sidebar and pages.
// =============================================================

export type ToolApp = 'crm' | 'audit';
export type ToolScope = string | null;
export const SPACE_SCOPE = 'space';

const key = (app: ToolApp) => `alcon:tool-scope:${app}`;
const EVENT = 'alcon:tool-scope-change';

/** The stored scope, made valid against what can be chosen now: a Domain the
 *  viewer can no longer see (or one from another Space) falls back to all. */
export function resolveToolScope(stored: string | null, domainIds: readonly string[]): ToolScope {
  if (stored === null || stored === '') return null;
  if (stored === SPACE_SCOPE) return SPACE_SCOPE;
  return domainIds.includes(stored) ? stored : null;
}

function read(app: ToolApp): string | null {
  try { return window.localStorage.getItem(key(app)); } catch { return null; }
}

function setToolScope(app: ToolApp, scope: ToolScope) {
  try {
    if (scope === null) window.localStorage.removeItem(key(app));
    else window.localStorage.setItem(key(app), scope);
  } catch { /* the choice lasts this page load */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: app }));
}

function subscribe(onChange: () => void) {
  const handler = () => onChange();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener('storage', handler); };
}

/** The tool's scope and its setter. `domainIds` are the Domains that can be
 *  chosen; a stored scope outside them reads as everything. */
export function useToolScope(app: ToolApp, domainIds: readonly string[]): [ToolScope, (scope: ToolScope) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(app), () => null);
  const set = useCallback((scope: ToolScope) => setToolScope(app, scope), [app]);
  return [resolveToolScope(stored, domainIds), set];
}

/** Whether a record with this Domain is inside the scope. */
export function inToolScope(scope: ToolScope, domainId: string | null | undefined): boolean {
  if (scope === null) return true;
  if (scope === SPACE_SCOPE) return !domainId;
  return domainId === scope;
}
