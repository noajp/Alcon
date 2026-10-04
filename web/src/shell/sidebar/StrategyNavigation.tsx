'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { SidebarRow, SidebarRowAction } from '@/Function/shared/SidebarRow';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The Strategy mode's navigation: the Vision row with Portfolio and
// Initiative nested under it — the same SidebarRow as a Domain in Execution
// (name, a chevron that folds the children, a "…" that opens its settings).
// Phase and Timeline stay routable from an Initiative but are not listed.
export function StrategyNavigation({ activeView, onSelect, onOpenSettings }: {
  activeView: string;
  onSelect: (view: string) => void;
  /** Opens the Strategy settings modal. */
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  // A child becoming current (⌘K, a link) unfolds the row so the current
  // page is never hidden — the same as a Domain unfolding for its Object.
  const [seenView, setSeenView] = useState(activeView);
  if (activeView !== seenView) {
    setSeenView(activeView);
    if (activeView === 'portfolio' || activeView === 'strategy') setExpanded(true);
  }
  const rootActive = activeView === 'vision';
  const { icon: RootIcon, label: rootLabel } = VIEW_REGISTRY.vision;
  return <nav aria-label={t('Strategy')} className="mb-1 mt-1">
    <SidebarRow active={rootActive} icon={RootIcon && <RootIcon size={16} />} label={t(rootLabel)} onClick={() => onSelect('vision')}
      actions={<>
        <SidebarRowAction label={`${t(expanded ? 'Collapse' : 'Expand')} ${t(rootLabel)}`} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </SidebarRowAction>
        <SidebarRowAction label={t('Strategy settings')} onClick={onOpenSettings}><MoreHorizontal size={12} /></SidebarRowAction>
      </>} />
    {expanded && <div className="mt-0.5 pl-7">
      {(['portfolio', 'strategy'] as const).map((id) => {
        const { icon: Icon, label } = VIEW_REGISTRY[id];
        return <SidebarRow key={id} active={activeView === id} icon={Icon && <Icon size={16} />} label={t(label)} onClick={() => onSelect(id)} />;
      })}
    </div>}
  </nav>;
}
