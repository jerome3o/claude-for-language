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
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabShell
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
    private var pendingPath by mutableStateOf<String?>(null)
    private lateinit var notificationPermission: ShellPermission

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        signedIn = app.repo.isSignedIn
        notificationPermission = ShellPermission(this).also { if (signedIn) it.maybeAsk() }
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            LabTheme {
                if (!signedIn) {
                    SignInScreen(authError, ::startSignIn)
                } else {
                    LabShell(
                        app = app,
                        handoff = { openInMainApp(it) },
                        onSignedOut = { signedIn = false },
                        onSignIn = ::startSignIn,
                        pendingPath = pendingPath,
                        onPathConsumed = { pendingPath = null },
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
        if (signedIn && app.online.value) lifecycleScope.launch { app.repo.sync() }
    }

    private fun handleIntent(intent: Intent?) {
        // The hybrid app's `route` extra ("/coach?text=…") works here too.
        ShellLinks.routeExtra(intent)?.let { pendingPath = it; return }
        val data = intent?.data ?: return
        if (data.scheme != Config.AUTH_REDIRECT_SCHEME) return
        if (data.host == "auth") handleAuth(data) else pendingPath = deepLinkPath(data)
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
                lifecycleScope.launch { app.repo.sync(forceFull = true) }
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
