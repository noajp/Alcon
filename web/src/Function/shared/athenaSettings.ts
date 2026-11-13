import { useSyncExternalStore } from 'react';

// How Athena runs when someone asks it for something on a page: which model
// and how hard it thinks. The choice is the person's own, kept in this
// browser; the server accepts only the models and efforts listed here.

export const ATHENA_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
] as const;
export const ATHENA_EFFORTS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
] as const;

type AthenaModel = (typeof ATHENA_MODELS)[number]['id'];
type AthenaEffort = (typeof ATHENA_EFFORTS)[number]['id'];
interface AthenaSettings { model: AthenaModel; effort: AthenaEffort }

const DEFAULTS: AthenaSettings = { model: 'claude-sonnet-5-5', effort: 'medium' };
const KEY = 'alcon:athena:settings';
const listeners = new Set<() => void>();
let cached: AthenaSettings | null = null;

/** A stored value as settings, falling back field by field. */
function parseAthenaSettings(raw: unknown): AthenaSettings {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    model: ATHENA_MODELS.some((m) => m.id === v.model) ? (v.model as AthenaModel) : DEFAULTS.model,
    effort: ATHENA_EFFORTS.some((e) => e.id === v.effort) ? (v.effort as AthenaEffort) : DEFAULTS.effort,
  };
}

export function getAthenaSettings(): AthenaSettings {
  if (cached) return cached;
  let stored: unknown = null;
  try { stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null'); } catch { /* unreadable: the defaults */ }
  cached = parseAthenaSettings(stored);
  return cached;
}

export function setAthenaSettings(patch: Partial<AthenaSettings>) {
  cached = parseAthenaSettings({ ...getAthenaSettings(), ...patch });
  try { window.localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* kept for this page only */ }
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useAthenaSettings = () => useSyncExternalStore(subscribe, getAthenaSettings, () => DEFAULTS);
