package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import kotlinx.serialization.json.Json
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
 * 📺 Watch: core/…/watch/Watch.kt reproduces shared/watch/video.ts (the link parser, the URLs, the
 * shows) and shared/watch/lines.ts (the line on screen, seek / pause points, "Pause after each
 * line", ⏮ / ⏭, the listen-first reveal, speeds, clock, resume, status line) exactly
 * (parity/fixtures/watch.ts → watch.json).
 */
class WatchParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val f by lazy { fixture("watch.json") }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.longOrNull: Long? get() = if (this is JsonNull) null else jsonPrimitive.long
    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int

    @Test
    fun parsesLinks() {
        val cases = f["parse"]!!.jsonArray
        assertTrue(cases.size > 30)
        for (c in cases.map { it.jsonObject }) {
            val input = c["input"]!!.str!!
            assertEquals(c["url"]!!.str, Watch.firstUrlIn(input), "firstUrlIn($input)")
            assertEquals(c["id"]!!.str, Watch.parseYouTubeVideoId(input), "parseYouTubeVideoId($input)")
        }
    }

    @Test
    fun urlsAndShows() {
        val u = f["urls"]!!.jsonObject
        val id = "dQw4w9WgXcQ"
        assertEquals(u["watch"]!!.str, Watch.youtubeWatchUrl(id))
        assertEquals(u["thumb"]!!.str, Watch.youtubeThumbnailUrl(id))
        assertEquals(u["search"]!!.str, Watch.youtubeSearchUrl("小欢喜 第1集"))
        assertEquals(u["shows"]!!.jsonArray.map { it.str }, Watch.SHOWS.map { Watch.youtubeSearchUrl(it.query) })
    }

    @Test
    fun lineRules() {
        val cases = f["lineCases"]!!.jsonArray.map { it.jsonObject }
        assertEquals(160, cases.size)
        var probes = 0
        for ((n, c) in cases.withIndex()) {
            val lines = c["lines"]!!.jsonArray.map { it.jsonObject }.map { Watch.Span(it["start_ms"]!!.jsonPrimitive.long, it["end_ms"]!!.jsonPrimitive.long) }
            for ((i, p) in c["per"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
                assertEquals(p["seek"]!!.jsonPrimitive.long, Watch.lineSeekMs(lines, i), "case $n seek $i")
                assertEquals(p["pause"]!!.jsonPrimitive.long, Watch.linePauseMs(lines, i), "case $n pause $i")
            }
            for (p in c["probes"]!!.jsonArray.map { it.jsonObject }) {
                val ms = p["ms"]!!.jsonPrimitive.long
                val prev = p["prev"]!!.jsonPrimitive.long
                val focus = p["focus"]!!.intOrNull
                val playing = p["playing"]!!.jsonPrimitive.boolean
                val where = "case $n ms=$ms prev=$prev focus=$focus playing=$playing"
                assertEquals(p["at"]!!.jsonPrimitive.int, Watch.lineIndexAt(lines, ms), "$where at")
                assertEquals(p["active"]!!.jsonPrimitive.int, Watch.activeLineIndex(lines, ms, focus, playing), "$where active")
                assertEquals(p["holds"]!!.jsonPrimitive.boolean, Watch.focusStillHolds(lines, ms, focus, playing), "$where holds")
                assertEquals(p["crossed"]!!.intOrNull, Watch.lineEndCrossed(lines, prev, ms, focus), "$where crossed")
                probes++
            }
            for (s in c["steps"]!!.jsonArray.map { it.jsonObject }) {
                val cur = s["cur"]!!.jsonPrimitive.int
                assertEquals(s["prev"]!!.jsonPrimitive.int, Watch.stepLine(lines.size, cur, -1), "case $n prev from $cur")
                assertEquals(s["next"]!!.jsonPrimitive.int, Watch.stepLine(lines.size, cur, 1), "case $n next from $cur")
            }
        }
        assertTrue(probes > 1000)
    }

    @Test
    fun revealsAndSpeeds() {
        for (r in f["reveals"]!!.jsonArray.map { it.jsonObject }) {
            val cur = Watch.Reveal.of(r["cur"]!!.str)
            assertEquals(r["cur"]!!.str, cur.wire)
            assertEquals(r["next"]!!.str, Watch.nextReveal(cur, r["p"]!!.jsonPrimitive.boolean, r["e"]!!.jsonPrimitive.boolean).wire, "reveal $r")
        }
        for (s in f["speeds"]!!.jsonArray.map { it.jsonObject }) {
            val speed = s["speed"]!!.jsonPrimitive.double
            assertEquals(s["next"]!!.jsonPrimitive.double, Watch.nextSpeed(speed), "next $speed")
            assertEquals(s["label"]!!.str, Watch.speedLabel(speed), "label $speed")
        }
        for (s in f["speedParse"]!!.jsonArray.map { it.jsonObject }) {
            val raw: Any? = when (val e = s["raw"]!!) {
                is JsonNull -> null
                is JsonPrimitive -> if (e.isString) e.content else e.double
                else -> fail("raw $e")
            }
            assertEquals(s["speed"]!!.jsonPrimitive.double, Watch.parseSpeed(raw), "parse $raw")
        }
    }

    @Test
    fun labels() {
        for (c in f["clocks"]!!.jsonArray.map { it.jsonObject }) {
            val ms = c["ms"]!!.jsonPrimitive.long
            assertEquals(c["label"]!!.str, Watch.clock(ms), "clock $ms")
        }
        for (c in f["resumes"]!!.jsonArray.map { it.jsonObject }) {
            val p = c["p"]!!.longOrNull
            val d = c["d"]!!.longOrNull
            assertEquals(c["resume"]!!.jsonPrimitive.long, Watch.resumeAtMs(p, d), "resume $p $d")
            assertEquals(c["fraction"]!!.jsonPrimitive.double, Watch.watchedFraction(p, d), "fraction $p $d")
        }
        for (c in f["statuses"]!!.jsonArray.map { it.jsonObject }) {
            val v = c["v"]!!.jsonObject
            fun i(k: String) = v[k]?.intOrNull
            val line = Watch.statusLine(v["status"]!!.str, i("chunks_done"), i("chunks_total"), i("progress_done"), i("progress_total"), v["error"]?.str)
            assertEquals(c["line"]!!.str, line, "status $v")
            assertEquals(c["working"]!!.jsonPrimitive.boolean, Watch.isWorking(v["status"]!!.str), "working $v")
        }
    }
}
