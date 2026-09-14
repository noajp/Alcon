"use client"

// Shared action and tab control. Geometry and borders follow /DESIGN.md.

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CONTROL } from "@/shared/designTokens"

const buttonVariants = cva(
  [
    "inline-flex items-center whitespace-nowrap shrink-0 select-none",
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
      shape: { action: CONTROL.actionRadius, tab: [CONTROL.tabRadius, "aria-pressed:border-[var(--border-strong)] aria-selected:border-[var(--border-strong)]"].join(" ") },
      variant: {
        /** Accent ground. One primary action per button group. */
        primary:
          "bg-[var(--accent-default)] text-white hover:bg-[var(--accent-hover)]",
        /** Neutral filled action, with the same fine border as every control. */
        secondary:
          "bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]",
        /**
         * The toolbar default. Transparent at rest; the hover ground is
         * `--surface-strong` for the reason MenuShell documents — in the light
         * themes `--accent` and the surface it sits on are the same colour, so
         * `hover:bg-accent` paints nothing.
         */
        ghost:
          "bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-strong)]",
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
        "icon-xs": [CONTROL.square.xs, "p-0 justify-center"].join(" "),
        "icon-sm": [CONTROL.square.sm, "p-0 justify-center"].join(" "),
        "icon-md": [CONTROL.square.md, "p-0 justify-center"].join(" "),
      },
      multiline: { true: "h-auto min-h-7 max-w-full whitespace-normal py-1.5 text-left justify-start", false: "" },
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

function Button({
  className,
  variant = "secondary",
  size = "sm",
  align = "center",
  shape = "action",
  multiline = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      className={cn(buttonVariants({ variant, size, align, shape, multiline, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
