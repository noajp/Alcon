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
