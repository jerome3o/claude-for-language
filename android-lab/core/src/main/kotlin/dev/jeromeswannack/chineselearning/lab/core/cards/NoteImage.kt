package dev.jeromeswannack.chineselearning.lab.core.cards

import dev.jeromeswannack.chineselearning.lab.core.CardCheck

/**
 * Pictures on cards — port of shared/cards/note-image.ts (parity-tested by
 * parity/fixtures/note-image.ts → NoteImageParityTest).
 *
 * The picture depicts the MEANING, so it never gives away the answer of a card that tests it:
 * with the English on the meaning → hanzi question, on the answer side of every card.
 */
object NoteImage {
    /** NOTE_IMAGE_COST_USD — estimated cost of one generated picture. */
    const val COST_USD = 0.07
    /** ILLUSTRATE_DECK_MAX. */
    const val ILLUSTRATE_DECK_MAX = 500
    /** NOTE_IMAGE_UPLOAD_PX — longest side of an uploaded picture after the device resizes it. */
    const val UPLOAD_PX = 800

    data class Sides(val front: Boolean, val back: Boolean)

    /** Port of `noteImageSides(cardType)`. */
    fun sides(cardType: String): Sides = Sides(front = cardType == "meaning_to_hanzi", back = true)

    /** Port of `showNoteImage(cardType, side, enabled, imageKey)`; [front] = the question side. */
    fun show(cardType: String, front: Boolean, enabled: Boolean, imageKey: String?): Boolean {
        if (!enabled || imageKey.isNullOrEmpty()) return false
        val s = sides(cardType)
        return if (front) s.front else s.back
    }

    data class Estimate(val pictures: Int, val usd: Double, val label: String)

    /** Port of `estimateIllustrateCost(missing)`: "24 pictures · about $1.68". */
    fun estimate(missing: Double): Estimate {
        val pictures = maxOf(0, minOf(ILLUSTRATE_DECK_MAX, Math.floor(missing).toInt()))
        val usd = pictures * COST_USD
        val label = if (pictures == 0) "Every card already has a picture"
        else "$pictures picture${if (pictures == 1) "" else "s"} · about ${CardCheck.formatUsd(usd)}"
        return Estimate(pictures, usd, label)
    }

    /** Port of `noteImageState(note)`: none / ready / pending / failed. */
    fun state(imageKey: String?, imageStatus: String?): String = when {
        imageStatus == "pending" -> "pending"
        !imageKey.isNullOrEmpty() -> "ready"
        imageStatus == "failed" -> "failed"
        else -> "none"
    }

    /** Port of `illustrateProgressLabel(p)`: "18 of 24 cards have a picture · 6 being drawn". */
    fun progressLabel(total: Int, withImage: Int, pending: Int, failed: Int): String {
        val parts = mutableListOf("$withImage of $total card${if (total == 1) "" else "s"} ${if (withImage == 1) "has" else "have"} a picture")
        if (pending > 0) parts += "$pending being drawn"
        if (failed > 0) parts += "$failed couldn’t be drawn"
        return parts.joinToString(" · ")
    }
}
