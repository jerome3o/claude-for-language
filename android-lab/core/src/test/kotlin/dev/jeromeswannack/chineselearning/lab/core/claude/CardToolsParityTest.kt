package dev.jeromeswannack.chineselearning.lab.core.claude

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
import kotlin.test.fail

/** Claude's card tools reproduce shared/claude/cardTools.ts (parity/fixtures/claude-card-tools.ts). */
class CardToolsParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "claude-card-tools.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun nullableMap(e: JsonElement?): Map<String, String?> = e!!.jsonObject.mapValues { (_, v) -> v.str }

    @Test
    fun results() {
        for (c in f["results"]!!.jsonArray) {
            val o = c.jsonObject
            val parsed = CardTools.parse(o["raw"].str)
            val want = o["parsed"]!!.jsonArray.map { r ->
                val x = r.jsonObject
                CardTools.Result(x["tool"].str!!, x["success"]!!.jsonPrimitive.boolean, x["data"] as? JsonObject, x["error"].str)
            }
            assertEquals(want, parsed, o["raw"].toString())
            val e = o["effects"]!!.jsonObject
            val wantEffects = CardTools.Effects(
                edited = e["edited"]?.takeIf { it !is JsonNull }?.let(::nullableMap),
                deleted = e["deleted"]!!.jsonPrimitive.boolean,
                cardsAdded = e["cardsAdded"]!!.jsonPrimitive.int,
                lessons = e["lessons"]!!.jsonPrimitive.int,
                bumped = e["bumped"]!!.jsonArray.map { it.str!! },
            )
            assertEquals(wantEffects, CardTools.effects(parsed), o["raw"].toString())
            val wantLines = o["lines"]!!.jsonArray.map { l ->
                l.jsonObject.let {
                    CardTools.Line(
                        it["kind"].str!!, it["text"].str!!, it["undo"]!!.jsonPrimitive.boolean, it["head"].str,
                        it["cards"]?.jsonArray?.map { c ->
                            val x = c.jsonObject
                            CardTools.AddedCard(x["note_id"].str!!, x["hanzi"].str!!, x["pinyin"].str, x["english"].str, x["deck_id"].str, x["deck_name"].str)
                        }.orEmpty(),
                    )
                }
            }
            assertEquals(wantLines, CardTools.lines(parsed), o["raw"].toString())
        }
    }

    @Test
    fun undo() {
        for (c in f["undo"]!!.jsonArray) {
            val o = c.jsonObject
            val want = o["out"]!!.jsonObject.mapValues { (_, v) -> v.str!! }
            assertEquals(want, CardTools.undoEditFields(nullableMap(o["before"]), nullableMap(o["edited"])), o.toString())
        }
    }

    @Test
    fun earlier() {
        val threads = f["threads"]!!.jsonArray.map { t ->
            val o = t.jsonObject
            CardTools.ThreadRef(o["id"].str!!, o["context_kind"].str!!, o["context"]!!.jsonObject["note_id"].str, o["last_message_at"].str, o["created_at"].str!!, o["archived"]!!.jsonPrimitive.boolean)
        }
        for (c in f["earlier"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"]!!.jsonArray.map { it.str!! }, CardTools.earlierCardThreads(threads, o["noteId"].str!!, o["currentId"].str).map { it.id }, o.toString())
        }
        for (c in f["labels"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"].str, CardTools.earlierLabel("银行", o["n"]!!.jsonPrimitive.int))
        }
    }
}
