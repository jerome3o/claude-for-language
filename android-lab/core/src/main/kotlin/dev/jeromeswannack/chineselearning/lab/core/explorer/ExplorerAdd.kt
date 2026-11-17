package dev.jeromeswannack.chineselearning.lab.core.explorer

/*
 * Port of shared/explorer/addCard.ts — "+ Add as card" in the language explorer
 * (docs/LANGUAGE_EXPLORER.md "Adding before the meaning has loaded"): what a tap does with what the
 * view knows, once the app has WAITED for its in-flight lookups ("Adding…"). Offline → the fill
 * sheet; a meaning → add; none and not glossed → the gloss path (POST /api/ai/gloss-words); none
 * after it → the fill sheet. Parity-tested (ExplorerAddParityTest, parity/fixtures/explorer-add.ts).
 */

/** Port of `ExplorerAddFillReason`. */
enum class ExplorerAddFillReason(val wire: String) { OFFLINE("offline"), NO_MEANING("no_meaning") }

/** Port of `ExplorerAddStep`. */
sealed interface ExplorerAddStep {
    val hanzi: String
    val pinyin: String

    data class Add(override val hanzi: String, override val pinyin: String, val english: String) : ExplorerAddStep
    data class Gloss(override val hanzi: String, override val pinyin: String) : ExplorerAddStep
    data class Fill(override val hanzi: String, override val pinyin: String, val english: String, val reason: ExplorerAddFillReason) : ExplorerAddStep
}

object ExplorerAdd {
    /** Port of EXPLORER_ADD_WAIT_MS: how long a tap waits for the view's lookups. */
    const val WAIT_MS = 8000L

    private val SPACE = Regex("\\s+")

    private fun clean(s: String?): String = (s ?: "").replace(SPACE, " ").trim()

    /** Port of `explorerAddStep`. */
    fun step(hanzi: String, pinyin: String, english: String, devicePinyin: String, online: Boolean, glossed: Boolean): ExplorerAddStep {
        val h = hanzi.trim()
        val p = clean(pinyin).ifEmpty { clean(devicePinyin) }
        val e = clean(english)
        if (!online) return ExplorerAddStep.Fill(h, p, e, ExplorerAddFillReason.OFFLINE)
        if (e.isNotEmpty()) return ExplorerAddStep.Add(h, p, e)
        if (!glossed) return ExplorerAddStep.Gloss(h, p)
        return ExplorerAddStep.Fill(h, p, "", ExplorerAddFillReason.NO_MEANING)
    }

    /** Port of `explorerAddPrompt`. */
    fun prompt(hanzi: String): String = "What does ${hanzi.trim()} mean?"

    /** Port of `explorerAddHint`. */
    fun hint(reason: ExplorerAddFillReason, hasMeaning: Boolean): String = when (reason) {
        ExplorerAddFillReason.OFFLINE ->
            if (hasMeaning) "You’re offline — Add works once you’re back online."
            else "You’re offline, so the meaning can’t be looked up. Type it — Add works once you’re back online."
        ExplorerAddFillReason.NO_MEANING -> "The dictionary doesn’t have this word. Type what it means to add it."
    }

    /** Port of `explorerAddProblem` (null = ready). */
    fun problem(english: String, online: Boolean): String? = when {
        clean(english).isEmpty() -> "Type what it means first."
        !online -> "Waiting for a connection…"
        else -> null
    }
}
