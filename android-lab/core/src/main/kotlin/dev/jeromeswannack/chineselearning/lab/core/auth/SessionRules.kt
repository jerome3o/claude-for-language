package dev.jeromeswannack.chineselearning.lab.core.auth

/**
 * Port of shared/auth/session.ts (parity-tested by parity/fixtures/session.ts → SessionParityTest):
 * the signed-out state (a 401 from our API → the banner on every screen, local data kept) and
 * account switching (signing in again never wipes data; only a DIFFERENT account replaces it, and
 * never while something hasn't uploaded without asking). CLAUDE.md "Sign-in & sessions".
 */
object SessionRules {
    /** Port of signedOutBanner(). */
    fun signedOutBanner(platform: String): String =
        "You're signed out — sign in again to sync, transcribe and use Claude. Your reviews are saved on this ${if (platform == "lab") "phone" else "device"}."

    /** Port of SIGNED_OUT_TRANSCRIPTION / SIGNED_OUT_TRANSCRIPTION_NOTE. */
    const val SIGNED_OUT_TRANSCRIPTION = "Signed out — sign in again"
    const val SIGNED_OUT_TRANSCRIPTION_NOTE = "Your recording is saved"

    private val HOST = Regex("^https?://[^/]+")
    private fun pathOnly(path: String): String = path.substringBefore('?').replace(HOST, "")

    private val TRANSCRIBE = Regex("^/api/transcribe(/|$)")
    private val ANALYTICS = Regex("^/api/(me/usage-events|analytics/)")
    private val FEEDBACK = Regex("^/api/feedback(/|$)")
    private val SYNC = Regex("^/api/(sync|reviews|decks|notes/[^/]+$|sentences|custom-lessons|readers|me/(homework|bumps|up-next|card-holds|card-forgets|study-time))(/|$)")
    private val PROFILE = Regex("^/api/(auth/me|profile)(/|$)")
    private val MEDIA = Regex("^/api/(audio|chat-media|media)(/|$)")
    private val CHAT = Regex("^/api/(conversations|messages|me/chats?|me/chat-inbox|live)(/|$)")
    private val AI = Regex("^/api/(ai|coach|sentence|sentences/explain|lessons/(answer-check|sentence-feedback)|notes/[^/]+/ask|note-questions|reader-words|practice)(/|$)")
    private val NOT_COUNTED = Regex("^/api/auth/(logout|logout-all|exchange|login|callback)(/|$)")

    /** Port of signedOutWhere(): which kind of request found the 401 (analytics `auth.signed_out_detected`). */
    fun signedOutWhere(path: String): String {
        val p = pathOnly(path)
        return when {
            TRANSCRIBE.containsMatchIn(p) -> "transcribe"
            ANALYTICS.containsMatchIn(p) -> "analytics"
            FEEDBACK.containsMatchIn(p) -> "feedback"
            SYNC.containsMatchIn(p) -> "sync"
            PROFILE.containsMatchIn(p) -> "profile"
            MEDIA.containsMatchIn(p) -> "media"
            CHAT.containsMatchIn(p) -> "chat"
            AI.containsMatchIn(p) -> "ai"
            else -> "other"
        }
    }

    /** Port of countsForSignedOut(): signing out and the code exchange never put the app in the signed-out state. */
    fun countsForSignedOut(path: String): Boolean = !NOT_COUNTED.containsMatchIn(pathOnly(path))

    /** Port of provesSignedIn(): a 2xx here means the session works again (public routes answer 200 to a dead token too). */
    fun provesSignedIn(path: String): Boolean = signedOutWhere(path).let { it == "sync" || it == "profile" }

    /** Port of UnsyncedCounts. */
    data class Unsynced(val reviews: Int = 0, val recordings: Int = 0, val other: Int = 0) {
        val total: Int get() = maxOf(0, reviews) + maxOf(0, recordings) + maxOf(0, other)
    }

    private fun plural(n: Int, one: String, many: String) = "%,d %s".format(java.util.Locale.US, n, if (n == 1) one else many)

    /** Port of unsyncedSummary(). */
    fun unsyncedSummary(c: Unsynced): String {
        val parts = buildList {
            if (c.reviews > 0) add(plural(c.reviews, "review", "reviews"))
            if (c.recordings > 0) add(plural(c.recordings, "recording", "recordings"))
            if (c.other > 0) add(plural(c.other, "other change", "other changes"))
        }
        if (parts.isEmpty()) return "Everything has uploaded"
        val list = if (parts.size == 1) parts[0] else parts.dropLast(1).joinToString(", ") + " and " + parts.last()
        return "$list ${if (c.total == 1) "hasn't" else "haven't"} uploaded yet"
    }

    /** Port of signOutWarning(). */
    fun signOutWarning(c: Unsynced): String =
        "${unsyncedSummary(c)}. Sync first, or sign out anyway — they stay on this device and upload when you sign back in to the same account."

    /** Port of switchAccountWarning(). */
    fun switchAccountWarning(c: Unsynced, previousEmail: String?): String {
        val who = previousEmail?.trim()?.takeIf { it.isNotEmpty() } ?: "the previous account"
        return "${unsyncedSummary(c)} — sign back in as $who to upload them first, or discard them."
    }

    /** Port of AccountSwitch. */
    enum class Switch(val wire: String) { FIRST("first"), SAME("same"), SWITCH("switch"), SWITCH_BLOCKED("switch_blocked") }

    /** Port of accountSwitchFor(). */
    fun accountSwitch(prevId: String?, prevEmail: String?, nextId: String?, nextEmail: String?, unsynced: Unsynced): Switch {
        val pId = prevId?.trim()?.takeIf { it.isNotEmpty() }
        val pEmail = prevEmail?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
        if (pId == null && pEmail == null) return Switch.FIRST
        val nId = nextId?.trim()?.takeIf { it.isNotEmpty() }
        val nEmail = nextEmail?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
        val same = if (pId != null && nId != null) pId == nId else pEmail != null && nEmail != null && pEmail == nEmail
        if (same) return Switch.SAME
        return if (unsynced.total > 0) Switch.SWITCH_BLOCKED else Switch.SWITCH
    }
}
