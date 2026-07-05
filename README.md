# Guitar Reach Difficulty

A web app that helps guitar players — especially those with **short fingers or low
flexibility** — understand and train the *physical difficulty* of chord shapes and
note combinations. The engine measures fret/string distances between notes and scores
each combination on a **1–10 reach-difficulty scale** (1 = easy, 10 = hardest stretch),
personalized to your own hand.

It is a two-part application:

- **`client/`** — a **React 18 + Vite** single-page app that holds *all* the
  guitar-physics domain logic and runs completely standalone.
- **`server/`** — a **Spring Boot 3 / Java 21** backend that adds accounts,
  hand-profile persistence, Stripe subscriptions, email, and AI-backed features
  (hand-photo analysis, chord/song advice, composition, explanations).
- **`tab-service/`** — an optional **Python / FastAPI** sidecar that transcribes an
  audio clip to guitar tab (Basic Pitch + Demucs + music21) for the reach engine to score.

The frontend does not need the backend to demonstrate the core value: the reach engine,
chord library, progressions, tuner, and pitch detection are all pure client-side.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [The reach engine](#the-reach-engine-the-heart-of-the-app)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Backend configuration](#backend-configuration)
- [API surface](#api-surface)
- [Data & domain modules](#data--domain-modules)
- [Internationalization](#internationalization)
- [Deployment](#deployment)
- [Contributing conventions](#contributing-conventions)

---

## Features

**Reach & difficulty**
- Physics-based **1–10 reach difficulty** for any chord shape or note combination,
  calibrated so a ~130 mm fret+string diagonal reads as 10.
- **Personalized scoring** from your measured hand (finger-gap spans + reach level):
  the same chord is easier or harder depending on *your* hand.
- **Transition difficulty** — scores the cost of *changing between* two chords
  (hand shift + finger travel − shared tones/barre anchors), because chord changes
  are the real difficulty, not static shapes.
- **Difficulty / triplet tables** enumerating combinations across the neck.

**Hand profiling**
- Manual **Hand Profile Setup** (per-finger gap sliders + reach level).
- **Camera hand measurement** using **MediaPipe Hands** world landmarks, calibrated
  against an ISO ID-1 card (8.56 cm) to produce true centimetre spans.
- **AI hand-photo analysis** — upload a photo; the backend proxies it to a vision model
  (Gemini or Claude) with a fixed biomechanics prompt and returns a structured
  finger-capability profile.

**Chords, progressions & songs**
- A single **chord library** (`chords.js`) drives every graphic and sound: fretboard
  diagrams, hover shapes, difficulty scores, and audio playback.
- **Progression Explorer** — browse diatonic progressions and real songs, see each
  chord's shape, and **play the whole song** as a synth backing track.
- **Song Editor / Importer** — paste a "chords over lyrics" sheet or build songs in a
  step editor; import from the global song catalog.
- **Play-Along practice game** — chords scroll toward a now-line in time with the song;
  the mic listens to your real guitar and scores each chord live (perfect / good /
  partial / miss) with combo, grade, a 20-stage speed ladder, a metronome, an optional
  drum backing, **synchronized lyrics**, and a detailed post-run practice report.
- **3D fretboard/neck** visualisations (Three.js / React Three Fiber).

**Audio & listening**
- Web-Audio **strum synthesis** for chord/song playback.
- Real-time **pitch/note detection** powering the **Tuner** and **Listen** tools.
- **Audio → Tab transcription** via the optional Python sidecar.

**Accounts & platform**
- JWT auth (access + refresh cookies), email verification & password reset,
  **Google / Facebook OAuth**.
- **Stripe** subscriptions (FREE / MONTHLY / YEARLY).
- **10 languages** (English, Spanish, Chinese, Hindi, Arabic, Portuguese, French,
  German, Japanese, Korean).

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
   Browser  ───────▶│  client/  React 18 + Vite (port 5173)    │
                    │  • ALL guitar-physics domain logic       │
                    │  • reach engine, chords, audio, pitch    │
                    │  • MediaPipe camera hand measurement     │
                    └───────────────┬─────────────────────────┘
                        /api (proxy) │  cookies: credentials: 'include'
                    ┌───────────────▼─────────────────────────┐
                    │  server/  Spring Boot 3 / Java 21 (8080) │
                    │  controller → service → repository → JPA │
                    │  • accounts, JWT, OAuth, Stripe, email   │
                    │  • AI proxies (hand analysis, advice…)   │
                    │  • SQLite (ddl-auto=update)              │
                    └──────┬───────────────────────┬──────────┘
              vision model │                       │ HTTP proxy
             (Gemini/Claude)                       ▼
                                     ┌──────────────────────────────┐
                                     │ tab-service/ FastAPI (8000)  │
                                     │ Basic Pitch + Demucs + music21│
                                     └──────────────────────────────┘
```

**Frontend app shell** — [`client/src/App.jsx`](client/src/App.jsx) is a single tabbed
SPA (no router; tabs are state). Three React contexts are read by components instead of
prop-drilling:

- `HandProfileContext` — the active hand profile (drives personalized scores everywhere).
- `AIFingerContext` — finger-capability data from AI hand analysis.
- `LangContext` — current language.

The hand profile is persisted to `localStorage` when logged out and synced to the backend
when logged in. `client/src/lib/api.js` is the only place that talks to the backend
(sends cookies, auto-refreshes expired access tokens on 401/403).

---

## The reach engine (the heart of the app)

[`client/src/lib/fretboard.js`](client/src/lib/fretboard.js) is pure JavaScript — no React,
no backend — and owns the physics model. Read it first.

- A note is `{ string: 0–5, fret: 0–22 }`. **String 0 = low E, string 5 = high e.**
  Standard tuning only.
- Fret spacing is modeled in mm/cm and **shrinks at higher frets** (`fretSpacingMm`), so
  the same fret-span is physically harder low on the neck.
- `calcDifficulty(notes)` → 1–10 from the Euclidean diagonal of fret-reach and
  string-reach (convex curve, ~130 mm diagonal = 10).
- `fingerGapUsage(notes)` expresses each adjacent finger-pair span as a fraction of a
  reference maximum — this powers per-finger / hand-profile **personalization**.
- `optimalFingering(notes)` assigns fingers (1 = index … 4 = pinky), detects barres, and
  is reused by `transitionDifficulty`.
- `transitionDifficulty(a, b)` scores changing between two chords.
- `buildDifficultyTable` / `buildTripletTable` enumerate combinations for the table views.

Personalization lives in [`handProfile.js`](client/src/lib/handProfile.js): a
ratio-to-average model turns raw difficulty into a personalized score, using real adult
hand-anatomy reference data (typical finger-gap averages/ranges). `DEFAULT_PROFILE` is the
unauthenticated default.

---

## Repository layout

```
guitar/
├── client/                     React 18 + Vite frontend (all guitar logic)
│   ├── src/
│   │   ├── App.jsx             tabbed SPA shell + React contexts
│   │   ├── components/         ~40 UI components (see below)
│   │   └── lib/                domain logic & data (see below)
│   ├── package.json
│   └── vite.config.js          dev server :5173, proxies /api → :8080
├── server/                     Spring Boot 3 / Java 21 backend
│   └── src/main/java/com/guitarreach/api/
│       ├── controller/         REST controllers (see API surface)
│       ├── service/            business logic
│       ├── repository/         Spring Data JPA
│       ├── entity/             User, HandProfile, SavedSong, CatalogSong,
│       │                       Subscription, Payment, VerificationToken
│       ├── dto/ config/ security/ exception/ enums/
│       └── resources/application.properties
├── tab-service/                Python / FastAPI audio→tab sidecar (optional)
├── docs/                       project docs
├── Dockerfile                  multi-stage Maven → JRE 21 (backend, prod)
├── railway.json                backend deploy (Railway)
├── vercel.json                 frontend deploy (Vercel, SPA rewrite)
├── nginx-*.yaml                unused k8s experiments
└── CLAUDE.md                   guidance for AI coding assistants
```

### Key frontend `lib/` modules

| Module | Responsibility |
| --- | --- |
| `fretboard.js` | **The reach engine** — physics model, difficulty, fingering, transitions |
| `handProfile.js` | Hand measurements + reach level → personalized difficulty |
| `chords.js` | Chord library (single source of shapes for graphics + sound) |
| `voicingLookup.js` | Resolve a chord name → playable voicings (+ enharmonics) |
| `progressions.js`, `scales.js`, `songs.js` | Static progression / scale / song data |
| `songTimeline.js` | Shared per-cell chord resolution (display, editor, game, playback) |
| `catalogSongs.js`, `customSongs.js`, `composerLibrary.js` | Song sources & bridges |
| `chordSheetParser.js`, `lyricChords.js` | Parse "chords over lyrics" sheets, align chords |
| `practiceGame.js`, `practiceReport.js` | Play-Along scoring engine + post-run diagnosis |
| `audio.js` | Web-Audio strum / progression / metronome / drum synthesis |
| `pitchDetect.js`, `micDetect.js` | Real-time pitch / chord detection from the mic |
| `substitutions.js`, `triadVoicings.js`, `upperVoicings.js` | Easier-voicing suggestions |
| `songReach.js` | Filter songs by whether they fit your reach |
| `api.js` | The only backend client (auth, handProfile, user, subscriptions, …) |
| `i18n.js` | Translation table (10 languages) |

### Key frontend components

`ProgressionExplorer`, `SongEditor`, `SongImporter`, `PracticeGame`, `ChordTable`,
`DifficultyTable`, `TripletTable`, `FretboardDiagram`, `ChordTip`, `Neck3D`,
`GuitarStrings`, `NoteStaff`, `OscilloscopeTuner`, `ChordListener`, `TabTranscriber`,
`HandProfileSetup`, `CameraHandMeasure`, `AccountSettings`, `AuthModal`,
`ForgotPassword`, `ResetPassword`, `LandingPage`, `StartHere`, `AdvisorWidget`,
`GuideAvatar`, `DifficultyBadge`.

---

## Getting started

### Prerequisites

- **Node.js** 18+ and npm (frontend)
- **JDK 21** and **Maven** (backend)
- **Python 3** (only for the optional tab-service)

### Frontend (`client/`)

```bash
cd client
npm install
npm run dev        # Vite dev server on http://localhost:5173 (proxies /api → :8080)
npm run build      # production build → client/dist
npm run preview    # serve the built bundle
npm run lint       # ESLint
npm run test:e2e   # Playwright end-to-end tests
```

The frontend works standalone — open http://localhost:5173/ and the reach engine, chord
library, progressions, tuner, and pitch detection are all available without a backend.

### Backend (`server/`)

```bash
cd server
mvn spring-boot:run                     # run on http://localhost:8080 (dev profile)
mvn clean package                       # build target/guitar-reach-api-0.0.1-SNAPSHOT.jar
mvn test                                # run tests
mvn test -Dtest=ClassName#methodName    # run a single test
```

The dev profile uses a **SQLite** database (auto-created under `server/data/`, schema
auto-migrates via `ddl-auto=update`). Health check: `GET http://localhost:8080/actuator/health`
→ `{"status":"UP"}`.

> On Windows/IntelliJ the backend may already be running on 8080 — a "port already in use"
> error usually means it's up, not broken.

### tab-service (optional)

```bash
cd tab-service
uvicorn app:app --port 8000
```

Point the backend at it with `TAB_SERVICE_URL=http://localhost:8000`. Without it,
`/api/tab/transcribe` returns **503** (graceful degradation). See
[`tab-service/README.md`](tab-service/README.md).

---

## Backend configuration

The backend selects a profile via `SPRING_PROFILES_ACTIVE` (`dev` default, `prod` for
deploy). **All secrets come from environment variables** with dev placeholders in
`application.properties`; features **degrade gracefully** when a key is absent.

| Env var | Purpose |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `dev` (default) / `prod` |
| `DB_PATH` | SQLite file path (default `/app/data/guitarreach.db`) |
| `PORT` | HTTP port (default 8080) |
| `JWT_SECRET` | JWT signing secret |
| `FRONTEND_URL` | Frontend origin for CORS / links (default `http://localhost:5173`) |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | Cross-site cookie flags (`true` / `None` in prod) |
| `GEMINI_API_KEY` | Gemini vision — hand-photo analysis (503 if unset) |
| `ANTHROPIC_API_KEY` / Claude key | Claude — hand analysis, advice, compose, explain |
| `STRIPE_*`, `STRIPE_PRICE_ID_MONTHLY`, … | Stripe billing |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USERNAME` / `MAIL_PASSWORD` | Email (verify / reset) |
| `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID` | OAuth login |
| `TAB_SERVICE_URL` | audio→tab sidecar (503 if unset) |

**Auth model:** JWT access token (15 min) + refresh token (7 days) delivered as cookies;
`JwtAuthenticationFilter` + `JwtTokenProvider` + `UserDetailsServiceImpl`. Roles
`USER` / `ADMIN`. The frontend `api.js` performs single-flight refresh-and-retry on
`401/403`.

---

## API surface

All endpoints are under `/api`. Grouped by controller:

| Area | Endpoints |
| --- | --- |
| **Auth** | `/api/auth/register`, `/login`, `/logout`, `/refresh`, `/me`, `/verify-email`, `/forgot-password`, `/reset-password`, `/me/resend-verification`, `/oauth/google`, `/oauth/facebook`, `/oauth/config` |
| **Users** | `/api/users/me`, `/api/users/me/hand-profile`, `/api/users/me/songs` |
| **Hand analysis** | `/api/analyze-hand` (Gemini), `/api/analyze-hand/claude` (Claude) |
| **AI helpers** | `/api/advise` (Advisor), `/api/compose`, `/api/explain` |
| **Songs** | `/api/catalog`, `/api/catalog/import` (upsert by title+artist), `/api/chordsheet` (fetch a real chords-over-lyrics sheet) |
| **Audio → tab** | `/api/tab/transcribe` (proxies tab-service) |
| **Billing** | `/api/subscriptions`, `/api/payments/checkout`, `/cancel`, `/webhook` |
| **Meta** | `/api/version`, `/actuator/health` |

The SPA fallback (`SpaForwardController`, `/**`) forwards non-API routes to the frontend.

---

## Data & domain modules

- **Chord library rule:** [`chords.js`](client/src/lib/chords.js) is the single source
  behind every diagram, hover shape, difficulty score, and sound. Entries follow the
  shape `{ name, type, tab, notes }`, use the 6-char `EADGBe` tab convention
  (`x` = muted, `0` = open), and list only fretted notes in `notes`. Enharmonics
  (Bb ↔ A#) resolve automatically, so only one spelling per shape is stored.
- **Song sources merge** custom (saved), composer-tab compositions, and the global
  catalog, deduplicated, into the Play-Along and Progression views.
- **`songTimeline.js`** is the shared resolver so the display, Song Editor, Play-Along
  game, and Progression "play the whole song" button all walk the *same* chord sequence
  (lyric lines verbatim, else the song's real per-line `lineChords` structure).

---

## Internationalization

The app ships **10 languages** via [`client/src/lib/i18n.js`](client/src/lib/i18n.js):
English (`en`), Spanish (`es`), Chinese (`zh`), Hindi (`hi`), Arabic (`ar`),
Portuguese (`pt`), French (`fr`), German (`de`), Japanese (`ja`), Korean (`ko`).
The active language is provided through `LangContext`.

---

## Deployment

- **Frontend → Vercel** ([`vercel.json`](vercel.json)): Vite build + SPA rewrite.
  `VITE_API_URL` points it at the backend.
- **Backend → Railway** via the multi-stage [`Dockerfile`](Dockerfile)
  (Maven build → JRE 21, `prod` profile). Health check at `/actuator/health`.
  See [`railway.json`](railway.json).
- **tab-service** hosting is deferred (run locally when needed).
- `nginx-*.yaml` are unused Kubernetes experiments.

---

## Contributing conventions

- **Verify before reporting done.** Confirm the servers actually listen (8080 backend,
  5173 frontend), the backend health endpoint returns `UP`, and the frontend serves HTML
  (request `/` with an `Accept: text/html` header — a bare request 404s by design under
  Vite's SPA fallback).
- **Keep every chord supported everywhere.** If you encounter a chord name with no
  voicing, add a playable shape to `chords.js` (one spelling; common beginner shape).
- **Every rendered chord name shows its shape on hover** (the `FretboardDiagram` /
  `ChordTip` tooltip pattern) — never leave a chord name as plain text.
- The reach engine and all guitar-physics logic stay in the **frontend**; the backend
  handles accounts and integrations only.

See [`CLAUDE.md`](CLAUDE.md) for the full working guidance.
