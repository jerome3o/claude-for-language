package dev.jeromeswannack.chineselearning.lab.core

/**
 * One clip a mini lesson can play (`LessonAudioClip`, shared/lesson/audioClips.ts): "tts" = the
 * default lesson voice; "conversation" = a dialogue line in its speaker's [voice] at the
 * provider rate [speed] with its [delivery]. [exercise] = the exercise's place in the flattened
 * lesson (sections in order, 0-based).
 */
data class LessonAudioClip(
    val kind: String,
    val text: String,
    val voice: String? = null,
    val speed: Double? = null,
    val delivery: String? = null,
    val exercise: Int,
) {
    val isConversation: Boolean get() = kind == CONVERSATION

    /** The [ConversationClip] the conversation player / cache reads (null for a default-voice clip). */
    fun conversationClip(): ConversationClip? =
        if (isConversation && voice != null) ConversationClip(text, voice, speed ?: 0.0, delivery ?: "natural") else null

    companion object {
        const val TTS = "tts"
        const val CONVERSATION = "conversation"
    }
}

/**
 * Every clip a mini lesson can play, in ONE list — port of shared/lesson/audioClips.ts
 * (parity-tested, parity/fixtures/lesson-audio.ts). Read by the background prefetch (the
 * lessons the phone will offer soon, [lessonsToPrefetch]) and the player's open-time prefetch
 * (current exercise first, [orderForPrefetch]); docs/AUDIO.md "Lesson audio prefetch".
 */
object LessonAudioClips {
    /** `UPCOMING_NEW_LESSONS_PREFETCH`. */
    const val UPCOMING_NEW = 3

    /** `exerciseAudioClips`: the clips one exercise plays, in order; a conversation needs [resolve]. */
    fun exerciseClips(ex: LessonExercise, exercise: Int, resolve: ((ConversationExercise) -> ResolvedConversationAudio)? = null): List<LessonAudioClip> {
        if (ex is ConversationExercise) {
            if (resolve == null) return emptyList()
            val audio = resolve(ex)
            return ex.lines.mapNotNull { line ->
                val voice = audio.voices.getOrNull(line.speaker)
                if (AnswerKey.jsTrim(line.hanzi).isEmpty() || voice.isNullOrEmpty()) null
                else LessonAudioClip(LessonAudioClip.CONVERSATION, line.hanzi, voice, audio.speed, audio.delivery, exercise)
            }
        }
        return Lessons.exerciseTtsTexts(ex).filter { AnswerKey.jsTrim(it).isNotEmpty() }.map { LessonAudioClip(LessonAudioClip.TTS, it, exercise = exercise) }
    }

    /** `lessonAudioClips`: every clip, exercise by exercise (duplicates kept). */
    fun lessonClips(spec: CustomLessonSpec, resolve: ((ConversationExercise) -> ResolvedConversationAudio)? = null): List<LessonAudioClip> {
        val out = ArrayList<LessonAudioClip>()
        var exercise = 0
        for (section in spec.sections) for (ex in section.exercises) {
            out += exerciseClips(ex, exercise, resolve)
            exercise++
        }
        return out
    }

    /** `lessonClipId`: what the clip sounds like (kind, voice, speed, delivery, text). */
    fun clipId(c: LessonAudioClip): String =
        "${c.kind}|${c.voice ?: ""}|${c.speed?.let { Js.numberToString(it) } ?: ""}|${c.delivery ?: ""}|${c.text}"

    /** `orderClipsForPrefetch`: exercise [current] first, then the ones after it, then the earlier ones — each clip once. */
    fun orderForPrefetch(clips: List<LessonAudioClip>, current: Int = 0): List<LessonAudioClip> {
        val seen = HashSet<String>()
        val out = ArrayList<LessonAudioClip>()
        for (c in clips.filter { it.exercise >= current } + clips.filter { it.exercise < current }) {
            if (seen.add(clipId(c))) out += c
        }
        return out
    }

    /** `distinctLessonClips`. */
    fun distinctClips(spec: CustomLessonSpec, resolve: ((ConversationExercise) -> ResolvedConversationAudio)? = null): List<LessonAudioClip> =
        orderForPrefetch(lessonClips(spec, resolve), 0)

    /** `PrefetchLessonRow`: lock = "none" | "locked" | "unlocked". */
    data class PrefetchRow(val id: String, val createdAt: String, val finishes: Int, val retired: Boolean, val lock: String)

    /** One homework assignment as far as the prefetch cares. */
    data class HomeworkRef(val kind: String, val targetId: String, val status: String)

    /**
     * `lessonsToPrefetch`: today's lessons, every lesson with OPEN homework, the locked / unlocked
     * ones, then the next [upcomingNew] new ones oldest first — lessons on the phone only, once each.
     */
    fun lessonsToPrefetch(todays: List<String>, homework: List<HomeworkRef>, lessons: List<PrefetchRow>, upcomingNew: Int = UPCOMING_NEW): List<String> {
        val byId = lessons.associateBy { it.id }
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        fun add(id: String) {
            if (byId[id] == null || !seen.add(id)) return
            out += id
        }
        todays.forEach(::add)
        for (a in homework) if (a.kind == "lesson" && a.status == "active") add(a.targetId)
        for (l in lessons) if (l.lock != "none" && !l.retired) add(l.id)
        lessons.filter { it.lock == "none" && !it.retired && it.finishes == 0 && it.id !in seen }
            .sortedWith(compareBy<PrefetchRow> { it.createdAt }.thenBy { it.id })
            .take(maxOf(0, upcomingNew))
            .forEach { add(it.id) }
        return out
    }
}
