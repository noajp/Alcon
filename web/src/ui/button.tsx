"use client"

// Shared action and tab control. Geometry and borders come from CONTROL.

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CONTROL } from "@/shared/designTokens"

/**
 * - control: the default — fine border, capsule.
 * - navigation: sidebar / rail / launcher — no border, selection by ground.
 * - inline: an affordance inside a document body (add a sub-element, link a
 *   Note, share an update). No border and a muted label, so the page reads
 *   as content and the verbs recede until hovered.
 */
type Appearance = 'control' | 'navigation' | 'inline';
const ButtonAppearance = React.createContext<Appearance>('control');
export function ButtonAppearanceProvider({ children, appearance }: { children: React.ReactNode; appearance: Appearance }) {
  return <ButtonAppearance.Provider value={appearance}>{children}</ButtonAppearance.Provider>;
}

const buttonVariants = cva(
  [
    "inline-flex items-center whitespace-nowrap shrink-0 select-none leading-none",
    CONTROL.border,
    "hover:border-[var(--border-strong)]",
    "font-medium",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    // Focus is the component's own job — globals.css gives nothing a ring.
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-hover)]",
  ].join(" "),
  {
    variants: {
      shape: { action: CONTROL.actionRadius, tab: "rounded-full" },
      variant: {
        /** Accent ground. One primary action per button group. */
        primary:
          "bg-[var(--accent-default)] text-white hover:bg-[var(--accent-hover)]",
        /** Neutral filled action, with the same fine border as every control. */
        secondary:
          "bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]",
        /**
         * The toolbar default. Transparent and unframed at rest; the hover ground is
         * `--surface-strong` for the reason MenuShell documents — in the light
         * themes `--accent` and the surface it sits on are the same colour, so
         * `hover:bg-accent` paints nothing.
         */
        ghost:
          "border-transparent hover:border-transparent bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-strong)]",
        /**
         * Destructive. Tinted at rest, solid red on hover (Primer).
         *
         * The resting tint is not decoration. Rendered in Chrome against the
         * compiled bundle, a fully transparent `danger` next to a filled
         * `secondary` inverted the dialog: in the delete confirmation, "Cancel"
         * read as the button and "Delete" read as a link. A destructive CTA
         * must not be the lightest thing in its own dialog, so it carries the
         * same weight as `secondary` and lets colour — not fill — say what it
         * does.
         */
        danger:
          "bg-[var(--status-danger-subtle)] text-[var(--status-danger)] hover:bg-[var(--status-danger)] hover:text-white",
      },
      size: {
        xs: [CONTROL.height.xs, CONTROL.padX.xs, CONTROL.gap.xs, CONTROL.text.xs].join(" "),
        sm: [CONTROL.height.sm, CONTROL.padX.sm, CONTROL.gap.sm, CONTROL.text.sm].join(" "),
        md: [CONTROL.height.md, CONTROL.padX.md, CONTROL.gap.md, CONTROL.text.md].join(" "),
        lg: [CONTROL.height.lg, CONTROL.padX.lg, CONTROL.gap.lg, CONTROL.text.lg].join(" "),
        "icon-xs": [CONTROL.square.xs, "p-0 justify-center"].join(" "),
        "icon-sm": [CONTROL.square.sm, "p-0 justify-center"].join(" "),
        "icon-md": [CONTROL.square.md, "p-0 justify-center"].join(" "),
      },
      multiline: { true: "leading-snug h-auto min-h-7 max-w-full whitespace-normal py-1.5 text-left justify-start", false: "" },
      align: {
        /** Execute CTA — "press this and something happens". */
        center: "justify-center",
        /** Opens something (a menu, a calendar). Label left, glyph at the end. */
        start: "justify-start",
      },
    },
    defaultVariants: {
      shape: "action",
      multiline: false,
      variant: "secondary",
      size: "sm",
      align: "center",
    },
  }
)

// Text gets its own block so flex aligns the glyph metrics. Keep adjacent
// text/count nodes together: wrapping each one would introduce extra flex gaps.
function buttonLabels(children: React.ReactNode): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let text = '';
  const flush = () => {
    if (text.trim()) result.push(<span key={`label-${result.length}`} className={CONTROL.label}>{text}</span>);
    text = '';
  };
  React.Children.toArray(children).forEach(child => {
    if (typeof child === 'string' || typeof child === 'number') text += child;
    else { flush(); result.push(child); }
  });
  flush();
  return result;
}

function Button({
  className,
  variant = "secondary",
  size = "sm",
  align = "center",
  shape = "action",
  multiline = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const appearance = React.useContext(ButtonAppearance);
  const resolvedAlign = size?.startsWith('icon-') ? 'center' : align;
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      className={cn(buttonVariants({ variant, size, align: resolvedAlign, shape, multiline, className }),
        // A tab is a quiet pill: no line around it. The ones not chosen are
        // just their words, the chosen one sits on a light fill, and a hover
        // shows the same fill — a row of tabs reads as one strip, not a row
        // of separate buttons.
        appearance === 'control' && shape === 'tab' && 'border-transparent hover:border-transparent aria-pressed:border-transparent aria-selected:border-transparent',
        appearance === 'control' && shape === 'tab' && variant === 'ghost' && 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-primary)]',
        appearance === 'control' && shape === 'tab' && variant === 'secondary' && 'bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-strong)]',
        appearance !== 'control' && 'rounded-[var(--control-tab-radius)] border-transparent hover:border-transparent aria-pressed:border-transparent aria-selected:border-transparent',
        appearance === 'inline' && variant === 'ghost' && 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] font-normal',
        // The one decisive action (Create, Send, the empty state's verb) is a
        // pill, like the tabs and the quick-create property chips beside it.
        // A caller that sets its own corners (a split button's halves) keeps them.
        variant === 'primary' && !/(^|\s)rounded-/.test(className ?? '') && 'rounded-full'
      )}
      {...props}
    >
      {asChild ? children : buttonLabels(children)}
    </Comp>
  )
}

export { Button, buttonVariants }
