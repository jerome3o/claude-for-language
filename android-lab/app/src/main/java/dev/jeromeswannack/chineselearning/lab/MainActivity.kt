package dev.jeromeswannack.chineselearning.lab

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import dev.jeromeswannack.chineselearning.lab.data.AuthExchange
import dev.jeromeswannack.chineselearning.lab.data.feedback.FeedbackCenter
import dev.jeromeswannack.chineselearning.lab.data.feedback.FeedbackPrefs
import dev.jeromeswannack.chineselearning.lab.data.feedback.ShakeWatcher
import dev.jeromeswannack.chineselearning.lab.ui.feedback.FeedbackHost
import dev.jeromeswannack.chineselearning.lab.shell.ShellLinks
import dev.jeromeswannack.chineselearning.lab.shell.ShellPermission
import dev.jeromeswannack.chineselearning.lab.ui.home.SignInScreen
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabShell
import dev.jeromeswannack.chineselearning.lab.ui.nav.LastRoute
import dev.jeromeswannack.chineselearning.lab.ui.nav.LastRouteStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRequest
import dev.jeromeswannack.chineselearning.lab.ui.nav.deepLinkPath
import dev.jeromeswannack.chineselearning.lab.ui.nav.openInMainApp
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.launch
import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import java.security.SecureRandom

/**
 * Sign-in gate + the shell (ui/nav/LabShell.kt). Handles two kinds of links:
 * `chineselearning-lab://auth?code=…&nonce=…` (the worker's sign-in callback) and
 * `chineselearning-lab:///<web route>` (opens that screen natively, or its placeholder).
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as LabApp

    private var signedIn by mutableStateOf(false)
    private var authError by mutableStateOf<String?>(null)
    /** A DIFFERENT account signed in while this phone holds the previous one's unsent work: asked before anything goes. */
    private var accountSwitch by mutableStateOf<PendingAccountSwitch?>(null)
    private var pending by mutableStateOf<NavRequest?>(null)
    /** The stack saved before the process died, rebuilt once on a cold start (ui/nav/NavResume.kt). */
    private var restoreFrom by mutableStateOf<LastRoute?>(null)
    /** The shell's navigation, for tests. */
    internal var nav: LabNav? = null
        private set
    private lateinit var notificationPermission: ShellPermission
    /** Shake to send feedback (docs/FEEDBACK.md): listening only while this activity is in front. */
    private var shakeWatcher: ShakeWatcher? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // The last run crashed or froze: show its trace first (plain Views, nothing of the app's own
        // UI), with Copy / Send to Claude / Continue (LastCrashActivity). Never on a sign-in callback.
        if (savedInstanceState == null && intent?.data?.host != "auth" && !intent.getBooleanExtra(LastCrashActivity.EXTRA_SKIP, false) &&
            dev.jeromeswannack.chineselearning.lab.data.CrashLog.hasUnseenCrash(this)
        ) {
            startActivity(Intent(this, LastCrashActivity::class.java))
            finish()
            return
        }
        signedIn = app.repo.isSignedIn
        notificationPermission = ShellPermission(this).also { if (signedIn) it.maybeAsk() }
        if (savedInstanceState == null) {
            // No saved state: a cold start (or the process died with it — an app update, a reboot,
            // a relaunch from Recents). Rebuild where the app was if it is still fresh, and don't
            // replay the intent that once started this task: from Recents that is the widget's /
            // a notification's old Study link, which used to open Study over whatever was going on.
            restoreFrom = LastRouteStore(this).load()
            if (!launchedFromHistory(intent)) handleIntent(intent)
        }
        setContent {
            LabTheme {
                if (!signedIn) {
                    SignInScreen(authError, ::startSignIn)
                } else {
                    LabShell(
                        app = app,
                        handoff = { openInMainApp(it) },
                        onSignedOut = { signedIn = false; LastRouteStore(this@MainActivity).clear() },
                        onSignIn = ::startSignIn,
                        pending = pending,
                        onPendingConsumed = { pending = null },
                        restoreFrom = restoreFrom,
                        onRestored = { restoreFrom = null },
                        onNav = { nav = it },
                    )
                    // The Send feedback sheet, over whatever is on screen (shake, More, Settings).
                    FeedbackHost(app)
                }
                accountSwitch?.let { pending ->
                    dev.jeromeswannack.chineselearning.lab.ui.kit.AccountSwitchDialog(
                        unsynced = pending.unsynced,
                        previousEmail = pending.previousEmail,
                        nextEmail = pending.me.email,
                        onSignBackIn = { resolveAccountSwitch(pending, discard = false) },
                        onDiscard = { resolveAccountSwitch(pending, discard = true) },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (signedIn && app.online.value) lifecycleScope.launch { app.safely("sync on resume") { app.repo.sync() } }
        FeedbackCenter.attach(this)
        if (signedIn && FeedbackPrefs(this).shakeOn) {
            val w = shakeWatcher ?: ShakeWatcher(app) {
                app.haptics.tick()
                FeedbackCenter.open(app, "shake")
            }.also { shakeWatcher = it }
            runCatching { w.start() }
        }
    }

    override fun onPause() {
        shakeWatcher?.stop()
        super.onPause()
    }

    override fun onDestroy() {
        FeedbackCenter.detach(this)
        super.onDestroy()
    }

    private fun launchedFromHistory(intent: Intent?) = intent != null && intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0

    private fun handleIntent(intent: Intent?) {
        // "Go study" entries (the widget, reminder notifications) leave a homework pass, a reader,
        // a lesson… on screen; explicit links (a chat, a call) always open (ui/nav/NavResume.kt).
        val soft = intent?.getBooleanExtra(ShellLinks.EXTRA_SOFT, false) == true
        // Usage analytics: opened from one of our notifications (its kind only).
        intent?.getStringExtra(ShellLinks.EXTRA_NOTIFICATION)?.let { kind ->
            app.analytics.track("notification.tapped", mapOf("kind" to kind))
            intent.removeExtra(ShellLinks.EXTRA_NOTIFICATION) // once, not again on a configuration change
        }
        // The hybrid app's `route` extra ("/coach?text=…") works here too.
        ShellLinks.routeExtra(intent)?.let { pending = NavRequest(it, soft); return }
        val data = intent?.data ?: return
        if (data.scheme != Config.AUTH_REDIRECT_SCHEME) return
        if (data.host == "auth") handleAuth(data) else deepLinkPath(data)?.let { pending = NavRequest(it, soft) }
    }

    /**
     * `chineselearning-lab://auth?code=…&nonce=…` from the worker's auth callback: the one-time
     * code is traded with this app's verifier for the session (data/AuthExchange.kt). The old
     * `session_token=` form only comes back for a sign-in started without a challenge.
     */
    private fun handleAuth(data: Uri) {
        val expected = app.prefs.pendingAuthNonce
        val code = data.getQueryParameter("code")
        val token = data.getQueryParameter("session_token")
        val error = data.getQueryParameter("error") ?: data.getQueryParameter("signup")
        when {
            expected == null || data.getQueryParameter("nonce") != expected -> authError = "That sign-in link wasn't started from this app. Try again."
            !code.isNullOrBlank() -> {
                val verifier = app.prefs.pendingAuthVerifier
                app.prefs.pendingAuthNonce = null
                app.prefs.pendingAuthVerifier = null
                lifecycleScope.launch {
                    when (val out = AuthExchange.exchange(app.repo.api, code, verifier)) {
                        is AuthExchange.Outcome.Token -> completeSignIn(out.token)
                        is AuthExchange.Outcome.Failed -> authError = out.message
                    }
                }
            }
            token.isNullOrBlank() -> authError = "Sign-in failed (${error ?: "no session"})."
            else -> completeSignIn(token)
        }
    }

    /**
     * Signing in again never wipes anything (CLAUDE.md "Sign-in & sessions"): the new session's
     * account is compared with whose data this phone holds (core auth/SessionRules.accountSwitch).
     * The same account (or the first one) just resumes — Room, the audio cache and the Outbox stay,
     * and the sync uploads what waited. A different account clears the previous one's data first,
     * and asks before that when something hadn't uploaded.
     */
    private fun completeSignIn(token: String) {
        lifecycleScope.launch {
            val me = try {
                app.repo.api.me(token)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                authError = "Couldn't finish signing in — check your connection and try again."
                return@launch
            }
            val (decision, unsynced) = app.repo.accountSwitchFor(me)
            when (decision) {
                SessionRules.Switch.SWITCH_BLOCKED -> accountSwitch = PendingAccountSwitch(token, me, unsynced, app.prefs.accountOwnerEmail ?: app.prefs.userEmail)
                SessionRules.Switch.SWITCH -> { app.repo.clearForNewAccount(); finishSignIn(token, me) }
                SessionRules.Switch.SAME, SessionRules.Switch.FIRST -> finishSignIn(token, me)
            }
        }
    }

    private fun resolveAccountSwitch(pending: PendingAccountSwitch, discard: Boolean) {
        accountSwitch = null
        val counts = mapOf("reviews" to pending.unsynced.reviews, "recordings" to pending.unsynced.recordings, "other" to pending.unsynced.other)
        app.analytics.track("auth.unsynced_warning", mapOf("reason" to "switch_account", "choice" to if (discard) "discard" else "sign_back_in") + counts)
        lifecycleScope.launch {
            if (discard) {
                app.repo.clearForNewAccount()
                finishSignIn(pending.token, pending.me)
            } else {
                // Give the new session back; the previous account signs in to upload its work first.
                app.repo.api.revoke(pending.token)
                startSignIn()
            }
        }
    }

    private fun finishSignIn(token: String, me: dev.jeromeswannack.chineselearning.lab.data.MeDto) {
        app.repo.onSignedIn(token, me)
        authError = null
        signedIn = true
        notificationPermission.maybeAsk()
        dev.jeromeswannack.chineselearning.lab.data.chat.ChatDelivery.signedIn(app)
        // Not a forced full sync: the same account resumes with an incremental one (pending events
        // and the Outbox upload first); an empty database gets its full sync by itself.
        lifecycleScope.launch { app.safely("sync after sign-in") { app.repo.sync() } }
    }

    private fun startSignIn() {
        val bytes = ByteArray(24).also { SecureRandom().nextBytes(it) }
        val nonce = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val verifier = AuthExchange.makeVerifier()
        app.prefs.pendingAuthNonce = nonce
        app.prefs.pendingAuthVerifier = verifier
        val url = Uri.parse("${Config.API_BASE}/api/auth/login").buildUpon()
            .appendQueryParameter("client", Config.AUTH_CLIENT)
            .appendQueryParameter("nonce", nonce)
            // PKCE: the redirect then carries a one-time code, never the session token.
            .appendQueryParameter("challenge", AuthExchange.challengeFor(verifier))
            .build()
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, url)
    }
}

/** A different account's sign-in waiting for "Sign back in" / "Discard" (MainActivity). */
data class PendingAccountSwitch(
    val token: String,
    val me: dev.jeromeswannack.chineselearning.lab.data.MeDto,
    val unsynced: SessionRules.Unsynced,
    val previousEmail: String?,
)
