'use client';

import type { ComponentProps, ReactNode } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { MoreHorizontal } from '@/ui/icons';
import { VIEW_REGISTRY } from '@/shell/viewRegistry';
import { SidebarRow, SidebarRowAction } from '@/Function/shared/SidebarRow';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function DomainNavigationRow({ name, mark, active, expanded, activeView, onOpen, onToggle, onSelect, onSettings, dragProps }: {
  name: string; mark: ReactNode; active: boolean; expanded: boolean; activeView: string;
  onOpen: () => void; onToggle: () => void; onSelect: (view: string) => void;
  onSettings?: () => void; dragProps?: ComponentProps<'button'>;
}) {
  const { t } = useI18n();
  return <div>
    <SidebarRow active={active && activeView === 'domain-overview'} icon={mark} label={name} title={name}
      onClick={onOpen} buttonProps={dragProps}
      actions={<>
        <SidebarRowAction label={t(expanded ? 'Collapse {name}' : 'Expand {name}', { name })} aria-expanded={expanded} onClick={onToggle}>
          <DisclosureTriangle open={expanded} />
        </SidebarRowAction>
        {onSettings
          ? <SidebarRowAction label={`${name} settings`} onClick={onSettings}><MoreHorizontal size={12} /></SidebarRowAction>
          : <span aria-hidden className="size-6 shrink-0" />}
      </>} />
    {expanded && <div className="mt-0.5 pl-7">
      {/* No "Objects" row: the Domain's own page already lists them. */}
      {(['domain-elements'] as const).map(id => {
        const { icon: Icon, label } = VIEW_REGISTRY[id];
        return <SidebarRow key={id} active={active && activeView === id} icon={Icon && <Icon size={16} />} label={t(label)} onClick={() => onSelect(id)} />;
      })}
    </div>}
  </div>;
}
