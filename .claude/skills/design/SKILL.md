---
name: frontend-design
description: Build or change Alcon's UI — components, views, screens, or any frontend in this repo. Loads the Alcon Design System and enforces it. Use whenever creating or editing UI here.
---

This project has a strict, opinionated design system. **Before writing or changing any UI, read `DESIGN.md` (this skill's sibling file) and follow it.** It holds the principles and rules — which token to use where, and why.

`DESIGN.md` deliberately contains no literal values. Colors, spacing, radius and motion live in `web/src/app/globals.css` as CSS variables; type / status / priority / card class bundles live in `web/src/shared/designTokens.ts`; concept icons live in `web/src/alcon/shared/conceptIcons.tsx`. Those files are the source of truth for values. Measured reference numbers and convergence targets (popover widths, button sizes) live in `references/`.

Alcon's system is grounded in Linear's design language: high information density, quiet surfaces across eight themes, a single accent, type-led hierarchy, borders and luminance instead of shadows, and keyboard-first interaction. The bar is production-grade craft — restraint and precision, not generic "AI slop."

## Workflow
1. **Read `DESIGN.md` first.** Then read the matching file in `references/` if you're touching creation flows, menus/popovers, or buttons/sort/filter — those hold measured specs you should not re-derive from memory.
2. Pull values from `globals.css` / `designTokens.ts`. Never hardcode hex or off-grid px.
3. Look at a sibling component in `web/src` before inventing layout; match the existing patterns.
4. Honor the hard rules (also in `CLAUDE.md`): 4px spacing grid, remapped weight utilities instead of numeric font-weight, Lucide outline icons at the default stroke, **no focus ring / border / outline on `<input>` / `<textarea>` / `[contenteditable]`**, no box-shadow for in-canvas elevation, one accent only, no uppercase labels.
5. Run `cd web && npm run design-lint` and `cd web && npx tsc --noEmit`.
6. Verify in the browser preview at a desktop width and a narrow one, in both light and dark.

## Craft within the system
The constraints are the aesthetic — elegance comes from executing them well, not from decoration. Still push for distinctive, meticulous work: precise spacing and density, every interaction state (hover / active / selected / focus-visible / disabled / loading), and functional motion. Repeated UI becomes a shared primitive the first time it repeats.

Never introduce: off-system colors, off-grid spacing, heavy shadows, decorative gradients/noise, hand-rolled buttons and menus that bypass the shared primitives, or cookie-cutter layouts that ignore `DESIGN.md`.
