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
import java.security.SecureRandom

/**
 * Sign-in gate + the shell (ui/nav/LabShell.kt). Handles two kinds of links:
 * `chineselearning-lab://auth?session_token=…&nonce=…` (the worker's sign-in callback) and
 * `chineselearning-lab:///<web route>` (opens that screen natively, or its placeholder).
 */
class MainActivity : ComponentActivity() {
    private val app get() = application as LabApp

    private var signedIn by mutableStateOf(false)
    private var authError by mutableStateOf<String?>(null)
    private var pending by mutableStateOf<NavRequest?>(null)
    /** The stack saved before the process died, rebuilt once on a cold start (ui/nav/NavResume.kt). */
    private var restoreFrom by mutableStateOf<LastRoute?>(null)
    /** The shell's navigation, for tests. */
    internal var nav: LabNav? = null
        private set
    private lateinit var notificationPermission: ShellPermission

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

    /** `chineselearning-lab://auth?session_token=…&nonce=…` from the worker's auth callback. */
    private fun handleAuth(data: Uri) {
        val expected = app.prefs.pendingAuthNonce
        val token = data.getQueryParameter("session_token")
        val error = data.getQueryParameter("error") ?: data.getQueryParameter("signup")
        when {
            expected == null || data.getQueryParameter("nonce") != expected -> authError = "That sign-in link wasn't started from this app. Try again."
            token.isNullOrBlank() -> authError = "Sign-in failed (${error ?: "no session"})."
            else -> {
                app.repo.onSignedIn(token)
                authError = null
                signedIn = true
                notificationPermission.maybeAsk()
                dev.jeromeswannack.chineselearning.lab.data.chat.ChatDelivery.signedIn(app)
                lifecycleScope.launch { app.safely("sync after sign-in") { app.repo.sync(forceFull = true) } }
            }
        }
    }

    private fun startSignIn() {
        val bytes = ByteArray(24).also { SecureRandom().nextBytes(it) }
        val nonce = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        app.prefs.pendingAuthNonce = nonce
        val url = Uri.parse("${Config.API_BASE}/api/auth/login").buildUpon()
            .appendQueryParameter("client", Config.AUTH_CLIENT)
            .appendQueryParameter("nonce", nonce)
            .build()
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, url)
    }
}
