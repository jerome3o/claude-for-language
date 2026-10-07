package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/chats/voice.ts — which voice reads a chat message aloud.
 *
 * Every chat read-aloud goes through the same MiniMax TTS and the same account voice selection
 * as the lesson exercises (Settings → Conversation voices) — never the legacy
 * `conversations.voice_id` column (its default 'female-yujie' is a sultry role-play voice).
 * The voice follows the SENDER's `users.voice_gender`: male / female → the LISTENER's first
 * enabled voice of that gender (catalogue order), other / not set → the app's voice
 * (DEFAULT_LESSON_VOICE). Claude's lines in a role-play chat keep that chat's persona voice.
 * Parity-tested against the TypeScript (`parity/fixtures/chat-voice.ts` → `ChatVoiceParityTest`).
 */
object ChatVoice {
    /** VOICE_GENDERS. */
    val GENDERS: List<String> = listOf("male", "female", "other")

    data class Option(val value: String?, val label: String)

    /** VOICE_GENDER_OPTIONS — the Profile choice, in display order (null = not set). */
    val OPTIONS: List<Option> = listOf(
        Option("male", "Male"),
        Option("female", "Female"),
        Option("other", "Other"),
        Option(null, "Not set"),
    )

    /** VOICE_GENDER_TITLE. */
    const val TITLE = "Your voice when your messages are read aloud"

    /** VOICE_GENDER_HINT. */
    const val HINT = "Male or Female picks a matching voice from the listener’s conversation voices; Other or Not set uses the app’s usual voice."

    /** DEFAULT_LESSON_VOICE — the app's voice (every card and word clip). */
    const val DEFAULT_VOICE = "Chinese (Mandarin)_Radio_Host"

    /** CHAT_READ_ALOUD_SPEED — the card clips' slow default. */
    const val SPEED = 0.6

    /**
     * shared/tts `DEVICE_SPEECH_RATE`: `TextToSpeech.setSpeechRate` for the phone's own voice
     * (every fallback: card / sentence audio, lessons, chat read-aloud offline). The engine's
     * default 1.0 read new example sentences far too fast.
     */
    const val DEVICE_SPEECH_RATE = 0.7

    /** LESSON_VOICE_IDS — every id /api/practice/tts accepts. */
    val VOICE_IDS: Set<String> = setOf(DEFAULT_VOICE) + ConversationVoices.ALL.map { it.id }

    /** `parseVoiceGender`: a known gender or null (anything else = not set). */
    fun parse(v: String?): String? = v?.takeIf { it in GENDERS }

    /** `pickVoiceGender` (for a string value): [Pick.value] null = clear; a problem for anything unknown. */
    data class Pick(val set: Boolean, val value: String?, val problem: String?)

    fun pick(v: String?, present: Boolean = true): Pick = when {
        !present -> Pick(false, null, null)
        v == null || v == "" -> Pick(true, null, null)
        parse(v) != null -> Pick(true, v, null)
        else -> Pick(false, null, "voice_gender must be male, female, other or null")
    }

    /**
     * `chatReadAloudVoice`: [senderGender] = the sender's users.voice_gender, [enabled] = the
     * LISTENER's conversation voices (null = the shipped defaults), [fromAi] = Claude's line in a
     * role-play chat, [personaVoice] = that chat's voice (only used for Claude's lines).
     */
    fun voice(senderGender: String?, enabled: List<String>? = null, fromAi: Boolean = false, personaVoice: String? = null): String {
        if (fromAi && !personaVoice.isNullOrEmpty() && personaVoice in VOICE_IDS) return personaVoice
        val pools = ConversationVoices.pools(enabled)
        return when (parse(senderGender)) {
            "male" -> pools.getValue("male").firstOrNull() ?: DEFAULT_VOICE
            "female" -> pools.getValue("female").firstOrNull() ?: DEFAULT_VOICE
            else -> DEFAULT_VOICE
        }
    }

    /** `chatReadAloudSpeed`: a role-play chat's own speed (0.5–2) for Claude's lines, else [SPEED]. */
    fun speed(fromAi: Boolean = false, personaSpeed: Double? = null): Double {
        val s = personaSpeed
        if (fromAi && s != null && s.isFinite() && s >= 0.5 && s <= 2.0) return s
        return SPEED
    }

    /** "male" / "female" for an offline device voice of the same gender, else null (no preference). */
    fun deviceGender(voiceId: String): String? = ConversationVoices.voice(voiceId)?.gender?.takeIf { voiceId != DEFAULT_VOICE }

    /** One of the phone's TextToSpeech voices (android.speech.tts.Voice, flattened so the choice is testable). */
    data class DeviceVoice(val name: String, val language: String, val country: String, val quality: Int, val needsNetwork: Boolean)

    /** "female" / "male" from a device voice's name ("…-female-…"), else null. */
    fun deviceVoiceGender(name: String): String? {
        val n = name.lowercase()
        return when {
            "female" in n || "woman" in n -> "female"
            "male" in n || "man" in n.split('-', '_', '#', ' ') -> "male"
            else -> null
        }
    }

    /**
     * The offline fallback when no clip is on the phone: a Mandarin (mainland, zh-CN / cmn-CN) voice —
     * never an arbitrary default — preferring one that works offline, then one of [gender] (by name),
     * then the best quality. Null when the phone has no Mandarin voice.
     */
    fun pickDeviceVoice(voices: List<DeviceVoice>, gender: String?): DeviceVoice? =
        voices.filter { it.language.lowercase() in setOf("zh", "cmn", "zho") && it.country.uppercase() in setOf("CN", "CHN") }
            .sortedWith(
                compareBy<DeviceVoice> { it.needsNetwork }
                    .thenBy { if (gender != null && deviceVoiceGender(it.name) == gender) 0 else 1 }
                    .thenByDescending { it.quality }
                    .thenBy { it.name },
            )
            .firstOrNull()
}
