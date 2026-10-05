package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * Port of shared/call-activities (types.ts + engine.ts + catalogue.ts): in-call activities — small
 * two-person exercises played together inside a video call. The call room (CallRoom Durable Object)
 * owns the session: clients send actions, the room runs `reduceActivity` and broadcasts the whole
 * session after every change. The Lab app renders the latest session; this port exists so the views
 * share the web's helpers (scoreOf, rolesOf, blanksFor, builtText…) and so the Kotlin is provably
 * the same machine (parity/fixtures/call-activities.ts → CallActivitiesParityTest).
 *
 * JSON field names are the TS ones. Kind-specific fields are nullable (a spec is one flat class),
 * so a session from a newer room with a kind this build doesn't know still parses.
 */

/** `ActivityKind`. */
object ActivityKinds {
    const val DESCRIBE = "describe"
    const val INFO_GAP = "info_gap"
    const val ROLEPLAY = "roleplay"
    const val BUILD = "build"
    const val QUIZ = "quiz"
    const val DICTATION = "dictation"
    /** `ACTIVITY_KINDS`. */
    val ALL = listOf(DESCRIBE, INFO_GAP, ROLEPLAY, BUILD, QUIZ, DICTATION)
}

/** `ActivityPhase`. */
object ActivityPhases {
    const val READY = "ready"
    const val PLAY = "play"
    const val REVEAL = "reveal"
    const val DONE = "done"
}

/** `ActivityWord`. */
@Serializable
data class ActivityWord(val hanzi: String = "", val pinyin: String = "", val english: String = "")

/** `{ a, b }` — role names, speakers, roles (user ids). [role] is "a" or "b". */
@Serializable
data class RolePair(val a: String = "", val b: String = "") {
    fun of(role: String): String = if (role == "a") a else b
}

/** An item of a describe (word + emoji + hints), build (tiles) or dictation (word) spec. */
@Serializable
data class ActivityItem(
    val emoji: String? = null,
    val hanzi: String? = null,
    val tiles: List<String>? = null,
    val pinyin: String = "",
    val english: String = "",
    val hints: List<String>? = null,
)

@Serializable
data class InfoGapCell(val value: String = "", val owner: String = "a")

@Serializable
data class InfoGapRow(val label: String = "", val cells: List<InfoGapCell> = emptyList())

@Serializable
data class RoleplayLine(val speaker: String = "a", val hanzi: String = "", val pinyin: String = "", val english: String = "")

@Serializable
data class QuizQuestion(
    val prompt: String = "",
    val audio: String? = null,
    val options: List<String> = emptyList(),
    val answer: Int = 0,
    val explanation: String? = null,
)

/** `ActivitySpec` (all six kinds in one class; [kind] says which fields are used). */
@Serializable
data class ActivitySpec(
    val id: String = "",
    val kind: String = "",
    val title: String = "",
    @SerialName("title_zh") val titleZh: String? = null,
    val level: String = "",
    val topic: String = "",
    val summary: String = "",
    @SerialName("role_names") val roleNames: RolePair = RolePair(),
    @SerialName("tutor_role") val tutorRole: String = "a",
    /** describe / build / dictation. */
    val items: List<ActivityItem>? = null,
    /** info_gap. */
    val prompt: String? = null,
    val phrases: List<ActivityWord>? = null,
    val columns: List<String>? = null,
    val rows: List<InfoGapRow>? = null,
    val choices: List<ActivityWord>? = null,
    /** roleplay. */
    val setting: String? = null,
    val speakers: RolePair? = null,
    val lines: List<RoleplayLine>? = null,
    /** quiz. */
    val questions: List<QuizQuestion>? = null,
    /** describe: extra wrong options from the same category (never a round's answer). */
    val distractors: List<ActivityWord>? = null,
    /** describe: reading + meaning of the hint words ("words you needed" → + Add as card). */
    val glossary: List<ActivityWord>? = null,
) {
    val itemList: List<ActivityItem> get() = items.orEmpty()
    val lineList: List<RoleplayLine> get() = lines.orEmpty()
    val questionList: List<QuizQuestion> get() = questions.orEmpty()
    val rowList: List<InfoGapRow> get() = rows.orEmpty()
}

/** `ActivityRoundResult`. [correct] null = not scored. */
@Serializable
data class ActivityRoundResult(
    val round: Int = 0,
    val correct: Boolean? = null,
    val answer: String? = null,
    val detail: List<String>? = null,
    val skipped: Boolean? = null,
    /** Who gave the answer (user id): the guesser who picked, the writer, the speaker. */
    val by: String? = null,
)

/** `ActivityRoundData`: the current round's working state (only the fields the kind uses). */
@Serializable
data class ActivityRoundData(
    val options: List<String>? = null,
    val pick: String? = null,
    /** describe / quiz: who picked (user id) — the reveal names this person, never "the guesser" by role. */
    @SerialName("pick_by") val pickBy: String? = null,
    val pool: List<Int>? = null,
    val placed: List<Int>? = null,
    val said: List<String>? = null,
    val draft: String? = null,
    val submitted: Boolean? = null,
    val mark: Boolean? = null,
    val play: Int? = null,
    val answers: Map<String, String>? = null,
)

/** `ActivitySession`. */
@Serializable
data class ActivitySession(
    @SerialName("session_id") val sessionId: String = "",
    val spec: ActivitySpec = ActivitySpec(),
    val roles: RolePair = RolePair(),
    val host: String = "",
    val names: Map<String, String> = emptyMap(),
    val round: Int = 0,
    val phase: String = ActivityPhases.PLAY,
    val data: ActivityRoundData = ActivityRoundData(),
    val results: List<ActivityRoundResult> = emptyList(),
    @SerialName("started_at") val startedAt: Long = 0,
    @SerialName("updated_at") val updatedAt: Long = 0,
    val v: Int = 0,
)

/** `ActivitySummary`. */
@Serializable
data class ActivitySummary(
    @SerialName("activity_id") val activityId: String = "",
    val kind: String = "",
    val title: String = "",
    val played: Int = 0,
    val scored: Int = 0,
    val correct: Int = 0,
    @SerialName("total_rounds") val totalRounds: Int = 0,
    val finished: Boolean = false,
    val roles: List<String> = emptyList(),
    val lines: List<String> = emptyList(),
)

/** `ActivityAction`: what a client sends in `activity_action`. Serialises to exactly the TS shape. */
sealed class ActivityAction(val type: String) {
    open fun toJson(): JsonObject = buildJsonObject { put("type", type) }

    data object Next : ActivityAction("next")
    data object Skip : ActivityAction("skip")
    data object ResetRound : ActivityAction("reset_round")
    data object SwapRoles : ActivityAction("swap_roles")
    data object Restart : ActivityAction("restart")
    data object Finish : ActivityAction("finish")
    data object Ask : ActivityAction("ask")
    data object PlayAudio : ActivityAction("play_audio")
    data object Reveal : ActivityAction("reveal")
    data object Submit : ActivityAction("submit")
    data object ClearTiles : ActivityAction("clear_tiles")
    data object Said : ActivityAction("said")
    data object LineDone : ActivityAction("line_done")
    data object LineBack : ActivityAction("line_back")

    /** describe: the hanzi picked; quiz: the option index as a string. */
    data class Pick(val option: String) : ActivityAction("pick") {
        override fun toJson() = buildJsonObject { put("type", type); put("option", option) }
    }
    data class Mark(val correct: Boolean) : ActivityAction("mark") {
        override fun toJson() = buildJsonObject { put("type", type); put("correct", correct) }
    }
    data class Draft(val text: String) : ActivityAction("draft") {
        override fun toJson() = buildJsonObject { put("type", type); put("text", text) }
    }
    data class Place(val tile: Int) : ActivityAction("place") {
        override fun toJson() = buildJsonObject { put("type", type); put("tile", tile) }
    }
    data class Unplace(val tile: Int) : ActivityAction("unplace") {
        override fun toJson() = buildJsonObject { put("type", type); put("tile", tile) }
    }
    /** info_gap: [value] null clears the cell. */
    data class Fill(val cell: String, val value: String?) : ActivityAction("fill") {
        override fun toJson() = buildJsonObject { put("type", type); put("cell", cell); put("value", value?.let { JsonPrimitive(it) } ?: JsonNull) }
    }
    /** Anything this build can't represent (unknown type, a field of the wrong type): always refused. */
    data class Invalid(val raw: String) : ActivityAction("invalid")

    companion object {
        // Lazy: the subclasses' objects need the sealed class initialised first.
        private val SIMPLE by lazy { listOf(Next, Skip, ResetRound, SwapRoles, Restart, Finish, Ask, PlayAudio, Reveal, Submit, ClearTiles, Said, LineDone, LineBack).associateBy { it.type } }

        /** The action in [el], or null when it isn't an object with a string `type` (the engine refuses both). */
        fun parse(el: JsonElement?): ActivityAction? {
            val o = el as? JsonObject ?: return null
            val type = (o["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            SIMPLE[type]?.let { return it }
            fun str(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
            fun int(k: String): Int? {
                val p = (o[k] as? JsonPrimitive)?.takeIf { !it.isString } ?: return null
                val d = p.doubleOrNull ?: return null
                return if (d == Math.floor(d) && d >= Int.MIN_VALUE && d <= Int.MAX_VALUE) d.toInt() else null
            }
            val bad = Invalid(o.toString())
            return when (type) {
                "pick" -> str("option")?.let { Pick(it) } ?: bad
                // TS `action.correct === true`: anything but a JSON true marks it wrong.
                "mark" -> Mark((o["correct"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true)
                "draft" -> str("text")?.let { Draft(it) } ?: bad
                "place" -> int("tile")?.let { Place(it) } ?: bad
                "unplace" -> int("tile")?.let { Unplace(it) } ?: bad
                "fill" -> {
                    val cell = str("cell") ?: return bad
                    when (val v = o["value"]) {
                        is JsonNull -> Fill(cell, null)
                        is JsonPrimitive -> if (v.isString) Fill(cell, v.content) else bad
                        else -> bad
                    }
                }
                else -> bad
            }
        }
    }
}

/** How each kind is introduced in the picker (`ACTIVITY_KIND_INFO`). */
data class ActivityKindInfo(val icon: String, val name: String, val blurb: String)

/** Port of shared/call-activities/engine.ts (+ the catalogue helpers). Pure. */
object CallActivities {
    /** `MAX_DRAFT_CHARS`. */
    const val MAX_DRAFT_CHARS = 120

    /** `DESCRIBE_OPTION_COUNT`: how many options a describe round shows the guesser. */
    const val DESCRIBE_OPTION_COUNT = 8

    /** The room's JSON: unknown keys ignored, nulls left out (TS `undefined` / `null` read the same). */
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true; coerceInputValues = true }

    fun parseSession(el: JsonElement?): ActivitySession? {
        if (el == null || el is JsonNull || el !is JsonObject) return null
        return runCatching { json.decodeFromJsonElement(ActivitySession.serializer(), el) }.getOrNull()?.takeIf { it.sessionId.isNotEmpty() }
    }

    fun toJson(s: ActivitySession): JsonElement = json.encodeToJsonElement(ActivitySession.serializer(), s)

    // ------------------------------------------------------------------ seeded shuffle

    /** `hash32`: FNV-1a over UTF-16 code units, unsigned 32-bit. */
    fun hash32(s: String): Long {
        var h = 0x811c9dc5.toInt()
        for (c in s) {
            h = h xor c.code
            h *= 0x01000193 // Math.imul
        }
        return h.toLong() and 0xFFFFFFFFL
    }

    /** xorshift32 step (on the int32 bits, like JS `<<` / `>>>`). */
    private fun nextRand(x0: Int): Int {
        var x = x0
        x = x xor (x shl 13)
        x = x xor (x ushr 17)
        x = x xor (x shl 5)
        return x
    }

    /** `seededShuffle`: Fisher–Yates seeded from [key]. */
    fun <T> seededShuffle(items: List<T>, key: String): List<T> {
        val out = items.toMutableList()
        val h = hash32(key)
        var x = if (h == 0L) 1 else h.toInt()
        for (i in out.size - 1 downTo 1) {
            x = nextRand(x)
            val j = ((x.toLong() and 0xFFFFFFFFL) % (i + 1)).toInt()
            val t = out[i]
            out[i] = out[j]
            out[j] = t
        }
        return out
    }

    // ------------------------------------------------------------------ helpers

    /** `totalRounds`. */
    fun totalRounds(spec: ActivitySpec): Int = when (spec.kind) {
        ActivityKinds.DESCRIBE, ActivityKinds.BUILD, ActivityKinds.DICTATION -> spec.itemList.size
        ActivityKinds.INFO_GAP -> 1
        ActivityKinds.ROLEPLAY -> spec.lineList.size
        ActivityKinds.QUIZ -> spec.questionList.size
        else -> 0
    }

    /** `otherRole`. */
    fun otherRole(r: String): String = if (r == "a") "b" else "a"

    /** `rolesOf`: the roles this user holds (both in a solo call, none for a stranger). */
    fun rolesOf(s: ActivitySession, userId: String): List<String> = buildList {
        if (s.roles.a == userId) add("a")
        if (s.roles.b == userId) add("b")
    }

    fun holds(s: ActivitySession, userId: String, role: String): Boolean = s.roles.of(role) == userId
    fun isHost(s: ActivitySession, userId: String): Boolean = s.host == userId

    /** `roleLabel`: "Minghui (Describer)". */
    fun roleLabel(s: ActivitySession, role: String): String {
        val name = s.names[s.roles.of(role)] ?: "Someone"
        return "$name (${s.spec.roleNames.of(role)})"
    }

    /** `cellKey`. */
    fun cellKey(row: Int, col: Int): String = "$row:$col"

    /** `blanksFor`: the cells [role] must fill (owned by the other role). */
    fun blanksFor(spec: ActivitySpec, role: String): List<String> = buildList {
        spec.rowList.forEachIndexed { ri, r -> r.cells.forEachIndexed { ci, c -> if (c.owner != role) add(cellKey(ri, ci)) } }
    }

    private val CELL = Regex("([0-9]+):([0-9]+)")

    /** `infoGapCell`. */
    fun infoGapCell(spec: ActivitySpec, key: String): InfoGapCell? {
        val m = CELL.matchEntire(key) ?: return null
        val r = m.groupValues[1].toIntOrNull() ?: return null
        val c = m.groupValues[2].toIntOrNull() ?: return null
        return spec.rowList.getOrNull(r)?.cells?.getOrNull(c)
    }

    /**
     * `describeOptions`: the item and up to DESCRIBE_OPTION_COUNT − 1 others — the spec's other items
     * and its distractors, never the answer twice — shuffled.
     */
    fun describeOptions(spec: ActivitySpec, sessionId: String, round: Int): List<String> {
        val items = spec.itemList
        val target = items.getOrNull(round) ?: return emptyList()
        val targetHanzi = target.hanzi.orEmpty()
        val pool = ArrayList<String>()
        val words = items.filterIndexed { i, _ -> i != round }.map { it.hanzi.orEmpty() } + spec.distractors.orEmpty().map { it.hanzi }
        for (w in words) if (w.isNotEmpty() && w != targetHanzi && w !in pool) pool += w
        val others = seededShuffle(pool, "$sessionId:$round:others").take(DESCRIBE_OPTION_COUNT - 1)
        return seededShuffle(listOf(targetHanzi) + others, "$sessionId:$round:options")
    }

    /** `buildPool`: the tile order shown, never already right (when it can differ). */
    fun buildPool(spec: ActivitySpec, sessionId: String, round: Int): List<Int> {
        val tiles = spec.itemList.getOrNull(round)?.tiles.orEmpty()
        val idx = tiles.indices.toList()
        val right = tiles.joinToString("")
        for (attempt in 0 until 5) {
            val p = seededShuffle(idx, "$sessionId:$round:pool:$attempt")
            if (p.joinToString("") { tiles[it] } != right || tiles.size < 2) return p
        }
        return idx.reversed()
    }

    /** `builtText`. */
    fun builtText(spec: ActivitySpec, round: Int, placed: List<Int>): String {
        val tiles = spec.itemList.getOrNull(round)?.tiles.orEmpty()
        return placed.joinToString("") { tiles.getOrNull(it) ?: "" }
    }

    private fun roundData(spec: ActivitySpec, sessionId: String, round: Int): Pair<String, ActivityRoundData> = when (spec.kind) {
        ActivityKinds.DESCRIBE -> ActivityPhases.PLAY to ActivityRoundData(options = describeOptions(spec, sessionId, round), pick = null)
        ActivityKinds.INFO_GAP -> ActivityPhases.PLAY to ActivityRoundData(answers = emptyMap())
        ActivityKinds.ROLEPLAY -> ActivityPhases.PLAY to ActivityRoundData()
        ActivityKinds.BUILD -> ActivityPhases.PLAY to ActivityRoundData(pool = buildPool(spec, sessionId, round), placed = emptyList(), said = emptyList())
        ActivityKinds.QUIZ -> ActivityPhases.READY to ActivityRoundData(pick = null, mark = null, play = 0)
        ActivityKinds.DICTATION -> ActivityPhases.READY to ActivityRoundData(draft = "", submitted = false, mark = null, play = 0)
        else -> ActivityPhases.PLAY to ActivityRoundData()
    }

    private fun ActivitySession.atRound(round: Int): ActivitySession {
        val (phase, data) = roundData(spec, sessionId, round)
        return copy(round = round, phase = phase, data = data)
    }

    // ------------------------------------------------------------------ who may act

    /**
     * `turnRoles`: whose turn the round is — the role(s) that drive it on (Next / Skip) besides the
     * host: the describer, the asker, the speaker of the current line; both in the cooperative kinds.
     */
    fun turnRoles(s: ActivitySession): List<String> = when (s.spec.kind) {
        ActivityKinds.DESCRIBE, ActivityKinds.QUIZ, ActivityKinds.DICTATION -> listOf("a")
        ActivityKinds.ROLEPLAY -> s.spec.lineList.getOrNull(s.round)?.let { listOf(it.speaker) } ?: listOf("a", "b")
        ActivityKinds.INFO_GAP, ActivityKinds.BUILD -> listOf("a", "b")
        // A kind this build doesn't know: nobody's turn (the host still may).
        else -> emptyList()
    }

    /**
     * `mayAct`: THE who-may-act rule (roles only — phase and values are the engine's business). The
     * host alone restarts, resets a round and swaps roles; Next / Skip are the host's or whoever's turn
     * it is; each kind's own actions belong to one role; building and filling a gap are for both.
     * Either person may end the activity. Someone with no role (and not the host) may do nothing.
     */
    fun mayAct(s: ActivitySession, actor: String, type: String): Boolean {
        val host = isHost(s, actor)
        val a = holds(s, actor, "a")
        val b = holds(s, actor, "b")
        val player = a || b
        if (!player && !host) return false
        val kind = s.spec.kind
        fun myTurn() = turnRoles(s).any { holds(s, actor, it) }
        return when (type) {
            "finish" -> true
            "restart", "reset_round", "swap_roles" -> host
            "next", "skip" -> host || myTurn()
            "pick" -> (kind == ActivityKinds.DESCRIBE || kind == ActivityKinds.QUIZ) && b
            "ask", "play_audio", "mark" -> (kind == ActivityKinds.QUIZ || kind == ActivityKinds.DICTATION) && a
            "reveal" ->
                if (kind == ActivityKinds.QUIZ || kind == ActivityKinds.DICTATION) a
                else (kind == ActivityKinds.INFO_GAP || kind == ActivityKinds.BUILD) && player
            "draft", "submit" -> kind == ActivityKinds.DICTATION && b
            "place", "unplace", "clear_tiles", "said" -> kind == ActivityKinds.BUILD && player
            "fill" -> kind == ActivityKinds.INFO_GAP && player
            "line_done" -> kind == ActivityKinds.ROLEPLAY && (host || myTurn())
            "line_back" -> {
                if (kind != ActivityKinds.ROLEPLAY) false
                else {
                    val prev = s.spec.lineList.getOrNull(s.round - 1)
                    host || (prev != null && holds(s, actor, prev.speaker))
                }
            }
            else -> false
        }
    }

    // ------------------------------------------------------------------ start

    /** `StartOptions`. */
    data class StartOptions(
        val sessionId: String,
        val starter: String,
        val tutor: String?,
        val present: List<String>,
        val names: Map<String, String>,
        val now: Long,
    )

    /** `startActivity`: a new session at round 0 (the tutor takes `tutor_role`; alone, one person holds both). */
    fun start(spec: ActivitySpec, o: StartOptions): ActivitySession {
        val people = (listOf(o.starter) + o.present).distinct()
        val lead = if (o.tutor != null && o.tutor.isNotEmpty() && o.tutor in people) o.tutor else o.starter
        val other = people.firstOrNull { it != lead } ?: lead
        val roles = if (spec.tutorRole == "a") RolePair(lead, other) else RolePair(other, lead)
        val names = LinkedHashMap<String, String>()
        for (p in people) names[p] = o.names[p] ?: "Someone"
        val base = ActivitySession(
            sessionId = o.sessionId, spec = spec, roles = roles, host = lead, names = names, round = 0,
            results = emptyList(), startedAt = o.now, updatedAt = o.now, v = 1,
        )
        return base.atRound(0)
    }

    /** `joinActivity`: someone joins a solo-started activity and takes a role. Null = nothing changes. */
    fun join(s: ActivitySession, userId: String, name: String, tutor: String?, now: Long): ActivitySession? {
        if (s.roles.a != s.roles.b || s.roles.a == userId || s.phase == ActivityPhases.DONE) return null
        val solo = s.roles.a
        val joinerIsTutor = tutor == userId
        val joinerRole = if (joinerIsTutor) s.spec.tutorRole else otherRole(s.spec.tutorRole)
        val roles = if (joinerRole == "a") RolePair(userId, solo) else RolePair(solo, userId)
        return s.copy(roles = roles, host = if (joinerIsTutor) userId else s.host, names = s.names + (userId to name), v = s.v + 1, updatedAt = now)
    }

    // ------------------------------------------------------------------ reduce

    private fun withResult(results: List<ActivityRoundResult>, r: ActivityRoundResult): List<ActivityRoundResult> =
        (results.filter { it.round != r.round } + r).sortedBy { it.round }

    /** `goTo`: move to [round] (or `done` past the last). */
    private fun goTo(s: ActivitySession, round: Int): ActivitySession {
        val total = totalRounds(s.spec)
        if (round >= total) return s.copy(round = Math.max(0, total - 1), phase = ActivityPhases.DONE, data = ActivityRoundData())
        return s.atRound(round)
    }

    private fun step(s: ActivitySession, action: ActivityAction, actor: String): ActivitySession? {
        val spec = s.spec
        if (!mayAct(s, actor, action.type)) return null
        val d = s.data
        val done = s.phase == ActivityPhases.DONE

        // ---- controls, any kind
        when (action) {
            ActivityAction.Finish -> return if (done) null else s.copy(phase = ActivityPhases.DONE, data = ActivityRoundData())
            ActivityAction.Restart -> return goTo(s.copy(results = emptyList()), 0)
            ActivityAction.SwapRoles -> return if (done) null else s.copy(roles = RolePair(s.roles.b, s.roles.a)).atRound(s.round)
            ActivityAction.ResetRound -> return if (done) null else s.copy(results = s.results.filter { it.round != s.round }).atRound(s.round)
            ActivityAction.Skip -> {
                if (done) return null
                if (s.phase == ActivityPhases.REVEAL) return goTo(s, s.round + 1)
                return goTo(s.copy(results = withResult(s.results, ActivityRoundResult(round = s.round, correct = null, skipped = true))), s.round + 1)
            }
            ActivityAction.Next -> return if (s.phase != ActivityPhases.REVEAL) null else goTo(s, s.round + 1)
            else -> Unit
        }
        if (done) return null
        // A spec without content for this round (a generated one with no lines / items) takes no actions.
        if (s.round >= totalRounds(spec)) return null

        when (spec.kind) {
            ActivityKinds.DESCRIBE -> {
                if (action !is ActivityAction.Pick || s.phase != ActivityPhases.PLAY) return null
                if (action.option !in d.options.orEmpty()) return null
                val correct = action.option == spec.itemList[s.round].hanzi
                return s.copy(
                    phase = ActivityPhases.REVEAL, data = d.copy(pick = action.option, pickBy = actor),
                    results = withResult(s.results, ActivityRoundResult(round = s.round, correct = correct, answer = action.option, by = actor)),
                )
            }
            ActivityKinds.INFO_GAP -> {
                if (action is ActivityAction.Fill) {
                    if (s.phase != ActivityPhases.PLAY) return null
                    val cell = infoGapCell(spec, action.cell) ?: return null
                    if (!holds(s, actor, otherRole(cell.owner))) return null
                    val answers = LinkedHashMap(d.answers.orEmpty())
                    val v = action.value
                    if (v == null || v == "") answers.remove(action.cell)
                    else if (spec.choices.orEmpty().any { it.hanzi == v }) answers[action.cell] = v
                    else return null
                    return s.copy(data = d.copy(answers = answers))
                }
                if (action == ActivityAction.Reveal) {
                    if (s.phase != ActivityPhases.PLAY) return null
                    val blanks = blanksFor(spec, "a") + blanksFor(spec, "b")
                    val right = blanks.count { d.answers?.get(it) == infoGapCell(spec, it)?.value }
                    val columns = spec.columns.orEmpty()
                    val detail = spec.rowList.flatMapIndexed { ri, row ->
                        row.cells.mapIndexed { ci, c ->
                            val got = d.answers?.get(cellKey(ri, ci))
                            val what = if (!got.isNullOrEmpty()) "wrote $got${if (got == c.value) " ✓" else " ✗ (right: ${c.value})"}" else "left blank (right: ${c.value})"
                            "${row.label} · ${columns.getOrNull(ci) ?: ""}: $what"
                        }
                    }
                    return s.copy(
                        phase = ActivityPhases.REVEAL,
                        results = withResult(s.results, ActivityRoundResult(round = 0, correct = right == blanks.size, answer = "$right/${blanks.size}", detail = detail)),
                    )
                }
                return null
            }
            ActivityKinds.ROLEPLAY -> {
                if (s.phase != ActivityPhases.PLAY) return null
                if (action == ActivityAction.LineDone) {
                    val line = spec.lineList[s.round]
                    return goTo(s.copy(results = withResult(s.results, ActivityRoundResult(round = s.round, correct = null, answer = line.hanzi, by = actor))), s.round + 1)
                }
                if (action == ActivityAction.LineBack) {
                    if (s.round == 0) return null
                    return s.copy(results = s.results.filter { it.round < s.round - 1 }).atRound(s.round - 1)
                }
                return null
            }
            ActivityKinds.BUILD -> {
                val placed = d.placed.orEmpty()
                val tiles = spec.itemList[s.round].tiles.orEmpty()
                return when (action) {
                    is ActivityAction.Place ->
                        if (s.phase != ActivityPhases.PLAY || action.tile < 0 || action.tile >= tiles.size || action.tile in placed) null
                        else s.copy(data = d.copy(placed = placed + action.tile))
                    is ActivityAction.Unplace ->
                        if (s.phase != ActivityPhases.PLAY || action.tile !in placed) null
                        else s.copy(data = d.copy(placed = placed.filter { it != action.tile }))
                    ActivityAction.ClearTiles ->
                        if (s.phase != ActivityPhases.PLAY || placed.isEmpty()) null else s.copy(data = d.copy(placed = emptyList()))
                    ActivityAction.Reveal -> {
                        if (s.phase != ActivityPhases.PLAY) null
                        else {
                            val built = builtText(spec, s.round, placed)
                            s.copy(phase = ActivityPhases.REVEAL, results = withResult(s.results, ActivityRoundResult(round = s.round, correct = built == tiles.joinToString(""), answer = built)))
                        }
                    }
                    ActivityAction.Said ->
                        if (s.phase != ActivityPhases.REVEAL || actor in d.said.orEmpty()) null
                        else s.copy(data = d.copy(said = d.said.orEmpty() + actor))
                    else -> null
                }
            }
            ActivityKinds.QUIZ -> {
                val q = spec.questionList[s.round]
                return when (action) {
                    ActivityAction.Ask ->
                        if (s.phase != ActivityPhases.READY) null
                        else s.copy(phase = ActivityPhases.PLAY, data = d.copy(play = (d.play ?: 0) + (if (!q.audio.isNullOrEmpty()) 1 else 0)))
                    ActivityAction.PlayAudio ->
                        if (q.audio.isNullOrEmpty() || s.phase == ActivityPhases.READY) null
                        else s.copy(data = d.copy(play = (d.play ?: 0) + 1))
                    is ActivityAction.Pick -> {
                        // JS /^\d+$/ (ASCII digits, whole string) then Number(option).
                        val i = if (action.option.matches(Regex("[0-9]+"))) action.option.trimStart('0').ifEmpty { "0" }.toIntOrNull() else null
                        if (s.phase != ActivityPhases.PLAY || i == null || i >= q.options.size) null
                        else s.copy(data = d.copy(pick = action.option, pickBy = actor))
                    }
                    ActivityAction.Reveal -> {
                        if (s.phase != ActivityPhases.PLAY) null
                        else {
                            val pickIdx = d.pick?.let(::jsNumber)
                            val correct = pickIdx != null && pickIdx == q.answer.toDouble()
                            val answer = if (d.pick != null) q.options.getOrNull(pickIdx?.toInt() ?: -1) ?: "" else ""
                            s.copy(phase = ActivityPhases.REVEAL, data = d.copy(mark = correct), results = withResult(s.results, ActivityRoundResult(round = s.round, correct = correct, answer = answer, by = d.pickBy?.ifEmpty { null })))
                        }
                    }
                    is ActivityAction.Mark -> {
                        if (s.phase != ActivityPhases.REVEAL) null
                        else {
                            val prev = s.results.firstOrNull { it.round == s.round }
                            s.copy(data = d.copy(mark = action.correct), results = withResult(s.results, ActivityRoundResult(round = s.round, correct = action.correct, answer = prev?.answer ?: "", by = prev?.by?.ifEmpty { null })))
                        }
                    }
                    else -> null
                }
            }
            ActivityKinds.DICTATION -> {
                val item = spec.itemList[s.round]
                return when (action) {
                    ActivityAction.Ask -> if (s.phase != ActivityPhases.READY) null else s.copy(phase = ActivityPhases.PLAY)
                    ActivityAction.PlayAudio -> if (s.phase == ActivityPhases.READY) null else s.copy(data = d.copy(play = (d.play ?: 0) + 1))
                    is ActivityAction.Draft ->
                        if (s.phase != ActivityPhases.PLAY || d.submitted == true) null
                        else s.copy(data = d.copy(draft = action.text.take(MAX_DRAFT_CHARS)))
                    ActivityAction.Submit ->
                        if (s.phase != ActivityPhases.PLAY || d.submitted == true) null else s.copy(data = d.copy(submitted = true))
                    ActivityAction.Reveal -> {
                        if (s.phase != ActivityPhases.PLAY) null
                        else {
                            val draft = d.draft ?: ""
                            val correct = LessonAnswers.isHanziCorrect(draft, item.hanzi.orEmpty())
                            s.copy(phase = ActivityPhases.REVEAL, data = d.copy(submitted = true, mark = correct), results = withResult(s.results, ActivityRoundResult(round = s.round, correct = correct, answer = draft, by = s.roles.b)))
                        }
                    }
                    is ActivityAction.Mark ->
                        if (s.phase != ActivityPhases.REVEAL) null
                        else s.copy(data = d.copy(mark = action.correct), results = withResult(s.results, ActivityRoundResult(round = s.round, correct = action.correct, answer = d.draft ?: "", by = s.roles.b)))
                    else -> null
                }
            }
            else -> return null
        }
    }

    /** JS `Number(s)` for the digit strings a quiz pick can hold. */
    private fun jsNumber(s: String): Double? = if (s.matches(Regex("[0-9]+"))) s.toDouble() else s.trim().toDoubleOrNull()

    /** `reduceActivity`: apply one action by [actor]. Null = refused, nothing changes. */
    fun reduce(s: ActivitySession, action: ActivityAction?, actor: String, now: Long): ActivitySession? {
        if (action == null) return null
        val next = step(s, action, actor) ?: return null
        return next.copy(v = s.v + 1, updatedAt = now)
    }

    // ------------------------------------------------------------------ score + summary

    data class Score(val correct: Int, val scored: Int)

    /** `scoreOf`. */
    fun scoreOf(results: List<ActivityRoundResult>): Score {
        val scored = results.filter { it.correct != null }
        return Score(scored.count { it.correct == true }, scored.size)
    }

    fun scoreOf(s: ActivitySession): Score = scoreOf(s.results)

    /** `byName`: "Jerome " — who answered, for a summary line ('' when not recorded). */
    private fun byName(s: ActivitySession, by: String?): String = if (!by.isNullOrEmpty() && !s.names[by].isNullOrEmpty()) "${s.names[by]} " else ""

    private fun mark(c: Boolean?) = when (c) { true -> " ✓"; false -> " ✗"; null -> "" }

    /** `activitySummary`: the readable record of a session. */
    fun summary(s: ActivitySession): ActivitySummary {
        val spec = s.spec
        val lines = ArrayList<String>()
        for (r in s.results) {
            if (r.skipped == true) {
                lines += "${roundTitle(spec, r.round)} — skipped"
                continue
            }
            when (spec.kind) {
                ActivityKinds.DESCRIBE -> {
                    val it = spec.itemList[r.round]
                    lines += "${it.emoji} ${it.hanzi} (${it.pinyin}, ${it.english}) — ${byName(s, r.by)}picked ${r.answer ?: "?"}${mark(r.correct)}"
                }
                ActivityKinds.INFO_GAP -> {
                    lines += r.detail.orEmpty()
                    lines += "Filled in correctly: ${r.answer ?: ""}"
                }
                ActivityKinds.ROLEPLAY -> {
                    val l = spec.lineList[r.round]
                    lines += "${spec.speakers?.of(l.speaker) ?: "undefined"} (${s.names[s.roles.of(l.speaker)] ?: l.speaker}): ${l.hanzi}"
                }
                ActivityKinds.BUILD -> {
                    val it = spec.itemList[r.round]
                    lines += "${it.tiles.orEmpty().joinToString("")} (${it.english}) — built ${r.answer.orEmpty().ifEmpty { "(nothing)" }}${mark(r.correct)}"
                }
                ActivityKinds.QUIZ -> {
                    val q = spec.questionList[r.round]
                    val heard = if (!q.audio.isNullOrEmpty()) " [heard: ${q.audio}]" else ""
                    val ans = if (r.correct == true) "" else " (answer: ${q.options.getOrNull(q.answer) ?: "undefined"})"
                    lines += "${q.prompt.ifEmpty { "🔊" }}$heard — picked ${r.answer.orEmpty().ifEmpty { "(nothing)" }}${mark(r.correct)}$ans"
                }
                ActivityKinds.DICTATION -> {
                    val it = spec.itemList[r.round]
                    lines += "${it.hanzi} (${it.pinyin}, ${it.english}) — wrote ${r.answer.orEmpty().ifEmpty { "(nothing)" }}${mark(r.correct)}"
                }
            }
        }
        val sc = scoreOf(s)
        return ActivitySummary(
            activityId = spec.id,
            kind = spec.kind,
            title = spec.title,
            played = s.results.count { it.skipped != true },
            scored = sc.scored,
            correct = sc.correct,
            totalRounds = totalRounds(spec),
            finished = s.phase == ActivityPhases.DONE,
            roles = listOf("a", "b").map { "$it: ${roleLabel(s, it)}" },
            lines = lines,
        )
    }

    /** `roundTitle`: a short name for round [i]. */
    fun roundTitle(spec: ActivitySpec, i: Int): String = when (spec.kind) {
        ActivityKinds.DESCRIBE -> spec.itemList.getOrNull(i)?.hanzi ?: "Round ${i + 1}"
        ActivityKinds.INFO_GAP -> spec.title
        ActivityKinds.ROLEPLAY -> spec.lineList.getOrNull(i)?.hanzi ?: "Line ${i + 1}"
        ActivityKinds.BUILD -> spec.itemList.getOrNull(i)?.tiles?.joinToString("") ?: "Sentence ${i + 1}"
        ActivityKinds.QUIZ -> spec.questionList.getOrNull(i)?.prompt?.ifEmpty { null } ?: "Question ${i + 1}"
        ActivityKinds.DICTATION -> spec.itemList.getOrNull(i)?.hanzi ?: "Word ${i + 1}"
        else -> "Round ${i + 1}"
    }

    // ------------------------------------------------------------------ role badges

    /** `roleBadge`: the big "what I do" badge for a role: "You describe" / "You guess", "You ask" / "You answer"… */
    fun roleBadge(spec: ActivitySpec, role: String): String = when (spec.kind) {
        ActivityKinds.DESCRIBE -> if (role == "a") "You describe" else "You guess"
        ActivityKinds.QUIZ -> if (role == "a") "You ask" else "You answer"
        ActivityKinds.DICTATION -> if (role == "a") "You read out" else "You write"
        ActivityKinds.ROLEPLAY -> "You’re the ${spec.speakers?.of(role) ?: "undefined"}"
        ActivityKinds.INFO_GAP, ActivityKinds.BUILD -> "You: ${spec.roleNames.of(role)}"
        else -> "You: ${spec.roleNames.of(role)}"
    }

    /** `rolesSwappedNotice`: said once on each side when the host swaps roles: "Roles swapped — now you guess". */
    fun rolesSwappedNotice(spec: ActivitySpec, role: String): String {
        val badge = roleBadge(spec, role)
        return "Roles swapped — now ${badge.take(1).lowercase()}${badge.drop(1)}"
    }

    // ------------------------------------------------------------------ words you needed

    /** `NeededWord`: [kind] "target" (the round's answer) or "hint" (a word the describer could use). */
    data class NeededWord(val hanzi: String, val pinyin: String, val english: String, val kind: String, val round: Int)

    /**
     * `wordsYouNeeded`: the words a describe round needed — its answer, then its hint words (reading
     * and meaning from the glossary, "" when none) — for "+ Add as card". [round] = one round; null =
     * every round played so far (not skipped), as on the summary. Each hanzi once.
     */
    fun wordsYouNeeded(s: ActivitySession, round: Int? = null): List<NeededWord> {
        val spec = s.spec
        if (spec.kind != ActivityKinds.DESCRIBE) return emptyList()
        val rounds = if (round != null) listOf(round) else s.results.filter { it.skipped != true }.map { it.round }
        val out = ArrayList<NeededWord>()
        val seen = HashSet<String>()
        fun add(w: NeededWord) {
            if (w.hanzi.isEmpty() || !seen.add(w.hanzi)) return
            out += w
        }
        for (r in rounds) {
            val it = spec.itemList.getOrNull(r) ?: continue
            add(NeededWord(it.hanzi.orEmpty(), it.pinyin, it.english, "target", r))
            for (h in it.hints.orEmpty()) {
                val g = spec.glossary?.firstOrNull { x -> x.hanzi == h }
                add(NeededWord(h, g?.pinyin ?: "", g?.english ?: "", "hint", r))
            }
        }
        return out
    }

    // ------------------------------------------------------------------ catalogue

    /** `findActivity`. */
    fun find(id: String): ActivitySpec? = ActivityCatalogue.ALL.firstOrNull { it.id == id }

    /** `ACTIVITY_KIND_INFO`. */
    val KIND_INFO: Map<String, ActivityKindInfo> = linkedMapOf(
        ActivityKinds.DESCRIBE to ActivityKindInfo("🎯", "Describe & guess", "One describes, one guesses"),
        ActivityKinds.INFO_GAP to ActivityKindInfo("🧩", "Information gap", "Each sees half — ask to fill the rest"),
        ActivityKinds.ROLEPLAY to ActivityKindInfo("🎭", "Role-play", "Read a dialogue together, turn by turn"),
        ActivityKinds.BUILD to ActivityKindInfo("🧱", "Sentence building", "Put the words in order together"),
        ActivityKinds.QUIZ to ActivityKindInfo("❓", "Quick quiz", "Tutor asks, student answers live"),
        ActivityKinds.DICTATION to ActivityKindInfo("✍️", "Dictation", "Tutor says it, student writes it"),
    )

    /** `validateActivitySpec`: problems with a spec (empty = fine). */
    fun validate(spec: ActivitySpec): List<String> {
        val p = ArrayList<String>()
        if (spec.id.isEmpty() || spec.title.isEmpty()) p += "id and title are required"
        if (spec.tutorRole != "a" && spec.tutorRole != "b") p += "tutor_role must be a or b"
        when (spec.kind) {
            ActivityKinds.DESCRIBE -> {
                if (spec.itemList.size < 4) p += "describe needs at least 4 items (four options a round)"
                if (spec.itemList.map { it.hanzi }.toSet().size != spec.itemList.size) p += "describe items must differ"
                for (d in spec.distractors.orEmpty()) if (spec.itemList.any { it.hanzi == d.hanzi }) p += "distractor ${d.hanzi} is also an item"
                spec.glossary?.let { glossary ->
                    for (it in spec.itemList) for (h in it.hints.orEmpty()) if (glossary.none { g -> g.hanzi == h }) p += "hint $h has no glossary entry"
                }
            }
            ActivityKinds.INFO_GAP -> {
                val hanzi = spec.choices.orEmpty().map { it.hanzi }.toSet()
                spec.rowList.forEachIndexed { ri, r ->
                    if (r.cells.size != spec.columns.orEmpty().size) p += "row ${ri + 1} needs one cell per column"
                    r.cells.forEach { c -> if (c.value !in hanzi) p += "\"${c.value}\" is not among the choices" }
                }
            }
            ActivityKinds.ROLEPLAY -> if (spec.lineList.isEmpty()) p += "a dialogue needs lines"
            ActivityKinds.BUILD -> spec.itemList.forEachIndexed { i, it -> if (it.tiles.orEmpty().size < 2) p += "sentence ${i + 1} needs at least 2 tiles" }
            ActivityKinds.QUIZ -> spec.questionList.forEachIndexed { i, q ->
                if (q.options.size < 2) p += "question ${i + 1} needs 2+ options"
                if (q.answer < 0 || q.answer >= q.options.size) p += "question ${i + 1}: answer out of range"
                if (q.prompt.isEmpty() && q.audio.isNullOrEmpty()) p += "question ${i + 1} needs a prompt or audio"
            }
            ActivityKinds.DICTATION -> if (spec.itemList.isEmpty()) p += "dictation needs words"
        }
        return p
    }
}
