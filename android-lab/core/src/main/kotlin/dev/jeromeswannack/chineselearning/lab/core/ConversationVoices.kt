package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/lesson/voices.ts — the TTS voices a conversation exercise is spoken in:
 * the curated catalogue (Settings → Conversation voices), the enabled pools, the per-dialogue
 * rotation and the selection check. Parity-tested against the TypeScript
 * (`parity/fixtures/lesson.ts` → `LessonParityTest`).
 */
data class ConversationVoice(
    val id: String,
    val name: String,
    /** "female" | "male" */
    val gender: String,
    /** child | young | adult | senior */
    val age: String,
    /** standard | southern | hong_kong */
    val accent: String,
    /** newsreader | neutral | warm | youthful | soft | character */
    val style: String,
    /** mandarin | classic */
    val family: String,
    val defaultOn: Boolean,
    val note: String,
)

object ConversationVoices {
    /** CONVERSATION_TTS_SPEED — conversation lines at close to real pace (every other clip: 0.6). */
    const val SPEED = 0.9

    /** CONVERSATION_LINE_GAP_MS — the turn-taking beat between two lines. */
    const val LINE_GAP_MS = 200L

    /** VOICE_SAMPLE_TEXT — what every voice sample says. */
    const val SAMPLE_TEXT = "你好！请问，去火车站怎么走？"

    private const val M = "Chinese (Mandarin)_"

    private fun v(id: String, name: String, gender: String, age: String, style: String, on: Boolean, note: String, accent: String = "standard") =
        ConversationVoice(id, name, gender, age, accent, style, if (id.startsWith(M)) "mandarin" else "classic", on, note)

    /** CONVERSATION_VOICES, same order. */
    val ALL: List<ConversationVoice> = listOf(
        // ---- female ----
        v("${M}News_Anchor", "News Anchor", "female", "adult", "newsreader", true, "Newsreader — crisp, neutral standard Mandarin"),
        v("presenter_female", "Presenter (female)", "female", "adult", "newsreader", true, "TV host — clear and neutral"),
        v("audiobook_female_1", "Audiobook narrator (female)", "female", "adult", "neutral", true, "Narrator — even, unhurried, teacher-like"),
        v("${M}Kind-hearted_Antie", "Kind-hearted Auntie", "female", "adult", "warm", true, "Friendly middle-aged woman — good for shopkeepers, neighbours"),
        v("${M}Wise_Women", "Wise Woman", "female", "adult", "soft", false, "Soft, intimate delivery — was in almost every conversation so far"),
        v("${M}IntellectualGirl", "Intellectual Girl", "female", "young", "youthful", false, "Young and polished — listen before turning on"),
        v("${M}Sweet_Lady", "Sweet Lady", "female", "adult", "soft", false, "Breathy, “sweet” delivery — not for lessons"),
        v("${M}Warm_Bestie", "Warm Bestie", "female", "young", "soft", false, "Breathy, intimate “bestie” register — not for lessons"),
        v("${M}Soft_Girl", "Soft Girl", "female", "young", "soft", false, "Whispery, soft — hard to hear, not for lessons"),
        v("${M}Warm_Girl", "Warm Girl", "female", "young", "youthful", false, "Young, cutesy register"),
        v("${M}Crisp_Girl", "Crisp Girl", "female", "young", "youthful", false, "Teenage girl"),
        v("${M}Cute_Spirit", "Cute Spirit", "female", "child", "character", false, "Cartoon character voice"),
        v("${M}Lyrical_Voice", "Lyrical Voice", "female", "adult", "character", false, "Sing-song, lyrical — a performance voice"),
        v("${M}Mature_Woman", "Mature Woman", "female", "adult", "soft", false, "Low, “mature” register — listen before turning on"),
        v("${M}HK_Flight_Attendant", "HK Flight Attendant", "female", "adult", "neutral", false, "Hong Kong accent", "hong_kong"),
        v("${M}Arrogant_Miss", "Arrogant Miss", "female", "young", "character", false, "Role-play character voice"),
        v("female-chengshu", "Mature woman (classic)", "female", "adult", "soft", false, "Low, “mature” register — listen before turning on"),
        v("female-yujie", "Big sister “yujie” (classic)", "female", "adult", "character", false, "御姐 role-play archetype — sultry, not for lessons"),
        v("female-shaonv", "Young girl (classic)", "female", "young", "youthful", false, "Teenage girl"),
        v("female-tianmei", "Sweet woman (classic)", "female", "young", "soft", false, "Breathy, “sweet” delivery — not for lessons"),
        // ---- male ----
        v("${M}Male_Announcer", "Male Announcer", "male", "adult", "newsreader", true, "Announcer — crisp, neutral standard Mandarin"),
        v("presenter_male", "Presenter (male)", "male", "adult", "newsreader", true, "TV host — clear and neutral"),
        v("${M}Gentleman", "Gentleman", "male", "adult", "neutral", true, "Formal, clear adult man"),
        v("${M}Sincere_Adult", "Sincere Adult", "male", "adult", "neutral", true, "Plain, friendly adult man"),
        v("audiobook_male_1", "Audiobook narrator (male)", "male", "adult", "neutral", true, "Narrator — even, unhurried, teacher-like"),
        v("${M}Gentle_Youth", "Gentle Youth", "male", "young", "neutral", true, "Calm young man — good for students, colleagues"),
        v("${M}Radio_Host", "Radio Host", "male", "adult", "newsreader", false, "The app’s voice for every other clip — off so conversations sound different"),
        v("${M}Reliable_Executive", "Reliable Executive", "male", "adult", "neutral", false, "Steady, businesslike — listen before turning on"),
        v("male-qn-jingying", "Young professional (classic)", "male", "young", "neutral", false, "Listen before turning on"),
        v("male-qn-daxuesheng", "University student (classic)", "male", "young", "youthful", false, "Listen before turning on"),
        v("${M}Kind-hearted_Elder", "Kind-hearted Elder", "male", "senior", "warm", false, "Grandfatherly — turn on for older speakers"),
        v("${M}Gentle_Senior", "Gentle Senior", "male", "senior", "warm", false, "Older, slower speaker"),
        v("${M}Humorous_Elder", "Humorous Elder", "male", "senior", "character", false, "Comic character voice"),
        v("${M}Southern_Young_Man", "Southern Young Man", "male", "young", "neutral", false, "Southern accent", "southern"),
        v("${M}Unrestrained_Young_Man", "Unrestrained Young Man", "male", "young", "character", false, "Role-play character voice"),
        v("${M}Stubborn_Friend", "Stubborn Friend", "male", "young", "character", false, "Role-play character voice"),
        v("${M}Straightforward_Boy", "Straightforward Boy", "male", "child", "youthful", false, "Boy"),
        v("${M}Pure-hearted_Boy", "Pure-hearted Boy", "male", "child", "youthful", false, "Boy"),
        v("male-qn-qingse", "Shy young man (classic)", "male", "young", "character", false, "Role-play character voice"),
        v("male-qn-badao", "Domineering young man (classic)", "male", "young", "character", false, "Role-play character voice"),
    )

    private val BY_ID = ALL.associateBy { it.id }

    fun voice(id: String): ConversationVoice? = BY_ID[id]

    /** DEFAULT_CONVERSATION_VOICE_IDS. */
    val DEFAULT_IDS: List<String> = ALL.filter { it.defaultOn }.map { it.id }

    /** `conversationVoicePools`: enabled voices by gender, catalogue order; < 2 usable → the shipped defaults. */
    fun pools(enabled: List<String>?): Map<String, List<String>> {
        val on = enabled.orEmpty().toSet()
        var usable = ALL.filter { it.id in on }
        if (usable.size < 2) usable = ALL.filter { it.defaultOn }
        return mapOf(
            "female" to usable.filter { it.gender == "female" }.map { it.id },
            "male" to usable.filter { it.gender == "male" }.map { it.id },
        )
    }

    data class Selection(val enabled: List<String>, val problems: List<String>)

    /** `validateConversationVoiceSelection` (for a list of ids): known ids, ≥ 1 female and ≥ 1 male. */
    fun validate(input: List<String>): Selection {
        val problems = mutableListOf<String>()
        val on = LinkedHashSet<String>()
        for (id in input) if (id in BY_ID) on += id else problems += "Unknown voice: $id"
        val enabled = ALL.filter { it.id in on }.map { it.id }
        if (enabled.none { BY_ID.getValue(it).gender == "female" }) problems += "Keep at least one female voice on"
        if (enabled.none { BY_ID.getValue(it).gender == "male" }) problems += "Keep at least one male voice on"
        return Selection(enabled, problems)
    }

    /** `conversationSeed`: djb2 over the situation and the lines' hanzi joined by "\n", mod 2^32. */
    fun seed(situation: String, lines: List<ConversationLine>): Long {
        val input = (listOf(situation) + lines.map { it.hanzi }).joinToString("\n")
        var hash = 5381L
        for (c in input) hash = (hash * 33 + c.code) % 4294967296L
        return hash
    }

    /** `speakerGender`: the spec's gender, else alternating female / male by position. */
    fun speakerGender(speakers: List<ConversationSpeaker>, i: Int): String =
        speakers.getOrNull(i)?.voice?.takeIf { it == "male" || it == "female" } ?: if (i % 2 == 0) "female" else "male"

    /** `resolveConversationVoices`: a distinct voice per speaker from the enabled pool, rotated by [seed]. */
    fun resolve(speakers: List<ConversationSpeaker>, enabled: List<String>? = null, seed: Long = 0): List<String> {
        val pools = pools(enabled)
        val s = maxOf(0L, seed)
        val all = pools.getValue("female") + pools.getValue("male")
        val used = HashSet<String>()
        val count = mutableMapOf("female" to 0, "male" to 0)
        return speakers.indices.map { i ->
            val gender = speakerGender(speakers, i)
            val own = pools.getValue(gender)
            val pool = own.ifEmpty { pools.getValue(if (gender == "female") "male" else "female") }
            val offset = ((if (gender == "male") s / 97 else s) % pool.size).toInt()
            val n = count.getValue(gender)
            count[gender] = n + 1
            var id: String? = null
            for (k in pool.indices) {
                val candidate = pool[(offset + n + k) % pool.size]
                if (candidate !in used) { id = candidate; break }
            }
            if (id == null) for (k in all.indices) {
                val candidate = all[((s + k) % all.size).toInt()]
                if (candidate !in used) { id = candidate; break }
            }
            val picked = id ?: pool[(offset + n) % pool.size]
            used += picked
            picked
        }
    }

    /** `conversationVoicesFor`: the voices one conversation plays in, for this account's selection. */
    fun forConversation(ex: ConversationExercise, enabled: List<String>? = null): List<String> =
        resolve(ex.speakers, enabled, seed(ex.situation, ex.lines))
}
