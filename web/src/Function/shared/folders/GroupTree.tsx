'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { SidebarRow, SidebarRowAction } from '@/Function/shared/SidebarRow';

/** One place under a group's row ("Folders", "Files"), or one member of it
 *  (a person, with their avatar as `mark` and their load as `meta`). */
export interface GroupTreeItem {
  id: string; label: string; active: boolean; onClick: () => void;
  icon?: ComponentType<{ size?: number }>;
  mark?: ReactNode;
  meta?: ReactNode;
  title?: string;
}

/**
 * One group in a tool's sidebar, the way Execution draws a Domain: its row
 * (the name opens the group's home, the triangle folds) and under it the
 * places the tool has for it — Folders and its own list (Files, Tables) —
 * each a page of the main pane. As a Domain opens onto Objects and
 * Elements, it opens onto its folders and its things.
 */
export function GroupTree({ name, mark, homeActive, onOpenHome, items, defaultOpen = false }: {
  name: string; mark: ReactNode; homeActive: boolean; onOpenHome: () => void; items: GroupTreeItem[]; defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <SidebarRow active={homeActive} icon={mark} label={name} title={name} onClick={onOpenHome}
        actions={<SidebarRowAction label={t(open ? 'Collapse {name}' : 'Expand {name}', { name })} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <DisclosureTriangle open={open} />
        </SidebarRowAction>} />
      {open && <div className="mt-0.5 pl-7">
        {items.map(({ id, label, icon: Icon, mark, meta, title, active, onClick }) => (
          <SidebarRow key={id} active={active} icon={mark ?? (Icon && <Icon size={16} />)} label={label} meta={meta} title={title} onClick={onClick} />
        ))}
      </div>}
    </div>
  );
}
