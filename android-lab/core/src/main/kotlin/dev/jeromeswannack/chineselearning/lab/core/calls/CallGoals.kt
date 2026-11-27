package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneOffset

/**
 * Port of shared/calls/goals.ts — 🎯 Structures to use in a video call (Jerome, Nov 2026: "a few
 * sentence structures I should be trying to use … ticked off when used naturally").
 *
 * ONE list per call, kept by the CallRoom (`goals` messages, `welcome.goals`): 3–5 structures the
 * STUDENT met in his mini lessons ([pickCallGoals]); either person adds / removes / reorders, the
 * tutor ticks by hand; the student's own device hears his speech ([foldGoalSpeech] → [goalsHeardIn] →
 * `heard`), one model check answers (`checked`). The room runs [reduceGoals]; this app sends
 * actions ([actionMessage]) and draws the list.
 *
 * Parity-tested against the TypeScript (parity/fixtures/calls-goals.ts → CallsGoalsParityTest).
 */
object CallGoals {
    enum class Status(val wire: String) {
        OPEN("open"), CHECKING("checking"), USED("used"), NEAR("near");

        companion object {
            fun of(wire: String?): Status? = entries.firstOrNull { it.wire == wire }
        }
    }

    data class Structure(
        val name: String,
        val fixed: List<String>,
        val line: String? = null,
        val meaning: String? = null,
        val example: String? = null,
        val lastMet: String? = null,
    )

    /** `CallGoalHit`: by = "auto" | "tutor". */
    data class Hit(val text: String, val at: Long, val by: String, val name: String? = null)

    /** A sentence heard / near miss: { text, at }. */
    data class Heard(val text: String, val at: Long)

    data class Goal(
        val id: String,
        val name: String,
        val line: String?,
        val meaning: String?,
        val example: String?,
        val fixed: List<String>,
        /** "learned" | "added" */
        val source: String,
        val lastMet: String?,
        val status: Status,
        val used: Hit?,
        val checking: Heard?,
        val near: Heard?,
    )

    data class Goals(
        val studentId: String?,
        val studentName: String,
        val goals: List<Goal>,
        val v: Long,
        val available: Long,
    )

    sealed interface Action {
        val kind: String

        data class Add(val text: String) : Action { override val kind = "add" }
        data class Remove(val id: String) : Action { override val kind = "remove" }
        data class Move(val id: String, val to: Int) : Action { override val kind = "move" }
        data class Tick(val id: String, val text: String? = null) : Action { override val kind = "tick" }
        data class Untick(val id: String) : Action { override val kind = "untick" }
        data class HeardIt(val id: String, val text: String) : Action { override val kind = "heard" }
        data class Checked(val id: String, val text: String, val ok: Boolean) : Action { override val kind = "checked" }
    }

    const val GOALS_MIN = 3
    const val GOALS_MAX = 5
    const val GOALS_RECENT_DAYS = 14
    const val GOALS_LIST_MAX = 8
    const val GOAL_INPUT_MAX = 30
    const val GOAL_FIXED_MAX = 6
    const val GOAL_TEXT_MAX = 120
    const val GOAL_CHECK_STALE_MS = 45_000L
    const val GOAL_MAX_GAP = 16
    const val GOAL_MAX_SPAN = 48
    const val GOAL_MIN_CONTENT = 2
    const val GOAL_UTTERANCE_MAX = 80
    private const val DAY_MS = 86_400_000L

    // ------------------------------------------------------------------ picking

    private fun parseIso(s: String?): Long {
        if (s.isNullOrEmpty()) return 0L
        return try {
            Instant.parse(s).toEpochMilli()
        } catch (_: Exception) {
            0L
        }
    }

    /** Port of pickCallGoals(). */
    fun pickCallGoals(structures: List<Structure>, usedNames: List<String>, now: Long): List<Structure> {
        val used = usedNames.map { it.trim() }.toSet()
        val seen = HashSet<String>()
        val list = ArrayList<Structure>()
        for (s in structures) {
            val name = s.name.trim()
            if (name.isEmpty() || name in seen || s.fixed.none { it.trim().isNotEmpty() }) continue
            seen += name
            list += s
        }
        val byMet = Comparator<Structure> { a, b ->
            val d = parseIso(b.lastMet) - parseIso(a.lastMet)
            if (d != 0L) d.sign() else a.name.compareTo(b.name).sign()
        }
        fun recent(s: Structure) = now - parseIso(s.lastMet) <= GOALS_RECENT_DAYS * DAY_MS
        val tiers = listOf(
            list.filter { recent(it) && it.name.trim() !in used }.sortedWith(byMet),
            list.filter { !recent(it) && it.name.trim() !in used }.sortedWith(byMet),
            list.filter { it.name.trim() in used }.sortedWith(byMet),
        )
        val target = maxOf(GOALS_MIN, minOf(GOALS_MAX, tiers[0].size))
        val out = ArrayList<Structure>()
        for (tier in tiers) for (s in tier) if (out.size < target) out += s
        return out
    }

    private fun Long.sign(): Int = if (this > 0) 1 else if (this < 0) -1 else 0
    private fun Int.sign(): Int = if (this > 0) 1 else if (this < 0) -1 else 0

    /** Port of goalsFromStructures(). */
    fun goalsFromStructures(picked: List<Structure>, newId: () -> String): List<Goal> = picked.map { s ->
        Goal(
            id = newId(), name = s.name.trim(), line = s.line?.trim()?.ifEmpty { null }, meaning = s.meaning?.trim()?.ifEmpty { null },
            example = s.example?.trim()?.ifEmpty { null }, fixed = s.fixed.map { it.trim() }.filter { it.isNotEmpty() }.take(GOAL_FIXED_MAX),
            source = "learned", lastMet = s.lastMet, status = Status.OPEN, used = null, checking = null, near = null,
        )
    }

    // ------------------------------------------------------------------ a typed pattern

    private fun chars(s: String): List<String> = CallTextDoc.splitChars(s)

    /** Port of parseGoalPattern(): the runs of Chinese characters are the fixed words. */
    fun parseGoalPattern(raw: String): Pair<String, List<String>>? {
        val text = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim().let { if (it.length > GOAL_INPUT_MAX * 2) it.substring(0, GOAL_INPUT_MAX * 2) else it }
        val fixed = ArrayList<String>()
        var run = ""
        var name = ""
        var gap = false
        for (ch in chars(text)) {
            if (CallGloss.isHan(ch)) {
                if (gap && name.isNotEmpty()) name += "…"
                gap = false
                run += ch
                name += ch
            } else {
                if (run.isNotEmpty()) fixed += run
                run = ""
                gap = true
            }
        }
        if (run.isNotEmpty()) fixed += run
        if (fixed.isEmpty()) return null
        val first = chars(text).firstOrNull() ?: ""
        val startsWithGap = !CallGloss.isHan(first)
        if (gap) name += "…"
        if (startsWithGap) name = "…$name"
        if (chars(name).size > GOAL_INPUT_MAX || fixed.size > GOAL_FIXED_MAX) return null
        return name to fixed
    }

    // ------------------------------------------------------------------ matching

    private val FOLD = mapOf("得" to "的", "地" to "的", "她" to "他", "它" to "他", "嘛" to "吗")

    /** Port of goalMatchKey(). */
    fun goalMatchKey(text: String): String {
        val s = AnswerKey.digitsToHanzi(Normalizer.normalize(text, Normalizer.Form.NFKC))
        val sb = StringBuilder()
        for (ch in chars(s)) if (CallGloss.isHan(ch)) sb.append(FOLD[ch] ?: ch)
        return sb.toString()
    }

    /** Port of matchStructure(): the span [start, end) in goalMatchKey(sentence) (code points), or null. */
    fun matchStructure(sentence: String, fixed: List<String>): Pair<Int, Int>? {
        val words = fixed.map { chars(goalMatchKey(it)) }.filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val key = chars(goalMatchKey(sentence))
        val fixedLen = words.sumOf { it.size }
        if (key.size < fixedLen + GOAL_MIN_CONTENT) return null
        fun at(from: Int, w: List<String>): Int {
            var i = from
            while (i + w.size <= key.size) {
                var ok = true
                for (j in w.indices) if (key[i + j] != w[j]) { ok = false; break }
                if (ok) return i
                i++
            }
            return -1
        }
        var start = at(0, words[0])
        while (start >= 0) {
            var end = start + words[0].size
            var ok = true
            for (k in 1 until words.size) {
                val i = at(end, words[k])
                if (i < 0 || i - end > GOAL_MAX_GAP) { ok = false; break }
                end = i + words[k].size
            }
            if (ok && end - start <= GOAL_MAX_SPAN) return start to end
            start = at(start + 1, words[0])
        }
        return null
    }

    /** Port of goalsHeardIn(). */
    fun goalsHeardIn(sentence: String, goals: List<Goal>): List<Goal> =
        goals.filter { (it.status == Status.OPEN || it.status == Status.NEAR) && matchStructure(sentence, it.fixed) != null }

    // ------------------------------------------------------------------ the room's list

    /** Port of mayActOnGoals(). */
    fun mayActOnGoals(kind: String, userId: String, tutorId: String?, studentId: String?): Boolean = when (kind) {
        "tick", "untick" -> tutorId == null || userId == tutorId
        "heard", "checked" -> studentId != null && userId == studentId
        else -> true
    }

    private val WS = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private fun cleanText(s: String): String = s.replace(WS, " ").trim().let { if (it.length > GOAL_TEXT_MAX) it.substring(0, GOAL_TEXT_MAX) else it }
    private fun cleanId(s: String): String = if (s.length > 64) s.substring(0, 64) else s

    /** Port of sanitizeGoalsAction(). */
    fun sanitizeAction(raw: JsonElement?): Action? {
        val r = raw as? JsonObject ?: return null
        val id = r.str("id")?.let(::cleanId) ?: ""
        return when (r.str("kind")) {
            "add" -> {
                val t = r.str("text")?.trim()?.let { if (it.length > GOAL_INPUT_MAX * 2) it.substring(0, GOAL_INPUT_MAX * 2) else it } ?: ""
                if (t.isNotEmpty()) Action.Add(t) else null
            }
            "remove" -> if (id.isNotEmpty()) Action.Remove(id) else null
            "untick" -> if (id.isNotEmpty()) Action.Untick(id) else null
            "move" -> {
                val to = r.num("to")
                if (id.isNotEmpty() && to != null) Action.Move(id, Js.round(to).toInt()) else null
            }
            "tick" -> {
                val t = r.str("text")?.let(::cleanText) ?: ""
                if (id.isNotEmpty()) Action.Tick(id, t.ifEmpty { null }) else null
            }
            "heard" -> {
                val t = r.str("text")?.let(::cleanText) ?: ""
                if (id.isNotEmpty() && t.isNotEmpty()) Action.HeardIt(id, t) else null
            }
            "checked" -> {
                val t = r.str("text")?.let(::cleanText) ?: ""
                val ok = (r["ok"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
                if (id.isNotEmpty() && t.isNotEmpty() && ok != null) Action.Checked(id, t, ok) else null
            }
            else -> null
        }
    }

    /** Port of reduceGoals(). */
    fun reduceGoals(cur: Goals, action: Action, byUserId: String, byName: String, now: Long, newId: () -> String): Goals? {
        val actionId = when (action) {
            is Action.Add -> null
            is Action.Remove -> action.id
            is Action.Move -> action.id
            is Action.Tick -> action.id
            is Action.Untick -> action.id
            is Action.HeardIt -> action.id
            is Action.Checked -> action.id
        }
        val idx = if (actionId == null) -1 else cur.goals.indexOfFirst { it.id == actionId }
        val goal = if (idx >= 0) cur.goals[idx] else null
        fun withGoal(g: Goal) = cur.copy(goals = cur.goals.mapIndexed { i, x -> if (i == idx) g else x }, v = cur.v + 1)
        return when (action) {
            is Action.Add -> {
                val (name, fixed) = parseGoalPattern(action.text) ?: return null
                if (cur.goals.size >= GOALS_LIST_MAX) return null
                if (cur.goals.any { it.name == name || it.fixed.joinToString("…") == fixed.joinToString("…") }) return null
                val g = Goal(newId(), name, null, null, null, fixed, "added", null, Status.OPEN, null, null, null)
                cur.copy(goals = cur.goals + g, v = cur.v + 1)
            }
            is Action.Remove -> if (goal == null) null else cur.copy(goals = cur.goals.filter { it.id != action.id }, v = cur.v + 1)
            is Action.Move -> {
                if (goal == null) return null
                val to = maxOf(0, minOf(cur.goals.size - 1, action.to))
                if (to == idx) return null
                val rest = cur.goals.filter { it.id != action.id }.toMutableList()
                rest.add(to, goal)
                cur.copy(goals = rest, v = cur.v + 1)
            }
            is Action.Tick -> {
                if (goal == null || goal.status == Status.USED) return null
                val text = action.text ?: goal.checking?.text ?: goal.near?.text ?: ""
                withGoal(goal.copy(status = Status.USED, used = Hit(text, now, "tutor", byName), checking = null))
            }
            is Action.Untick -> {
                if (goal == null || (goal.status != Status.USED && goal.status != Status.CHECKING)) return null
                withGoal(goal.copy(status = Status.OPEN, used = null, checking = null))
            }
            is Action.HeardIt -> {
                if (goal == null || goal.status == Status.USED) return null
                if (goal.status == Status.CHECKING && goal.checking != null && now - goal.checking.at < GOAL_CHECK_STALE_MS) return null
                if (matchStructure(action.text, goal.fixed) == null) return null
                withGoal(goal.copy(status = Status.CHECKING, checking = Heard(action.text, now)))
            }
            is Action.Checked -> {
                if (goal == null || goal.status != Status.CHECKING || goal.checking?.text != action.text) return null
                if (action.ok) withGoal(goal.copy(status = Status.USED, used = Hit(action.text, now, "auto"), checking = null))
                else withGoal(goal.copy(status = Status.NEAR, near = Heard(action.text, now), checking = null))
            }
        }
    }

    /** Port of sanitizeCallGoals(). */
    fun parse(raw: JsonElement?): Goals? {
        val r = raw as? JsonObject ?: return null
        val list = r["goals"] as? JsonArray ?: return null
        val goals = ArrayList<Goal>()
        for (x in list.take(GOALS_LIST_MAX)) {
            val g = x as? JsonObject ?: continue
            val fixed = (g["fixed"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }?.filter { it.trim().isNotEmpty() }?.take(GOAL_FIXED_MAX) ?: emptyList()
            val name = g.str("name")?.trim()?.let { if (it.length > 60) it.substring(0, 60) else it } ?: ""
            val id = g.str("id")?.let(::cleanId) ?: ""
            if (id.isEmpty() || name.isEmpty() || fixed.isEmpty()) continue
            fun hit(h: JsonElement?): Heard? {
                val o = h as? JsonObject ?: return null
                val at = o.num("at")?.takeIf { it.isFinite() } ?: return null
                return Heard(o.str("text")?.let(::cleanText) ?: "", at.toLong())
            }
            fun str(k: String): String? = g.str(k)?.trim()?.takeIf { it.isNotEmpty() }?.let { if (it.length > 400) it.substring(0, 400) else it }
            val usedRaw = g["used"] as? JsonObject
            val usedBase = hit(usedRaw)
            val used = usedBase?.let { b ->
                Hit(b.text, b.at, if (usedRaw?.str("by") == "tutor") "tutor" else "auto", usedRaw?.str("name")?.takeIf { it.isNotEmpty() }?.let { if (it.length > 80) it.substring(0, 80) else it })
            }
            var status = Status.of(g.str("status")) ?: Status.OPEN
            val checking = hit(g["checking"])
            if (status == Status.USED && used == null) status = Status.OPEN
            if (status == Status.CHECKING && checking == null) status = Status.OPEN
            goals += Goal(
                id = id, name = name, line = str("line"), meaning = str("meaning"), example = str("example"), fixed = fixed,
                source = if (g.str("source") == "added") "added" else "learned", lastMet = g.str("last_met"),
                status = status, used = if (status == Status.USED) used else null, checking = if (status == Status.CHECKING) checking else null,
                near = hit(g["near"]),
            )
        }
        return Goals(
            studentId = r.str("student_id")?.takeIf { it.isNotEmpty() },
            studentName = r.str("student_name")?.let { if (it.length > 80) it.substring(0, 80) else it } ?: "",
            goals = goals,
            v = r.num("v")?.takeIf { it.isFinite() }?.toLong() ?: 0L,
            available = r.num("available")?.takeIf { it.isFinite() }?.let { maxOf(0.0, Js.round(it)).toLong() } ?: 0L,
        )
    }

    /** The list as the room's JSON (field for field like the TypeScript object). */
    fun toJson(g: Goals): JsonObject = buildJsonObject {
        if (g.studentId == null) put("student_id", JsonNull) else put("student_id", g.studentId)
        put("student_name", g.studentName)
        put("goals", buildJsonArray { g.goals.forEach { add(goalJson(it)) } })
        put("v", g.v)
        put("available", g.available)
    }

    fun goalJson(g: Goal): JsonObject = buildJsonObject {
        put("id", g.id)
        put("name", g.name)
        put("line", g.line)
        put("meaning", g.meaning)
        put("example", g.example)
        put("fixed", buildJsonArray { g.fixed.forEach { add(JsonPrimitive(it)) } })
        put("source", g.source)
        put("last_met", g.lastMet)
        put("status", g.status.wire)
        put("used", g.used?.let { h -> buildJsonObject { put("text", h.text); put("at", h.at); put("by", h.by); if (h.name != null) put("name", h.name) } } ?: JsonNull)
        put("checking", g.checking?.let { h -> buildJsonObject { put("text", h.text); put("at", h.at) } } ?: JsonNull)
        put("near", g.near?.let { h -> buildJsonObject { put("text", h.text); put("at", h.at) } } ?: JsonNull)
    }

    /** The client → room message for [action]. */
    fun actionMessage(action: Action): String = buildJsonObject {
        put("type", "goals")
        put("action", buildJsonObject {
            put("kind", action.kind)
            when (action) {
                is Action.Add -> put("text", action.text)
                is Action.Remove -> put("id", action.id)
                is Action.Untick -> put("id", action.id)
                is Action.Move -> { put("id", action.id); put("to", action.to) }
                is Action.Tick -> { put("id", action.id); if (action.text != null) put("text", action.text) }
                is Action.HeardIt -> { put("id", action.id); put("text", action.text) }
                is Action.Checked -> { put("id", action.id); put("text", action.text); put("ok", action.ok) }
            }
        })
    }.toString()

    // ------------------------------------------------------------------ speech → utterances

    /** Port of foldGoalSpeech(): (pending, utterances). */
    fun foldGoalSpeech(pending0: String, raw: String): Pair<String, List<String>> {
        val msg = try {
            Json.parseToJsonElement(raw) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return pending0 to emptyList()
        var pending = pending0
        val out = ArrayList<String>()
        fun close() {
            val t = pending.trim()
            if (t.isNotEmpty()) out += t
            pending = ""
        }
        for (tok in (msg["tokens"] as? JsonArray).orEmpty()) {
            val o = tok as? JsonObject ?: continue
            val text = o.str("text") ?: continue
            if ((o["is_final"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull != true) continue
            if (text == "<end>" || text == "<fin>") {
                close()
                continue
            }
            for (ch in chars(text)) {
                pending += ch
                if (ch in SENTENCE_END) close()
            }
            val cs = chars(pending)
            if (cs.size > GOAL_UTTERANCE_MAX) {
                var cut = -1
                for (i in cs.size - 1 downTo 1) if (cs[i] in CLAUSE) { cut = i + 1; break }
                if (cut <= 0) close() else {
                    val head = cs.subList(0, cut).joinToString("").trim()
                    if (head.isNotEmpty()) out += head
                    pending = cs.subList(cut, cs.size).joinToString("")
                }
            }
        }
        if ((msg["finished"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true) close()
        return pending to out
    }

    private val SENTENCE_END = setOf("。", "！", "？", "!", "?", "；", ";")
    private val CLAUSE = setOf("，", ",", "、")

    /** Port of flushGoalSpeech(). */
    fun flushGoalSpeech(pending: String): List<String> = pending.trim().let { if (it.isEmpty()) emptyList() else listOf(it) }

    // ------------------------------------------------------------------ listening

    /** Port of goalListenStatus(): "listening" | "muted" | "unavailable" | "off". [statuses] = the list's goal statuses (null = no list). */
    fun goalListenStatus(live: Boolean, isStudent: Boolean, statuses: List<Status>?, micOn: Boolean, hasMic: Boolean, unavailable: Boolean): String {
        if (!live || !isStudent || statuses == null || statuses.none { it == Status.OPEN || it == Status.NEAR }) return "off"
        if (unavailable) return "unavailable"
        if (!hasMic || !micOn) return "muted"
        return "listening"
    }

    // ------------------------------------------------------------------ words

    const val GOALS_TITLE = "🎯 Structures"
    const val GOALS_MENU_LABEL = "🎯 Structures to use"
    const val GOALS_ADD_PLACEHOLDER = "Add a structure, e.g. 一…就…"
    const val GOAL_CHECKING_LABEL = "✓ checking…"
    const val GOAL_TICK_LABEL = "✓ Tick"
    const val GOAL_UNTICK_LABEL = "Untick"

    fun usedCount(goals: Goals?): Int = goals?.goals?.count { it.status == Status.USED } ?: 0

    /** Port of goalsChipLabel(). */
    fun chipLabel(goals: Goals?): String? {
        if (goals == null) return null
        if (goals.goals.isEmpty()) return "🎯"
        return "🎯 ${usedCount(goals)}/${goals.goals.size}"
    }

    /** Port of goalsChipAria(). */
    fun chipAria(goals: Goals?): String =
        if (goals == null || goals.goals.isEmpty()) "Structures to use" else "Structures to use: ${usedCount(goals)} of ${goals.goals.size} used"

    private fun firstName(name: String): String = name.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: name.trim()

    /** Port of goalsIntro(). */
    fun intro(isStudent: Boolean, studentName: String): String =
        if (isStudent) "Try to use these in today’s conversation — each one ticks itself when you say it."
        else "${firstName(studentName).ifEmpty { "Your student" }} is aiming to use these today. Each one ticks itself when ${firstName(studentName).ifEmpty { "they" }} says it — or tick one by hand."

    /** Port of goalsEmptyText(). */
    fun emptyText(isStudent: Boolean, studentName: String, available: Long): String {
        if (available > 0) return "Nothing to aim for right now — add a structure below."
        return if (isStudent) "No structures from your recent mini lessons yet. Add one to aim for — type a pattern like 一…就…."
        else "No structures from ${firstName(studentName).ifEmpty { "your student" }}’s mini lessons yet. Add one to aim for — type a pattern like 一…就…."
    }

    /** Port of goalListenNote(). */
    fun listenNote(status: String, isStudent: Boolean): String? {
        if (!isStudent) return null
        return when (status) {
            "listening" -> "🎙 Listening for them as you speak"
            "muted" -> "🔇 Your mic is muted — not listening"
            "unavailable" -> "Auto-tick isn’t available right now — your tutor can tick them by hand."
            else -> null
        }
    }

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Port of goalSourceLine(). */
    fun sourceLine(source: String, lastMet: String?): String {
        if (source == "added") return "Added in the call"
        val t = parseIso(lastMet)
        if (t == 0L) return "From a mini lesson"
        val d = Instant.ofEpochMilli(t).atZone(ZoneOffset.UTC)
        return "From a mini lesson · ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]}"
    }

    /** Port of goalHitCaption(). */
    fun hitCaption(hit: Hit): String =
        if (hit.by == "tutor") "✓ ticked by ${firstName(hit.name ?: "").ifEmpty { "your tutor" }}" else "✓ used"

    // ------------------------------------------------------------------ after the call

    data class Summary(val used: List<Triple<String, String, String>>, val near: List<Pair<String, String>>, val notTried: List<String>)

    /** Port of goalsSummary(): used = (name, text, by). */
    fun summary(goals: List<Goal>): Summary {
        val used = ArrayList<Triple<String, String, String>>()
        val near = ArrayList<Pair<String, String>>()
        val not = ArrayList<String>()
        for (g in goals) {
            if (g.status == Status.USED && g.used != null) used += Triple(g.name, g.used.text, g.used.by)
            else if (g.near != null) near += g.name to g.near.text
            else not += g.name
        }
        return Summary(used, near, not)
    }

    /** Port of goalsNotes(). */
    fun notes(s: Summary): String {
        val lines = ArrayList<String>()
        for ((name, text, by) in s.used) lines += "- USED $name${if (text.isNotEmpty()) ": “$text”" else ""}${if (by == "tutor") " (ticked by the tutor)" else ""}"
        for ((name, text) in s.near) lines += "- TRIED, NOT QUITE $name: “$text”"
        for (n in s.notTried) lines += "- NOT TRIED $n"
        return lines.joinToString("\n")
    }

    /** Port of mergeLessonGoals(). */
    fun mergeLessonGoals(lists: List<List<Goal>>): List<Goal> {
        val byName = LinkedHashMap<String, Goal>()
        for (list in lists) for (g in list) {
            val prev = byName[g.name]
            if (prev != null && prev.status == Status.USED && g.status != Status.USED) continue
            byName[g.name] = g
        }
        return byName.values.toList()
    }

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
}
