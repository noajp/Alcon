'use client';

import { Archive, Check, Inbox } from 'lucide-react';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';
import { selectInboxNotification, useInbox, useNotificationElement } from './useInbox';

interface InboxViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/** The Inbox's main pane: the open notification at full width. The list
 *  that picks it lives in the AppSidebar (`InboxList`). */
export function InboxView({ onNavigate, onViewChange }: InboxViewProps) {
  const { t, locale } = useI18n();
  const { selected, revision, toggleRead, archive } = useInbox({ onNavigate, onViewChange });
  const elementId = selected?.element_id;
  const { detail, refresh } = useNotificationElement(elementId, revision);

  // Every island opens with the same 50px header, so the title line sits
  // level with the sidebar's Space row whichever view is showing.
  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
          <Inbox size={12} aria-hidden="true" />
          <span className="text-[12px] font-semibold text-foreground">{t('Inbox')}</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-muted-foreground">
          <Inbox size={88} strokeWidth={0.8} className="opacity-60" aria-hidden="true" />
          <p className="text-[13px]">{t('No notification selected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {selected.actor_name && <span className="font-medium text-foreground">{selected.actor_name}</span>}
          {selected.actor_name && ' · '}
          <time dateTime={selected.created_at}>{new Date(selected.created_at).toLocaleString(locale)}</time>
        </span>
        <Button variant="secondary" onClick={() => void toggleRead(selected)}><Check size={14} />{t(selected.is_read ? 'Mark as unread' : 'Mark as read')}</Button>
        <Button variant="secondary" onClick={() => void archive(selected)}><Archive size={14} />{t('Archive')}</Button>
      </header>
      {elementId ? detail?.element ? (
        <ElementDetailView
          key={`${elementId}:${revision}`} element={detail.element} layout="reader"
          domainName={null} objectPath={detail.element.objects ?? []} focusCommentId={selected.comment_id}
          onBack={() => selectInboxNotification(null)} onNavigateRoot={() => selectInboxNotification(null)}
          onRefresh={refresh}
          onNavigateObject={objectId => { onViewChange?.('objects'); onNavigate?.({ objectId }); }}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground" role="status">
          <p>{t(detail ? 'This Element is no longer available.' : 'Opening…')}</p>
          {detail && <Button variant="ghost" onClick={refresh}>{t('Retry')}</Button>}
        </div>
      ) : (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <h1 className="text-2xl font-semibold">{selected.title}</h1>
          <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{selected.body}</p>
        </article>
      )}
    </div>
  );
}
