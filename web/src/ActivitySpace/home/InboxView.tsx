'use client';

import { Archive, Check, Inbox } from '@/ui/icons';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { InvitationCard } from '@/Function/membership/InvitationCard';
import { WorkflowApprovalCard } from '@/Function/audit/WorkflowApprovalCard';
import { CopilotApprovalInboxCard } from './CopilotApprovalInboxCard';
import { DraftReviewInboxCard } from '@/AIP/connectors/DraftReviewInboxCard';
import { useActiveSpaceScope } from '@/Function/space/data';
import { useInvitation } from '@/Function/membership/invitations';
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
  const { selected, revision, toggleRead, archive, openObject } = useInbox({ onNavigate, onViewChange });
  // An audit Space (ADR 0048) does not open Elements: their notifications
  // say so instead of opening the Element in the reader.
  const audit = useActiveSpaceScope() === 'audit';
  const elementId = audit ? null : selected?.element_id;
  const { detail, refresh } = useNotificationElement(elementId, revision);

  // Every island opens with the same 50px header, so the title line sits
  // level with the sidebar's Space row whichever view is showing.
  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <header className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
          <Inbox size={12} aria-hidden="true" />
          <span className="text-[13px] font-medium text-foreground">{t('Inbox')}</span>
        </header>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-[13px]">{t('No notification selected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0 overflow-hidden">
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
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
          onNavigateObject={objectId => {
            void openObject(objectId).catch(error => { console.error(error); return false; }).then(found => {
              if (found) return;
              onViewChange?.('objects');
              onNavigate?.({ objectId });
            });
          }}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground" role="status">
          <p>{t(detail ? 'This Element is no longer available.' : 'Opening…')}</p>
          {detail && <Button variant="ghost" onClick={refresh}>{t('Retry')}</Button>}
        </div>
      ) : audit && selected.element_id ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <h1 className="text-2xl font-semibold">{selected.title}</h1>
          {selected.body && <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{selected.body}</p>}
          <p className="mt-6 text-[13px] text-muted-foreground">{t('This Space shows the AI audit only. Elements open once its owner switches it to full in Settings.')}</p>
        </article>
      ) : selected.agent_action_id ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <CopilotApprovalInboxCard key={selected.agent_action_id} actionId={selected.agent_action_id} />
        </article>
      ) : selected.workflow_approval_id ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <WorkflowApprovalCard key={selected.workflow_approval_id} approvalId={selected.workflow_approval_id} />
        </article>
      ) : selected.integration_draft_id ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <DraftReviewInboxCard key={selected.integration_draft_id} draftId={selected.integration_draft_id} title={selected.title} body={selected.body} />
        </article>
      ) : selected.kind === 'invite' ? (
        <InvitationNotice key={selected.id} invitationId={selected.invitation_id ?? null} title={selected.title} />
      ) : (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <h1 className="text-2xl font-semibold">{selected.title}</h1>
          <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{selected.body}</p>
        </article>
      )}
    </div>
  );
}

/** An invitation in the reader: Accept / Decline while it is pending, how it
 *  was resolved afterwards, and a plain notice once it no longer exists. */
function InvitationNotice({ invitationId, title }: { invitationId: string | null; title: string }) {
  const { t } = useI18n();
  const { invitation, loading } = useInvitation(invitationId);
  return (
    <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
      {invitation ? (
        <InvitationCard invitation={invitation} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-6 text-[13px] text-muted-foreground" role="status">
            {t(loading ? 'Opening…' : 'This invitation no longer exists.')}
          </p>
        </>
      )}
    </article>
  );
}
