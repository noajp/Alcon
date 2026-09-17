'use client';

import type React from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The settings modal used by a Domain row's "…" and the Initiatives row's
// "…": a 50px header (the same height as an island header), a left column
// of sections, and a panel that scrolls on its own.

export interface SettingsModalSection {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function SettingsModal({ mark, title, subtitle, onClose, sections, active, onSelect, children }: {
  mark: React.ReactNode;
  title: string;
  subtitle: string;
  onClose: () => void;
  sections: SettingsModalSection[];
  active: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6">
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] sm:max-h-[86vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-border/60 pl-4 pr-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {mark}
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="truncate text-[13px] font-semibold text-foreground">{title}</h2>
              <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('Close')}
          >
            <X size={15} />
          </button>
        </div>

        {/* Fixed height (not min-height) on the desktop two-column layout —
            sections carry very different amounts of content, and a
            min-height let the whole modal resize under the viewer's cursor
            when switching. Each pane scrolls its own overflow instead. */}
        <div className="flex min-h-0 flex-col sm:flex-row sm:h-[480px] overflow-hidden">
          <aside className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-border p-3 flex flex-wrap sm:block gap-2">
            {sections.map((s) => (
              <SettingsTabButton key={s.id} active={active === s.id} icon={s.icon} title={s.title} description={s.description} onClick={() => onSelect(s.id)} />
            ))}
          </aside>
          <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function SettingsTabButton({ active, icon, title, description, onClick }: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground/70" />
    </button>
  );
}
