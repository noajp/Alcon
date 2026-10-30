'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/ui/button';
import { NavStrategyIcon, NavPhaseIcon, NavTimelineIcon, NavVisionIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { deleteVision, updateVision } from '@/hooks/visionData';
import type { Vision } from '@/types/database';
import { SettingsModal } from './SettingsModal';
import { FONT } from '@/shared/designTokens';
import { InitiativeJudgementSettings, PhaseDefaultsSettings, TimelineDisplaySettings } from './StrategySettingsPanels';

type VisionTab = 'general' | 'initiative' | 'phase' | 'timeline';

// Opened from a Vision row's "…" in the sidebar — the Strategy counterpart
// of a Domain's settings modal: the Vision itself (name, delete), then how
// Initiatives are judged, Phases seeded and the Timeline drawn.
export function StrategySettingsModal({ vision, canEdit, onClose, onDeleted }: {
  vision: Vision;
  /** The viewer wrote the Vision or owns the Space — the rule RLS enforces. */
  canEdit: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<VisionTab>('general');
  const titles: Record<VisionTab, string> = { general: t('General'), initiative: t('Initiative'), phase: t('Phase'), timeline: t('Timeline') };
  return (
    <SettingsModal
      mark={<NavVisionIcon size={20} />}
      title={vision.name}
      subtitle={t('Vision settings')}
      onClose={onClose}
      sections={[
        { id: 'general', icon: <Settings size={15} />, title: titles.general, description: t('Name and deletion') },
        { id: 'initiative', icon: <NavStrategyIcon size={15} />, title: titles.initiative, description: t('How Initiatives are judged') },
        { id: 'phase', icon: <NavPhaseIcon size={15} />, title: titles.phase, description: t('How Phases divide time') },
        { id: 'timeline', icon: <NavTimelineIcon size={15} />, title: titles.timeline, description: t('How the Timeline is drawn') },
      ]}
      active={tab}
      onSelect={(id) => setTab(id as VisionTab)}
    >
      <h3 className={`mb-4 ${FONT.lg} text-foreground`}>{titles[tab]}</h3>
      {tab === 'general' ? <VisionGeneral key={vision.id} vision={vision} canEdit={canEdit} onDeleted={onDeleted} />
        : tab === 'initiative' ? <InitiativeJudgementSettings />
        : tab === 'phase' ? <PhaseDefaultsSettings />
        : <TimelineDisplaySettings />}
    </SettingsModal>
  );
}

function VisionGeneral({ vision, canEdit, onDeleted }: { vision: Vision; canEdit: boolean; onDeleted: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(vision.name);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const next = name.trim();
    if (!next || next === vision.name) { setName(vision.name); return; }
    try { await updateVision(vision.id, { name: next }); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : t("Couldn't save")); setName(vision.name); }
  };
  const remove = async () => {
    if (!await appDialog.confirm(t('Delete the Vision "{name}"? Its Portfolios are deleted with it; its Initiatives stay, outside any Vision.', { name: vision.name }))) return;
    try { await deleteVision(vision.id); onDeleted(); }
    catch (e) { setError(e instanceof Error ? e.message : t("Couldn't save")); }
  };
  return (
    <div className="space-y-6">
      <div>
        <label className="mb-1.5 block text-[12px] font-semibold text-foreground" htmlFor="vision-name">{t('Name')}</label>
        <input id="vision-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          className="w-full rounded-md bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:bg-muted/70 disabled:opacity-60" />
        {!canEdit && <p className="mt-1.5 text-[11px] text-muted-foreground">{t("Only the Vision's author or a Space owner can change it.")}</p>}
      </div>
      {error && <div className="text-[11px] text-destructive">{error}</div>}
      <div className="flex items-center justify-between gap-4 pt-4">
        <div>
          <div className="text-[12px] font-semibold text-foreground">{t('Delete Vision')}</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Its Portfolios are deleted with it; its Initiatives stay, outside any Vision.')}</p>
        </div>
        <Button variant="danger" disabled={!canEdit} onClick={() => void remove()}>{t('Delete')}</Button>
      </div>
    </div>
  );
}
