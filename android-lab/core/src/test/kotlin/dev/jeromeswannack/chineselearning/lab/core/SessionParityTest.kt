package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.auth.SessionRules
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

/** Signed-out state + account switching (shared/auth/session.ts) — parity/fixtures/session.ts. */
class SessionParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "session.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun counts(o: JsonObject) = SessionRules.Unsynced(o["reviews"]!!.jsonPrimitive.int, o["recordings"]!!.jsonPrimitive.int, o["other"]!!.jsonPrimitive.int)

    @Test
    fun whereAndCountsMatchTypeScript() {
        val cases = fixture["where"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 40)
        for (c in cases) {
            val path = str(c["path"])!!
            assertEquals(str(c["where"]), SessionRules.signedOutWhere(path), path)
            assertEquals(c["counts"]!!.jsonPrimitive.boolean, SessionRules.countsForSignedOut(path), path)
            assertEquals(c["proves"]!!.jsonPrimitive.boolean, SessionRules.provesSignedIn(path), path)
        }
    }

    @Test
    fun summariesAndWarningsMatchTypeScript() {
        for (c in fixture["summaries"]!!.jsonArray.map { it.jsonObject }) {
            val u = counts(c["c"]!!.jsonObject)
            assertEquals(str(c["summary"]), SessionRules.unsyncedSummary(u))
            assertEquals(str(c["signOut"]), SessionRules.signOutWarning(u))
            assertEquals(str(c["switchTo"]), SessionRules.switchAccountWarning(u, "jerome@example.com"))
            assertEquals(str(c["switchNull"]), SessionRules.switchAccountWarning(u, null))
        }
    }

    @Test
    fun accountSwitchMatchesTypeScript() {
        val cases = fixture["switches"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 30)
        for (c in cases) {
            val prev = c["previous"].let { if (it == null || it is JsonNull) null else it.jsonObject }
            val next = c["next"]!!.jsonObject
            val got = SessionRules.accountSwitch(str(prev?.get("id")), str(prev?.get("email")), str(next["id"]), str(next["email"]), counts(c["unsynced"]!!.jsonObject))
            assertEquals(str(c["out"]), got.wire, c.toString())
        }
    }

    @Test
    fun copyMatchesTypeScript() {
        val copy = fixture["copy"]!!.jsonObject
        assertEquals(str(copy["lab"]), SessionRules.signedOutBanner("lab"))
        assertEquals(str(copy["web"]), SessionRules.signedOutBanner("web"))
        assertEquals(str(copy["transcription"]), SessionRules.SIGNED_OUT_TRANSCRIPTION)
        assertEquals(str(copy["note"]), SessionRules.SIGNED_OUT_TRANSCRIPTION_NOTE)
    }
}
