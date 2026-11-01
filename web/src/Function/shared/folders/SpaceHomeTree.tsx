'use client';

import { useState, type ComponentType } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { SidebarRow, SidebarRowAction } from '@/Function/shared/SidebarRow';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useActivitySpaces } from '@/Function/space/data';

/** One place under the Space's row ("Folders", "Files"). */
export interface SpaceHomeItem { id: string; label: string; icon: ComponentType<{ size?: number }>; active: boolean; onClick: () => void }

/** The Space's mark: its logo (an emoji or a picture) or its initial. */
function SpaceMark({ name, logo }: { name: string; logo: string | null }) {
  if (logo && /^\p{Emoji}/u.test(logo) && logo.length <= 4) return <span className="text-[13px] leading-none">{logo}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  if (logo) return <img src={logo} alt="" className="size-4 rounded object-cover" />;
  return <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">{name.charAt(0).toUpperCase()}</span>;
}

/**
 * A tool's sidebar the way Execution's is: the Space as one row (its name
 * opens the Space's home, the triangle folds), and under it the places the
 * tool has — Folders and its own list (Files, Tables) — each a page of the
 * main pane. As a Domain opens onto Objects and Elements, the Space opens
 * onto its folders and its things.
 */
export function SpaceHomeTree({ homeActive, onOpenHome, items }: { homeActive: boolean; onOpenHome: () => void; items: SpaceHomeItem[] }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const space = useActivitySpaces().data.find((s) => s.id === spaceId);
  const name = space?.name ?? '';
  const [open, setOpen] = useState(true);
  return (
    <div>
      <SidebarRow active={homeActive} icon={<SpaceMark name={name} logo={space?.logo ?? null} />} label={name} title={name} onClick={onOpenHome}
        actions={<SidebarRowAction label={t(open ? 'Collapse {name}' : 'Expand {name}', { name })} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <DisclosureTriangle open={open} />
        </SidebarRowAction>} />
      {open && <div className="mt-0.5 pl-7">
        {items.map(({ id, label, icon: Icon, active, onClick }) => (
          <SidebarRow key={id} active={active} icon={<Icon size={16} />} label={label} onClick={onClick} />
        ))}
      </div>}
    </div>
  );
}
