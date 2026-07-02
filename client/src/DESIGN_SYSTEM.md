# Guitar Reach — Design System

Single source of truth for the app's visual language. Defined once as tokens and
consumed everywhere, so theming is centralized and the system is legible to
tooling (e.g. Claude Design `/design-sync`) instead of scattered inline hex.

Tokens live in two mirrored places:
- **Tailwind** — [`tailwind.config.js`](../tailwind.config.js) `theme.extend.colors`, used via utility classes (`bg-surface-800`, `text-ink-muted`, `text-brand`).
- **CSS variables** — [`src/index.css`](./index.css) `:root`, used in inline `style` props that can't use utilities (`style={{ background: 'var(--color-surface-800)' }}`).

Both are kept identical. Change a value in one, change it in the other.

## Color tokens

### Brand / accent
The warm gold is the primary brand color — CTAs, highlights, focus, active states.

| Token | Hex | Tailwind | CSS var | Use |
|-------|-----|----------|---------|-----|
| Brand | `#c9a96e` | `brand` | `--color-brand` | Primary buttons, active tabs, focus glow |
| Brand hover | `#b8913a` | `brand-hover` | `--color-brand-hover` | Pressed/hover state of brand elements |
| Brand soft | `#8a7a5a` | `brand-soft` | `--color-brand-soft` | Muted brand text/labels |

### Surfaces (dark → light)
Background layering. `base` is the page background; higher numbers = raised panels, cards, inputs, borders.

| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| Base | `#0f0f0f` | `surface-base` | App background, button text on brand |
| 900 | `#111111` | `surface-900` | Deepest wells |
| 850 | `#141414` | `surface-850` | Card interiors |
| 800 | `#161616` | `surface-800` | Panels, table headers |
| 750 | `#1a1a1a` | `surface-750` | Cards, inputs |
| 700 | `#1e1e1e` | `surface-700` | Raised chips, active pills |
| 650 | `#222222` | `surface-650` | Borders |
| 600 | `#252525` | `surface-600` | Borders / dividers (lighter) |
| 550 | `#2a2a2a` | `surface-550` | Borders / scrollbar / track |

### Text (bright → dim)

| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| Ink | `#f0ede8` | `ink` | Primary text |
| Muted | `#9a9a9a` | `ink-muted` | Secondary text |
| Subtle | `#7a7a7a` | `ink-subtle` | Tertiary text |
| Faint | `#5a5a5a` | `ink-faint` | Labels, captions |
| Ghost | `#3a3a3a` | `ink-ghost` | Disabled, placeholders, dividers |

### Strings
Per-string identity colors (low-E → high-e), reused across the fretboard, notation, and beat visuals. Order matters — it maps to string index 0–5.

| String | Hex | Tailwind |
|--------|-----|----------|
| Low E (0) | `#a78bfa` | `string-e6` |
| A (1) | `#38bdf8` | `string-a` |
| D (2) | `#34d399` | `string-d` |
| G (3) | `#c9a96e` | `string-g` |
| B (4) | `#fb923c` | `string-b` |
| High e (5) | `#f87171` | `string-e1` |

> Note: `STRING_COLORS` in `components/GuitarStrings.jsx` is the runtime array of
> these same values (JS needs the literals for canvas drawing). Keep it in sync.

### Semantic status

| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| Success | `#4ade80` | `success` | Easy difficulty, confirmations, "in frame" |
| Info | `#38bdf8` | `info` | Editing state, informational accents |
| Accent | `#a78bfa` | `accent` | Chords / AI features (secondary accent) |
| Warning | `#fb923c` | `warning` | Caution, medium difficulty |
| Danger | `#f87171` | `danger` | Errors, hard difficulty, destructive actions |

## Conventions

- **New UI**: prefer Tailwind utility classes with these tokens (`className="bg-surface-750 text-ink-muted border border-surface-550"`).
- **Canvas / dynamic inline styles**: use the CSS variables (`var(--color-brand)`).
- **Migration**: the existing components still contain many inline hex literals.
  Migrate opportunistically to tokens when touching a component — no need for a
  single mass rewrite.

## Claude Design (`/design-sync`)

With tokens defined here, `/design-sync` in Claude Code can pull this system so
any generated UI stays on-brand. See the repo owner's Claude account for access
(Claude Design is a separate Anthropic Labs product; the sync commands are
user-triggered, not runnable from a plain Claude Code session).
