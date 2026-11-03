package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The chat as the way in to the person reproduces shared/chats/personLinks.ts (parity/fixtures/chat-person-links.ts). */
class ChatPersonLinksParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-person-links.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun titleMatches() = assertEquals(data["title"]!!.str, ChatPersonLinks.CONNECTIONS_TITLE)

    @Test
    fun linksMatch() {
        val cases = data["links"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val rel = o["relationship_id"]!!.str
            val name = o["other_name"]!!.str
            val role = o["viewer_role"]!!.str
            val isAi = o["is_ai"]!!.jsonPrimitive.boolean
            val case = "rel=$rel name=$name role=$role ai=$isAi"
            assertEquals(o["path"]!!.str, ChatPersonLinks.personPath(rel, isAi), case)
            val want = o["links"]!!.jsonArray.map {
                val l = it.jsonObject
                ChatPersonLinks.Link(l["id"]!!.str!!, l["icon"]!!.str!!, l["label"]!!.str!!, l["desc"]!!.str!!, l["path"]!!.str!!, l["section"]!!.str)
            }
            assertEquals(want, ChatPersonLinks.links(rel, name, role, isAi), case)
        }
    }

    @Test
    fun firstNamesMatch() {
        for (c in data["first_names"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["first"]!!.str, ChatPersonLinks.firstName(o["name"]!!.str), "name=${o["name"]}")
        }
    }

    @Test
    fun requestLinesMatch() {
        for (c in data["requests"]!!.jsonArray) {
            val o = c.jsonObject
            val reqs = o["requests"]!!.jsonArray.map { ChatPersonLinks.Request(it.jsonObject["name"]!!.str, it.jsonObject["requesterRole"]!!.str) }
            assertEquals(o["line"]!!.str, ChatPersonLinks.requestsLine(reqs), "requests=$reqs")
        }
    }

    @Test
    fun labPathCarriesTheSection() {
        val homework = ChatPersonLinks.links("r1", "明慧", "student", false).first { it.id == "homework" }
        assertEquals("/connections/r1?section=homework", homework.labPath)
        assertEquals("/connections/r1/board", ChatPersonLinks.links("r1", "明慧", "student", false).first { it.id == "lesson_board" }.labPath)
    }
}
