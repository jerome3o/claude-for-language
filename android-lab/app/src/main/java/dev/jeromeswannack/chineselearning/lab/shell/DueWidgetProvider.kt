package dev.jeromeswannack.chineselearning.lab.shell

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.R
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

/**
 * Home-screen widget: today's due count (the Study button's number, from Room — offline),
 * "about N min", the homework due now, and 学 Study / ✏️ Coach (the hybrid's two buttons).
 * Redrawn by the app after every sync, after a rating from a notification, hourly
 * (DueCheckWorker) and just after midnight — never by the launcher's own timer.
 */
class DueWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refreshAsync(context)

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_MIDNIGHT) {
            scheduleMidnightRefresh(context)
            refreshAsync(context)
        }
    }

    private fun refreshAsync(context: Context) {
        val app = context.applicationContext as? LabApp ?: return
        val pending = goAsync()
        app.scope.launch {
            try {
                runCatching { Shell.refresh(app) }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_MIDNIGHT = "dev.jeromeswannack.chineselearning.lab.shell.WIDGET_MIDNIGHT"

        fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, DueWidgetProvider::class.java))

        fun update(context: Context, model: ShellRules.WidgetModel) {
            val ids = ids(context)
            if (ids.isEmpty()) return
            AppWidgetManager.getInstance(context).updateAppWidget(ids, views(context, model))
        }

        /** The widget's views for [model] (also what the screenshot test renders). */
        fun views(context: Context, model: ShellRules.WidgetModel): RemoteViews {
            val t = ShellRules.widgetText(model)
            return RemoteViews(context.packageName, R.layout.shell_widget_due).apply {
                setTextViewText(R.id.shell_widget_count, t.count)
                setTextViewText(R.id.shell_widget_caption, t.caption)
                setTextViewText(R.id.shell_widget_detail, t.detail)
                if (t.homework != null) {
                    setViewVisibility(R.id.shell_widget_homework, View.VISIBLE)
                    setTextViewText(R.id.shell_widget_homework, t.homework)
                    val path = if (model.homework.size == 1) dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.homeworkPass(model.homework[0].item.id)
                    else dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.homework()
                    setOnClickPendingIntent(R.id.shell_widget_homework, ShellLinks.pending(context, 42, path))
                } else {
                    setViewVisibility(R.id.shell_widget_homework, View.GONE)
                }
                val study = ShellLinks.pending(context, 40, if (model.signedIn) ShellLinks.STUDY else "/")
                setOnClickPendingIntent(R.id.shell_widget_root, study)
                setOnClickPendingIntent(R.id.shell_widget_study, study)
                setOnClickPendingIntent(R.id.shell_widget_coach, ShellLinks.pending(context, 41, ShellLinks.coach(null)))
            }
        }

        /** An inexact alarm just after the next local midnight, so "due today" rolls over. */
        fun scheduleMidnightRefresh(context: Context, zone: ZoneId = ZoneId.systemDefault()) {
            val am = context.getSystemService(AlarmManager::class.java) ?: return
            val next = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 60_000
            val intent = Intent(context, DueWidgetProvider::class.java).setAction(ACTION_MIDNIGHT)
            val pi = PendingIntent.getBroadcast(context, 43, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            am.set(AlarmManager.RTC, next, pi)
        }
    }
}
