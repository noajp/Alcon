'use client';

import { useEffect, useState } from 'react';
import {
  useNotifications, markNotificationRead, markAllNotificationsRead,
  archiveNotification, fetchElementWithDetails,
  type ElementWithDetails, type Notification,
} from '@/hooks/useSupabase';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';
import { InboxLayout } from './InboxLayout';

interface InboxViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

// Bound mounted rows, while counts and filtering still use the whole Inbox.
const RENDER_PAGE_SIZE = 100;

export function InboxView({ onNavigate, onViewChange }: InboxViewProps) {
  const { user } = useAuthContext();
  const { t } = useI18n();
  const { notifications, unreadCount, loading, reload, setNotifications } = useNotifications(user?.id ?? null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE_SIZE);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ elementId: string; element: ElementWithDetails | null } | null>(null);
  const elementId = selected?.element_id;

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
  }, [elementId, revision]);

  const detail = elementId && loaded?.elementId === elementId ? loaded : null;
  // Keep the notification being read in the unread view until the user leaves it.
  const visible = unreadOnly ? notifications.filter(n => !n.is_read || n.id === selected?.id) : notifications;

  const select = (n: Notification) => {
    // Following a notification starts a fresh reader navigation trail.
    setSelectionRevision(v => v + 1);
    if (n.element_id || !(n.strategy_id || n.object_id || n.brief_id)) setSelected(n);
    else if (n.strategy_id) {
      onViewChange?.('strategy');
      onNavigate?.({ strategyId: n.strategy_id });
    } else if (n.object_id) {
      onViewChange?.('objects');
      onNavigate?.({ objectId: n.object_id });
    } else if (n.brief_id) onViewChange?.('note');
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      void markNotificationRead(n.id, true).catch(error => { console.error(error); reload(); });
    }
  };

  const archive = async (n: Notification) => {
    setNotifications(prev => prev.filter(x => x.id !== n.id));
    if (selected?.id === n.id) setSelected(null);
    try { await archiveNotification(n.id); } catch (error) { console.error(error); reload(); }
  };
  const toggleRead = async (n: Notification) => {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: !n.is_read } : x));
    try { await markNotificationRead(n.id, !n.is_read); } catch (error) { console.error(error); reload(); }
  };
  const markAllRead = async () => {
    if (!user) return;
    setNotifications(prev => prev.map(x => ({ ...x, is_read: true })));
    try { await markAllNotificationsRead(user.id); } catch (error) { console.error(error); reload(); }
  };

  return <InboxLayout
    notifications={visible.slice(0, renderLimit)} unreadCount={unreadCount} loading={loading}
    unreadOnly={unreadOnly} selectedId={selected?.id ?? null} hasMore={visible.length > renderLimit}
    onSelect={select} onBack={() => setSelected(null)}
    onFilter={() => { setUnreadOnly(v => !v); setRenderLimit(RENDER_PAGE_SIZE); }}
    onMarkAllRead={markAllRead} onToggleRead={toggleRead} onArchive={archive}
    onShowMore={() => setRenderLimit(limit => limit + RENDER_PAGE_SIZE)}
    detail={elementId ? detail?.element ? <ElementDetailView
      key={`${elementId}:${selectionRevision}`} element={detail.element} layout="reader"
      domainName={null} objectPath={detail.element.objects ?? []} focusCommentId={selected?.comment_id}
      onBack={() => setSelected(null)} onNavigateRoot={() => setSelected(null)}
      onRefresh={() => setRevision(v => v + 1)}
      onNavigateObject={objectId => { onViewChange?.('objects'); onNavigate?.({ objectId }); }}
    /> : <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground" role="status">
      <p>{t(detail ? 'This Element is no longer available.' : 'Opening…')}</p>
      {detail && <Button variant="ghost" onClick={() => setRevision(v => v + 1)}>{t('Retry')}</Button>}
      <Button variant="ghost" onClick={() => setSelected(null)}>{t('Back to Inbox')}</Button>
    </div> : <article className="overflow-auto p-8"><h2 className="text-xl font-semibold">{selected?.title}</h2><p className="mt-4 whitespace-pre-wrap text-[14px] text-muted-foreground">{selected?.body}</p></article>}
  />;
}
