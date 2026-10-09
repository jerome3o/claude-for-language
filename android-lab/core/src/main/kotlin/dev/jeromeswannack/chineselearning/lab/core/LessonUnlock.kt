package dev.jeromeswannack.chineselearning.lab.core

/**
 * Unlockable mini lessons — port of shared/lesson/unlock.ts (parity-tested,
 * `parity/fixtures/lesson-unlock.ts` → LessonUnlockParityTest).
 *
 * A lesson can wait LOCKED until the learner has done something real: listened to an audio
 * lesson (the podcast's companion mini lesson) or a task they do themselves ("Watch episode 3 of
 * …"). A locked lesson is never offered ([LessonSchedule.todaysLessons]' `locked`); once unlocked
 * a NEW one comes today on top of the daily new-lesson place (`unlocked`). Unlocking is an
 * offline-first event: the earliest `unlocked_at` wins.
 */
data class LessonUnlock(
    /** "audio_lesson" | "manual". */
    val kind: String,
    val audioLessonId: String? = null,
    val prompt: String? = null,
) {
    val isAudio: Boolean get() = kind == AUDIO_LESSON

    companion object {
        const val AUDIO_LESSON = "audio_lesson"
        const val MANUAL = "manual"
    }
}

object LessonUnlocks {
    const val LISTENED_FRACTION = 0.85
    const val UNLOCK_PROMPT_MAX = 200
    val VIAS = listOf("auto", "manual", "player")

    /** `lessonLockStatus`: "none" | "locked" | "unlocked". */
    fun status(unlock: LessonUnlock?, unlockedAt: String?): String = when {
        unlock == null -> "none"
        unlockedAt.isNullOrEmpty() -> "locked"
        else -> "unlocked"
    }

    private fun parseOrNull(s: String?): Long? = if (s.isNullOrEmpty()) null else runCatching { Js.parseDate(s) }.getOrNull()

    /** `earlierUnlock`: the earliest of two times (a missing / garbage one loses). */
    fun earlier(a: String?, b: String?): String? {
        val ta = parseOrNull(a)
        val tb = parseOrNull(b)
        if (ta == null) return if (tb != null) b else null
        if (tb == null) return a
        return if (tb < ta) b else a
    }

    /** `audioLessonListened`: ≥ 85 % of the length, or into the last chapter when there are several. */
    fun listened(positionMs: Double, durationMs: Double, chapterStarts: List<Double> = emptyList()): Boolean {
        if (positionMs.isNaN() || durationMs.isNaN() || positionMs.isInfinite() || durationMs.isInfinite()) return false
        if (durationMs <= 0 || positionMs <= 0) return false
        if (positionMs >= durationMs * LISTENED_FRACTION) return true
        val starts = chapterStarts.filter { !it.isNaN() && !it.isInfinite() }
        if (starts.size < 2) return false
        val last = starts.max()
        return last > 0 && positionMs >= last
    }

    /** A lesson as the rules below see it. */
    data class Item(val id: String, val unlock: LessonUnlock?, val unlockedAt: String?)

    /** `lessonsUnlockedByListen`: the locked lessons waiting on [audioLessonId]. */
    fun unlockedByListen(lessons: List<Item>, audioLessonId: String): List<String> =
        lessons.filter { it.unlock?.isAudio == true && it.unlock.audioLessonId == audioLessonId && it.unlockedAt.isNullOrEmpty() }.map { it.id }

    /** `lockSets`: the ids still locked, and those whose condition is met. */
    fun lockSets(lessons: List<Item>): Pair<Set<String>, Set<String>> {
        val locked = LinkedHashSet<String>()
        val unlocked = LinkedHashSet<String>()
        for (l in lessons) when (status(l.unlock, l.unlockedAt)) {
            "locked" -> locked += l.id
            "unlocked" -> unlocked += l.id
        }
        return locked to unlocked
    }

    // ============ Words ============

    private const val SUFFIX = " — mini lesson"

    /** `companionLessonTitle`. */
    fun companionTitle(audioTitle: String): String {
        val t = audioTitle.replace(Regex("\\s+"), " ").trim().ifEmpty { "Audio lesson" }
        return if (t.endsWith(SUFFIX.trim())) t else "$t$SUFFIX"
    }

    /** `unlockButtonLabel`. */
    fun buttonLabel(unlock: LessonUnlock): String = if (unlock.isAudio) "✓ I've listened — unlock" else "✓ Done — unlock"

    /** `lockedLessonLine`. */
    fun lockedLine(unlock: LessonUnlock, audioTitle: String? = null): String {
        if (!unlock.isAudio) return "🔒 ${unlock.prompt.orEmpty()}"
        val title = audioTitle.orEmpty().trim()
        return if (title.isNotEmpty()) "🔒 Unlocks when you've listened to “$title”" else "🔒 Unlocks when you've listened to its audio lesson"
    }

    /** `companionBadge`: generating | failed | locked | unlocked. */
    fun companionBadge(status: String): String = when (status) {
        "generating" -> "✨ Writing its mini lesson…"
        "failed" -> "⚠ Couldn't write its mini lesson"
        "locked" -> "🔒 Mini lesson waiting"
        else -> "✓ Mini lesson unlocked"
    }

    /** `companionReadyLine`. */
    fun readyLine(title: String): String = "Mini lesson ready: $title"
}
