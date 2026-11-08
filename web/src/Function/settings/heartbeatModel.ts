// A Space's heartbeat settings, as the settings screen works with
// them: pure shapes and judgements (the tick's arrival, the month's
// spend against the sub-cap, the next wake's reading). The data lives
// in hooks/heartbeatData.ts; the screen renders what this file decides.

export interface HeartbeatSettings {
  enabled: boolean;
  ownerId: string | null;
  cadenceMinutes: number;
  nextAt: string | null;
  timezone: string;
  quietStart: string | null; // "HH:MM"
  quietEnd: string | null;   // "HH:MM"
  notifyAfterHours: number;
  monthlyBudgetUsd: number;
  lastWakeAt: string | null;
  lastTickAt: string | null;
}

export const HEARTBEAT_CADENCES: { minutes: number; label: string }[] = [
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 180, label: 'Every 3 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Every 24 hours' },
];

export const HEARTBEAT_TIMEZONES = ['Asia/Tokyo', 'UTC', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles'] as const;

interface SpaceHeartbeatRow {
  heartbeat_enabled?: unknown;
  heartbeat_owner_id?: unknown;
  heartbeat_cadence_minutes?: unknown;
  heartbeat_next_at?: unknown;
  heartbeat_timezone?: unknown;
  heartbeat_quiet_start?: unknown;
  heartbeat_quiet_end?: unknown;
  heartbeat_notify_after_hours?: unknown;
  heartbeat_monthly_budget_usd?: unknown;
  heartbeat_last_wake_at?: unknown;
  heartbeat_last_tick_at?: unknown;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
/** A Postgres time ("23:00:00") as the "HH:MM" an input holds. */
const hhmm = (v: unknown): string | null => {
  const s = text(v);
  return s ? s.slice(0, 5) : null;
};

export function heartbeatSettingsOf(row: SpaceHeartbeatRow | null | undefined): HeartbeatSettings {
  return {
    enabled: row?.heartbeat_enabled === true,
    ownerId: text(row?.heartbeat_owner_id),
    cadenceMinutes: num(row?.heartbeat_cadence_minutes, 60),
    nextAt: text(row?.heartbeat_next_at),
    timezone: text(row?.heartbeat_timezone) ?? 'Asia/Tokyo',
    quietStart: hhmm(row?.heartbeat_quiet_start),
    quietEnd: hhmm(row?.heartbeat_quiet_end),
    notifyAfterHours: num(row?.heartbeat_notify_after_hours, 24),
    monthlyBudgetUsd: num(row?.heartbeat_monthly_budget_usd, 2),
    lastWakeAt: text(row?.heartbeat_last_wake_at),
    lastTickAt: text(row?.heartbeat_last_tick_at),
  };
}

/**
 * Whether the every-minute drive is reaching this Space. The pg_cron
 * registration is per environment and the app cannot see it directly;
 * what it can see is the tick's arrival stamp. A stamp a few minutes
 * old means the drive is alive; an old one — or none, a while after
 * enabling — means the heartbeat will not wake on its own here.
 */
export type TickState = 'off' | 'arriving' | 'stale' | 'never';
export function tickState(settings: HeartbeatSettings, now: Date): TickState {
  if (!settings.enabled) return 'off';
  if (!settings.lastTickAt) return 'never';
  const ageMs = now.getTime() - new Date(settings.lastTickAt).getTime();
  return ageMs <= 3 * 60_000 ? 'arriving' : 'stale';
}

export interface HeartbeatWake {
  id: string;
  status: string;
  summary: string | null;
  cost_usd: number | string;
  created_at: string;
  finished_at: string | null;
}

/** The month's heartbeat spend against the sub-cap, for the settings
 *  line that says when wakes degrade to inspection only. */
export function monthSpendOf(wakes: readonly { cost_usd: number | string; created_at: string }[], now: Date): number {
  const month = now.toISOString().slice(0, 7);
  return wakes
    .filter((w) => w.created_at.slice(0, 7) === month)
    .reduce((s, w) => s + Number(w.cost_usd || 0), 0);
}
