'use client';

import type { CrmHealthLevel } from './crmModel';
import { dayIndex } from './crmModel';

/** Currency amounts, compact when asked. Unknown codes fall back to "CODE 1,234". */
export function money(amount: number | null | undefined, currency: string | null | undefined, locale: string, compact = false): string {
  if (amount === null || amount === undefined) return '—';
  if (!currency) return amount.toLocaleString(locale, { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
  }
}

/** Several currencies side by side; they are never added together. */
export function moneyList(values: Record<string, number>, locale: string, compact = true): string {
  const entries = Object.entries(values).filter(([, value]) => value);
  return entries.length ? entries.map(([currency, value]) => money(value, currency, locale, compact)).join(' · ') : '—';
}

/** "Today", "Tomorrow", "3 days ago", or a short date. */
export function relativeDay(value: string | null, today: string, locale: string, t: (message: string, values?: Record<string, string | number>) => string): string {
  if (!value) return '—';
  const diff = dayIndex(value)! - dayIndex(today)!;
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Tomorrow');
  if (diff === -1) return t('Yesterday');
  if (diff < 0 && diff > -14) return t('{n} days ago', { n: -diff });
  if (diff > 0 && diff < 7) return t('In {n} days', { n: diff });
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC', ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

const HEALTH_COLOR: Record<CrmHealthLevel, string> = {
  healthy: 'var(--status-success)', watch: 'var(--status-warning)', risk: 'var(--status-danger)',
  closed: 'var(--text-tertiary)', incomplete: 'var(--text-tertiary)',
};
const HEALTH_LABEL: Record<CrmHealthLevel, string> = {
  healthy: 'Healthy', watch: 'Watch', risk: 'At risk', closed: 'Closed', incomplete: 'Incomplete',
};

export function HealthDot({ level, className = '' }: { level: CrmHealthLevel; className?: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${className}`} style={{ background: HEALTH_COLOR[level] }} />;
}

export function HealthBadge({ level, score, t }: { level: CrmHealthLevel; score: number | null; t: (message: string) => string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs tabular-nums" style={{ color: HEALTH_COLOR[level] }}>
    <HealthDot level={level} />{t(HEALTH_LABEL[level])}{score !== null && <span className="text-muted-foreground">{score}</span>}
  </span>;
}
