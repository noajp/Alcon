"use client"

// THE button. Four hierarchies, three sizes, one radius — and the geometry
// comes from `CONTROL` in `shared/designTokens.ts`, not from numbers typed
// here, so the tokens and the primitive cannot drift apart.
//
// HOUSE OVERRIDE — do not restore the shadcn defaults. What was replaced and
// why (measured on `src/` before this rewrite; see
// `.claude/skills/design/references/buttons-and-controls.md`):
//
//   six variants → four. shadcn ships `default / secondary / outline / ghost /
//     destructive / link`. `outline` is gone: a bordered tier duplicates
//     `secondary` and adds a second way to draw the same emphasis (DESIGN.md
//     §5.2). `link` is gone: a link is an `<a>`. The four that remain are
//     Primer's, and Primer's rule comes with them — one `primary` per screen,
//     never two in a group.
//
//   seven sizes → three + three squares. `h-9 / h-8 / h-10 / size-9 / size-8 /
//     size-10` became 24 / 28 / 32px, matching the three heights the codebase
//     already clusters on. An icon-only button is the square of its step, so
//     `Sort ▾` and the icon button beside it are the same height.
//
//   `transition-all` → nothing. `globals.css` already transitions background,
//     color, border-color and opacity on every `button` at `--motion-fast`.
//     shadcn's `transition-all` additionally animated width and height, so a
//     button whose label changed grew visibly.
//
//   `focus-visible:ring-[3px]` + `focus-visible:border-ring` → a 2px ring and
//     no border change. The border recolour was invisible on the three
//     borderless variants. The ring stays a *ring* (box-shadow) rather than an
//     `outline`: `globals.css` sets `*:focus-visible { outline: none }`
//     unlayered, which beats any `@layer utilities` outline utility. Pressable
//     parts must show focus themselves (DESIGN.md §5.8) — buttons are on the
//     whitelist, inputs are not.
//
//   `justify-center` always → an `align` variant. Primer distinguishes a
//     dropdown trigger (label left, so the `▾` sits at the far edge and the
//     label starts where a label starts) from an execute CTA (centred). The
//     two are different objects and should not look identical.
//
// If you re-run the shadcn generator, re-apply this file by hand.

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { CONTROL } from "@/shared/designTokens"

const buttonVariants = cva(
  [
    "inline-flex items-center whitespace-nowrap shrink-0 select-none",
    CONTROL.radius,
    "font-medium",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    // Focus is the component's own job — globals.css gives nothing a ring.
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-hover)]",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Accent ground. One per screen; never two inside one button group. */
        primary:
          "bg-[var(--accent-default)] text-white hover:bg-[var(--accent-hover)]",
        /** Sits beside a primary. A filled step, not a border. */
        secondary:
          "bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]",
        /**
         * The toolbar default. Transparent at rest; the hover ground is
         * `--surface-strong` for the reason MenuShell documents — in the light
         * themes `--accent` and the surface it sits on are the same colour, so
         * `hover:bg-accent` paints nothing.
         */
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-primary)]",
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
      align: {
        /** Execute CTA — "press this and something happens". */
        center: "justify-center",
        /** Opens something (a menu, a calendar). Label left, glyph at the end. */
        start: "justify-start",
      },
    },
    defaultVariants: {
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
      className={cn(buttonVariants({ variant, size, align, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
