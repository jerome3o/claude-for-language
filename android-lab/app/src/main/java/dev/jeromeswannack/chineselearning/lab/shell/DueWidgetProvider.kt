package dev.jeromeswannack.chineselearning.lab.shell

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.view.View
import androidx.annotation.RequiresApi
import android.widget.RemoteViews
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.R
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId

/**
 * Home-screen widget: today's due count (the Study button's number, from Room — offline),
 * "about N min", the homework due now, and 学 Study / ✏️ Coach (the hybrid's two buttons) — the
 * coach at every size: a compact ✏️ next to 学 on the small ones, the labelled button from 3×2.
 * Redrawn by the app after every sync, after a rating from a notification, hourly
 * (DueCheckWorker) and just after midnight — never by the launcher's own timer.
 *
 * Resizable from 2×1 up, one layout per size ([ShellRules.WidgetSize]): Android 12+ gets a
 * size map and swaps layouts itself; older launchers get the layout for the size in the
 * widget's options, redrawn when it is resized ([onAppWidgetOptionsChanged]).
 */
class DueWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refreshAsync(context)

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) =
        refreshAsync(context)

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
            val manager = AppWidgetManager.getInstance(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                manager.updateAppWidget(ids, responsiveViews(context, model))
            } else {
                // Portrait size (the Fold is used upright): min width × max height.
                for (id in ids) {
                    val o = manager.getAppWidgetOptions(id)
                    val size = ShellRules.widgetSize(
                        o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).toFloat(),
                        o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).toFloat(),
                    )
                    manager.updateAppWidget(id, views(context, model, size))
                }
            }
        }

        /** Android 12+: every layout keyed by its minimum size; the launcher shows the one that fits. */
        @RequiresApi(Build.VERSION_CODES.S)
        fun responsiveViews(context: Context, model: ShellRules.WidgetModel): RemoteViews =
            RemoteViews(ShellRules.WIDGET_ANCHORS.associate { SizeF(it.widthDp, it.heightDp) to views(context, model, it.size) })

        private fun layoutFor(size: ShellRules.WidgetSize) = when (size) {
            ShellRules.WidgetSize.TINY -> R.layout.shell_widget_tiny
            ShellRules.WidgetSize.ROW, ShellRules.WidgetSize.ROW_WIDE -> R.layout.shell_widget_row
            ShellRules.WidgetSize.SQUARE, ShellRules.WidgetSize.FULL -> R.layout.shell_widget_due
        }

        /** The widget's views for [model] at [size] (also what the screenshot test renders). */
        fun views(context: Context, model: ShellRules.WidgetModel, size: ShellRules.WidgetSize = ShellRules.WidgetSize.FULL): RemoteViews {
            val t = ShellRules.widgetText(model)
            val study = ShellLinks.pending(context, 40, if (model.signedIn) ShellLinks.STUDY else "/")
            // Straight into the coach's sentence box with the keyboard up, at every size.
            val coach = ShellLinks.pending(context, 41, ShellLinks.COACH_TYPE)
            val homework = if (t.homework == null) null else {
                val path = if (model.homework.size == 1) dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.homeworkPass(model.homework[0].item.id)
                else dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.homework()
                ShellLinks.pending(context, 42, path)
            }
            return RemoteViews(context.packageName, layoutFor(size)).apply {
                setTextViewText(R.id.shell_widget_count, t.count)
                setOnClickPendingIntent(R.id.shell_widget_root, study)
                when (size) {
                    ShellRules.WidgetSize.TINY -> {
                        // The count rides on 学 as a badge (nothing to count while signed out).
                        setViewVisibility(R.id.shell_widget_count, if (model.signedIn) View.VISIBLE else View.GONE)
                        setContentDescription(R.id.shell_widget_study_circle, "Study, ${t.count} ${t.short}")
                        setOnClickPendingIntent(R.id.shell_widget_study_circle, study)
                        setOnClickPendingIntent(R.id.shell_widget_coach, coach)
                    }
                    ShellRules.WidgetSize.ROW, ShellRules.WidgetSize.ROW_WIDE -> {
                        val wide = size == ShellRules.WidgetSize.ROW_WIDE
                        setTextViewText(R.id.shell_widget_caption, t.caption)
                        // One row has room for one detail line: the homework due now beats "about N min".
                        setTextViewText(R.id.shell_widget_detail, t.homework ?: t.detail)
                        if (homework != null) setOnClickPendingIntent(R.id.shell_widget_detail, homework)
                        setViewVisibility(R.id.shell_widget_study_circle, if (wide) View.GONE else View.VISIBLE)
                        setViewVisibility(R.id.shell_widget_study, if (wide) View.VISIBLE else View.GONE)
                        setOnClickPendingIntent(R.id.shell_widget_study_circle, study)
                        setOnClickPendingIntent(R.id.shell_widget_study, study)
                        setOnClickPendingIntent(R.id.shell_widget_coach, coach)
                    }
                    ShellRules.WidgetSize.SQUARE, ShellRules.WidgetSize.FULL -> {
                        setTextViewText(R.id.shell_widget_caption, t.caption)
                        setTextViewText(R.id.shell_widget_detail, t.detail)
                        if (homework != null) {
                            setViewVisibility(R.id.shell_widget_homework, View.VISIBLE)
                            setTextViewText(R.id.shell_widget_homework, t.homework)
                            setOnClickPendingIntent(R.id.shell_widget_homework, homework)
                        } else {
                            setViewVisibility(R.id.shell_widget_homework, View.GONE)
                        }
                        // 2×2 has room for 学 Study plus the compact ✏️; 3×2 and up keep the labelled Coach.
                        val full = size == ShellRules.WidgetSize.FULL
                        setViewVisibility(R.id.shell_widget_coach, if (full) View.VISIBLE else View.GONE)
                        setViewVisibility(R.id.shell_widget_coach_icon, if (full) View.GONE else View.VISIBLE)
                        setOnClickPendingIntent(R.id.shell_widget_study, study)
                        setOnClickPendingIntent(R.id.shell_widget_coach, coach)
                        setOnClickPendingIntent(R.id.shell_widget_coach_icon, coach)
                    }
                }
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
