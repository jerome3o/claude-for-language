package dev.jeromeswannack.chineselearning.lab

import android.content.ActivityNotFoundException
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeSettings
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeViewModel
import dev.jeromeswannack.chineselearning.lab.ui.home.SignInScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyRoute
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.launch
import java.security.SecureRandom

class MainActivity : ComponentActivity() {
    private val app get() = application as LabApp

    private sealed interface Screen {
        data object Home : Screen
        data class Study(val deckId: String?) : Screen
    }

    private var screen by mutableStateOf<Screen>(Screen.Home)
    private var signedIn by mutableStateOf(false)
    private var authError by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        signedIn = app.repo.isSignedIn
        handleIntent(intent)
        setContent {
            LabTheme {
                if (!signedIn) {
                    SignInScreen(authError, ::startSignIn)
                } else {
                    when (val s = screen) {
                        Screen.Home -> {
                            val vm: HomeViewModel = viewModel(factory = HomeViewModel.Factory(app))
                            val ui by vm.ui.collectAsStateWithLifecycle()
                            val sync by app.repo.status.collectAsState()
                            val online by app.online.collectAsState()
                            HomeScreen(
                                ui = ui,
                                sync = sync,
                                online = online,
                                settings = HomeSettings(app.prefs.soundOn, app.prefs.hapticsOn),
                                actions = HomeActions(
                                    onStudyAll = { screen = Screen.Study(null) },
                                    onStudyDeck = { screen = Screen.Study(it) },
                                    onSync = { lifecycleScope.launch { app.repo.sync() } },
                                    onFullSync = { lifecycleScope.launch { app.repo.sync(forceFull = true) } },
                                    onOpenFullApp = { openInMainApp("/") },
                                    onSignOut = { lifecycleScope.launch { app.repo.signOut(); signedIn = false } },
                                    onSignIn = ::startSignIn,
                                    onToggleSound = { app.prefs.soundOn = it },
                                    onToggleHaptics = { app.prefs.hapticsOn = it },
                                ),
                            )
                        }
                        is Screen.Study -> StudyRoute(
                            app = app,
                            deckId = s.deckId,
                            onExit = { screen = Screen.Home; lifecycleScope.launch { app.repo.sync() } },
                            onOpenInApp = { noteId -> openInMainApp("/cards/$noteId") },
                        )
                    }
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

    /** `chineselearning-lab://auth?session_token=…&nonce=…` from the worker's auth callback. */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != Config.AUTH_REDIRECT_SCHEME || data.host != "auth") return
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
                screen = Screen.Home
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

    /** Hand off to the solid hybrid app (its MainActivity routes chineselearning:///<route>), else the web. */
    private fun openInMainApp(route: String) {
        val deepLink = Intent(Intent.ACTION_VIEW, Uri.parse("${Config.HYBRID_SCHEME}://$route")).setPackage(Config.HYBRID_PACKAGE)
        try {
            startActivity(deepLink)
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Config.WEB_URL + route)))
        }
    }
}
