package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.Drill
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillQuestion
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillTarget
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
 * The explorer's quick drills must match the web exactly (parity/fixtures/explorer-drill.ts →
 * explorer-drill.json, from shared/explorer/drill.ts): mulberry32 doubles bit for bit, shuffles,
 * buildDrill over many seeds / pools / targets / maxima, shortGloss and drillScoreLine.
 */
class DrillParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "explorer-drill.json").readText()).jsonObject
    }

    private fun JsonElement?.str(): String? = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun word(e: JsonElement): DictWord {
        val o = e.jsonObject
        return DictWord(o["hanzi"].str()!!, o["pinyin"].str()!!, o["english"].str()!!)
    }

    @Test
    fun constantsMatchTypeScript() {
        val c = fixture["constants"]!!.jsonObject
        assertEquals(c["max"]!!.jsonPrimitive.int, Drill.MAX)
        assertEquals(c["min"]!!.jsonPrimitive.int, Drill.MIN)
        assertEquals(c["options"]!!.jsonPrimitive.int, Drill.OPTIONS)
    }

    @Test
    fun seededRandomIsBitIdentical() {
        for (case in fixture["random"]!!.jsonArray) {
            val o = case.jsonObject
            val r = Drill.seededRandom(o["seed"]!!.jsonPrimitive.long)
            for ((i, v) in o["values"]!!.jsonArray.withIndex()) {
                val expected = v.jsonPrimitive.double
                val got = r()
                assertEquals(expected.toRawBits(), got.toRawBits(), "seed ${o["seed"]} value $i: $expected vs $got")
            }
        }
    }

    @Test
    fun shuffledMatches() {
        for (case in fixture["shuffles"]!!.jsonArray) {
            val o = case.jsonObject
            val items = o["items"]!!.jsonArray.map { it.str()!! }
            val out = Drill.shuffled(items, Drill.seededRandom(o["seed"]!!.jsonPrimitive.long))
            assertEquals(o["out"]!!.jsonArray.map { it.str()!! }, out)
        }
    }

    @Test
    fun buildDrillMatches() {
        val all = fixture["all"]!!.jsonArray.map(::word)
        val drills = fixture["drills"]!!.jsonArray
        assertTrue(drills.size > 150)
        var nonEmpty = 0
        for ((n, case) in drills.withIndex()) {
            val o = case.jsonObject
            val t = o["target"]!!.jsonObject
            val target = if (t["kind"].str() == "char") DrillTarget.Char(t["char"].str()!!)
            else DrillTarget.Word(word(t["word"]!!), (t["syllables"] as? kotlinx.serialization.json.JsonArray)?.map { it.str()!! })
            // Indices into ALL: a word picked twice is the same instance, as in the TypeScript.
            val pool = o["pool"]!!.jsonArray.map { all[it.jsonPrimitive.int] }
            val seed = o["seed"]!!.jsonPrimitive.long
            val max = o["max"].str()?.toInt()
            val got = if (max == null) Drill.buildDrill(target, pool, seed) else Drill.buildDrill(target, pool, seed, max)
            val expected = o["out"]!!.jsonArray.map { q ->
                val qo = q.jsonObject
                DrillQuestion(
                    kind = DrillKind.of(qo["kind"].str()!!),
                    prompt = qo["prompt"].str()!!,
                    context = qo["context"].str(),
                    pinyin = qo["pinyin"].str(),
                    options = qo["options"]!!.jsonArray.map { it.str()!! },
                    answer = qo["answer"]!!.jsonPrimitive.int,
                )
            }
            assertEquals(expected, got, "drill #$n target=$t pool=${o["pool"]} seed=$seed max=$max")
            if (got.isNotEmpty()) nonEmpty++
        }
        assertTrue(nonEmpty > 80)
    }

    @Test
    fun helpersMatch() {
        for (g in fixture["glosses"]!!.jsonArray) assertEquals(g.jsonObject["out"].str(), Drill.shortGloss(g.jsonObject["s"].str()!!))
        for (s in fixture["scores"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(o["out"].str(), Drill.scoreLine(o["correct"]!!.jsonPrimitive.int, o["total"]!!.jsonPrimitive.int))
        }
    }
}
