'use client';

import type { ReactNode } from 'react';
import { Archive, ArrowLeft, Check, CheckCheck, Inbox, ListFilter } from 'lucide-react';
import type { Notification } from '@/hooks/useSupabase';
import { notificationKindMeta } from '@/Function/shared/notificationKinds';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';

interface InboxLayoutProps {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  unreadOnly: boolean;
  selectedId: string | null;
  hasMore: boolean;
  detail: ReactNode;
  onSelect: (notification: Notification) => void;
  onBack: () => void;
  onFilter: () => void;
  onMarkAllRead: () => void;
  onToggleRead: (notification: Notification) => void;
  onArchive: (notification: Notification) => void;
  onShowMore: () => void;
}

function relativeTime(iso: string, locale: string) {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return new Date(iso).toLocaleDateString(locale);
}

/** The list and reader share one island, each with its own scroll position. */
export function InboxLayout(props: InboxLayoutProps) {
  const { t, locale } = useI18n();
  return (
    <div className="@container/inbox flex h-full min-h-0 min-w-0 overflow-hidden bg-card">
      <section aria-label={t('Notifications')} className={`flex min-h-0 w-full shrink-0 flex-col @min-[760px]/inbox:w-[330px] @min-[760px]/inbox:border-r border-border ${props.selectedId ? 'hidden @min-[760px]/inbox:flex' : ''}`}>
        <header className="flex h-[50px] shrink-0 items-center gap-2 border-b border-border px-4">
          <h1 className="text-[13px] font-medium text-foreground">{t('Inbox')}</h1>
          {props.unreadCount > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{props.unreadCount}</span>}
          <div className="flex-1" />
          <Button variant="ghost" size="icon-xs" disabled={props.unreadCount === 0} onClick={props.onMarkAllRead} title={t('Mark all read')} aria-label={t('Mark all read')}><CheckCheck size={14} /></Button>
          <Button variant={props.unreadOnly ? 'secondary' : 'ghost'} size="icon-xs" aria-pressed={props.unreadOnly} onClick={props.onFilter} title={t('Unread only')} aria-label={t('Unread only')}><ListFilter size={14} /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {props.loading ? <p role="status" className="py-12 text-center text-[13px] text-muted-foreground">{t('Loading…')}</p> : props.notifications.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">{t(props.unreadOnly ? "You're all caught up!" : 'No notifications yet.')}</p>
          ) : <ul className="space-y-1">
            {props.notifications.map(n => {
              const meta = notificationKindMeta(n.kind);
              const Icon = meta.icon;
              const selected = props.selectedId === n.id;
              return <li key={n.id} className={`group relative rounded-lg transition-colors ${selected ? 'bg-[var(--surface-strong)]' : 'hover:bg-muted/50 focus-within:bg-muted/50'}`}>
                <button type="button" onClick={() => props.onSelect(n)} aria-current={selected ? 'true' : undefined} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left focus-visible:bg-muted">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground" aria-hidden="true">
                    {n.actor_name?.trim().slice(0, 2) || <Inbox size={18} />}
                    <span className="absolute -bottom-0.5 -right-0.5 rounded bg-card p-0.5 text-[var(--text-secondary)]"><Icon size={12} /></span>
                  </span>
                  <span className="min-w-0 flex-1">
                    {n.body && <span className="sr-only">{t(meta.label)}</span>}
                    <span className={`block truncate text-[13px] ${n.is_read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{n.title}</span>
                    <span className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">{n.body || t(meta.label)}</span>
                      <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString(locale)} className="shrink-0 text-[11px] tabular-nums">{relativeTime(n.created_at, locale)}</time>
                    </span>
                  </span>
                  {!n.is_read && <span aria-label={t('Unread')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-default)]" />}
                </button>
                <div className="absolute right-2 top-1 flex gap-1 rounded-full bg-card opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button size="icon-xs" variant="ghost" onClick={() => props.onToggleRead(n)} title={t(n.is_read ? 'Mark as unread' : 'Mark as read')} aria-label={t(n.is_read ? 'Mark as unread' : 'Mark as read')}><Check size={12} /></Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => props.onArchive(n)} title={t('Archive')} aria-label={t('Archive')}><Archive size={12} /></Button>
                </div>
              </li>;
            })}
          </ul>}
          {props.hasMore && <div className="flex justify-center py-3"><Button variant="ghost" onClick={props.onShowMore}>{t('Show more')}</Button></div>}
        </div>
      </section>
      <section aria-label={t('Notification detail')} className={`min-h-0 min-w-0 flex-1 flex-col ${props.selectedId ? 'flex' : 'hidden @min-[760px]/inbox:flex'}`}>
        {props.selectedId ? <>
          <div className="flex shrink-0 items-center px-3 py-2 @min-[760px]/inbox:hidden"><Button variant="ghost" onClick={props.onBack}><ArrowLeft size={14} />{t('Back to Inbox')}</Button></div>
          {props.detail}
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-5 text-muted-foreground">
          <Inbox size={88} strokeWidth={0.8} className="opacity-60" aria-hidden="true" />
          <p className="text-[13px]">{t('No notification selected')}</p>
        </div>}
      </section>
    </div>
  );
}
