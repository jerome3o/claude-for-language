package dev.jeromeswannack.chineselearning.lab.shell

import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.R
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavSection
import org.junit.Test
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate

/** The widget and the notifications as the launcher / shade draw them (real RemoteViews + system templates). */
class NativeShellScreenshots : LabScreenshotTest() {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private val today = LocalDate.parse("2026-09-27")
    private val homework = ShellRules.homeworkDueNow(
        listOf(ShellRules.HomeworkItem("h1", "HSK 3 · Unit 4", "deck", "one_off", "2026-09-27", "active", "王老师", 12)),
        today,
    )

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    /** Puts [views] on a wallpaper-ish board, one per row, and saves the board. */
    private fun board(name: String, bg: Int, vararg views: Pair<View, Int>) {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(16), dp(24), dp(16), dp(24))
        }
        views.forEach { (v, h) ->
            column.addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, if (h > 0) dp(h) else ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) })
        }
        activity.setContentView(column)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        column.captureRoboImage("screenshots/$name.png")
    }

    private fun widget(activity: Context, model: ShellRules.WidgetModel): View {
        val host = FrameLayout(activity)
        host.addView(DueWidgetProvider.views(activity, model).apply(activity, host))
        return host
    }

    private fun label(activity: Context, text: String, color: Int) = TextView(activity).apply { this.text = text; setTextColor(color); textSize = 13f }

    @Test
    fun widgetStates() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val muted = Color.parseColor("#FFFFFFFF")
        board(
            "nativeshell-01-widget", Color.parseColor("#FF3D5A80"),
            label(activity, "Cards due + homework (3×2)", muted) to 0,
            widget(activity, ShellRules.WidgetModel(true, QueueCounts(3, 2, 4, 15), homework)) to 170,
            label(activity, "All done today", muted) to 0,
            widget(activity, ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 0))) to 150,
            label(activity, "Signed out", muted) to 0,
            widget(activity, ShellRules.WidgetModel(false, QueueCounts(0, 0, 0, 0))) to 150,
        )
    }

    @Config(qualifiers = "w412dp-h915dp-night-xxhdpi")
    @Test
    fun widgetDark() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        board(
            "nativeshell-02-widget-dark", Color.parseColor("#FF1B2433"),
            widget(activity, ShellRules.WidgetModel(true, QueueCounts(1, 0, 2, 9), homework)) to 170,
        )
    }

    private val content = NotifyContent("c1", "学习", "xuéxí", "to study; to learn", "我每天学习中文。", "I study Chinese every day.")

    /** The notification as the shade draws it (expanded template). */
    private fun rendered(activity: Context, id: Int): View {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val n: Notification = shadowOf(nm).getNotification(id)
        val big = Notification.Builder.recoverBuilder(activity, n).createBigContentView() ?: Notification.Builder.recoverBuilder(activity, n).createContentView()
        val host = FrameLayout(activity).apply { setBackgroundColor(ContextCompat.getColor(activity, R.color.shell_widget_bg)) }
        host.addView(big.apply(activity, host))
        return host
    }

    @Test
    fun notificationStates() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val white = Color.WHITE
        ShellNotifier.showFront(ctx, content, 24)
        val front = rendered(activity, ShellNotifier.ID_CARD)
        ShellNotifier.showBack(ctx, content, CardScheduler.intervalPreviews(CardScheduler.initialCardState(), 1_790_000_000_000L))
        val back = rendered(activity, ShellNotifier.ID_CARD)
        ShellNotifier.showRated(ctx, "学习", 2, "4d", 23)
        val rated = rendered(activity, ShellNotifier.ID_CARD)
        ShellNotifier.showHomework(ctx, homework)
        val hw = rendered(activity, ShellNotifier.ID_HOMEWORK)
        board(
            "nativeshell-03-notifications", Color.parseColor("#FF2B2B30"),
            label(activity, "Front", white) to 0, front to 0,
            label(activity, "Show answer →", white) to 0, back to 0,
            label(activity, "Good →", white) to 0, rated to 0,
            label(activity, "Homework due", white) to 0, hw to 0,
        )
    }

    @Test
    fun settingsRows() = shoot("nativeshell-04-more-rows") {
        NavSection(
            "Lab app",
            rows = listOf(
                { NotificationsRow(NotificationsRowUi(on = true, permitted = true)) {} },
                { NotificationsRow(NotificationsRowUi(on = true, permitted = false)) {} },
                { WidgetRow(placed = false, canPin = true) {} },
            ),
        )
    }
}
