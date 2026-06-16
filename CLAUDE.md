# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web app for guitar players to assess the physical difficulty of chord shapes and note combinations. The target user has short fingers and low flexibility. The system measures fret/string distances between notes and scores each combination on a **1–10 reach difficulty scale** (1 = easy, 10 = hardest stretch).

## Core Domain Concepts

- **Notes/frets**: Positions on the guitar fretboard (6 strings × ~20 frets)
- **Reach distance**: Physical span required to play a set of notes simultaneously — considers both fret spread and string skip
- **Difficulty score**: 1–10 rating derived from reach distance metrics, calibrated for players with short fingers / low flexibility
- **Difficulty table**: A lookup/display table mapping note combinations → difficulty scores

## Getting Started

> Update this section once the project is initialized.

```bash
npm install       # Install dependencies
npm run dev       # Start development server
npm run build     # Production build
npm run test      # Run tests
npm run lint      # Lint code
```

## Verification — always confirm before reporting done

Before telling me a change works, actually verify it. Do not report success from "the code looks right" alone.

1. **Servers running?** Check the ports are actually listening (8080 backend, 5173 frontend) — not just that a start command was issued. Note: IntelliJ may already be running the backend on 8080, so a "port already in use" error often means it's up, not broken.
2. **Backend health:** `GET http://localhost:8080/actuator/health` should return `{"status":"UP"}`.
3. **Frontend loads:** request `http://localhost:5173/` *with an `Accept: text/html` header* — a bare request 404s by design (Vite's SPA fallback only triggers for HTML requests), which is not a real failure.
4. **Report honestly:** if something failed or was skipped, say so with the actual output. Only state "done and verified" when it has actually been checked.

## Architecture

> Fill in once the structure is established. Key areas to design:
> - Fretboard data model (string + fret → note name, physical position)
> - Distance calculation logic (fret spread, string span → raw difficulty)
> - Scoring algorithm (raw distance → 1–10 score, tuned for limited reach)
> - UI: fretboard visualizer + difficulty table display
