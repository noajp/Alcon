'use client';

import { useState } from 'react';
import { NavStrategyIcon, NavPhaseIcon, NavTimelineIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SettingsModal } from './SettingsModal';
import { InitiativeJudgementSettings, PhaseDefaultsSettings, TimelineDisplaySettings } from './StrategySettingsPanels';

type StrategyTab = 'initiative' | 'phase' | 'timeline';

// Opened from the Initiatives row's "…" in the sidebar — the Strategy
// counterpart of a Domain's settings modal, one section per Strategy unit.
export function StrategySettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<StrategyTab>('initiative');
  const titles: Record<StrategyTab, string> = { initiative: t('Initiative'), phase: t('Phase'), timeline: t('Timeline') };
  return (
    <SettingsModal
      mark={<NavStrategyIcon size={20} />}
      title={t('Strategy')}
      subtitle={t('Strategy settings')}
      onClose={onClose}
      sections={[
        { id: 'initiative', icon: <NavStrategyIcon size={15} />, title: titles.initiative, description: t('How Initiatives are judged') },
        { id: 'phase', icon: <NavPhaseIcon size={15} />, title: titles.phase, description: t('How Phases divide time') },
        { id: 'timeline', icon: <NavTimelineIcon size={15} />, title: titles.timeline, description: t('How the Timeline is drawn') },
      ]}
      active={tab}
      onSelect={(id) => setTab(id as StrategyTab)}
    >
      <h3 className="mb-4 text-[15px] font-semibold text-foreground">{titles[tab]}</h3>
      {tab === 'initiative' ? <InitiativeJudgementSettings /> : tab === 'phase' ? <PhaseDefaultsSettings /> : <TimelineDisplaySettings />}
    </SettingsModal>
  );
}
