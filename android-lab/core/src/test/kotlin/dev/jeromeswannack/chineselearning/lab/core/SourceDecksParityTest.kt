package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.fail

/** Source decks reproduce shared/decks/source-decks.ts exactly (parity/fixtures/source-decks.ts). */
class SourceDecksParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "source-decks.json").readText()).jsonObject
    }

    private fun JsonObject.str(k: String): String? = this[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content

    @Test
    fun keysAndNames() {
        val decks = root["decks"]!!.jsonArray.map { it.jsonObject }
        assertEquals(decks.map { it.str("key") }, SourceDecks.KEYS)
        for (d in decks) {
            val def = SourceDecks.DECKS.getValue(d.str("key")!!)
            assertEquals(d.str("name"), def.name)
            assertEquals(d.str("description"), def.description)
            assertEquals(d["legacy"]!!.jsonArray.map { it.jsonPrimitive.content }, def.legacyNames)
            assertEquals(d.str("name"), SourceDecks.name(def.key))
        }
    }

    @Test
    fun refs() {
        for (r in root["refs"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(r.str("key"), SourceDecks.parseRef(r.str("ref")), "ref ${r.str("ref")}")
        }
        assertEquals("source:readers", SourceDecks.ref("readers"))
        assertNull(SourceDecks.parseRef(null))
    }

    @Test
    fun mappings() {
        for (e in root["explorer"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(e.str("key"), SourceDecks.forExplorer(e.str("source")), "explorer ${e.str("source")}")
        }
        for (b in root["bump"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(b.str("key"), SourceDecks.forBump(b.str("source")), "bump ${b.str("source")}")
        }
    }

    @Test
    fun lines() {
        for (l in root["lines"]!!.jsonArray.map { it.jsonObject }) {
            val n = l.str("name")!!
            val c = l["count"]!!.jsonPrimitive.int
            assertEquals(l.str("added"), SourceDecks.addedLine(n, c))
            assertEquals(l.str("moved"), SourceDecks.movedLine(n, c))
        }
    }
}
