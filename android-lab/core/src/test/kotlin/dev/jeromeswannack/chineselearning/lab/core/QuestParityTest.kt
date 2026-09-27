package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
 * The quest engine must play a world exactly like the web: parity/fixtures/quest.ts plays
 * ~260 generated worlds (plus the hand-written kitchen) with recorded action sequences on
 * shared/quest/engine.ts; this replays every action on [QuestEngine] and compares the
 * result (ok / rejection / goals completed / finished) and the whole state after it —
 * positions, object states, carrying, reveals, sequence progress, verbs offered, reach.
 */
class QuestParityTest {
    private val games: JsonArray by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "quest.json").readText()).jsonObject["games"]!!.jsonArray
    }

    private fun action(o: JsonObject): QuestPlayerAction? = when (o["type"]!!.jsonPrimitive.content) {
        "move" -> QuestPlayerAction.Move(QuestDirection.of(o["direction"]!!.jsonPrimitive.content))
        "pick_up" -> QuestPlayerAction.PickUp(o["object"]!!.jsonPrimitive.content)
        "put_down" -> QuestPlayerAction.PutDown(o["object"]!!.jsonPrimitive.content)
        "interact" -> QuestPlayerAction.Interact(o["object"]!!.jsonPrimitive.content, o["action"]!!.jsonPrimitive.content)
        else -> null
    }

    private fun strs(e: JsonElement) = e.jsonArray.map { it.jsonPrimitive.content }

    private fun snapshot(s: QuestState): Map<String, Any?> = mapOf(
        "player" to listOf(s.player.x, s.player.y),
        "objects" to s.world.objects.map { o ->
            val r = s.objects.getValue(o.id)
            listOf(o.id, r.x, r.y, r.state, r.held, r.removed, r.revealed, QuestEngine.isVisible(s, o.id), QuestEngine.emojiFor(o, r))
        },
        "held" to s.held,
        "sequenceProgress" to s.sequenceProgress.entries.sortedBy { it.key }.map { listOf(it.key, it.value) },
        "performed" to s.performed.map { listOf(it.obj, it.action) },
        "completedGoals" to s.completedGoals,
        "activeGoalIndex" to s.activeGoalIndex,
        "moves" to s.moves,
        "finished" to s.finished,
        "reach" to QuestEngine.objectsInReach(s).map { it.id },
        "verbs" to QuestEngine.availableActions(s).map { listOf(it.obj.id, it.action.id) },
        "canMove" to QuestDirection.entries.map { QuestEngine.canMove(s, it) },
        "canPickUp" to s.world.objects.map { QuestEngine.canPickUp(s, it) },
        "progress" to QuestEngine.activeGoalProgress(s)?.let { mapOf("done" to it.first, "total" to it.second) },
    )

    /** JSON → plain Kotlin values, so a whole snapshot compares with one assertEquals. */
    private fun plain(e: JsonElement): Any? = when (e) {
        is JsonNull -> null
        is JsonArray -> e.map(::plain)
        is JsonObject -> e.mapValues { plain(it.value) }
        is JsonPrimitive -> when {
            e.isString -> e.content
            e.content == "true" || e.content == "false" -> e.boolean
            else -> e.int
        }
    }

    @Test
    fun replaysEveryRecordedGameIdentically() {
        var steps = 0
        var goals = 0
        var finishes = 0
        for ((g, gameEl) in games.withIndex()) {
            val game = gameEl.jsonObject
            val world = QuestWorld.parse(game["world"]!!)
            var state = QuestEngine.create(world)
            assertEquals(plain(game["initial"]!!), snapshot(state), "game $g initial")
            game["conditionObjects"]!!.jsonArray.forEachIndexed { i, ids ->
                assertEquals(strs(ids), QuestEngine.conditionObjectIds(world.goals[i].condition), "game $g goal $i objects")
            }
            for ((i, stepEl) in game["steps"]!!.jsonArray.withIndex()) {
                val step = stepEl.jsonObject
                val where = "game $g step $i ${step["action"]}"
                val a = action(step["action"]!!.jsonObject)
                if (a == null) {
                    state = QuestEngine.reset(state)
                } else {
                    val r = QuestEngine.apply(state, a)
                    assertEquals(step["ok"]!!.jsonPrimitive.boolean, r.ok, "$where ok")
                    assertEquals(step["rejection"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }, r.rejection?.wire, "$where rejection")
                    assertEquals(strs(step["completedGoals"]!!), r.completedGoals, "$where completedGoals")
                    assertEquals(step["justFinished"]!!.jsonPrimitive.boolean, r.justFinished, "$where justFinished")
                    if (!r.ok) assertTrue(r.state === state, "$where: a refused action leaves the state untouched")
                    goals += r.completedGoals.size
                    if (r.justFinished) finishes++
                    state = r.state
                }
                assertEquals(plain(step["snapshot"]!!), snapshot(state), "$where snapshot")
                steps++
            }
        }
        assertTrue(steps > 10_000, "only $steps steps")
        assertTrue(goals > 100 && finishes > 30, "fixtures stopped completing goals: $goals goals, $finishes finishes")
    }
}
