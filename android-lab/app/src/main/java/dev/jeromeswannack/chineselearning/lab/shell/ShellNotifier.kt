package dev.jeromeswannack.chineselearning.lab.shell

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.R
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * The shell's notifications (the hybrid's HomeworkNotifier.java). Channel and notification
 * ids are the Lab app's own, so the two apps never replace each other's.
 *
 *  - Card: front (hanzi · "Show answer") → back (pinyin, meaning, example · Again / Good / Easy
 *    with their intervals) → "✓ Good · back in 4d" with **Next card** while more are due.
 *  - Homework: one-off homework due today / overdue, once a day per assignment.
 */
object ShellNotifier {
    const val CHANNEL_CARDS = "lab_due_cards"
    const val CHANNEL_HOMEWORK = "lab_homework_due"
    const val ID_CARD = 3101
    const val ID_HOMEWORK = 3102
    const val EXTRA_CARD_ID = "lab_card_id"

    /** Again / Good / Easy — three actions is all a notification shows (the hybrid's choice too). */
    val RATINGS = listOf(Rating.AGAIN, Rating.GOOD, Rating.EASY)

    fun ratingLabel(rating: Int) = when (rating) {
        Rating.AGAIN -> "Again"
        Rating.HARD -> "Hard"
        Rating.GOOD -> "Good"
        else -> "Easy"
    }

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_CARDS, ctx.getString(R.string.shell_channel_cards), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = ctx.getString(R.string.shell_channel_cards_desc) },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_HOMEWORK, ctx.getString(R.string.shell_channel_homework), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = ctx.getString(R.string.shell_channel_homework_desc) },
        )
    }

    fun canNotify(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun showFront(ctx: Context, c: NotifyContent, dueTotal: Int) {
        val more = if (dueTotal > 1) " · $dueTotal due today" else ""
        post(ctx, ID_CARD, cardBuilder(ctx, c.cardId)
            .setContentTitle(c.hanzi)
            .setContentText("What does this mean? Think, then reveal.$more")
            .addAction(0, "Show answer", action(ctx, ShellActionReceiver.ACTION_REVEAL, 1, c.cardId))
            .addAction(0, "Open study", ShellLinks.pending(ctx, 2, ShellLinks.STUDY))
            .build())
    }

    fun backText(c: NotifyContent): String = buildString {
        append(c.english)
        if (c.sentence != null) {
            append("\n\n").append(c.sentence)
            if (c.sentenceTranslation != null) append("\n").append(c.sentenceTranslation)
        }
    }

    fun actionLabel(rating: Int, previews: List<IntervalPreview>): String {
        val interval = previews.firstOrNull { it.rating == rating }?.intervalText
        return if (interval != null) "${ratingLabel(rating)} · $interval" else ratingLabel(rating)
    }

    fun showBack(ctx: Context, c: NotifyContent, previews: List<IntervalPreview>) {
        val b = cardBuilder(ctx, c.cardId)
            .setContentTitle("${c.hanzi}  ·  ${c.pinyin}")
            .setContentText(c.english)
            .setStyle(NotificationCompat.BigTextStyle().bigText(backText(c)))
        RATINGS.forEach { r -> b.addAction(0, actionLabel(r, previews), action(ctx, ShellActionReceiver.ACTION_RATE, 10 + r, c.cardId, r)) }
        post(ctx, ID_CARD, b.build())
    }

    /** After a rating: a quiet confirmation, with Next card while more are due. */
    fun showRated(ctx: Context, hanzi: String, rating: Int, nextIn: String?, moreDue: Int) {
        val title = "✓ ${ratingLabel(rating)} — $hanzi" + (nextIn?.let { " · back in $it" } ?: "")
        val b = cardBuilder(ctx, null)
            .setContentTitle(title)
            .setContentText(if (moreDue > 0) "$moreDue more due today" else "All caught up for now 🎉")
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(if (moreDue > 0) 60_000 else 8_000)
        if (moreDue > 0) b.addAction(0, "Next card", action(ctx, ShellActionReceiver.ACTION_NEXT, 20, null))
        post(ctx, ID_CARD, b.build())
    }

    fun showError(ctx: Context, message: String) {
        post(ctx, ID_CARD, cardBuilder(ctx, null).setContentTitle("Couldn't record that review").setContentText(message).setTimeoutAfter(15_000).build())
    }

    fun showHomework(ctx: Context, due: List<ShellRules.HomeworkDue>) {
        if (due.isEmpty()) return
        val path = if (due.size == 1) Routes.homeworkPass(due[0].item.id) else Routes.homework()
        val lines = due.map(ShellRules::homeworkLine)
        val style: NotificationCompat.Style =
            if (lines.size == 1) NotificationCompat.BigTextStyle().bigText(lines[0])
            else NotificationCompat.InboxStyle().also { s -> lines.take(5).forEach(s::addLine) }
        post(ctx, ID_HOMEWORK, NotificationCompat.Builder(ctx, CHANNEL_HOMEWORK)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setColor(ContextCompat.getColor(ctx, R.color.shell_accent))
            .setContentTitle(ShellRules.homeworkTitle(due))
            .setContentText(lines.first())
            .setStyle(style)
            .setContentIntent(ShellLinks.pending(ctx, 30, path))
            .setShowWhen(false)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build())
    }

    fun cancelCard(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_CARD)

    /** The card id of the card notification on screen, if one is showing. */
    fun showingCardId(ctx: Context): String? =
        runCatching {
            ctx.getSystemService(NotificationManager::class.java)?.activeNotifications
                ?.firstOrNull { it.id == ID_CARD }?.notification?.extras?.getString(EXTRA_CARD_ID)
        }.getOrNull()

    private fun cardBuilder(ctx: Context, cardId: String?): NotificationCompat.Builder {
        ensureChannels(ctx)
        return NotificationCompat.Builder(ctx, CHANNEL_CARDS)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setColor(ContextCompat.getColor(ctx, R.color.shell_accent))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setShowWhen(false) // a card isn't an event with a time
            // Tapping the body opens a full study session (the hybrid's /study?autostart=true).
            .setContentIntent(ShellLinks.pending(ctx, 0, ShellLinks.STUDY))
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .also { b -> if (cardId != null) b.addExtras(android.os.Bundle().apply { putString(EXTRA_CARD_ID, cardId) }) }
    }

    private fun action(ctx: Context, what: String, requestCode: Int, cardId: String?, rating: Int? = null): PendingIntent {
        val intent = Intent(ctx, ShellActionReceiver::class.java).setAction(what)
        if (cardId != null) intent.putExtra(ShellActionReceiver.EXTRA_CARD_ID, cardId)
        if (rating != null) intent.putExtra(ShellActionReceiver.EXTRA_RATING, rating)
        // Distinct request codes, or the PendingIntents of the three ratings collapse into one.
        return PendingIntent.getBroadcast(ctx, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun post(ctx: Context, id: Int, n: android.app.Notification) {
        ensureChannels(ctx)
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (_: SecurityException) {
            // Permission revoked — the next check stays silent.
        }
    }
}
