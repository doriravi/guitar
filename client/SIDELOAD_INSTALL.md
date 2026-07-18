# FretFit — Install by link (sideload, no Play Store)

This is the **no-developer-account** path: share a signed APK file, people
download and install it directly. No $25 account, no 12 testers, no 14-day wait,
no Google review. **Android only** (iPhones can't sideload).

- **File to share:** `FretFit-1.0.2.apk` (repo root) — signed, `versionCode 3 /
  1.0.2`, 7.5 MB.
- Rebuild it anytime with: `cd client && npm run cap:sync` then
  `cd android && ./gradlew assembleRelease` (JDK 21) →
  `android/app/build/outputs/apk/release/app-release.apk`.

---

## Step 1 — Put the APK somewhere with a download link

Upload `FretFit-1.0.2.apk` to any file host that gives a direct download link:

| Host | How | Notes |
|---|---|---|
| **Google Drive** | Upload → Share → "Anyone with the link" → Copy link | Easiest. Drive may show a "can't scan for viruses" warning on big files — normal, users tap Download anyway. |
| **Dropbox** | Upload → Copy link → **change `?dl=0` to `?dl=1`** at the end | The `dl=1` forces a direct download instead of a preview page. |
| **GitHub Releases** | Repo → Releases → Draft new release → attach the APK | Clean direct link; good if the repo is public. |
| **Your own website** | Drop the file in a public folder | Full control over the URL. |

That shared URL **is** your install link. Send it to anyone.

---

## Step 2 — What you tell people (paste this)

> **Install FretFit (Android):**
> 1. Open this link on your Android phone and download the file: **[APK LINK]**
> 2. Tap the downloaded **FretFit-1.0.2.apk** (in your notifications or Downloads).
> 3. Android will warn about "unknown sources" — tap **Settings → allow this
>    source → back**, then **Install**. (You only allow it once.)
> 4. Open FretFit and play. No account needed — it works offline. 🎸

That "unknown sources" prompt is normal for any app installed outside the Play
Store. On modern Android it appears the first time and asks to allow *your
browser / Files app* to install; after you allow it once, install proceeds.

---

## Step 3 — Shipping an update later

Sideloaded apps **do not auto-update.** When you change the app:

1. Bump the version in `client/android/app/build.gradle` (e.g. `versionCode 4`,
   `versionName "1.0.3"`) — needed so the new APK installs over the old one.
2. Rebuild: `cd client && npm run cap:sync && cd android && ./gradlew assembleRelease`
   (with `JAVA_HOME` = the Android Studio JBR / JDK 21).
3. Re-upload the new APK, send the new link. People install it over the top —
   their data is kept as long as it's signed with the **same keystore** (it is).

> Same-keystore is why the backup matters: `client/android/fretfit-release.jks`
> is the only key that can produce an *update* users can install over their
> existing app. Lose it and users must uninstall + reinstall fresh. Back it up.

---

## Honest limits of the link approach
- **Android only.** iPhone install needs Apple's TestFlight / developer program.
- **No auto-update, no discovery.** Great for you + friends + testers; not a way
  to reach the public. For public reach you still need the Play Store eventually.
- **The "unknown sources" warning** puts off non-technical users — expect a few
  "is this safe?" questions. It's safe; it's just not from the store.
- **Some phones / MDM / work profiles block sideloading** entirely by policy.

If you later want the Play Store route after all, everything for it is in
`PLAY_RELEASE.md` — this sideload path doesn't burn any of that; you can do both.
