// Deterministic colour for a Label name, so a label renders as a coloured
// "sticker" (Linear-style dot) and stays the same colour everywhere it
// appears. This is the stop-gap until a managed per-label colour catalogue
// (domains.labels) lets users pick their own colours.
const LABEL_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
];

export function labelColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLORS[h % LABEL_COLORS.length];
}
