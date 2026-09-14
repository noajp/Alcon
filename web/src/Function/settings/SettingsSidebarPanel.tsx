'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  SETTINGS_NAV,
  useActiveSettingsSection,
  setActiveSettingsSection,
} from './settingsNav';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The Settings navigation rendered INSIDE the AppSidebar (it replaces the
// Activity Space tree while Settings mode is active). Selecting an item just
// updates the shared store; SettingsView reacts and swaps its content panel.
export function SettingsSidebarPanel() {
  const { t } = useI18n();
  const active = useActiveSettingsSection();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SETTINGS_NAV;
    return SETTINGS_NAV
      .map((s) => ({ ...s, items: s.items.filter((i) => t(i.label).toLowerCase().includes(q)) }))
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
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSettingsSection(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{t(item.label)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
