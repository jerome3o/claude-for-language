package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Example sentence style" — port of shared/study/sentenceStyle.ts (parity-tested, SentenceStyleParityTest):
 * the register the account's NEW example sentences are written in (Settings → Study, per account).
 * standard = neutral, textbook-safe; everyday = how people talk, the occasional common colloquialism (THE
 * DEFAULT); casual = chatty spoken Chinese. The worker's sentence generator reads it — the phone only shows
 * and changes it (`PUT /api/profile/sentence-style`), so the prompt text is not ported.
 */
object SentenceStyle {
    const val STANDARD = "standard"
    const val EVERYDAY = "everyday"
    const val CASUAL = "casual"

    /** Port of SENTENCE_STYLES. */
    val STYLES: List<String> = listOf(STANDARD, EVERYDAY, CASUAL)

    /** Port of DEFAULT_SENTENCE_STYLE. */
    const val DEFAULT: String = EVERYDAY

    /** Port of isSentenceStyle(). */
    fun isStyle(value: String?): Boolean = value != null && value in STYLES

    /** Port of sentenceStyleOf(): the style in effect for a stored value (null / unknown = the default). */
    fun of(value: String?): String = if (isStyle(value)) value!! else DEFAULT

    /** Port of SENTENCE_STYLE_COPY[style].label. */
    fun label(style: String): String = when (of(style)) {
        STANDARD -> "Standard"
        CASUAL -> "Casual"
        else -> "Everyday"
    }

    /** Port of SENTENCE_STYLE_COPY[style].description. */
    fun description(style: String): String = when (of(style)) {
        STANDARD -> "Neutral, textbook-safe Chinese."
        CASUAL -> "Chatty, spoken Chinese most of the time — more colloquial words and everyday sayings."
        else -> "How people actually talk — now and then a common spoken word, particle or saying."
    }

    /** Port of SENTENCE_STYLE_NOTE. */
    const val NOTE: String = "Applies to new example sentences — the ones you already have stay as they are."
}
