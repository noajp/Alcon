'use client';

import React from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="rounded-lg border border-border/60 bg-card divide-y divide-border/40">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ?? "flex items-center justify-between gap-4 px-4 py-3"}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <label className="block text-[12px] font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>}
    </div>
  );
}

/** The placeholder for a settings surface that has nothing to set yet. */
export function SettingsComingSoon({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-border bg-[var(--surface-rail)]/30 px-6 py-12 text-center">
      <div className="text-[13px] text-muted-foreground">
        {t('{title} settings are coming soon.', { title })}
      </div>
    </div>
  );
}
