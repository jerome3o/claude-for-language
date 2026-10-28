package dev.jeromeswannack.chineselearning.lab.data.auth

import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The signed-out state (CLAUDE.md "Sign-in & sessions"; web services/signedOut.ts): a 401 from our
 * API to a request carrying the session means it is gone (revoked, signed out everywhere, or a
 * month unused). The app keeps working on this phone — Room, the audio cache, the Outbox are all
 * kept — and [ui.kit.SignedOutBanner] says so on every screen until Sign in. Persisted in
 * [Prefs.signedOutSince], so a cold start still shows it. Cleared by the next 2xx from a route
 * that always needs the session ([SessionRules.provesSignedIn]) or a sign-in.
 *
 * Before (Oct 2026): sync, analytics, feedback and transcription all got 401 for days while
 * offline study worked, and nothing told Jerome he was signed out.
 */
class SessionHealth(private val prefs: Prefs) : Api.AuthListener {
    private val _signedOut = MutableStateFlow(prefs.signedOutSince > 0)
    val signedOut: StateFlow<Boolean> = _signedOut.asStateFlow()

    /** Analytics (`auth.signed_out_detected`), set once analytics exists. */
    @Volatile var track: ((String, Map<String, Any?>) -> Unit)? = null

    override fun unauthorized(path: String) {
        if (!SessionRules.countsForSignedOut(path) || prefs.sessionToken == null) return
        synchronized(this) {
            if (_signedOut.value) return
            prefs.signedOutSince = System.currentTimeMillis()
            _signedOut.value = true
        }
        runCatching { track?.invoke("auth.signed_out_detected", mapOf("platform" to "lab", "where" to SessionRules.signedOutWhere(path))) }
    }

    override fun authorized(path: String) {
        if (!_signedOut.value || !SessionRules.provesSignedIn(path)) return
        clear()
    }

    /** A sign-in (or signing out on purpose): the banner goes. */
    fun clear() {
        synchronized(this) {
            if (prefs.signedOutSince != 0L) prefs.signedOutSince = 0
            _signedOut.value = false
        }
    }
}
