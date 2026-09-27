package dev.jeromeswannack.chineselearning.lab.ui.quests

import dev.jeromeswannack.chineselearning.lab.core.QuestDirection.DOWN
import dev.jeromeswannack.chineselearning.lab.core.QuestDirection.LEFT
import dev.jeromeswannack.chineselearning.lab.core.QuestDirection.RIGHT
import dev.jeromeswannack.chineselearning.lab.core.QuestDirection.UP
import dev.jeromeswannack.chineselearning.lab.core.QuestPlayerAction
import dev.jeromeswannack.chineselearning.lab.core.QuestWorld
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

object SampleQuest {
    val world: QuestWorld by lazy {
        QuestWorld.parse(Json.parseToJsonElement(SampleQuest::class.java.getResourceAsStream("/quests/breakfast.json")!!.bufferedReader().readText()))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class QuestGameControllerTest {
    private class Fx : QuestFx {
        val log = mutableListOf<String>()
        override fun step() { log += "step" }
        override fun refused() { log += "refused" }
        override fun pickedUp() { log += "hands" }
        override fun goal() { log += "goal" }
        override fun finished() { log += "finished" }
        override fun speak(text: String) { log += "say:$text" }
    }

    @Test
    fun playsTheBreakfastLevelToTheEnd() = with(TestScope()) {
        val fx = Fx()
        var reported: Int? = null
        val c = QuestGameController(SampleQuest.world, this, fx) { reported = it }
        assertEquals("say:摸一摸猫。", fx.log.single(), "the first instruction is read aloud")

        c.move(RIGHT) // (5,3)
        c.move(RIGHT) // wall
        assertEquals("走不过去", c.toast?.hanzi)
        assertTrue(c.toast!!.bad)
        assertEquals(1, c.bumps)
        advanceTimeBy(QuestGameController.TOAST_BAD_MS + 1)
        assertNull(c.toast, "a refusal goes quickly")
        c.move(LEFT)

        c.act(QuestPlayerAction.Interact("cat", "pet"))
        assertEquals("猫很高兴！", c.toast?.hanzi)
        assertEquals(1, c.state.activeGoalIndex)
        advanceTimeBy(1300)
        assertEquals("say:先打开冰箱，然后拿鸡蛋。", fx.log.last(), "the next instruction follows the praise")

        listOf(UP, LEFT, LEFT, UP).forEach(c::move)
        c.act(QuestPlayerAction.PickUp("egg"))
        assertEquals("找不到", c.toast?.hanzi, "the egg is still hidden in the fridge")
        c.act(QuestPlayerAction.Interact("fridge", "open"))
        assertEquals(1 to 2, dev.jeromeswannack.chineselearning.lab.core.QuestEngine.activeGoalProgress(c.state))
        c.pickUpOrPutDown()
        assertEquals(listOf("egg"), c.state.held)
        assertEquals(2, c.state.activeGoalIndex)

        c.move(RIGHT)
        c.act(QuestPlayerAction.Interact("pan", "cook"))
        assertEquals(3, c.state.activeGoalIndex)
        c.pickUpOrPutDown() // puts the egg down
        c.move(DOWN); c.move(DOWN)
        c.act(QuestPlayerAction.PickUp("bread"))
        c.move(RIGHT); c.move(RIGHT); c.move(DOWN)
        assertFalse(c.state.finished)
        c.pickUpOrPutDown()
        assertTrue(c.state.finished)
        assertEquals(c.state.moves, reported)
        assertEquals("finished", fx.log.last { !it.startsWith("say:") })

        c.move(UP)
        assertEquals(reported, c.state.moves, "nothing moves after the finish")
        c.replay()
        assertEquals(0, c.state.moves)
        assertEquals("say:摸一摸猫。", fx.log.last())
    }
}
