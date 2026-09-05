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
// Control geometry — buttons, toolbar triggers, date fields
//
// Three height steps and nothing else. Measured before this block existed:
// the 550 hand-written `<button>`s in `src/` declared 18 distinct heights
// (h-6 46 / h-7 43 / h-5 24 / h-8 20 / h-4 17 / h-[24px] 10 / h-9 7 /
// h-[26px] 5 / h-[22px] 4 / h-10 3 / h-[18px] 3 / h-11 2 / h-[2.625rem] 2 /
// h-full / h-[16px] / h-[3.25rem] / h-3.5 / h-14), 9 radii (rounded-md 181 /
// rounded 117 / rounded-full 41 / rounded-lg 23 / rounded-sm 6 /
// rounded-[5px] 4 / rounded-[2px] 2 / rounded-2xl 1 / rounded-[3px] 1) and
// 10 type sizes. Only 191 of the 550 declared a height at all — the rest let
// padding decide, which is why rows of controls never line up.
//
// The three steps are 24 / 28 / 32px. That is not a preference: it is where
// the existing distribution already clusters (h-6 / h-7 / h-8 are the three
// most common values, 109 of the 191) *and* it is GitHub Primer's
// xsmall / small / medium control scale. See
// `.claude/skills/design/references/buttons-and-controls.md` §1.2, §3.1.
//
// Radius is one value for all three steps. shadcn and Primer both hold radius
// constant across sizes; a smaller button with a smaller radius is precisely
// what makes a row of controls look hand-assembled (DESIGN.md §3.2).
// `rounded-md` resolves to `calc(0.5rem - 2px)` = 6px here — the same 6px
// MenuShell puts on every menu surface, so a trigger and the surface it opens
// share a corner.
//
// No transition class lives here. `globals.css` already gives every `button`
// and `a` `transition: background/color/border-color/opacity var(--motion-fast)`.
// The 273 `transition-colors` in the codebase restate it; the 5
// `transition-all` make it worse by animating width and height too.
// ============================================
export const CONTROL = {
  /** Height of a control with a label. */
  height: { xs: 'h-6', sm: 'h-7', md: 'h-8' },
  /** Icon-only controls are the square of the same step. */
  square: { xs: 'size-6', sm: 'size-7', md: 'size-8' },
  /** Horizontal padding. Vertical padding is never used — height is declared. */
  padX: { xs: 'px-2', sm: 'px-2.5', md: 'px-3' },
  /** Gap between icon and label. */
  gap: { xs: 'gap-1.5', sm: 'gap-1.5', md: 'gap-2' },
  /** Label type. 12px = FONT.sm, 13px = FONT.base. */
  text: { xs: 'text-[12px]', sm: 'text-[12px]', md: 'text-[13px]' },
  /** lucide `size` prop for an icon inside a control of this step. */
  icon: { xs: 14, sm: 14, md: 16 },
  /** One radius for every step. */
  radius: 'rounded-md',
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
