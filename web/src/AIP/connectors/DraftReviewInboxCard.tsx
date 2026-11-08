'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DRAFT_STATUS_LABELS } from './draftModel';
import { useIntegrationDraft } from './draftData';
import { useIntegrations, useIsSpaceOwner } from './data';
import { IntegrationDraftDialog } from './IntegrationDraftDialog';

// A drafted connection waiting in the Inbox (G4 §4.9): the notification
// says a review is owed; the card carries the draft's live state and
// opens the same review dialog the Settings screen opens, so the
// decision is made on the tested evidence, not on the notification's
// summary of it.
export function DraftReviewInboxCard({ draftId, title, body }: {
  draftId: string;
  title: string;
  body: string | null;
}) {
  const { t } = useI18n();
  const { draft, loading } = useIntegrationDraft(draftId);
  const spaceId = draft?.activity_space_id ?? null;
  const integrations = useIntegrations(spaceId);
  const isOwner = useIsSpaceOwner(spaceId);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {body && <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{body}</p>}
      <div className="mt-6 flex items-center gap-3">
        {loading ? (
          <p className="text-[13px] text-muted-foreground">{t('Opening…')}</p>
        ) : !draft ? (
          <p className="text-[13px] text-muted-foreground">{t('This draft no longer exists.')}</p>
        ) : (
          <>
            <span className="text-[13px] text-muted-foreground">{t(DRAFT_STATUS_LABELS[draft.status])}</span>
            <Button variant="secondary" onClick={() => setOpen(true)}>{t('Open the draft')}</Button>
          </>
        )}
      </div>
      {open && draft && spaceId && (
        <IntegrationDraftDialog
          draft={draft}
          spaceId={spaceId}
          integrations={integrations.data}
          canReview={isOwner === true}
          onClose={() => setOpen(false)}
          onChanged={() => { void integrations.refetch(); }}
        />
      )}
    </div>
  );
}
