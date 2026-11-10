'use client';

import { FIELD } from '@/shared/designTokens';

import { formatError } from '@/Function/shared/formatError';
import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SelectControl, SettingRow, SettingsIsland, ToggleRow } from './SettingsControls';
import { setSpaceHeartbeat, useHeartbeatSteps, wakeHeartbeatNow, useSpaceHeartbeat } from '@/hooks/heartbeatData';
import {
  HEARTBEAT_CADENCES, HEARTBEAT_TIMEZONES, tickState, type HeartbeatSettings as Settings,
} from './heartbeatModel';

// The Space's heartbeat: Athena wakes on a cadence, inspects what has
// been left waiting, and speaks only when there is something worth
// saying. Changing it is an owner's act (the RPC names the caller as
// the wake's actor); members read the settings and the wake history —
// the record is the Space's, the notification is the owner's.
//
// Presentation (settings redesign PR3): one island of SettingRows — the
// enabled checkbox is the shared Switch, cadence and timezone ride the
// shared SelectControl, and the loose state paragraphs (spent-vs-cap,
// the tick's health, the owner gate) live in the caption slots of the
// rows they describe. Save semantics are unchanged.
export function HeartbeatSettings({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
  const { t, locale } = useI18n();
  const { settings, wakes, monthSpent, loading, error, refetch } = useSpaceHeartbeat(spaceId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // The typed fields are uncontrolled, keyed by the saved values: a
  // save remounts them with what the server now holds, and a blur is
  // what saves. (No effect mirrors the settings into state.)
  const quietStartRef = useRef<HTMLInputElement>(null);
  const quietEndRef = useRef<HTMLInputElement>(null);

  if (loading || !settings) {
    return (
      <SettingsIsland title={t('Heartbeat')}>
        <p className="px-5 py-3.5 text-[12px] text-muted-foreground">{error ? t("Couldn't load the heartbeat settings: {error}", { error: error.message }) : t('Loading…')}</p>
      </SettingsIsland>
    );
  }

  const save = async (next: Settings) => {
    if (!isOwner || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setSpaceHeartbeat(spaceId, next);
      await refetch();
    } catch (e) {
      setSaveError(formatError(e));
    } finally {
      setSaving(false);
    }
  };
  const saveThreshold = (raw: string) => {
    const hours = Number(raw);
    if (Number.isFinite(hours) && hours > 0 && hours !== settings.notifyAfterHours) {
      void save({ ...settings, notifyAfterHours: hours });
    }
  };
  const saveCap = (raw: string) => {
    const budget = Number(raw);
    if (Number.isFinite(budget) && budget >= 0 && budget !== settings.monthlyBudgetUsd) {
      void save({ ...settings, monthlyBudgetUsd: budget });
    }
  };
  const saveQuiet = () => {
    const start = quietStartRef.current?.value || null;
    const end = quietEndRef.current?.value || null;
    // Both ends or neither: a half-set window is left in the field
    // unsaved rather than sent somewhere it would be refused.
    if ((start === null) !== (end === null)) return;
    if (start === settings.quietStart && end === settings.quietEnd) return;
    void save({ ...settings, quietStart: start, quietEnd: end });
  };
  const wakeNow = async () => {
    setWaking(true);
    setSaveError(null);
    try {
      await wakeHeartbeatNow(spaceId);
      await refetch();
    } catch (e) {
      setSaveError(formatError(e));
    } finally {
      setWaking(false);
    }
  };

  const tick = tickState(settings, new Date());
  const inputCls = `w-24 px-2 py-1 text-[13px] disabled:opacity-50 ${FIELD.base} bg-transparent text-foreground`;
  const cadence = HEARTBEAT_CADENCES.find((c) => c.minutes === settings.cadenceMinutes) ?? HEARTBEAT_CADENCES[0];
  const capReached = monthSpent >= settings.monthlyBudgetUsd;

  return (
    <SettingsIsland
      title={t('Heartbeat')}
      description={t('Athena wakes on a cadence, looks at what has been left waiting in this Space, and speaks only when there is something worth saying. A wake never acts — it only notifies.')}
    >
      <ToggleRow
        label={t('Heartbeat')}
        value={settings.enabled}
        disabled={!isOwner || saving}
        onChange={(v) => void save({ ...settings, enabled: v })}
        caption={!isOwner
          ? t('Only Space owners can change the heartbeat.')
          : saving ? t('Saving…') : undefined}
      />
      {saveError && <p role="alert" className="px-5 py-3 text-[12px] text-[var(--status-danger)]">{t("Couldn't save the heartbeat settings: {error}", { error: saveError })}</p>}

      {settings.enabled && (
        <>
          <SettingRow
            label={t('Next wake')}
            caption={tick === 'arriving'
              ? t('Scheduled checks are arriving.')
              : t('Scheduled checks have not arrived lately. The every-minute drive may not be set up in this environment.')}
          >
            <span className="text-[13px] text-foreground">
              {settings.nextAt ? new Date(settings.nextAt).toLocaleString(locale) : '—'}
            </span>
          </SettingRow>
          {isOwner && (
            <SettingRow label={t('Wake now')}>
              <Button variant="secondary" disabled={waking} onClick={() => void wakeNow()}>
                {waking ? t('Waking…') : t('Wake now')}
              </Button>
            </SettingRow>
          )}
          <SettingRow label={t('Cadence')} desc={t('How often Athena wakes to inspect what has been left waiting.')}>
            <SelectControl
              value={cadence.label}
              options={HEARTBEAT_CADENCES.map((c) => c.label)}
              disabled={!isOwner || saving}
              onChange={(label) => {
                const next = HEARTBEAT_CADENCES.find((c) => c.label === label);
                if (next) void save({ ...settings, cadenceMinutes: next.minutes });
              }}
            />
          </SettingRow>
          <SettingRow label={t('Notify threshold (hours)')} desc={t('A wait older than this is worth raising.')}>
            <input
              key={settings.notifyAfterHours}
              type="number" min={1} defaultValue={settings.notifyAfterHours} disabled={!isOwner}
              aria-label={t('Notify threshold (hours)')}
              className={inputCls}
              onBlur={(e) => saveThreshold(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            />
          </SettingRow>
          <SettingRow label={t('Quiet hours')} desc={t('No wakes inside this window, in the Space’s timezone.')}>
            <div className="flex items-center gap-2">
              <input key={`qs-${settings.quietStart ?? ''}`} ref={quietStartRef} type="time" defaultValue={settings.quietStart ?? ''} disabled={!isOwner} aria-label={t('Quiet hours start')} className={inputCls}
                onBlur={saveQuiet} />
              <span className="text-muted-foreground">–</span>
              <input key={`qe-${settings.quietEnd ?? ''}`} ref={quietEndRef} type="time" defaultValue={settings.quietEnd ?? ''} disabled={!isOwner} aria-label={t('Quiet hours end')} className={inputCls}
                onBlur={saveQuiet} />
              <SelectControl
                value={settings.timezone}
                options={[...HEARTBEAT_TIMEZONES]}
                disabled={!isOwner || saving}
                onChange={(tz) => void save({ ...settings, timezone: tz })}
              />
            </div>
          </SettingRow>
          <SettingRow
            label={t('Monthly cap (USD)')}
            desc={t('The heartbeat’s own ceiling inside the Space’s AI budget.')}
            caption={[
              t('Spent this month: {spent} of {cap}', { spent: `$${monthSpent.toFixed(2)}`, cap: `$${settings.monthlyBudgetUsd.toFixed(2)}` }),
              capReached ? t('This month’s wakes are inspection only: the monthly cap is reached.') : null,
            ].filter(Boolean).join(' ')}
          >
            <input
              key={settings.monthlyBudgetUsd}
              type="number" min={0} step="0.5" defaultValue={settings.monthlyBudgetUsd} disabled={!isOwner}
              aria-label={t('Monthly cap (USD)')}
              className={inputCls}
              onBlur={(e) => saveCap(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            />
          </SettingRow>
        </>
      )}

      <div className="px-5 py-3.5">
        <h4 className="text-[12px] font-medium text-foreground">{t('Wake history')}</h4>
        {wakes.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-foreground">{t('No wakes yet.')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {wakes.map((w) => (
              <li key={w.id} className="text-[12px] text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{new Date(w.created_at).toLocaleString(locale)}</span>
                  <span className="text-foreground/80">{w.summary ?? w.status}</span>
                  <span>${Number(w.cost_usd).toFixed(4)}</span>
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                  >
                    {expanded === w.id ? t('Hide record') : t('View record')}
                  </button>
                </div>
                {expanded === w.id && <WakeSteps runId={w.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsIsland>
  );
}

/** One wake's steps, expanded in place: the record is the evidence the
 *  heartbeat is alive, silent wakes included. */
export function WakeSteps({ runId }: { runId: string }) {
  const { t } = useI18n();
  const { steps, loading } = useHeartbeatSteps(runId);
  if (loading) return <p className="mt-1 text-[12px] text-muted-foreground">{t('Loading…')}</p>;
  if (!steps.length) return <p className="mt-1 text-[12px] text-muted-foreground">{t('No steps recorded.')}</p>;
  return (
    <ol className="mt-1 space-y-1 border-l border-border/60 pl-3">
      {steps.map((s) => (
        <li key={s.idx} className="text-[12px] text-muted-foreground">
          <span className="text-foreground/80">{s.title}</span>
          {s.detail && <span className="block whitespace-pre-wrap">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
