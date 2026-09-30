# Google Play — internal testing for the Lab app

Every Lab build on `main` goes to two places:

| Channel | What | Signed by |
|---|---|---|
| GitHub pre-release `Lab v0.N` (Obtainium) | `chinese-learning-lab.apk` | our key (`ANDROID_KEYSTORE_BASE64`) |
| Google Play → **Internal testing** | `chinese-learning-lab-v0.N.aab` (also attached to the pre-release) | Google's app signing key (Play App Signing); our key is only the **upload key** |

Play Console app: **Chinese Learning Lab**, package `dev.jeromeswannack.chineselearning.lab`.
The workflow is `.github/workflows/android-lab-build.yml`; the Play steps only run when the
`PLAY_SERVICE_ACCOUNT_JSON` secret exists, and never fail the build (see "What CI does").

## ⚠️ Play install vs Obtainium install — pick one per phone

Play re-signs the app with **Google's** key, so a Play-installed Lab and the Obtainium/sideloaded
Lab have different signatures. Android refuses to update one with the other ("App not
installed" / "conflicts with an existing package"). To switch a phone to Play:

1. Open the current Lab app while online and let it **sync** (the ⟳ Sync now button) so no
   review or recording is left only on the phone. Everything else lives on the server.
2. Uninstall the Obtainium/sideloaded Lab (and remove its Obtainium entry, or it will offer to
   reinstall it).
3. Install from the Play opt-in link (below) and sign in again.

The main hybrid app (`dev.jeromeswannack.chineselearning`) is untouched either way.

## One-time setup

Everything here is click-through in a browser; it works from a phone (Chrome → "Desktop site"
helps on the Cloud console).

### 1. A service account that can upload (Google Cloud)

1. <https://console.cloud.google.com/> → create a project (e.g. `chinese-learning-play`) or pick
   an existing one.
2. **APIs & Services → Library** → search **Google Play Android Developer API** → **Enable**.
3. **IAM & Admin → Service accounts → Create service account**, name `github-play-upload`.
   No project roles are needed → **Done**.
4. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. It is a
   password: never commit it or paste it anywhere but the GitHub secret below.

### 2. Let it release to testing (Play Console)

1. <https://play.google.com/console> → **Users and permissions → Invite new users**.
2. Email address = the service account's email (`github-play-upload@<project>.iam.gserviceaccount.com`).
3. **App permissions → Add app → Chinese Learning Lab**, tick **Release to testing tracks**
   (and **View app information** if it isn't already on). Account permissions: none.
4. **Invite user**. (It can take a few minutes — occasionally up to a day — before the API
   accepts the new account.)

### 3. The GitHub secret

GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `PLAY_SERVICE_ACCOUNT_JSON`
- Value: the **whole contents** of the JSON key file (open it, select all, paste).

The existing `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` secrets stay as they are;
that key becomes the Play upload key in step 5.

### 4. Testers

Play Console → **Chinese Learning Lab → Test and release → Testing → Internal testing →
Testers** → **Create email list** (e.g. "Lab testers"), add the Google accounts that should get
the app (yours first), **Save**, tick the list.

### 5. The first bundle — by hand (Google requires it)

The API cannot create the very first release of a new app, so upload one bundle yourself:

1. After this lands on `main`, the next Lab build publishes a GitHub pre-release **Lab v0.N**
   with `chinese-learning-lab-v0.N.aab` attached. On the phone: GitHub → Releases → that
   release → download the `.aab`.
2. Play Console → **Internal testing → Create new release**. When asked about app signing,
   choose **Use Google-generated key** (Play App Signing) — the default. Our key becomes the
   upload key automatically because it signed this first bundle.
3. **Upload** the `.aab`, release name `Lab v0.N`, notes anything → **Next → Save and publish**
   (or "Start rollout to Internal testing").
4. If the console asks for app content first (privacy policy, app access, ads, content rating,
   target audience, data safety, **foreground service permissions**), fill those in — the privacy
   policy URL is <https://chinese-learning-2x9.pages.dev/privacy>. The foreground-service
   declaration is for video calls (microphone, camera, screen share while the screen is off).

### 6. The opt-in link

Internal testing → **Testers** tab → **Copy link** ("Join on the web"). Open it on the phone
while signed in to a tester account → **Accept invite** → **Download it on Google Play**. Each
new build then arrives as a normal Play update (usually within minutes).

## What CI does (every Lab build on `main`)

1. `./gradlew :app:assembleRelease` and `:app:bundleRelease`, both signed with the upload key.
2. Publishes the GitHub pre-release with the `.apk` **and** `chinese-learning-lab-v0.N.aab`.
3. If `PLAY_SERVICE_ACCOUNT_JSON` is set: uploads the `.aab` to the **internal** track with
   status `completed` and the commit subject (≤500 chars) as the English (`en-US`) release notes,
   using `r0adkll/upload-google-play` pinned to a commit SHA.
   - If that fails, it retries once as a **draft** (an app that has never had a release rolled
     out only accepts drafts through the API). A draft needs one tap in the console: Internal
     testing → the draft → **Review release → Start rollout**.
   - All Play steps are `continue-on-error`: the build and the Obtainium release never fail
     because of Play. A failure shows as a **warning annotation** on the run ("Play upload
     skipped/failed — upload the first bundle manually"); a missing secret as a notice.

## versionCode

`versionCode` = the workflow's **run number** (`APP_VERSION_CODE: ${{ github.run_number }}`, read
by `app/build.gradle.kts`), `versionName` = `0.<run number>`. The APK and the AAB of one run are
built from the same environment, so they share it; the run number only ever grows (branch / PR
runs use numbers too, which just leaves gaps), so both channels always go up. A re-run of the
same workflow run keeps its number — Play then rejects the duplicate versionCode, which only
produces the warning; push again (or run the workflow manually) for a new number.

## Troubleshooting

- **"Package not found: dev.jeromeswannack.chineselearning.lab"** — no bundle uploaded yet
  (step 5), or the service account was invited without this app.
- **"The caller does not have permission"** — step 2 missing, or not yet propagated.
- **"Only releases with status draft may be created on draft app"** — the draft fallback handles
  it; roll the draft out once in the console.
- **"Version code N has already been used"** — a re-run; see versionCode.
- **Target API level** — Play requires new apps and updates to target the current API level
  (API 36 since 31 Aug 2026); `targetSdk` in `app/build.gradle.kts` must follow it.
- **Release notes language** — notes are sent as `en-US`. If the app's default language in Play
  Console is another English (e.g. `en-GB`), change the file name in the workflow's
  "Release notes for Play" step to `whatsnew-<that code>`.
