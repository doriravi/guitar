# FretFit on iPhone — the free way (web app / PWA)

**The honest truth about iPhone:** there is **no** "download a file and tap
install" path like Android's APK. Apple blocks it. Every *native* iOS app needs a
**Mac + Xcode** to build and a **$99/year Apple Developer account** to distribute
(via TestFlight or the App Store). No free, no-Mac native path exists.

**The cheapest way — and it's $0 — is the installable web app (PWA).** FretFit is
already built as one. iPhone users add it to their home screen from Safari and it
launches full-screen like an app. You share a **normal web link**, not a file.

---

## What the PWA gives you vs. a native app

| | Web app (PWA) — free | Native app (App Store/TestFlight) — $99/yr + Mac |
|---|---|---|
| Cost | **$0** | $99/year, needs a Mac |
| How they install | Safari → Share → Add to Home Screen | App Store / TestFlight |
| Home-screen icon, full-screen | ✅ Yes | ✅ Yes |
| Works offline | ✅ Yes (service worker caches it) | ✅ Yes |
| Microphone (tuner, practice) | ✅ Yes, in Safari | ✅ Yes |
| Camera (hand-measure) | ✅ Yes, in Safari | ✅ Yes |
| In App Store search | ❌ No — you share the link | ✅ Yes |
| Review / approval | ❌ None — publish instantly | ✅ Apple review |

For a guitar practice tool you share with people directly, the PWA covers
essentially everything. The main thing you give up is being *discoverable* in the
App Store — not features.

---

## Step 1 — Get your live web URL

FretFit's frontend is already set up to deploy (Railway and Vercel configs are in
the repo). Your install link is **the deployed frontend URL** — find it in your
**Railway** or **Vercel** dashboard (the frontend service's public domain, e.g.
`https://fretfit.up.railway.app` or `https://fretfit.vercel.app`).

If it's not deployed yet, the cheapest one-command deploy is Vercel:
```
cd client
npx vercel --prod
```
(Free tier, gives you a public `*.vercel.app` URL. The repo's `vercel.json` already
configures the Vite build + SPA rewrite.)

That URL is your iPhone install link **and** works on Android/desktop too.

---

## Step 2 — What you send iPhone users

> 🎸 **Try FretFit on your iPhone** (free, no App Store needed)
>
> 1. Open this link **in Safari** (important — it must be Safari, not Chrome):
>    **[YOUR WEB URL]**
> 2. Tap the **Share** button (the square with an ↑ arrow, at the bottom).
> 3. Scroll down and tap **"Add to Home Screen."**
> 4. Tap **Add** — a FretFit icon appears on your home screen.
> 5. Open it from that icon and play! Works offline, no account needed. 🎶

The "must be Safari" bit matters: on iPhone, only Safari can add a web app to the
home screen. If they open the link in Chrome or from inside another app, the "Add
to Home Screen" option won't be there — tell them to open it in Safari.

---

## Why not just pay for the native app?

If you later want FretFit *in the App Store* (searchable, more "official"), you'll
need a Mac + the $99/yr Apple Developer Program, then build/archive the `ios/`
project (already in the repo) in Xcode and submit via TestFlight → App Store. The
steps are in `MOBILE.md`. Nothing about the PWA route blocks that later — you can
do both. But for getting FretFit onto friends' iPhones today, for free, the PWA is
the answer.
