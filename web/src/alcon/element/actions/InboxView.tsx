'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Inbox as InboxIcon,
  Archive, Check, CheckCheck,
} from 'lucide-react';
import {
  useNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  fetchElementWithDetails,
  type ElementWithDetails,
  type Notification,
} from '@/hooks/useSupabase';
import { notificationKindMeta as kindMeta } from '@/alcon/shared/notificationKinds';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NavigationState } from '@/types/navigation';

interface InboxViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

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

/** What a notification about an Element opens: the Element itself, at the
 *  comment that was announced. Held here rather than pushed into
 *  NavigationState because the Inbox is a Home surface — following a
 *  notification should not move the rail into Execution. */
interface OpenElement { elementId: string; commentId: string | null }

// How many rows to mount at once. The Inbox never limits the underlying
// fetch — unreadCount and the ModeRail badge both read the full list, so
// truncating the fetch would make those wrong the moment a user has more
// unread items than the page size. This bounds only what gets rendered:
// a board with hundreds of accumulated notifications was mounting one <li>
// per row with no virtualization, and a session running long enough to
// generate 350+ of them made every scroll and repaint in the Inbox — and,
// because it pegs the main thread, everything else on screen too — hang
// for tens of seconds.
const RENDER_PAGE_SIZE = 100;

export function InboxView({ onNavigate, onViewChange }: InboxViewProps) {
  const { user } = useAuthContext();
  const { notifications, unreadCount, loading, reload, setNotifications } = useNotifications(user?.id ?? null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE_SIZE);
  const [open, setOpen] = useState<OpenElement | null>(null);
  // Stamped with the id it was fetched for, so "still loading" is a comparison
  // rather than a state the effect has to write on the way in.
  const [loaded, setLoaded] = useState<{ elementId: string; element: ElementWithDetails | null } | null>(null);

  const loadDetail = useCallback(async (elementId: string) => {
    const element = await fetchElementWithDetails(elementId).catch((e) => {
      console.error('Failed to open the Element this notification is about:', e);
      return null;
    });
    setLoaded({ elementId, element });
  }, []);

  useEffect(() => {
    if (!open) return;
    const elementId = open.elementId;
    void (async () => {
      const element = await fetchElementWithDetails(elementId).catch((e) => {
        console.error('Failed to open the Element this notification is about:', e);
        return null;
      });
      setLoaded({ elementId, element });
    })();
  }, [open]);

  // A result that belongs to a different Element than the one being opened is
  // simply not this one's result — which is also how "still loading" is said,
  // so a slow fetch landing late needs no cancellation flag.
  const detail = open && loaded?.elementId === open.elementId ? loaded : null;

  const visible = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;

  const onClick = async (n: Notification) => {
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      try { await markNotificationRead(n.id, true); } catch (e) { console.error(e); }
    }
    if (n.element_id) {
      // Open the Element here, in Home, positioned on the comment the
      // notification is about — comment_id has always been written and until
      // now nothing read it.
      setOpen({ elementId: n.element_id, commentId: n.comment_id });
    } else if (n.strategy_id) {
      // Straight into the Campaign the comment was left on — a notification
      // you can read but not follow is only half delivered.
      onViewChange?.('strategy');
      onNavigate?.({ strategyId: n.strategy_id });
    } else if (n.object_id) {
      onViewChange?.('projects');
      onNavigate?.({ objectId: n.object_id });
    } else if (n.brief_id) {
      // Brief view was removed when Note ↔ Brief merged. Legacy notifications
      // for briefs (if any) fall back to the Note view so the user still
      // lands somewhere reasonable.
      onViewChange?.('note');
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

  if (open && detail?.element) {
    return (
      <ElementDetailView
        element={detail.element}
        domainName={null}
        objectPath={detail.element.objects ?? []}
        focusCommentId={open.commentId}
        onBack={() => setOpen(null)}
        onRefresh={() => loadDetail(open.elementId)}
        onNavigateRoot={() => setOpen(null)}
        onNavigateObject={(objectId) => {
          setOpen(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId });
        }}
      />
    );
  }

  if (open) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        {!detail ? (
          <p className="text-[13px]">Opening…</p>
        ) : (
          <>
            <p className="text-[13px]">This Element is no longer available.</p>
            <button
              onClick={() => setOpen(null)}
              className="text-[12px] px-2 h-6 rounded-md bg-muted/40 text-foreground hover:bg-muted/60 transition-colors"
            >
              Back to Inbox
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches the List view: thin h-10 row with 12px
          title + count, compact controls on the right. */}
      <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <InboxIcon size={13} className="text-muted-foreground" />
        <span className="text-[12px] font-semibold text-foreground">Inbox</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-px text-[10px] font-semibold bg-red-500/15 text-red-300 rounded-full tabular-nums">
            {unreadCount}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center bg-muted/40 rounded-md p-0.5">
          <button
            onClick={() => { setFilter('all'); setRenderLimit(RENDER_PAGE_SIZE); }}
            className={`px-2 h-5 text-[11px] rounded transition-colors ${
              filter === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >All</button>
          <button
            onClick={() => { setFilter('unread'); setRenderLimit(RENDER_PAGE_SIZE); }}
            className={`px-2 h-5 text-[11px] rounded transition-colors ${
              filter === 'unread' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >Unread</button>
        </div>
        <button
          onClick={onMarkAllRead}
          disabled={unreadCount === 0}
          className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          title="Mark all read"
          aria-label="Mark all read"
        >
          <CheckCheck size={13} />
        </button>
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
            {visible.slice(0, renderLimit).map(n => {
              const meta = kindMeta(n.kind);
              const Icon = meta.icon;
              return (
                // The row is a real button, so Tab reaches it and Enter /
                // Space open it — it used to be an <li onClick>, unreachable
                // without a mouse. The row actions sit outside that button
                // (they are their own actions, not part of "open this") and
                // appear on focus as well as on hover, or Tab would land on
                // controls nobody can see.
                <li
                  key={n.id}
                  className={`group flex items-stretch rounded-lg transition-colors ${
                    n.is_read ? 'hover:bg-muted/40' : 'bg-muted/40 hover:bg-muted/60'
                  } focus-within:bg-muted/60`}
                >
                  <button
                    type="button"
                    onClick={() => onClick(n)}
                    className="flex-1 min-w-0 flex items-start gap-3 px-3 py-3 text-left rounded-lg"
                  >
                    <div className="mt-1.5 w-2 h-2 flex-shrink-0">
                      {!n.is_read && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                    </div>

                    <div className={`mt-0.5 flex-shrink-0 ${meta.color}`}>
                      <Icon size={14} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-foreground break-words">
                        <span className={n.is_read ? 'font-normal' : 'font-medium'}>{n.title}</span>
                      </div>
                      {n.body && (
                        <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2 break-words">
                          {n.body}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>{meta.label}</span>
                        <span>·</span>
                        <span>{formatRelative(n.created_at)}</span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => onToggleRead(n, e)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-background"
                      title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                      aria-label={n.is_read ? 'Mark as unread' : 'Mark as read'}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={(e) => onArchive(n.id, e)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-background"
                      title="Archive"
                      aria-label="Archive"
                    >
                      <Archive size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {visible.length > renderLimit && (
          <div className="max-w-3xl mx-auto px-4 pb-4 flex justify-center">
            <button
              onClick={() => setRenderLimit(l => l + RENDER_PAGE_SIZE)}
              className="text-[12px] px-3 h-7 rounded-md bg-muted/40 text-foreground hover:bg-muted/60 transition-colors"
            >
              Show {Math.min(RENDER_PAGE_SIZE, visible.length - renderLimit)} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
