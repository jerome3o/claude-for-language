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

    /** The widget as the launcher draws it at [wDp] × [hDp]: the layout it would pick for that size. */
    private fun widget(activity: Context, model: ShellRules.WidgetModel, wDp: Int, hDp: Int): View {
        val host = FrameLayout(activity)
        val size = ShellRules.widgetSize(wDp.toFloat(), hDp.toFloat())
        host.addView(DueWidgetProvider.views(activity, model, size).apply(activity, host))
        return host
    }

    private fun label(activity: Context, text: String, color: Int) = TextView(activity).apply { this.text = text; setTextColor(color); textSize = 13f }

    /** Home-screen cells on the Fold's launcher (≈ 100dp tall per row; widths per column count). */
    private val sizes = listOf(
        Triple("2×1", 130, 100), Triple("3×1 — lands at this size", 230, 100), Triple("4×1", 330, 100),
        Triple("2×2", 150, 210), Triple("3×2", 250, 210), Triple("4×2", 340, 210),
    )

    /** Every size bucket of [model], each at its real size, labelled. */
    private fun sizesBoard(name: String, bg: Int, model: ShellRules.WidgetModel) {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(16), dp(20), dp(16), dp(8))
        }
        for ((what, w, h) in sizes) {
            val size = ShellRules.widgetSize(w.toFloat(), h.toFloat())
            column.addView(label(activity, "$what · ${w}×${h}dp · $size", Color.WHITE))
            column.addView(widget(activity, model, w, h), LinearLayout.LayoutParams(dp(w), dp(h)).apply { topMargin = dp(4); bottomMargin = dp(14) })
        }
        activity.setContentView(column)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        column.captureRoboImage("screenshots/$name.png")
    }

    @Config(qualifiers = "w412dp-h1400dp-xxhdpi")
    @Test
    fun widgetSizes() = sizesBoard("nativeshell-01-widget", Color.parseColor("#FF3D5A80"), ShellRules.WidgetModel(true, QueueCounts(3, 2, 4, 15), homework))

    /** Jerome's case: dark theme, nothing left today. */
    @Config(qualifiers = "w412dp-h1400dp-night-xxhdpi")
    @Test
    fun widgetDark() = sizesBoard("nativeshell-02-widget-dark", Color.parseColor("#FF1B2433"), ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 0)))

    @Config(qualifiers = "w412dp-h1400dp-night-xxhdpi")
    @Test
    fun widgetDarkDue() = sizesBoard("nativeshell-05-widget-dark-due", Color.parseColor("#FF1B2433"), ShellRules.WidgetModel(true, QueueCounts(1, 0, 2, 9), homework))

    /**
     * The Sentence Coach is on the widget at every size, as a real ≥ 48dp tap target that fits
     * inside the widget (not squeezed off the edge), next to 学 / 学 Study.
     */
    @Config(qualifiers = "w412dp-h1400dp-xxhdpi")
    @Test
    fun widgetOffersCoachAtEverySize() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val model = ShellRules.WidgetModel(true, QueueCounts(20, 8, 40, 60), homework)
        val column = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val cells = (sizes + Triple("2×1 narrow", 110, 80)).map { (what, w, h) ->
            val cell = widget(activity, model, w, h)
            column.addView(cell, LinearLayout.LayoutParams(dp(w), dp(h)))
            Triple(what, cell, ShellRules.widgetSize(w.toFloat(), h.toFloat()))
        }
        activity.setContentView(column)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        for ((what, cell, size) in cells) {
            val coach = listOf(R.id.shell_widget_coach, R.id.shell_widget_coach_icon)
                .mapNotNull { cell.findViewById<View>(it) }
                .filter { it.visibility == View.VISIBLE }
            kotlin.test.assertEquals(1, coach.size, "$what ($size): one coach button")
            val b = coach.single()
            kotlin.test.assertTrue(b.width >= dp(48) && b.height >= dp(48), "$what ($size): coach is ${b.width}×${b.height}px, want ≥ 48dp")
            val at = IntArray(2).also { b.getLocationInWindow(it) }
            val box = IntArray(2).also { cell.getLocationInWindow(it) }
            kotlin.test.assertTrue(at[0] + b.width <= box[0] + cell.width && at[1] + b.height <= box[1] + cell.height, "$what ($size): coach fits inside the widget")
            val labelled = (b as TextView).text.toString().contains("Coach")
            kotlin.test.assertEquals(size == ShellRules.WidgetSize.FULL, labelled, "$what ($size): labelled Coach only at 3×2 and up")
        }
    }

    @Test
    fun widgetStates() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val white = Color.WHITE
        fun at(model: ShellRules.WidgetModel, w: Int, h: Int) = FrameLayout(activity).apply {
            addView(widget(activity, model, w, h), FrameLayout.LayoutParams(dp(w), dp(h)))
        }
        board(
            "nativeshell-06-widget-states", Color.parseColor("#FF3D5A80"),
            label(activity, "Signed out (3×1, 2×2)", white) to 0,
            at(ShellRules.WidgetModel(false, QueueCounts(0, 0, 0, 0)), 230, 100) to 100,
            at(ShellRules.WidgetModel(false, QueueCounts(0, 0, 0, 0)), 150, 210) to 210,
            label(activity, "128 due at 2×1 (the count rides on 学)", white) to 0,
            at(ShellRules.WidgetModel(true, QueueCounts(20, 8, 40, 60)), 110, 90) to 90,
            label(activity, "One card due (3×1)", white) to 0,
            at(ShellRules.WidgetModel(true, QueueCounts(0, 0, 0, 1)), 230, 100) to 100,
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
