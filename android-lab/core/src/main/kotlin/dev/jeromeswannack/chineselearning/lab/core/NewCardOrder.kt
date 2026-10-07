package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.util.PriorityQueue

/*
 * "Order new cards by" (Settings → New cards): WHICH brand-new (primary, blue) words the daily
 * budget introduces first. Port of shared/decks/new-card-order.ts + shared/decks/frequency.ts,
 * parity-tested through android-lab/parity/fixtures/new-card-order.ts (and the study-queue
 * vectors). See new-card-order.ts for the rules: tiers new characters → new words → (sentences
 * last) words before sentences, the most common first inside each tier (in the new-character
 * tier: the most common never-seen character first), then the deck order.
 */

/** Port of NewCardOrder (shared/decks/new-card-order.ts). Default: every switch on. */
data class NewCardOrder(
    val newCharactersFirst: Boolean = true,
    val newWordsFirst: Boolean = true,
    val mostCommonFirst: Boolean = true,
    val sentencesLast: Boolean = true,
) {
    val isDefault: Boolean get() = this == DEFAULT

    operator fun get(key: String): Boolean = when (key) {
        "new_characters_first" -> newCharactersFirst
        "new_words_first" -> newWordsFirst
        "most_common_first" -> mostCommonFirst
        "sentences_last" -> sentencesLast
        else -> false
    }

    fun with(key: String, on: Boolean): NewCardOrder = when (key) {
        "new_characters_first" -> copy(newCharactersFirst = on)
        "new_words_first" -> copy(newWordsFirst = on)
        "most_common_first" -> copy(mostCommonFirst = on)
        "sentences_last" -> copy(sentencesLast = on)
        else -> this
    }

    /** The stored JSON (the server's shape). */
    fun toJson(): String = KEYS.joinToString(",", "{", "}") { "\"$it\":${get(it)}" }

    data class Option(val key: String, val label: String, val hint: String)

    companion object {
        val DEFAULT = NewCardOrder()
        val ALL_OFF = NewCardOrder(false, false, false, false)
        val KEYS = listOf("new_characters_first", "new_words_first", "most_common_first", "sentences_last")

        /** NEW_CARD_ORDER_OPTIONS — the settings rows, same words as the web (parity-tested). */
        val OPTIONS = listOf(
            Option("new_characters_first", "New characters first", "Words that bring a character you have never studied come first."),
            Option("new_words_first", "New words first", "Then words you haven't met anywhere yet — not even inside a sentence."),
            Option("most_common_first", "Most common first", "Within each group, the words Chinese speakers use most come first, and the most common new characters before rare ones."),
            Option("sentences_last", "Sentences last", "Sentence cards wait until the words are in."),
        )

        /** Port of parseNewCardOrder(): stored JSON (maybe partial / garbage) → a full set. */
        fun parse(raw: String?): NewCardOrder {
            if (raw.isNullOrBlank()) return DEFAULT
            val obj = runCatching { Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return DEFAULT
            var out = DEFAULT
            for (key in KEYS) {
                val p = obj[key] as? JsonPrimitive ?: continue
                if (p.isString) continue
                p.booleanOrNull?.let { out = out.with(key, it) }
            }
            return out
        }
    }
}

/** Port of FrequencyIndex (shared/decks/frequency.ts): word / character → rank (1 = most frequent). */
class FrequencyIndex(val words: Map<String, Int>, val chars: Map<String, Int>)

/** Port of shared/decks/frequency.ts. */
object WordFrequency {
    const val UNKNOWN_WORD_BASE = 1_000_000
    const val UNRANKED_CHAR = 100_000
    const val NO_HAN_RANK = 10_000_000

    /** Port of parseFrequencyList(). */
    fun parse(text: String): FrequencyIndex {
        val words = HashMap<String, Int>(40_000)
        val chars = HashMap<String, Int>(10_000)
        var section = ""
        for (raw in text.split('\n')) {
            val line = raw.trim()
            if (line == "#words" || line == "#chars") { section = line; continue }
            if (line.isEmpty() || line.startsWith("#")) continue
            if (section == "#words") {
                if (line !in words) words[line] = words.size + 1
            } else if (section == "#chars") {
                line.codePoints().forEach { cp ->
                    val ch = String(Character.toChars(cp))
                    if (ch !in chars) chars[ch] = chars.size + 1
                }
            }
        }
        return FrequencyIndex(words, chars)
    }

    /** Port of characterRank(): 1 = most frequent, [UNRANKED_CHAR] when not listed. */
    fun charRank(ch: String, index: FrequencyIndex): Int = index.chars[ch] ?: UNRANKED_CHAR

    /** Port of frequencyRank(). */
    fun rank(hanzi: String, index: FrequencyIndex): Int {
        val text = NoveltyRank.hanText(hanzi)
        return rankOfText(text, Known.hanCharacters(text), index)
    }

    /** Port of frequencyRankOfText(). */
    fun rankOfText(text: String, chars: List<String>, index: FrequencyIndex): Int {
        if (text.isEmpty()) return NO_HAN_RANK
        index.words[text]?.let { return it }
        var rarest = 0
        for (ch in chars) rarest = maxOf(rarest, index.chars[ch] ?: UNRANKED_CHAR)
        return UNKNOWN_WORD_BASE + rarest
    }

    /**
     * The list shipped with the app (shared/data/frequency/word-freq.txt, a core resource):
     * wordfreq large_zh, data licence CC BY-SA 4.0. Loaded once; null if it can't be read
     * ("Most common first" then does nothing — the queue is still built).
     */
    val shipped: FrequencyIndex? by lazy {
        runCatching {
            val stream = WordFrequency::class.java.getResourceAsStream("/frequency/word-freq.txt") ?: return@runCatching null
            parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        }.getOrNull()
    }
}

/** Port of StudiedIndex: characters + word pieces (null = not tracked) of every studied note. */
class StudiedIndex(val chars: HashSet<String> = HashSet(), val pieces: HashSet<String>? = HashSet())

/** Port of the ordering half of shared/decks/new-card-order.ts. */
object NewCardOrdering {
    private const val TIER_NONE = -1

    /** Port of hanRuns(). */
    fun hanRuns(text: String): List<List<String>> {
        val runs = ArrayList<List<String>>()
        var run = ArrayList<String>()
        text.codePoints().forEach { cp ->
            if (Known.isHan(cp)) run += String(Character.toChars(cp))
            else if (run.isNotEmpty()) { runs += run; run = ArrayList() }
        }
        if (run.isNotEmpty()) runs += run
        return runs
    }

    /** Port of wordPieces(): every 2–4 character piece inside one Han run, in order. */
    fun wordPieces(hanzi: String): List<String> {
        val out = ArrayList<String>()
        for (run in hanRuns(hanzi)) {
            for (i in run.indices) {
                val sb = StringBuilder(run[i])
                var len = 2
                while (len <= Known.MAX_WORD_CHARACTERS && i + len <= run.size) {
                    sb.append(run[i + len - 1])
                    out += sb.toString()
                    len++
                }
            }
        }
        return out
    }

    /** Port of markStudied(). */
    fun markStudied(studied: StudiedIndex, hanzi: String) {
        for (run in hanRuns(hanzi)) {
            studied.chars.addAll(run)
        }
        studied.pieces?.addAll(wordPieces(hanzi))
    }

    /** Port of studiedFrom(). */
    fun studiedFrom(hanzi: Iterable<String>, withPieces: Boolean = true): StudiedIndex =
        StudiedIndex(HashSet(), if (withPieces) HashSet() else null).also { s -> hanzi.forEach { markStudied(s, it) } }

    /** Port of isNewWord(). */
    fun isNewWord(hanzi: String, studied: StudiedIndex): Boolean {
        if (Known.noteKind(hanzi) != NoteKind.Word) return false
        val text = NoveltyRank.hanText(hanzi)
        return if (text.codePointCount(0, text.length) == 1) text !in studied.chars else studied.pieces?.contains(text) != true
    }

    private class Entry<T>(
        val item: T,
        val hanzi: String,
        val chars: List<String>,
        val charRanks: IntArray,
        val text: String,
        val length: Int,
        val word: Boolean,
        val sentence: Boolean,
        val freq: Int,
        val rank: Int,
        val group: String,
        val key: String,
        var newChars: Int,
        var newWord: Boolean,
    )

    private class Snapshot<T>(val e: Entry<T>, val tier: Int, val newCharRank: Int, val newCapped: Int)

    private class Keyed<T>(val item: T, val sentence: Int, val freq: Int)

    private fun <T> tierOf(e: Entry<T>, order: NewCardOrder): Int = when {
        order.newCharactersFirst && e.newChars > 0 -> 0
        order.newWordsFirst && e.newWord -> 1
        order.sentencesLast && e.word -> 2
        else -> TIER_NONE
    }

    /** Port of snapshotOf(): in tier 0, the rank of the most common never-seen character too. */
    private fun <T> snapshotOf(e: Entry<T>, order: NewCardOrder, studied: StudiedIndex): Snapshot<T> {
        val tier = tierOf(e, order)
        if (tier != 0) return Snapshot(e, tier, 0, 0)
        var newCharRank = Int.MAX_VALUE
        for (i in e.chars.indices) {
            if (e.chars[i] !in studied.chars && e.charRanks[i] < newCharRank) newCharRank = e.charRanks[i]
        }
        return Snapshot(e, tier, newCharRank, minOf(e.newChars, NoveltyRank.NEW_CHARACTER_RANK_CAP))
    }

    /** Port of compareSnapshots(): a total order (the card id breaks every tie). */
    private fun <T> compareSnapshots(x: Snapshot<T>, y: Snapshot<T>, order: NewCardOrder): Int {
        if (x.tier != y.tier) return x.tier.compareTo(y.tier)
        val a = x.e
        val b = y.e
        when (x.tier) {
            0 -> {
                if (order.sentencesLast && a.sentence != b.sentence) return if (a.sentence) 1 else -1
                if (x.newCharRank != y.newCharRank) return x.newCharRank.compareTo(y.newCharRank)
                if (x.newCapped != y.newCapped) return y.newCapped.compareTo(x.newCapped)
                if (order.mostCommonFirst && a.freq != b.freq) return a.freq.compareTo(b.freq)
            }
            1 -> if (order.mostCommonFirst && a.freq != b.freq) return a.freq.compareTo(b.freq)
            else -> {
                if (a.rank != b.rank) return a.rank.compareTo(b.rank)
                if (order.mostCommonFirst && a.freq != b.freq) return a.freq.compareTo(b.freq)
            }
        }
        if (a.rank != b.rank) return a.rank.compareTo(b.rank)
        if (a.length != b.length) return a.length.compareTo(b.length)
        return a.key.compareTo(b.key)
    }

    /**
     * Port of pickNewCardsByOrder(): up to [take] candidates that fall in a tier, best first,
     * a group giving at most `room[group]`. Greedy; mutates [studied].
     */
    fun <T> pickByOrder(
        candidates: List<T>,
        take: Int,
        hanziOf: (T) -> String,
        groupOf: (T) -> String,
        rank: (String) -> Int,
        room: Map<String, Int>,
        tieKey: (T) -> String,
        order: NewCardOrder,
        studied: StudiedIndex,
        frequency: FrequencyIndex?,
    ): List<T> {
        if (take <= 0) return emptyList()
        if (!order.newCharactersFirst && !order.newWordsFirst && !order.sentencesLast) return emptyList()
        val useFreq = order.mostCommonFirst && frequency != null
        val left = HashMap(room)
        val heap = PriorityQueue<Snapshot<T>> { a, b -> compareSnapshots(a, b, order) }
        val byChar = HashMap<String, MutableList<Entry<T>>>()
        val byText = HashMap<String, MutableList<Entry<T>>>()
        val charRankCache = HashMap<String, Int>()
        for (item in candidates) {
            val group = groupOf(item)
            if ((left[group] ?: 0) <= 0) continue
            val hanzi = hanziOf(item)
            val sb = StringBuilder()
            var length = 0
            val chars = ArrayList<String>()
            val distinct = HashSet<String>()
            hanzi.codePoints().forEach { cp ->
                if (Known.isHan(cp)) {
                    val ch = String(Character.toChars(cp))
                    sb.append(ch)
                    length++
                    if (distinct.add(ch)) chars += ch
                }
            }
            val text = sb.toString()
            val kind = Known.noteKind(hanzi)
            val word = kind == NoteKind.Word
            val newChars = chars.count { it !in studied.chars }
            val charRanks = IntArray(chars.size)
            if (useFreq && newChars > 0) {
                for (i in chars.indices) charRanks[i] = charRankCache.getOrPut(chars[i]) { WordFrequency.charRank(chars[i], frequency!!) }
            }
            val e = Entry(
                item, hanzi, chars, charRanks, text, length, word,
                sentence = kind == NoteKind.Sentence,
                freq = if (useFreq) WordFrequency.rankOfText(text, chars, frequency!!) else 0,
                rank = rank(group),
                group = group,
                key = tieKey(item),
                newChars = newChars,
                newWord = order.newWordsFirst && word && (if (length == 1) text !in studied.chars else studied.pieces?.contains(text) != true),
            )
            val snap = snapshotOf(e, order, studied)
            if (snap.tier == TIER_NONE) continue
            heap += snap
            if (newChars > 0) for (c in chars) if (c !in studied.chars) byChar.getOrPut(c) { ArrayList() } += e
            if (e.newWord) byText.getOrPut(text) { ArrayList() } += e
        }

        val out = ArrayList<T>()
        while (out.size < take && heap.isNotEmpty()) {
            val top = heap.poll()
            val picked = top.e
            if ((left[picked.group] ?: 0) <= 0) continue
            val now = snapshotOf(picked, order, studied)
            if (now.tier == TIER_NONE) continue
            if (now.tier != top.tier || now.newCharRank != top.newCharRank || now.newCapped != top.newCapped) { heap += now; continue }
            out += picked.item
            left[picked.group] = (left[picked.group] ?: 0) - 1
            for (c in picked.chars) {
                if (!studied.chars.add(c)) continue
                byChar[c]?.forEach { it.newChars-- }
                byText[c]?.forEach { it.newWord = false }
            }
            studied.pieces?.let { pieces ->
                for (p in wordPieces(picked.hanzi)) {
                    if (!pieces.add(p)) continue
                    byText[p]?.forEach { it.newWord = false }
                }
            }
        }
        return out
    }

    /** Port of orderWithinDeck(): words before sentences, the most common first; stable. */
    fun <T> orderWithinDeck(items: List<T>, hanziOf: (T) -> String, order: NewCardOrder, frequency: FrequencyIndex?): List<T> {
        val useFreq = order.mostCommonFirst && frequency != null
        if (!order.sentencesLast && !useFreq) return items.toList()
        return items.map { item ->
            val hanzi = hanziOf(item)
            Keyed(
                item,
                if (order.sentencesLast && Known.noteKind(hanzi) == NoteKind.Sentence) 1 else 0,
                if (useFreq) WordFrequency.rank(hanzi, frequency!!) else 0,
            )
        }.sortedWith(compareBy<Keyed<T>> { it.sentence }.thenBy { it.freq }).map { it.item }
    }
}
