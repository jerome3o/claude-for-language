package dev.jeromeswannack.chineselearning.lab.core.feedback

/**
 * Port of shared/feedback (docs/FEEDBACK.md): the shake rule both apps use to open the feedback
 * sheet, the route pattern a feedback item's context carries, and the one-line context summary.
 * Parity-tested against the TypeScript (parity/fixtures/feedback.ts → FeedbackParityTest).
 */
object Shake {
    /** Port of SHAKE_RULE. */
    const val THRESHOLD_MS2 = 25.0
    const val MIN_GAP_MS = 90.0
    const val WINDOW_MS = 1000.0
    const val JOLTS = 4
    const val COOLDOWN_MS = 4000.0

    /** Port of ShakeState: times (ms) of the jolts inside the window, the last shake. */
    data class State(val jolts: List<Double> = emptyList(), val lastShake: Double? = null)

    data class Step(val state: State, val shake: Boolean)

    /** Port of shakeStep(): one accelerometer sample (m/s², gravity included) in. */
    fun step(state: State, t: Double, x: Double, y: Double, z: Double): Step {
        if (!t.isFinite() || !x.isFinite() || !y.isFinite() || !z.isFinite()) return Step(state, false)
        val magnitude = StrictMath.sqrt(x * x + y * y + z * z)
        val jolts = state.jolts.filter { t - it < WINDOW_MS && it <= t }.toMutableList()
        val last = jolts.lastOrNull()
        if (magnitude < THRESHOLD_MS2 || (last != null && t - last < MIN_GAP_MS)) return Step(State(jolts, state.lastShake), false)
        jolts += t
        val cooled = state.lastShake == null || t - state.lastShake >= COOLDOWN_MS
        if (jolts.size >= JOLTS && cooled) return Step(State(emptyList(), t), true)
        return Step(State(jolts, state.lastShake), false)
    }
}

object FeedbackRules {
    const val MAX_MESSAGE = 4000

    /** Port of routePattern(): route words kept, ids / hanzi → `:id`, no query string. */
    fun routePattern(path: String): String {
        val clean = path.replace(Regex("[?#].*$"), "").trim()
        if (!clean.startsWith("/")) return "/"
        val segs = clean.split("/").filter { it.isNotEmpty() }.take(8)
        if (segs.isEmpty()) return "/"
        return "/" + segs.joinToString("/") { s -> if (s.startsWith(":") || ROUTE_WORD.matches(s)) s else ":id" }
    }

    private val ROUTE_WORD = Regex("^[a-z][a-z-]{0,39}$")

    private val PLATFORM_LABEL = mapOf("web" to "Web", "lab" to "Lab app", "vr" to "VR", "desktop" to "Desktop")

    /** Port of feedbackContextLine(): "Lab app 0.142 · /study · Pixel 10 Pro Fold · offline". */
    fun contextLine(platform: String?, appVersion: String?, screen: String?, device: String?, os: String?, online: Boolean?, via: String?): String {
        val parts = mutableListOf<String>()
        val label = platform?.let { PLATFORM_LABEL[it] }
        if (label != null) parts += if (appVersion != null) "$label $appVersion" else label
        else if (appVersion != null) parts += appVersion
        if (screen != null) parts += screen
        if (device != null) parts += device else if (os != null) parts += os
        if (online == false) parts += "offline"
        if (via == "shake") parts += "shaken"
        return parts.joinToString(" · ")
    }

    /** Port of FEEDBACK_COPY. */
    object Copy {
        const val TITLE = "Send feedback"
        const val BUG_CHIP = "🐛 Something’s wrong"
        const val IDEA_CHIP = "💡 Idea"
        const val PLACEHOLDER = "What happened, or what would make it better?"
        const val SCREENSHOT_ON = "Include screenshot"
        const val SCREENSHOT_NOTE = "The screenshot shows what was on your screen. Only you and the app’s admin can see it."
        const val SENT = "Thanks — sent."
        const val QUEUED = "Saved — it will be sent when you’re back online."
        const val SHAKE_SETTING = "Shake to send feedback"
    }
}
