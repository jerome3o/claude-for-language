package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.McOptions
import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.random.Random

/**
 * Multiple choice for the typing cards — a port of frontend/src/services/multipleChoice.ts.
 *
 * - A generation request times out after [TIMEOUT_MS] and the card falls back to typing
 *   with a one-line note. Nothing hangs.
 * - Offline, options already cached for the note are fine; nothing is generated.
 * - The mode is per card: nothing carries over to the next one.
 */
object MultipleChoice {
    const val TIMEOUT_MS = 8_000L

    @Serializable
    data class Row(val correct: String, val options: List<String>)

    enum class Fallback(val message: String) {
        OFFLINE("No connection — type your answer instead."),
        TIMEOUT("Options took too long — type your answer instead."),
        ERROR("Couldn't build options — type your answer instead."),
        EMPTY("No options for this word — type your answer instead."),
    }

    sealed interface Load {
        data class Ready(val rows: List<Row>, val generated: Boolean) : Load
        data class Fallen(val reason: Fallback) : Load
    }

    /**
     * `parseMcOptions`: the JSON stored on the note; null when missing or malformed. Every row
     * goes through [McOptions.sanitize] (characters only — never a pinyin "xi" as an option).
     */
    fun parse(raw: String?): List<Row>? {
        if (raw.isNullOrBlank()) return null
        val arr = runCatching { Json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return null
        val rows = arr.mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val correct = (o["correct"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return@mapNotNull null
            val options = runCatching { o["options"]!!.jsonArray.map { (it as JsonPrimitive).content } }.getOrNull() ?: return@mapNotNull null
            McOptions.sanitize(McOptions.Row(correct, options)).let { Row(it.correct, it.options) }
        }
        return rows.ifEmpty { null }
    }

    /** `shuffleMcOptions`: Fisher–Yates per row so positions can't be memorised. */
    fun shuffle(rows: List<Row>, random: Random = Random.Default): List<Row> = rows.map { row ->
        val s = row.options.toMutableList()
        for (i in s.lastIndex downTo 1) {
            val j = random.nextInt(i + 1)
            val t = s[i]; s[i] = s[j]; s[j] = t
        }
        Row(row.correct, s)
    }

    private val LATIN = Regex("[a-zA-Z]")
    private val HAN = Regex("[\\u4E00-\\u9FFF\\u3400-\\u4DBF]")

    /** `isEnglishEntry`: English (no hanzi) rows are shown as text rather than choices. */
    fun isEnglishEntry(correct: String): Boolean = LATIN.containsMatchIn(correct) && !HAN.containsMatchIn(correct)

    /** `initialMcSelections`: punctuation (single option) and English rows are pre-selected. */
    fun initialSelections(rows: List<Row>): List<String?> = rows.map { if (it.options.size == 1 || isEnglishEntry(it.correct)) it.correct else null }

    /** `isChoiceRow`: a row the learner picks in (not punctuation, not an English text row). */
    fun isChoiceRow(row: Row): Boolean = row.options.size > 1 && !isEnglishEntry(row.correct)

    /** `hasMcPick`: has the learner picked anything yet? Pre-selected rows don't count. */
    fun hasPick(rows: List<Row>, selections: List<String?>): Boolean =
        rows.withIndex().any { (i, row) -> isChoiceRow(row) && selections.getOrNull(i) != null }

    /**
     * `mcSubmitLabel`: one submit, any time — the grid never waits for every row. Nothing
     * picked → "Show answer" (give up and move on); anything picked → "Submit".
     */
    fun submitLabel(rows: List<Row>, selections: List<String?>): String = if (hasPick(rows, selections)) "Submit" else "Show answer"

    /**
     * `mcSubmittedAnswer`: the review's user_answer — the picks in row order, unselected rows
     * skipped. Nothing picked → "" (exactly like revealing an empty typed card).
     */
    fun submittedAnswer(rows: List<Row>, selections: List<String?>): String =
        if (!hasPick(rows, selections)) "" else selections.filterNotNull().joinToString("")

    enum class SlotStatus { RIGHT, WRONG, SKIPPED, GIVEN }

    data class Slot(val correct: String, val chosen: String?, val status: SlotStatus)

    /**
     * `mcAnswerSlots`: row-by-row result for the answer side (a partial answer can't be diffed
     * position by position — a skipped row shifts everything after it).
     */
    fun answerSlots(rows: List<Row>, selections: List<String?>): List<Slot> = rows.mapIndexed { i, row ->
        val chosen = selections.getOrNull(i)
        when {
            !isChoiceRow(row) -> Slot(row.correct, row.correct, SlotStatus.GIVEN)
            chosen == null -> Slot(row.correct, null, SlotStatus.SKIPPED)
            chosen == row.correct -> Slot(row.correct, chosen, SlotStatus.RIGHT)
            else -> Slot(row.correct, chosen, SlotStatus.WRONG)
        }
    }

    private fun core(rows: List<Row>) = rows.map { McOptions.Row(it.correct, it.options) }

    /** `isMcCompact`: many rows to pick → smaller tiles and gaps so a sentence fits. */
    fun isCompact(rows: List<Row>): Boolean = McOptions.isCompact(core(rows))

    /** `nextUnansweredRow`: after a pick in [picked], the row to scroll into view (or null). */
    fun nextUnansweredRow(rows: List<Row>, selections: List<String?>, picked: Int): Int? = McOptions.nextUnansweredRow(core(rows), selections, picked)

    /** Every row right (or given): the back shows the ordinary green answer. */
    fun allRight(slots: List<Slot>): Boolean = slots.all { it.status == SlotStatus.RIGHT || it.status == SlotStatus.GIVEN }

    /**
     * `loadMultipleChoice`: cached options, freshly generated ones, or the typing fallback.
     * [generate] is only called when online and nothing is cached, and is cut at [timeoutMs].
     */
    suspend fun load(cached: String?, online: Boolean, timeoutMs: Long = TIMEOUT_MS, generate: suspend () -> String?): Load {
        parse(cached)?.let { return Load.Ready(it, generated = false) }
        if (!online) return Load.Fallen(Fallback.OFFLINE)
        return try {
            val raw = withTimeout(timeoutMs) { generate() }
            parse(raw)?.let { Load.Ready(it, generated = true) } ?: Load.Fallen(Fallback.EMPTY)
        } catch (e: TimeoutCancellationException) {
            Load.Fallen(Fallback.TIMEOUT)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Fallen(Fallback.ERROR)
        }
    }

    /** The note fields the Room mirror doesn't keep, cached per note for offline cards. */
    @Serializable
    data class NoteExtra(val options: String? = null, val pinyinOnly: Boolean = false)

    const val KEY = "study/mc"
    private const val MAX_AGE_MS = 12 * 60 * 60 * 1000L

    /**
     * Sync step: every deck's notes (GET /api/decks/:id — full note rows) → the options and
     * pinyin-only flag of the notes that have them, so listen cards get their choices on the
     * train. Twice a day at most (a full resync refreshes at once).
     */
    val Sync = FeatureSync { ctx ->
        if (!ctx.full && ctx.cache.isFresh(KEY, MAX_AGE_MS)) return@FeatureSync
        val deckIds = ctx.db.dao().decks().map { it.id }
        val map = HashMap<String, NoteExtra>()
        for (deckId in deckIds) {
            val deck = runCatching { ctx.api.get<JsonObject>("/api/decks/${dev.jeromeswannack.chineselearning.lab.data.api.enc(deckId)}") }.getOrNull() ?: continue
            val notes = (deck["notes"] as? kotlinx.serialization.json.JsonArray) ?: continue
            for (el in notes) {
                val o = el.jsonObject
                val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: continue
                val options = (o["multiple_choice_options"] as? JsonPrimitive)?.contentOrNull?.takeIf { parse(it) != null }
                val pinyinOnly = (o["pinyin_only"] as? JsonPrimitive)?.contentOrNull.let { it == "1" || it == "true" }
                if (options != null || pinyinOnly) map[id] = NoteExtra(options, pinyinOnly)
            }
        }
        ctx.cache.put(KEY, TutorNotes.KIND, map as Map<String, NoteExtra>)
    }
}
