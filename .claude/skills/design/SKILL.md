---
name: design
description: Frontend design aesthetics guide. Use when creating UI components, styling, CSS, themes, or any visual design work. Ensures distinctive, creative frontends that avoid generic AI-generated aesthetics.
allowed-tools: Read, Write, Edit, Glob, Grep
---

# Frontend Design Aesthetics

This skill guides the creation of distinctive, creative frontends that surprise and delight users. Avoid generic "AI slop" aesthetics.

## Core Principles

### Typography
- Choose fonts that are beautiful, unique, and interesting
- **Avoid**: Arial, Inter, Roboto, system fonts
- **Prefer**: Distinctive choices that elevate aesthetics
- Consider: Serif fonts, display fonts, variable fonts with unique weights

### Color & Theme
- Commit to a cohesive aesthetic
- Use CSS variables for consistency
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Draw inspiration from:
  - IDE themes (Dracula, Nord, Catppuccin, Gruvbox)
  - Cultural aesthetics (Japanese minimalism, Brutalism, Art Deco)
  - Nature and photography

### Motion & Animation
- Use animations for effects and micro-interactions
- Prioritize CSS-only solutions for HTML
- Use Motion library for React when available
- Focus on high-impact moments:
  - One well-orchestrated page load with staggered reveals (`animation-delay`)
  - Creates more delight than scattered micro-interactions

### Backgrounds & Atmosphere
- Create atmosphere and depth rather than defaulting to solid colors
- Layer CSS gradients
- Use geometric patterns
- Add contextual effects that match the overall aesthetic

## What to Avoid

| Category | Avoid |
|----------|-------|
| Fonts | Inter, Roboto, Arial, system fonts, Space Grotesk (overused) |
| Colors | Purple gradients on white backgrounds, generic blue/gray schemes |
| Layouts | Predictable component patterns, cookie-cutter designs |
| Overall | Anything that looks like "every other AI-generated site" |

## Creative Guidelines

1. **Interpret creatively** - Make unexpected choices that feel genuinely designed for the context
2. **Vary between themes** - Light, dark, and unique color schemes
3. **Think outside the box** - Avoid converging on common choices
4. **Context-specific character** - Design should reflect the project's unique identity

## Example Approaches

### Instead of Generic:
```css
/* Generic AI slop */
font-family: Inter, system-ui, sans-serif;
background: linear-gradient(to right, #667eea, #764ba2);
```

### Try Distinctive:
```css
/* Distinctive and memorable */
font-family: 'Syne', 'Playfair Display', serif;
background:
  radial-gradient(ellipse at top, #1a1a2e 0%, transparent 50%),
  linear-gradient(180deg, #0f0f23 0%, #1a1a2e 100%);
```

## Font Suggestions (Non-Exhaustive)

- **Display**: Syne, Clash Display, Cabinet Grotesk, Satoshi
- **Serif**: Playfair Display, Cormorant, Fraunces, Literata
- **Sans**: General Sans, Switzer, Outfit, Plus Jakarta Sans
- **Mono**: JetBrains Mono, Fira Code, Berkeley Mono

## Color Palette Inspiration

- **Dracula**: Deep purples with pink/cyan accents
- **Nord**: Cool blues with frost tones
- **Catppuccin**: Warm pastels with depth
- **Tokyo Night**: Neon accents on deep blue
- **Gruvbox**: Warm retro with orange/yellow accents
