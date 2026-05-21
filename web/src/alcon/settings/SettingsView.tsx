'use client';

import { useState } from 'react';
import { User, KeyRound, Palette } from 'lucide-react';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { AppearanceSettings } from './AppearanceSettings';

type SettingsTab = 'profile' | 'account' | 'appearance';

const TABS: { id: SettingsTab; label: string; icon: typeof User; desc: string }[] = [
  { id: 'profile',    label: 'Profile',    icon: User,     desc: 'Your name and avatar' },
  { id: 'account',    label: 'Account',    icon: KeyRound, desc: 'Email and password' },
  { id: 'appearance', label: 'Appearance', icon: Palette,  desc: 'Theme and display' },
];

export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>('profile');

  return (
    <div className="h-full flex overflow-hidden bg-card">
      {/* Left rail */}
      <aside className="w-60 flex-shrink-0 border-r border-border/40 py-6 px-3 overflow-y-auto">
        <div className="px-2 mb-4">
          <h1 className="text-[15px] font-semibold text-foreground tracking-tight">Settings</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">Manage your workspace</p>
        </div>
        <nav className="space-y-0.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] transition-colors duration-100 ${
                  active
                    ? 'bg-sidebar-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                }`}
              >
                <Icon size={14} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <section className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          {tab === 'profile' && <ProfileSettings />}
          {tab === 'account' && <AccountSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
        </div>
      </section>
    </div>
  );
}
