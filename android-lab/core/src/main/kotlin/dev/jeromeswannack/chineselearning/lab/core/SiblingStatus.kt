package dev.jeromeswannack.chineselearning.lab.core

/**
 * The word's other card types — the top row of the study card's ⋯ sheet. Port of
 * shared/decks/sibling-status.ts (parity-tested by parity/fixtures/sibling-status.ts →
 * SiblingStatusParityTest; docs/STUDY_SESSION.md "The word's other cards in ⋯").
 *
 * One tile per OTHER card of the note: 读 / 写 / 听 + a short name, a status line from the card's
 * replayed state (offline), a strength (the mastery tier 0..3) and what its small sheet can do
 * (⚡ Study it today — a card-level bump —, Unsuspend / Wake now, Forget a started card).
 */
object SiblingStatus {
    private const val DAY_MS = 86_400_000L

    const val NOT_STARTED = "not_started"
    const val NEW_TODAY = "new_today"
    const val LEARNING = "learning"
    const val DUE = "due"
    const val REVIEW = "review"
    const val KNOWN = "known"
    const val SUSPENDED = "suspended"
    const val SNOOZED = "snoozed"
    const val LEECH = "leech"

    const val TONE_NEUTRAL = "neutral"
    const val TONE_KNOWN = "known"
    const val TONE_LEECH = "leech"
    const val TONE_HELD = "held"

    const val BUMP_ADD = "add"
    const val BUMP_EARLY = "early"

    /** Port of SIBLING_ACTIONS (the analytics `action`). */
    val ACTIONS = listOf("bump", "snooze", "suspend", "unsuspend", "wake", "forget", "details")

    /** Port of SIBLING_TYPE_META: the card hub's 读 Read · 写 Write · 听 Listen. */
    val TYPE_META = mapOf(
        CardTypes.HANZI_TO_MEANING to ("读" to "Read"),
        CardTypes.MEANING_TO_HANZI to ("写" to "Write"),
        CardTypes.AUDIO_TO_HANZI to ("听" to "Listen"),
    )

    fun typeMeta(cardType: String): Pair<String, String> = TYPE_META[cardType] ?: ("•" to cardType)

    data class Card(
        val id: String,
        val cardType: String,
        val queue: Int,
        /** Epoch ms; null = due now (ignored for NEW cards). */
        val dueMs: Long?,
        val stability: Double? = null,
        val lapses: Int? = null,
    )

    fun card(c: QueueCard): Card = Card(c.id, c.cardType, c.queue, c.state.dueTimestamp, c.state.stability, c.state.lapses)

    data class Context(
        val cutoffMs: Long,
        /** The study day's key ('YYYY-MM-DD'). */
        val today: String,
        /** A hold per card id (inactive ones ignored): kind + until. */
        val holds: Map<String, CardHold> = emptyMap(),
        /** Card ids already in today's study (the session queue, the ⚡ pocket). */
        val inToday: Set<String> = emptySet(),
        /** False in a homework pass (its own ⚡). */
        val canBump: Boolean = true,
    )

    data class Tile(
        val cardId: String,
        val cardType: String,
        val symbol: String,
        val name: String,
        val detail: String,
        val status: String,
        val line: String,
        val strength: Int,
        val tone: String,
        val bump: String?,
        val bumpNote: String?,
        val release: String?,
        val canForget: Boolean,
    )

    /** Port of siblingStrength(): the mastery tier as 0..3. */
    fun strength(queue: Int, stability: Double?): Int {
        if (queue == CardQueue.NEW) return 0
        if (CardQueue.isLearning(queue)) return 1
        val s = if (stability != null && stability.isFinite()) stability else 0.0
        return when {
            s <= 7 -> 1
            s <= 21 -> 2
            else -> 3
        }
    }

    /** Port of nextInLabel(). */
    fun nextInLabel(dueMs: Long, cutoffMs: Long): String {
        val diff = dueMs - cutoffMs
        val days = maxOf(1L, if (diff <= 0) 0L else (diff + DAY_MS - 1) / DAY_MS)
        return when {
            days < 60 -> "${days}d"
            days < 365 -> "${Math.round(days / 30.0)}mo"
            else -> "${Math.round(days / 365.0)}y"
        }
    }

    private fun typeRank(t: String): Int = Bumps.BUMP_CARD_TYPE_ORDER.indexOf(t).let { if (it < 0) Bumps.BUMP_CARD_TYPE_ORDER.size else it }

    /** Port of siblingTile(). */
    fun tile(card: Card, ctx: Context): Tile {
        val (symbol, name) = typeMeta(card.cardType)
        val strength = strength(card.queue, card.stability)
        val inToday = card.id in ctx.inToday
        val started = card.queue != CardQueue.NEW
        val dueToday = started && (card.dueMs == null || card.dueMs <= ctx.cutoffMs)
        val held = ctx.holds[card.id]?.takeIf { CardHolds.isActive(it, ctx.today) }

        val status: String
        val line: String
        when {
            held != null -> {
                status = if (held.kind == CardHolds.SUSPEND) SUSPENDED else SNOOZED
                line = CardHolds.statusLabel(held.kind, held.until, ctx.today)
            }
            started && Leech.isLeech(card.lapses) -> { status = LEECH; line = "Leech · missed ${card.lapses}×" }
            !started -> {
                status = if (inToday) NEW_TODAY else NOT_STARTED
                line = if (inToday) "New · in today’s queue" else "Not started"
            }
            CardQueue.isLearning(card.queue) -> {
                status = LEARNING
                line = if (dueToday || inToday) "Learning · due today" else "Learning · next in ${nextInLabel(card.dueMs!!, ctx.cutoffMs)}"
            }
            dueToday || inToday -> { status = DUE; line = if (dueToday) "Due today" else "⚡ In today’s study" }
            strength == 3 -> { status = KNOWN; line = "Known · next in ${nextInLabel(card.dueMs!!, ctx.cutoffMs)}" }
            else -> { status = REVIEW; line = "Review · next in ${nextInLabel(card.dueMs!!, ctx.cutoffMs)}" }
        }

        var bump: String? = null
        var bumpNote: String? = null
        when {
            !ctx.canBump -> Unit
            held != null -> bumpNote = if (held.kind == CardHolds.SUSPEND) "Suspended — unsuspend it first" else "Snoozed — wake it first"
            inToday -> bumpNote = "Already in today’s study"
            dueToday -> bumpNote = "Already due today"
            else -> bump = if (started) BUMP_EARLY else BUMP_ADD
        }
        val tone = when {
            held != null -> TONE_HELD
            status == LEECH -> TONE_LEECH
            status == KNOWN -> TONE_KNOWN
            else -> TONE_NEUTRAL
        }
        return Tile(
            cardId = card.id,
            cardType = card.cardType,
            symbol = symbol,
            name = name,
            detail = OtherCardTypes.shortLabel(card.cardType),
            status = status,
            line = line,
            strength = strength,
            tone = tone,
            bump = bump,
            bumpNote = bumpNote,
            release = held?.let { if (it.kind == CardHolds.SUSPEND) "unsuspend" else "wake" },
            canForget = started,
        )
    }

    /** Port of siblingTiles(): every OTHER card, read · write · listen order. */
    fun tiles(noteCards: List<Card>, currentCardId: String, ctx: Context): List<Tile> =
        noteCards.filter { it.id != currentCardId }
            .sortedWith(compareBy<Card> { typeRank(it.cardType) }.thenBy { it.id })
            .map { tile(it, ctx) }

    /** Port of missingSiblingTypes(). */
    fun missingTypes(noteCardTypes: List<String>, currentCardType: String): List<String> {
        val have = (noteCardTypes + currentCardType).toSet()
        return Bumps.BUMP_CARD_TYPE_ORDER.filter { it !in have }
    }

    /** Port of missingSiblingLine(). */
    fun missingLine(cardType: String): String = if (cardType == CardTypes.AUDIO_TO_HANZI) "No listening card (no audio)" else "No card of this type"

    /** Port of siblingBumpLabel(). */
    fun bumpLabel(bump: String?): String = if (bump == BUMP_EARLY) "⚡ Study it today (review early)" else "⚡ Study it today"

    /** Port of siblingBumpedMessage(). */
    fun bumpedMessage(detail: String, inSession: Boolean): String =
        if (inSession) OtherCardTypes.addedMessage(listOf(detail)) else "⚡ $detail added to today"

    /** Port of siblingTileLabel(). */
    fun tileLabel(tile: Tile): String = "${tile.name} card (${tile.symbol}): ${tile.line}. Strength ${tile.strength} of 3."
}
