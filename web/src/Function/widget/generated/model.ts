// Keep source validation aligned with generate-widget-app/model.ts (checked in tests).
export interface AppSource { title: string; html: string; css: string; js: string; usesObjectData?: boolean; usesSpaceData?: boolean; libraries?: string[] }
/** A library a canvas may load: one script at a pinned version on jsDelivr. */
export const LIBRARY_URL = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+[a-z0-9.-]*\/[A-Za-z0-9._\/-]+\.js$/;
export function parseAppSource(value: unknown): AppSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid app response.');
  const v = value as Record<string, unknown>;
  for (const key of ['title', 'html', 'css', 'js']) {
    if (typeof v[key] !== 'string') throw new Error(`Missing app ${key}.`);
  }
  if (!(v.title as string).trim() || !(v.html as string).trim()) throw new Error('The app is empty.');
  if ((v.title as string).length > 100 || new TextEncoder().encode(JSON.stringify(v)).length > 120000) throw new Error('The app is too large.');
  // HTML is presentation only; executable code belongs to js, styles to css.
  if (/<\s*(script|iframe|frame|object|embed|base|meta|link)\b|\bon\w+\s*=|javascript\s*:/i.test(v.html as string)) throw new Error('Unsupported HTML. Ask AI to use the app runtime.');
  if (v.usesObjectData !== undefined && typeof v.usesObjectData !== 'boolean') throw new Error('Invalid Object data capability.');
  if (v.usesSpaceData !== undefined && typeof v.usesSpaceData !== 'boolean') throw new Error('Invalid Space data capability.');
  const libraries = v.libraries === undefined || v.libraries === null ? [] : v.libraries;
  if (!Array.isArray(libraries) || libraries.length > 6 || libraries.some(url => typeof url !== 'string' || !LIBRARY_URL.test(url))) throw new Error('Invalid library list.');
  return { ...(v.usesObjectData === true ? { usesObjectData: true } : {}), ...(v.usesSpaceData === true ? { usesSpaceData: true } : {}), ...(libraries.length ? { libraries: libraries as string[] } : {}), title: v.title as string, html: v.html as string, css: v.css as string, js: v.js as string };
}
export type AppState = Record<string, unknown>;
export function parseAppState(value: unknown): AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('App data must be a JSON object.');
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 150000) throw new Error('App data is too large to save.');
  return JSON.parse(text) as AppState;
}

/** JSON with object keys in a fixed order, so two equal states compare equal however they were built. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface StatePatch { set: AppState; unset: string[] }
/**
 * What an app changed since the state it started from, by top-level key.
 * An app saves its whole state; sending only this is what lets two people's
 * saves to different keys both survive.
 */
export function statePatch(base: AppState, next: AppState): StatePatch {
  const set: AppState = {};
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(base, key) || stableJson(base[key]) !== stableJson(value)) set[key] = value;
  }
  return { set, unset: Object.keys(base).filter(key => !Object.hasOwn(next, key)) };
}

/** Identifies one exact version of an app, so an approval given to it does not carry to a changed one. */
export async function sourceDigest(source: AppSource): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(source)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
