package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.jeromeswannack.chineselearning.lab.LabApp

/**
 * Uploads pending review events and the outbox once there is a network, even with the app
 * closed. Features that enqueue an outbox write call `app.scheduleBackgroundUpload()`.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repo = (applicationContext as LabApp).repo
        repo.pushEvents()
        // Offline writes of the features (flags, recordings, homework events…) go too.
        runCatching { repo.platform.outbox.drain() }
        val pending = repo.dao.unsyncedCount() + runCatching { repo.platform.outbox.pendingCount() }.getOrDefault(0)
        return if (pending == 0) Result.success() else Result.retry()
    }

    companion object {
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("upload-reviews", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
