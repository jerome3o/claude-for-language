package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.math.abs

/*
 * Quests — port of shared/quest/types.ts + engine.ts: the pure, deterministic state machine
 * for the tile-map lessons. Every rule (walking, reach, carrying, verbs, hidden objects,
 * goal conditions incl. sequence / all_of / any_of) lives here; the UI only renders.
 * QuestParityTest replays recorded action sequences on generated worlds against the web's
 * engine and compares every state.
 */

data class QuestText(val hanzi: String, val pinyin: String, val english: String)

data class QuestTerrain(val key: String, val hanzi: String, val pinyin: String, val english: String, val color: String, val emoji: String?, val walkable: Boolean)

data class QuestObjectState(val id: String, val hanzi: String, val pinyin: String, val english: String, val emoji: String?, val blocksMovement: Boolean?)

data class QuestObjectAction(
    val id: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val requiresState: String? = null,
    val requiresHolding: String? = null,
    val setsState: String? = null,
    val removesObject: Boolean = false,
)

data class QuestHidden(val obj: String, val state: String)

data class QuestObject(
    val id: String,
    val emoji: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val x: Int,
    val y: Int,
    val portable: Boolean,
    val surface: Boolean,
    val blocksMovement: Boolean,
    val states: List<QuestObjectState> = emptyList(),
    val initialState: String? = null,
    val actions: List<QuestObjectAction> = emptyList(),
    val hiddenUntil: QuestHidden? = null,
)

/** Port of `QuestCondition`. */
sealed interface QuestCondition {
    data class Holding(val obj: String) : QuestCondition
    data class NotHolding(val obj: String) : QuestCondition
    data class ObjectAt(val obj: String, val x: Int, val y: Int) : QuestCondition
    data class ObjectOn(val obj: String, val target: String) : QuestCondition
    data class ObjectOnTerrain(val obj: String, val terrain: String) : QuestCondition
    data class PlayerAt(val x: Int, val y: Int) : QuestCondition
    data class PlayerOnTerrain(val terrain: String) : QuestCondition
    data class PlayerNextTo(val obj: String) : QuestCondition
    data class ObjectState(val obj: String, val state: String) : QuestCondition
    data class ObjectRemoved(val obj: String) : QuestCondition
    data class Performed(val obj: String, val action: String) : QuestCondition
    data class AllOf(val conditions: List<QuestCondition>) : QuestCondition
    data class AnyOf(val conditions: List<QuestCondition>) : QuestCondition
    data class Sequence(val conditions: List<QuestCondition>) : QuestCondition
    /** A condition type this build doesn't know: never satisfied (the web's switch falls through to undefined). */
    data class Unknown(val type: String) : QuestCondition
}

data class QuestGoal(val id: String, val instruction: QuestText, val hint: QuestText?, val success: QuestText?, val condition: QuestCondition)

data class QuestGlossaryEntry(val hanzi: String, val pinyin: String, val english: String, val pos: String, val note: String?)

data class QuestPlayer(val emoji: String, val x: Int, val y: Int)

data class QuestWorld(
    val title: QuestText,
    val scenario: QuestText,
    val width: Int,
    val height: Int,
    val terrain: List<QuestTerrain>,
    val grid: List<String>,
    val player: QuestPlayer,
    val carryLimit: Int,
    val objects: List<QuestObject>,
    val goals: List<QuestGoal>,
    val glossary: List<QuestGlossaryEntry>,
) {
    // First wins, like Array.find on the web.
    private val byId: Map<String, QuestObject> = LinkedHashMap<String, QuestObject>().also { m -> objects.forEach { m.putIfAbsent(it.id, it) } }
    fun find(id: String): QuestObject? = byId[id]

    companion object {
        /** Parses the server's world JSON (`quests.world`). Lenient about optional fields, like the web. */
        fun parse(el: JsonElement): QuestWorld {
            val o = el as JsonObject
            return QuestWorld(
                title = text(o["title"]),
                scenario = text(o["scenario"]),
                width = o.int("width"),
                height = o.int("height"),
                terrain = o.arr("terrain").map { t ->
                    t as JsonObject
                    QuestTerrain(t.str("key"), t.str("hanzi"), t.str("pinyin"), t.str("english"), t.str("color"), t.strOrNull("emoji"), t.bool("walkable"))
                },
                grid = o.arr("grid").map { (it as JsonPrimitive).content },
                player = (o["player"] as JsonObject).let { QuestPlayer(it.str("emoji"), it.int("x"), it.int("y")) },
                carryLimit = (o["carry_limit"] as? JsonPrimitive)?.intOrNull ?: 1,
                objects = o.arr("objects").map { parseObject(it as JsonObject) },
                goals = o.arr("goals").map { g ->
                    g as JsonObject
                    QuestGoal(g.str("id"), text(g["instruction"]), textOrNull(g["hint"]), textOrNull(g["success"]), condition(g["condition"]!!))
                },
                glossary = o.arr("glossary").map { e ->
                    e as JsonObject
                    QuestGlossaryEntry(e.str("hanzi"), e.str("pinyin"), e.str("english"), e.strOrNull("pos") ?: "other", e.strOrNull("note"))
                },
            )
        }

        private fun parseObject(o: JsonObject) = QuestObject(
            id = o.str("id"), emoji = o.str("emoji"), hanzi = o.str("hanzi"), pinyin = o.str("pinyin"), english = o.str("english"),
            x = o.int("x"), y = o.int("y"),
            portable = o.bool("portable"), surface = o.bool("surface"), blocksMovement = o.bool("blocks_movement"),
            states = o.arr("states").map { s ->
                s as JsonObject
                QuestObjectState(s.str("id"), s.str("hanzi"), s.str("pinyin"), s.str("english"), s.strOrNull("emoji"), (s["blocks_movement"] as? JsonPrimitive)?.booleanOrNull)
            },
            initialState = o.strOrNull("initial_state"),
            actions = o.arr("actions").map { a ->
                a as JsonObject
                QuestObjectAction(
                    a.str("id"), a.str("hanzi"), a.str("pinyin"), a.str("english"),
                    a.strOrNull("requires_state"), a.strOrNull("requires_holding"), a.strOrNull("sets_state"),
                    (a["removes_object"] as? JsonPrimitive)?.booleanOrNull == true,
                )
            },
            hiddenUntil = (o["hidden_until"] as? JsonObject)?.let { QuestHidden(it.str("object"), it.str("state")) },
        )

        fun condition(el: JsonElement): QuestCondition {
            val c = el as JsonObject
            fun kids() = c.arr("conditions").map(::condition)
            return when (val type = c.str("type")) {
                "holding" -> QuestCondition.Holding(c.str("object"))
                "not_holding" -> QuestCondition.NotHolding(c.str("object"))
                "object_at" -> QuestCondition.ObjectAt(c.str("object"), c.int("x"), c.int("y"))
                "object_on" -> QuestCondition.ObjectOn(c.str("object"), c.str("target"))
                "object_on_terrain" -> QuestCondition.ObjectOnTerrain(c.str("object"), c.str("terrain"))
                "player_at" -> QuestCondition.PlayerAt(c.int("x"), c.int("y"))
                "player_on_terrain" -> QuestCondition.PlayerOnTerrain(c.str("terrain"))
                "player_next_to" -> QuestCondition.PlayerNextTo(c.str("object"))
                "object_state" -> QuestCondition.ObjectState(c.str("object"), c.str("state"))
                "object_removed" -> QuestCondition.ObjectRemoved(c.str("object"))
                "performed" -> QuestCondition.Performed(c.str("object"), c.str("action"))
                "all_of" -> QuestCondition.AllOf(kids())
                "any_of" -> QuestCondition.AnyOf(kids())
                "sequence" -> QuestCondition.Sequence(kids())
                else -> QuestCondition.Unknown(type)
            }
        }

        private fun text(el: JsonElement?): QuestText = textOrNull(el) ?: QuestText("", "", "")
        private fun textOrNull(el: JsonElement?): QuestText? {
            val o = el as? JsonObject ?: return null
            return QuestText(o.strOrNull("hanzi") ?: "", o.strOrNull("pinyin") ?: "", o.strOrNull("english") ?: "")
        }

        private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull ?: ""
        private fun JsonObject.strOrNull(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
        private fun JsonObject.int(k: String) = (this[k] as? JsonPrimitive)?.intOrNull ?: 0
        private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false
        private fun JsonObject.arr(k: String): List<JsonElement> = (this[k] as? JsonArray) ?: emptyList()
    }
}

// ---------------- engine.ts ----------------

data class QuestObjectRuntime(val x: Int, val y: Int, val state: String?, val held: Boolean, val removed: Boolean, val revealed: Boolean)

data class QuestPerformed(val obj: String, val action: String)

data class QuestPos(val x: Int, val y: Int)

/** Port of `QuestState` (immutable). */
data class QuestState(
    val world: QuestWorld,
    val player: QuestPos,
    /** Insertion order = world.objects order. */
    val objects: Map<String, QuestObjectRuntime>,
    /** Object ids being carried, in pick-up order. */
    val held: List<String>,
    val sequenceProgress: Map<String, Int>,
    val performed: List<QuestPerformed>,
    val completedGoals: List<String>,
    /** Index of the goal being worked on; == goals.size when done. */
    val activeGoalIndex: Int,
    val moves: Int,
    val finished: Boolean,
)

enum class QuestDirection(val wire: String, val dx: Int, val dy: Int) {
    UP("up", 0, -1), DOWN("down", 0, 1), LEFT("left", -1, 0), RIGHT("right", 1, 0);

    companion object { fun of(s: String) = entries.first { it.wire == s } }
}

sealed interface QuestPlayerAction {
    data class Move(val direction: QuestDirection) : QuestPlayerAction
    data class PickUp(val obj: String) : QuestPlayerAction
    data class PutDown(val obj: String) : QuestPlayerAction
    data class Interact(val obj: String, val action: String) : QuestPlayerAction
}

enum class QuestRejection(val wire: String) {
    BLOCKED("blocked"), OUT_OF_BOUNDS("out_of_bounds"), OUT_OF_REACH("out_of_reach"), NOT_PORTABLE("not_portable"),
    HANDS_FULL("hands_full"), NOT_HELD("not_held"), UNKNOWN_OBJECT("unknown_object"), UNKNOWN_ACTION("unknown_action"),
    ACTION_UNAVAILABLE("action_unavailable"),
}

data class QuestActionResult(
    val state: QuestState,
    val ok: Boolean,
    val rejection: QuestRejection? = null,
    val completedGoals: List<String> = emptyList(),
    val justFinished: Boolean = false,
)

data class QuestVerb(val obj: QuestObject, val action: QuestObjectAction)

object QuestEngine {
    fun create(world: QuestWorld): QuestState {
        val objects = LinkedHashMap<String, QuestObjectRuntime>()
        for (obj in world.objects) {
            objects[obj.id] = QuestObjectRuntime(obj.x, obj.y, initialStateOf(obj), held = false, removed = false, revealed = obj.hiddenUntil == null)
        }
        val state = QuestState(
            world = world,
            player = QuestPos(world.player.x, world.player.y),
            objects = objects,
            held = emptyList(),
            sequenceProgress = emptyMap(),
            performed = emptyList(),
            completedGoals = emptyList(),
            activeGoalIndex = 0,
            moves = 0,
            finished = world.goals.isEmpty(),
        )
        return advance(state).state
    }

    private fun initialStateOf(obj: QuestObject): String? {
        if (obj.states.isEmpty()) return null
        val initial = obj.initialState
        if (!initial.isNullOrEmpty() && obj.states.any { it.id == initial }) return initial
        return obj.states[0].id
    }

    // ---------- lookups ----------

    fun terrainAt(world: QuestWorld, x: Int, y: Int): QuestTerrain? {
        if (y < 0 || y >= world.grid.size) return null
        val row = world.grid[y]
        if (x < 0 || x >= row.length) return null
        val key = row[x].toString()
        return world.terrain.firstOrNull { it.key == key }
    }

    /** The sprite to draw: the current state's emoji wins over the object's. */
    fun emojiFor(obj: QuestObject, runtime: QuestObjectRuntime?): String {
        val stateEmoji = obj.states.firstOrNull { it.id == runtime?.state }?.emoji
        return if (!stateEmoji.isNullOrEmpty()) stateEmoji else obj.emoji
    }

    fun currentStateOf(obj: QuestObject, state: QuestState): QuestObjectState? {
        val runtime = state.objects[obj.id]
        return obj.states.firstOrNull { it.id == runtime?.state }
    }

    fun isVisible(state: QuestState, id: String): Boolean {
        val r = state.objects[id] ?: return false
        if (r.removed) return false
        return r.revealed
    }

    private fun blocksMovement(obj: QuestObject, state: QuestState): Boolean =
        currentStateOf(obj, state)?.blocksMovement ?: obj.blocksMovement

    fun objectsAt(state: QuestState, x: Int, y: Int): List<QuestObject> = state.world.objects.filter { obj ->
        val r = state.objects[obj.id]
        r != null && !r.held && isVisible(state, obj.id) && r.x == x && r.y == y
    }

    fun objectsInReach(state: QuestState): List<QuestObject> {
        val (x, y) = state.player
        val tiles = listOf(x to y, x to y - 1, x to y + 1, x - 1 to y, x + 1 to y)
        val seen = HashSet<String>()
        val result = ArrayList<QuestObject>()
        for ((tx, ty) in tiles) for (obj in objectsAt(state, tx, ty)) if (seen.add(obj.id)) result += obj
        return result
    }

    fun heldObjects(state: QuestState): List<QuestObject> = state.held.mapNotNull { state.world.find(it) }

    fun canPickUp(state: QuestState, obj: QuestObject): Boolean {
        val r = state.objects[obj.id] ?: return false
        if (r.held || !obj.portable || !isVisible(state, obj.id)) return false
        if (state.held.size >= maxOf(1, state.world.carryLimit)) return false
        return objectsInReach(state).any { it.id == obj.id }
    }

    fun isActionAvailable(state: QuestState, obj: QuestObject, action: QuestObjectAction): Boolean {
        val r = state.objects[obj.id] ?: return false
        if (!isVisible(state, obj.id)) return false
        if (!action.requiresState.isNullOrEmpty() && r.state != action.requiresState) return false
        if (!action.requiresHolding.isNullOrEmpty() && action.requiresHolding !in state.held) return false
        if (!r.held && objectsInReach(state).none { it.id == obj.id }) return false
        return true
    }

    /** Every verb button to show right now, paired with its object. */
    fun availableActions(state: QuestState): List<QuestVerb> {
        val seen = HashSet<String>()
        val result = ArrayList<QuestVerb>()
        for (obj in heldObjects(state) + objectsInReach(state)) {
            if (!seen.add(obj.id)) continue
            for (a in obj.actions) if (isActionAvailable(state, obj, a)) result += QuestVerb(obj, a)
        }
        return result
    }

    fun canMove(state: QuestState, d: QuestDirection): Boolean = isWalkable(state, state.player.x + d.dx, state.player.y + d.dy)

    private fun isWalkable(state: QuestState, x: Int, y: Int): Boolean {
        val w = state.world
        if (x < 0 || y < 0 || x >= w.width || y >= w.height) return false
        val t = terrainAt(w, x, y) ?: return false
        if (!t.walkable) return false
        return objectsAt(state, x, y).none { blocksMovement(it, state) }
    }

    // ---------- actions ----------

    fun apply(state: QuestState, action: QuestPlayerAction): QuestActionResult = when (action) {
        is QuestPlayerAction.Move -> move(state, action.direction)
        is QuestPlayerAction.PickUp -> pickUp(state, action.obj)
        is QuestPlayerAction.PutDown -> putDown(state, action.obj)
        is QuestPlayerAction.Interact -> interact(state, action.obj, action.action)
    }

    private fun reject(state: QuestState, r: QuestRejection) = QuestActionResult(state, false, r)

    private fun move(state: QuestState, d: QuestDirection): QuestActionResult {
        val x = state.player.x + d.dx
        val y = state.player.y + d.dy
        if (x < 0 || y < 0 || x >= state.world.width || y >= state.world.height) return reject(state, QuestRejection.OUT_OF_BOUNDS)
        if (!isWalkable(state, x, y)) return reject(state, QuestRejection.BLOCKED)
        val objects = LinkedHashMap(state.objects)
        for (id in state.held) objects[id] = objects.getValue(id).copy(x = x, y = y)
        return advance(state.copy(player = QuestPos(x, y), moves = state.moves + 1, objects = objects))
    }

    private fun pickUp(state: QuestState, id: String): QuestActionResult {
        val obj = state.world.find(id)
        val r = state.objects[id]
        if (obj == null || r == null) return reject(state, QuestRejection.UNKNOWN_OBJECT)
        if (!isVisible(state, id) || r.held) return reject(state, QuestRejection.UNKNOWN_OBJECT)
        if (!obj.portable) return reject(state, QuestRejection.NOT_PORTABLE)
        if (objectsInReach(state).none { it.id == id }) return reject(state, QuestRejection.OUT_OF_REACH)
        if (state.held.size >= maxOf(1, state.world.carryLimit)) return reject(state, QuestRejection.HANDS_FULL)
        val objects = LinkedHashMap(state.objects)
        objects[id] = r.copy(held = true, x = state.player.x, y = state.player.y)
        return advance(state.copy(held = state.held + id, objects = objects, moves = state.moves + 1))
    }

    private fun putDown(state: QuestState, id: String): QuestActionResult {
        val r = state.objects[id] ?: return reject(state, QuestRejection.UNKNOWN_OBJECT)
        if (!r.held) return reject(state, QuestRejection.NOT_HELD)
        val objects = LinkedHashMap(state.objects)
        objects[id] = r.copy(held = false, x = state.player.x, y = state.player.y)
        return advance(state.copy(held = state.held.filter { it != id }, objects = objects, moves = state.moves + 1))
    }

    private fun interact(state: QuestState, id: String, actionId: String): QuestActionResult {
        val obj = state.world.find(id)
        val r = state.objects[id]
        if (obj == null || r == null) return reject(state, QuestRejection.UNKNOWN_OBJECT)
        val action = obj.actions.firstOrNull { it.id == actionId } ?: return reject(state, QuestRejection.UNKNOWN_ACTION)
        if (!isActionAvailable(state, obj, action)) return reject(state, QuestRejection.ACTION_UNAVAILABLE)
        var updated = r
        if (!action.setsState.isNullOrEmpty()) updated = updated.copy(state = action.setsState)
        if (action.removesObject) updated = updated.copy(removed = true, held = false)
        val objects = LinkedHashMap(state.objects)
        objects[id] = updated
        return advance(
            state.copy(
                objects = objects,
                held = if (action.removesObject) state.held.filter { it != id } else state.held,
                performed = state.performed + QuestPerformed(id, actionId),
                moves = state.moves + 1,
            ),
        )
    }

    fun reset(state: QuestState): QuestState = create(state.world)

    // ---------- progress ----------

    private fun advance(state: QuestState): QuestActionResult {
        var next = revealHidden(state)
        next = tickSequences(next)
        val completed = ArrayList<String>()
        val goals = next.world.goals
        var index = next.activeGoalIndex
        while (index < goals.size && evaluate(goals[index].condition, next, goalPath(index))) {
            completed += goals[index].id
            index++
            next = tickSequences(next)
        }
        if (completed.isNotEmpty() || index != next.activeGoalIndex) {
            next = next.copy(activeGoalIndex = index, completedGoals = next.completedGoals + completed, finished = index >= goals.size)
        }
        return QuestActionResult(next, true, null, completed, next.finished && !state.finished)
    }

    private fun revealHidden(state: QuestState): QuestState {
        var objects: LinkedHashMap<String, QuestObjectRuntime>? = null
        for (obj in state.world.objects) {
            val r = state.objects[obj.id] ?: continue
            val hidden = obj.hiddenUntil ?: continue
            if (r.revealed) continue
            val container = state.objects[hidden.obj]
            if (container != null && !container.removed && container.state == hidden.state) {
                if (objects == null) objects = LinkedHashMap(state.objects)
                objects[obj.id] = r.copy(revealed = true)
            }
        }
        return if (objects != null) state.copy(objects = objects) else state
    }

    private fun goalPath(i: Int) = "g$i"

    private fun tickSequences(state: QuestState): QuestState {
        var working = state
        for (pass in 0 until 8) {
            val next = tickSequencesOnce(working)
            if (next === working) break
            working = next
        }
        return working
    }

    private fun tickSequencesOnce(state: QuestState): QuestState {
        var progress: LinkedHashMap<String, Int>? = null
        fun walk(c: QuestCondition, path: String) {
            if (c is QuestCondition.Sequence) {
                var index = state.sequenceProgress[path] ?: 0
                var advanced = false
                while (index < c.conditions.size && evaluate(c.conditions[index], state, "$path.$index")) {
                    index++
                    advanced = true
                }
                if (advanced) {
                    val p = progress ?: LinkedHashMap(state.sequenceProgress).also { progress = it }
                    p[path] = index
                }
            }
            val kids = when (c) {
                is QuestCondition.Sequence -> c.conditions
                is QuestCondition.AllOf -> c.conditions
                is QuestCondition.AnyOf -> c.conditions
                else -> return
            }
            kids.forEachIndexed { i, child -> walk(child, "$path.$i") }
        }
        state.world.goals.forEachIndexed { i, g -> walk(g.condition, goalPath(i)) }
        return progress?.let { state.copy(sequenceProgress = it) } ?: state
    }

    /** Port of `evaluate`: is this condition satisfied right now? */
    fun evaluate(c: QuestCondition, state: QuestState, path: String): Boolean = when (c) {
        is QuestCondition.Holding -> c.obj in state.held
        is QuestCondition.NotHolding -> c.obj !in state.held
        is QuestCondition.ObjectAt -> state.objects[c.obj].let { r -> r != null && !r.held && !r.removed && r.x == c.x && r.y == c.y }
        is QuestCondition.ObjectOn -> {
            val r = state.objects[c.obj]
            val t = state.objects[c.target]
            r != null && t != null && !r.held && !r.removed && !t.removed && c.obj != c.target && r.x == t.x && r.y == t.y
        }
        is QuestCondition.ObjectOnTerrain -> {
            val r = state.objects[c.obj]
            if (r == null || r.held || r.removed) false else terrainAt(state.world, r.x, r.y)?.key == c.terrain
        }
        is QuestCondition.PlayerAt -> state.player.x == c.x && state.player.y == c.y
        is QuestCondition.PlayerOnTerrain -> terrainAt(state.world, state.player.x, state.player.y)?.key == c.terrain
        is QuestCondition.PlayerNextTo -> {
            val r = state.objects[c.obj]
            when {
                r == null || r.removed -> false
                r.held -> true
                else -> abs(r.x - state.player.x) + abs(r.y - state.player.y) <= 1
            }
        }
        is QuestCondition.ObjectState -> state.objects[c.obj].let { r -> r != null && !r.removed && r.state == c.state }
        is QuestCondition.ObjectRemoved -> state.objects[c.obj]?.removed == true
        is QuestCondition.Performed -> state.performed.any { it.obj == c.obj && it.action == c.action }
        is QuestCondition.AllOf -> c.conditions.withIndex().all { (i, ch) -> evaluate(ch, state, "$path.$i") }
        is QuestCondition.AnyOf -> c.conditions.withIndex().any { (i, ch) -> evaluate(ch, state, "$path.$i") }
        is QuestCondition.Sequence -> (state.sequenceProgress[path] ?: 0) >= c.conditions.size
        is QuestCondition.Unknown -> false
    }

    /** Every object a condition talks about — highlighted on a hint. */
    fun conditionObjectIds(c: QuestCondition): List<String> = when (c) {
        is QuestCondition.Holding -> listOf(c.obj)
        is QuestCondition.NotHolding -> listOf(c.obj)
        is QuestCondition.ObjectAt -> listOf(c.obj)
        is QuestCondition.ObjectOnTerrain -> listOf(c.obj)
        is QuestCondition.PlayerNextTo -> listOf(c.obj)
        is QuestCondition.ObjectState -> listOf(c.obj)
        is QuestCondition.ObjectRemoved -> listOf(c.obj)
        is QuestCondition.Performed -> listOf(c.obj)
        is QuestCondition.ObjectOn -> listOf(c.obj, c.target)
        is QuestCondition.AllOf -> c.conditions.flatMap(::conditionObjectIds)
        is QuestCondition.AnyOf -> c.conditions.flatMap(::conditionObjectIds)
        is QuestCondition.Sequence -> c.conditions.flatMap(::conditionObjectIds)
        else -> emptyList()
    }

    /** How far through the active goal's top-level sequence the learner is. */
    fun activeGoalProgress(state: QuestState): Pair<Int, Int>? {
        val goal = state.world.goals.getOrNull(state.activeGoalIndex) ?: return null
        val c = goal.condition as? QuestCondition.Sequence ?: return null
        return minOf(state.sequenceProgress[goalPath(state.activeGoalIndex)] ?: 0, c.conditions.size) to c.conditions.size
    }
}
