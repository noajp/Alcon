// Two independent hand-picked color schemes for the Custom (tactical
// annotation) view. Neither is a design-token violation — they're fixed sets
// a user picks from or a fixed category legend — but they're kept in their
// own file (see COLOR_ALLOWLIST in scripts/designLintRules.mjs) rather than
// allowlisting CustomView.tsx itself, so the linter still watches everything
// else in that 600+ line component.

export type FlagType = 'structure' | 'vehicle' | 'person' | 'infrastructure' | 'unknown';

// Fixed legend: what each annotation category means and how it's drawn.
// Not user-configurable, so it isn't a "palette" in the swatch-picker sense
// below — but it's still an intentional, self-contained color scheme rather
// than incidental hardcoding.
export const TYPE_META: Record<FlagType, { label: string; color: string; bg: string }> = {
  structure: { label: 'Structure', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.16)' },
  vehicle: { label: 'Vehicle', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.16)' },
  person: { label: 'Person', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.16)' },
  infrastructure: { label: 'Infra', color: '#10b981', bg: 'rgba(16, 185, 129, 0.16)' },
  unknown: { label: 'Unknown', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.16)' },
};

// The draw-tool's overlay/stroke color — a user-facing swatch picker, same
// shape as ActivitySpace/execution/domain/domainColorPalette.ts.
export const OVERLAY_COLOR_SWATCHES = ['#f8fafc', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
export const DEFAULT_OVERLAY_COLOR = OVERLAY_COLOR_SWATCHES[0];
