---
name: frontend-design
description: Build or change Alcon's UI — components, views, screens, or any frontend in this repo. Loads the Alcon Design System and enforces it. Use whenever creating or editing UI here.
---

This project has a strict, opinionated design system. **Before writing or changing any UI, read `DESIGN.md` (this skill's sibling file) and follow it exactly.** It is the single source of truth for color, typography, spacing, components, elevation, motion, iconography, and anti-patterns.

Alcon's system is grounded in Linear's design language: high information density, quiet dark-first surfaces, a single accent, type-led hierarchy (weights 510 / 590), borders & luminance instead of shadows, and keyboard-first interaction. The bar is production-grade craft — restraint and precision, not generic "AI slop."

## Workflow
1. **Read `DESIGN.md` first** and pull the exact tokens for what you're building. Colors and sizing go through CSS variables (`var(--*)`) — never hardcode hex or off-grid px.
2. Look at a sibling component in `web/src` before inventing layout; match the existing patterns.
3. Honor the hard rules (also in `CLAUDE.md`): 4px spacing grid, font-weight ≤ 590, Lucide outline icons, **no focus ring / border / outline on `<input>` / `<textarea>` / `[contenteditable]`**, no box-shadow for in-canvas elevation, one accent only.
4. Run `cd web && npx tsc --noEmit`.
5. Verify in the browser preview at a desktop width and a narrow one.

## Craft within the system
The constraints are the aesthetic — elegance comes from executing them well, not from decoration. Still push for distinctive, meticulous work: precise spacing and density, every interaction state (hover / active / selected / focus-visible / disabled / loading), progressive type tracking on large display sizes, and functional motion (100–300ms, easeOutQuad / easeOutQuart, no bounce or spring).

Never introduce: off-system colors, off-grid spacing, 700+ font weights, heavy shadows, decorative gradients/noise, or cookie-cutter layouts that ignore `DESIGN.md`.
