'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ScmHealth } from './scmEngine';
import { HEALTH_LABEL, HEALTH_TONE } from './scmText';
import type { ScmView, ScmViewCounts } from './scmNavigation';

// Small pieces every SCM pane shares, so tone, spacing and number styling stay
// one decision.

const TONE_TEXT = {
  danger: 'text-[var(--status-danger)]', warning: 'text-[var(--status-warning)]', success: 'text-[var(--status-success)]',
  info: 'text-[var(--accent-default)]', muted: 'text-muted-foreground',
} as const;
const TONE_BG = {
  danger: 'bg-[var(--status-danger-subtle)]', warning: 'bg-[var(--status-warning-subtle)]', success: 'bg-[var(--status-success-subtle)]',
  info: 'bg-[var(--accent-subtle)]', muted: 'bg-muted',
} as const;
export const TONE_FILL = {
  danger: 'bg-[var(--status-danger)]', warning: 'bg-[var(--status-warning)]', success: 'bg-[var(--status-success)]',
  info: 'bg-[var(--accent-default)]', muted: 'bg-[var(--border-strong)]',
} as const;
export type Tone = keyof typeof TONE_TEXT;

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}>{children}</span>;
}

export function HealthBadge({ health }: { health: ScmHealth }) {
  const { t } = useI18n();
  return <Pill tone={HEALTH_TONE[health]}>{t(HEALTH_LABEL[health])}</Pill>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${TONE_FILL[tone]}`} />;
}

export function Kpi({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone }) {
  return <div className="min-w-0 space-y-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2.5">
    <p className="truncate text-xs text-muted-foreground">{label}</p>
    <p className={`truncate text-xl font-semibold tabular-nums ${tone ? TONE_TEXT[tone] : ''}`}>{value}</p>
    {detail && <p className="truncate text-[11px] text-muted-foreground">{detail}</p>}
  </div>;
}

export function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
    {children}
  </section>;
}

export function Meter({ value, tone = 'info', label }: { value: number; tone?: Tone; label: string }) {
  const width = Math.max(0, Math.min(1, value)) * 100;
  return <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div className={`h-full rounded-full ${TONE_FILL[tone]}`} style={{ width: `${width}%` }} />
  </div>;
}

export const SCM_INPUT = 'h-8 w-full min-w-0 rounded-md border border-[var(--border-default)] bg-transparent px-2 text-sm hover:bg-muted/40 focus:bg-muted/60 disabled:opacity-50';
/** An inline filter select: sized to its content, never full width. */
export const SCM_SELECT_INLINE = `${SCM_INPUT.replace('w-full ', '')} w-auto max-w-64 text-foreground`;
export const SCM_LABEL = 'block space-y-1 text-xs text-muted-foreground';
export const SCM_ROW = 'w-full rounded-md text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted';

/** Which Domain a location, supplier or item belongs to. Blank = shared by the Space. */
export function ScmDomainSelect({ value, onChange, domains, label, disabled, className = SCM_INPUT }: {
  value: string | null; onChange: (value: string | null) => void; domains: { id: string; name: string }[]; label: string; disabled?: boolean; className?: string;
}) {
  const { t } = useI18n();
  return <select aria-label={label} disabled={disabled} className={`${className} text-foreground`} value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
    <option value="">{t('Shared by the Space')}</option>
    {domains.map(domain => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
    {value && !domains.some(domain => domain.id === value) && <option value={value}>{t('Unknown Domain')}</option>}
  </select>;
}

/** A pane's count, as its tab shows it: urgent work in red, drafts awaiting
 *  approval in amber, the rest quiet. */
export function ScmViewBadge({ view, counts }: { view: ScmView; counts: ScmViewCounts }) {
  const { t } = useI18n();
  if (view === 'exceptions' && counts.exceptions) return <span className={counts.urgent ? 'text-[var(--status-danger)]' : undefined}>{counts.exceptions}</span>;
  if (view === 'replenish' && counts.replenish) return <>{counts.replenish}</>;
  if (view === 'orders' && (counts.orders || counts.drafts)) return <span className="inline-flex items-center gap-1.5">
    {counts.drafts > 0 && <span className="text-[var(--status-warning)]" title={t('Awaiting approval')}>{counts.drafts}</span>}
    <span className={counts.overdue ? 'text-[var(--status-danger)]' : undefined} title={counts.overdue ? t('{n} overdue', { n: counts.overdue }) : undefined}>{counts.orders}</span>
  </span>;
  if (view === 'inventory' && counts.inventory) return <>{counts.inventory}</>;
  if (view === 'suppliers' && counts.suppliers) return <>{counts.suppliers}</>;
  return null;
}
