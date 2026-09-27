package dev.jeromeswannack.chineselearning.lab.ui.quests

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.core.QuestDirection
import dev.jeromeswannack.chineselearning.lab.core.QuestEngine
import dev.jeromeswannack.chineselearning.lab.core.QuestPlayerAction
import dev.jeromeswannack.chineselearning.lab.core.QuestRejection
import dev.jeromeswannack.chineselearning.lab.core.QuestState
import dev.jeromeswannack.chineselearning.lab.core.QuestWorld
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A little message over the map: praise (sits long enough to read) or a refusal (quick). */
data class QuestToast(val hanzi: String, val sub: String? = null, val bad: Boolean = false, val key: Long = 0)

/** What to reveal under the Chinese (remembered per device, like the web's `quest-reveal`). */
data class QuestReveal(val pinyin: Boolean = false, val english: Boolean = false, val buttonPinyin: Boolean = false)

/** Game feel hooks — the screen wires them to haptics, sounds and speech. */
interface QuestFx {
    fun step() {}
    fun refused() {}
    fun pickedUp() {}
    fun goal() {}
    fun finished() {}
    fun speak(text: String) {}

    companion object { val None = object : QuestFx {} }
}

/**
 * One play-through of a quest world — the state machine is core's [QuestEngine] (parity-tested
 * against the web); this adds what QuestGame.tsx keeps around it: toasts in Chinese, the hint,
 * reading each new instruction aloud, reporting the finish once.
 */
class QuestGameController(
    val world: QuestWorld,
    private val scope: CoroutineScope,
    private val fx: QuestFx = QuestFx.None,
    private val onFinished: (moves: Int) -> Unit = {},
) {
    var state by mutableStateOf(QuestEngine.create(world))
        private set
    var toast by mutableStateOf<QuestToast?>(null)
        private set
    var showHint by mutableStateOf(false)
    /** Bumped when a move is refused, so the player sprite can bump against the wall. */
    var bumps by mutableIntStateOf(0)
        private set
    var lastDirection by mutableStateOf(QuestDirection.DOWN)
        private set

    private var toastJob: Job? = null
    private var spokenGoal: String? = null
    private var reported = false

    init {
        speakGoal()
        if (state.finished) report()
    }

    val goal get() = state.world.goals.getOrNull(state.activeGoalIndex)

    private fun flash(t: QuestToast) {
        toast = t.copy(key = System.nanoTime())
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(if (t.bad) TOAST_BAD_MS else TOAST_GOOD_MS)
            toast = null
        }
    }

    fun dismissToast() {
        toastJob?.cancel()
        toast = null
    }

    private fun speakGoal() {
        val g = goal ?: return
        if (spokenGoal == g.id) return
        spokenGoal = g.id
        fx.speak(g.instruction.hanzi)
    }

    fun act(action: QuestPlayerAction) {
        if (state.finished) return
        if (action is QuestPlayerAction.Move) lastDirection = action.direction
        val before = state
        val result = QuestEngine.apply(before, action)
        if (!result.ok) {
            val reason = REJECTION_TEXT.getValue(result.rejection ?: QuestRejection.ACTION_UNAVAILABLE)
            flash(QuestToast(reason.first, reason.second, bad = true))
            bumps++
            fx.refused()
            return
        }
        state = result.state
        when (action) {
            is QuestPlayerAction.Move -> fx.step()
            is QuestPlayerAction.PickUp, is QuestPlayerAction.PutDown -> fx.pickedUp()
            is QuestPlayerAction.Interact -> fx.pickedUp()
        }
        if (result.completedGoals.isNotEmpty()) {
            val done = before.world.goals.firstOrNull { it.id == result.completedGoals[0] }
            val success = done?.success
            flash(QuestToast(success?.hanzi?.ifBlank { null } ?: "做对了！", success?.english?.ifBlank { null } ?: "Nicely done"))
            fx.speak(success?.hanzi?.ifBlank { null } ?: "做对了")
            if (state.finished) fx.finished() else fx.goal()
            showHint = false
        }
        if (state.activeGoalIndex != before.activeGoalIndex) showHint = false
        if (state.finished) report() else if (result.completedGoals.isNotEmpty()) scope.launch {
            // Let the praise be heard before the next instruction.
            delay(1200)
            speakGoal()
        } else speakGoal()
    }

    fun speakInstruction() {
        goal?.let { fx.speak(it.instruction.hanzi) }
    }

    fun move(d: QuestDirection) = act(QuestPlayerAction.Move(d))

    /** Space bar / the hands chip: put down what's held, else pick up the nearest portable thing. */
    fun pickUpOrPutDown() {
        val held = QuestEngine.heldObjects(state).firstOrNull()
        if (held != null) return act(QuestPlayerAction.PutDown(held.id))
        val target = QuestEngine.objectsInReach(state).firstOrNull { it.portable } ?: return
        act(QuestPlayerAction.PickUp(target.id))
    }

    private fun report() {
        if (reported) return
        reported = true
        onFinished(state.moves)
    }

    fun replay() {
        reported = false
        spokenGoal = null
        showHint = false
        dismissToast()
        state = QuestEngine.reset(state)
        speakGoal()
    }

    companion object {
        const val TOAST_GOOD_MS = 4500L
        const val TOAST_BAD_MS = 1800L

        /** The web's REJECTION_TEXT: Chinese nudges for a move the world refused. */
        val REJECTION_TEXT = mapOf(
            QuestRejection.BLOCKED to ("走不过去" to "can't get through"),
            QuestRejection.OUT_OF_BOUNDS to ("到边儿了" to "that's the edge of the map"),
            QuestRejection.OUT_OF_REACH to ("太远了" to "too far away — walk closer"),
            QuestRejection.NOT_PORTABLE to ("拿不起来" to "you can't pick that up"),
            QuestRejection.HANDS_FULL to ("手里满了" to "your hands are full"),
            QuestRejection.NOT_HELD to ("你没拿着" to "you're not holding that"),
            QuestRejection.UNKNOWN_OBJECT to ("找不到" to "that's not here"),
            QuestRejection.UNKNOWN_ACTION to ("做不了" to "you can't do that"),
            QuestRejection.ACTION_UNAVAILABLE to ("现在不行" to "not right now"),
        )
    }
}

object QuestPrefs {
    private fun p(c: Context) = c.getSharedPreferences("lab-quests", Context.MODE_PRIVATE)
    fun reveal(c: Context) = p(c).let { QuestReveal(it.getBoolean("pinyin", false), it.getBoolean("english", false), it.getBoolean("buttonPinyin", false)) }
    fun setReveal(c: Context, r: QuestReveal) = p(c).edit().putBoolean("pinyin", r.pinyin).putBoolean("english", r.english).putBoolean("buttonPinyin", r.buttonPinyin).apply()
}

/** Whether [s] allows one more thing in the hands (the web's pickable filter). */
internal fun handsFree(s: QuestState) = s.held.size < maxOf(1, s.world.carryLimit)
