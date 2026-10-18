package dev.jeromeswannack.chineselearning.lab.core.memereview

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

/**
 * 梗 Meme review reproduces shared/meme-review exactly (parity/fixtures/meme-review.ts): month and
 * coverage labels, platform / link / verdict labels, register chips, the quiz line, the
 * "+ Add as card" fields and the ▶ lines — and the issue JSON decodes into the Kotlin classes.
 */
class MemeReviewParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "meme-review.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun strs(e: JsonElement?) = e?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    @Test
    fun months() {
        for (m in data["months"]!!.jsonArray.map { it.jsonObject }) {
            val month = m["month"]!!.str!!
            assertEquals(m["valid"]!!.jsonPrimitive.boolean, MemeReview.isMonth(month), "isMonth($month)")
            assertEquals(m["label"]!!.str, MemeReview.monthLabel(month), "monthLabel($month)")
            assertEquals(m["zh"]!!.str, MemeReview.monthLabelZh(month), "monthLabelZh($month)")
        }
        for (c in data["covers"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["label"]!!.str, MemeReview.coversLabel(MemeCovers(c["from"]!!.str!!, c["to"]!!.str!!)))
        }
    }

    @Test
    fun labels() {
        val platforms = data["platforms"]!!.jsonArray.map { it.jsonObject }
        assertEquals(platforms.map { it["platform"]!!.str }, MemeReview.PLATFORMS)
        for (p in platforms) {
            val platform = p["platform"]!!.str!!
            assertEquals(p["name"]!!.str, MemeReview.platformName(platform))
            assertEquals(p["video"]!!.str, MemeReview.linkLabel("video", platform))
            assertEquals(p["post"]!!.str, MemeReview.linkLabel("post", platform))
        }
        for (v in data["verdicts"]!!.jsonArray.map { it.jsonObject }) assertEquals(v["label"]!!.str, MemeReview.verdictLabel(v["verdict"]!!.str!!))
        for (r in data["registers"]!!.jsonArray.map { it.jsonObject }) {
            val reg = json.decodeFromJsonElement(MemeRegister.serializer(), r["register"]!!)
            assertEquals(strs(r["chips"]), MemeReview.registerChips(reg))
        }
        for (s in data["scores"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(s["line"]!!.str, MemeReview.quizScoreLine(s["correct"]!!.jsonPrimitive.int, s["total"]!!.jsonPrimitive.int))
        }
    }

    @Test
    fun issuesDecodeAndCardsMatch() {
        val issues = data["issues"]!!.jsonArray.map { it.jsonObject }
        assertTrue(issues.isNotEmpty())
        for (i in issues) {
            val issue = json.decodeFromJsonElement(MemeIssue.serializer(), i["issue"]!!)
            assertEquals(i["covers_label"]!!.str, MemeReview.coversLabel(issue.covers))
            assertEquals(strs(i["audio"]), MemeReview.audioLines(issue))
            val cards = i["cards"]!!.jsonArray.map { it.jsonObject }
            assertEquals(cards.size, issue.items.size)
            issue.items.zip(cards).forEach { (item, c) ->
                val k = MemeReview.cardFields(item, issue.month)
                assertEquals(c["hanzi"]!!.str, k.hanzi)
                assertEquals(c["pinyin"]!!.str, k.pinyin)
                assertEquals(c["english"]!!.str, k.english)
                assertEquals(c["fun_facts"]!!.str, k.funFacts, "fun_facts of ${item.hanzi}")
                assertEquals(c["sentence_clue"]?.str, k.sentenceClue, "clue of ${item.hanzi}")
                assertEquals(c["sentence_clue_pinyin"]?.str, k.sentenceCluePinyin)
                assertEquals(c["sentence_clue_translation"]?.str, k.sentenceClueTranslation)
            }
        }
    }
}
