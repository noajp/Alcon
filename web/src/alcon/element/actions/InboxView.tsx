'use client';

import { useState } from 'react';
import {
  Inbox as InboxIcon,
  AtSign, UserPlus, MessageSquare, RefreshCw,
  ShieldCheck, Calendar, Archive, Check, CheckCheck,
} from 'lucide-react';
import {
  useNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  type Notification,
  type NotificationKind,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NavigationState } from '@/types/navigation';

interface InboxViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

const KIND_META: Record<NotificationKind, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; label: string }> = {
  mention:            { icon: AtSign,        color: 'text-blue-400',    label: 'Mention' },
  assigned:           { icon: UserPlus,      color: 'text-emerald-400', label: 'Assigned' },
  comment:            { icon: MessageSquare, color: 'text-foreground/80', label: 'Comment' },
  status_change:      { icon: RefreshCw,     color: 'text-amber-400',   label: 'Status' },
  approval_requested: { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval requested' },
  approval_decided:   { icon: ShieldCheck,   color: 'text-purple-400',  label: 'Approval decision' },
  due_soon:           { icon: Calendar,      color: 'text-red-400',     label: 'Due soon' },
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function InboxView({ onNavigate, onViewChange }: InboxViewProps) {
  const { user } = useAuthContext();
  const { notifications, unreadCount, loading, reload, setNotifications } = useNotifications(user?.id ?? null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const visible = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;

  const onClick = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      try { await markNotificationRead(n.id, true); } catch (e) { console.error(e); }
    }
    if (n.element_id) {
      onViewChange?.('mytasks');
    } else if (n.object_id) {
      onViewChange?.('projects');
      onNavigate?.({ objectId: n.object_id });
    } else if (n.brief_id) {
      onViewChange?.('brief');
    }
  };

  const onArchive = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    try { await archiveNotification(id); } catch (err) { console.error(err); reload(); }
  };

  const onToggleRead = async (n: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !n.is_read;
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: next } : x));
    try { await markNotificationRead(n.id, next); } catch (err) { console.error(err); reload(); }
  };

  const onMarkAllRead = async () => {
    if (!user) return;
    setNotifications(prev => prev.map(x => ({ ...x, is_read: true })));
    try { await markAllNotificationsRead(user.id); } catch (e) { console.error(e); reload(); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <InboxIcon size={20} className="text-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-medium bg-red-500/15 text-red-300 rounded-full">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/40 rounded-md p-0.5">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
                filter === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >All</button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-2.5 py-1 text-[12px] rounded transition-colors ${
                filter === 'unread' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >Unread</button>
          </div>
          <button
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          >
            <CheckCheck size={12} /> Mark all read
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center py-16 text-muted-foreground text-[13px]">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <InboxIcon size={42} className="opacity-30 mb-3" />
            <p className="text-[13px]">
              {filter === 'unread' ? "You're all caught up!" : 'No notifications yet.'}
            </p>
          </div>
        ) : (
          <ul className="max-w-3xl mx-auto py-4 px-4 space-y-1">
            {visible.map(n => {
              const meta = KIND_META[n.kind];
              const Icon = meta.icon;
              return (
                <li
                  key={n.id}
                  onClick={() => onClick(n)}
                  className={`group flex items-start gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                    n.is_read ? 'hover:bg-muted/40' : 'bg-muted/40 hover:bg-muted/60'
                  }`}
                >
                  <div className="mt-1.5 w-2 h-2 flex-shrink-0">
                    {!n.is_read && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </div>

                  <div className={`mt-0.5 ${meta.color}`}>
                    <Icon size={14} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-foreground">
                      <span className={n.is_read ? 'font-normal' : 'font-medium'}>{n.title}</span>
                    </div>
                    {n.body && (
                      <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                      <span className="uppercase tracking-wider">{meta.label}</span>
                      <span>·</span>
                      <span>{formatRelative(n.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => onToggleRead(n, e)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-background"
                      title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={(e) => onArchive(n.id, e)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-background"
                      title="Archive"
                    >
                      <Archive size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
