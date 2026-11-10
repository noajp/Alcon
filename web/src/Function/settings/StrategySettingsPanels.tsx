'use client';

import { useCallback, useRef, useState } from 'react';
import { useDomains, updateDomain } from '@/hooks/useSupabase';
import type { Domain, DomainPhaseDefaults } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { PHASE_DEFAULTS_MAX } from '@/Function/shared/phaseDefaults';
import { SlaSettings } from './SlaSettings';
import { SegmentedRow, SettingRow, SettingsIsland } from './SettingsControls';

// The two Strategy settings panels, shared by Settings > Strategy and the
// Strategies row's settings modal.

// ── Strategy — how Strategies are judged ────────────────────────────
// The thresholds are each Domain's risk_thresholds — the numbers the
// Strategy list row, the Strategy page and the due-soon notifications
// all read. One store, one editor, one home: here. (Elements used to
// render a second copy as its SLAs tab; it now points here instead.)
export function InitiativeJudgementSettings() {
  return <SlaSettings />;
}

// ── Phase — how a new Phase is seeded ───────────────────────────────────
type PhaseStart = NonNullable<DomainPhaseDefaults['start']>;
const START_OPTIONS: PhaseStart[] = ['today', 'after_last'];
const START_LABEL: Record<PhaseStart, string> = { today: 'Today', after_last: 'After the last Phase' };

export function PhaseDefaultsSettings() {
  const { t } = useI18n();
  const { data: domains, loading } = useDomains();
  // Same optimistic-per-Domain pattern as SlaSettings: phase_defaults is one
  // jsonb, so writes for a Domain are serialized and a failed save rolls back.
  const [overrides, setOverrides] = useState<Record<string, DomainPhaseDefaults>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [seenDomains, setSeenDomains] = useState(domains);
  if (seenDomains !== domains) {
    setSeenDomains(domains);
    setOverrides((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => pending.has(id))));
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const chains = useRef<Map<string, Promise<void>>>(new Map());

  const save = useCallback((domain: Domain, patch: DomainPhaseDefaults) => {
    const before = overrides[domain.id] ?? domain.phase_defaults ?? {};
    const next: DomainPhaseDefaults = { ...before, ...patch };
    if (patch.length_days === undefined && 'length_days' in patch) delete next.length_days;
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    setOverrides((prev) => ({ ...prev, [domain.id]: next }));
    setErrors((prev) => { const rest = { ...prev }; delete rest[domain.id]; return rest; });
    setPending((prev) => new Set(prev).add(domain.id));
    const prior = chains.current.get(domain.id) ?? Promise.resolve();
    const run: Promise<void> = prior.catch(() => undefined).then(async () => {
      try {
        await updateDomain(domain.id, { phase_defaults: next });
      } catch (e) {
        setOverrides((prev) => ({ ...prev, [domain.id]: before }));
        setErrors((prev) => ({ ...prev, [domain.id]: e instanceof Error ? e.message : t("Couldn't save") }));
      }
    }).finally(() => {
      if (chains.current.get(domain.id) === run) chains.current.delete(domain.id);
      setPending((prev) => { const n = new Set(prev); n.delete(domain.id); return n; });
    });
    chains.current.set(domain.id, run);
  }, [overrides, t]);

  if (!loading && domains.length === 0) {
    return <p className="text-[12px] text-muted-foreground">{t('No Domains in this Space yet. Phase defaults are set per Domain.')}</p>;
  }
  return (
    <div className="space-y-6">
      <p className="-mt-2 text-[12px] text-muted-foreground">{t('How a new Phase starts out in each Domain. Leave the length blank to start with empty dates.')}</p>
      {domains.map((domain) => {
        const current = overrides[domain.id] ?? domain.phase_defaults ?? {};
        return (
          <SettingsIsland key={domain.id} title={domain.name}>
            <SettingRow label={t('Default length')} desc={t('Days a new Phase spans, end date included')}>
              <DaysInput key={`len:${current.length_days ?? ''}`} value={current.length_days} max={PHASE_DEFAULTS_MAX.length_days}
                unit={t('days')} disabled={pending.has(domain.id)} onCommit={(v) => save(domain, { length_days: v })} />
            </SettingRow>
            <SegmentedRow label={t('Start')} desc={t('Where a new Phase begins')}
              value={START_LABEL[current.start === 'after_last' ? 'after_last' : 'today']}
              options={START_OPTIONS.map((o) => START_LABEL[o])}
              onChange={(label) => save(domain, { start: START_OPTIONS.find((o) => START_LABEL[o] === label) ?? 'today' })} />
            {errors[domain.id] && <div className="px-5 py-2 text-[11px] text-destructive">{errors[domain.id]}</div>}
          </SettingsIsland>
        );
      })}
    </div>
  );
}

// A whole-number field that commits on blur / Enter, cancels on Escape;
// empty commits undefined (= no default). Same rules as SlaSettings.
const PLAIN_DIGITS = /^\d+$/;
function DaysInput({ value, max, unit, disabled, onCommit }: {
  value: number | undefined; max: number; unit: string; disabled?: boolean; onCommit: (v: number | undefined) => void;
}) {
  const initial = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const trimmed = draft.trim();
    if (trimmed === '') { onCommit(undefined); return; }
    if (!PLAIN_DIGITS.test(trimmed)) { setDraft(initial); return; }
    const n = Number(trimmed);
    if (n <= 0 || n > max) { setDraft(initial); return; }
    onCommit(n);
  };
  return (
    <div className="flex items-center gap-2">
      <input type="number" inputMode="numeric" min={1} max={max} step={1} value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(initial); cancelled.current = true; e.currentTarget.blur(); }
        }}
        className="w-20 rounded-md bg-muted/40 px-2 py-1 text-right text-[12px] tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:bg-muted/70 disabled:opacity-50" />
      <span className="w-10 text-[11px] text-muted-foreground">{unit}</span>
    </div>
  );
}
