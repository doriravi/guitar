# FretFit — Native app builds (Android & iOS)

The web app is wrapped with [Capacitor](https://capacitorjs.com/) to produce
installable native app files:

- **Android** → `.apk` (sideload / direct install) and `.aab` (Play Store upload)
- **iOS** → `.ipa` (App Store / TestFlight) — **requires a Mac with Xcode**

The native shell just loads the built web bundle (`dist/`) inside a WebView.
All the app logic is the same React code that runs on the web. **Guest mode
works fully offline** — no backend needed to use the app. Account, subscription,
and hand-photo-analysis features call the backend and only work when a backend
URL is configured (see "Backend URL" below).

---

## One-time toolchain setup

Capacitor and the native projects (`android/`, `ios/`) are already in the repo.
To *build* installer files you need the platform toolchains:

### Android (works on Windows / macOS / Linux)
1. Install **Android Studio** (bundles the Android SDK **and a compatible JDK 21**).
   - ⚠️ This machine currently has **JDK 26**, which the Android Gradle Plugin
     does **not** support. Use the JDK bundled with Android Studio (JBR 21), or
     install JDK 21 and point `JAVA_HOME` at it. Gradle will fail on JDK 26.
2. First launch of Android Studio installs the SDK + a `local.properties`
   pointing at it. Or set `ANDROID_HOME` to the SDK path.

### iOS (macOS only)
1. Install **Xcode** from the Mac App Store.
2. Install CocoaPods: `sudo gem install cocoapods` (or `brew install cocoapods`).
3. An **Apple Developer account** ($99/yr) is required to sign an `.ipa` for
   distribution (TestFlight / App Store).

---

## Rebuild the web assets → native (run after any web code change)

From `client/`:

```bash
npm run cap:sync          # vite build + copy dist/ into both native projects
# or per-platform, which also opens the IDE:
npm run cap:android       # build + sync + open Android Studio
npm run cap:ios           # build + sync + open Xcode (macOS)
```

`cap sync` copies the freshly built `dist/` into the native projects and updates
native plugins. **Always run a build/sync after changing web code** — the native
app ships a *copy* of `dist/`, so untouched native projects show stale UI.

---

## Produce the Android installer files

After `npm run cap:sync` (so `dist/` is current):

```bash
cd android

# Debug APK (unsigned, for testing on your own device):
./gradlew assembleDebug
#   → android/app/build/outputs/apk/debug/app-debug.apk

# Release AAB (for Play Store upload — must be signed, see below):
./gradlew bundleRelease
#   → android/app/build/outputs/bundle/release/app-release.aab

# Release APK (signed, for direct sideloading):
./gradlew assembleRelease
#   → android/app/build/outputs/apk/release/app-release.apk
```

On Windows use `gradlew.bat` instead of `./gradlew`.

### Signing a release (required for Play Store & for a stable install identity)
1. Create a keystore once:
   ```bash
   keytool -genkey -v -keystore fretfit-release.jks -keyalg RSA -keysize 2048 \
     -validity 10000 -alias fretfit
   ```
   Keep this file **safe and private** — losing it means you can't update the
   app on the Play Store.
2. Add to `android/keystore.properties` (git-ignored — do not commit):
   ```
   storeFile=../fretfit-release.jks
   storePassword=…
   keyAlias=fretfit
   keyPassword=…
   ```
3. Wire it into `android/app/build.gradle` `signingConfigs`/`buildTypes` (standard
   Capacitor signing setup — see Capacitor docs "Signing an Android App").

---

## Produce the iOS installer file (macOS + Xcode)

After `npm run cap:sync` on a Mac:

```bash
npx cap open ios
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → pick your Team
   (Apple Developer account). The bundle ID is `com.music.fretfit`.
2. **Product → Archive** → **Distribute App** → choose App Store Connect /
   TestFlight or Ad-Hoc → export the **`.ipa`**.

You cannot build an `.ipa` on Windows/Linux — Apple's toolchain is macOS-only.
The `ios/` project in this repo is ready to open and archive on a Mac.

---

## App identity (baked into the native projects)

| | Value |
|---|---|
| App name | **FretFit** |
| App ID / bundle ID | **`com.music.fretfit`** (Android `applicationId` + iOS bundle ID — the permanent store identity) |
| Web bundle | `dist/` (Vite build) |
| Icons / splash | generated from `assets/icon.png` via `npm run cap:assets` |

The app ID is **permanent** once published to a store — don't change it after release.

### Camera & microphone permissions
Already declared so the hand-measure (camera) and tuner/listen (mic) features
work in the installed app:
- Android: `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` in
  `android/app/src/main/AndroidManifest.xml`.
- iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` in
  `ios/App/App/Info.plist`.

---

## Backend URL (accounts / subscriptions / hand analysis)

Guest mode needs no backend. For the account-based features, the native app must
call the **deployed** backend (there is no `localhost` on a phone). Set
`VITE_API_URL` to the deployed backend URL at build time, then re-sync:

```bash
VITE_API_URL="https://YOUR-BACKEND.up.railway.app" npm run cap:sync
```

> **Known limitation — login in the native app.** The web app authenticates with
> cookies (`credentials: 'include'`). Inside a native WebView the app origin
> (`https://localhost` on Android, `capacitor://localhost` on iOS) differs from
> the backend origin, so the auth cookies are *third-party* and are commonly
> blocked on mobile. **Guest mode is unaffected.** To make accounts work in the
> native build, either switch to token (Authorization header) auth or set the
> backend auth cookies to `SameSite=None; Secure` and handle them with a native
> cookie plugin. This first build ships **guest-mode-first**; that auth change is
> a follow-up.

---

## Regenerating icons / splash

Source: `assets/icon.png` (1024×1024) and `assets/splash.png` (2732×2732),
rendered from `scripts/icon.svg`. To regenerate all native densities:

```bash
npm run cap:assets
```
