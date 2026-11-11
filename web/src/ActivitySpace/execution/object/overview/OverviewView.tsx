'use client';

import { useState } from 'react';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { updateObject } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/Frame/icons';
import { Plus } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { PageHead, PageLayout, PageSection, PAGE_ACTION_ICON, PAGE_ACTION_ROW } from '@/Function/shared/PageHead';
import { ItemIconButton, useItemLook } from '@/Function/shared/itemIcon/IconPicker';
import { AttachButton } from '@/Function/shared/attachments/AttachButton';
import { AttachmentList } from '@/Function/shared/attachments/AttachmentList';
import { MilestoneList } from '@/Function/shared/milestones/MilestoneList';
import { useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// Object Overview — the Object's own page, laid out as an Element's is:
// its icon, its name, its description, then one row to attach a file with
// the attached files listed right under it, then its milestones.
//
// Nothing here is a widget: the page is the same for every Object.
// =============================================================

interface OverviewViewProps {
  object: AlconObjectWithChildren;
  onRefresh?: () => void;
}

export function OverviewView({ object, onRefresh }: OverviewViewProps) {
  const { t } = useI18n();
  const [look, changeLook] = useItemLook({ icon: object.icon ?? null, color: object.color },
    async (next) => { await updateObject(object.id, next); onRefresh?.(); });
  const [addingMilestone, setAddingMilestone] = useState(false);
  const owner = { kind: 'object' as const, id: object.id };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <PageLayout>
        {/* Keyed by the Object: a draft never carries over to the next one. */}
        <PageHead key={object.id} canEdit
          icon={<ItemIconButton value={look} onChange={changeLook} defaultIcon={<ObjectIcon size={18} />} />}
          title={object.name} description={object.description ?? ''}
          titleLabel={t('Object name')} titlePlaceholder={t('Object name')}
          descriptionLabel={t('Description')} descriptionPlaceholder={t('Add description…')}
          onSaveTitle={async (name) => { await updateObject(object.id, { name }); onRefresh?.(); }}
          onSaveDescription={async (description) => { await updateObject(object.id, { description: description || null }); onRefresh?.(); }} />

        {/* The row under the description, as on an Element: the paperclip,
            and the attached files right under it. */}
        <div className={PAGE_ACTION_ROW}>
          <ButtonAppearanceProvider appearance="inline">
            <div className="flex items-center gap-0.5">
              <AttachButton owner={owner} className={PAGE_ACTION_ICON} />
            </div>
          </ButtonAppearanceProvider>
          <AttachmentList owner={owner} />
        </div>

        <PageSection title={t('Milestones')} action={
          <Button variant="ghost" size="icon-xs" aria-label={t('Add milestone')} title={t('Add milestone')} onClick={() => setAddingMilestone(true)}>
            <Plus size={14} />
          </Button>
        }>
          <MilestoneList objectIds={[object.id]} objectId={object.id} adding={addingMilestone} onAddingChange={setAddingMilestone} />
        </PageSection>
      </PageLayout>
    </div>
  );
}
