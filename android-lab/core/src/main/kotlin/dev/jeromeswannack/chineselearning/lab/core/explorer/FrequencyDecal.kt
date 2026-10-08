package dev.jeromeswannack.chineselearning.lab.core.explorer

/*
 * Port of shared/explorer/frequency-tier.ts — the frequency decal (docs/LANGUAGE_EXPLORER.md
 * "Frequency decals"): a thin outline around a word / character tile saying how common it is,
 * from its rank in the shipped word-freq list (WordFrequency.shipped). Parity-tested
 * (ExplorerParityTest).
 *
 *   top 100 → purple · top 1,000 → green · top 2,000 → yellow · in between → none
 *   rare → grey: not listed, or beyond RARE_WORD_RANK (words) / RARE_CHAR_RANK (characters)
 */

/** Port of `FrequencyDecal`. */
enum class FrequencyDecal(val wire: String) { TOP100("top100"), TOP1000("top1000"), TOP2000("top2000"), RARE("rare") }

/** Which list a rank comes from (picks the rare cutoff). */
enum class DecalKind { WORD, CHAR }

object FrequencyDecals {
    /** Port of RARE_WORD_RANK. */
    const val RARE_WORD_RANK = 10_000

    /** Port of RARE_CHAR_RANK (the 3,500 common characters of 现代汉语常用字表). */
    const val RARE_CHAR_RANK = 3_500

    /** Port of `frequencyTier`: null / < 1 = not in the list → RARE; null = the unmarked middle band. */
    fun tier(rank: Int?, kind: DecalKind = DecalKind.WORD): FrequencyDecal? {
        if (rank == null || rank < 1) return FrequencyDecal.RARE
        if (rank <= 100) return FrequencyDecal.TOP100
        if (rank <= 1000) return FrequencyDecal.TOP1000
        if (rank <= 2000) return FrequencyDecal.TOP2000
        return if (rank > (if (kind == DecalKind.CHAR) RARE_CHAR_RANK else RARE_WORD_RANK)) FrequencyDecal.RARE else null
    }

    /** Port of `FREQUENCY_DECAL_KEY`: the legend behind the ⓘ, in order. */
    data class KeyEntry(val tier: FrequencyDecal, val colour: String, val label: String)

    val KEY: List<KeyEntry> = listOf(
        KeyEntry(FrequencyDecal.TOP100, "purple", "top 100"),
        KeyEntry(FrequencyDecal.TOP1000, "green", "top 1,000"),
        KeyEntry(FrequencyDecal.TOP2000, "yellow", "top 2,000"),
        KeyEntry(FrequencyDecal.RARE, "grey", "rare"),
    )

    /** Port of `frequencyKeyLine`. */
    fun keyLine(): String = KEY.joinToString(" · ") { "${it.colour} ${it.label}" }
}
