package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * Uploads the previous run's crash files and the system's exit records (CrashLog) once there is
 * a network. A one-shot job: persisted by WorkManager, so it still goes if the app dies again
 * right after start-up. Each run tries 1 + [CrashLog.UPLOAD_RETRIES] times with backoff; if all
 * fail, WorkManager retries the job (exponential backoff) up to [MAX_RUNS] runs. Local files are
 * deleted only after a 2xx (CrashLog.uploadOnce), so nothing is lost when it gives up — the next
 * start or debug report carries them.
 */
class CrashUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val version = inputData.getString(KEY_VERSION) ?: "unknown"
        return when (CrashLog.uploadWithRetries(applicationContext, version)) {
            CrashLog.Upload.FAILED -> if (runAttemptCount + 1 < MAX_RUNS) Result.retry() else Result.failure()
            else -> Result.success()
        }
    }

    companion object {
        const val NAME = "crash-upload"
        const val KEY_VERSION = "app_version"
        const val MAX_RUNS = 5

        fun enqueue(context: Context, appVersion: String) {
            val request = OneTimeWorkRequestBuilder<CrashUploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .setInputData(workDataOf(KEY_VERSION to appVersion))
                .build()
            // One upload job at a time; a fresh start replaces one waiting out a long backoff.
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
