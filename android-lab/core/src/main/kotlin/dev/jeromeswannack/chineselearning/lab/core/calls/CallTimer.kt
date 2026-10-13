package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * Port of shared/calls/timer.ts — the call timer (Minghui, Oct 2026: "I sometimes need to time
 * students' tests").
 *
 * ONE timer per call, shared by both people: a countdown (1 / 2 / 3 / 5 / 10 min or a custom
 * length) or a stopwatch, with start / pause / reset. The CallRoom holds it in SERVER time
 * (`timer` messages, `welcome.timer`); each device turns it into its own clock with the room's
 * ping offset. The relationship's tutor controls it (solo: the caller); the student sees it
 * read-only. At zero both devices chime once per run ([shouldChimeTimer]) and the pill flashes.
 * The room runs [reduceTimer]; this app only sends actions ([actionMessage]).
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-timer.ts → CallsTimerParityTest).
 */
object CallTimer {
    enum class Mode(val wire: String) {
        COUNTDOWN("countdown"), STOPWATCH("stopwatch");

        companion object {
            fun of(wire: String?): Mode? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `CallTimer` — all times are the room's epoch ms. */
    data class Timer(
        val id: String,
        val mode: Mode,
        val durationMs: Long,
        val running: Boolean,
        val startedAt: Long?,
        val elapsedMs: Long,
        val v: Long,
        val run: Long,
        val by: String,
        val name: String,
    )

    /** `CallTimerAction`. */
    sealed interface Action {
        val kind: String

        data class Set(val mode: Mode, val durationMs: Long? = null, val start: Boolean = false) : Action {
            override val kind = "set"
        }
        data object Start : Action { override val kind = "start" }
        data object Pause : Action { override val kind = "pause" }
        data object Reset : Action { override val kind = "reset" }
        data object Clear : Action { override val kind = "clear" }
    }

    val TIMER_PRESET_MINUTES = listOf(1, 2, 3, 5, 10)
    const val MAX_TIMER_MS = 3L * 60 * 60 * 1000
    const val MIN_TIMER_MS = 5_000L
    const val TIMER_FLASH_MS = 6_000L

    fun canControlTimer(userId: String, tutorId: String?): Boolean = tutorId == null || userId == tutorId

    fun timerElapsed(t: Timer, now: Long): Long =
        maxOf(0L, t.elapsedMs + if (t.running && t.startedAt != null) maxOf(0L, now - t.startedAt) else 0L)

    fun timerShown(t: Timer, now: Long): Long {
        val e = timerElapsed(t, now)
        return if (t.mode == Mode.COUNTDOWN) maxOf(0L, t.durationMs - e) else e
    }

    fun timerDone(t: Timer, now: Long): Boolean = t.mode == Mode.COUNTDOWN && timerElapsed(t, now) >= t.durationMs

    fun timerEndsAt(t: Timer): Long? =
        if (t.mode != Mode.COUNTDOWN || !t.running || t.startedAt == null) null else t.startedAt + maxOf(0L, t.durationMs - t.elapsedMs)

    /** The room's next timer after [action] (the server's rule; here for tests and parity). */
    fun reduceTimer(cur: Timer?, action: Action, byUserId: String, byName: String, now: Long, newId: () -> String): Timer? = when (action) {
        Action.Clear -> null
        is Action.Set -> Timer(
            id = newId(), mode = action.mode,
            durationMs = if (action.mode == Mode.COUNTDOWN) action.durationMs ?: 0L else 0L,
            running = action.start, startedAt = if (action.start) now else null, elapsedMs = 0, v = 1, run = 1, by = byUserId, name = byName,
        )
        Action.Start -> when {
            cur == null || (cur.running && !timerDone(cur, now)) -> cur
            timerDone(cur, now) -> cur.copy(running = true, startedAt = now, elapsedMs = 0, v = cur.v + 1, run = cur.run + 1)
            else -> cur.copy(running = true, startedAt = now, v = cur.v + 1)
        }
        Action.Pause -> if (cur == null || !cur.running) cur else {
            val e = if (cur.mode == Mode.COUNTDOWN) minOf(cur.durationMs, timerElapsed(cur, now)) else timerElapsed(cur, now)
            cur.copy(running = false, startedAt = null, elapsedMs = e, v = cur.v + 1)
        }
        Action.Reset -> cur?.copy(running = false, startedAt = null, elapsedMs = 0, v = cur.v + 1, run = cur.run + 1)
    }

    /** `sanitizeTimer`: a room's timer from JSON (anything odd = none). */
    fun parse(el: JsonElement?): Timer? {
        val o = el as? JsonObject ?: return null
        val id = o.str("id") ?: return null
        val mode = Mode.of(o.str("mode")) ?: return null
        fun num(k: String): Long = (o[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }?.toLong() ?: 0L
        val runningFlag = (o["running"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
        val startedAt = (o["started_at"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toLong()
        val running = runningFlag && startedAt != null
        return Timer(
            id = id, mode = mode, durationMs = num("duration_ms"), running = running, startedAt = if (running) startedAt else null,
            elapsedMs = num("elapsed_ms"), v = num("v"), run = num("run"), by = o.str("by").orEmpty(), name = o.str("name").orEmpty(),
        )
    }

    /** The client → room message for [action]. */
    fun actionMessage(action: Action): String = buildJsonObject {
        put("type", "timer")
        put("action", buildJsonObject {
            put("kind", action.kind)
            if (action is Action.Set) {
                put("mode", action.mode.wire)
                if (action.mode == Mode.COUNTDOWN && action.durationMs != null) put("duration_ms", action.durationMs)
                if (action.start) put("start", true)
            }
        })
    }.toString()

    fun timerFinishKey(t: Timer): String = "${t.id}:${t.run}"

    fun shouldChimeTimer(t: Timer?, now: Long, chimed: String?, sawRunning: Boolean): Boolean =
        t != null && sawRunning && timerDone(t, now) && chimed != timerFinishKey(t)

    fun formatTimer(ms: Long, roundUp: Boolean = false): String {
        val m0 = maxOf(0L, ms)
        val s = if (roundUp) (m0 + 999) / 1000 else m0 / 1000
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        fun pad(n: Long) = if (n < 10) "0$n" else "$n"
        return if (h > 0) "$h:${pad(m)}:${pad(sec)}" else "$m:${pad(sec)}"
    }

    fun timerLabel(t: Timer, now: Long): String = formatTimer(timerShown(t, now), t.mode == Mode.COUNTDOWN)

    fun minutesLabel(ms: Long): String {
        val s = Js.round(ms / 1000.0).toLong()
        val m = s / 60
        val r = s % 60
        if (m == 0L) return "$r s"
        return if (r != 0L) "$m min $r s" else "$m min"
    }

    private val COLON = Regex("^(\\d{1,3}):([0-5]?\\d)$")
    private val MINUTES = Regex("^(\\d{1,3}(?:\\.\\d+)?)(?:m|min|mins|minutes?)?$")
    private val SECONDS = Regex("^(\\d{1,5})(?:s|sec|secs|seconds?)$")
    private val MIN_SEC = Regex("^(\\d{1,3})m(?:in)?(\\d{1,2})s(?:ec)?$")

    /** `parseTimerInput`: "7", "1:30", "90s", "2m", "2m30s" → ms (null = not a length the timer takes). */
    fun parseTimerInput(text: String): Long? {
        val t = text.trim().lowercase().replace(Regex("\\s+"), "")
        if (t.isEmpty()) return null
        val ms: Long? = COLON.find(t)?.let { (it.groupValues[1].toLong() * 60 + it.groupValues[2].toLong()) * 1000 }
            ?: MINUTES.find(t)?.let { Js.round(it.groupValues[1].toDouble() * 60).toLong() * 1000 }
            ?: SECONDS.find(t)?.let { it.groupValues[1].toLong() * 1000 }
            ?: MIN_SEC.find(t)?.let { (it.groupValues[1].toLong() * 60 + it.groupValues[2].toLong()) * 1000 }
        if (ms == null || ms < MIN_TIMER_MS || ms > MAX_TIMER_MS) return null
        return ms
    }

    const val TIMER_BUTTON_LABEL = "⏱ Timer"
    const val TIMER_UP_LABEL = "Time’s up"
    const val TIMER_COUNTDOWN_LABEL = "Countdown"
    const val TIMER_STOPWATCH_LABEL = "Stopwatch"

    private fun first(name: String): String = name.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: ""

    fun timerByLine(t: Timer, myUserId: String, now: Long): String {
        val who = if (t.by == myUserId) "You" else first(t.name).ifEmpty { "Your tutor" }
        if (timerDone(t, now)) {
            return if (t.mode == Mode.COUNTDOWN) "$TIMER_UP_LABEL · ${minutesLabel(t.durationMs)}" else TIMER_UP_LABEL
        }
        val what = if (t.mode == Mode.COUNTDOWN) "${minutesLabel(t.durationMs)} countdown" else "Stopwatch"
        val state = if (t.running) "" else if (timerElapsed(t, now) > 0) " · paused" else " · ready"
        return "$what$state · set by ${if (who == "You") "you" else who}"
    }

    fun timerAria(t: Timer, now: Long): String {
        if (timerDone(t, now)) return "Timer: $TIMER_UP_LABEL"
        return "${if (t.mode == Mode.COUNTDOWN) "Countdown" else "Stopwatch"} ${timerLabel(t, now)}${if (t.running) "" else ", paused"}"
    }

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
