'use client';

import { useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { MoreHorizontal, Settings, Trash2 } from '@/ui/icons';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { SidebarRow, SidebarRowAction } from '@/Function/shared/SidebarRow';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Vision } from '@/types/database';
import { deleteVision } from '@/hooks/visionData';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/ui/context-menu';

// The Strategy mode's navigation: one row per Vision with Portfolio and
// Initiative nested under it — the same tree, built from the same SidebarRow,
// as Execution's Domain with its Objects and Elements (name, a chevron that
// folds the children, a "…" that opens its settings; a right-click also
// deletes it). Phase and Timeline stay routable from an Initiative
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
  const remove = async (vision: Vision) => {
    if (!await appDialog.confirm(t('Delete the Vision "{name}"? Its Portfolios are deleted with it; its Initiatives stay, outside any Vision.', { name: vision.name }))) return;
    try { await deleteVision(vision.id); }
    catch (e) { await appDialog.alert(e instanceof Error ? e.message : String(e)); }
  };
  if (visions.length === 0) {
    return null;
  }
  return <nav aria-label={t('Strategy')} className="mb-1 mt-1">
    {visions.map((vision) => {
      const active = vision.id === activeVisionId;
      const rootActive = active && activeView === 'vision';
      const expanded = !folded.has(vision.id);
      return <div key={vision.id} className="mb-0.5">
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <SidebarRow active={rootActive} icon={VisionIcon && <VisionIcon size={16} />} label={vision.name} title={vision.name}
          onClick={() => onSelect(vision.id, 'vision')}
          actions={<>
            <SidebarRowAction label={t(expanded ? 'Collapse {name}' : 'Expand {name}', { name: vision.name })} aria-expanded={expanded}
              onClick={() => setFolded((prev) => { const n = new Set(prev); if (n.has(vision.id)) n.delete(vision.id); else n.add(vision.id); return n; })}>
              <DisclosureTriangle open={expanded} />
            </SidebarRowAction>
            <SidebarRowAction label={`${vision.name} — ${t('Vision settings')}`} onClick={() => onOpenSettings(vision.id)}><MoreHorizontal size={12} /></SidebarRowAction>
          </>} />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onOpenSettings(vision.id)}><Settings size={14} />{t('Vision settings')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove(vision)}><Trash2 size={14} />{t('Delete Vision')}</ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
        {expanded && <div className="mt-0.5 pl-7">
          {(['portfolio', 'strategy'] as const).map((id) => {
            const { icon: Icon, label } = VIEW_REGISTRY[id];
            return <SidebarRow key={id} active={active && activeView === id} icon={Icon && <Icon size={16} />} label={t(label)}
              onClick={() => onSelect(vision.id, id)} />;
          })}
        </div>}
      </div>;
    })}
  </nav>;
}
