'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDomains, updateDomain } from '@/hooks/useSupabase';
import type { Domain, DomainPhaseDefaults } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { PHASE_DEFAULTS_MAX } from '@/ActivitySpace/strategy/phase/phaseDefaults';
import { SlaSettings } from './SlaSettings';
import { SettingsSection, SettingsRow } from './SettingsSection';
import { Group, SelectRow, SelectControl, ToggleRow } from './SettingsControls';
import { useUserPreferences, type UserPreferences } from './useUserPreferences';
import { TIMELINE_MONTHS_BACK_RANGE, TIMELINE_MONTHS_AHEAD_RANGE } from './preferencesStore';

// The three Strategy settings panels, shared by Settings > Strategy and the
// Initiatives row's settings modal.

// ── Initiative — how Initiatives are judged ────────────────────────────
// The thresholds are each Domain's risk_thresholds — the numbers the
// Initiative list row, the Initiative page and the due-soon notifications
// all read. One store, one editor (also reachable as Elements > SLAs).
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
          <SettingsSection key={domain.id} title={domain.name}>
            <SettingsRow label={t('Default length')} hint={t('Days a new Phase spans, end date included')}>
              <DaysInput key={`len:${current.length_days ?? ''}`} value={current.length_days} max={PHASE_DEFAULTS_MAX.length_days}
                unit={t('days')} disabled={pending.has(domain.id)} onCommit={(v) => save(domain, { length_days: v })} />
            </SettingsRow>
            <SettingsRow label={t('Start')} hint={t('Where a new Phase begins')}>
              <SelectControl value={START_LABEL[current.start === 'after_last' ? 'after_last' : 'today']}
                options={START_OPTIONS.map((o) => START_LABEL[o])}
                onChange={(label) => save(domain, { start: START_OPTIONS.find((o) => START_LABEL[o] === label) ?? 'today' })} />
            </SettingsRow>
            {errors[domain.id] && <div className="px-4 py-2 text-[11px] text-destructive">{errors[domain.id]}</div>}
          </SettingsSection>
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

// ── Timeline — how the Timeline is drawn (personal) ─────────────────────
const SCALE_LABEL: Record<UserPreferences['timeline_scale'], string> = { month: 'Month', quarter: 'Quarter' };
const range = (r: { min: number; max: number }) => Array.from({ length: r.max - r.min + 1 }, (_, i) => String(r.min + i));

export function TimelineDisplaySettings() {
  const { t } = useI18n();
  const { preferences, error, savePreference } = useUserPreferences();
  const backOptions = useMemo(() => range(TIMELINE_MONTHS_BACK_RANGE), []);
  const aheadOptions = useMemo(() => range(TIMELINE_MONTHS_AHEAD_RANGE), []);
  return (
    <div className="space-y-6">
      {error && <div className="-mt-2 text-[12px] text-destructive">{t("Couldn't save")}: {error}</div>}
      <Group title={t('Window')}>
        <SelectRow label={t('Scale')} desc={t('How much of the year one screen shows')}
          value={SCALE_LABEL[preferences.timeline_scale]} options={Object.values(SCALE_LABEL)}
          onChange={(label) => savePreference('timeline_scale', label === 'Quarter' ? 'quarter' : 'month')} />
        <SelectRow label={t('Months back')} desc={t('How far before this month the window starts')}
          value={String(preferences.timeline_months_back)} options={backOptions}
          onChange={(v) => savePreference('timeline_months_back', Number(v))} />
        <SelectRow label={t('Months ahead')} desc={t('How far after this month the window runs')}
          value={String(preferences.timeline_months_ahead)} options={aheadOptions}
          onChange={(v) => savePreference('timeline_months_ahead', Number(v))} />
      </Group>
      <Group title={t('Marks')}>
        <ToggleRow label={t('Today marker')} desc={t('A line through today across every row')}
          value={preferences.timeline_today_marker} onChange={(v) => savePreference('timeline_today_marker', v)} />
        <ToggleRow label={t('Progress fill')} desc={t('Shade each band by how much of its work is done')}
          value={preferences.timeline_progress_fill} onChange={(v) => savePreference('timeline_progress_fill', v)} />
      </Group>
    </div>
  );
}
