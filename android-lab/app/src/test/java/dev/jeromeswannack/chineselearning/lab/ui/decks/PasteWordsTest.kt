package dev.jeromeswannack.chineselearning.lab.ui.decks

import android.os.Looper
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
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
import java.util.Collections

/** "Paste a list": the effective rows / plan (pure) and the whole flow against a fake server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PasteWordsTest {
    private lateinit var f: DecksFixture
    private val fakePinyin: (String) -> String = { h -> mapOf("银行" to "yín háng", "葡萄" to "pú táo", "面包" to "miàn bāo").getOrDefault(h, "?") }
    private val requests = Collections.synchronizedList(ArrayList<Pair<String, String>>())

    @Before fun setUp() = runBlocking {
        f = DecksFixture()
        f.seed()
        f.server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                val body = request.body.readUtf8()
                requests += path to body
                return when {
                    path == "/api/ai/gloss-words" -> MockResponse().setBody("""{"words":[{"hanzi":"葡萄","pinyin":"pútao","english":"grape"}]}""")
                    path == "/api/ai/enrich-words" -> MockResponse().setBody(
                        """{"words":[{"hanzi":"葡萄","fun_facts":"葡 + 萄: one word","sentence_clue":"我喜欢吃葡萄。","sentence_clue_pinyin":"Wǒ xǐhuan chī pútao.","sentence_clue_translation":"I like grapes."}]}""",
                    )
                    path.startsWith("/api/decks/d1/notes") -> {
                        val hanzi = Json.parseToJsonElement(body).jsonObject["hanzi"]!!.jsonPrimitive.content
                        if (hanzi == "坏") MockResponse().setResponseCode(400).setBody("""{"error":"english is required"}""")
                        else MockResponse().setResponseCode(201).setBody("""{"id":"new-$hanzi","deck_id":"d1","hanzi":"$hanzi","cards":[]}""")
                    }
                    path == "/api/notes/n2" -> MockResponse().setBody("""{"id":"n2","deck_id":"d1","hanzi":"银行","pinyin":"yínháng","english":"bank; the bank"}""")
                    path == "/api/decks/d1/student-shares" -> MockResponse().setBody("""{"shares":[{"shared_deck_id":"s1","relationship_id":"r1","student_name":"小明","notes_missing":2}]}""")
                    path == "/api/relationships/r1/shared-decks/s1/update" -> MockResponse().setBody("""{"added":2,"updated":1}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @After fun tearDown() = f.close()

    private fun await(what: String, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + 5_000
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idle()
            if (System.currentTimeMillis() > end) fail("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    @Test fun effectiveRowsFillPinyinOnThePhoneAndMatchExistingNotes() {
        val existing = listOf(ImportPlanner.Existing("n2", "银行", "yínháng", "bank"))
        val d = PasteWordsModel.derive(PasteInputs(text = "银行\tyínháng\tbank; the bank\n葡萄\n面包 bread"), existing, fakePinyin)
        assertEquals(listOf("update", "problem", "add"), d.plan.map { it.action.wire })
        val grape = d.rows[1]
        assertEquals("pú táo", grape.row.pinyin)
        assertTrue(grape.filled.pinyin)
        assertEquals(listOf("english"), d.plan[1].missing)
        assertEquals(1, d.missingEnglish)
        assertEquals(mapOf("english" to "bank; the bank"), PasteWordsModel.patchFor(d.plan[0]))
        assertEquals("Add 1 · Update 1", PasteWordsModel.saveLabel(d.summary))
        assertEquals("1 new · 1 to update · 1 need attention", PasteWordsModel.summaryLine(d.summary))
        assertEquals("spaces between word, pinyin and meaning · 3 rows", d.detectedCaption) // one tab line in three is not a table
    }

    @Test fun aOneCharacterWordFilledOnThePhoneAsksToCheckItsReading() {
        val d = PasteWordsModel.derive(PasteInputs(text = "行\n长 zhǎng\n你\n银行"), emptyList(), dev.jeromeswannack.chineselearning.lab.core.Pinyin::toPinyin)
        val byHanzi = d.rows.associateBy { it.row.hanzi }
        assertEquals(listOf("xíng", "háng", "hàng", "héng"), byHanzi["行"]!!.readings)
        assertEquals(emptyList<String>(), byHanzi["长"]!!.readings) // pasted pinyin: nothing to check
        assertEquals(emptyList<String>(), byHanzi["你"]!!.readings) // one reading
        assertEquals(emptyList<String>(), byHanzi["银行"]!!.readings) // words only for one character
    }

    @Test fun editsAndSkipsWinOverEverything() {
        val base = PasteInputs(text = "葡萄\n面包 bread")
        val key = "葡萄"
        val d = PasteWordsModel.derive(base.copy(edits = mapOf(key to RowEdit(english = "grapes", pinyin = "pútao"))), emptyList(), fakePinyin)
        assertEquals("pútao", d.rows[0].row.pinyin)
        assertFalse(d.rows[0].filled.pinyin)
        assertEquals("add", d.plan[0].action.wire)
        val skipped = PasteWordsModel.derive(base.copy(excluded = setOf("面包")), emptyList(), fakePinyin)
        assertEquals("excluded", skipped.plan[1].reason)
    }

    @Test fun glossEnrichSaveAndUpdateTheirCopy() {
        val vm = PasteWordsViewModel(f.env, "d1", fakePinyin)
        await("existing notes") { vm.ui.value.deckName.isNotEmpty() }
        vm.setText("银行\tyínháng\tbank; the bank\n葡萄\n坏 bad")
        assertEquals(1, vm.ui.value.derived!!.missingEnglish)

        vm.fillWithClaude()
        await("gloss") { vm.ui.value.gloss == AiStep.IDLE && vm.ui.value.glossedText != null }
        val grape = vm.ui.value.derived!!.rows.first { it.key == "葡萄" }
        assertEquals("grape", grape.row.english)
        assertTrue(grape.filled.english)

        // 葡萄 and 坏 have no explanation; 银行 is an update without one either.
        assertTrue(vm.ui.value.derived!!.enrichable.any { it.row.hanzi == "葡萄" })
        vm.writeWithClaude()
        await("enrich") { vm.ui.value.enrich == AiStep.IDLE && vm.ui.value.enrichedText != null }
        val enriched = vm.ui.value.derived!!.rows.first { it.key == "葡萄" }
        assertEquals("我喜欢吃葡萄。", enriched.row.sentence)
        assertTrue(enriched.filled.sentence && enriched.filled.notes)
        assertEquals("Wǒ xǐhuan chī pútao.", enriched.row.sentencePinyin)

        vm.save()
        await("done") { vm.ui.value.stage == PasteStage.DONE }
        val o = vm.ui.value.outcome!!
        assertEquals(1, o.added) // 葡萄; 坏 is refused by the server
        assertEquals(1, o.updated)
        assertEquals(listOf("坏" to "english is required"), o.failed)
        val grapePost = requests.first { it.first == "/api/decks/d1/notes" && it.second.contains("葡萄") }.second
        val sent = Json.parseToJsonElement(grapePost).jsonObject
        assertEquals("我喜欢吃葡萄。", sent["sentence_clue"]!!.jsonPrimitive.content)
        assertEquals("I like grapes.", sent["sentence_clue_translation"]!!.jsonPrimitive.content)
        val put = requests.first { it.first == "/api/notes/n2" }.second
        assertEquals(setOf("english"), Json.parseToJsonElement(put).jsonObject.keys) // only what changed
        assertEquals("bank; the bank", runBlocking { f.db.dao().note("n2")!!.english })

        await("shares") { vm.ui.value.shares.isNotEmpty() }
        vm.updateShare(vm.ui.value.shares.single())
        await("share updated") { vm.ui.value.shareState["s1"]?.note != null }
        assertEquals("added 2, updated 1 — their progress is kept", vm.ui.value.shareState["s1"]!!.note)
    }

    @Test fun savingNeedsAConnection() {
        f.online.value = false
        val vm = PasteWordsViewModel(f.env, "d1", fakePinyin)
        await("loaded") { vm.ui.value.deckName.isNotEmpty() }
        vm.setText("面包 miànbāo bread")
        assertFalse(vm.ui.value.canSave)
        vm.save()
        assertEquals(PasteStage.EDIT, vm.ui.value.stage)
        assertNull(vm.ui.value.outcome)
    }

    @Test fun generateMirrorsTheNewDeck() {
        f.server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(201).setBody(
                """{"deck":{"id":"g1","name":"At the zoo","created_at":"2026-09-27T10:00:00Z"},"notes":[{"id":"z1","deck_id":"g1","hanzi":"熊猫","pinyin":"xióngmāo","english":"panda","cards":[{"id":"z1a","note_id":"z1","card_type":"hanzi_to_meaning"}]}]}""",
            )
        }
        val vm = GenerateDeckViewModel(f.env)
        vm.setPrompt("Animals at the zoo")
        vm.generate()
        await("generated") { vm.ui.value.result != null }
        assertEquals("At the zoo", vm.ui.value.result!!.deckName)
        val dao = f.db.dao()
        assertTrue(runBlocking { dao.decks() }.any { it.id == "g1" })
        assertEquals("熊猫", runBlocking { dao.note("z1") }!!.hanzi)
        assertEquals(1, runBlocking { dao.cards() }.count { it.noteId == "z1" })
    }
}
