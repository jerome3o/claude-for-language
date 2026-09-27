package dev.jeromeswannack.chineselearning.lab.shell

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dev.jeromeswannack.chineselearning.lab.LabApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * The native shell (package I): home-screen widget, launcher shortcuts, text selection →
 * coach, due-card and homework notifications. Everything reads the local Room mirror, so the
 * widget and the notifications work offline; a rating from a notification is a real local
 * review event (NotificationReview).
 *
 * Wiring: [install] from LabApp.onCreate; `ShellPermission` + `ShellLinks.routeExtra` in
 * MainActivity; `HomeworkFeed` in FeatureSyncs; `NotificationsRow` / `WidgetRow` in More.
 */
object Shell {
    private const val HOURLY_WORK = "lab-due-check"

    lateinit var prefs: ShellPrefs
        private set

    @OptIn(FlowPreview::class)
    fun install(app: LabApp) {
        prefs = ShellPrefs(app)
        ShellNotifier.ensureChannels(app)
        scheduleHourlyCheck(app)
        DueWidgetProvider.scheduleMidnightRefresh(app)
        // Widget + a stale card notification follow every data change (sync, sign-out).
        app.scope.launch { app.repo.dataVersion.debounce(400).collect { runCatching { refresh(app) } } }
    }

    fun scheduleHourlyCheck(context: Context) {
        val request = PeriodicWorkRequestBuilder<DueCheckWorker>(1, TimeUnit.HOURS, 15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(HOURLY_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    suspend fun snapshot(app: LabApp, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): ShellSnapshot =
        withContext(Dispatchers.IO) { ShellSnapshot.load(app.repo.dao, app.prefs, HomeworkFeed.cached(app.cache), nowMs, zone) }

    /** Redraw the widget and drop a card notification whose card is no longer due (answered elsewhere, signed out…). */
    suspend fun refresh(app: LabApp, snap: ShellSnapshot? = null) {
        val s = snap ?: snapshot(app)
        DueWidgetProvider.update(app, s.widget)
        val showing = ShellNotifier.showingCardId(app)
        if (showing != null && (!s.signedIn || !s.stillDue(showing))) ShellNotifier.cancelCard(app)
    }

    private fun checkInput(app: LabApp, s: ShellSnapshot, nowMs: Long, zone: ZoneId) = ShellRules.CheckInput(
        enabled = prefs.notificationsOn,
        permitted = ShellNotifier.canNotify(app),
        signedIn = s.signedIn,
        tutorAccount = s.tutorAccount,
        hour = Instant.ofEpochMilli(nowMs).atZone(zone).hour,
    )

    /** The hourly check (DueCheckWorker): sync if online, redraw, then notify per ShellRules. */
    suspend fun check(app: LabApp, syncFirst: Boolean = true) {
        if (syncFirst && app.repo.isSignedIn && app.online.value) runCatching { app.repo.sync() }
        val now = System.currentTimeMillis()
        val zone = ZoneId.systemDefault()
        val s = snapshot(app, now, zone)
        DueWidgetProvider.update(app, s.widget)
        val input = checkInput(app, s, now, zone)
        val showing = ShellNotifier.showingCardId(app)
        when (val d = ShellRules.decideCard(input, s.notifyCard, showingStillDue = showing != null && s.stillDue(showing))) {
            is ShellRules.CardDecision.Show -> NotificationReview.content(app.repo.dao, d.cardId)?.let { ShellNotifier.showFront(app, it, s.due.total) }
            ShellRules.CardDecision.Keep -> Unit
            is ShellRules.CardDecision.Stay -> if (d.reason != ShellRules.Silent.QUIET_HOURS && showing != null) ShellNotifier.cancelCard(app)
        }
        val homework = ShellRules.homeworkToNotify(input, s.homework, prefs.homeworkNotified(s.today))
        if (homework.isNotEmpty()) {
            ShellNotifier.showHomework(app, s.homework)
            prefs.markHomeworkNotified(s.today, s.homework.map { it.item.id })
        }
    }

    // ---------------- notification actions (ShellActionReceiver) ----------------

    suspend fun reveal(app: LabApp, cardId: String) {
        val content = NotificationReview.content(app.repo.dao, cardId) ?: return ShellNotifier.cancelCard(app)
        ShellNotifier.showBack(app, content, NotificationReview.previews(app.repo.dao, cardId))
    }

    suspend fun rate(app: LabApp, cardId: String, rating: Int) {
        val rated = runCatching { NotificationReview.rate(app.repo, cardId, rating) }.getOrElse {
            ShellNotifier.showError(app, "Tap to review in the app instead.")
            return
        }
        app.haptics.rated(rating)
        // Same upload path as a session: push now when online, the upload worker otherwise.
        if (app.online.value) app.repo.pushEvents()
        if (app.repo.dao.unsyncedCount() > 0) app.scheduleBackgroundUpload()
        val s = snapshot(app)
        DueWidgetProvider.update(app, s.widget)
        ShellNotifier.showRated(app, rated.hanzi ?: "", rating, rated.nextIn, s.candidates.size)
    }

    /** "Next card" on the confirmation: the next due card's front (the user asked — quiet hours don't apply). */
    suspend fun next(app: LabApp) {
        val s = snapshot(app)
        val card = s.notifyCard ?: return ShellNotifier.cancelCard(app)
        NotificationReview.content(app.repo.dao, card.id)?.let { ShellNotifier.showFront(app, it, s.due.total) } ?: ShellNotifier.cancelCard(app)
    }
}
