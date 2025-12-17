# Alcon UI Design Specification

## Color Tokens (VSCode Dark Theme)

### Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| bg-primary | `#1E1E1E` | Main background |
| bg-secondary | `#252526` | Sidebar, panels |
| bg-tertiary | `#2D2D30` | Tabs bar, inputs |
| bg-hover | `#2A2D2E` | Hover state |
| bg-active | `#37373D` | Active/selected |
| bg-selection | `#264F78` | Text selection |

### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| text-primary | `#CCCCCC` | Main text |
| text-secondary | `#858585` | Secondary text |
| text-muted | `#6E6E6E` | Disabled/muted |

### Border & Accent
| Token | Hex | Usage |
|-------|-----|-------|
| border-color | `#3C3C3C` | Borders |
| border-active | `#007ACC` | Active border |
| accent-primary | `#007ACC` | Primary accent (blue) |
| accent-secondary | `#0E639C` | Secondary accent |

### Status Colors
| Token | Hex | Usage |
|-------|-----|-------|
| status-success | `#4EC9B0` | Success/completed |
| status-warning | `#DCDCAA` | Warning |
| status-error | `#F14C4C` | Error/blocked |
| status-info | `#75BEFF` | Info |

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TITLE BAR (40px)                                                        │
│ [Logo] [                Search (⌘K)                ] [🔔] [🤖] [👤]    │
├────┬───────────┬─────────────────────────────────────┬──────────────────┤
│ A  │ SIDEBAR   │ MAIN CONTENT                        │ AI PANEL         │
│ C  │ (260px)   │ (flex: 1)                           │ (350px)          │
│ T  │           │                                     │                  │
│ I  │ TreeView  │ ┌─────────────────────────────────┐ │ Context          │
│ V  │           │ │ TABS BAR (35px)                 │ │ ────────         │
│ I  │ Projects  │ │ [Tab 1] [Tab 2] [+]             │ │ @task: xxx       │
│ T  │ Tasks     │ ├─────────────────────────────────┤ │                  │
│ Y  │ Sections  │ │                                 │ │ Chat             │
│    │           │ │ CONTENT AREA                    │ │ ────────         │
│ B  │           │ │                                 │ │ Messages...      │
│ A  │           │ │ Home View / Task View           │ │                  │
│ R  │           │ │                                 │ │ Quick Actions    │
│    │           │ │                                 │ │ ────────         │
│(48)│           │ │                                 │ │ [Analyze]        │
│ px │           │ └─────────────────────────────────┘ │                  │
│    │           │                                     │ Input            │
│    │           │                                     │ [____________]   │
├────┴───────────┴─────────────────────────────────────┴──────────────────┤
│ STATUS BAR (22px) bg: accent-primary                                    │
│ [🔒 main] [✓ Synced] [🤖 AI Active]          [● 2 pending] [v12] [👥 3]│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Title Bar
- **Height**: 40px
- **Background**: bg-tertiary (#2D2D30)
- **Border**: bottom 1px border-color

**Elements**:
- Logo: Diamond icon + "Alcon" text (font-semibold)
- Search: Center, max-width 448px, bg-primary, rounded, placeholder "Search... (⌘K)"
- Notification: 32x32px button, relative red dot (8x8px)
- AI Toggle: 32x32px, accent-primary when active
- User Avatar: 32x32px rounded-full, accent-primary bg

### 2. Activity Bar
- **Width**: 48px
- **Background**: #333333
- **Border**: right 1px border-color

**Icons** (24x24px, centered in 48x48px buttons):
1. Home (house icon)
2. Work (document list icon)
3. Agents (globe/AI icon)
4. Version (book icon)
5. Team (people icon)
--- spacer ---
6. Settings (gear icon)

**Active State**:
- Left border 2px accent-primary
- Icon color: text-primary (vs text-secondary)

### 3. Sidebar
- **Width**: 260px
- **Background**: bg-secondary (#252526)
- **Border**: right 1px border-color

**Header**:
- Height 36px
- Uppercase, 11px, tracking-wide, text-secondary

**TreeView Items**:
- Height: 22px
- Padding-left: 8px + (depth × 16px)
- Chevron: 12px, rotates 90° when expanded
- Icons: 16px
- Text: 13px

### 4. Main Content
- **Background**: bg-primary (#1E1E1E)
- **Flex**: 1 (fills remaining space)

**Tabs Bar**:
- Height: 35px
- Background: bg-tertiary
- Active tab: bg-primary, text-primary
- Inactive tab: bg-tertiary, text-secondary

**Content Area**:
- Padding: 24px
- Max-width for content: 768px (3xl) or 896px (4xl)

### 5. AI Panel
- **Width**: 350px
- **Background**: bg-secondary
- **Border**: left 1px border-color

**Sections**:
1. Header (36px): Icon + "Alcon AI" + green dot + close button
2. Context (48px): bg-tertiary, chips showing context
3. Messages: flex-1, overflow-y-auto, padding 16px
4. Quick Actions: chips, padding 8px 16px
5. Input: padding 16px, input + send button

**Message Bubbles**:
- User: accent-primary bg, white text, align-right
- AI: bg-tertiary, text-primary, align-left
- Max-width: 85%
- Border-radius: 8px
- Padding: 12px

### 6. Status Bar
- **Height**: 22px
- **Background**: accent-primary (#007ACC)
- **Text**: white, 12px

**Left Items**: branch, sync status, AI status
**Right Items**: pending count, version, online users

---

## Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page Title | 24px | light (300) | text-primary |
| Section Title | 14px | medium (500) | text-secondary |
| Body | 13px | normal (400) | text-primary |
| Small/Label | 11px | normal | text-muted |
| Uppercase Label | 11px | semibold | text-secondary |

**Font Stack**: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif

---

## Interactive States

### Buttons
- Default: bg-tertiary, text-primary
- Hover: bg-hover
- Active/Pressed: bg-active
- Primary: accent-primary bg, white text

### Tree Items
- Default: transparent
- Hover: bg-hover
- Selected: bg-active

### Inputs
- Background: bg-tertiary
- Border: 1px border-color
- Focus: border accent-primary
- Placeholder: text-muted

---

## Figma Setup Instructions

1. **Create new Figma file**: "Alcon Design System"

2. **Set up color styles**:
   - Create all tokens from Color Tokens section
   - Use naming: `bg/primary`, `text/primary`, `accent/primary`, etc.

3. **Create components**:
   - Start with atomic elements (buttons, inputs, badges)
   - Build up to molecules (tree items, tabs, message bubbles)
   - Compose into organisms (sidebar, main content, panels)

4. **Create frames**:
   - Desktop: 1440 x 900
   - Use Auto Layout for responsive behavior

5. **Recommended plugins**:
   - Figma Tokens (for design tokens)
   - Auto Layout (built-in)
