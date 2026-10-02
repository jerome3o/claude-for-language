# Chat notifications in the Lab app (FCM)

What you get: a message from your tutor (or a student) pings the phone **as soon as it is
sent**, as a normal Android chat notification — the sender's photo and name, the message with a
pinyin line under the hanzi, **Reply** right from the notification, **Mark as read**, and a tap
opens that chat. One notification per conversation; later messages are added to it. Reading the
chat anywhere (the app, the web, another phone) clears it. The contract is
[docs/CHAT.md](../docs/CHAT.md) §5.

## What works before and after setup

| | Without Firebase (today) | With Firebase (after the steps below) |
|---|---|---|
| App open (foreground) | **Instant** — the live socket (ChatHub) | Instant |
| App in the background / closed / phone asleep | Checked every **~15 minutes** (`ChatCheckWorker`, needs a network; Android may stretch it in Doze) | **Instant** — Firebase Cloud Messaging (high priority) |
| Reply / Mark as read from the notification | ✅ (queued offline, sent when there's signal) | ✅ |
| Cleared when read elsewhere | at the next 15-minute check | at once (`chat_read` push) |

Nothing breaks without Firebase: the build simply has no FCM config and the app uses the other
two paths.

## One-time setup (≈ 10 minutes, all in a browser)

### 1. Create the Firebase project

1. Open <https://console.firebase.google.com/> → **Create a project** (e.g. `chinese-learning`).
   Google Analytics is not needed — switch it off.
   (If you already have a Firebase / Google Cloud project for the app, you can add Firebase to it
   instead.)
2. In the project: **Project overview → Add app → Android** (the robot icon).
   - **Android package name**: `dev.jeromeswannack.chineselearning.lab` (exactly this).
   - App nickname: `Lab` (anything).
   - **Debug signing certificate SHA-1**: leave empty — FCM doesn't need it. (Optional; only
     Google Sign-In / Dynamic Links would. Play-installed and Obtainium-installed builds both
     receive messages, whatever key signed them.)
   - **Register app**.
3. **Download `google-services.json`**. Skip the remaining wizard steps (the "add the Gradle
   plugin" step is already handled differently in this repo — don't change any build files).

### 2. Give the file to the Lab build (GitHub secret `GOOGLE_SERVICES_JSON`)

The file is base64-encoded into a secret; CI decodes it into `android-lab/app/google-services.json`
before building (the file itself is git-ignored — never commit it).

- On a computer: `base64 -w0 google-services.json` (macOS: `base64 -i google-services.json`) and
  copy the output.
- On a phone: any "base64 encode file" web tool works, or paste the JSON into
  <https://www.base64encode.org/>.

GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `GOOGLE_SERVICES_JSON`
- Value: the base64 text.

### 3. Let the server send pushes (GitHub secret `FCM_SERVICE_ACCOUNT_JSON`)

1. Firebase console → ⚙️ **Project settings → Service accounts** → **Generate new private key** →
   **Generate key**. A `.json` file downloads. It is a secret: don't share or commit it.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `FCM_SERVICE_ACCOUNT_JSON`
   - Value: **the whole JSON file's content as is** (not base64).

The worker's deploy step (`.github/workflows/deploy.yml`) pushes it to Cloudflare as a Worker
secret; `GET /api/push/config` then reports `fcm: true`.

### 4. Ship it

1. Merge anything to `main` that touches `android-lab/**` (or re-run the latest **Android Lab
   Build** workflow on `main`) so a Lab build is made **with** the Firebase config — the workflow
   log says "FCM configured" in the "Firebase config" step. Also make sure the worker has been
   deployed since the secret was added (re-run **Deploy** on `main`, or merge anything).
2. Install the new **Lab v0.N** (Obtainium / Play internal testing).
3. **Open the app once while signed in and online.** It registers this phone with the server
   (`POST /api/push/devices`) — it does that again after every sign-in, whenever Firebase gives
   it a new token, and once a day.
4. Test: lock the phone, have the tutor (or the web app on another account) send a message. The
   notification should arrive within seconds. Reply from the notification and check it shows up
   in the chat.

## Troubleshooting

- **No notifications at all** — Android Settings → Apps → 学 Lab → **Notifications**: allowed,
  and the **Messages** category on. (The app asks for the permission once after sign-in; if you
  said no, turn it on here.)
- **Messages arrive but silently / only in the shade** — the **Messages** category was muted or
  set to "Silent". Set it back to "Default" / "Alerting".
- **Only arrives when I open the app, or every ~15 minutes** — FCM isn't active yet:
  - the build predates the secret (the Android Lab Build log says "GOOGLE_SERVICES_JSON not set")
    → rebuild and reinstall;
  - the worker has no `FCM_SERVICE_ACCOUNT_JSON` (`/api/push/config` says `fcm: false`) → add
    the secret and redeploy;
  - the phone hasn't registered: open the app once online while signed in.
- **Late in the background** — Android Settings → Apps → 学 Lab → **Battery** → **Unrestricted**
  (FCM high-priority messages normally get through Doze anyway; the 15-minute fallback doesn't).
- **Notifications from the wrong account after switching accounts** — signing out unregisters
  this phone (`DELETE /api/push/devices`); sign in again to register it for the new account.
- **I see the same message on the web and the phone** — expected: each device notifies; reading
  it on one clears it on the others (read marker → `chat_read`).

## How it's built (for agents)

- `app/build.gradle.kts` parses `app/google-services.json` when it exists (the client for
  `dev.jeromeswannack.chineselearning.lab`) into `BuildConfig.FCM_PROJECT_ID / FCM_APP_ID /
  FCM_API_KEY / FCM_SENDER_ID`; no google-services Gradle plugin (it fails without the file).
  Empty values = no FCM.
- `data/chat/PushRegistration.kt` initialises Firebase by hand from those fields (the manifest
  removes `FirebaseInitProvider`), fetches the token and queues the registration in the outbox.
- `data/chat/LabMessagingService.kt` handles the data messages (`chat_message`, `chat_read`);
  `ChatNotifier` draws the notification; `ChatActionReceiver` handles Reply / Mark as read;
  `ChatLive` is the foreground socket; `ChatCheckWorker` the 15-minute fallback.
