package dev.jeromeswannack.chineselearning.lab.core

/*
 * "New characters first": which brand-new (primary, blue) notes a deck introduces today.
 * Port of shared/decks/novelty.ts (parity-tested through the study-queue vectors) — see
 * that file for the rule: never-seen Han characters (capped at 2) > unseen word > fewer
 * Han characters > existing order, picked greedily so each pick's characters count as
 * seen for the next.
 */

/** What the learner has seen: characters, and the Han text of each seen note ('\n'-separated). */
class SeenText {
    val chars = HashSet<String>()
    val words = StringBuilder()
}

data class Novelty(val newChars: Int, val unseenWord: Boolean, val length: Int)

object NoveltyRank {
    /** New characters beyond this many don't rank a note higher. */
    const val NEW_CHARACTER_RANK_CAP = 2

    /** Port of hanText(): every Han character of a text, in order. */
    fun hanText(text: String): String {
        val sb = StringBuilder()
        text.codePoints().forEach { if (Known.isHan(it)) sb.appendCodePoint(it) }
        return sb.toString()
    }

    /** Port of markSeen(). */
    fun markSeen(seen: SeenText, hanzi: String) {
        seen.chars += Known.hanCharacters(hanzi)
        val text = hanText(hanzi)
        if (text.isNotEmpty()) seen.words.append(text).append('\n')
    }

    /** Port of seenFrom(). */
    fun seenFrom(hanzi: Iterable<String>): SeenText = SeenText().also { s -> hanzi.forEach { markSeen(s, it) } }

    /** Port of noveltyOf(). */
    fun noveltyOf(hanzi: String, seen: SeenText): Novelty {
        val text = hanText(hanzi)
        return Novelty(
            Known.hanCharacters(hanzi).count { it !in seen.chars },
            text.isNotEmpty() && seen.words.indexOf(text) < 0,
            text.codePointCount(0, text.length),
        )
    }

    /** Port of compareNovelty(): < 0 when [a] goes before [b]. */
    fun compare(a: Novelty, b: Novelty): Int {
        val ca = minOf(a.newChars, NEW_CHARACTER_RANK_CAP)
        val cb = minOf(b.newChars, NEW_CHARACTER_RANK_CAP)
        if (ca != cb) return cb - ca
        if (a.unseenWord != b.unseenWord) return if (a.unseenWord) -1 else 1
        return a.length - b.length
    }

    private class Candidate<T>(val item: T, val hanzi: String, val chars: List<String>, val text: String, val length: Int, var unseenWord: Boolean)

    /** Port of pickByNovelty(): [take] items in pick order; mutates [seen]. Ties keep the input order. */
    fun <T> pick(candidates: List<T>, take: Int, hanziOf: (T) -> String, seen: SeenText): List<T> {
        if (take <= 0) return emptyList()
        val rest = candidates.mapTo(ArrayList()) { item ->
            val hanzi = hanziOf(item)
            val text = hanText(hanzi)
            Candidate(item, hanzi, Known.hanCharacters(hanzi), text, text.codePointCount(0, text.length), text.isNotEmpty() && seen.words.indexOf(text) < 0)
        }
        val out = ArrayList<T>()
        while (out.size < take && rest.isNotEmpty()) {
            var best = -1
            var bestN: Novelty? = null
            for ((i, r) in rest.withIndex()) {
                val n = Novelty(r.chars.count { it !in seen.chars }, r.unseenWord, r.length)
                if (bestN == null || compare(n, bestN) < 0) { best = i; bestN = n }
            }
            val picked = rest.removeAt(best)
            out += picked.item
            markSeen(seen, picked.hanzi)
            if (picked.text.isNotEmpty()) for (r in rest) if (r.unseenWord && picked.text.contains(r.text)) r.unseenWord = false
        }
        return out
    }

    private class GroupCandidate<T>(val item: T, val hanzi: String, val chars: List<String>, val length: Int, val rank: Int, val group: String, val key: String)

    /**
     * Port of pickNewCharactersAcrossGroups(): "new characters first across all decks". Greedy;
     * only candidates still bringing ≥ 1 never-seen character qualify; a group gives at most
     * [room] picks. Ranking: never-seen characters (capped) desc, [rank] asc, shorter, [tieKey]
     * (JS string order = UTF-16, like Kotlin's compareTo). Mutates [seen].
     */
    fun <T> pickAcrossGroups(
        candidates: List<T>,
        take: Int,
        hanziOf: (T) -> String,
        groupOf: (T) -> String,
        rank: (String) -> Int,
        room: Map<String, Int>,
        tieKey: (T) -> String,
        seen: SeenText,
    ): List<T> {
        if (take <= 0) return emptyList()
        val left = HashMap(room)
        var rest = ArrayList<GroupCandidate<T>>()
        for (item in candidates) {
            val group = groupOf(item)
            if ((left[group] ?: 0) <= 0) continue
            val hanzi = hanziOf(item)
            val chars = Known.hanCharacters(hanzi)
            if (chars.none { it !in seen.chars }) continue
            val text = hanText(hanzi)
            rest += GroupCandidate(item, hanzi, chars, text.codePointCount(0, text.length), rank(group), group, tieKey(item))
        }
        val out = ArrayList<T>()
        while (out.size < take && rest.isNotEmpty()) {
            var best = -1
            var bestNew = 0
            val keep = ArrayList<GroupCandidate<T>>(rest.size)
            for (r in rest) {
                if ((left[r.group] ?: 0) <= 0) continue
                val newChars = r.chars.count { it !in seen.chars }
                if (newChars == 0) continue
                val n = minOf(newChars, NEW_CHARACTER_RANK_CAP)
                keep += r
                if (best < 0) { best = keep.size - 1; bestNew = n; continue }
                val b = keep[best]
                val better = when {
                    n != bestNew -> n > bestNew
                    r.rank != b.rank -> r.rank < b.rank
                    r.length != b.length -> r.length < b.length
                    else -> r.key < b.key
                }
                if (better) { best = keep.size - 1; bestNew = n }
            }
            if (best < 0) break
            val picked = keep.removeAt(best)
            rest = keep
            out += picked.item
            left[picked.group] = (left[picked.group] ?: 0) - 1
            markSeen(seen, picked.hanzi)
        }
        return out
    }
}
