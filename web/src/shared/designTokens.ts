/**
 * Clayware Design Tokens
 *
 * Accent: Matte blue (#426fac) — muted, single accent
 * Danger: Matte red (#d05249) — muted, warm red
 * Surfaces: neutral light / dark ramp
 * Typography: Inter Variable, 13px base
 *
 * All color references must go through CSS variables (var(--*)).
 * Do not hardcode hex values in components.
 */

import { translate } from '@/Function/i18n/I18nProvider';

// ============================================
// Status
//
// One status → one hue, for every surface. The hues live in globals.css as
// --element-status-*; this table is the only place that maps a status key onto
// them. Class consumers read `.color` / `.bg` / `.dot`; consumers that need an
// inline style or a recharts `fill` read SEMANTIC_COLORS below. Nothing builds
// its own status palette.
// ============================================
// `textColor` is what a small standalone text label (no adjacent dot/ring —
// e.g. the Overdue/Milestones/Upcoming widget rows' 11px status word) should
// read. It equals `color` for every status except `blocked`, whose base hue
// (#eab308) reads ~1.9:1 against white at that size — well under AA — even
// though the same hue is fine for the larger ring mark / dot it also colors.
// `--element-status-blocked-text` is a darkened variant of the same base var
// (globals.css), not a second palette: only the one hue that needed it.
export const STATUS = {
  backlog:     { label: 'Backlog',     color: 'text-[var(--element-status-backlog)]',     textColor: 'text-[var(--element-status-backlog)]',     bg: 'bg-[var(--element-status-backlog-subtle)]',     dot: 'bg-[var(--element-status-backlog)]',     icon: 'Circle' },
  todo:        { label: 'To Do',       color: 'text-[var(--element-status-todo)]',        textColor: 'text-[var(--element-status-todo)]',        bg: 'bg-[var(--element-status-todo-subtle)]',        dot: 'bg-[var(--element-status-todo)]',        icon: 'Circle' },
  in_progress: { label: 'In Progress', color: 'text-[var(--element-status-in-progress)]', textColor: 'text-[var(--element-status-in-progress)]', bg: 'bg-[var(--element-status-in-progress-subtle)]', dot: 'bg-[var(--element-status-in-progress)]', icon: 'Clock' },
  review:      { label: 'In Review',   color: 'text-[var(--element-status-review)]',      textColor: 'text-[var(--element-status-review)]',      bg: 'bg-[var(--element-status-review-subtle)]',      dot: 'bg-[var(--element-status-review)]',      icon: 'Send' },
  done:        { label: 'Done',        color: 'text-[var(--element-status-done)]',        textColor: 'text-[var(--element-status-done)]',        bg: 'bg-[var(--element-status-done-subtle)]',        dot: 'bg-[var(--element-status-done)]',        icon: 'CheckCircle2' },
  blocked:     { label: 'Blocked',     color: 'text-[var(--element-status-blocked)]',     textColor: 'text-[var(--element-status-blocked-text)]', bg: 'bg-[var(--element-status-blocked-subtle)]',     dot: 'bg-[var(--element-status-blocked)]',     icon: 'XCircle' },
  cancelled:   { label: 'Cancelled',   color: 'text-[var(--element-status-cancelled)]',   textColor: 'text-[var(--element-status-cancelled)]',   bg: 'bg-[var(--element-status-cancelled-subtle)]',   dot: 'bg-[var(--element-status-cancelled)]',   icon: 'Ban' },
} as const;

// ============================================
// Priority
// ============================================
export const PRIORITY = {
  urgent: { label: 'Urgent', color: 'text-[var(--priority-urgent)]', badgeBg: 'bg-[var(--status-danger-subtle)]  text-[var(--priority-urgent)]', weight: 4 },
  high:   { label: 'High',   color: 'text-[var(--priority-high)]',   badgeBg: 'bg-[var(--status-warning-subtle)] text-[var(--priority-high)]', weight: 3 },
  medium: { label: 'Medium', color: 'text-[var(--priority-medium)]', badgeBg: 'bg-[var(--surface-raised)]         text-[var(--priority-medium)]', weight: 2 },
  low:    { label: 'Low',    color: 'text-[var(--priority-low)]',    badgeBg: 'bg-[var(--surface-raised)]         text-[var(--priority-low)]', weight: 1 },
} as const;

// Element status and priority display order; priorities run highest to lowest.
export const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled', 'blocked'] as const satisfies readonly (keyof typeof STATUS)[];
export const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const satisfies readonly (keyof typeof PRIORITY)[];
// Picker rows in display order; labels are untranslated (callers pass them through t()).
export const STATUS_OPTIONS: { value: (typeof STATUS_ORDER)[number]; label: string }[] = STATUS_ORDER.map((value) => ({ value, label: STATUS[value].label }));
export const PRIORITY_OPTIONS: { value: (typeof PRIORITY_ORDER)[number]; label: string }[] = PRIORITY_ORDER.map((value) => ({ value, label: PRIORITY[value].label }));

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
  /** Small counts / meta */
  xs:   'text-[11px] leading-[16px] font-medium',
  /** Section headers over a group of fields */
  label: 'text-[12px] leading-[16px] font-medium text-[var(--text-tertiary)]',
  /** Monospace for IDs, codes, shortcuts */
  mono: 'text-[12px] font-mono text-[var(--text-tertiary)]',
} as const;

// ============================================
// Control geometry and fine outlines.
export const CONTROL = {
  /** Height of a control with a label. */
  height: { xs: 'h-6', sm: 'h-7', md: 'h-8', lg: 'h-11' },
  /** Icon-only controls are the square of the same step. */
  square: { xs: 'size-6', sm: 'size-7', md: 'size-8', lg: 'size-11' },
  /** Horizontal padding. Vertical padding is never used — height is declared. */
  padX: { xs: 'px-2', sm: 'px-2.5', md: 'px-3', lg: 'px-4' },
  /** Gap between icon and label. */
  gap: { xs: 'gap-1', sm: 'gap-1', md: 'gap-1.5', lg: 'gap-1.5' },
  /** Label type. 12px = FONT.sm, 13px = FONT.base. */
  text: { xs: 'text-[12px]', sm: 'text-[12px]', md: 'text-[13px]', lg: 'text-sm' },
  /** Center visible label metrics, rather than a font's asymmetric leading. */
  label: '[text-box-trim:trim-both] [text-box-edge:cap_alphabetic]',
  /** lucide `size` prop for an icon inside a control of this step. */
  icon: { xs: 14, sm: 14, md: 16, lg: 18 },
  /** One radius for every step. */
  radius: 'rounded-md',
  actionRadius: 'rounded-[var(--control-action-radius)]',
  border: 'border border-[var(--border-default)]',
} as const;

export const FIELD = {
  base: `${CONTROL.border} rounded-[var(--control-field-radius)] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:bg-[var(--accent-subtle)]`,
} as const;

export type ControlSize = keyof typeof CONTROL.height;

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
/** The status's name in the viewer's language. */
export function statusLabel(status?: string | null): string {
  return translate(STATUS[status as StatusKey]?.label ?? status ?? STATUS.todo.label);
}

// ============================================
// Card styles
// A card is a gloss island: lit rim, sheen, soft shadow (globals.css).
// Hover: border brightens, background stays.
// ============================================
export const CARD =
  'gloss-island gloss-sheen rounded-lg bg-[var(--surface-rail)]';

export const CARD_HOVER =
  'hover:border-[var(--border-strong)] transition-colors duration-[120ms]';

/** A card without the island shadow — the install surfaces (harness and
 *  connector catalog cards, registry cards) sit flat inside Settings. */
export const CARD_FLAT = 'rounded-lg bg-[var(--surface-rail)] border border-border/60';
/** A settings property island: the #803 Chain-card float, for a group of
 *  setting rows floating on the page ground (--surface-bg). */
export const SETTINGS_ISLAND =
  'gloss-island gloss-sheen rounded-lg bg-card dark:bg-[var(--surface-rail)]';
/** Shared geometry for Object and Element quick creation. */
export const QUICK_CREATE = {
  panel: 'pointer-events-auto w-full max-w-[760px] max-h-[calc(100dvh-48px)] overflow-y-auto rounded-lg gloss-overlay p-4',
  header: 'flex items-center gap-2 mb-2',
  context: 'inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
  title: 'quick-create-title block w-full bg-transparent px-0 py-1 text-lg text-foreground placeholder:text-muted-foreground/60 resize-none',
  description: 'block w-full bg-transparent px-0 py-1 text-[13px] text-foreground/85 placeholder:text-muted-foreground/50 resize-none',
  properties: 'flex flex-wrap items-center gap-1.5 pt-2',
  footer: 'flex items-center justify-end gap-3 pt-3',
  descriptionMinHeight: 56,
} as const;
