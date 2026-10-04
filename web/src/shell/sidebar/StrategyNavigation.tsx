'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Vision } from '@/types/database';

// The Strategy mode's navigation: one row per Vision with Portfolio and
// Initiative nested under it — the same tree as Execution's Domain with its
// Objects and Elements (name, a chevron that folds the children, a "…" that
// opens its settings). Phase and Timeline stay routable from an Initiative
// but are not listed.
export function StrategyNavigation({ visions, activeVisionId, activeView, onSelect, onOpenSettings }: {
  visions: Vision[];
  /** The Vision the Strategy pages are showing. */
  activeVisionId: string | null;
  activeView: string;
  onSelect: (visionId: string, view: 'vision' | 'portfolio' | 'strategy') => void;
  onOpenSettings: (visionId: string) => void;
}) {
  const { t } = useI18n();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // The active Vision's children are never hidden behind a fold made earlier.
  const [seen, setSeen] = useState(`${activeVisionId}:${activeView}`);
  if (seen !== `${activeVisionId}:${activeView}`) {
    setSeen(`${activeVisionId}:${activeView}`);
    if (activeVisionId && (activeView === 'portfolio' || activeView === 'strategy') && folded.has(activeVisionId)) {
      setFolded((prev) => { const n = new Set(prev); n.delete(activeVisionId); return n; });
    }
  }
  const { icon: VisionIcon } = VIEW_REGISTRY.vision;
  if (visions.length === 0) {
    return <div className="px-2.5 py-6 text-[11px] leading-relaxed text-muted-foreground/60">{t('No Vision yet — click + to add one.')}</div>;
  }
  return <nav aria-label={t('Strategy')} className="mb-1 mt-1">
    {visions.map((vision) => {
      const active = vision.id === activeVisionId;
      const rootActive = active && activeView === 'vision';
      const expanded = !folded.has(vision.id);
      return <div key={vision.id} className="mb-0.5">
        <div className={`flex min-w-0 items-center rounded-md ${rootActive ? 'bg-sidebar-accent' : ''}`}>
          <Button variant="ghost" size="md" align="start" onClick={() => onSelect(vision.id, 'vision')} title={vision.name}
            aria-current={rootActive ? 'page' : undefined}
            className={`min-w-0 flex-1 gap-2.5 text-xs font-semibold ${rootActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {VisionIcon && <span className="shrink-0"><VisionIcon size={16} /></span>}<span className="truncate">{vision.name}</span>
          </Button>
          <Button variant="ghost" size="icon-sm"
            onClick={() => setFolded((prev) => { const n = new Set(prev); if (n.has(vision.id)) n.delete(vision.id); else n.add(vision.id); return n; })}
            aria-label={`${t(expanded ? 'Collapse' : 'Expand')} ${vision.name}`} aria-expanded={expanded}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => onOpenSettings(vision.id)} aria-label={`${vision.name} — ${t('Vision settings')}`} className="mr-1"><MoreHorizontal size={12} /></Button>
        </div>
        {expanded && <div className="mt-0.5 pl-7">
          {(['portfolio', 'strategy'] as const).map((id) => {
            const { icon: Icon, label } = VIEW_REGISTRY[id];
            const current = active && activeView === id;
            return <Button key={id} variant="ghost" size="md" align="start" aria-current={current ? 'page' : undefined}
              className={`w-full gap-2.5 text-xs font-semibold ${current ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => onSelect(vision.id, id)}>{Icon && <Icon size={16} />}{t(label)}</Button>;
          })}
        </div>}
      </div>;
    })}
  </nav>;
}
