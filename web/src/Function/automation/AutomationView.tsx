'use client';

import { MainIsland } from '@/Function/shared/MainIsland';
import { NavAutomationIcon } from '@/Frame/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useAutomations } from '@/hooks/automationData';
import { AutomationSettings } from './AutomationSettings';

// The main Automation screen, in its post-837 home: Automation moved
// into Settings (AutomationSettings is the surface — the automations
// with their builder, and what each Strategy's work does when a run
// finishes), and this host is that same surface under the main island's
// header, for a tab that still carries the 'automation' view (kept
// tabs from before the move, and any route that names it). One surface,
// two frames — never a second Automation screen.

export function AutomationView({ onOpenElement }: {
  onOpenElement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const automations = useAutomations(spaceId);
  return (
    <MainIsland
      crumbs={[{ id: 'automation', label: t('Automation'), icon: <NavAutomationIcon size={14} /> }]}
      count={automations.data.length}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <AutomationSettings onOpenElement={onOpenElement} />
      </div>
    </MainIsland>
  );
}
