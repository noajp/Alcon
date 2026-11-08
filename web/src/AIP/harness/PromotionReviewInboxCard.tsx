'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useIsSpaceOwner } from '@/AIP/connectors/data';
import { useDefinitions } from '@/hooks/definitionData';
import { usePromotionDraft, usePromotionObjectNames } from './promotionData';
import { PromotionDraftDialog } from './PromotionDrafts';

// A promotion waiting in the Inbox (condition 5): the notification says
// a decision or an answer is owed; the card carries the draft's live
// state and opens the same dialog the Harnesses screen opens, so the
// decision is made on the rehearsal's evidence, not on the
// notification's summary of it.
export function PromotionReviewInboxCard({ draftId, title, body }: {
  draftId: string;
  title: string;
  body: string | null;
}) {
  const { t } = useI18n();
  const { data: draft, loading } = usePromotionDraft(draftId);
  const spaceId = draft?.activity_space_id ?? null;
  const definitions = useDefinitions(spaceId);
  const objectNames = usePromotionObjectNames(spaceId);
  const isOwner = useIsSpaceOwner(spaceId) === true;
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
          <Button variant="secondary" onClick={() => setOpen(true)}>{t('Open the draft')}</Button>
        )}
      </div>
      {open && draft && (
        <PromotionDraftDialog
          draft={draft}
          isOwner={isOwner}
          definitions={definitions.data}
          objectNames={objectNames}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
