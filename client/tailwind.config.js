/** @type {import('tailwindcss').Config} */

// ── Guitar Reach design system ────────────────────────────────────────────────
// Single source of truth for the app's palette. These tokens mirror the CSS
// variables in src/index.css and are documented in src/DESIGN_SYSTEM.md.
// Named semantically so Claude Design (`/design-sync`) and future theming read a
// coherent system instead of ~1,300 scattered inline hex values.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand / primary accent — the warm gold used for CTAs, highlights, focus.
        brand: {
          DEFAULT: '#c9a96e',
          hover:   '#b8913a',
          soft:    '#8a7a5a',
        },
        // Surface layers, darkest → lightest. `base` is the app background.
        surface: {
          base:  '#0f0f0f',
          900:   '#111111',
          850:   '#141414',
          800:   '#161616',
          750:   '#1a1a1a',
          700:   '#1e1e1e',
          650:   '#222222',
          600:   '#252525',
          550:   '#2a2a2a',
        },
        // Text tiers, brightest → dimmest.
        ink: {
          DEFAULT: '#f0ede8', // primary text
          muted:   '#9a9a9a',
          subtle:  '#7a7a7a',
          faint:   '#5a5a5a',
          ghost:   '#3a3a3a',
        },
        // Per-string colors (low-E … high-e), reused across fretboard visuals.
        string: {
          e6: '#a78bfa', // low E
          a:  '#38bdf8',
          d:  '#34d399',
          g:  '#c9a96e',
          b:  '#fb923c',
          e1: '#f87171', // high e
        },
        // Semantic status colors.
        success: '#4ade80',
        info:    '#38bdf8',
        accent:  '#a78bfa', // secondary accent (purple) — chords/AI features
        warning: '#fb923c',
        danger:  '#f87171',
      },
    },
  },
  plugins: [],
}
