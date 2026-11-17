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

    /** The fixture's note (card-sentence fields) → [CardSentence.NoteFields]; null = no note. */
    private fun noteOf(e: JsonElement?): CardSentence.NoteFields? = (e as? JsonObject)?.let {
        CardSentence.NoteFields(it["id"]!!.jsonPrimitive.content, str(it["sentence_clue"]), str(it["sentence_clue_pinyin"]), str(it["sentence_clue_translation"]), str(it["sentence_clue_audio_url"]))
    }

    private fun storedRows(e: JsonElement?): List<CardSentence.Row> = e!!.jsonArray.map { it.jsonObject }.map {
        CardSentence.Row(
            id = it["id"]!!.jsonPrimitive.content, noteId = it["note_id"]!!.jsonPrimitive.content, position = it["position"]!!.jsonPrimitive.int,
            hanzi = it["hanzi"]!!.jsonPrimitive.content, pinyin = str(it["pinyin"]), translation = str(it["translation"]), audioUrl = str(it["audio_url"]),
            focus = str(it["focus"]), isCard = (int(it["is_card"]) ?: 0) == 1,
        )
    }

    /** The note's rows as one list ([CardSentence.withCardSentence]) as Listen in context reads them. */
    private fun listenSentences(note: CardSentence.NoteFields?, stored: List<CardSentence.Row>): List<ListenContext.Sentence> =
        CardSentence.withCardSentence(note, stored).map { ListenContext.Sentence(it.id, it.hanzi, it.translation, it.audioUrl, it.position, it.focus, it.isCard) }

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
        var contrivedCases = 0
        for (c in cases) {
            val noteId = c["noteId"]!!.jsonPrimitive.content
            val rows = ListenContext.rows(listenSentences(noteOf(c["note"]), storedRows(c["sentences"])))
            val expected = c["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, rows.size, "rows of $noteId")
            expected.zip(rows).forEach { (e, row) ->
                assertEquals(e["key"]!!.jsonPrimitive.content, row.key)
                assertEquals(e["sentenceId"]!!.jsonPrimitive.content, row.sentenceId)
                assertEquals(e["hanzi"]!!.jsonPrimitive.content, row.hanzi)
                assertEquals(str(e["translation"]), row.translation, "translation of ${row.key}")
                assertEquals(str(e["audioUrl"]), row.audioUrl)
                assertEquals(e["fromCard"]!!.jsonPrimitive.boolean, row.fromCard)
                assertEquals(e["contrived"]!!.jsonPrimitive.boolean, row.contrived, "contrived of ${row.key}")
            }
            val online = c["online"]!!.jsonPrimitive.boolean
            val cached = c["cached"]!!.jsonArray.map { it.jsonPrimitive.boolean }
            val states = rows.mapIndexed { i, row -> ListenContext.rowState(row.audioUrl, online, cached[i]) }
            assertEquals(c["states"]!!.jsonArray.map { it.jsonPrimitive.content }, states.map { it.wire }, "states of $noteId")
            assertEquals(autoplayWire(c["autoplayOn"]!!.jsonObject), autoplayWire(ListenContext.autoplay(true, states)))
            assertEquals(autoplayWire(c["autoplayOff"]!!.jsonObject), autoplayWire(ListenContext.autoplay(false, states)))
            if (ListenContext.autoplay(true, states) is ListenContext.Autoplay.Sentence) sentenceAutoplays++
            val tap = ListenContext.wordTap(c["played"]!!.jsonPrimitive.int, states.count(ListenContext::isPlayable), c["anyway"]!!.jsonPrimitive.boolean)
            assertEquals(c["wordTap"]!!.jsonPrimitive.content, tap.name.lowercase())
            if (tap == ListenContext.WordTap.PROMPT) prompts++
            val total = c["total"]!!.jsonPrimitive.int
            assertEquals(total, rows.size)
            val natural = ListenContext.naturalCount(rows)
            assertEquals(c["natural"]!!.jsonPrimitive.int, natural, "natural of $noteId")
            if (natural < total) contrivedCases++
            assertEquals(c["needsTopUp"]!!.jsonPrimitive.boolean, ListenContext.needsTopUp(natural))
            assertEquals(c["topUpCount"]!!.jsonPrimitive.int, ListenContext.topUpCount(natural))
            assertEquals(c["moreCount"]!!.jsonPrimitive.int, ListenContext.moreCount(natural))
            c["labels"]!!.jsonArray.forEachIndexed { i, pair ->
                val p = pair.jsonArray.map { it.jsonPrimitive.content }
                assertEquals(p[0], ListenContext.rowLabel(i, false))
                assertEquals(p[1], ListenContext.rowLabel(i, true))
            }
        }
        assertTrue(prompts > 10, "the ask is exercised")
        assertTrue(sentenceAutoplays > 10, "sentence auto-play is exercised")
        assertTrue(contrivedCases > 10, "contrived rows are exercised")
    }
    private fun keys(e: JsonElement?): List<String>? = if (e == null || e is JsonNull) null else e.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun freshPicksShuffleAndTopUpsMatchTypeScript() {
        val picks = fixture["picks"]!!.jsonArray.map { it.jsonObject }
        assertTrue(picks.size >= 100)
        var changedByPrevious = 0
        var withHeard = 0
        var wants = 0
        for (c in picks) {
            val noteId = c["noteId"]!!.jsonPrimitive.content
            val events = c["events"]!!.jsonArray.map { it.jsonObject }.map {
                SentenceHistory.Event(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["sentence_key"]!!.jsonPrimitive.content, it["kind"]!!.jsonPrimitive.content, str(it["mode"]), str(it["result"]), str(it["reason"]), it["at"]!!.jsonPrimitive.content)
            }
            val stats = SentenceHistory.stats(events, noteId)
            if (stats.values.any { it.heard.count > 0 }) withHeard++
            val rows = ListenContext.rows(listenSentences(noteOf(c["note"]), storedRows(c["sentences"])))
            val seed = c["seed"]!!.jsonPrimitive.content
            val previous = keys(c["previous"])
            val count = int(c["count"])
            val pick = if (count == null) ListenContext.pick(rows, stats, seed, str(c["word"]), previous)
                else ListenContext.pick(rows, stats, seed, str(c["word"]), previous, count)
            val what = "pick $noteId"
            assertEquals(keys(c["keys"]), pick.rows.map { it.key }, what)
            assertEquals(c["fresh"]!!.jsonPrimitive.int, pick.fresh, what)
            assertEquals(c["heardBefore"]!!.jsonPrimitive.int, pick.heardBefore, what)
            assertEquals(c["unheardLeft"]!!.jsonPrimitive.int, pick.unheardLeft, what)
            val want = c["want"]
            val got = ListenContext.topUpWant(pick.unheardLeft)
            if (want == null || want is JsonNull) assertEquals(null, got, what) else {
                wants++
                assertEquals(want.jsonObject["reason"]!!.jsonPrimitive.content, got?.reason, what)
                assertEquals(want.jsonObject["count"]!!.jsonPrimitive.int, got?.count, what)
            }
            val props = c["props"]!!.jsonObject
            assertEquals(props.mapValues { it.value.jsonPrimitive.int }, ListenContext.shownProps(pick), what)
            if (previous != null && previous.size == pick.rows.size && pick.rows.any { it.key !in previous }) changedByPrevious++
            assertEquals(keys(c["shown"]), ListenContext.shownRows(rows, pick.rows.map { it.key }.reversed(), keys(c["added"])!!).map { it.key }, what)
        }
        assertTrue(withHeard > 50, "heard history is exercised")
        assertTrue(wants > 20, "top-ups are exercised")
        assertTrue(changedByPrevious > 5, "the previous set is exercised")
    }

    @Test
    fun simplicityHashAndShuffleMatchTypeScript() {
        for (x in fixture["simple"]!!.jsonArray.map { it.jsonObject }) {
            val text = x["text"]!!.jsonPrimitive.content
            val word = str(x["word"])
            assertEquals(x["han"]!!.jsonPrimitive.int, SentenceSimplicity.hanCount(text), text)
            assertEquals(x["breaks"]!!.jsonPrimitive.int, SentenceSimplicity.clauseBreaks(text), text)
            assertEquals(x["max"]!!.jsonPrimitive.int, SentenceSimplicity.maxHan(word), text)
            assertEquals(keys(x["problems"]), SentenceSimplicity.problems(text, word), "$text / $word")
        }
        for (x in fixture["hashes"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(x["hash"]!!.jsonPrimitive.content.toLong(), ListenContext.hash(x["text"]!!.jsonPrimitive.content))
        }
        for (x in fixture["shuffles"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(keys(x["out"]), ListenContext.shuffle(keys(x["items"])!!, x["seed"]!!.jsonPrimitive.content))
        }
    }
}
