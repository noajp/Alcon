// What a Space shows (ADR 0048). A 'full' Space shows everything; an
// 'audit' Space shows the Space itself, its People and the AI Audit — the
// views below — and nothing of Strategy or Execution. The scope narrows
// what can be reached, not what is stored: switching to 'full' brings back
// whatever the Space already holds.

export type SpaceScope = 'audit' | 'full';

/** The views an audit Space can reach. Settings and Profile are the
 *  person's and the Space's own; Inbox carries the approvals Audit asks for. */
const AUDIT_VIEWS: ReadonlySet<string> = new Set(['audit', 'team', 'inbox', 'profile', 'settings']);

/** Where an audit Space lands when asked for a view it does not show. */
const AUDIT_HOME_VIEW = 'audit';

/** The settings pages an audit Space shows: the Space, its members and
 *  integrations, People, and the person's own. */
const AUDIT_SETTINGS: ReadonlySet<string> = new Set([
  'workspace', 'members', 'integrations', 'team',
  'preferences', 'profile', 'notifications', 'security', 'connected',
]);

export function spaceScope(value: unknown): SpaceScope {
  return value === 'audit' ? 'audit' : 'full';
}

export function viewInScope(view: string, scope: SpaceScope): boolean {
  return scope === 'full' || AUDIT_VIEWS.has(view);
}

/** The view to show for a request: the one asked for, or the audit home. */
export function scopedView(view: string, scope: SpaceScope): string {
  return viewInScope(view, scope) ? view : AUDIT_HOME_VIEW;
}

export function settingsInScope(id: string, scope: SpaceScope): boolean {
  return scope === 'full' || AUDIT_SETTINGS.has(id);
}
