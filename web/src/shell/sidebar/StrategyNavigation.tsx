'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The Strategy mode's navigation: the Initiatives row with Phase and
// Timeline nested under it — the same row anatomy as a Domain in Execution
// (name, a chevron that folds the children, a "…" that opens its settings).
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
    if (activeView === 'phase' || activeView === 'timeline') setExpanded(true);
  }
  const rootActive = activeView === 'strategy';
  const { icon: RootIcon, label: rootLabel } = VIEW_REGISTRY.strategy;
  return <nav aria-label={t('Initiatives')} className="mb-1 mt-1">
    <div className={`flex min-w-0 items-center rounded-md ${rootActive ? 'bg-sidebar-accent' : ''}`}>
      <Button variant="ghost" size="md" align="start" onClick={() => onSelect('strategy')}
        aria-current={rootActive ? 'page' : undefined}
        className={`min-w-0 flex-1 gap-2.5 text-xs font-semibold ${rootActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
        {RootIcon && <RootIcon size={16} />}<span className="truncate">{t(rootLabel)}</span>
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setExpanded((v) => !v)}
        aria-label={`${t(expanded ? 'Collapse' : 'Expand')} ${t(rootLabel)}`} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onOpenSettings} aria-label={t('Strategy settings')} className="mr-1"><MoreHorizontal size={12} /></Button>
    </div>
    {expanded && <div className="mt-0.5 pl-7">
      {(['phase', 'timeline'] as const).map((id) => {
        const { icon: Icon, label } = VIEW_REGISTRY[id];
        return <Button key={id} variant="ghost" size="md" align="start" aria-current={activeView === id ? 'page' : undefined}
          className={`w-full gap-2.5 text-xs font-semibold ${activeView === id ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => onSelect(id)}>{Icon && <Icon size={16} />}{t(label)}</Button>;
      })}
    </div>}
  </nav>;
}
