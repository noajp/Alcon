'use client';

import { useMemo, useState } from 'react';
import { Search } from '@/ui/icons';
import {
  SETTINGS_NAV,
  isLonePage,
  useActiveSettingsSection,
  setActiveSettingsSection,
  type SettingsNavItem,
} from './settingsNav';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';


// The Settings navigation rendered INSIDE the AppSidebar (it replaces the
// Activity Space tree while Settings mode is active). One row is one page;
// a section that is a single page under its own name shows the row alone.
export function SettingsSidebarPanel() {
  const { t } = useI18n();
  const active = useActiveSettingsSection();
  const [query, setQuery] = useState('');

  // Search matches a page by its row label, its page heading, what it holds
  // or its section, so "Element" finds the three Element pages and
  // "Timeline" finds Strategy.
  const filtered = useMemo((): { title: string; items: SettingsNavItem[] }[] => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_NAV;
    return SETTINGS_NAV
      .map((s) => ({
        title: s.title,
        items: t(s.title).toLowerCase().includes(q)
          ? s.items
          : s.items.filter((item) => [item.label, item.title ?? '', ...(item.holds ?? [])].some((x) => t(x).toLowerCase().includes(q))),
      }))
      .filter((s) => s.items.length > 0);
  }, [query, t]);

  return (
    <div className="pt-1">
      <div className="pb-2">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search settings…')}
            className="w-full h-8 pl-[35px] pr-2.5 text-[12px] bg-muted/40 rounded-md placeholder:text-muted-foreground/60 border-none"
          />
        </div>
      </div>

      {filtered.map((section) => (
        <div key={section.title} className="mb-3">
          {!isLonePage(section.title) && <SidebarSectionLabel className="mb-1">{t(section.title)}</SidebarSectionLabel>}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <SidebarRow
                  key={item.id}
                  active={active === item.id}
                  icon={<Icon size={16} />}
                  label={t(item.label)}
                  onClick={() => setActiveSettingsSection(item.id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
