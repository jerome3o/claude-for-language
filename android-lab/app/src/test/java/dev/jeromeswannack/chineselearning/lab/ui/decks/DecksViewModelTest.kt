package dev.jeromeswannack.chineselearning.lab.ui.decks

import android.os.Looper
import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import dev.jeromeswannack.chineselearning.lab.ui.cards.CardHubViewModel
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The Decks tab, deck page and card hub view models over a real (in-memory) Room mirror. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DecksViewModelTest {
    private lateinit var f: DecksFixture

    @Before fun setUp() = runBlocking { f = DecksFixture(); f.seed() }

    @After fun tearDown() = f.close()

    private fun await(what: String, timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idle()
            if (System.currentTimeMillis() > end) fail("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    @Test fun decksAreInQueueOrderWithDueCounts() {
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        val decks = vm.ui.value.decks
        assertEquals(listOf("d1", "d2", "d3"), decks.map { it.id })
        assertEquals(2, decks[0].noteCount)
        // 打算 has been reviewed: its un-reviewed audio card is a purple (secondary) new card.
        assertTrue(decks[0].counts.total > 0)
    }

    @Test fun aMoveResortsAtOnceAndIsSent() {
        f.server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        vm.move("d3", DeckQueue.Move.TOP)
        assertEquals(listOf("d3", "d1", "d2"), vm.ui.value.decks.map { it.id })
        await("request") { f.server.requestCount == 1 }
        assertEquals("/api/decks/d3/move", f.server.takeRequest().path)
        await("reload keeps the order") { runBlocking { f.db.dao().decks() }.maxBy { it.studyPriority }.id == "d3" }
        await("ui") { vm.ui.value.decks.first().id == "d3" }
    }

    @Test fun dragCommitReordersTheQueue() {
        f.server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        vm.commitOrder(listOf("d2", "d3", "d1"))
        assertEquals(listOf("d2", "d3", "d1"), vm.ui.value.decks.map { it.id })
        await("request") { f.server.requestCount == 1 }
        assertEquals("/api/decks/reorder", f.server.takeRequest().path)
    }

    @Test fun searchFindsTonelessPinyinLocallyWithoutAskingTheServer() {
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        vm.setQuery("yinhang", debounce = false)
        await("search") { vm.ui.value.search != null }
        val s = vm.ui.value.search!!
        assertEquals(listOf("银行"), s.results.map { it.hanzi })
        assertEquals("HSK 3 · Plans & time", s.results[0].deckName)
        assertNull(s.server)
        assertEquals(0, f.server.requestCount)

        vm.setQuery("周末", debounce = false) // the card sentence counts too
        await("clue search") { vm.ui.value.search?.results?.map { it.hanzi } == listOf("打算") }
        val ratings = vm.ui.value.search!!.results[0].ratings
        assertEquals(listOf(0, 2), ratings["hanzi_to_meaning"]) // most recent first
    }

    @Test fun nothingOnThePhoneAsksTheServer() {
        f.server.enqueue(MockResponse().setResponseCode(200).setBody("""{"notes":[{"id":"x","deck_id":"d9","hanzi":"海鲜","pinyin":"hǎixiān","english":"seafood","deck_name":"Restaurant"}],"total_notes":3012}"""))
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        vm.setQuery("haixian", debounce = false)
        await("server hits") { vm.ui.value.search?.server?.hits?.isNotEmpty() == true }
        assertEquals("/api/notes/search?q=haixian&limit=50", f.server.takeRequest().path)
        assertEquals(3012, vm.ui.value.search!!.server!!.totalNotes)
        assertEquals(4, vm.ui.value.search!!.localNotes)
    }

    @Test fun offlineSearchSaysSoWithoutTheServer() {
        f.online.value = false
        val vm = DecksViewModel(f.env)
        await("decks") { vm.ui.value.loaded }
        vm.setQuery("haixian", debounce = false)
        await("search") { vm.ui.value.search != null }
        assertTrue(vm.ui.value.search!!.results.isEmpty())
        assertNull(vm.ui.value.search!!.server)
        assertFalse(vm.ui.value.online)
    }

    @Test fun deckPageListsWordsByMasteryAndDeletesTheDeck() {
        val vm = DeckViewModel(f.env, "d1")
        await("deck") { vm.ui.value.loaded }
        val ui = vm.ui.value
        assertEquals("HSK 3 · Plans & time", ui.deck!!.name)
        assertEquals(setOf("打算", "银行"), ui.notes.map { it.hanzi }.toSet())
        assertEquals(listOf(0, 2), ui.notes.first { it.id == "n1" }.ratings["hanzi_to_meaning"])
        assertEquals(6, ui.completion.total)

        f.server.enqueue(MockResponse().setResponseCode(200).setBody("""{"success":true}"""))
        var gone = false
        vm.deleteDeck { gone = true }
        await("deleted") { gone }
        await("page says so") { vm.ui.value.loaded && vm.ui.value.deck == null }
    }

    @Test fun editorQueuesAnOfflineEditAndTheDeckPageShowsIt() {
        f.online.value = false
        val vm = DeckViewModel(f.env, "d1")
        await("deck") { vm.ui.value.loaded }
        vm.editor.openEdit("n2")
        await("editor") { vm.editor.state.value != null }
        vm.editor.save(vm.editor.state.value!!.initial.copy(english = "bank; the bank"))
        await("closed") { vm.editor.state.value == null }
        await("row updated") { vm.ui.value.notes.firstOrNull { it.id == "n2" }?.english == "bank; the bank" }
        assertTrue(vm.ui.value.notice!!.contains("back online"))
        assertEquals(1, runBlocking { f.outbox.pendingCount() })
    }

    @Test fun cardHubFallsBackToThePhoneOffline() {
        f.online.value = false
        val vm = CardHubViewModel(f.env, "n1")
        await("hub") { vm.ui.value.loaded && vm.ui.value.note != null }
        val ui = vm.ui.value
        assertEquals("打算", ui.note!!.hanzi)
        assertEquals("HSK 3 · Plans & time", ui.note!!.deckName)
        assertEquals(3, ui.cards.size)
        assertEquals(listOf("e3", "e2", "e1"), ui.reviews.map { it.id })
        assertFalse(ui.fromServer)
    }

    @Test fun cardHubShowsFlagsAndThreadsFromTheServer() {
        f.server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"note":{"id":"n1","deck_id":"d1","hanzi":"打算"},"deck":{"id":"d1","name":"HSK 3"},"cards":[],"recent_reviews":[],"review_count":3,
                "questions":[{"id":"q2","note_id":"n1","question":"b","answer":"B","asked_at":"2026-09-25 09:10:00"},{"id":"q1","note_id":"n1","question":"a","answer":"A","asked_at":"2026-09-25 09:00:00"},{"id":"q3","note_id":"n1","question":"c","answer":"C","asked_at":"2026-09-26 09:00:00"}],
                "flags":[{"id":"f1","message":"tone?","status":"open"}]}""",
            ),
        )
        val vm = CardHubViewModel(f.env, "n1")
        await("server hub") { vm.ui.value.fromServer }
        val ui = vm.ui.value
        assertEquals(listOf(listOf("q3"), listOf("q1", "q2")), ui.threads.map { t -> t.map { it.id } })
        assertEquals("tone?", ui.flags.single().message)
        assertEquals("/api/notes/n1/hub", f.server.takeRequest().path)
    }
}
