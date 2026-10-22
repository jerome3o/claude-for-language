package dev.jeromeswannack.chineselearning.lab.core

/**
 * Suspend & snooze — Anki's Suspend and Bury, with clearer words. Port of shared/decks/holds.ts
 * (parity-tested through parity/fixtures/card-holds.ts → CardHoldsParityTest).
 *
 *  - SUSPEND: the card leaves all study (queue, new-card pools, ⚡ bumps, Up next, counts, Home)
 *    until unsuspended; history and FSRS state untouched.
 *  - SNOOZE ("not today"): the same until a LOCAL date — Until tomorrow · For a week · For a month.
 *  - "Don't show a word's other card types on the same day" (sibling burying, off by default):
 *    once one card of a word was reviewed today, its NEW and REVIEW cards wait until tomorrow;
 *    learning cards never, a ⚡ bumped word never.
 * A held NEW card is simply not in the pools, so its slot goes to the next new card today.
 */

/** One hold on one card (a row of `card_holds`). [until] = the local date a snooze ends ("YYYY-MM-DD"). */
data class CardHold(
    val id: String,
    val cardId: String,
    /** "suspend" | "snooze". */
    val kind: String,
    val until: String?,
    val createdAt: String,
)

/** What the queue needs to know about holds (StudyQueue.build's `holds`). */
data class QueueHolds(
    /** Cards suspended or snoozed today ([CardHolds.heldCardIds]). */
    val held: Set<String> = emptySet(),
    /** Set only when sibling burying is on: the cards reviewed today. */
    val reviewedToday: Set<String>? = null,
)

/** A row of the "Suspended & snoozed cards" list. */
data class HoldListRow(val cardId: String, val hold: CardHold, val hanzi: String, val pinyin: String, val english: String)

object CardHolds {
    const val SUSPEND = "suspend"
    const val SNOOZE = "snooze"

    /** Port of SNOOZE_OPTIONS: length → label. */
    val SNOOZE_OPTIONS = listOf("tomorrow" to "Until tomorrow", "week" to "For a week", "month" to "For a month")

    /** Port of HOLD_SCOPE_OPTIONS. */
    val SCOPE_OPTIONS = listOf("card" to "This card only", "word" to "All card types of this word")

    /** Port of HOLD_EXPLANATION. */
    val EXPLANATION = mapOf(
        SUSPEND to "Suspended cards leave study completely — no reviews, no new-card slot — until you unsuspend them. Their history and schedule are kept exactly as they are.",
        SNOOZE to "Not today: the card is hidden until the day you pick, then comes back as it was. Its schedule doesn't change; a new card frees its slot for another new card today.",
    )

    private val DATE_RE = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")

    private fun isLeap(y: Int) = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
    private fun daysInMonth(y: Int, m: Int) = intArrayOf(31, if (isLeap(y)) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[m - 1]

    /** Port of isLocalDate(). */
    fun isLocalDate(s: String?): Boolean {
        val m = s?.let { DATE_RE.matchEntire(it) } ?: return false
        val y = m.groupValues[1].toInt(); val mo = m.groupValues[2].toInt(); val d = m.groupValues[3].toInt()
        return mo in 1..12 && d >= 1 && d <= daysInMonth(y, mo)
    }

    private fun parts(date: String): Triple<Int, Int, Int> {
        val m = DATE_RE.matchEntire(date) ?: throw IllegalArgumentException("not a date: $date")
        return Triple(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
    }

    private fun pad(n: Int, w: Int = 2) = n.toString().padStart(w, '0')

    /** Port of dayNumber() (days since 1970-01-01). */
    fun dayNumber(date: String): Long {
        val (y, m, d) = parts(date)
        val yy = (if (m <= 2) y - 1 else y).toLong()
        val era = Math.floorDiv(yy, 400L)
        val yoe = yy - era * 400
        val mp = (m + 9) % 12
        val doy = (153 * mp + 2) / 5 + d - 1
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    /** Port of dateOfDayNumber(). */
    fun dateOfDayNumber(n: Long): String {
        val z = n + 719468
        val era = Math.floorDiv(z, 146097L)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
        val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
        val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
        return "${pad(y, 4)}-${pad(m)}-${pad(d)}"
    }

    /** Port of addLocalDays(). */
    fun addDays(date: String, days: Int): String = dateOfDayNumber(dayNumber(date) + days)

    /** Port of addLocalMonths(): same day of the month, clamped to the month's last day. */
    fun addMonths(date: String, months: Int): String {
        val (y, m, d) = parts(date)
        val total = y * 12 + (m - 1) + months
        val ny = Math.floorDiv(total, 12)
        val nm = total - ny * 12 + 1
        return "${pad(ny, 4)}-${pad(nm)}-${pad(minOf(d, daysInMonth(ny, nm)))}"
    }

    /** Port of snoozeUntil(): the local date a snooze made [today] ends on. */
    fun snoozeUntil(today: String, length: String): String = when (length) {
        "week" -> addDays(today, 7)
        "month" -> addMonths(today, 1)
        else -> addDays(today, 1)
    }

    /** Port of isHoldActive(). */
    fun isActive(kind: String, until: String?, today: String): Boolean =
        if (kind == SUSPEND) true else isLocalDate(until) && today < until!!

    fun isActive(hold: CardHold, today: String) = isActive(hold.kind, hold.until, today)

    /** Port of heldCardIds(). */
    fun heldCardIds(holds: Iterable<CardHold>, today: String): Set<String> =
        holds.filter { isActive(it, today) }.mapTo(LinkedHashSet()) { it.cardId }

    /** Port of activeHoldFor(): suspended wins; of several snoozes the one ending last. */
    fun activeHoldFor(holds: Iterable<CardHold>, today: String): CardHold? {
        var best: CardHold? = null
        for (h in holds) {
            if (!isActive(h, today)) continue
            if (h.kind == SUSPEND) return h
            if (best == null || (h.until ?: "") > (best.until ?: "")) best = h
        }
        return best
    }

    /** Port of siblingBuriedCardIds(). */
    fun siblingBuriedCardIds(cards: List<QueueCard>, reviewedToday: Set<String>, exemptNoteIds: Collection<String>? = null): Set<String> {
        val out = LinkedHashSet<String>()
        if (reviewedToday.isEmpty()) return out
        val exempt = exemptNoteIds?.toSet() ?: emptySet()
        val reviewedIn = HashMap<String, MutableList<String>>()
        for (c in cards) if (c.id in reviewedToday) reviewedIn.getOrPut(c.noteId) { ArrayList() }.add(c.id)
        for (c in cards) {
            if (c.queue != CardQueue.NEW && c.queue != CardQueue.REVIEW) continue
            if (c.noteId in exempt) continue
            val reviewed = reviewedIn[c.noteId] ?: continue
            if (reviewed.any { it != c.id }) out += c.id
        }
        return out
    }

    /** Port of cardsInStudy(): held cards out, then (switch on) the buried siblings. */
    fun cardsInStudy(cards: List<QueueCard>, holds: QueueHolds?, exemptNoteIds: Collection<String>? = null): List<QueueCard> {
        if (holds == null) return cards
        var live = if (holds.held.isNotEmpty()) cards.filter { it.id !in holds.held } else cards
        val today = holds.reviewedToday
        if (!today.isNullOrEmpty()) {
            val buried = siblingBuriedCardIds(live, today, exemptNoteIds)
            if (buried.isNotEmpty()) live = live.filter { it.id !in buried }
        }
        return live
    }

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** Port of shortDate(): "3 Nov" (+ the year when it isn't [today]'s). */
    fun shortDate(date: String, today: String): String {
        val (y, m, d) = parts(date)
        val sameYear = isLocalDate(today) && parts(today).first == y
        return "$d ${MONTHS[m - 1]}" + if (sameYear) "" else " $y"
    }

    /** Port of holdStatusLabel(). */
    fun statusLabel(kind: String, until: String?, today: String): String {
        if (kind == SUSPEND) return "Suspended"
        if (!isLocalDate(until)) return "Snoozed"
        if (until!! <= addDays(today, 1)) return "Snoozed until tomorrow"
        return "Snoozed until ${shortDate(until, today)}"
    }

    /** Port of holdTag(): icon + text, never colour alone. */
    fun tag(kind: String, until: String?, today: String): Pair<String, String> {
        if (kind == SUSPEND) return "⏸" to "Suspended"
        if (isLocalDate(until) && until!! > addDays(today, 1)) return "💤" to "Snoozed · ${shortDate(until, today)}"
        return "💤" to "Snoozed · tomorrow"
    }

    private fun plural(n: Int, one: String, many: String = "${one}s") = "$n ${if (n == 1) one else many}"

    /** Port of holdMessage(). */
    fun message(kind: String, count: Int, length: String? = null): String {
        val what = if (count == 1) "This card" else plural(count, "card")
        if (kind == SUSPEND) {
            return if (count == 1) "Suspended — it stays out of study until you unsuspend it."
            else "$what suspended — they stay out of study until you unsuspend them."
        }
        val whenText = when (length) { "week" -> "for a week"; "month" -> "for a month"; else -> "until tomorrow" }
        return if (count == 1) "Snoozed $whenText." else "$what snoozed $whenText."
    }

    /** Port of releaseMessage(). */
    fun releaseMessage(count: Int): String = if (count == 1) "Back in study." else "${plural(count, "card")} back in study."

    private val TONE_MARKS = mapOf(
        'ā' to 'a', 'á' to 'a', 'ǎ' to 'a', 'à' to 'a', 'ē' to 'e', 'é' to 'e', 'ě' to 'e', 'è' to 'e',
        'ī' to 'i', 'í' to 'i', 'ǐ' to 'i', 'ì' to 'i', 'ō' to 'o', 'ó' to 'o', 'ǒ' to 'o', 'ò' to 'o',
        'ū' to 'u', 'ú' to 'u', 'ǔ' to 'u', 'ù' to 'u', 'ǖ' to 'ü', 'ǘ' to 'ü', 'ǚ' to 'ü', 'ǜ' to 'ü',
    )

    /** Port of foldToneMarks(). */
    fun foldToneMarks(s: String): String = buildString { for (ch in s) append(TONE_MARKS[ch] ?: ch) }

    private val SPACES = Regex("\\s+")

    /** Port of filterHoldRows(): search + filter chip ("all" | "suspended" | "snoozed"); suspended first, then by date. */
    fun filterRows(rows: List<HoldListRow>, query: String, filter: String): List<HoldListRow> {
        val trimmed = query.trim()
        val q = foldToneMarks(trimmed.lowercase())
        val out = rows.filter { r ->
            if (filter == "suspended" && r.hold.kind != SUSPEND) return@filter false
            if (filter == "snoozed" && r.hold.kind != SNOOZE) return@filter false
            if (q.isEmpty()) return@filter true
            r.hanzi.contains(trimmed) ||
                foldToneMarks(r.pinyin.lowercase()).replace(SPACES, "").contains(q.replace(SPACES, "")) ||
                r.english.lowercase().contains(q)
        }
        return out.sortedWith { a, b ->
            when {
                a.hold.kind != b.hold.kind -> if (a.hold.kind == SUSPEND) -1 else 1
                a.hold.kind == SNOOZE && a.hold.until != b.hold.until -> if ((a.hold.until ?: "") < (b.hold.until ?: "")) -1 else 1
                a.hold.createdAt != b.hold.createdAt -> if (a.hold.createdAt > b.hold.createdAt) -1 else 1
                else -> a.cardId.compareTo(b.cardId)
            }
        }
    }
}
