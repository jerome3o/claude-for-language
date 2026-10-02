package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.Context
import android.graphics.Bitmap
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.chatInbox
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import java.util.concurrent.TimeUnit

/**
 * `GET /api/me/chat-inbox?since=` → notifications (docs/CHAT.md §2 / §5): the background
 * fallback (ChatCheckWorker, every 15 min) and the live socket's catch-up after (re)connecting.
 * Dedupes by message id (ChatNotificationStore), and drops the notification of a conversation
 * the server no longer counts as unread (read on another device).
 */
object ChatInboxCheck {
    /** The very first check looks back a day, not the endpoint's default week. */
    const val FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000L
    /** The next `since` overlaps the last answer a little (clock / commit races); dedupe absorbs it. */
    const val OVERLAP_MS = 2 * 60 * 1000L

    data class Result(val posted: Int, val cleared: Int)

    suspend fun run(
        ctx: Context,
        api: Api,
        myId: String?,
        nowMs: Long = System.currentTimeMillis(),
        avatar: (suspend (IncomingChat) -> Bitmap?)? = null,
    ): Result {
        val store = ChatNotificationStore(ctx)
        val since = store.inboxSince ?: Js.toIsoString(nowMs - FIRST_LOOKBACK_MS)
        val inbox = api.chatInbox(since)
        var posted = 0
        for (m in inbox.messages) {
            val chat = IncomingChat.fromInbox(m)
            if (ChatNotifier.notifyIncoming(ctx, chat, myId, avatar)) posted++
        }
        val unread = inbox.conversations.filter { it.unread > 0 }.map { it.conversation_id }.toSet()
        val asOf = inbox.server_time ?: Js.toIsoString(nowMs)
        var cleared = 0
        for (conv in store.conversationIds()) {
            if (conv in unread) continue
            val c = store.get(conv) ?: continue
            // Only what the server could already see: a push that landed after its answer stays.
            val newest = c.newestIncoming?.createdAt ?: continue
            if (newest <= asOf) { ChatNotifier.cancel(ctx, conv); cleared++ }
        }
        store.inboxSince = runCatching { Js.toIsoString(Js.parseDate(asOf) - OVERLAP_MS) }.getOrDefault(since)
        return Result(posted, cleared)
    }

    /** From the app (socket catch-up, worker): quietly does nothing when signed out / offline errors. */
    suspend fun runFor(app: LabApp): Result? {
        if (!app.repo.isSignedIn) return null
        return runCatching { run(app, app.repo.api, Connections.myId(app.cache)) }
            .onFailure { android.util.Log.i("ChatInboxCheck", "inbox check failed: ${it.message}") }
            .getOrNull()
    }
}

/** Every 15 minutes with a network: the inbox check (fallback for FCM) + the daily token re-register. */
class ChatCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? LabApp ?: return Result.success()
        ChatInboxCheck.runFor(app)
        runCatching { PushRegistration.ensure(app) }
        return Result.success()
    }

    companion object {
        private const val NAME = "lab-chat-check"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ChatCheckWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
