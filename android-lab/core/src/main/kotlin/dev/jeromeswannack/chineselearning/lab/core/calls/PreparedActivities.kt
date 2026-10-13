package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Port of shared/call-activities/prepared.ts (+ the headline of shared/students/coverage.ts):
 * in-call activities prepared FOR ONE STUDENT from their previous lessons, waiting in the
 * tutor's call menu and on her student page (docs/VIDEO_CALLS.md "Prepared activities").
 * Parity-tested: parity/fixtures/prepared-activities.ts → PreparedActivitiesParityTest.
 */

/** `PreparedActivity` (GET /api/relationships/:relId/prepared-activities). */
@Serializable
data class PreparedActivity(
    val id: String = "",
    @SerialName("relationship_id") val relationshipId: String = "",
    @SerialName("job_id") val jobId: String = "",
    val spec: ActivitySpec = ActivitySpec(),
    val why: String = "",
    /** ready | used | dismissed. */
    val status: String = "ready",
    @SerialName("source_lesson_id") val sourceLessonId: String? = null,
    /** "Lesson 3 Oct". */
    @SerialName("source_label") val sourceLabel: String? = null,
    val position: Int = 0,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("used_at") val usedAt: String? = null,
    @SerialName("used_in_call_id") val usedInCallId: String? = null,
)

/** `PrepareJob`: the latest generation run. */
@Serializable
data class PrepareJob(
    val id: String = "",
    val status: String = "",
    val trigger: String = "",
    @SerialName("created_count") val createdCount: Int = 0,
    val error: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

/** `CoveredLesson` (shared/students/coverage.ts). */
@Serializable
data class CoveredLesson(
    val date: String = "",
    val title: String? = null,
    val topics: List<String> = emptyList(),
    /** call | notes. */
    val source: String = "call",
    @SerialName("new_words") val newWords: Int = 0,
    val corrections: Int = 0,
)

@Serializable
data class KnownPair(val known: Int = 0, val learning: Int = 0)

/** `StudentCoverage`: "What <student> has covered". */
@Serializable
data class StudentCoverage(
    val lessons: List<CoveredLesson> = emptyList(),
    @SerialName("lesson_count") val lessonCount: Int = 0,
    val words: KnownPair = KnownPair(),
    val characters: KnownPair = KnownPair(),
    @SerialName("recent_words") val recentWords: List<ActivityWord> = emptyList(),
)

object PreparedActivities {
    /** `PREPARED_ACTIVITY_PREFIX`. */
    const val PREFIX = "prepared:"

    /** `preparedActivityId`: what a client starts a prepared one with (`activity_start`). */
    fun activityId(rowId: String): String = "$PREFIX$rowId"

    private val ID = Regex("^[A-Za-z0-9_:-]{1,100}$")

    /** `preparedRowId`: the prepared row id inside an activity id, else null. */
    fun rowId(activityId: String): String? {
        if (!activityId.startsWith(PREFIX)) return null
        val id = activityId.substring(PREFIX.length).trim()
        return if (ID.matches(id)) id else null
    }

    /** `prepareJobActive`. */
    fun jobActive(job: PrepareJob?): Boolean = job?.status == "queued" || job?.status == "running"

    /** `orderPrepared`: ready (newest batch first, then position), then used (most recently used first); dismissed out. */
    fun order(list: List<PreparedActivity>): List<PreparedActivity> {
        val ready = list.filter { it.status == "ready" }.sortedWith { x, y ->
            if (x.createdAt == y.createdAt) {
                (x.position - y.position).takeIf { it != 0 } ?: x.id.compareTo(y.id).sign()
            } else y.createdAt.compareTo(x.createdAt).sign()
        }
        val used = list.filter { it.status == "used" }.sortedWith { x, y ->
            (y.usedAt.orEmpty().compareTo(x.usedAt.orEmpty())).sign().takeIf { it != 0 } ?: x.id.compareTo(y.id).sign()
        }
        return ready + used
    }

    private fun Int.sign(): Int = if (this < 0) -1 else if (this > 0) 1 else 0

    /** `firstName`. */
    fun firstName(name: String?): String {
        val n = name.orEmpty().trim()
        if (n.isEmpty()) return "your student"
        return n.split(Regex("\\s+"))[0]
    }

    /** `preparedHeadline`. */
    fun headline(readyCount: Int): String {
        if (readyCount <= 0) return "No activities ready for the next lesson yet"
        return "Ready for next lesson: $readyCount ${if (readyCount == 1) "activity" else "activities"}"
    }

    /** `preparedSectionTitle`: "For Jerome · from last lesson". */
    fun sectionTitle(studentName: String?): String = "For ${firstName(studentName)} · from last lesson"

    private fun word(hanzi: String, pinyin: String, english: String) =
        hanzi + (if (pinyin.isNotEmpty()) " $pinyin" else "") + (if (english.isNotEmpty()) " — $english" else "")

    /** `activityPreview`: what's inside, as short lines (at most [max]). */
    fun preview(spec: ActivitySpec, max: Int = 12): List<String> {
        val out = mutableListOf<String>()
        when (spec.kind) {
            ActivityKinds.DESCRIBE -> spec.itemList.forEach { out += (if (!it.emoji.isNullOrEmpty()) "${it.emoji} " else "") + word(it.hanzi.orEmpty(), it.pinyin, it.english) }
            ActivityKinds.INFO_GAP -> {
                out += spec.prompt.orEmpty()
                spec.rowList.forEach { r -> out += "${r.label}: ${r.cells.joinToString(" · ") { it.value }}" }
            }
            ActivityKinds.ROLEPLAY -> spec.lineList.forEach { l ->
                val who = spec.speakers?.of(l.speaker).orEmpty().ifEmpty { l.speaker.uppercase() }
                out += "$who: ${l.hanzi}"
            }
            ActivityKinds.BUILD -> spec.itemList.forEach { out += "${it.tiles.orEmpty().joinToString("")} — ${it.english}" }
            ActivityKinds.QUIZ -> spec.questionList.forEach { q ->
                val right = q.options.getOrNull(q.answer).orEmpty()
                val ask = q.prompt.ifEmpty { if (!q.audio.isNullOrEmpty()) "🔊 ${q.audio}" else "?" }
                out += "$ask → $right"
            }
            ActivityKinds.DICTATION, ActivityKinds.REVIEW -> spec.itemList.forEach { out += word(it.hanzi.orEmpty(), it.pinyin, it.english) }
        }
        if (out.size > max) return out.take(max - 1) + "… and ${out.size - (max - 1)} more"
        return out
    }

    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

    /** `coverageHeadline` (shared/students/coverage.ts). */
    fun coverageHeadline(c: StudentCoverage): String {
        val met = c.words.known + c.words.learning
        val chars = c.characters.known + c.characters.learning
        val parts = mutableListOf<String>()
        if (met > 0) parts += plural(met, "word", "words") + " met" + (if (c.words.known > 0) " (${c.words.known} known well)" else "")
        if (chars > 0) parts += plural(chars, "character", "characters")
        if (c.lessonCount > 0) parts += plural(c.lessonCount, "lesson", "lessons")
        return parts.joinToString(" · ")
    }
}
