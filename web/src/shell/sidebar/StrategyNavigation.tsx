'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The Strategy mode's navigation: the Initiatives row with Phase and
// Timeline nested under it — the same row anatomy as a Domain in Execution
// (name, a chevron that folds the children, a "…" menu).
export function StrategyNavigation({ activeView, onSelect, onCreate, onOpenSettings }: {
  activeView: string;
  onSelect: (view: string) => void;
  /** Opens the New Initiative dialog (what the sidebar's "+" does in this mode). */
  onCreate: () => void;
  /** Opens Settings on the Strategy pages. */
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={t('Strategy settings')} className="mr-1"><MoreHorizontal size={12} /></Button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="start" width="standard">
          <DropdownMenuItem className={MENU_ROW} onSelect={onCreate}><Plus size={14} />{t('New Initiative')}</DropdownMenuItem>
          <DropdownMenuItem className={MENU_ROW} onSelect={onOpenSettings}><SlidersHorizontal size={14} />{t('Strategy settings')}</DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>
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
