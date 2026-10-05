package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** In-call activities: CallActivities reproduces shared/call-activities exactly (parity/fixtures/call-activities.ts). */
class CallActivitiesParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "call-activities.json").readText()).jsonObject
    }

    private val j = CallActivities.json

    /** TS `null` and `undefined` mean the same here: drop null-valued keys everywhere. */
    private fun norm(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.filterValues { it !is JsonNull }.mapValues { norm(it.value) })
        is JsonArray -> JsonArray(e.map(::norm))
        else -> e
    }

    private fun spec(e: JsonElement) = j.decodeFromJsonElement(ActivitySpec.serializer(), e)
    private fun enc(s: ActivitySession) = norm(CallActivities.toJson(s))
    private fun strs(e: JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun ints(e: JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.int }
    private fun s(e: JsonElement?) = e?.takeIf { it !is JsonNull }?.jsonPrimitive?.content

    @Test fun catalogueIsTheSame() {
        val ts = root["catalogue"]!!.jsonArray
        val kt = j.encodeToJsonElement(ListSerializer(ActivitySpec.serializer()), ActivityCatalogue.ALL)
        assertEquals(norm(ts), norm(kt))
        assertEquals(strs(root["kinds"]), ActivityKinds.ALL)
        assertEquals(root["max_draft_chars"]!!.jsonPrimitive.int, CallActivities.MAX_DRAFT_CHARS)
        val info = root["kind_info"]!!.jsonObject.mapValues { (_, v) -> val o = v.jsonObject; ActivityKindInfo(s(o["icon"])!!, s(o["name"])!!, s(o["blurb"])!!) }
        assertEquals(info, CallActivities.KIND_INFO)
        assertEquals(info.keys.toList(), CallActivities.KIND_INFO.keys.toList())
        for (p in root["problems"]!!.jsonArray) {
            val o = p.jsonObject
            val sp = CallActivities.find(s(o["id"])!!) ?: fail("missing ${o["id"]}")
            assertEquals(strs(o["problems"]), CallActivities.validate(sp))
            assertEquals(o["total"]!!.jsonPrimitive.int, CallActivities.totalRounds(sp))
            if (o["blanks_a"] !is JsonNull) {
                assertEquals(strs(o["blanks_a"]), CallActivities.blanksFor(sp, "a"))
                assertEquals(strs(o["blanks_b"]), CallActivities.blanksFor(sp, "b"))
            }
        }
        for (c in root["cell_keys"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(s(o["key"]), CallActivities.cellKey(o["row"]!!.jsonPrimitive.int, o["col"]!!.jsonPrimitive.int))
        }
        for (i in root["invalid"]!!.jsonArray) {
            val o = i.jsonObject
            val sp = spec(o["spec"]!!)
            assertEquals(strs(o["problems"]), CallActivities.validate(sp))
            assertEquals(o["total"]!!.jsonPrimitive.int, CallActivities.totalRounds(sp))
        }
    }

    @Test fun shufflesMatch() {
        val hashes = root["hashes"]!!.jsonArray
        assertTrue(hashes.size >= 300)
        for (h in hashes) assertEquals(h.jsonObject["h"]!!.jsonPrimitive.long, CallActivities.hash32(s(h.jsonObject["s"])!!), "hash32 $h")
        for (sh in root["shuffles"]!!.jsonArray) {
            val o = sh.jsonObject
            assertEquals(ints(o["out"]), CallActivities.seededShuffle(ints(o["items"]), s(o["key"])!!), "shuffle $o")
        }
        val options = root["options"]!!.jsonArray
        assertTrue(options.size > 100)
        for (op in options) {
            val o = op.jsonObject
            val sp = CallActivities.find(s(o["id"])!!)!!
            assertEquals(strs(o["out"]), CallActivities.describeOptions(sp, s(o["sid"])!!, o["round"]!!.jsonPrimitive.int), "options $o")
        }
        for (p in root["pools"]!!.jsonArray) {
            val o = p.jsonObject
            val sp = o["spec"]?.let(::spec) ?: CallActivities.find(s(o["id"])!!)!!
            assertEquals(ints(o["out"]), CallActivities.buildPool(sp, s(o["sid"])!!, o["round"]!!.jsonPrimitive.int), "pool $o")
        }
    }

    private fun checkView(label: String, view: JsonElement?, s: ActivitySession?) {
        if (s == null) {
            assertTrue(view == null || view is JsonNull, "$label view")
            return
        }
        val v = view!!.jsonObject
        assertEquals(norm(v["summary"]!!), norm(j.encodeToJsonElement(ActivitySummary.serializer(), CallActivities.summary(s))), "$label summary")
        val score = v["score"]!!.jsonObject
        assertEquals(CallActivities.Score(score["correct"]!!.jsonPrimitive.int, score["scored"]!!.jsonPrimitive.int), CallActivities.scoreOf(s), "$label score")
        for ((u, roles) in v["roles_of"]!!.jsonObject) assertEquals(strs(roles), CallActivities.rolesOf(s, u), "$label rolesOf $u")
        if (v["built"] !is JsonNull) assertEquals(s(v["built"]), CallActivities.builtText(s.spec, s.round, s.data.placed.orEmpty()), "$label built")
        assertEquals(s(v["round_title"]), CallActivities.roundTitle(s.spec, s.round), "$label roundTitle")
        v["review_marks"]?.takeIf { it !is JsonNull }?.let { marks ->
            val got = s.spec.itemList.indices.map { CallActivities.reviewMarkOf(s, it) }
            val want = marks.jsonArray.map { m -> m.takeIf { it !is JsonNull }?.let { j.decodeFromJsonElement(ReviewMark.serializer(), it) } }
            assertEquals(want, got, "$label reviewMarkOf")
        }
    }

    /** Replays [steps] from [first] in Kotlin; every session (or refusal) must equal the TS one. */
    private fun replay(label: String, first: ActivitySession, steps: JsonArray): Int {
        var cur = first
        var applied = 0
        for ((k, stepEl) in steps.withIndex()) {
            val st = stepEl.jsonObject
            val actor = s(st["actor"])!!
            val now = st["now"]!!.jsonPrimitive.long
            val want = st["session"]!!.takeIf { it !is JsonNull }
            val tag = "$label step $k ${st["action"] ?: st["join"]}"
            val got: ActivitySession? = st["join"]?.let { jn ->
                val o = jn.jsonObject
                CallActivities.join(cur, s(o["user"])!!, s(o["name"])!!, s(o["tutor"]), now)
            } ?: if (st["join"] == null) CallActivities.reduce(cur, ActivityAction.parse(st["action"]), actor, now) else null
            if (want == null) assertNull(got, "$tag: TS refused, Kotlin applied")
            else {
                assertNotNull(got, "$tag: TS applied, Kotlin refused")
                assertEquals(norm(want), enc(got), tag)
                // The room's JSON reads back to the same session.
                assertEquals(got, CallActivities.parseSession(want), "$tag parse")
                applied++
            }
            checkView(tag, st["view"], got)
            if (got != null) cur = got
        }
        return applied
    }

    @Test fun everyCatalogueRunMatches() {
        val runs = root["runs"]!!.jsonArray
        assertTrue(runs.size >= ActivityCatalogue.ALL.size * 12)
        val seen = HashSet<String>()
        var applied = 0
        for (runEl in runs) {
            val run = runEl.jsonObject
            val id = s(run["id"])!!
            seen += id
            val st = run["start"]!!.jsonObject
            val sp = CallActivities.find(id)!!
            val first = CallActivities.start(
                sp,
                CallActivities.StartOptions(
                    sessionId = s(st["session_id"])!!, starter = s(st["starter"])!!, tutor = s(st["tutor"]),
                    present = strs(st["present"]), names = st["names"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, now = st["now"]!!.jsonPrimitive.long,
                ),
            )
            val label = "$id (${s(run["label"])})"
            assertEquals(norm(run["first"]!!), enc(first), "$label start")
            checkView("$label start", run["first_view"], first)
            applied += replay(label, first, run["steps"]!!.jsonArray)
        }
        assertEquals(ActivityCatalogue.ALL.map { it.id }.toSet(), seen)
        assertTrue(applied > 3000, "applied $applied")
    }

    @Test fun reviewTogetherMatches() {
        assertEquals(root["max_review_comment_chars"]!!.jsonPrimitive.int, CallActivities.MAX_REVIEW_COMMENT_CHARS)
        assertEquals(s(root["review_activity_id"]), CallActivities.REVIEW_ACTIVITY_ID)
        assertTrue(ActivityKinds.REVIEW !in ActivityKinds.ALL)
        val inv = root["review_invalid"]!!.jsonObject
        assertEquals(strs(inv["problems"]), CallActivities.validate(spec(inv["spec"]!!)))
        val runs = root["review_runs"]!!.jsonArray
        assertTrue(runs.size >= 30)
        var applied = 0
        for (runEl in runs) {
            val run = runEl.jsonObject
            val label = s(run["label"])!!
            val sp = spec(run["spec"]!!)
            assertEquals(norm(run["spec"]!!), norm(j.encodeToJsonElement(ActivitySpec.serializer(), sp)), "$label spec round trip")
            assertEquals(strs(run["problems"]), CallActivities.validate(sp), "$label problems")
            assertEquals(run["total"]!!.jsonPrimitive.int, CallActivities.totalRounds(sp), "$label total")
            val st = run["start"]!!.jsonObject
            val first = CallActivities.start(
                sp,
                CallActivities.StartOptions(
                    sessionId = s(st["session_id"])!!, starter = s(st["starter"])!!, tutor = s(st["tutor"]),
                    present = strs(st["present"]), names = st["names"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }, now = st["now"]!!.jsonPrimitive.long,
                ),
            )
            assertEquals(norm(run["first"]!!), enc(first), "$label start")
            checkView("$label start", run["first_view"], first)
            applied += replay(label, first, run["steps"]!!.jsonArray)
        }
        assertTrue(applied > 250, "applied $applied")
    }

    @Test fun reviewActionsReadBack() {
        for (a in listOf(ActivityAction.Select(2), ActivityAction.PlayClip("reference"), ActivityAction.MarkReview("needs_work", "shí"), ActivityAction.MarkReview("listened")))
            assertEquals(a, ActivityAction.parse(a.toJson()))
    }

    @Test fun oddSpecsMatch() {
        for (runEl in root["odd_runs"]!!.jsonArray) {
            val run = runEl.jsonObject
            val sp = spec(run["spec"]!!)
            assertEquals(strs(run["problems"]), CallActivities.validate(sp))
            val first = CallActivities.parseSession(run["first"]!!)!!
            assertEquals(norm(run["first"]!!), enc(first), "odd ${sp.id} start")
            val started = CallActivities.start(sp, CallActivities.StartOptions(first.sessionId, "tutor-1", "tutor-1", listOf("tutor-1", "student-1"), mapOf("tutor-1" to "Minghui", "student-1" to "Jerome"), 5))
            assertEquals(enc(first), enc(started), "odd ${sp.id} start (Kotlin)")
            replay("odd ${sp.id}", started, run["steps"]!!.jsonArray)
            run["blanks"]?.takeIf { it !is JsonNull }?.jsonObject?.let {
                assertEquals(strs(it["a"]), CallActivities.blanksFor(sp, "a"))
                assertEquals(strs(it["b"]), CallActivities.blanksFor(sp, "b"))
            }
        }
    }
}
