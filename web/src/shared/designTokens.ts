/**
 * Alcon Design Tokens
 *
 * Accent: Indigo (#5e6ad2) — single accent, Linear-grounded
 * Surfaces: neutral light / dark ramp
 * Typography: Inter Variable, 13px base
 *
 * All color references must go through CSS variables (var(--*)).
 * Do not hardcode hex values in components.
 */

// ============================================
// Status
// ============================================
export const STATUS = {
  backlog:     { label: 'Backlog',     color: 'text-[var(--text-tertiary)]',  bg: 'bg-[var(--surface-raised)]',         dot: 'bg-[var(--text-tertiary)]',  icon: 'Circle' },
  todo:        { label: 'To Do',       color: 'text-[var(--text-secondary)]', bg: 'bg-[var(--surface-raised)]',         dot: 'bg-[var(--text-secondary)]', icon: 'Circle' },
  in_progress: { label: 'In Progress', color: 'text-[var(--status-warning)]', bg: 'bg-[var(--status-warning-subtle)]',  dot: 'bg-[var(--status-warning)]', icon: 'Clock' },
  review:      { label: 'In Review',   color: 'text-[var(--accent-hover)]',   bg: 'bg-[var(--status-info-subtle)]',     dot: 'bg-[var(--accent-hover)]',   icon: 'Send' },
  done:        { label: 'Done',        color: 'text-[var(--status-success)]', bg: 'bg-[var(--status-success-subtle)]',  dot: 'bg-[var(--status-success)]', icon: 'CheckCircle2' },
  blocked:     { label: 'Blocked',     color: 'text-[var(--status-danger)]',  bg: 'bg-[var(--status-danger-subtle)]',   dot: 'bg-[var(--status-danger)]',  icon: 'XCircle' },
  cancelled:   { label: 'Cancelled',   color: 'text-[var(--text-disabled)]',  bg: 'bg-[var(--surface-raised)]',         dot: 'bg-[var(--text-disabled)]',  icon: 'Ban' },
} as const;

// ============================================
// Priority
// ============================================
export const PRIORITY = {
  urgent: { label: 'Urgent', color: 'text-[var(--status-danger)]',  badgeBg: 'bg-[var(--status-danger-subtle)]  text-[var(--status-danger)]' },
  high:   { label: 'High',   color: 'text-[var(--status-warning)]', badgeBg: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]' },
  medium: { label: 'Medium', color: 'text-[var(--text-secondary)]', badgeBg: 'bg-[var(--surface-raised)]         text-[var(--text-secondary)]' },
  low:    { label: 'Low',    color: 'text-[var(--text-tertiary)]',  badgeBg: 'bg-[var(--surface-raised)]         text-[var(--text-tertiary)]' },
} as const;

// ============================================
// Typography scale
// ============================================
export const FONT = {
  /** Page titles */
  '3xl': 'text-[28px] leading-[36px] font-semibold tracking-normal',
  /** Sub-page titles */
  '2xl': 'text-[22px] leading-[30px] font-semibold tracking-normal',
  /** Section titles */
  xl:   'text-[18px] leading-[26px] font-semibold tracking-normal',
  /** Section headings */
  lg:   'text-[15px] leading-[22px] font-medium tracking-normal',
  /** Form inputs / buttons */
  md:   'text-[14px] leading-[20px] font-normal',
  /** Body text / list rows (default) */
  base: 'text-[13px] leading-[20px] font-normal',
  /** Sub-text / icon labels */
  sm:   'text-[12px] leading-[16px] font-normal',
  /** Uppercase section labels / meta */
  xs:   'text-[11px] leading-[16px] font-medium',
  /** Uppercase section headers (KEY DECISIONS etc.) */
  label: 'text-[12px] leading-[16px] font-medium text-[var(--text-tertiary)]',
  /** Monospace for IDs, codes, shortcuts */
  mono: 'text-[12px] font-mono text-[var(--text-tertiary)]',
} as const;

// ============================================
// Semantic colors (for inline style / recharts)
// ============================================
export const SEMANTIC_COLORS = {
  status: {
    backlog:     'var(--text-tertiary)',
    todo:        'var(--text-secondary)',
    in_progress: 'var(--status-warning)',
    review:      'var(--accent-hover)',
    done:        'var(--status-success)',
    blocked:     'var(--status-danger)',
    cancelled:   'var(--text-disabled)',
  },
  accent:  'var(--accent-default)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger:  'var(--status-danger)',
  info:    'var(--accent-hover)',
} as const;

export type StatusKey = keyof typeof STATUS;
export type PriorityKey = keyof typeof PRIORITY;

// ============================================
// Card styles
// Borders over Shadows — no box-shadow on cards.
// Hover: border brightens, background stays.
// ============================================
export const CARD =
  'rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)]';

export const CARD_HOVER =
  'hover:border-[var(--border-strong)] transition-colors duration-[120ms]';

export const CARD_DRAG =
  'ring-2 ring-[var(--accent-default)] border-[var(--accent-default)]';
