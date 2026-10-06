package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * The learner's conversation-audio preferences (`ConversationAudioPrefs`): the speed, the
 * delivery and the voices conversation exercises are spoken in. [voices] = preferred voice per
 * gender per provider; [exerciseVoices] = one conversation's voices by speaker (null = automatic),
 * keyed `<provider>:<conversation key>`, oldest first (insertion order matters: the oldest go
 * first past [ConversationAudio.MAX_EXERCISE_VOICE_ENTRIES]).
 */
data class ConversationAudioPrefs(
    /** The provider rate lines are spoken at; null = the provider's default. */
    val speed: Double? = null,
    val delivery: String = "natural",
    val voices: Map<String, Map<String, String>> = emptyMap(),
    val exerciseVoices: Map<String, List<String?>> = emptyMap(),
)

/** `ConversationAudioContext` — where conversation clips come from now (`/api/auth/me` → `conversation_audio`). */
data class ConversationAudioContext(
    val provider: String,
    val defaultSpeed: Double,
    /** The account's enabled MiniMax voices; null = defaults. */
    val enabled: List<String>? = null,
    val prefs: ConversationAudioPrefs? = null,
)

/** `ResolvedConversationAudio`: the voices / speed / delivery one conversation plays in. */
data class ResolvedConversationAudio(
    val key: String,
    val provider: String,
    val voices: List<String>,
    val autoVoices: List<String>,
    val chosen: List<Boolean>,
    val speed: Double,
    val delivery: String,
)

/** One conversation line to fetch / prefetch (`lessonConversationClips`). */
data class ConversationClip(val text: String, val voice: String?, val speed: Double, val delivery: String)

/**
 * Port of shared/lesson/conversationAudio.ts — the preference merge (server PUT rules, also
 * applied locally at once), parse, resolution per conversation, the update a voice pick makes,
 * and the clips a lesson plays. Parity-tested (`ConversationAudioParityTest`).
 */
object ConversationAudio {
    val DEFAULT_PREFS = ConversationAudioPrefs()

    /** MAX_EXERCISE_VOICE_ENTRIES. */
    const val MAX_EXERCISE_VOICE_ENTRIES = 200
    private const val MAX_SPEAKERS = 6
    private val EXERCISE_KEY = Regex("^(minimax|azure|google):[0-9a-z]{1,13}$")

    /** `conversationAudioKey`: the conversation's seed in base 36. */
    fun key(situation: String, lines: List<ConversationLine>): String = java.lang.Long.toString(ConversationVoices.seed(situation, lines), 36)

    fun key(ex: ConversationExercise): String = key(ex.situation, ex.lines)

    /** `exerciseVoicesKey`. */
    fun exerciseVoicesKey(provider: String, key: String) = "$provider:$key"

    data class MergeResult(val prefs: ConversationAudioPrefs, val problems: List<String>)

    /** JavaScript `String(x)` of a JSON value, for problem messages. */
    private fun jsString(e: JsonElement?): String = when (e) {
        null -> "undefined"
        JsonNull -> "null"
        is JsonPrimitive -> when {
            e.isString -> e.content
            e.booleanOrNull != null -> e.content
            else -> e.doubleOrNull?.let { Js.numberToString(it) } ?: e.content
        }
        is JsonArray -> e.joinToString(",") { if (it is JsonNull) "" else jsString(it) }
        is JsonObject -> "[object Object]"
    }

    private fun JsonElement?.asString(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonElement?.asNumber(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString && it.booleanOrNull == null && it !is JsonNull }?.doubleOrNull

    /**
     * `mergeConversationAudioPrefs`: merge a partial update into [base], validated. `speed: null` =
     * back to the default; `voices.<p>.<g>: null` / `exercise_voices.<key>: null` remove one entry;
     * everything else merges key by key.
     */
    fun merge(base: ConversationAudioPrefs, input: JsonElement?): MergeResult {
        val problems = mutableListOf<String>()
        if (input !is JsonObject) return MergeResult(base, listOf("preferences must be an object"))
        var speed = base.speed
        var delivery = base.delivery
        val voices = LinkedHashMap<String, Map<String, String>>(base.voices)
        val exercise = LinkedHashMap<String, List<String?>>(base.exerciseVoices)

        input["speed"]?.let { v ->
            if (v is JsonNull) speed = null
            else {
                val n = v.asNumber()
                if (n == null || !n.isFinite() || n < 0.5 || n > 1.2) problems += "speed must be between 0.5 and 1.2 (or null for the default)"
                else speed = Js.round(n * 100) / 100
            }
        }
        input["delivery"]?.let { v ->
            val d = v.asString()
            if (!TtsConversation.isDelivery(d)) problems += "Unknown delivery: ${jsString(v)}" else delivery = d!!
        }
        input["voices"]?.let { v ->
            if (v !is JsonObject) problems += "voices must be an object"
            else for ((provider, raw) in v) {
                if (provider !in TtsConversation.PROVIDERS) {
                    problems += "voices: unknown provider \"$provider\""
                    continue
                }
                if (raw is JsonNull) {
                    voices.remove(provider)
                    continue
                }
                if (raw !is JsonObject) {
                    problems += "voices.$provider must be an object"
                    continue
                }
                val next = LinkedHashMap<String, String>(voices[provider].orEmpty())
                for ((gender, voice) in raw) {
                    if (gender != "female" && gender != "male") {
                        problems += "voices.$provider: unknown gender \"$gender\""
                        continue
                    }
                    val id = voice.asString()
                    if (voice is JsonNull) next.remove(gender)
                    else if (id == null || TtsConversation.voiceProvider(id) != provider || TtsConversation.voiceGender(id) != gender) {
                        problems += "voices.$provider.$gender: \"${jsString(voice)}\" is not a $gender $provider conversation voice"
                    } else next[gender] = id
                }
                if (next.isNotEmpty()) voices[provider] = next else voices.remove(provider)
            }
        }
        input["exercise_voices"]?.let { v ->
            if (v !is JsonObject) problems += "exercise_voices must be an object"
            else {
                for ((key, raw) in v) {
                    if (!EXERCISE_KEY.matches(key)) {
                        problems += "exercise_voices: bad key \"$key\""
                        continue
                    }
                    if (raw is JsonNull) {
                        exercise.remove(key)
                        continue
                    }
                    val provider = key.substring(0, key.indexOf(':'))
                    if (raw !is JsonArray || raw.size > MAX_SPEAKERS) {
                        problems += "exercise_voices.$key must be a list of up to $MAX_SPEAKERS voices"
                        continue
                    }
                    val bad = raw.firstOrNull { it !is JsonNull && (it.asString() == null || TtsConversation.voiceProvider(it.asString()) != provider) }
                    if (bad != null) {
                        problems += "exercise_voices.$key: \"${jsString(bad)}\" is not a $provider conversation voice"
                        continue
                    }
                    exercise.remove(key) // re-inserted last = newest
                    val list = raw.map { it.asString() }
                    if (list.any { it != null }) exercise[key] = list
                }
                val keys = exercise.keys.toList()
                for (k in keys.take(maxOf(0, keys.size - MAX_EXERCISE_VOICE_ENTRIES))) exercise.remove(k)
            }
        }
        return MergeResult(ConversationAudioPrefs(speed, delivery, voices, exercise), problems)
    }

    /** `parseConversationAudioPrefs`: a stored row → usable preferences (bad parts dropped, never throws). */
    fun parse(raw: String?): ConversationAudioPrefs {
        if (raw.isNullOrEmpty()) return DEFAULT_PREFS
        val parsed = try {
            kotlinx.serialization.json.Json.parseToJsonElement(raw)
        } catch (e: Exception) {
            return DEFAULT_PREFS
        }
        var prefs = DEFAULT_PREFS
        if (parsed !is JsonObject) return prefs
        for (field in listOf("speed", "delivery", "voices", "exercise_voices")) {
            val value = parsed[field] ?: continue
            val r = merge(prefs, JsonObject(mapOf(field to value)))
            if (r.problems.isEmpty() || field == "voices" || field == "exercise_voices") prefs = r.prefs
        }
        return prefs
    }

    /** The preferences as the wire / cache JSON (`ConversationAudioPrefs`). */
    fun toJson(p: ConversationAudioPrefs): JsonObject = buildJsonObject {
        put("speed", p.speed?.let { JsonPrimitive(it) } ?: JsonNull)
        put("delivery", p.delivery)
        put("voices", JsonObject(p.voices.mapValues { (_, g) -> JsonObject(g.mapValues { JsonPrimitive(it.value) }) }))
        put("exercise_voices", JsonObject(p.exerciseVoices.mapValues { (_, l) -> JsonArray(l.map { it?.let(::JsonPrimitive) ?: JsonNull }) }))
    }

    /** Trusted wire / cache JSON → preferences, validated with the same merge (bad parts dropped). */
    fun fromJson(e: JsonElement?): ConversationAudioPrefs = if (e is JsonObject) merge(DEFAULT_PREFS, e).prefs else DEFAULT_PREFS

    /**
     * `resolveConversationAudio`: per speaker, this conversation's own choice, else (for the first
     * speaker of a gender) the learner's preferred voice for that gender, else the automatic
     * rotation — never the same voice twice while the pools allow it.
     */
    fun resolve(speakers: List<ConversationSpeaker>, situation: String, lines: List<ConversationLine>, ctx: ConversationAudioContext): ResolvedConversationAudio {
        val provider = ctx.provider
        val prefs = ctx.prefs ?: DEFAULT_PREFS
        val key = key(situation, lines)
        val pools = if (provider == "minimax") null else TtsConversation.providerPools(provider)
        val auto = ConversationVoices.resolve(speakers, ctx.enabled, ConversationVoices.seed(situation, lines), pools)
        val n = speakers.size
        val voices = arrayOfNulls<String>(n)
        val chosen = BooleanArray(n)
        val used = HashSet<String>()
        fun valid(v: String?) = v != null && TtsConversation.voiceProvider(v) == provider

        val own = prefs.exerciseVoices[exerciseVoicesKey(provider, key)].orEmpty()
        for (i in 0 until n) {
            val v = own.getOrNull(i)
            if (valid(v) && v!! !in used) {
                voices[i] = v
                chosen[i] = true
                used += v
            }
        }
        val preferred = prefs.voices[provider].orEmpty()
        for (g in listOf("female", "male")) {
            val v = preferred[g]
            if (!valid(v) || v!! in used) continue
            val i = speakers.indices.firstOrNull { j -> voices[j] == null && ConversationVoices.speakerGender(speakers, j) == g } ?: continue
            // Only the FIRST speaker of the gender takes the preference.
            val first = speakers.indices.firstOrNull { j -> ConversationVoices.speakerGender(speakers, j) == g }
            if (i != first) continue
            voices[i] = v
            chosen[i] = true
            used += v
        }
        for (i in 0 until n) {
            if (voices[i] != null) continue
            var v = auto[i]
            if (v in used) {
                val g = ConversationVoices.speakerGender(speakers, i)
                val pool = pools?.get(g).orEmpty()
                val all = pool + auto + (pools?.let { it.getValue("female") + it.getValue("male") } ?: emptyList())
                v = all.firstOrNull { it !in used } ?: v
            }
            voices[i] = v
            used += v
        }
        return ResolvedConversationAudio(
            key = key,
            provider = provider,
            voices = voices.map { it!! },
            autoVoices = auto,
            chosen = chosen.toList(),
            speed = TtsConversation.clampRate(provider, prefs.speed ?: ctx.defaultSpeed),
            delivery = prefs.delivery,
        )
    }

    fun resolve(ex: ConversationExercise, ctx: ConversationAudioContext) = resolve(ex.speakers, ex.situation, ex.lines, ctx)

    /**
     * `speakerVoiceUpdate`: the PARTIAL update for "speaker [index] speaks in [voice]" (null = back
     * to automatic): this conversation's choice and, for the first speaker of a gender, the
     * preferred voice for that gender.
     */
    fun speakerVoiceUpdate(
        current: ResolvedConversationAudio,
        speakers: List<ConversationSpeaker>,
        index: Int,
        voice: String?,
        prefs: ConversationAudioPrefs = DEFAULT_PREFS,
    ): JsonObject {
        val exKey = exerciseVoicesKey(current.provider, current.key)
        val existing = prefs.exerciseVoices[exKey].orEmpty()
        val list = speakers.indices.map { existing.getOrNull(it) }.toMutableList()
        list[index] = voice
        val g = ConversationVoices.speakerGender(speakers, index)
        val first = speakers.indices.firstOrNull { ConversationVoices.speakerGender(speakers, it) == g }
        return buildJsonObject {
            put(
                "exercise_voices",
                JsonObject(mapOf(exKey to if (list.any { it != null }) JsonArray(list.map { it?.let(::JsonPrimitive) ?: JsonNull }) else JsonNull)),
            )
            if (first == index) put("voices", JsonObject(mapOf(current.provider to JsonObject(mapOf(g to (voice?.let(::JsonPrimitive) ?: JsonNull))))))
        }
    }

    /** `lessonConversationClips`: every conversation line of a lesson in its resolved voice / speed / delivery. */
    fun lessonClips(spec: CustomLessonSpec, resolve: (ConversationExercise) -> ResolvedConversationAudio): List<ConversationClip> {
        val clips = ArrayList<ConversationClip>()
        for (section in spec.sections) for (ex in section.exercises) {
            if (ex !is ConversationExercise) continue
            val audio = resolve(ex)
            for (line in ex.lines) clips += ConversationClip(line.hanzi, audio.voices.getOrNull(line.speaker), audio.speed, audio.delivery)
        }
        return clips
    }

    /** Speed for display: `${speed}` in JS (0.8, 1). */
    fun speedLabel(speed: Double): String = Js.numberToString(speed)
}
