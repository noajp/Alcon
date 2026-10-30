'use client';

import React from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';

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
    <section className="mb-10" aria-label={title || undefined}>
      {(title || description) && (
        <div className="mb-2">
          {title && <h2 className={`${FONT.lg} text-foreground`}>{title}</h2>}
          {description && (
            <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      )}
      <div>{children}</div>
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
    <div className={className ?? "flex items-center justify-between gap-4 py-3"}>
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
    <div className="py-3">
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
    <p className="py-3 text-[13px] text-muted-foreground">
      {t('{title} settings are coming soon.', { title })}
    </p>
  );
}
