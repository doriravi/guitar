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

## Architecture

> Fill in once the structure is established. Key areas to design:
> - Fretboard data model (string + fret → note name, physical position)
> - Distance calculation logic (fret spread, string span → raw difficulty)
> - Scoring algorithm (raw distance → 1–10 score, tuned for limited reach)
> - UI: fretboard visualizer + difficulty table display
