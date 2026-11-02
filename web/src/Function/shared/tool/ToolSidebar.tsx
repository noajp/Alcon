'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { Check, ChevronDown } from '@/ui/icons';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { SidebarRow, SidebarRowAction, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ToolScope } from './toolScope';

// =============================================================
// ToolSidebar — the one sidebar every Sustainment tool is built on (CRM,
// and the tools that come after them). Five slots, top to bottom:
//
//   scope    whose records: the row opens the scope's overview (as a
//            Domain's row opens the Domain), its ▾ only switches scope
//   queue    what needs me now (CRM's Today)
//   sections the collections, each with saved filters as children. A
//            child opens its parent's page with the filter applied — no
//            new screen to learn
//   footer   what changes how the tool behaves (settings, the autopilot):
//            visited to change, not daily
//   groups   the tool's own groups, as Files has them: each Domain
//            unfolding onto its pages (opening one makes it the scope).
//            Always last — nothing of the tool's sits below them; with
//            groups, the footer comes up above them
//
// One rule for numbers: a count means "acting would make this smaller".
// It is red, and hidden at zero — so a row with a number is a row worth
// opening, and the sidebar read top to bottom says where to look today.
// Totals (how many suppliers exist) are never shown here.
// =============================================================

export interface ToolNavItem {
  id: string;
  label: ReactNode;
  icon?: ComponentType<{ size?: number }>;
  /** Actionable work only. Shown in red; zero or null hides it. */
  count?: number | null;
  active?: boolean;
  onClick: () => void;
  /** Saved filters on this collection. */
  children?: ToolNavItem[];
  /** Children folded under "More", opened on demand. */
  more?: ToolNavItem[];
  /** Fold the children away until opened (default open). */
  collapsed?: boolean;
  title?: string;
}

function Count({ value }: { value: number | null | undefined }) {
  if (!value) return null;
  return <span className="text-[var(--status-danger)]">{value}</span>;
}

function NavRow({ item, nested = false }: { item: ToolNavItem; nested?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(!item.collapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const hasChildren = !!(item.children?.length || item.more?.length);
  const Icon = item.icon;
  return <div>
    <SidebarRow size={nested ? 'sm' : 'md'} active={item.active} icon={Icon && <Icon size={nested ? 14 : 16} />} label={item.label} title={item.title}
      meta={<Count value={item.count} />} onClick={item.onClick}
      actions={hasChildren && !nested ? <SidebarRowAction label={t(open ? 'Collapse' : 'Expand')} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <DisclosureTriangle open={open} />
      </SidebarRowAction> : undefined} />
    {open && hasChildren && <div className="mt-0.5 pl-7">
      {item.children?.map(child => <NavRow key={child.id} item={child} nested />)}
      {!!item.more?.length && <>
        <SidebarRow size="sm" label={<span className="text-muted-foreground">{t(moreOpen ? 'Fewer' : 'More')}</span>}
          icon={<DisclosureTriangle open={moreOpen} />} onClick={() => setMoreOpen(v => !v)} />
        {moreOpen && item.more.map(child => <NavRow key={child.id} item={child} nested />)}
      </>}
    </div>}
  </div>;
}

export function ToolSidebar({ title, scope, queue, sections, footer, groups }: {
  /** The tool's name, as the heading. */
  title: string;
  scope: {
    value: ToolScope;
    options: { id: ToolScope; name: string }[];
    label: string;
    icon: ComponentType<{ size?: number }>;
    active: boolean;
    onOpen: () => void;
    onChange: (scope: ToolScope) => void;
  };
  queue?: ToolNavItem[];
  sections: { id: string; label?: string; items: ToolNavItem[] }[];
  footer?: ToolNavItem[];
  /** The tool's groups (each Domain unfolding onto its pages), between the queue and the sections. */
  groups?: ReactNode;
}) {
  const { t } = useI18n();
  const ScopeIcon = scope.icon;
  return <div className="mt-1 flex min-h-full flex-col pb-4">
    <SidebarSectionLabel>{title}</SidebarSectionLabel>
    <div className="mt-1">
      <SidebarRow active={scope.active} icon={<ScopeIcon size={16} />} label={scope.label} onClick={scope.onOpen}
        actions={scope.options.length > 1 ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t('Change scope')} title={t('Change scope')}
              className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground">
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <MenuShell as="dropdown" align="start">
            {scope.options.map(option => <DropdownMenuItem key={option.id ?? 'all'} className="gap-2" onSelect={() => scope.onChange(option.id)}>
              <span className="min-w-0 flex-1 truncate">{option.name}</span>{option.id === scope.value && <Check size={12} />}
            </DropdownMenuItem>)}
          </MenuShell>
        </DropdownMenu> : undefined} />
    </div>

    {queue && queue.length > 0 && <div className="mt-1 space-y-px">{queue.map(item => <NavRow key={item.id} item={item} />)}</div>}


    {sections.map(section => <div key={section.id}>
      {section.label && <SidebarSectionLabel>{section.label}</SidebarSectionLabel>}
      <div className={`${section.label ? 'mt-1' : 'mt-3'} space-y-px`}>{section.items.map(item => <NavRow key={item.id} item={item} />)}</div>
    </div>)}

    {footer && footer.length > 0 && <div className={groups ? 'mt-1 space-y-px' : 'mt-auto space-y-px border-t border-[var(--border-subtle)] pt-3'}>
      {footer.map(item => <NavRow key={item.id} item={item} />)}
    </div>}

    {groups}
  </div>;
}
