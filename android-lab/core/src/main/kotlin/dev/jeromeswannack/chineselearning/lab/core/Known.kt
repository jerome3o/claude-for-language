package dev.jeromeswannack.chineselearning.lab.core

/*
 * "How many characters and words do I (ostensibly) know?" — the Progress tab's
 * Characters / Words tiles, history chart and newest known characters. Port of
 * shared/progress/known.ts, parity-tested in KnownParityTest against vectors from the
 * TypeScript. See that file for the definitions (known = a card mature for 3+ weeks,
 * word = 1–4 Han characters without sentence punctuation, …).
 */

data class KnownNote(val id: String, val hanzi: String)

data class KnownCard(val id: String, val noteId: String)

data class KnownEvent(val id: String?, val cardId: String, val rating: Int, val reviewedAt: String)

data class KnownCounts(val known: Int = 0, val learning: Int = 0)

data class KnownPoint(val atMs: Long, val characters: KnownCounts, val words: KnownCounts)

data class RecentCharacter(val char: String, val knownAt: String)

data class KnownProgress(
    val characters: KnownCounts,
    val words: KnownCounts,
    val sentences: KnownCounts,
    /** Characters currently known, most recently learned first. */
    val recentCharacters: List<RecentCharacter>,
    /** Counts as of each requested point (events at or before it), oldest first. */
    val history: List<KnownPoint>,
)

data class KnownHeadline(val characters: KnownCounts, val words: KnownCounts, val sentences: KnownCounts)

enum class NoteKind { Word, Sentence, None }

object Known {
    const val MAX_WORD_CHARACTERS = 4
    const val RECENT_CHARACTERS = 12
    const val HISTORY_POINTS = 60
    private const val DAY_MS = 86_400_000L

    /** Port of isHanCodePoint(). */
    fun isHan(cp: Int): Boolean =
        (cp in 0x4e00..0x9fff) || (cp in 0x3400..0x4dbf) || (cp in 0xf900..0xfaff) ||
            (cp in 0x20000..0x2ebef) || (cp in 0x2f800..0x2fa1f) || (cp in 0x30000..0x323af)

    private fun codePoints(text: String): IntArray = text.codePoints().toArray()

    private fun str(cp: Int) = String(Character.toChars(cp))

    /** Port of hanCharacters(): distinct Han characters in order of first appearance. */
    fun hanCharacters(text: String): List<String> {
        val seen = LinkedHashSet<String>()
        for (cp in codePoints(text)) if (isHan(cp)) seen += str(cp)
        return seen.toList()
    }

    private val SENTENCE_PUNCTUATION: Set<Int> = "。？！，、；：…,.?!;:".codePoints().toArray().toSet()

    /** Port of noteKind(). */
    fun noteKind(hanzi: String): NoteKind {
        var han = 0
        var punctuated = false
        for (cp in codePoints(hanzi)) {
            if (isHan(cp)) han++ else if (cp in SENTENCE_PUNCTUATION) punctuated = true
        }
        return when {
            han == 0 -> NoteKind.None
            punctuated || han > MAX_WORD_CHARACTERS -> NoteKind.Sentence
            else -> NoteKind.Word
        }
    }

    /** Port of noteKey(): Han characters and ASCII letters / digits, in order. */
    fun noteKey(hanzi: String): String {
        val sb = StringBuilder()
        for (cp in codePoints(hanzi)) {
            val ascii = cp in 0x30..0x39 || cp in 0x41..0x5a || cp in 0x61..0x7a
            if (ascii || isHan(cp)) sb.appendCodePoint(cp)
        }
        return sb.toString()
    }

    private fun parse(s: String): Long? = try { Js.parseDate(s) } catch (_: Exception) { null }

    /** Port of historyPoints(). */
    fun historyPoints(events: List<KnownEvent>, nowMs: Long, maxPoints: Int = HISTORY_POINTS): List<Long> {
        var first = Long.MAX_VALUE
        for (e in events) {
            val ms = parse(e.reviewedAt) ?: continue
            if (ms < first) first = ms
        }
        if (first == Long.MAX_VALUE) return emptyList()
        if (first >= nowMs) return listOf(nowMs)
        val spanDays = Math.ceil((nowMs - first).toDouble() / DAY_MS)
        val stepDays = Math.max(1.0, Math.ceil(spanDays / Math.max(1, maxPoints - 1)))
        val stepMs = (stepDays * DAY_MS).toLong()
        val steps = Math.ceil((nowMs - first).toDouble() / stepMs).toLong()
        return (steps downTo 0L).map { k -> nowMs - k * stepMs }
    }

    private class Group {
        var known = 0
        var seen = 0
        fun tier(): Int = if (known > 0) 2 else if (seen > 0) 1 else 0
    }

    private class Tally {
        var known = 0
        var learning = 0
        fun move(from: Int, to: Int) {
            if (from == to) return
            if (from == 2) known-- else if (from == 1) learning--
            if (to == 2) known++ else if (to == 1) learning++
        }
        fun counts() = KnownCounts(known, learning)
    }

    private class Change(val ms: Long, val card: String, val seq: Int, val tier: Int, val at: String)

    private class NoteInfo(val kind: NoteKind, val key: String, val chars: List<String>)

    /** Port of knownProgress(). */
    fun progress(
        notes: List<KnownNote>,
        cards: List<KnownCard>,
        events: List<KnownEvent>,
        points: List<Long> = emptyList(),
        recentLimit: Int = RECENT_CHARACTERS,
    ): KnownProgress {
        val noteById = HashMap<String, KnownNote>()
        for (n in notes) noteById[n.id] = n
        val cardNote = HashMap<String, String>()
        val noteCards = HashMap<String, MutableList<String>>()
        for (c in cards) {
            if (!noteById.containsKey(c.noteId) || cardNote.containsKey(c.id)) continue
            cardNote[c.id] = c.noteId
            noteCards.getOrPut(c.noteId) { ArrayList(3) } += c.id
        }

        val byCard = LinkedHashMap<String, MutableList<KnownEvent>>()
        for (e in events) {
            if (!cardNote.containsKey(e.cardId) || parse(e.reviewedAt) == null) continue
            byCard.getOrPut(e.cardId) { ArrayList() } += e
        }
        val changes = ArrayList<Change>()
        for ((cardId, list) in byCard) {
            val sorted = list.sortedWith(compareBy<KnownEvent>({ it.reviewedAt }, { it.id ?: "" }))
            val timeline = CardScheduler.computeCardTimeline(sorted.map { ReviewEventInput(it.id ?: "", it.cardId, it.rating, it.reviewedAt) })
            var prev = 0
            timeline.forEachIndexed { seq, p ->
                val tier = if (Mastery.level(p.queue, p.stability) == MasteryLevel.Mastered) 2 else 1
                if (tier != prev) changes += Change(Js.parseDate(p.reviewedAt), cardId, seq, tier, p.reviewedAt)
                prev = tier
            }
        }
        changes.sortWith(compareBy<Change>({ it.ms }, { it.card }, { it.seq }))

        val noteInfo = HashMap<String, NoteInfo>()
        fun info(noteId: String): NoteInfo = noteInfo.getOrPut(noteId) {
            val hanzi = noteById.getValue(noteId).hanzi
            NoteInfo(noteKind(hanzi), noteKey(hanzi), hanCharacters(hanzi))
        }

        val cardTier = HashMap<String, Int>()
        val noteTier = HashMap<String, Int>()
        val words = HashMap<String, Group>()
        val sentences = HashMap<String, Group>()
        val chars = HashMap<String, Group>()
        val wordTally = Tally()
        val sentenceTally = Tally()
        val charTally = Tally()
        val knownAt = HashMap<String, Pair<Long, String>>()

        fun bump(groups: HashMap<String, Group>, key: String, tally: Tally, from: Int, to: Int): Pair<Int, Int> {
            val g = groups.getOrPut(key) { Group() }
            val before = g.tier()
            if (from >= 1) g.seen--
            if (from == 2) g.known--
            if (to >= 1) g.seen++
            if (to == 2) g.known++
            val after = g.tier()
            tally.move(before, after)
            return before to after
        }

        val sortedPoints = points.sorted()
        val history = ArrayList<KnownPoint>(sortedPoints.size)
        var pi = 0
        fun record(upTo: Long) {
            while (pi < sortedPoints.size && sortedPoints[pi] < upTo) {
                history += KnownPoint(sortedPoints[pi], charTally.counts(), wordTally.counts())
                pi++
            }
        }

        for (ch in changes) {
            record(ch.ms)
            cardTier[ch.card] = ch.tier
            val noteId = cardNote.getValue(ch.card)
            var tier = 0
            for (c in noteCards.getValue(noteId)) {
                val t = cardTier[c] ?: 0
                if (t > tier) tier = t
            }
            val old = noteTier[noteId] ?: 0
            if (tier == old) continue
            noteTier[noteId] = tier
            val i = info(noteId)
            when (i.kind) {
                NoteKind.Word -> bump(words, i.key, wordTally, old, tier)
                NoteKind.Sentence -> bump(sentences, i.key, sentenceTally, old, tier)
                NoteKind.None -> Unit
            }
            for (c in i.chars) {
                val (before, after) = bump(chars, c, charTally, old, tier)
                if (after == 2 && before != 2) knownAt[c] = ch.ms to ch.at
                else if (after != 2 && before == 2) knownAt.remove(c)
            }
        }
        record(Long.MAX_VALUE)

        val recent = knownAt.entries
            .sortedWith(compareByDescending<Map.Entry<String, Pair<Long, String>>> { it.value.first }.thenBy { it.key })
            .take(Math.max(0, recentLimit))
            .map { RecentCharacter(it.key, it.value.second) }

        return KnownProgress(charTally.counts(), wordTally.counts(), sentenceTally.counts(), recent, history)
    }

    /** Port of knownCountsFromTiers(): the headline from each note's best card tier. */
    fun countsFromTiers(notes: List<Pair<String, Int>>): KnownHeadline {
        val words = HashMap<String, Int>()
        val sentences = HashMap<String, Int>()
        val chars = HashMap<String, Int>()
        fun best(m: HashMap<String, Int>, k: String, t: Int) { m[k] = Math.max(m[k] ?: 0, t) }
        for ((hanzi, raw) in notes) {
            val tier = if (raw >= 2) 2 else if (raw >= 1) 1 else 0
            if (tier == 0) continue
            when (noteKind(hanzi)) {
                NoteKind.Word -> best(words, noteKey(hanzi), tier)
                NoteKind.Sentence -> best(sentences, noteKey(hanzi), tier)
                NoteKind.None -> Unit
            }
            for (c in hanCharacters(hanzi)) best(chars, c, tier)
        }
        fun count(m: HashMap<String, Int>) = KnownCounts(m.values.count { it == 2 }, m.values.count { it != 2 })
        return KnownHeadline(count(chars), count(words), count(sentences))
    }
}
