package dev.jeromeswannack.chineselearning.lab

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.Collections
import kotlin.random.Random
import kotlin.test.assertTrue

/**
 * Cold start of the signed-in app on an account shaped like Jerome's (26 decks, ~3000 notes,
 * ~9000 cards, ~35 000 review events, sentences, non-BMP characters, empty decks): the
 * activity, the shell, Home and the background start-up work must not throw anywhere.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = LabApp::class)
class ColdStartTest {
    private lateinit var app: LabApp
    private val errors = Collections.synchronizedList(ArrayList<Throwable>())
    private var previous: Thread.UncaughtExceptionHandler? = null

    @Before
    fun setUp() {
        previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, e -> errors += e }
        app = ApplicationProvider.getApplicationContext()
        dev.jeromeswannack.chineselearning.lab.data.CrashLog.clear(app)
        app.prefs.sessionToken = "test-session"
        app.prefs.budget = StudyBudget(5, 10)
        app.prefs.userName = "Jerome"
        app.prefs.accountRole = "student"
        app.prefs.landingPage = "study"
        runBlocking {
            seed()
            dev.jeromeswannack.chineselearning.lab.ui.today.TodaySplitStudyTest.seedExtras(app, 3)
        }
    }

    @After
    fun tearDown() {
        Thread.setDefaultUncaughtExceptionHandler(previous)
    }

    private suspend fun seed() {
        val rnd = Random(7)
        val now = System.currentTimeMillis()
        val day = 86_400_000L
        val dao = app.repo.dao
        val decks = (0 until 26).map { DeckEntity("d$it", "Deck $it", null, if (it % 5 == 0) 0 else 3, if (it % 7 == 0) null else 6, 26 - it, "2026-0${1 + it % 9}-01T00:00:00.000Z") }
        dao.upsertDecks(decks)
        fun han(): String = buildString { appendCodePoint(0x4e00 + rnd.nextInt(0x5000)) }
        val extras = listOf("𠮷", "𩸽", "😀", "A", " ", "。", "？", "…", "/", "（", "）")
        val notes = (0 until 3037).map { i ->
            val deck = if (i < 3000) decks[1 + i % 23].id else decks[24].id // d0 and d25 stay empty
            val hanzi = when {
                i % 97 == 0 -> extras[i % extras.size] + han()
                i % 13 == 0 -> (0 until 8 + rnd.nextInt(20)).joinToString("") { han() } + "。"
                else -> (0 until 1 + rnd.nextInt(4)).joinToString("") { han() }
            }
            NoteEntity("n$i", deck, hanzi, "pīn", "meaning $i", null, null, null, null, null, null, null, null, null)
        }
        dao.upsertNotes(notes)
        val types = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")
        val cards = notes.flatMap { n -> types.map { t -> CardEntity("${n.id}-$t", n.id, n.deckId, t) } }
        dao.insertCardsIfMissing(cards)
        val events = ArrayList<ReviewEventEntity>()
        val byCard = HashMap<String, List<ReviewEventEntity>>()
        for ((i, c) in cards.withIndex()) {
            if (i % 3 == 2 && i > 6000) continue
            if (i > 7400) continue
            val k = 1 + rnd.nextInt(8)
            var t = now - (30 + rnd.nextInt(200)) * day
            val list = (0 until k).map { j ->
                t += (1 + rnd.nextInt(20)) * day
                ReviewEventEntity("e-${c.id}-$j", c.id, rnd.nextInt(4).coerceAtLeast(if (j > 2) 2 else 0), Js.toIsoString(minOf(t, now - 3600_000L)), 4000, null, synced = true)
            }
            events += list
            byCard[c.id] = list
        }
        events.chunked(2000).forEach { dao.insertEvents(it) }
        val withState = cards.map { c ->
            val evs = byCard[c.id] ?: return@map c
            c.withState(CardScheduler.computeCardState(evs.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) }))
        }
        withState.chunked(2000).forEach { dao.upsertCards(it) }
    }

    @Test
    fun signedInColdStartDoesNotCrash() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(25)
        }
        controller.pause().stop().destroy()
        assertNothingFailed("cold start")
    }

    /**
     * The v0.357–v0.360 "closes on every open": a readers list over 2 MB (Jerome: 38 readers,
     * 1.4 MB of vocabulary lists + 0.5 MB of word chips) left in json_cache by the background
     * sync. Reading that row threw SQLiteBlobTooBigException in Home's readers flow.
     */
    @Test
    fun coldStartWithAReadersListBiggerThanACursorWindowDoesNotCrash() {
        runBlocking {
            val readers = (0 until 38).map { r ->
                dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto(
                    id = "r$r", titleChinese = "小明在巴黎 $r", titleEnglish = "Xiaoming in Paris $r", status = "ready", createdAt = "2026-09-${10 + r % 20}T09:00:00.000Z",
                    vocabularyUsed = (0 until 600).map { v -> dev.jeromeswannack.chineselearning.lab.data.api.VocabItemDto("实际上$v", "shí jì shàng", "in fact; actually; in reality") },
                    pages = (0 until 6).map { p ->
                        dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto(
                            "r$r-p$p", p + 1, "小明坐在靠窗的座位上，看着外面的雨。", "Xiǎo Míng zuò zài kào chuāng de zuòwèi shang.", "Xiaoming sits by the window watching the rain.",
                            words = (0 until 40).map { w -> dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto("座位$w", "zuòwèi", "seat") },
                        )
                    },
                )
            }
            val text = app.cache.json.encodeToString(kotlinx.serialization.builtins.ListSerializer(dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto.serializer()), readers)
            assertTrue(text.toByteArray().size > 2_200_000, "bigger than a CursorWindow: ${text.toByteArray().size}")
            // Written the way the old build left it: the whole document in the row.
            app.repo.platform.dao.putCache(listOf(dev.jeromeswannack.chineselearning.lab.data.platform.JsonCacheEntity("readers/list", "readers", text, System.currentTimeMillis())))
        }
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(25)
        }
        controller.pause().stop().destroy()
        assertNothingFailed("cold start with a 2 MB+ readers list")
        val back = runBlocking { app.cache.get("readers/list", kotlinx.serialization.builtins.ListSerializer(dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto.serializer())) }
        assertTrue(back?.size == 38, "the readers survived (moved to a file): ${back?.size}")
    }

    /** Opening the app from the widget's / a card notification's Study: the real study screen draws on this data. */
    @Test
    fun coldStartStraightIntoStudyDoesNotCrash() {
        val intent = android.content.Intent(app, MainActivity::class.java).putExtra(dev.jeromeswannack.chineselearning.lab.shell.ShellLinks.EXTRA_ROUTE, dev.jeromeswannack.chineselearning.lab.shell.ShellLinks.STUDY)
        val controller = Robolectric.buildActivity(MainActivity::class.java, intent).setup()
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(25)
        }
        controller.pause().stop().destroy()
        assertNothingFailed("study from the widget")
    }

    @Test
    fun studySessionOnThisDataRates() {
        val vm = dev.jeromeswannack.chineselearning.lab.ui.study.StudyViewModel(app, null)
        var rated = 0
        repeat(40) {
            var u = vm.ui.value
            repeat(400) {
                shadowOf(Looper.getMainLooper()).idle()
                u = vm.ui.value
                if (u.phase is dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase.Showing || u.phase is dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase.Extras || u.phase is dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase.Done) return@repeat
                Thread.sleep(10)
            }
            if (u.phase !is dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase.Showing) return@repeat
            vm.rate(dev.jeromeswannack.chineselearning.lab.core.Rating.GOOD, 2_000, null)
            rated++
        }
        assertNothingFailed("study")
        assertTrue(rated > 10, "rated only $rated")
    }

    /** Nothing crashed, and nothing was caught and reported as a non-fatal either (CrashLog). */
    private fun assertNothingFailed(what: String) {
        errors.forEach { it.printStackTrace() }
        assertTrue(errors.isEmpty(), "$what threw: ${errors.map { it.toString() }}")
        val reported = dev.jeromeswannack.chineselearning.lab.data.CrashLog.pending(app)
        assertTrue(reported.isEmpty(), "$what reported failures: $reported")
    }
}
