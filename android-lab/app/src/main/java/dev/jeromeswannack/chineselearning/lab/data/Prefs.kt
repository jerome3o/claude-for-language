package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget

/** Small key-value state: session token, sync cursors, budget, toggles. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("lab", Context.MODE_PRIVATE)

    var sessionToken: String?
        get() = sp.getString("session_token", null)
        set(v) = sp.edit().putString("session_token", v).apply()

    /** Nonce of the sign-in the app started; the redirect must echo it. */
    var pendingAuthNonce: String?
        get() = sp.getString("pending_auth_nonce", null)
        set(v) = sp.edit().putString("pending_auth_nonce", v).apply()

    var userName: String?
        get() = sp.getString("user_name", null)
        set(v) = sp.edit().putString("user_name", v).apply()

    var userEmail: String?
        get() = sp.getString("user_email", null)
        set(v) = sp.edit().putString("user_email", v).apply()

    var userPicture: String?
        get() = sp.getString("user_picture", null)
        set(v) = sp.edit().putString("user_picture", v).apply()

    /** users.role ('student' | 'tutor'); a tutor account gets the tutor-first shell (ui/nav/NavRules.kt). */
    var accountRole: String?
        get() = sp.getString("account_role", null)
        set(v) = sp.edit().putString("account_role", v).apply()

    var isAdmin: Boolean
        get() = sp.getBoolean("is_admin", false)
        set(v) = sp.edit().putBoolean("is_admin", v).apply()

    /** Settings → "Start on" (users.landing_page): study | students | decks, null = automatic. */
    var landingPage: String?
        get() = sp.getString("landing_page", null)
        set(v) = sp.edit().putString("landing_page", v).apply()

    /** Mirrors /api/auth/me (called by the sync's profile refresh). */
    fun saveProfile(me: MeDto) {
        sp.edit()
            .putString("user_name", me.name)
            .putString("user_email", me.email)
            .putString("user_picture", me.picture_url)
            .putString("account_role", me.role)
            .putBoolean("is_admin", me.is_admin)
            .putString("landing_page", me.landing_page)
            .apply()
    }

    var budget: StudyBudget
        get() = StudyBudget(
            sp.getInt("budget_new", StudyBudget.DEFAULT.newCardsPerDay),
            sp.getInt("budget_secondary", StudyBudget.DEFAULT.secondaryCardsPerDay),
        )
        set(v) = sp.edit().putInt("budget_new", v.newCardsPerDay).putInt("budget_secondary", v.secondaryCardsPerDay).apply()

    /** Epoch ms of the last full sync (0 = never). */
    var lastFullSync: Long
        get() = sp.getLong("last_full_sync", 0)
        set(v) = sp.edit().putLong("last_full_sync", v).apply()

    /**
     * The last one-time full refresh this device ran ([Repository.FULL_REFRESH_VERSION]):
     * heals cards an older incremental sync dropped (see [SyncChanges]).
     */
    var fullRefreshVersion: Int
        get() = sp.getInt("full_refresh_version", 0)
        set(v) = sp.edit().putInt("full_refresh_version", v).apply()

    /** `since` for GET /api/sync/changes (epoch ms, server clock). */
    var changesCursor: Long
        get() = sp.getLong("changes_cursor", 0)
        set(v) = sp.edit().putLong("changes_cursor", v).apply()

    /** `since` for GET /api/reviews (server created_at, SQL format). */
    var eventsCursor: String
        get() = sp.getString("events_cursor", null) ?: "1970-01-01 00:00:00"
        set(v) = sp.edit().putString("events_cursor", v).apply()

    /** `since` for GET /api/sentences/changes (server_time ISO), null = everything. */
    var sentencesCursor: String?
        get() = sp.getString("sentences_cursor", null)
        set(v) = sp.edit().putString("sentences_cursor", v).apply()

    var lastSyncAt: Long
        get() = sp.getLong("last_sync_at", 0)
        set(v) = sp.edit().putLong("last_sync_at", v).apply()

    var soundOn: Boolean
        get() = sp.getBoolean("sound_on", true)
        set(v) = sp.edit().putBoolean("sound_on", v).apply()

    var hapticsOn: Boolean
        get() = sp.getBoolean("haptics_on", true)
        set(v) = sp.edit().putBoolean("haptics_on", v).apply()

    /** "Study 10 more" for [scope] (deck id or "all") on [day] (local yyyy-MM-dd). */
    fun bonus(scope: String, day: String): Int = sp.getInt("bonus_${scope}_$day", 0)

    fun setBonus(scope: String, day: String, value: Int) {
        val editor = sp.edit()
        sp.all.keys.filter { it.startsWith("bonus_") && !it.endsWith("_$day") }.forEach { editor.remove(it) }
        editor.putInt("bonus_${scope}_$day", value).apply()
    }

    fun clearAccount() {
        sp.edit().clear().apply()
    }
}
