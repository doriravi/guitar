# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A web app for guitar players to assess the physical difficulty of chord shapes and note combinations. The target user has short fingers and low flexibility. The system measures fret/string distances between notes and scores each combination on a **1–10 reach difficulty scale** (1 = easy, 10 = hardest stretch).

It is a two-part app: a **React + Vite** frontend (`client/`) and a **Spring Boot 3 / Java 21** backend (`server/`). The frontend holds all the guitar-physics domain logic and runs standalone; the backend adds accounts, hand-profile persistence, Stripe subscriptions, and a Gemini-backed hand-photo analysis endpoint.

## Commands

### Frontend (`client/`)
```bash
npm install          # install deps
npm run dev          # Vite dev server on :5173 (proxies /api → :8080)
npm run build        # production build → client/dist
npm run preview      # serve the built bundle
npm run lint         # ESLint
```

### Backend (`server/`)
```bash
mvn spring-boot:run                  # run on :8080 (dev profile, SQLite at server/data)
mvn clean package                    # build the jar (target/guitar-reach-api-0.0.1-SNAPSHOT.jar)
mvn test                             # run all tests (note: no test classes exist yet)
mvn test -Dtest=ClassName#methodName # run a single test once tests are added
```

The backend selects a profile via `SPRING_PROFILES_ACTIVE` (`dev` default, `prod` for deploy). All secrets (`JWT_SECRET`, `STRIPE_*`, `GEMINI_API_KEY`, `MAIL_*`) come from env vars with dev placeholders in `application.properties` — features degrade gracefully when a key is absent (e.g. hand analysis returns 503).

## Verification — always confirm before reporting done

Before telling me a change works, actually verify it. Do not report success from "the code looks right" alone.

1. **Servers running?** Check the ports are actually listening (8080 backend, 5173 frontend) — not just that a start command was issued. Note: IntelliJ may already be running the backend on 8080, so a "port already in use" error often means it's up, not broken.
2. **Backend health:** `GET http://localhost:8080/actuator/health` should return `{"status":"UP"}`.
3. **Frontend loads:** request `http://localhost:5173/` *with an `Accept: text/html` header* — a bare request 404s by design (Vite's SPA fallback only triggers for HTML requests), which is not a real failure.
4. **Report honestly:** if something failed or was skipped, say so with the actual output. Only state "done and verified" when it has actually been checked.

## Architecture

### The reach engine lives entirely in the frontend
[client/src/lib/fretboard.js](client/src/lib/fretboard.js) is the heart of the app and the most important file to read first. It is pure JS (no React, no backend) and owns the physics model:

- A note is `{ string: 0-5, fret: 0-22 }`. String 0 = low E, string 5 = high e. Standard tuning only.
- Fret spacing is modeled in mm/cm and **shrinks at higher frets** (`fretSpacingMm`), so the same fret-span is harder low on the neck.
- `calcDifficulty(notes)` → 1–10 from the Euclidean diagonal of fret-reach and string-reach, calibrated so ~90mm diagonal = 10.
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
- **Billing:** Stripe (`StripeService`, `SubscriptionController`); plans FREE/MONTHLY/YEARLY.
- **Email:** verification + password reset via `EmailService` (Spring Mail).
- **Hand analysis:** [HandAnalysisController](server/src/main/java/com/guitarreach/api/controller/HandAnalysisController.java) proxies a hand photo (base64) to Google Gemini with a fixed biomechanics prompt and returns a strict-JSON capability profile. Returns 503 if `GEMINI_API_KEY` is unset.
- **Audio → Tab:** [TabTranscriptionController](server/src/main/java/com/guitarreach/api/controller/TabTranscriptionController.java) proxies an uploaded guitar clip (multipart) to the **`tab-service/`** Python sidecar — a FastAPI wrapper around [fingerstyle-tab-mcp](https://github.com/blooper20/fingerstyle-tab-mcp) (Basic Pitch + Demucs + music21). The sidecar returns ASCII tab **plus structured `{string,fret}` events** (string convention 0=low E … 5=high e, matching the app), which the frontend (`TabTranscriber.jsx`) scores with the existing reach engine. Same graceful-degradation contract as Gemini: 503 when `tab.service.url` / `TAB_SERVICE_URL` is unset. Run locally with `cd tab-service && uvicorn app:app --port 8000`; production hosting is deferred — see [tab-service/README.md](tab-service/README.md).

### Deployment
- Frontend → **Vercel** ([vercel.json](vercel.json): Vite build, SPA rewrite). `VITE_API_URL` points it at the backend.
- Backend → **Railway** via [Dockerfile](Dockerfile) (multi-stage Maven→JRE 21, `prod` profile). Health check at `/actuator/health`. `nginx-*.yaml` are unused k8s experiments.
