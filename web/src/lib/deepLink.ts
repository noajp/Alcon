import { useSyncExternalStore } from 'react';
import type { NavigationState } from '@/types/navigation';

// A link into the app from outside it — a notification email, a link
// someone pasted: `/?element=<id>`, `/?object=<id>`, `/?strategy=<id>`, or
// `/?view=inbox`. The shell reads it once at launch, drops it from the
// address, finds the thing's Space (hooks/deepLinkTarget.ts), switches to
// that Space and opens it the way ⌘K would. The emails build the same
// addresses (supabase/functions/_shared/notificationEmail.ts).

export type DeepLink =
  | { kind: 'inbox' }
  | { kind: 'element' | 'object' | 'strategy'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_KEYS = ['element', 'object', 'strategy'] as const;
const ALL_KEYS = [...ITEM_KEYS, 'view'] as const;

export function parseDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search);
  for (const kind of ITEM_KEYS) {
    const id = params.get(kind);
    if (id && UUID.test(id)) return { kind, id: id.toLowerCase() };
  }
  if (params.get('view') === 'inbox') return { kind: 'inbox' };
  return null;
}

/** The address without the link, so a reload opens the usual screen. */
export function stripDeepLink(href: string): string {
  const url = new URL(href);
  for (const key of ALL_KEYS) url.searchParams.delete(key);
  return url.toString();
}

/** Where the thing was found: its Space, and the screen that shows it. */
export interface DeepLinkTarget {
  spaceId: string | null;
  view: string;
  nav: Partial<NavigationState>;
  /** The shell has switched to the Space (or need not): open it now. */
  placed?: boolean;
}

/** The screen for a found thing: an Element opens over its Domain's
 *  Elements (as from ⌘K), an Object as its page, a Strategy in Strategy. */
export function deepLinkScreen(
  link: Exclude<DeepLink, { kind: 'inbox' }>,
  found: { objectId?: string | null; domainId?: string | null },
): Pick<DeepLinkTarget, 'view' | 'nav'> {
  const domain = found.objectId && found.domainId ? { objectDomainId: found.domainId } : {};
  if (link.kind === 'element') return { view: 'domain-elements', nav: { elementId: link.id, objectId: found.objectId ?? null, ...domain } };
  if (link.kind === 'object') return { view: 'objects', nav: { objectId: link.id, ...domain } };
  return { view: 'strategy', nav: { strategyId: link.id } };
}

// The found target waits here until the shell is in its Space: the Space
// switch can remount the shell, so a one-shot event could be missed.
type Pending = DeepLinkTarget | 'missing' | null;
let pending: Pending = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setPendingDeepLink(next: Pending): void { pending = next; emit(); }
export function clearPendingDeepLink(): void { if (pending !== null) { pending = null; emit(); } }
export function usePendingDeepLink(): Pending {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => pending,
    () => null,
  );
}
