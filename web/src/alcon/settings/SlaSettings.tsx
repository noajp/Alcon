'use client';

import { useCallback, useRef, useState } from 'react';
import { useDomains, updateDomain } from '@/hooks/useSupabase';
import type { Domain, DomainRiskThresholds } from '@/types/database';
import { RISK_THRESHOLD_DEFAULTS } from '@/alcon/element/actions/campaignRiskModel';
import { SettingsSection, SettingsRow } from './SettingsSection';

// Settings > Elements > SLAs. An SLA here is not another due date — it is the
// threshold policy the Campaign cross-section (campaignRiskModel) judges a
// Domain's work by: how close a date has to be before unstarted work is "due
// soon", how long in-flight work may go without a progress comment before it
// is "stalled", how long an Object with open, unstarted work may sit before it
// is "idle". Blank = the model's default, shown as the placeholder.

type ThresholdKey = keyof DomainRiskThresholds;

const FIELDS: { key: ThresholdKey; label: string; hint: string; unit: string }[] = [
  {
    key: 'due_soon_days',
    label: 'Due soon',
    hint: 'Days before a due date that unstarted work starts counting as due soon',
    unit: 'days',
  },
  {
    key: 'stall_minutes',
    label: 'Stalled after',
    hint: 'Minutes without a progress comment before in-progress work counts as stalled',
    unit: 'min',
  },
  {
    key: 'idle_hours',
    label: 'Idle after',
    hint: 'Hours of silence before an Object with open, unstarted work counts as idle',
    unit: 'hours',
  },
];

function thresholdsOf(d: Domain): DomainRiskThresholds {
  return d.risk_thresholds ?? {};
}

export function SlaSettings() {
  const { data: domains, loading } = useDomains();

  // Optimistic overrides on top of the fetched rows, keyed by Domain. What the
  // panel shows is `override ?? fetched`, so a Domain with no override always
  // reads the freshest row. When the fetched rows change (refetch, realtime),
  // overrides for Domains that are not mid-save are dropped so a stale copy
  // can't shadow a newer value — done during render, not in an effect, per
  // React's "adjust state when a prop changes" pattern.
  const [overrides, setOverrides] = useState<Record<string, DomainRiskThresholds>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [seenDomains, setSeenDomains] = useState(domains);
  if (seenDomains !== domains) {
    setSeenDomains(domains);
    setOverrides((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => pending.has(id))));
  }

  const [errors, setErrors] = useState<Record<string, string>>({});
  // One write chain per Domain: risk_thresholds is written as a whole jsonb
  // object, so two saves landing out of order would let the older one erase
  // the newer field. Serializing per Domain keeps arrival order = intent order.
  const chains = useRef<Map<string, Promise<void>>>(new Map());

  const save = useCallback((domain: Domain, key: ThresholdKey, value: number | undefined) => {
    const before = overrides[domain.id] ?? thresholdsOf(domain);
    if (before[key] === value) return;
    const next: DomainRiskThresholds = { ...before };
    if (value === undefined) delete next[key];
    else next[key] = value;

    setOverrides((prev) => ({ ...prev, [domain.id]: next }));
    setErrors((prev) => {
      if (!(domain.id in prev)) return prev;
      const rest = { ...prev };
      delete rest[domain.id];
      return rest;
    });
    setPending((prev) => new Set(prev).add(domain.id));

    const prior = chains.current.get(domain.id) ?? Promise.resolve();
    const run: Promise<void> = prior
      .catch(() => undefined)
      .then(async () => {
        try {
          await updateDomain(domain.id, { risk_thresholds: next });
        } catch (e) {
          // Roll back — a failed save must not keep the optimistic value.
          setOverrides((prev) => ({ ...prev, [domain.id]: before }));
          setErrors((prev) => ({
            ...prev,
            [domain.id]: e instanceof Error ? e.message : "Couldn't save",
          }));
        }
      })
      .finally(() => {
        if (chains.current.get(domain.id) === run) {
          chains.current.delete(domain.id);
          setPending((prev) => {
            const n = new Set(prev);
            n.delete(domain.id);
            return n;
          });
        }
      });
    chains.current.set(domain.id, run);
  }, [overrides]);

  if (!loading && domains.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No Domains in this Space yet. Thresholds are set per Domain, so there is nothing to configure until one exists.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-muted-foreground -mt-2">
        How the Campaign cross-section judges each Domain&apos;s work. Leave a field blank to use the default shown.
        Changes take effect the next time a Campaign&apos;s risk is computed.
      </p>

      {domains.map((domain) => {
        const current = overrides[domain.id] ?? thresholdsOf(domain);
        const isPending = pending.has(domain.id);
        return (
          <SettingsSection key={domain.id} title={domain.name}>
            {FIELDS.map((f) => (
              <SettingsRow key={f.key} label={f.label} hint={f.hint}>
                <ThresholdInput
                  // Remount whenever the saved value changes (commit, rollback,
                  // refetch), so the draft is always seeded from the truth and
                  // never goes stale on a same-key prop change.
                  key={`${f.key}:${current[f.key] ?? ''}`}
                  value={current[f.key]}
                  placeholder={RISK_THRESHOLD_DEFAULTS[f.key]}
                  unit={f.unit}
                  disabled={isPending}
                  onCommit={(v) => save(domain, f.key, v)}
                />
              </SettingsRow>
            ))}
            {errors[domain.id] && (
              <div className="px-4 py-2 text-[11px] text-destructive">{errors[domain.id]}</div>
            )}
          </SettingsSection>
        );
      })}
    </div>
  );
}

// A number field that commits on blur / Enter and cancels on Escape. Empty
// commits `undefined` (= use the default). Anything that isn't a positive
// whole number is refused and the field snaps back to the saved value, so a
// typo can never be written as a threshold.
function ThresholdInput({
  value, placeholder, unit, disabled, onCommit,
}: {
  value: number | undefined;
  placeholder: number;
  unit: string;
  disabled?: boolean;
  onCommit: (v: number | undefined) => void;
}) {
  const initial = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const trimmed = draft.trim();
    if (trimmed === '') {
      onCommit(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      setDraft(initial);
      return;
    }
    onCommit(n);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={draft}
        placeholder={String(placeholder)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            // Escape is cancel: restore the saved value and make the blur that
            // follows a no-op instead of a save.
            e.preventDefault();
            setDraft(initial);
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="w-20 px-2 py-1 rounded-md bg-muted/40 focus:bg-muted/70 text-[12px] text-foreground text-right tabular-nums placeholder:text-muted-foreground/60 outline-none transition-colors disabled:opacity-50"
      />
      <span className="text-[11px] text-muted-foreground w-10">{unit}</span>
    </div>
  );
}
