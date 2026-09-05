'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { CampaignMeasures } from '@/alcon/element/actions/CampaignMeasures';
import { CampaignIntentProvider, useCampaignIntentContext } from '@/alcon/element/actions/CampaignIntent';

/** Reuse the same saved conditions from any strategic lens, even without a Measures widget. */
export function CampaignMeasureEditor({ campaignId, campaignName, children }: {
  campaignId: string;
  campaignName: string;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const campaign = useCampaignIntentContext();
  return (
    <div className="px-3 py-1">
      <Button variant="ghost" size="xs" aria-expanded={editing}
        onClick={() => { setOpened(true); setEditing((value) => !value); }}>
        {editing ? 'Close editor' : 'Edit key results'}
      </Button>
      {!editing && children}
      {opened && <div hidden={!editing}>{campaign?.campaignId === campaignId
        ? <CampaignMeasures campaign={campaign} inlineHeader />
        : <CampaignIntentProvider campaignId={campaignId} campaignName={campaignName}>
            <NestedEditor />
          </CampaignIntentProvider>}</div>}
    </div>
  );
}

function NestedEditor() {
  const campaign = useCampaignIntentContext();
  return campaign ? <CampaignMeasures campaign={campaign} inlineHeader /> : null;
}
