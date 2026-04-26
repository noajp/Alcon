/**
 * Alcon Design Tokens
 *
 * Typography: Inter, letter-spacing -0.31px
 * Base palette: TailwindCSS Neutral
 * Surfaces: #FFFFFF (base) / #FCFCFC (surface)
 *
 * Status & Priority colors are intentionally muted to match Neutral aesthetics.
 * Avoid bright saturated colors. Use tinted neutrals instead.
 */

// ============================================
// Status
// ============================================
export const STATUS = {
  backlog:     { label: 'Backlog',     color: 'text-neutral-400', bg: 'bg-neutral-100', dot: 'bg-neutral-300', icon: 'Circle' },
  todo:        { label: 'To Do',       color: 'text-neutral-500', bg: 'bg-neutral-100', dot: 'bg-neutral-400', icon: 'Circle' },
  in_progress: { label: 'In Progress', color: 'text-amber-600',   bg: 'bg-amber-50',    dot: 'bg-amber-400',  icon: 'Clock' },
  review:      { label: 'In Review',   color: 'text-blue-600',    bg: 'bg-blue-50',     dot: 'bg-blue-400',   icon: 'Send' },
  done:        { label: 'Done',        color: 'text-emerald-600', bg: 'bg-emerald-50',  dot: 'bg-emerald-400',icon: 'CheckCircle2' },
  blocked:     { label: 'Blocked',     color: 'text-red-600',     bg: 'bg-red-50',      dot: 'bg-red-400',    icon: 'XCircle' },
  cancelled:   { label: 'Cancelled',   color: 'text-neutral-400', bg: 'bg-neutral-100', dot: 'bg-neutral-300', icon: 'Ban' },
} as const;

// ============================================
// Priority
// ============================================
export const PRIORITY = {
  urgent: { label: 'Urgent', color: 'text-red-700',     badgeBg: 'bg-red-50 text-red-700' },
  high:   { label: 'High',   color: 'text-amber-700',   badgeBg: 'bg-amber-50 text-amber-700' },
  medium: { label: 'Medium', color: 'text-neutral-600',  badgeBg: 'bg-neutral-100 text-neutral-600' },
  low:    { label: 'Low',    color: 'text-neutral-400',  badgeBg: 'bg-neutral-100 text-neutral-400' },
} as const;

// ============================================
// Typography scale (based on 14px base)
// ============================================
export const FONT = {
  /** Page titles, hero numbers */
  xl:   'text-xl font-semibold',         // 20px
  /** Section titles */
  lg:   'text-base font-semibold',       // 16px
  /** Body text, table cells */
  base: 'text-sm',                       // 14px
  /** Compact rows, secondary info */
  sm:   'text-[13px]',                   // 13px
  /** Labels, badges, metadata */
  xs:   'text-[12px]',                   // 12px
  /** Uppercase section headers */
  label: 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
  /** Monospace for IDs, codes */
  mono: 'text-[12px] font-mono text-muted-foreground',
} as const;

// ============================================
// Semantic colors (for direct CSS/inline use)
// ============================================
export const SEMANTIC_COLORS = {
  // Status dot colors (for inline style)
  status: {
    backlog: '#D4D4D4',     // neutral-300
    todo: '#A3A3A3',        // neutral-400
    in_progress: '#F59E0B', // amber-500
    review: '#3B82F6',      // blue-500
    done: '#10B981',        // emerald-500
    blocked: '#EF4444',     // red-500
    cancelled: '#D4D4D4',   // neutral-300
  },
  // Accent (for progress bars etc - use neutral-800 instead of custom blue)
  accent: '#262626',        // neutral-800
} as const;

export type StatusKey = keyof typeof STATUS;
export type PriorityKey = keyof typeof PRIORITY;

// ============================================
// Card styles (Linear-style islands)
// Light: pure white island on subtle zinc canvas
// Dark: lifted #2A2A2A above #0A0A0A canvas for visual depth
// rounded-xl (= --radius + 4px = 14px) — soft but not bubbly
// ============================================
export const CARD =
  'rounded-xl bg-white dark:bg-[#2A2A2A] border border-border/70 dark:border-white/[0.06] shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.35)]';

export const CARD_HOVER =
  'hover:shadow-[0_4px_12px_rgba(16,24,40,0.08),0_2px_4px_rgba(16,24,40,0.04)] hover:-translate-y-[1px] dark:hover:shadow-[0_6px_16px_rgba(0,0,0,0.55)] dark:hover:bg-[#2F2F2F] transition-all duration-200';

export const CARD_DRAG =
  'shadow-[0_16px_36px_rgba(16,24,40,0.14),0_4px_10px_rgba(16,24,40,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55)] ring-2 ring-foreground/10';
