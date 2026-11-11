'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  useNotifications, markNotificationRead, markAllNotificationsRead,
  archiveNotification, fetchElementWithDetails,
  type ElementWithDetails, type Notification,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NavigationState } from '@/types/navigation';
import { useOpenObject } from './useOpenObject';

// The Inbox is split across two panes that do not share a parent below the
// shell: the AppSidebar lists the notifications, the main pane reads the one
// that is open. The notifications themselves already live in a shared store
// (`useNotifications`); this module holds the selection so both panes agree
// on which one is open and whether the list shows unread only.

interface InboxSelection {
  selectedId: string | null;
  unreadOnly: boolean;
  /** Bumps on every pick so the reader restarts its navigation trail even
   *  when the same notification is chosen again. */
  revision: number;
  /** Bumps when something outside the feed changed what the Inbox shows
   *  (a question answered): both panes re-read it, and the selection and
   *  the reader's trail stay exactly where they are. */
  refreshed: number;
}

let selection: InboxSelection = { selectedId: null, unreadOnly: false, revision: 0, refreshed: 0 };
const listeners = new Set<() => void>();

function emit(next: InboxSelection) {
  selection = next;
  listeners.forEach(fn => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getSelection = () => selection;

export function selectInboxNotification(id: string | null) {
  emit({ ...selection, selectedId: id, revision: selection.revision + 1 });
}

/** Ask both Inbox panes to re-read what waits, without touching which
 *  notification is open. */
export function refreshInbox() {
  emit({ ...selection, refreshed: selection.refreshed + 1 });
}

function useInboxSelection(): InboxSelection {
  return useSyncExternalStore(subscribe, getSelection, getSelection);
}

interface InboxNavigation {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/** Everything both Inbox panes need: the rows, the open one, and the actions
 *  that change them. Optimistic writes go through the shared notification
 *  store, so the sidebar list, the reader and the rail badge move together. */
export function useInbox({ onNavigate, onViewChange }: InboxNavigation = {}) {
  const { user } = useAuthContext();
  const { notifications, unreadCount, loading, reload, setNotifications } = useNotifications(user?.id ?? null);
  const { selectedId, unreadOnly, revision, refreshed } = useInboxSelection();
  const selected = notifications.find(n => n.id === selectedId) ?? null;
  const openObject = useOpenObject({ onNavigate, onViewChange });

  /** Opens a notification. Returns true when it opened in the Inbox reader,
   *  false when it navigated to the surface it is about instead. */
  const select = useCallback((n: Notification): boolean => {
    // Element notifications open in the reader; the rest jump to the surface
    // they are about.
    let opened = false;
    if (n.element_id || !(n.strategy_id || n.object_id)) { selectInboxNotification(n.id); opened = true; }
    else if (n.strategy_id) {
      onViewChange?.('strategy');
      onNavigate?.({ strategyId: n.strategy_id });
    } else if (n.object_id) {
      const objectId = n.object_id;
      void openObject(objectId).catch(error => { console.error(error); return false; }).then(found => {
        if (found) return;
        onViewChange?.('objects');
        onNavigate?.({ objectId });
      });
    }
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      void markNotificationRead(n.id, true).catch(error => { console.error(error); reload(); });
    }
    return opened;
  }, [onNavigate, onViewChange, openObject, reload, setNotifications]);

  const archive = useCallback(async (n: Notification) => {
    setNotifications(prev => prev.filter(x => x.id !== n.id));
    if (selection.selectedId === n.id) selectInboxNotification(null);
    try { await archiveNotification(n.id); } catch (error) { console.error(error); reload(); }
  }, [reload, setNotifications]);

  const toggleRead = useCallback(async (n: Notification) => {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: !n.is_read } : x));
    try { await markNotificationRead(n.id, !n.is_read); } catch (error) { console.error(error); reload(); }
  }, [reload, setNotifications]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setNotifications(prev => prev.map(x => ({ ...x, is_read: true })));
    try { await markAllNotificationsRead(user.id); } catch (error) { console.error(error); reload(); }
  }, [reload, setNotifications, user]);

  const setUnreadOnly = useCallback((value: boolean) => emit({ ...selection, unreadOnly: value }), []);

  return { notifications, unreadCount, loading, selected, selectedId, revision, refreshed, unreadOnly, select, openObject, archive, toggleRead, markAllRead, setUnreadOnly };
}

/** The Element a notification points at, re-read when the reader asks. */
export function useNotificationElement(elementId: string | null | undefined, revision: number) {
  const [loaded, setLoaded] = useState<{ elementId: string; element: ElementWithDetails | null } | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!elementId) return;
    let cancelled = false;
    void fetchElementWithDetails(elementId).then(element => {
      if (!cancelled) setLoaded({ elementId, element });
    }).catch(error => {
      console.error('Failed to open notification Element:', error);
      if (!cancelled) setLoaded({ elementId, element: null });
    });
    return () => { cancelled = true; };
  }, [elementId, revision, reloads]);

  const refresh = useCallback(() => setReloads(v => v + 1), []);
  return { detail: elementId && loaded?.elementId === elementId ? loaded : null, refresh };
}
