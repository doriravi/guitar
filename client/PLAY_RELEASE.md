# FretFit — Getting to Google Play production (personal account)

You have a **personal** Play developer account, so Google requires a **closed
test with ≥12 testers opted-in for 14 continuous days** before production access
unlocks. This file is the practical path through that gate.

- **App:** FretFit — `com.music.fretfit`
- **Upload file:** `client/android/app/build/outputs/bundle/release/app-release.aab`
  (signed, `versionCode 3 / versionName 1.0.2`)
- **Guest-mode-first:** testers need **no account**; the app works fully offline.
  Camera (hand-measure) and mic (tuner/listen) are the only permissions.

---

## The order to do things (fastest, loses no time)

1. **Internal testing — TODAY.** No 12-tester rule, no wait. Gets the app on
   real phones in minutes. Do this first so you're testing while the closed-test
   clock runs.
2. **Closed testing — start this week.** This is the track that counts toward
   production access. Recruit your 12; the 14-day clock starts once 12 have
   *joined* (opted in), not when you create the track.
3. **Apply for production — day 14+.** The button unlocks after 12 testers stay
   opted-in for 14 continuous days. Then production goes to Google review.

---

## Checklist A — Internal testing (do this now, ~15 min)

In [Play Console](https://play.google.com/console) → your app **FretFit**:

- [ ] Left sidebar → **Testing → Internal testing**
- [ ] **Create new release**
- [ ] **App bundles → Upload** → pick `app-release.aab` (the file above)
- [ ] Release name auto-fills (`3 (1.0.2)`); add a one-line "what's new"
- [ ] **Next → Save → Review release → Start rollout to Internal testing**
- [ ] Tab **Testers** → create an email list → add your own Gmail (and anyone else)
- [ ] Copy the **"Copy link"** opt-in URL → open it on your phone → **Become a
      tester → Download on Google Play**. The app installs from Play itself.

> If upload is blocked asking you to "complete the app setup," do the **Dashboard
> → Set up your app** tasks first (they overlap with Checklist C below).

---

## Checklist B — Closed testing (the 12-tester gate)

- [ ] Left sidebar → **Testing → Closed testing**
- [ ] Google usually pre-creates a track called **"Closed testing"** for the
      production-access requirement — use that one (not a custom track), or it may
      not count toward the 14-day rule. If unsure, check **Dashboard → "Apply for
      production access"** — it names the exact track that counts.
- [ ] **Create new release** → upload the **same** `app-release.aab`
      (or promote your internal release to this track)
- [ ] **Testers** tab → create an email list → paste your 12+ testers' Gmail
      addresses → **Save**
- [ ] **Copy link** → this is the opt-in URL you send testers (see message below)
- [ ] Start rollout to Closed testing
- [ ] Track progress: **Dashboard → "Get X of 12 testers"** shows the live count
      and the 14-day countdown. It only ticks once testers have actually joined.

**What "counts" (the rules that trip people up):**
- Each tester needs a **distinct Google account** and must **click the opt-in
  link and install** the app.
- They must **stay opted-in** for the whole 14 days — tell them not to leave the
  tester program or uninstall.
- The **14 days are continuous** from when you have 12 opted-in. If you drop below
  12, the clock can reset — so recruit a couple extra (aim for 14–15) as buffer.
- They do **not** have to open the app daily. Installed + opted-in is enough.

---

## Checklist C — Store listing you must complete before production

Play won't publish to production until these are green (Dashboard → Set up your app):

- [ ] **App access** — declare guest mode needs no login: choose "All
      functionality available without special access." (True for FretFit.)
- [ ] **Ads** — "No, my app does not contain ads."
- [ ] **Content rating** — fill the questionnaire (a guitar tool rates Everyone).
- [ ] **Target audience** — 13+ (not designed for children) is the simple answer.
- [ ] **Data safety** — see the pre-filled answers in `PLAY_DATA_SAFETY.md`.
- [ ] **Privacy policy URL** — **required** because you request camera + mic.
      Host the draft in `PRIVACY_POLICY.md` somewhere public (GitHub Pages, a
      Notion public page, your site) and paste the URL here.
- [ ] **Store listing** — short + full description (`PLAY_LISTING.md`), app icon
      512×512, feature graphic 1024×500, and **≥2 phone screenshots** (just
      screenshot the running app on your device).

---

## The keystore — back it up NOW (non-negotiable)

`client/android/fretfit-release.jks` + the passwords in
`client/android/keystore.properties` are the **only** thing that can ever sign an
update to FretFit. They are git-ignored (not in your repo), so a fresh clone does
**not** have them. **Lose them = you can never update the app on Play again**
(you'd have to publish a brand-new listing). Copy both files to a safe, private
place off this machine (password manager / encrypted drive) before you publish.
