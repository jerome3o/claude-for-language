package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/tts/conversation.ts (+ PROVIDER_RATE_RANGE, the provider catalogues and the
 * default `conversation_rate` from shared/tts/config.ts): how a conversation exercise's lines
 * are spoken per TTS provider — the speed (the PROVIDER's own rate, 1 = its natural pace,
 * clamped to the part of its range that still sounds natural), the voices a learner may pick,
 * and the "delivery" (Azure express-as style / MiniMax emotion). Parity-tested against the
 * TypeScript (`parity/fixtures/conversation-audio.ts` → `ConversationAudioParityTest`).
 */
object TtsConversation {
    /** TTS_PROVIDERS, same order. */
    val PROVIDERS: List<String> = listOf("minimax", "azure", "google")

    /** TTS_PROVIDER_NAMES. */
    val PROVIDER_NAMES: Map<String, String> = mapOf("minimax" to "MiniMax", "azure" to "Azure Speech", "google" to "Google")

    data class RateRange(val min: Double, val max: Double, val goodMin: Double, val goodMax: Double)

    /** PROVIDER_RATE_RANGE. */
    val RATE_RANGE: Map<String, RateRange> = mapOf(
        "minimax" to RateRange(0.5, 2.0, 0.5, 1.2),
        "azure" to RateRange(0.5, 2.0, 0.6, 1.2),
        "google" to RateRange(0.25, 4.0, 0.6, 1.2),
    )

    /** DEFAULT_TTS_CONFIG.providers.<p>.conversation_rate — each provider's default conversation pace. */
    val DEFAULT_CONVERSATION_RATES: Map<String, Double> = mapOf("minimax" to 0.85, "azure" to 0.75, "google" to 0.8)

    /** CONVERSATION_SPEED_STEPS — the learner's speed choices in the Audio menu. */
    val SPEED_STEPS: List<Double> = listOf(0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0)

    /** DEFAULT_CONVERSATION_RATE — when nothing better is known. */
    const val DEFAULT_RATE = 0.8

    private fun range(provider: String) = RATE_RANGE[provider] ?: RATE_RANGE.getValue("minimax")

    /** `clampConversationRate`: a speed → what [provider] is asked for (its good range, 0.01 steps). */
    fun clampRate(provider: String, speed: Double): Double {
        val r = range(provider)
        val n = if (speed.isFinite()) speed else DEFAULT_RATE
        return Js.round(minOf(r.goodMax, maxOf(r.goodMin, n)) * 100) / 100
    }

    /** `conversationSpeedSteps`: the steps inside the provider's good range. */
    fun speedSteps(provider: String): List<Double> {
        val r = range(provider)
        return SPEED_STEPS.filter { it >= r.goodMin && it <= r.goodMax }
    }

    // ---------- Voices ----------

    data class ProviderVoice(val id: String, val name: String, val gender: String, val note: String, val fixedRate: Boolean = false)

    /** AZURE_VOICES (zh-CN; the HD voices ignore the rate and exist only in some regions). */
    val AZURE_VOICES: List<ProviderVoice> = listOf(
        ProviderVoice("zh-CN-XiaoxiaoNeural", "Xiaoxiao 晓晓", "female", "Clear, warm — the usual default"),
        ProviderVoice("zh-CN-XiaochenNeural", "Xiaochen 晓辰", "female", "Casual, relaxed"),
        ProviderVoice("zh-CN-XiaoyiNeural", "Xiaoyi 晓伊", "female", "Young, lively"),
        ProviderVoice("zh-CN-YunxiNeural", "Yunxi 云希", "male", "Young man, clear"),
        ProviderVoice("zh-CN-YunjianNeural", "Yunjian 云健", "male", "Adult man, energetic"),
        ProviderVoice("zh-CN-YunyangNeural", "Yunyang 云扬", "male", "Newsreader"),
        ProviderVoice("zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", "Xiaoxiao HD Flash", "female", "HD — some regions only; own pace", true),
        ProviderVoice("zh-CN-Xiaochen:DragonHDFlashLatestNeural", "Xiaochen HD Flash", "female", "HD — some regions only; own pace", true),
        ProviderVoice("zh-CN-Yunxi:DragonHDFlashLatestNeural", "Yunxi HD Flash", "male", "HD — some regions only; own pace", true),
        ProviderVoice("zh-cn-Xiaochen:DragonHDLatestNeural", "Xiaochen Dragon HD", "female", "HD — some regions only; own pace", true),
        ProviderVoice("zh-cn-Yunfan:DragonHDLatestNeural", "Yunfan Dragon HD", "male", "HD — some regions only; own pace", true),
    )

    /** GOOGLE_VOICES. */
    val GOOGLE_VOICES: List<ProviderVoice> = listOf(
        ProviderVoice("cmn-CN-Wavenet-C", "Wavenet C", "female", "The old fallback voice"),
        ProviderVoice("cmn-CN-Wavenet-A", "Wavenet A", "female", ""),
        ProviderVoice("cmn-CN-Wavenet-B", "Wavenet B", "male", ""),
        ProviderVoice("cmn-CN-Wavenet-D", "Wavenet D", "male", ""),
    )

    /**
     * `conversationProviderVoices`: MiniMax = the lesson catalogue ([ConversationVoices.ALL]);
     * Azure / Google = their catalogues minus the HD (fixed-rate) voices.
     */
    fun providerVoices(provider: String): List<ProviderVoice> {
        if (provider == "minimax") return ConversationVoices.ALL.map { ProviderVoice(it.id, it.name, it.gender, it.note) }
        val list = if (provider == "azure") AZURE_VOICES else GOOGLE_VOICES
        return list.filter { !it.fixedRate }.map { it.copy(fixedRate = false) }
    }

    private val OWNER: Map<String, Pair<String, String>> = LinkedHashMap<String, Pair<String, String>>().apply {
        for (p in PROVIDERS) for (v in providerVoices(p)) if (v.id !in this) put(v.id, p to v.gender)
    }

    /** `conversationVoiceProvider`: which provider a conversation voice belongs to (null = none). */
    fun voiceProvider(id: String?): String? = id?.let { OWNER[it]?.first }

    /** `conversationVoiceGender`. */
    fun voiceGender(id: String?): String? = id?.let { OWNER[it]?.second }

    /** `providerVoicePools`: a provider's voices by gender, catalogue order (female / male). */
    fun providerPools(provider: String): Map<String, List<String>> {
        val all = providerVoices(provider)
        return mapOf(
            "female" to all.filter { it.gender == "female" }.map { it.id },
            "male" to all.filter { it.gender == "male" }.map { it.id },
        )
    }

    // ---------- Delivery ----------

    /** CONVERSATION_DELIVERIES. */
    val DELIVERIES: List<String> = listOf("natural", "chat", "calm", "cheerful")

    /** DELIVERY_LABELS. */
    val DELIVERY_LABELS: Map<String, String> = mapOf("natural" to "Natural", "chat" to "Conversational", "calm" to "Calm", "cheerful" to "Cheerful")

    /** AZURE_VOICE_STYLES — `mstts:express-as` styles per zh-CN voice. */
    val AZURE_VOICE_STYLES: Map<String, List<String>> = mapOf(
        "zh-CN-XiaoxiaoNeural" to listOf("affectionate", "angry", "assistant", "calm", "chat", "chat-casual", "cheerful", "customerservice", "disgruntled", "excited", "fearful", "friendly", "gentle", "lyrical", "newscast", "poetry-reading", "sad", "serious", "sorry", "whispering"),
        "zh-CN-XiaochenNeural" to listOf("livecommercial"),
        "zh-CN-XiaoyiNeural" to listOf("affectionate", "angry", "cheerful", "disgruntled", "embarrassed", "fearful", "gentle", "sad", "serious"),
        "zh-CN-YunxiNeural" to listOf("angry", "assistant", "chat", "cheerful", "depressed", "disgruntled", "embarrassed", "fearful", "narration-relaxed", "newscast", "sad", "serious"),
        "zh-CN-YunjianNeural" to listOf("angry", "cheerful", "depressed", "disgruntled", "documentary-narration", "narration-relaxed", "sad", "serious", "sports-commentary", "sports-commentary-excited"),
        "zh-CN-YunyangNeural" to listOf("customerservice", "narration-professional", "newscast-casual"),
    )

    private val AZURE_DELIVERY_STYLES: Map<String, List<String>> = mapOf(
        "chat" to listOf("chat", "chat-casual"),
        "calm" to listOf("calm", "narration-relaxed", "gentle"),
        "cheerful" to listOf("cheerful"),
    )

    private val MINIMAX_DELIVERY_EMOTION: Map<String, String> = mapOf("calm" to "calm", "cheerful" to "happy")

    /** `DeliveryParams`: Azure `<mstts:express-as style>` / MiniMax `voice_setting.emotion`. */
    data class DeliveryParams(val azureStyle: String? = null, val minimaxEmotion: String? = null)

    /** `deliveryParams`: what a delivery means for one provider + voice; null = spoken naturally. */
    fun deliveryParams(provider: String, voice: String, delivery: String): DeliveryParams? {
        if (delivery == "natural") return null
        if (provider == "azure") {
            val styles = AZURE_VOICE_STYLES[voice].orEmpty()
            val style = AZURE_DELIVERY_STYLES[delivery].orEmpty().firstOrNull { it in styles }
            return style?.let { DeliveryParams(azureStyle = it) }
        }
        if (provider == "minimax") return MINIMAX_DELIVERY_EMOTION[delivery]?.let { DeliveryParams(minimaxEmotion = it) }
        return null
    }

    /** `supportedDeliveries`: the deliveries a voice can actually give (natural always). */
    fun supportedDeliveries(provider: String, voice: String): List<String> =
        DELIVERIES.filter { it == "natural" || deliveryParams(provider, voice, it) != null }

    /** `isConversationDelivery`. */
    fun isDelivery(v: String?): Boolean = v != null && v in DELIVERIES
}
