package dev.jeromeswannack.chineselearning.lab.core.anki

import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The Lab app's Anki export must produce exactly what the web's frontend/src/services/anki
 * produces (parity/fixtures/anki.ts runs the TypeScript, sql.js included): the same model /
 * deck ids, note GUIDs, checksums, field strings, model / deck / conf JSON and card rows — so
 * re-exporting from either app updates the same notes in Anki instead of duplicating them.
 */
class AnkiParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "anki.json").readText()).jsonObject
    }

    private val JsonElement.s: String get() = jsonPrimitive.content
    private val JsonElement.sOrNull: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.opt(k: String): String? = this[k]?.sOrNull
    private fun JsonElement.arr(k: String): JsonArray = jsonObject[k]!!.jsonArray

    private fun show(s: String) = s.map { c -> if (c.code in 0x20..0x7e || c.code in 0x3000..0x9fff) "$c" else "\\u%04x".format(c.code) }.joinToString("")

    /** Deep equality with JS number semantics (5 == 5.0) and key order ignored. */
    private fun same(a: JsonElement?, b: JsonElement?): Boolean = when {
        a == null || b == null -> a == null && b == null
        a is JsonNull || b is JsonNull -> a is JsonNull && b is JsonNull
        a is JsonPrimitive && b is JsonPrimitive -> when {
            a.isString || b.isString -> a.isString == b.isString && a.content == b.content
            else -> a.content == b.content || (a.content.toDoubleOrNull() != null && a.content.toDoubleOrNull() == b.content.toDoubleOrNull())
        }
        a is JsonArray && b is JsonArray -> a.size == b.size && a.indices.all { same(a[it], b[it]) }
        a is JsonObject && b is JsonObject -> a.keys == b.keys && a.keys.all { same(a[it], b[it]) }
        else -> false
    }

    private fun assertSame(expected: JsonElement, actual: JsonElement, where: String) {
        if (!same(expected, actual)) fail("$where\n  expected $expected\n  actual   $actual")
    }

    // ---------------- Kotlin → the JS shapes ----------------

    private fun j(v: Any?): JsonElement = when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to j(x) })
        is List<*> -> JsonArray(v.map { j(it) })
        else -> error("$v")
    }

    private fun refJson(r: AudioRef): JsonElement = when (r) {
        is AudioRef.R2 -> j(mapOf("kind" to "r2", "key" to r.key))
        is AudioRef.Tts -> j(mapOf("kind" to "tts", "text" to r.text))
        is AudioRef.ReaderPage -> j(mapOf("kind" to "reader-page", "pageId" to r.pageId, "text" to r.text))
    }

    private fun progressJson(p: AnkiCardProgress) = j(mapOf("state" to p.state, "intervalDays" to p.intervalDays, "ease" to p.ease, "reps" to p.reps, "lapses" to p.lapses, "dueInDays" to p.dueInDays))

    private fun noteJson(n: SourceNote): JsonElement {
        val m = linkedMapOf<String, JsonElement>("model" to j(n.model), "guid" to j(n.guid), "fields" to j(n.fields))
        n.tags?.let { m["tags"] = j(it) }
        n.audio?.let { a -> m["audio"] = JsonObject(a.mapValues { refJson(it.value) }) }
        n.progress?.let { p -> m["progress"] = JsonObject(p.entries.associate { it.key.toString() to progressJson(it.value) }) }
        return JsonObject(m)
    }

    private fun sourceJson(s: AnkiSource) = JsonObject(mapOf("deckName" to j(s.deckName), "description" to j(s.description), "notes" to JsonArray(s.notes.map(::noteJson))))

    // ---------------- JS inputs → Kotlin ----------------

    private fun deckNote(o: JsonObject) = DeckSourceNote(
        id = o.opt("id")!!, hanzi = o.opt("hanzi")!!, pinyin = o.opt("pinyin") ?: "", english = o.opt("english") ?: "",
        funFacts = o.opt("fun_facts"), context = o.opt("context"), sentenceClue = o.opt("sentence_clue"),
        sentenceCluePinyin = o.opt("sentence_clue_pinyin"), sentenceClueTranslation = o.opt("sentence_clue_translation"),
        audioUrl = o.opt("audio_url"), sentenceClueAudioUrl = o.opt("sentence_clue_audio_url"),
    )

    private fun deckCard(o: JsonObject) = DeckSourceCard(
        noteId = o.opt("note_id")!!, cardType = o.opt("card_type")!!, queue = o["queue"]!!.jsonPrimitive.int,
        interval = o["interval"]!!.jsonPrimitive.double, easeFactor = o["ease_factor"]!!.jsonPrimitive.double,
        repetitions = o["repetitions"]!!.jsonPrimitive.int, lapses = o["lapses"]!!.jsonPrimitive.int, nextReviewAt = o.opt("next_review_at"),
    )

    private fun progress(o: JsonObject) = AnkiCardProgress(
        o.opt("state")!!, o["intervalDays"]!!.jsonPrimitive.double, o["ease"]!!.jsonPrimitive.double,
        o["reps"]!!.jsonPrimitive.int, o["lapses"]!!.jsonPrimitive.int, o["dueInDays"]!!.jsonPrimitive.double,
    )

    private fun ankiNote(o: JsonObject) = AnkiNote(
        model = o.opt("model")!!, guid = o.opt("guid")!!,
        fields = o["fields"]!!.jsonObject.mapValues { it.value.s },
        tags = o["tags"]?.jsonArray?.map { it.s },
        progress = o["progress"]?.jsonObject?.entries?.associate { it.key.toInt() to progress(it.value.jsonObject) },
    )

    // ---------------- tests ----------------

    @Test
    fun hashesMatch() {
        val h = f["hash"]!!.jsonObject
        for (row in h["cyrb"]!!.jsonArray.map { it.jsonArray }) {
            assertEquals(row[2].jsonPrimitive.long, AnkiHash.cyrb53(row[0].s, row[1].jsonPrimitive.long), "cyrb53(${show(row[0].s)}, ${row[1]})")
        }
        for (row in h["stable"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[2].jsonPrimitive.long, AnkiHash.stableId(row[0].s, row[1].s), "stableId ${show(row[1].s)}")
        for (row in h["guids"]!!.jsonArray.map { it.jsonArray }) {
            val parts = row[0].jsonArray.map { it.s }
            assertEquals(row[1].s, AnkiHash.guidFor(*parts.toTypedArray()), "guidFor ${parts.map(::show)}")
        }
        for (row in h["sha1Strings"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].s, AnkiHash.sha1Hex(row[0].s), "sha1 ${show(row[0].s)}")
        for (row in h["sha1Bytes"]!!.jsonArray.map { it.jsonArray }) {
            val bytes = ByteArray(row[0].jsonArray.size) { row[0].jsonArray[it].jsonPrimitive.int.toByte() }
            assertEquals(row[1].s, AnkiHash.sha1Hex(bytes), "sha1 of ${bytes.size} bytes")
        }
        for (row in h["checksums"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].jsonPrimitive.long, AnkiHash.fieldChecksum(row[0].s), "csum ${show(row[0].s)}")
        for (row in h["strips"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].s, AnkiHash.stripHtmlMedia(row[0].s), "strip ${show(row[0].s)}")
        for (row in h["htmls"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].s, AnkiSources.htmlField(row[0].sOrNull), "htmlField ${row[0]}")
        for (row in h["wordLike"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].jsonPrimitive.boolean, AnkiSources.isWordLike(row[0].s), "isWordLike ${show(row[0].s)}")
        assertTrue(h["cyrb"]!!.jsonArray.size > 1000)
    }

    @Test
    fun modelsAndIdsMatch() {
        val models = f["models"]!!.jsonObject
        for ((key, m) in AnkiModels.MODELS) {
            val expected = models[key]!!
            val actual = j(mapOf(
                "key" to m.key, "id" to m.id, "name" to m.name, "fields" to m.fields, "css" to m.css,
                "templates" to m.templates.map { mapOf("name" to it.name, "qfmt" to it.qfmt, "afmt" to it.afmt, "requires" to it.requires) },
            ))
            assertSame(expected, actual, "model $key")
        }
        assertSame(f["cardTypeOrd"]!!, j(AnkiModels.CARD_TYPE_ORD), "CARD_TYPE_ORD")
        for (row in f["deckIds"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].jsonPrimitive.long, AnkiCollection.deckId(row[0].s), "deck id ${show(row[0].s)}")
    }

    @Test
    fun namesMatch() {
        for (row in f["filenames"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].s, AnkiNaming.apkgFilename(row[0].s), "apkgFilename ${show(row[0].s)}")
        for (row in f["extensions"]!!.jsonArray.map { it.jsonArray }) assertEquals(row[1].s, AnkiNaming.mediaExtension(row[0].s), "ext ${row[0]}")
        for (row in f["mediaNames"]!!.jsonArray.map { it.jsonArray }) {
            val bytes = ByteArray(row[0].jsonArray.size) { row[0].jsonArray[it].jsonPrimitive.int.toByte() }
            assertEquals(row[2].s, AnkiNaming.mediaFilename(bytes, row[1].s), "mediaFilename")
        }
    }

    @Test
    fun cardProgressMatches() {
        for (c in f["progressCases"]!!.jsonArray.map { it.jsonObject }) {
            val card = deckCard(c["card"]!!.jsonObject)
            assertSame(c["progress"]!!, progressJson(AnkiSources.cardProgress(card, c["now"]!!.jsonPrimitive.long)), "cardProgress $card")
        }
    }

    @Test
    fun deckSourcesMatch() {
        val cases = f["deckCases"]!!.jsonArray.map { it.jsonObject }
        for (c in cases) {
            val deck = c["deck"]!!.jsonObject
            val source = AnkiSources.deckToAnki(
                deck.opt("name")!!, deck.opt("description"),
                c["notes"]!!.jsonArray.map { deckNote(it.jsonObject) },
                c["cards"]!!.jsonArray.map { deckCard(it.jsonObject) },
                progress = c["progress"]!!.jsonPrimitive.boolean, now = c["now"]!!.jsonPrimitive.long,
            )
            assertSame(c["source"]!!, sourceJson(source), "deckToAnki ${show(deck.opt("name")!!)} progress=${c["progress"]}")
        }
        assertTrue(cases.size >= 20)
    }

    @Test
    fun lessonSourcesMatch() {
        val cases = f["lessonCases"]!!.jsonArray.map { it.jsonObject }
        for (c in cases) {
            val spec = LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), c["spec"]!!)
            val source = AnkiSources.lessonToAnki(spec, c.opt("sourceId"))
            assertSame(c["source"]!!, sourceJson(source), "lessonToAnki ${spec.title}")
        }
        assertTrue(cases.size > 10, "every sample lesson is a case")
    }

    @Test
    fun readerSourcesMatch() {
        for (c in f["readerCases"]!!.jsonArray.map { it.jsonObject }) {
            val r = c["reader"]!!.jsonObject
            val reader = ReaderSource(
                id = r.opt("id")!!, titleChinese = r.opt("title_chinese")!!, titleEnglish = r.opt("title_english")!!,
                pages = r["pages"]!!.jsonArray.map { it.jsonObject }.map { p ->
                    ReaderSourcePage(p.opt("id")!!, p["page_number"]!!.jsonPrimitive.int, p.opt("content_chinese")!!, p.opt("content_pinyin")!!, p.opt("content_english")!!)
                },
                vocabularyUsed = r["vocabulary_used"]?.jsonArray?.map { it.jsonObject }?.map { v -> ReaderSourceVocab(v.opt("hanzi")!!, v.opt("pinyin")!!, v.opt("english")!!) }.orEmpty(),
            )
            assertSame(c["source"]!!, sourceJson(AnkiSources.readerToAnki(reader)), "readerToAnki ${reader.id}")
        }
    }

    @Test
    fun templateAppliesMatches() {
        for (row in f["templateCases"]!!.jsonArray.map { it.jsonArray }) {
            val model = AnkiModels.model(row[0].s)
            val fields = row[2].jsonObject.mapValues { it.value.s }
            assertEquals(row[3].jsonPrimitive.boolean, AnkiCollection.templateApplies(model, row[1].jsonPrimitive.int, fields), "templateApplies $row")
        }
    }

    /** Compares one bound value with what sql.js stored (integer affinity turns a numeric sfld into a number). */
    private fun assertCell(expected: JsonElement, type: String, actual: Any, where: String) {
        when (type) {
            "integer", "real" -> {
                val e = expected.jsonPrimitive.double
                val a = when (actual) { is Long -> actual.toDouble(); is String -> actual.toDoubleOrNull(); else -> null }
                assertEquals(e, a, where)
                if (actual is Long) assertEquals(expected.jsonPrimitive.long, actual, where)
            }
            "text" -> {
                assertTrue(actual is String, "$where: expected text, got $actual")
                assertEquals(expected.s, actual, where)
            }
            else -> fail("$where: unexpected SQLite type $type")
        }
    }

    private fun assertRows(expected: JsonArray, types: JsonArray, actual: List<List<Any>>, where: String) {
        assertEquals(expected.size, actual.size, "$where row count")
        expected.forEachIndexed { r, row ->
            val cells = row.jsonArray
            assertEquals(cells.size, actual[r].size, "$where row $r width")
            cells.forEachIndexed { c, cell -> assertCell(cell, types[r].jsonArray[c].s, actual[r][c], "$where row $r col $c") }
        }
    }

    @Test
    fun collectionRowsMatchSqlJs() {
        val cases = f["collections"]!!.jsonArray.map { it.jsonObject }
        for ((i, c) in cases.withIndex()) {
            val input = c["input"]!!.jsonObject
            val apkg = ApkgInput(input.opt("deckName")!!, input.opt("deckDescription"), input["notes"]!!.jsonArray.map { ankiNote(it.jsonObject) })
            val plan = AnkiCollection.plan(apkg, c["now"]!!.jsonPrimitive.long)
            val where = "collection $i (${show(apkg.deckName)})"
            assertEquals(c["deckId"]!!.jsonPrimitive.long, plan.deckId, "$where deckId")
            assertEquals(c["noteCount"]!!.jsonPrimitive.int, plan.noteCount, "$where noteCount")
            assertEquals(c["cardCount"]!!.jsonPrimitive.int, plan.cardCount, "$where cardCount")
            assertRows(c["col"]!!.jsonArray, c["colTypes"]!!.jsonArray, listOf(plan.col), "$where col")
            assertRows(c["notes"]!!.jsonArray, c["noteTypes"]!!.jsonArray, plan.notes, "$where notes")
            assertRows(c["cards"]!!.jsonArray, c["cardTypes"]!!.jsonArray, plan.cards, "$where cards")
        }
        assertTrue(cases.size > 30)
    }

    @Test
    fun packagerFillsSoundFieldsLikeTheWeb() {
        val src = AnkiSources.deckToAnki(
            "HSK", null,
            listOf(
                DeckSourceNote("a", "你好", audioUrl = "k1", sentenceClue = "你好吗？", sentenceClueAudioUrl = "k2"),
                DeckSourceNote("b", "再见", audioUrl = "k1"),
                DeckSourceNote("c", "谢谢", audioUrl = "k3"),
            ),
            emptyList(),
        )
        assertEquals(listOf(AudioRef.R2("k1"), AudioRef.R2("k2"), AudioRef.R2("k3")), AnkiPackager.refs(src))
        val clip = AnkiMediaFile("abc.mp3", byteArrayOf(1, 2, 3))
        val out = AnkiPackager.assemble(src, includeAudio = true, resolved = mapOf(AnkiPackager.key(AudioRef.R2("k1")) to clip), missing = 2)
        assertEquals("[sound:abc.mp3]", out.input.notes[0].fields["Audio"])
        assertEquals(null, out.input.notes[0].fields["SentenceAudio"])
        assertEquals("[sound:abc.mp3]", out.input.notes[1].fields["Audio"])
        assertEquals(listOf("abc.mp3"), out.media.map { it.filename })
        assertEquals(2, out.audioIncluded)
        assertEquals(2, out.audioMissing)
        val bare = AnkiPackager.assemble(src, includeAudio = false, resolved = emptyMap(), missing = 0)
        assertTrue(bare.media.isEmpty())
        assertEquals(null, bare.input.notes[0].fields["Audio"])
    }
}
