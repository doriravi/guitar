# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web app for guitar players to assess the physical difficulty of chord shapes and note combinations. The target user has short fingers and low flexibility. The system measures fret/string distances between notes and scores each combination on a **1–10 reach difficulty scale** (1 = easy, 10 = hardest stretch).

It is a two-part app: a **React + Vite** frontend (`client/`) and a **Spring Boot 3 / Java 21** backend (`server/`). The frontend holds all the guitar-physics domain logic and runs standalone; the backend adds accounts, hand-profile persistence, a PayPal paywall, and a Gemini-backed hand-photo analysis endpoint.

## Commands

### Frontend (`client/`)
```bash
npm install          # install deps
npm run dev          # Vite dev server on :5173 (proxies /api → :8080)
npm run build        # production build → client/dist
npm run preview      # serve the built bundle
npm run lint         # ESLint
npm run gen-icons    # regenerate PWA icons from scripts/icon.svg (needs sharp)
```

### PWA — the frontend is an installable app on all platforms
Installable everywhere via `vite-plugin-pwa` ([client/vite.config.js](client/vite.config.js));
manifest + service worker are build-time generated. Icons in `client/public/` come from
`client/scripts/icon.svg` via `npm run gen-icons`; iOS relies on the `apple-mobile-web-app-*`
meta in [client/index.html](client/index.html); [PWAPrompt.jsx](client/src/components/PWAPrompt.jsx)
handles the update toast + install button. The service worker never intercepts `/api`
(see `navigateFallbackDenylist`/`runtimeCaching`) — auth/backend requests always hit the network.

### Backend (`server/`)
```bash
mvn spring-boot:run                  # run on :8080 (dev profile, SQLite at server/data)
mvn clean package                    # build the jar (target/guitar-reach-api-0.0.1-SNAPSHOT.jar)
mvn test                             # run all tests
mvn test -Dtest=ClassName#methodName # run a single test
```

The backend selects a profile via `SPRING_PROFILES_ACTIVE` (`dev` default, `prod` for deploy). All secrets (`JWT_SECRET`, `PAYPAL_*`, `GEMINI_API_KEY`, `MAIL_*`; `STRIPE_*` legacy) come from env vars with dev placeholders in `application.properties` — features degrade gracefully when a key is absent (e.g. hand analysis returns 503).

## Verification — always confirm before reporting done

Before telling me a change works, actually verify it. Do not report success from "the code looks right" alone.

1. **Servers running?** Check the ports are actually listening (8080 backend, 5173 frontend) — not just that a start command was issued. Note: IntelliJ may already be running the backend on 8080, so a "port already in use" error often means it's up, not broken.
2. **Backend health:** `GET http://localhost:8080/actuator/health` should return `{"status":"UP"}`.
3. **Frontend loads:** request `http://localhost:5173/` *with an `Accept: text/html` header* — a bare request 404s by design (Vite's SPA fallback only triggers for HTML requests), which is not a real failure.
4. **Report honestly:** if something failed or was skipped, say so with the actual output. Only state "done and verified" when it has actually been checked.

## Chord-library rules — keep every chord supported everywhere

1. **Unknown chords: extend the library automatically.** The chord library
   [client/src/lib/chords.js](client/src/lib/chords.js) (consumed via
   `voicingLookup.js`) is the single source behind every graphic and sound:
   fretboard diagrams, hover shapes, difficulty scores, and audio playback.
   Imported/catalog songs carry real-sheet chord names (slash chords like
   `Am/G`, extensions like `F6`, `A7(4)`, `F7M2/4+`) that may be missing —
   `lookupVoicings(name)` returns `[]` for them, and every graphic silently
   degrades. Whenever you encounter such a chord anywhere in the app's data
   or while working on a task, **add a playable voicing for it to `chords.js`
   immediately, without being asked**, so all graphics support chords the
   user isn't familiar with yet. Follow the existing entry shape
   (`{ name, type, tab, notes }`), the 6-char `EADGBe` tab convention, and
   include only fretted notes in `notes` (opens/mutes excluded). Add ONE
   spelling only — enharmonics (Bb ↔ A#) resolve automatically. Prefer the
   common practical shape a beginner would be shown.
2. **Hover chord map everywhere.** Every place in the application that
   displays a chord name must show the chord's SHAPE (a `FretboardDiagram`
   tooltip) on hover — the pattern used by the Progressions tab's lyrics
   panel and the Song Editor's cells. When adding or touching any UI that
   renders chord names (chips, tables, previews, lists), wire the same
   hover-shape tooltip; never leave a chord name as plain text.

## Architecture

### The reach engine lives entirely in the frontend
[client/src/lib/fretboard.js](client/src/lib/fretboard.js) is the heart of the app and the most important file to read first. It is pure JS (no React, no backend) and owns the physics model:

- A note is `{ string: 0-5, fret: 0-22 }`. String 0 = low E, string 5 = high e. Standard tuning only.
- Physical geometry lives in [client/src/lib/geometry.js](client/src/lib/geometry.js) — the **single source of truth** shared by the reach engine AND the Fretboard Measures visualizer (`components/FretboardMeasures.jsx`). It models exact equal-temperament ("Rule of 18") fret spacing (`d(n) = scale·(1 − 1/2^(n/12))`, so d(12) = half the scale) and the real **tapered string span** (43→50 mm), all in mm, via `makeGeometry(inst).coord(string, fret)`. Higher frets are physically tighter, so the same fret-span is harder low on the neck.
- `calcDifficulty(notes, [profile])` → 1–10 from the exact Euclidean diagonal (mm) between the two furthest-apart notes (`maxReachMm`), calibrated (DIV≈126, EXP≈1.32) so open chords land ~2.4–5.4 and barres ~5.2–5.4 — the scale `LEVEL_CEILINGS`/`diffMax`/"limit to reach" depend on. The optional `profile` folds in the hand's real finger spans (`handStrainFactor`) so a small hand scores wide shapes strictly harder; called with one arg (the module-load voicing caches, reach filters) it returns the population-average score. The visualizer draws — and displays — this same score. Note: `LEVEL_CEILINGS.Beginner` is **6** (core open chords C/Dm/easy-F score ~5.1–5.4 under the exact geometry).
- `fingerGapUsage(notes)` expresses each adjacent finger-pair span as a fraction of a reference maximum — this is what powers the **per-finger / hand-profile personalization**.
- `optimalFingering(notes)` assigns fingers (1=index…4=pinky), detects barres, and is reused by `transitionDifficulty`.
- `transitionDifficulty(a, b)` scores the cost of *changing between* two chords (hand-shift + finger travel − common-tone/barre anchors). Chord changes, not static shapes, are treated as the real difficulty.
- `buildDifficultyTable` / `buildTripletTable` enumerate combinations for the table views.

Other `lib/` modules are data + supporting logic, consumed by the components:
- `chords.js`, `progressions.js`, `scales.js`, `songs.js` — static fretted-shape data. Tabs use the 6-char `EADGBe` convention (`x`=muted, `0`=open).
- `handProfile.js` — the user's hand measurements + reach level; turns raw difficulty into a personalized score. `DEFAULT_PROFILE` is the unauthenticated default.
- `audio.js` (Web Audio synthesis of strums), `pitchDetect.js` (real-time pitch/note detection) — power the Tuner and Listen features.
- `api.js` — the only place that talks to the backend; grouped into `auth`, `handProfile`, `user`, `subscriptions`. Sends cookies (`credentials: 'include'`).
- `i18n.js` — translation table; the app ships 10 languages.

### Frontend app shell
[client/src/App.jsx](client/src/App.jsx) is a single tabbed SPA (no router; tabs are state). It wires three React contexts that components read instead of prop-drilling:
- `HandProfileContext` — the active hand profile (drives personalized scores everywhere).
- `AIFingerContext` — finger-capability data from the Gemini hand analysis.
- `LangContext` — current language.

The hand profile is persisted to `localStorage` when logged out, and synced to the backend when logged in. Auth/reset tokens are read from URL query params on load.

### Backend (`server/`) — accounts & integrations, not guitar logic
Standard Spring Boot layering under `com.guitarreach.api`: `controller → service → repository (Spring Data JPA) → entity`, with `dto/request` + `dto/response`, `config`, `security`, `exception`, `enums`.

- **Persistence:** SQLite via `hibernate-community-dialects`, `ddl-auto=update` (schema auto-migrates). Dev DB at `server/data/`.
- **Auth:** JWT access + refresh tokens delivered as cookies; `JwtAuthenticationFilter` + `JwtTokenProvider` + `UserDetailsServiceImpl`. Roles `USER`/`ADMIN`.
- **Billing / paywall:** paid access — **$10 USD/year via PayPal**. `PayPalService` (Orders v2) sells a one-off yearly order; `SubscriptionService.capturePayPalOrder` verifies capture status/owner/amount server-side before extending `currentPeriodEnd`. **`PaidAccessFilter` is the gate**: authenticated-but-unpaid users get **402** on all `/api/**` except a short `FREE_PATHS` list (auth/reset, `/api/users/me` exact, `/api/subscriptions/**`, `/api/payments/**`, `/api/version`, `/actuator/**`). Anonymous passes through (stays 401/403, not 402); admins exempt. **New controllers are gated automatically** — free routes must be added to `FREE_PATHS` deliberately. `PAYWALL_ENABLED=false` for local dev; missing credentials → 503. Stripe (`StripeService`) is legacy-only, no longer a checkout path.
- **Email:** verification + password reset via `EmailService` (Spring Mail).
- **Hand analysis:** [HandAnalysisController](server/src/main/java/com/guitarreach/api/controller/HandAnalysisController.java) proxies a hand photo (base64) to Google Gemini with a fixed biomechanics prompt and returns a strict-JSON capability profile. Returns 503 if `GEMINI_API_KEY` is unset.
- **Audio → Tab:** [TabTranscriptionController](server/src/main/java/com/guitarreach/api/controller/TabTranscriptionController.java) proxies a guitar clip to the **`tab-service/`** Python sidecar (FastAPI over [fingerstyle-tab-mcp](https://github.com/blooper20/fingerstyle-tab-mcp): Basic Pitch + Demucs + music21). Returns ASCII tab **plus `{string,fret}` events** (0=low E … 5=high e) that `TabTranscriber.jsx` scores with the reach engine. 503 when `tab.service.url`/`TAB_SERVICE_URL` unset. Local: `cd tab-service && uvicorn app:app --port 8000`; prod hosting deferred — see [tab-service/README.md](tab-service/README.md).

### Deployment
Both services run on **Railway**, as two separate services in the same project:
- Frontend → `client/railway.json` (Nixpacks: `npm install && npm run build`, served via `npm start` → `serve dist`). `VITE_API_URL` points it at the backend service's Railway URL.
- Backend → `server/railway.json` + [Dockerfile](Dockerfile) (multi-stage Maven→JRE 21, `prod` profile). Health check at `/actuator/health`. The backend's `FRONTEND_URL` env var must point at the frontend service's Railway URL — `EmailService` builds verify/reset-password links from it. `CorsConfig` already allows any `*.up.railway.app` origin. `nginx-*.yaml` are unused k8s experiments.
