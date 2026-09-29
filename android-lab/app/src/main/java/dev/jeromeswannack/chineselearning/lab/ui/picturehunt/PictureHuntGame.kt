package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import dev.jeromeswannack.chineselearning.lab.core.HuntFeedback
import dev.jeromeswannack.chineselearning.lab.core.HuntMatch
import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.PICTURE_HUNT_DEFAULT_SECONDS
import dev.jeromeswannack.chineselearning.lab.core.PictureHuntFeedback
import dev.jeromeswannack.chineselearning.lab.core.PictureHuntMatch
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPlayDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID

enum class HuntPhase { PLAYING, REVEAL }

/** Why the hunt went to reveal mode (web: EndReason 'all' | 'time' | 'gave_up'). */
enum class HuntEnd { ALL, TIME, GAVE_UP }

data class HuntHint(val objectId: String, val text: String)

/** Everything the play screen shows about the game (not the picture / text field). */
data class HuntPlayState(
    val phase: HuntPhase = HuntPhase.PLAYING,
    val end: HuntEnd? = null,
    /** Found object ids, in the order they were found. */
    val found: List<String> = emptyList(),
    val lastFound: String? = null,
    val hints: Map<String, Int> = emptyMap(),
    val hintsUsed: Int = 0,
    val hint: HuntHint? = null,
    val feedback: HuntFeedback? = null,
    val remainingSeconds: Double = PICTURE_HUNT_DEFAULT_SECONDS.toDouble(),
    /** The personal best before this play-through. */
    val bestBefore: Int? = null,
) {
    val foundSet: Set<String> get() = found.toSet()

    /** "Best N / M." after the reveal (the web's `best`). */
    val best: Int get() = maxOf(bestBefore ?: 0, if (phase == HuntPhase.REVEAL) found.size else 0)

    /** 🏆 New best! */
    val newBest: Boolean get() = phase == HuntPhase.REVEAL && found.isNotEmpty() && found.size > (bestBefore ?: 0)
}

/** What the text field should do after a check. */
enum class InputAfter { CLEAR, SELECT, KEEP }

/** The moments that should feel good (haptics / sounds), so the game stays testable. */
interface HuntFx {
    fun found() {}
    fun miss() {}
    fun hint() {}
    fun allFound() {}
}

/**
 * The play state machine — a port of PictureHuntPlayPage's game logic: auto-check of every
 * committed value, Check / Enter, hints, give up, the soft timer, reveal, play again. The
 * play is recorded ONCE when reveal starts ([onPlay]); "all found" waits [allFoundDelayMs]
 * (via [schedule]) so the last outline lights up before the reveal.
 */
class PictureHuntGame(
    private val huntId: String,
    private val objects: List<HuntObject>,
    bestBefore: Int?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val fx: HuntFx = object : HuntFx {},
    private val schedule: (delayMs: Long, block: () -> Unit) -> Unit = { _, block -> block() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val onPlay: (PictureHuntPlayDto) -> Unit = {},
) {
    private val _state = MutableStateFlow(HuntPlayState(bestBefore = bestBefore))
    val state: StateFlow<HuntPlayState> = _state.asStateFlow()

    private var startedAt = clock()
    private var playId = newId()
    private var recorded = false

    val total: Int get() = objects.size

    private fun accept(objectId: String, fb: HuntFeedback?) {
        val next = _state.value.found + objectId
        _state.update { s -> s.copy(found = next, lastFound = objectId, feedback = fb, hint = if (s.hint?.objectId == objectId) null else s.hint) }
        fx.found()
        if (next.size == total) {
            fx.allFound()
            schedule(ALL_FOUND_DELAY_MS) { endGame(HuntEnd.ALL) }
        }
    }

    /** Every committed value is checked; a find is taken at once (no Enter needed with an IME). True = clear the field. */
    fun autoCheck(text: String): Boolean {
        if (_state.value.phase != HuntPhase.PLAYING) return false
        val m = PictureHuntMatch.match(text, objects, _state.value.found)
        if (m is HuntMatch.Found) {
            accept(m.objectId, PictureHuntFeedback.of(m, objects))
            return true
        }
        return false
    }

    /** Check / Enter: a find is accepted; anything else says why. */
    fun submit(text: String): InputAfter {
        if (_state.value.phase != HuntPhase.PLAYING) return InputAfter.KEEP
        val m = PictureHuntMatch.match(text, objects, _state.value.found)
        if (m is HuntMatch.Found) {
            accept(m.objectId, PictureHuntFeedback.of(m, objects))
            return InputAfter.CLEAR
        }
        _state.update { it.copy(feedback = PictureHuntFeedback.of(m, objects)) }
        if (m is HuntMatch.Close || m is HuntMatch.None) fx.miss()
        return if (m is HuntMatch.Already) InputAfter.CLEAR else InputAfter.SELECT
    }

    /** 💡 Hint: the least-hinted, biggest object not found; each hint on it shows more. */
    fun hint() {
        val s = _state.value
        if (s.phase != HuntPhase.PLAYING) return
        val target = PictureHuntMatch.pickHintTarget(objects, s.found, s.hints) ?: return
        val level = (s.hints[target.id] ?: 0) + 1
        _state.update { it.copy(hints = it.hints + (target.id to level), hintsUsed = it.hintsUsed + 1, hint = HuntHint(target.id, PictureHuntMatch.hintText(target, level))) }
        fx.hint()
    }

    fun giveUp() = endGame(HuntEnd.GAVE_UP)

    /** The soft timer (called every ~500 ms while playing): at 0 everything is revealed. */
    fun tick() {
        if (_state.value.phase != HuntPhase.PLAYING) return
        val left = PICTURE_HUNT_DEFAULT_SECONDS - (clock() - startedAt) / 1000.0
        _state.update { it.copy(remainingSeconds = left) }
        if (left <= 0) endGame(HuntEnd.TIME)
    }

    private fun endGame(reason: HuntEnd) {
        val s = _state.value
        if (s.phase == HuntPhase.REVEAL) return
        _state.update { it.copy(phase = HuntPhase.REVEAL, end = reason, hint = null) }
        if (recorded) return
        recorded = true
        val now = clock()
        onPlay(
            PictureHuntPlayDto(
                id = playId,
                hunt_id = huntId,
                found_ids = s.found,
                total = total,
                hints_used = s.hintsUsed,
                gave_up = reason != HuntEnd.ALL,
                duration_ms = now - startedAt,
                played_at = Js.toIsoString(now),
            ),
        )
    }

    /** ↻ Play again — a fresh play-through (new play id) against the best so far. */
    fun playAgain(bestBefore: Int?) {
        startedAt = clock()
        playId = newId()
        recorded = false
        _state.value = HuntPlayState(bestBefore = bestBefore)
    }

    companion object {
        const val ALL_FOUND_DELAY_MS = 600L

        /** `formatClock`: "4:59", never negative. */
        fun formatClock(seconds: Double): String {
            val s = maxOf(0, Math.ceil(seconds).toInt())
            return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
        }
    }
}
