# Play Data Safety form — answers for FretFit (guest-mode-first)

Play Console → **Policy → App content → Data safety**. Answer truthfully; these
match a guest-mode-first build where camera/mic are processed on-device and guest
mode sends nothing to a server.

> IMPORTANT — read this first: these answers describe the **guest-mode-first**
> build you are shipping. If you later enable the backend (accounts, subscriptions,
> hand-photo analysis that sends an image to the server), you MUST update this form
> — at minimum "Personal info: email" (collected, for account management) and, for
> the Gemini hand-photo feature, "Photos" (shared with a third party). Ship the
> guest build with the answers below; revisit when accounts go live.

---

## Section 1 — Data collection & sharing
- **Does your app collect or share any of the required user data types?**
  → For the guest-mode-first build: **No** — the app does not collect or transmit
    personal data. Camera and microphone are used only on the device for the
    tuner/practice features and are not sent off the device.

  (If Play's flow still asks per-type, use: **not collected, not shared** for all
  categories in guest mode.)

## Section 2 — Security practices
- **Is data encrypted in transit?** → Not applicable in guest mode (no data leaves
  the device). If asked, answer "Yes" only for any network calls you actually make.
- **Can users request data deletion?** → Guest mode stores nothing server-side;
  local data is removed by uninstalling. Provide your support email.

## Section 3 — Permissions the store will show (declare honestly in the listing)
These are requested but do **not** by themselves mean data is "collected/shared":
- **CAMERA** — hand-measurement feature; frames processed on-device.
- **RECORD_AUDIO** — tuner + live-listen + scale practice; audio processed
  on-device.
- **MODIFY_AUDIO_SETTINGS** — audio routing for the above.
- **INTERNET** — required by the WebView shell; guest features work offline.

---

## App access (separate question, Dashboard → App access)
- Choose: **"All functionality is available without special access"**
  — true for the guest-mode-first build (no login required to use the app).
  If/when accounts are enabled, switch to "Some functionality restricted" and
  provide demo credentials for the reviewer.
