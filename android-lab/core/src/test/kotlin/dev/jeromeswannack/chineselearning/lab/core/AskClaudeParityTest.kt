package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
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
 * AskClaude reproduces askClaudeMenu (shared/chats/messageMenu.ts) and askQuickActions /
 * parseAskLanguage / effectiveAskLanguage (shared/study/askClaude.ts) exactly
 * (parity/fixtures/ask-claude.ts).
 */
class AskClaudeParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "ask-claude.json").readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun JsonObject.bool(key: String): Boolean = this[key]?.let { if (it is JsonNull) false else it.jsonPrimitive.booleanOrNull } ?: false
    private fun JsonObject.obj(key: String): JsonObject? = this[key]?.takeIf { it !is JsonNull }?.jsonObject

    private fun item(e: JsonElement): MessageMenu.Item {
        val o = e.jsonObject
        return MessageMenu.Item(o.str("id")!!, o.str("label")!!, o.str("icon")!!, o.bool("needsInternet"), o.bool("active"), o.bool("danger"))
    }

    @Test
    fun sentenceToolsLimitMatches() = assertEquals(f["max"]!!.jsonPrimitive.int, AskClaude.SENTENCE_TOOLS_MAX)

    @Test
    fun menusMatchTypeScript() {
        val cases = f["menus"]!!.jsonArray
        assertTrue(cases.size > 200)
        for (c in cases) {
            val o = c.jsonObject
            val m = o.obj("message")!!
            val msg = AskClaude.MenuMessage(
                mine = m.bool("mine"),
                text = m.str("text")!!,
                translation = m.str("translation"),
                autoCheckStatus = m.obj("auto_check")?.str("status"),
                autoCheckText = m.obj("auto_check")?.str("text"),
                markdown = m.bool("markdown"),
            )
            val state = o.obj("state")!!
            val r = o.obj("result")!!
            val expected = MessageMenu.Menu(r.bool("reactions"), r["items"]!!.jsonArray.map(::item))
            assertEquals(expected, AskClaude.menu(msg, state.bool("pinyinOn"), state.bool("translateOn")), "askClaudeMenu $m $state")
        }
    }

    @Test
    fun quickActionsMatchTypeScript() {
        for (c in f["quick"]!!.jsonArray) {
            val o = c.jsonObject
            val expected = o["result"]!!.jsonArray.map { e -> e.jsonObject.let { AskClaude.QuickAction(it.str("id")!!, it.str("label")!!, it.str("question")!!) } }
            assertEquals(expected, AskClaude.quickActions(o.str("language")!!, o.bool("typedAnswer"), o.bool("hasSentence")), "askQuickActions $o")
        }
    }

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }

    private fun entry(e: JsonElement): AskClaude.ListeningEntry = e.jsonObject.let { AskClaude.ListeningEntry(it.str("id")!!, it.str("answer")!!, it.str("answer_lang")) }

    @Test
    fun listeningConstantsMatch() {
        assertEquals(f.str("voice"), AskClaude.VOICE)
        assertEquals(f["speed"]!!.jsonPrimitive.content.toDouble(), AskClaude.SPEED)
        assertEquals(f["clipMax"]!!.jsonPrimitive.int, AskClaude.CLIP_MAX_CHARS)
    }

    @Test
    fun hiddenAnswersMatchTypeScript() {
        val cases = f["listening"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val e = entry(o["entry"]!!)
            assertEquals(o.bool("candidate"), AskClaude.listeningCandidate(e), "askListeningCandidate $e")
            assertEquals(o.bool("hidden"), AskClaude.answerHidden(e, o.bool("on"), strings(o["revealed"])), "askAnswerHidden $o")
        }
    }

    @Test
    fun revealedWhenOnMatchesTypeScript() {
        for (c in f["revealedOn"]!!.jsonArray) {
            val o = c.jsonObject
            val entries = o["entries"]!!.jsonArray.map(::entry)
            assertEquals(strings(o["result"]), AskClaude.revealedWhenListeningOn(entries, strings(o["revealed"]), o["max"]!!.jsonPrimitive.int), "revealedWhenListeningOn $o")
        }
    }

    @Test
    fun autoPlayMatchesTypeScript() {
        for (c in f["autoplay"]!!.jsonArray) {
            val o = c.jsonObject
            val entries = o["entries"]!!.jsonArray.map(::entry)
            assertEquals(o.str("result"), AskClaude.autoPlayId(o.bool("on"), entries, strings(o["seen"]), strings(o["revealed"]), o.bool("audioBusy")), "askAutoPlayId $o")
        }
    }

    @Test
    fun languagesMatchTypeScript() {
        for (c in f["languages"]!!.jsonArray) {
            val o = c.jsonObject
            val v = o.str("value")
            assertEquals(o.str("parsed"), AskClaude.parseLanguage(v), "parseAskLanguage $v")
            assertEquals(o.str("effective"), AskClaude.effectiveLanguage(v), "effectiveAskLanguage $v")
        }
    }
}
