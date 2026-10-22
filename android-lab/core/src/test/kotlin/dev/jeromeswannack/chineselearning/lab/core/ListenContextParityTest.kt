package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** ListenContext.kt reproduces shared/study/listenContext.ts exactly (parity/fixtures/listen-context.ts). */
class ListenContextParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "listen-context.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun int(e: JsonElement?): Int? = if (e == null || e is JsonNull) null else e.jsonPrimitive.int

    private fun autoplayWire(a: ListenContext.Autoplay): String = when (a) {
        is ListenContext.Autoplay.Sentence -> "sentence:${a.index}"
        ListenContext.Autoplay.Word -> "word"
        ListenContext.Autoplay.None -> "none"
    }

    private fun autoplayWire(o: JsonObject): String {
        val kind = o["kind"]!!.jsonPrimitive.content
        return if (kind == "sentence") "sentence:${o["index"]!!.jsonPrimitive.int}" else kind
    }

    @Test
    fun rowsStatesAutoplayAndCountsMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        var prompts = 0
        var sentenceAutoplays = 0
        for (c in cases) {
            val noteId = c["noteId"]!!.jsonPrimitive.content
            val clue = (c["clue"] as? JsonObject)?.let { ListenContext.Clue(str(it["hanzi"]), str(it["translation"]), str(it["audio_url"])) }
            val sentences = c["sentences"]!!.jsonArray.map { it.jsonObject }.map {
                ListenContext.Sentence(it["id"]!!.jsonPrimitive.content, it["hanzi"]!!.jsonPrimitive.content, str(it["translation"]), str(it["audio_url"]), int(it["position"]))
            }
            val rows = ListenContext.rows(noteId, clue, sentences)
            val expected = c["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, rows.size, "rows of $noteId")
            expected.zip(rows).forEach { (e, row) ->
                assertEquals(e["key"]!!.jsonPrimitive.content, row.key)
                assertEquals(str(e["sentenceId"]), row.sentenceId)
                assertEquals(e["hanzi"]!!.jsonPrimitive.content, row.hanzi)
                assertEquals(str(e["translation"]), row.translation, "translation of ${row.key}")
                assertEquals(str(e["audioUrl"]), row.audioUrl)
                assertEquals(e["fromCard"]!!.jsonPrimitive.boolean, row.fromCard)
            }
            val online = c["online"]!!.jsonPrimitive.boolean
            val cached = c["cached"]!!.jsonArray.map { it.jsonPrimitive.boolean }
            val states = rows.mapIndexed { i, row -> ListenContext.rowState(row.audioUrl, row.sentenceId, online, cached[i]) }
            assertEquals(c["states"]!!.jsonArray.map { it.jsonPrimitive.content }, states.map { it.wire }, "states of $noteId")
            assertEquals(autoplayWire(c["autoplayOn"]!!.jsonObject), autoplayWire(ListenContext.autoplay(true, states)))
            assertEquals(autoplayWire(c["autoplayOff"]!!.jsonObject), autoplayWire(ListenContext.autoplay(false, states)))
            if (ListenContext.autoplay(true, states) is ListenContext.Autoplay.Sentence) sentenceAutoplays++
            val tap = ListenContext.wordTap(c["played"]!!.jsonPrimitive.int, states.count(ListenContext::isPlayable), c["anyway"]!!.jsonPrimitive.boolean)
            assertEquals(c["wordTap"]!!.jsonPrimitive.content, tap.name.lowercase())
            if (tap == ListenContext.WordTap.PROMPT) prompts++
            val total = c["total"]!!.jsonPrimitive.int
            assertEquals(total, rows.size)
            assertEquals(c["needsTopUp"]!!.jsonPrimitive.boolean, ListenContext.needsTopUp(total))
            assertEquals(c["topUpCount"]!!.jsonPrimitive.int, ListenContext.topUpCount(total))
            assertEquals(c["moreCount"]!!.jsonPrimitive.int, ListenContext.moreCount(total))
            c["labels"]!!.jsonArray.forEachIndexed { i, pair ->
                val p = pair.jsonArray.map { it.jsonPrimitive.content }
                assertEquals(p[0], ListenContext.rowLabel(i, false))
                assertEquals(p[1], ListenContext.rowLabel(i, true))
            }
        }
        assertTrue(prompts > 10, "the ask is exercised")
        assertTrue(sentenceAutoplays > 10, "sentence auto-play is exercised")
    }
}
