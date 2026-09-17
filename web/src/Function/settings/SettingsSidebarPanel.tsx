'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  SETTINGS_NAV,
  useActiveSettingsSection,
  setActiveSettingsSection,
  type SettingsNavItem,
} from './settingsNav';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** A page listed in the nav — opened on `tab` when the search matched one of its tabs. */
interface NavHit { item: SettingsNavItem; tab?: string }

// The Settings navigation rendered INSIDE the AppSidebar (it replaces the
// Activity Space tree while Settings mode is active). Selecting an item just
// updates the shared store; SettingsView reacts and swaps its content panel.
export function SettingsSidebarPanel() {
  const { t } = useI18n();
  const active = useActiveSettingsSection();
  const [query, setQuery] = useState('');

  // Search matches a page by its own label or by one of its tabs, so
  // "Labels" still finds Objects and Elements; picking such a hit opens
  // the page on that tab.
  const filtered = useMemo((): { title: string; items: NavHit[] }[] => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_NAV.map((s) => ({ title: s.title, items: s.items.map((item) => ({ item })) }));
    return SETTINGS_NAV
      .map((s) => ({
        title: s.title,
        items: s.items.flatMap((item): NavHit[] => {
          if (t(item.label).toLowerCase().includes(q)) return [{ item }];
          const tab = item.tabs?.find((x) => t(x.label).toLowerCase().includes(q));
          return tab ? [{ item, tab: tab.id }] : [];
        }),
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
          <div className="px-2.5 mb-1 text-[11px] font-bold tracking-wide text-muted-foreground/60">
            {t(section.title)}
          </div>
          <div className="space-y-0.5">
            {section.items.map(({ item, tab }) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSettingsSection(item.id, tab)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{t(item.label)}</span>
                  {tab && (
                    <span className="ml-auto shrink-0 text-[11px] font-medium text-muted-foreground/70">
                      {t(item.tabs!.find((x) => x.id === tab)!.label)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
