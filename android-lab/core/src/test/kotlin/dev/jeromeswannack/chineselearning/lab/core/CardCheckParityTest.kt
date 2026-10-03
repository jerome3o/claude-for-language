package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Word checks must read exactly like shared/cards/check.ts (parity/fixtures/card-check.ts → card-check.json). */
class CardCheckParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "card-check.json").readText()).jsonObject
    }

    private fun issue(o: JsonObject) = NoteCheckIssue(
        o["id"]!!.jsonPrimitive.content, o["field"]!!.jsonPrimitive.content, o["kind"]!!.jsonPrimitive.content,
        o["current"]!!.jsonPrimitive.content, o["proposed"]!!.jsonPrimitive.content, o["reason"]!!.jsonPrimitive.content,
    )

    @Test
    fun estimateMatchesTypeScript() {
        val estimates = fixture["estimates"]!!.jsonArray.map { it.jsonObject }
        assertTrue(estimates.size >= 200)
        for (e in estimates) {
            val got = CardCheck.estimateCheckCost(e["words"]!!.jsonPrimitive.double)
            val want = CheckEstimate(e["words"]!!.let { _ -> got.words }, e["batches"]!!.jsonPrimitive.int, e["usd"]!!.jsonPrimitive.double, e["label"]!!.jsonPrimitive.content)
            assertEquals(want.batches, got.batches, "batches $e")
            assertEquals(want.usd, got.usd, "usd $e") // exact
            assertEquals(want.label, got.label, "label $e")
        }
        for (u in fixture["usd"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(u["out"]!!.jsonPrimitive.content, CardCheck.formatUsd(u["usd"]!!.jsonPrimitive.double), "formatUsd $u")
        }
    }

    @Test
    fun parseAndLiveMatchTypeScript() {
        for (p in fixture["parsed"]!!.jsonArray.map { it.jsonObject }) {
            val want = p["out"]!!.jsonArray.map { issue(it.jsonObject) }
            assertEquals(want, CardCheck.parseCheckIssues(p["raw"]!!.jsonPrimitive.content), "parse ${p["raw"]}")
        }
        for (l in fixture["live"]!!.jsonArray.map { it.jsonObject }) {
            val note = l["note"]!!.jsonObject
            val issues = l["issues"]!!.jsonArray.map { issue(it.jsonObject) }
            val got = CardCheck.liveCheckIssues(issues, note["pinyin"]!!.jsonPrimitive.content, note["english"]!!.jsonPrimitive.content)
            assertEquals(l["out"]!!.jsonArray.map { it.jsonPrimitive.content }, got.map { it.id }, "live $note")
        }
        for (s in fixture["same"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(s["out"]!!.jsonPrimitive.boolean, CardCheck.samePinyin(s["a"]!!.jsonPrimitive.content, s["b"]!!.jsonPrimitive.content), "same $s")
        }
    }

    @Test
    fun toneIssueKindsAndSummaryMatchTypeScript() {
        for (t in fixture["tone"]!!.jsonArray.map { it.jsonObject }) {
            val got = CardCheck.toneChangeIssue(t["hanzi"]!!.jsonPrimitive.content, t["pinyin"]!!.jsonPrimitive.content)
            val want = t["out"]
            if (want == null || want is JsonNull) assertNull(got, "tone $t") else {
                val w = want.jsonObject
                assertEquals(listOf(w["field"], w["kind"], w["current"], w["proposed"], w["reason"]).map { it!!.jsonPrimitive.content },
                    listOf(got!!.field, got.kind, got.current, got.proposed, got.reason), "tone $t")
            }
        }
        for (k in fixture["kinds"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(k["out"]!!.jsonPrimitive.content, CardCheck.checkKindLabel(k["kind"]!!.jsonPrimitive.content))
        }
        val summaries = fixture["summaries"]!!.jsonArray.map { it.jsonObject }
        assertTrue(summaries.size >= 100)
        for (s in summaries) {
            val job = s["job"]!!.jsonObject
            val proposals = job["proposals"]!!.jsonArray.map { it.jsonObject }.map {
                DeckCheckProposal(it["id"]!!.jsonPrimitive.content, "pinyin", "tone_change", "", "", "", applied = it["applied"]?.jsonPrimitive?.booleanOrNull ?: false)
            }
            assertEquals(
                s["out"]!!.jsonPrimitive.content,
                CardCheck.deckCheckSummary(job["status"]!!.jsonPrimitive.content, job["total"]!!.jsonPrimitive.int, job["checked"]!!.jsonPrimitive.int, proposals),
                "summary $job",
            )
        }
    }
}
