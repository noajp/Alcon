'use client';

import { inboxRowText, readableBody } from './inboxRow';
import { Panel, PanelBody, PanelHeader } from '@/Function/shared/PanelLayout';

import { useMemo, useState } from 'react';
import { Archive, Check, CheckCheck, Inbox, ListFilter, MoreHorizontal } from '@/ui/icons';
import type { Notification } from '@/hooks/useSupabase';
import { notificationKindMeta } from '@/Function/shared/notificationKinds';
import { questionTicketIdsOf, splitInbox } from '@/Function/shared/inboxModel';
import { useOpenQuestionTickets } from '@/AIP/ai/agentData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/ui/dropdown-menu';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/ui/context-menu';
import type { NavigationState } from '@/types/navigation';
import { useInbox } from './useInbox';

interface InboxListProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  /** A notification was opened in the Inbox reader (not routed elsewhere).
   *  The shell uses this to close the sidebar drawer on narrow windows, as
   *  picking any other sidebar entry does. */
  onOpen?: () => void;
}

// Bound mounted rows, while counts and filtering still use the whole Inbox.
const RENDER_PAGE_SIZE = 100;

function relativeTime(iso: string, locale: string, t: (message: string, values?: Record<string, string | number>) => string) {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return t('{n}m', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{n}h', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('{n}d', { n: days });
  if (days < 365) return t('{n}w', { n: Math.floor(days / 7) });
  return new Date(iso).toLocaleDateString(locale);
}

/** The Inbox's sidebar: every notification as a preview row. Picking one
 *  opens it in the main pane, which stays free for the whole message. */
export function InboxList({ onNavigate, onViewChange, onOpen }: InboxListProps) {
  const { t, locale } = useI18n();
  const inbox = useInbox({ onNavigate, onViewChange });
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE_SIZE);
  // What waits on the person leads the list: questions whose ticket still
  // stands open (inboxModel.ts). The tickets are re-read when a notification
  // arrives, when one is picked, and when the question card sends an answer.
  const ticketIds = useMemo(() => questionTicketIdsOf(inbox.notifications), [inbox.notifications]);
  const openTickets = useOpenQuestionTickets(ticketIds, [inbox.revision, inbox.refreshed, inbox.notifications.length]);
  const { waiting, rest } = useMemo(() => splitInbox(inbox.notifications, openTickets), [inbox.notifications, openTickets]);
  // Keep the notification being read in the unread view until the user leaves it.
  // A waiting question stays whether or not it was read: reading is not answering.
  const visible = inbox.unreadOnly
    ? rest.filter(n => !n.is_read || n.id === inbox.selectedId)
    : rest;
  const rows = visible.slice(0, renderLimit);
  const rowActions = {
    onSelect: (n: Notification) => { if (inbox.select(n)) onOpen?.(); },
    onToggleRead: inbox.toggleRead, onArchive: inbox.archive,
  };

  return (
    <Panel label={t('Notifications')}>
      {/* The title row stays; the list scrolls under it. */}
      <PanelHeader title={t('Inbox')} count={inbox.unreadCount} actions={<>
        <Button variant="ghost" size="icon-xs" disabled={inbox.unreadCount === 0} onClick={() => void inbox.markAllRead()} title={t('Mark all read')} aria-label={t('Mark all read')}><CheckCheck size={13} /></Button>
        <Button variant={inbox.unreadOnly ? 'secondary' : 'ghost'} size="icon-xs" aria-pressed={inbox.unreadOnly} onClick={() => { inbox.setUnreadOnly(!inbox.unreadOnly); setRenderLimit(RENDER_PAGE_SIZE); }} title={t('Unread only')} aria-label={t('Unread only')}><ListFilter size={13} /></Button>
      </>} />
      <PanelBody>
      {inbox.loading ? <p role="status" className="py-8 text-center text-[12px] text-muted-foreground">{t('Loading…')}</p>
        : waiting.length === 0 && rows.length === 0 ? <p className="px-2 py-8 text-center text-[12px] text-muted-foreground">{t(inbox.unreadOnly ? "You're all caught up!" : 'No notifications yet.')}</p>
        : <>
          {waiting.length > 0 && (
            <>
              <h3 className="mt-2 flex items-center gap-1.5 px-2 text-[11px] font-medium text-[var(--status-info)]">
                {t('Waiting on you')}<span className="tabular-nums">{waiting.length}</span>
              </h3>
              <ul className="mt-1 space-y-0.5">
                {waiting.map(n => <InboxRow key={n.id} notification={n} selected={inbox.selectedId === n.id} locale={locale} {...rowActions} />)}
              </ul>
              {rows.length > 0 && <h3 className="mt-3 px-2 text-[11px] font-medium text-muted-foreground">{t('Everything else')}</h3>}
            </>
          )}
          <ul className="mt-1 space-y-0.5">
            {rows.map(n => <InboxRow key={n.id} notification={n} selected={inbox.selectedId === n.id} locale={locale} {...rowActions} />)}
          </ul>
        </>}
      {visible.length > renderLimit && <div className="flex justify-center py-2"><Button variant="ghost" size="xs" onClick={() => setRenderLimit(limit => limit + RENDER_PAGE_SIZE)}>{t('Show more')}</Button></div>}
      </PanelBody>
    </Panel>
  );
}

function InboxRow({ notification: n, selected, locale, onSelect, onToggleRead, onArchive }: {
  notification: Notification;
  selected: boolean;
  locale: string;
  onSelect: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
  onArchive: (n: Notification) => void;
}) {
  const { t } = useI18n();
  const meta = notificationKindMeta(n.kind);
  const Icon = meta.icon;
  // The list's read carries the Element each one is about (notificationData).
  const text = inboxRowText(n as Notification & { element?: { title: string } | null });
  // The same two actions sit behind the row's "⋯" and a right-click, so the
  // menu is reachable with either hand.
  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <li className={`group/row flex items-start gap-0.5 rounded-lg pr-1 transition-colors ${selected ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50 focus-within:bg-sidebar-accent/50'}`}>
      <button type="button" onClick={() => onSelect(n)} aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-2 pl-2 text-left focus-visible:bg-sidebar-accent">
        <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground" aria-hidden="true">
          {n.actor_name?.trim().slice(0, 2) || <Inbox size={14} />}
          <span className="absolute -bottom-1 -right-1 rounded bg-card p-px text-[var(--text-secondary)]"><Icon size={10} /></span>
        </span>
        {/* What the notification is about leads; who sent it and what kind
            it is follow, small — a list of seven "Status" rows says nothing. */}
        <span className="min-w-0 flex-1">
          {/* What it is about, then what happened and who, then the detail. */}
          <span className="flex items-start gap-2">
            <span className={`min-w-0 flex-1 line-clamp-2 break-words text-[13px] leading-[18px] ${n.is_read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{text.subject}</span>
            <time dateTime={n.created_at} title={new Date(n.created_at).toLocaleString(locale)} className="mt-px shrink-0 text-[10px] tabular-nums text-muted-foreground">{relativeTime(n.created_at, locale, t)}</time>
            {!n.is_read && <span aria-label={t('Unread')} className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-default)]" />}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            <span>{text.event ?? t(meta.label)}</span>
            {n.actor_name && !text.event?.includes(n.actor_name) && <> · <span>{n.actor_name}</span></>}
          </span>
          {text.detail && <span className="mt-0.5 line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">{readableBody(text.detail, t)}</span>}
        </span>
      </button>
      <DropdownMenu>
        <ButtonAppearanceProvider appearance="navigation">
        <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" className="mt-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={t('Notification actions')}><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
        </ButtonAppearanceProvider>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void onToggleRead(n)} className="gap-2"><Check size={14} />{t(n.is_read ? 'Mark as unread' : 'Mark as read')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void onArchive(n)} className="gap-2"><Archive size={14} />{t('Archive')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => void onToggleRead(n)}><Check />{t(n.is_read ? 'Mark as unread' : 'Mark as read')}</ContextMenuItem>
      <ContextMenuItem onSelect={() => void onArchive(n)}><Archive />{t('Archive')}</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  );
}
