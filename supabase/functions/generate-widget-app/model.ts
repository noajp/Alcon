export interface AppSource { title: string; html: string; css: string; js: string }
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
  return { title: v.title as string, html: v.html as string, css: v.css as string, js: v.js as string };
}
