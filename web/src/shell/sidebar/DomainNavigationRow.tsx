'use client';

import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { CONTROL } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function DomainNavigationRow({ name, mark, active, expanded, activeView, onOpen, onToggle, onSelect, onSettings, dragProps }: {
  name: string; mark: ReactNode; active: boolean; expanded: boolean; activeView: string;
  onOpen: () => void; onToggle: () => void; onSelect: (view: string) => void;
  onSettings?: () => void; dragProps?: ComponentProps<typeof Button>;
}) {
  const { t } = useI18n();
  return <div className="group/domain">
    {/* The row is one hover target: the name, the chevron and "…" light up
        together, so the highlight never stops short of the row's own controls.
        The buttons inside paint no ground of their own. */}
    <div className={`flex min-w-0 items-center rounded-md transition-colors ${active && activeView === 'domain-overview' ? 'bg-sidebar-accent' : 'hover:bg-[var(--surface-strong)]'} group/domain-row`}>
      <Button variant="ghost" size="md" align="start" {...dragProps} onClick={onOpen} title={name}
        aria-current={active && activeView === 'domain-overview' ? 'page' : undefined}
        className={`min-w-0 flex-1 gap-2.5 text-xs font-semibold hover:bg-transparent ${active && activeView === 'domain-overview' ? 'text-foreground' : 'text-muted-foreground group-hover/domain-row:text-foreground'}`}><span className="shrink-0">{mark}</span><span className="truncate">{name}</span></Button>
      <Button variant="ghost" size="icon-sm" className="hover:bg-transparent text-muted-foreground hover:text-foreground" onClick={onToggle} aria-label={`${t(expanded ? 'Collapse' : 'Expand')} ${name}`} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </Button>
      {onSettings
        ? <Button variant="ghost" size="icon-xs" onClick={onSettings} aria-label={`${name} settings`} className="mr-1 hover:bg-transparent text-muted-foreground hover:text-foreground"><MoreHorizontal size={12} /></Button>
        : <span aria-hidden className={`mr-1 shrink-0 ${CONTROL.square.xs}`} />}
    </div>
    {expanded && <div className="mt-0.5 pl-7">
      {(['objects', 'domain-elements'] as const).map(id => {
        const { icon: Icon, label } = VIEW_REGISTRY[id];
        return <Button key={id} variant="ghost" size="md" align="start" onClick={() => onSelect(id)} aria-current={active && activeView === id ? 'page' : undefined}
          className={`w-full gap-2.5 text-xs font-semibold ${active && activeView === id ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{Icon && <Icon size={16} />}{t(label)}</Button>;
      })}
    </div>}
  </div>;
}
