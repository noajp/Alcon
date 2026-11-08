import type { NavigationState } from '@/types/navigation';

// The screen a browser tab has open — its view, where it is inside that view,
// where Settings goes back to, and the Settings page — kept for this tab
// (sessionStorage) and this Space, so a reload opens the same screen instead
// of the home view. Another browser tab keeps its own. Nothing here is
// needed to render: a missing or unreadable entry opens the home view.

export interface OpenScreen {
  view: string;
  navigation: NavigationState;
  /** Where Settings' Back goes, when Settings is open. */
  settingsReturn: string | null;
  /** The Settings page and its tab. */
  settings: { section: string; tab: string | null } | null;
}

const KEY = 'alcon.open-screen.v1';
const keyFor = (spaceId: string) => `${KEY}:${spaceId}`;
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Pure. A stored screen, kept only when its view is one the shell has. A
 *  one-time request riding on the navigation (open the create dialog) is not
 *  carried into the next load. */
export function openScreenFrom(raw: unknown, isView: (view: string) => boolean): OpenScreen | null {
  const x = obj(raw);
  const view = str(x?.view);
  const nav = obj(x?.navigation);
  if (!x || !view || !isView(view) || !nav) return null;
  const { strategyCreate: _once, landOnTab: _land, ...navigation } = nav;
  void _once;
  void _land;
  const settingsReturn = str(x.settingsReturn);
  const s = obj(x.settings);
  const section = str(s?.section);
  return {
    view,
    navigation: { ...(navigation as Partial<NavigationState>), objectId: str(navigation.objectId) } as NavigationState,
    settingsReturn: settingsReturn && isView(settingsReturn) ? settingsReturn : null,
    settings: section ? { section, tab: str(s?.tab) } : null,
  };
}

/** The screen this browser tab last had open in the Space, or null. */
export function readOpenScreen(spaceId: string, isView: (view: string) => boolean): OpenScreen | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(spaceId));
    return raw ? openScreenFrom(JSON.parse(raw), isView) : null;
  } catch {
    return null;
  }
}

export function writeOpenScreen(spaceId: string, screen: OpenScreen): void {
  try {
    window.sessionStorage.setItem(keyFor(spaceId), JSON.stringify(screen));
  } catch {
    // A private window or full storage: the next load opens the home view.
  }
}
