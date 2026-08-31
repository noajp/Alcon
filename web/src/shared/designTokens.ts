/**
 * Alcon Design Tokens
 *
 * Accent: Blue (#1f6feb) — a true blue between cyan and navy, single accent
 * Danger: Matte red (#ce4a3b) — muted and slightly light, not fire-engine
 * Surfaces: neutral light / dark ramp
 * Typography: Inter Variable, 13px base
 *
 * All color references must go through CSS variables (var(--*)).
 * Do not hardcode hex values in components.
 */

// ============================================
// Status
//
// One status → one hue, for every surface. The hues live in globals.css as
// --element-status-*; this table is the only place that maps a status key onto
// them. Class consumers read `.color` / `.bg` / `.dot`; consumers that need an
// inline style or a recharts `fill` read SEMANTIC_COLORS below. Nothing builds
// its own status palette.
// ============================================
export const STATUS = {
  backlog:     { label: 'Backlog',     color: 'text-[var(--element-status-backlog)]',     bg: 'bg-[var(--element-status-backlog-subtle)]',     dot: 'bg-[var(--element-status-backlog)]',     icon: 'Circle' },
  todo:        { label: 'To Do',       color: 'text-[var(--element-status-todo)]',        bg: 'bg-[var(--element-status-todo-subtle)]',        dot: 'bg-[var(--element-status-todo)]',        icon: 'Circle' },
  in_progress: { label: 'In Progress', color: 'text-[var(--element-status-in-progress)]', bg: 'bg-[var(--element-status-in-progress-subtle)]', dot: 'bg-[var(--element-status-in-progress)]', icon: 'Clock' },
  review:      { label: 'In Review',   color: 'text-[var(--element-status-review)]',      bg: 'bg-[var(--element-status-review-subtle)]',      dot: 'bg-[var(--element-status-review)]',      icon: 'Send' },
  done:        { label: 'Done',        color: 'text-[var(--element-status-done)]',        bg: 'bg-[var(--element-status-done-subtle)]',        dot: 'bg-[var(--element-status-done)]',        icon: 'CheckCircle2' },
  blocked:     { label: 'Blocked',     color: 'text-[var(--element-status-blocked)]',     bg: 'bg-[var(--element-status-blocked-subtle)]',     dot: 'bg-[var(--element-status-blocked)]',     icon: 'XCircle' },
  cancelled:   { label: 'Cancelled',   color: 'text-[var(--element-status-cancelled)]',   bg: 'bg-[var(--element-status-cancelled-subtle)]',   dot: 'bg-[var(--element-status-cancelled)]',   icon: 'Ban' },
} as const;

// ============================================
// Priority
// ============================================
export const PRIORITY = {
  urgent: { label: 'Urgent', color: 'text-[var(--priority-urgent)]', badgeBg: 'bg-[var(--status-danger-subtle)]  text-[var(--priority-urgent)]' },
  high:   { label: 'High',   color: 'text-[var(--priority-high)]',   badgeBg: 'bg-[var(--status-warning-subtle)] text-[var(--priority-high)]' },
  medium: { label: 'Medium', color: 'text-[var(--priority-medium)]', badgeBg: 'bg-[var(--surface-raised)]         text-[var(--priority-medium)]' },
  low:    { label: 'Low',    color: 'text-[var(--priority-low)]',    badgeBg: 'bg-[var(--surface-raised)]         text-[var(--priority-low)]' },
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
//
// The same table as STATUS / PRIORITY, expressed as bare `var(--*)` strings for
// the places that cannot take a class: recharts `fill`, SVG attributes, inline
// `style`. These are var() references, NOT hex — never string-concatenate an
// alpha suffix onto one (`${color}33` is invalid CSS and paints nothing). Reach
// for `statusTint` / `STATUS[key].bg` when a translucent ground is wanted.
// ============================================
export const SEMANTIC_COLORS = {
  status: {
    backlog:     'var(--element-status-backlog)',
    todo:        'var(--element-status-todo)',
    in_progress: 'var(--element-status-in-progress)',
    review:      'var(--element-status-review)',
    done:        'var(--element-status-done)',
    blocked:     'var(--element-status-blocked)',
    cancelled:   'var(--element-status-cancelled)',
  },
  statusSubtle: {
    backlog:     'var(--element-status-backlog-subtle)',
    todo:        'var(--element-status-todo-subtle)',
    in_progress: 'var(--element-status-in-progress-subtle)',
    review:      'var(--element-status-review-subtle)',
    done:        'var(--element-status-done-subtle)',
    blocked:     'var(--element-status-blocked-subtle)',
    cancelled:   'var(--element-status-cancelled-subtle)',
  },
  priority: {
    urgent: 'var(--priority-urgent)',
    high:   'var(--priority-high)',
    medium: 'var(--priority-medium)',
    low:    'var(--priority-low)',
  },
  accent:  'var(--accent-default)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger:  'var(--status-danger)',
  info:    'var(--accent-hover)',
} as const;

export type StatusKey = keyof typeof STATUS;
export type PriorityKey = keyof typeof PRIORITY;

/**
 * Inline-style colour for an Element status. Accepts the loose `string | null`
 * that rows carry and falls back to `todo`, so callers stop writing their own
 * `?? '#A3A3A3'` fallback hex.
 */
export function statusColor(status?: string | null): string {
  return SEMANTIC_COLORS.status[status as StatusKey] ?? SEMANTIC_COLORS.status.todo;
}

/** Translucent ground for the same status — the correct way to get a tint. */
export function statusTint(status?: string | null): string {
  return SEMANTIC_COLORS.statusSubtle[status as StatusKey] ?? SEMANTIC_COLORS.statusSubtle.todo;
}

/** Inline-style colour for a priority; falls back to `medium`. */
export function priorityColor(priority?: string | null): string {
  return SEMANTIC_COLORS.priority[priority as PriorityKey] ?? SEMANTIC_COLORS.priority.medium;
}

/** Human label for a status key, without importing the whole STATUS table. */
export function statusLabel(status?: string | null): string {
  return STATUS[status as StatusKey]?.label ?? status ?? STATUS.todo.label;
}

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
