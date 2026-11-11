'use client';

import { useCallback, useMemo, useState } from 'react';
import { Archive, Check } from '@/ui/icons';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { InvitationCard } from '@/Function/membership/InvitationCard';
import { WorkflowApprovalCard } from '@/Function/audit/WorkflowApprovalCard';
import { CopilotApprovalInboxCard } from './CopilotApprovalInboxCard';
import { QuestionTicketInboxCard } from './QuestionTicketInboxCard';
import { DraftReviewInboxCard } from '@/AIP/connectors/DraftReviewInboxCard';
import { PromotionReviewInboxCard } from '@/AIP/harness/PromotionReviewInboxCard';
import { HeartbeatInboxCard } from './HeartbeatInboxCard';
import { useInvitation } from '@/Function/membership/invitations';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';
import { refreshInbox, selectInboxNotification, useInbox, useNotificationElement } from './useInbox';
import { questionTicketIdsOf, splitInbox } from '@/Function/shared/inboxModel';
import { useOpenQuestionTickets } from '@/AIP/ai/agentData';
import { refreshAwaitingAnswers } from '@/hooks/awaitingAnswerData';

interface InboxViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/** The Inbox's main pane: the open notification at full width. The list
 *  that picks it lives in the AppSidebar (`InboxList`). */
export function InboxView({ onNavigate, onViewChange }: InboxViewProps) {
  const { t, locale } = useI18n();
  const { selected, revision, refreshed, notifications, select, toggleRead, archive, openObject } = useInbox({ onNavigate, onViewChange });
  // What still waits on the person besides the open notification, so an
  // answered question can lead straight to the next (inboxModel.ts).
  const ticketIds = useMemo(() => questionTicketIdsOf(notifications), [notifications]);
  const openTickets = useOpenQuestionTickets(ticketIds, [revision, refreshed, notifications.length]);
  // null while the open tickets are not known: the card then says nothing
  // about what else waits, rather than "nothing" on a guess.
  const otherWaiting = useMemo(
    () => (openTickets ? splitInbox(notifications, openTickets).waiting.filter(n => n.id !== selected?.id) : null),
    [notifications, openTickets, selected?.id],
  );
  const elementId = selected?.element_id;
  const { detail, refresh } = useNotificationElement(elementId, revision);

  // The Element the open question rests, told by the card once it has read
  // its ticket — remembered with the ticket it belongs to, so a question
  // just opened never shows the previous one's work.
  const [work, setWork] = useState<{ ticketId: string; elementId: string | null } | null>(null);
  const openTicketId = selected?.question_ticket_id ?? null;
  const noteWork = useCallback((elementId: string | null) => {
    if (openTicketId) setWork({ ticketId: openTicketId, elementId });
  }, [openTicketId]);
  const workElementId = work && work.ticketId === openTicketId ? work.elementId : null;
  const { detail: workDetail, refresh: refreshWork } = useNotificationElement(workElementId, revision);
  const openObjectFromReader = (objectId: string) => {
    void openObject(objectId).catch(error => { console.error(error); return false; }).then(found => {
      if (found) return;
      onViewChange?.('objects');
      onNavigate?.({ objectId });
    });
  };

  // Every island opens with the same 50px header, so the title line sits
  // level with the sidebar's Space row whichever view is showing.
  if (!selected) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        {/* The title is the list's, beside: this side keeps only the line. */}
        <div className="h-[50px] flex-shrink-0 border-b border-border/60" />
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
          onNavigateObject={openObjectFromReader}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground" role="status">
          <p>{t(detail ? 'This Element is no longer available.' : 'Opening…')}</p>
          {detail && <Button variant="ghost" onClick={refresh}>{t('Retry')}</Button>}
        </div>
      ) : selected.question_ticket_id ? (
        // The question, and beside it the work it rests: what came in, what
        // was drafted, what is left to do. Deciding who takes a complaint
        // should not mean opening another notification to read it. On a
        // narrow pane the work follows the question instead.
        <div className="flex min-h-0 flex-1 flex-col overflow-auto xl:flex-row xl:overflow-hidden">
          <article className="w-full shrink-0 px-8 py-10 xl:min-w-0 xl:flex-1 xl:shrink xl:overflow-auto">
            <div className="mx-auto w-full max-w-3xl">
              <QuestionTicketInboxCard key={selected.question_ticket_id} ticketId={selected.question_ticket_id}
                // The list and this pane re-read which questions still wait.
                // The selection is not touched: the answer can land seconds
                // later, when the person is already reading something else.
                // The work beside it is re-read too: the resumed run moves it on.
                onAnswered={() => { refreshInbox(); refreshWork(); refreshAwaitingAnswers(); }}
                onWork={noteWork}
                // The next one opens the way a row does (read, selected).
                nextWaiting={otherWaiting === null ? undefined
                  : otherWaiting.length > 0 ? { count: otherWaiting.length, open: () => { select(otherWaiting[0]); } }
                  : null} />
            </div>
          </article>
          {workElementId && workDetail?.element && (
            <aside aria-label={t('The work this question is about')}
              className="w-full shrink-0 border-t border-border/60 xl:flex xl:w-[46%] xl:min-w-[380px] xl:max-w-[640px] xl:flex-col xl:overflow-hidden xl:border-l xl:border-t-0">
              <ElementDetailView
                key={workElementId} element={workDetail.element} layout="reader"
                domainName={null} objectPath={workDetail.element.objects ?? []}
                onBack={() => selectInboxNotification(null)} onNavigateRoot={() => selectInboxNotification(null)}
                onRefresh={refreshWork}
                onNavigateObject={openObjectFromReader}
              />
            </aside>
          )}
        </div>
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
      ) : selected.promotion_draft_id ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <PromotionReviewInboxCard key={selected.promotion_draft_id} draftId={selected.promotion_draft_id} title={selected.title} body={selected.body} />
        </article>
      ) : selected.kind === 'heartbeat' ? (
        <article className="mx-auto w-full max-w-3xl overflow-auto px-8 py-10">
          <HeartbeatInboxCard key={selected.id} runId={selected.agent_run_id ?? null} title={selected.title} body={selected.body} />
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
