// HOUSE OVERRIDE — do not restore the shadcn defaults.
//
// `npx shadcn add input` ships this component with a 3px ring and a recoloured
// border on focus, a second ring for `aria-invalid`, and a drop shadow. All
// three are banned here: see .claude/CLAUDE.md 禁止事項 and DESIGN.md §5.3 —
// 入力系に枠・リング・アウトラインを付けない. `globals.css` kills every automatic
// outline (`*:focus { outline: none }`), so a ring written here would be the one
// place a blue box could come back from.
//
// What replaces them:
//   - resting frame: none in this file. The field deliberately carries NO
//     `bg-transparent`, which is what makes `globals.css` @layer base give it
//     `border: 1px solid var(--border-strong)`. That is the sanctioned resting
//     frame (DESIGN.md §5.3) and it is what keeps the field visible — it must
//     not be removed, and `bg-transparent` must not be added back here.
//   - focus: a background tint (`--accent-subtle`). Surface-independent, so it
//     reads the same on `bg-background` (dialogs) and `bg-card` (CreateView),
//     in every light and dark theme. Keyed on plain `:focus`, not
//     `:focus-visible` — a scripted `.focus()` (this component is `autoFocus`ed
//     in CreateView and ChannelDialog) does not always satisfy the
//     focus-visible heuristic, and a focused field with no tint would leave the
//     caret as the only cue.
//   - invalid: a destructive background tint, never a red border.
//
// If you re-run the shadcn generator, re-apply this file by hand.

import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-md px-3 py-1 text-base transition-[color,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus:bg-[var(--accent-subtle)]",
        "aria-invalid:bg-destructive/10 dark:aria-invalid:bg-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
