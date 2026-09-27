package dev.jeromeswannack.chineselearning.lab.shell

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dev.jeromeswannack.chineselearning.lab.LabApp

/**
 * Hourly: sync if online (so a card answered on another device isn't asked again), redraw
 * the widget, post the due-card / homework notification per ShellRules. Never retries — the
 * next hour tries again (the hybrid's HomeworkWorker).
 */
class DueCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? LabApp ?: return Result.success()
        runCatching { Shell.check(app) }
        return Result.success()
    }
}
