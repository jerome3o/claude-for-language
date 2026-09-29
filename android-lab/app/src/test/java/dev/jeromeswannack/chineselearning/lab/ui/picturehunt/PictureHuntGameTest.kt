package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import dev.jeromeswannack.chineselearning.lab.core.HuntBox
import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.core.HuntRegion
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPlayDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The play state machine (web: PictureHuntPlayPage) — auto-check, Check, hints, give up, timer, reveal, play again. */
class PictureHuntGameTest {
    private fun obj(id: String, hanzi: String, pinyin: String, english: String, alternatives: List<String> = emptyList(), area: Double = 0.1) =
        HuntObject(id, hanzi, pinyin, english, alternatives, regions = listOf(HuntRegion(HuntBox(0.0, 0.0, area, 1.0))))

    private val objects = listOf(
        obj("cup", "茶杯", "chábēi", "cup", listOf("杯子")),
        obj("table", "桌子", "zhuōzi", "table", area = 0.4),
        obj("book", "书", "shū", "book"),
    )

    private class Fx : HuntFx {
        val log = mutableListOf<String>()
        override fun found() { log += "found" }
        override fun miss() { log += "miss" }
        override fun hint() { log += "hint" }
        override fun allFound() { log += "all" }
    }

    private var now = 1_000_000L
    private val plays = mutableListOf<PictureHuntPlayDto>()
    private val scheduled = mutableListOf<() -> Unit>()
    private var ids = 0

    private fun game(fx: HuntFx = Fx(), best: Int? = null) = PictureHuntGame(
        "h1", objects, best, clock = { now }, fx = fx,
        schedule = { _, block -> scheduled += block }, newId = { "play-${++ids}" }, onPlay = { plays += it },
    )

    @Test
    fun autoCheckTakesAFindAndIgnoresEverythingElse() {
        val fx = Fx()
        val g = game(fx)
        assertFalse(g.autoCheck("茶"))            // a near miss says nothing while typing
        assertNull(g.state.value.feedback)
        assertTrue(g.autoCheck("杯子"))
        assertEquals(listOf("cup"), g.state.value.found)
        assertEquals("✓ 茶杯 (also 杯子) · chábēi · cup", g.state.value.feedback?.text)
        assertEquals(listOf("found"), fx.log)
    }

    @Test
    fun checkExplainsMissesAndClearsAlreadyFound() {
        val fx = Fx()
        val g = game(fx)
        assertEquals(InputAfter.SELECT, g.submit("茶壶"))
        assertEquals("close", g.state.value.feedback?.tone)
        assertEquals("So close — something here has 茶 in its name", g.state.value.feedback?.text)
        assertEquals(InputAfter.SELECT, g.submit("zhuozi"))
        assertEquals("Right sound — add the tones, or type the characters", g.state.value.feedback?.text)
        assertEquals(InputAfter.CLEAR, g.submit("zhuo1zi5"))
        assertEquals(InputAfter.CLEAR, g.submit("桌子"))
        assertEquals("Already found 桌子", g.state.value.feedback?.text)
        assertEquals(InputAfter.SELECT, g.submit("狗"))
        assertEquals("Not one of the things I found — try another", g.state.value.feedback?.text)
        assertEquals(listOf("miss", "miss", "found", "miss"), fx.log)
    }

    @Test
    fun hintsGoToTheBiggestThenShowMoreAndClearWhenFound() {
        val g = game()
        g.hint()
        assertEquals(HuntHint("table", "桌＿"), g.state.value.hint)
        g.hint()
        assertEquals("cup", g.state.value.hint?.objectId) // least-hinted first
        g.hint(); g.hint()
        assertEquals(HuntHint("table", "桌＿ · zhuōzi"), g.state.value.hint)
        assertEquals(4, g.state.value.hintsUsed)
        g.autoCheck("桌子")
        assertNull(g.state.value.hint)
    }

    @Test
    fun allFoundRevealsAfterTheDelayAndRecordsOnePlay() {
        val fx = Fx()
        val g = game(fx, best = 1)
        g.autoCheck("茶杯"); g.hint(); g.autoCheck("桌子")
        now += 42_000
        g.autoCheck("书")
        assertEquals(HuntPhase.PLAYING, g.state.value.phase)
        assertEquals(1, scheduled.size)
        scheduled.single()()
        val s = g.state.value
        assertEquals(HuntPhase.REVEAL, s.phase)
        assertEquals(HuntEnd.ALL, s.end)
        assertTrue(s.newBest)
        assertEquals(3, s.best)
        val play = plays.single()
        assertEquals(PictureHuntPlayDto("play-1", "h1", listOf("cup", "table", "book"), 3, 1, false, 42_000, play.played_at), play)
        assertTrue(play.played_at.endsWith("Z"))
        assertTrue("all" in fx.log)
        g.giveUp() // no second record
        assertEquals(1, plays.size)
    }

    @Test
    fun giveUpAndTimerRevealAndPlayAgainStartsFresh() {
        val g = game(best = 2)
        g.autoCheck("书")
        g.giveUp()
        assertEquals(HuntEnd.GAVE_UP, g.state.value.end)
        assertTrue(plays.single().gave_up)
        assertFalse(g.state.value.newBest)
        assertEquals(2, g.state.value.best)
        assertFalse(g.autoCheck("桌子")) // nothing counts in reveal mode

        g.playAgain(2)
        assertEquals(HuntPhase.PLAYING, g.state.value.phase)
        assertTrue(g.state.value.found.isEmpty())
        now += 299_000
        g.tick()
        assertEquals("0:01", PictureHuntGame.formatClock(g.state.value.remainingSeconds))
        now += 1_000
        g.tick()
        assertEquals(HuntEnd.TIME, g.state.value.end)
        assertEquals(listOf("play-1", "play-2"), plays.map { it.id })
        assertTrue(plays[1].gave_up)
    }

    @Test
    fun clock() {
        assertEquals("5:00", PictureHuntGame.formatClock(300.0))
        assertEquals("5:00", PictureHuntGame.formatClock(299.2))
        assertEquals("0:00", PictureHuntGame.formatClock(-3.0))
        assertEquals("1:05", PictureHuntGame.formatClock(64.5))
    }
}
