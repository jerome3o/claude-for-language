package dev.jeromeswannack.chineselearning.lab.core.cards

import dev.jeromeswannack.chineselearning.lab.core.explorer.DecalKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecals
import dev.jeromeswannack.chineselearning.lab.core.idioms.Idioms
import java.text.Normalizer

/*
 * Port of shared/cards/word-tags.ts — word tags (docs/STUDY_SESSION.md "Word tags"): the quiet
 * pills under the meaning on a card's answer side and in the explorer's Word view. Part of
 * speech, separable verb, register, measure word, HSK level, how common, traditional form —
 * from the shipped lexicon (shared/data/word-tags/word-tags.txt, a core resource) and the
 * word-frequency list. No AI, works offline. Parity-tested over the SHIPPED lexicon
 * (WordTagsParityTest, android-lab/parity/fixtures/word-tags.ts).
 */

/** Port of `WordTagMeasure`. */
data class WordTagMeasure(val char: String, val pinyin: String)

/** Port of `WordTagEntry`. */
data class WordTagEntry(
    val pos: List<String>,
    val register: List<String>,
    val measures: List<WordTagMeasure>,
    val hsk: Int?,
    val trad: String?,
    val separable: String?,
)

/** Port of `WordTagMarker`. */
data class WordTagMarker(val text: String, val register: String, val clauseStart: Boolean)

/** Port of `WordTagLexicon`. */
class WordTagLexicon(val words: Map<String, WordTagEntry>, val markers: List<WordTagMarker>)

/**
 * Port of `WordTag`. [kind]: pos | separable | transitivity | register | measure | hsk | frequency | trad | phrase.
 * [tone]: plain | grammar | formal | casual | warning | level | top100 | top1000 | top2000 | rare.
 * [ai]: suggested by the AI pass (WordTagsAi), not the lexicon — the pill shows ✨.
 */
data class WordTag(val kind: String, val id: String, val label: String, val tone: String, val ai: Boolean = false)

/** Port of `WordTagExplanation`. [ai] = an AI suggestion (the sheet says so); [note] = the AI's register note ("" = none). */
data class WordTagExplanation(
    val title: String,
    val body: String,
    val example: String,
    val source: String,
    val ai: Boolean = false,
    val note: String = "",
)

object WordTags {
    const val MAX_POS_TAGS = 2
    const val MAX_REGISTER_TAGS = 2
    const val MAX_MEASURES_SHOWN = 2

    /** Port of POS_LABELS. */
    val POS_LABELS: Map<String, String> = linkedMapOf(
        "n" to "Noun", "v" to "Verb", "a" to "Adjective", "d" to "Adverb", "q" to "Measure word",
        "m" to "Number", "r" to "Pronoun", "ry" to "Question word", "p" to "Preposition", "c" to "Conjunction",
        "u" to "Particle", "e" to "Interjection", "o" to "Sound word", "i" to "Idiom 成语", "l" to "Set phrase",
        "j" to "Abbreviation", "t" to "Time word", "f" to "Position word", "s" to "Place word", "nr" to "Name",
        "h" to "Prefix", "k" to "Suffix",
    )

    /** Port of REGISTER_LABELS. */
    val REGISTER_LABELS: Map<String, String> = linkedMapOf(
        "P" to "Polite", "F" to "Formal", "L" to "Literary", "C" to "Colloquial", "I" to "Informal", "S" to "Slang",
        "R" to "Rude", "D" to "Derogatory", "H" to "Humorous", "E" to "Euphemism", "O" to "Dated", "G" to "Regional",
        "T" to "Taiwan", "K" to "Cantonese",
    )

    val REGISTER_TONE: Map<String, String> = mapOf(
        "P" to "formal", "F" to "formal", "L" to "formal", "C" to "casual", "I" to "casual", "S" to "casual",
        "H" to "casual", "R" to "warning", "D" to "warning", "E" to "plain", "O" to "plain", "G" to "plain",
        "T" to "plain", "K" to "plain",
    )

    private val FREQUENCY_LABELS = mapOf("top100" to "Top 100", "top1000" to "Top 1,000", "top2000" to "Top 2,000", "rare" to "Rare")

    // JS `\s` (Unicode whitespace) spelled out: Java's \s is ASCII only.
    private const val JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private const val EDGE_CHARS = "${JS_SPACE}。！？!?.,，、；;：:…~～\"'“”‘’「」『』《》()（）"
    private val EDGE = Regex("^[$EDGE_CHARS]+|[$EDGE_CHARS]+\\z")
    private val CLAUSE_BREAK = Regex("[$EDGE_CHARS]")
    internal val SENTENCE_MARK = Regex("[。！？!?，,；;]")

    /** Port of parseWordTagLexicon(). */
    fun parse(text: String): WordTagLexicon {
        val words = HashMap<String, WordTagEntry>(60_000)
        val markers = ArrayList<WordTagMarker>()
        var section = ""
        for (raw in text.split('\n')) {
            val line = raw.removeSuffix("\r")
            if (line == "#words" || line == "#markers") { section = line; continue }
            if (line.isEmpty() || line.startsWith("#")) continue
            val cols = line.split('\t')
            if (cols[0].isEmpty()) continue
            fun col(i: Int) = cols.getOrNull(i) ?: ""
            if (section == "#words") {
                val measures = ArrayList<WordTagMeasure>()
                for (m in col(3).split(',')) {
                    val at = m.indexOf(':')
                    if (at > 0) measures.add(WordTagMeasure(m.substring(0, at), m.substring(at + 1)))
                }
                val hsk = col(4).toIntOrNull()
                words[cols[0]] = WordTagEntry(
                    pos = col(1).split(',').filter { it.isNotEmpty() },
                    register = codePoints(col(2)),
                    measures = measures,
                    hsk = if (col(4).isNotEmpty() && hsk != null && hsk in 1..7) hsk else null,
                    trad = col(5).ifEmpty { null },
                    separable = col(6).ifEmpty { null },
                )
            } else if (section == "#markers" && col(1).isNotEmpty()) {
                val clauseStart = cols[0].startsWith("^")
                val t = if (clauseStart) cols[0].substring(1) else cols[0]
                if (t.isNotEmpty()) markers.add(WordTagMarker(t, col(1), clauseStart))
            }
        }
        return WordTagLexicon(words, markers)
    }

    /**
     * The lexicon shipped with the app (shared/data/word-tags/word-tags.txt, a core resource).
     * Loaded once; null if it can't be read (the tags are then hidden, never the card).
     */
    val shipped: WordTagLexicon? get() = shippedLazy.value

    /** True once [shipped] has been read (the UI then shows the tags at once, no loading frame). */
    val shippedLoaded: Boolean get() = shippedLazy.isInitialized()

    private val shippedLazy = lazy {
        runCatching {
            val stream = WordTags::class.java.getResourceAsStream("/word-tags/word-tags.txt") ?: return@runCatching null
            parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        }.getOrNull()
    }

    private fun codePoints(s: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            out.add(String(Character.toChars(cp)))
            i += Character.charCount(cp)
        }
        return out
    }

    private fun cpCount(s: String): Int = s.codePointCount(0, s.length)

    internal fun isAllHan(s: String): Boolean {
        if (s.isEmpty()) return false
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            if (Character.UnicodeScript.of(cp) != Character.UnicodeScript.HAN) return false
            i += Character.charCount(cp)
        }
        return true
    }

    /** Port of wordTagKey(). */
    fun key(hanzi: String): String = EDGE.replace(Normalizer.normalize(hanzi, Normalizer.Form.NFC), "")

    /** Port of hskLabel(). */
    fun hskLabel(level: Int): String = if (level >= 7) "HSK 7–9" else "HSK $level"

    /** Port of measureLabel(). */
    fun measureLabel(measures: List<WordTagMeasure>): String =
        "Measure: " + measures.take(MAX_MEASURES_SHOWN).joinToString(", ") { "${it.char} ${it.pinyin}" }

    /** Port of markerRegister(). */
    fun markerRegister(text: String, markers: List<WordTagMarker>): List<String> {
        val out = ArrayList<String>()
        for (m in markers) {
            var at = text.indexOf(m.text)
            var hit = false
            while (at >= 0 && !hit) {
                if (!m.clauseStart || at == 0 || CLAUSE_BREAK.matches(text[at - 1].toString())) hit = true
                else at = text.indexOf(m.text, at + 1)
            }
            if (!hit) continue
            for (c in codePoints(m.register)) if (c !in out) out.add(c)
        }
        return out
    }

    /**
     * Port of wordTags(). [rankLoaded] false = the frequency list isn't loaded (no frequency tag,
     * like `rank: undefined`); true with [rank] null = not in the list.
     */
    fun tags(
        hanzi: String,
        lexicon: WordTagLexicon?,
        rankLoaded: Boolean = false,
        rank: Int? = null,
        exclude: Set<String> = emptySet(),
    ): List<WordTag> {
        if (lexicon == null) return emptyList()
        val key = key(hanzi)
        if (key.isEmpty()) return emptyList()
        val out = ArrayList<WordTag>()
        fun push(t: WordTag) { if (t.kind !in exclude) out.add(t) }
        fun register(codes: List<String>) {
            for (c in codes.take(MAX_REGISTER_TAGS)) {
                val label = REGISTER_LABELS[c] ?: continue
                push(WordTag("register", "register:$c", label, REGISTER_TONE[c] ?: "plain"))
            }
        }

        val entry = lexicon.words[key]
        if (entry == null) {
            val n = cpCount(key)
            val sentence = SENTENCE_MARK.containsMatchIn(Normalizer.normalize(hanzi, Normalizer.Form.NFC))
            if (isAllHan(key) && n == 4 && Idioms.isStarter(key)) push(WordTag("pos", "pos:i", POS_LABELS.getValue("i"), "plain"))
            else if (!sentence && isAllHan(key) && n in 2..6) push(WordTag("phrase", "phrase", "Phrase", "plain"))
            register(markerRegister(key, lexicon.markers))
            return out
        }

        for (p in entry.pos.take(MAX_POS_TAGS)) {
            val label = POS_LABELS[p] ?: continue
            push(WordTag("pos", "pos:$p", label, "plain"))
        }
        if (entry.separable != null) push(WordTag("separable", "separable", "Separable verb", "grammar"))
        register(entry.register)
        if (entry.measures.isNotEmpty()) push(WordTag("measure", "measure", measureLabel(entry.measures), "plain"))
        if (entry.hsk != null) push(WordTag("hsk", "hsk", hskLabel(entry.hsk), "level"))
        if (rankLoaded) {
            val tier = FrequencyDecals.tier(rank, if (cpCount(key) == 1) DecalKind.CHAR else DecalKind.WORD)
            if (tier != null) push(WordTag("frequency", "frequency", FREQUENCY_LABELS.getValue(tier.wire), tier.wire))
        }
        if (entry.trad != null) push(WordTag("trad", "trad", "Trad. ${entry.trad}", "plain"))
        return out
    }

    private val POS_EXPLAIN: Map<String, Pair<String, String>> = mapOf(
        "n" to ("A thing, person, place or idea. To count it, put a measure word in front: 一本书, 三个人." to "这是我的书。"),
        "v" to ("An action or a change. 了 (done), 过 (ever) and 着 (going on) follow it; 不 / 没 go before it." to "我看了那本书。"),
        "a" to ("Describes something and works like a verb — no 是: 她很高兴. A plain statement usually takes 很 (or another adverb)." to "这个菜很好吃。"),
        "d" to ("Goes right before the verb or adjective it changes, never at the end of the sentence." to "我也去。他已经走了。"),
        "q" to ("Goes between a number (or 这 / 那 / 几) and a noun. Each noun has its own: 一本书, 两张纸." to "我买了三本书。"),
        "m" to ("A number or an amount. Before a noun it needs a measure word: 两个苹果." to "我有两个哥哥。"),
        "r" to ("Stands in for a noun: a person, a thing, \"this\" or \"that\"." to "他是我的朋友。"),
        "ry" to ("Asks a question by standing where the answer goes — no 吗 needed." to "你去哪儿？他是谁？"),
        "p" to ("Comes before a noun to say where, when, with whom or to whom — and the whole phrase goes BEFORE the verb." to "我在家吃饭。"),
        "c" to ("Joins words or clauses. 和 joins nouns only; clauses are joined with words like 但是, 所以, 因为." to "因为下雨，所以我没去。"),
        "u" to ("A small grammar word with no meaning of its own: it marks a question, a mood, an aspect or a structure (了, 的, 吗, 吧, 着)." to "你好吗？"),
        "e" to ("An exclamation that stands on its own." to "哎呀，我忘了！"),
        "o" to ("Imitates a sound (an onomatopoeia)." to "他哈哈大笑。"),
        "i" to ("A set expression, usually four characters, often from a classical story. Use it whole — the characters can’t be swapped or split." to "他说话总是画蛇添足。"),
        "l" to ("A fixed expression used as one unit; learn it as a chunk." to "祝你一路平安！"),
        "j" to ("A shortened form of a longer word or name." to "北大 = 北京大学"),
        "t" to ("A noun for a time. It goes BEFORE the verb, often at the start of the sentence." to "我明天去北京。"),
        "f" to ("Says where, after a noun: on, in, in front of…" to "书在桌子上。"),
        "s" to ("A noun for a place." to "附近有银行吗？"),
        "nr" to ("A proper noun: the name of a person, a place or an organisation." to ""),
        "h" to ("Attaches to the front of a word or number." to "老师 · 第一"),
        "k" to ("Attaches to the end of a word." to "我们 · 桌子"),
    )

    val REGISTER_EXPLAIN: Map<String, String> = mapOf(
        "P" to "Shows respect — the word to use with strangers, older people, customers and teachers.",
        "F" to "Formal: speeches, official letters, business and the news. Stiff in a chat with friends.",
        "L" to "Literary or classical: met mostly in writing and set phrases, rare in everyday talk.",
        "C" to "Everyday spoken Chinese — natural with friends and family, out of place in formal writing.",
        "I" to "Casual. Fine with friends; with strangers, older people or at work, pick a more neutral word.",
        "S" to "Slang or internet talk — young and casual. Use it only where you’d use slang.",
        "R" to "Rude or vulgar. Good to recognise; think twice before saying it.",
        "D" to "Has a negative, disparaging ring — it puts someone or something down.",
        "H" to "Playful or joking.",
        "E" to "A softer, indirect way of saying something unpleasant.",
        "O" to "Old-fashioned: you’ll meet it in older texts more than in today’s speech.",
        "G" to "Dialect or regional usage — not standard Mandarin everywhere.",
        "T" to "Used mainly in Taiwan; the mainland usually says it differently.",
        "K" to "Cantonese / Hong Kong usage.",
    )

    /** Port of wordTagExplanation(). */
    fun explanation(tag: WordTag, hanzi: String, lexicon: WordTagLexicon?): WordTagExplanation {
        val key = key(hanzi)
        val entry = lexicon?.words?.get(key)
        return when (tag.kind) {
            "pos" -> {
                val code = tag.id.substring(4)
                val (body, example) = POS_EXPLAIN[code] ?: ("" to "")
                WordTagExplanation(
                    POS_LABELS[code] ?: tag.label, body, example,
                    if (code == "i" && entry == null) "Curated idiom list" else "HanLP / jieba part-of-speech lexicon",
                )
            }
            "separable" -> WordTagExplanation(
                "Separable verb 离合词",
                "A verb + its object in one word. Other words can go between the two halves (了, 过, a number, a person’s 的), and it can’t take another object: 跟他见面 — not 见面他.",
                entry?.separable ?: "",
                "Curated list",
            )
            "register" -> {
                val code = tag.id.substring(9)
                WordTagExplanation(
                    REGISTER_LABELS[code] ?: tag.label, REGISTER_EXPLAIN[code] ?: "", "",
                    if (entry != null) "CC-CEDICT usage label or the curated list" else "Found in this sentence (curated list)",
                )
            }
            "measure" -> {
                val ms = entry?.measures?.take(MAX_MEASURES_SHOWN) ?: emptyList()
                val list = ms.joinToString(" or ") { "${it.char} (${it.pinyin})" }
                WordTagExplanation(
                    "Measure word",
                    if (ms.isNotEmpty()) "Count this with $list. The measure word goes between the number (or 这 / 那) and the noun." else "",
                    if (ms.isNotEmpty()) "一${ms[0].char}$key" else "",
                    "CC-CEDICT",
                )
            }
            "hsk" -> {
                val level = entry?.hsk ?: 0
                WordTagExplanation(
                    tag.label,
                    if (level >= 7) "On the HSK 3.0 word list (2021) in the advanced band 7–9 — the last stage of the exam."
                    else "On the HSK 3.0 word list (2021) at level $level of 9 — level 1 is the first words a learner meets.",
                    "",
                    "HSK 3.0 word list (complete-hsk-vocabulary)",
                )
            }
            "frequency" -> {
                val unit = if (cpCount(key) == 1) "characters" else "words"
                val body = if (tag.tone == "rare") {
                    "Not among the ${if (unit == "words") "10,000" else "3,500"} most common $unit — you’ll meet it less often."
                } else {
                    "Among the ${tag.label.replaceFirst("Top ", "")} most common $unit in modern Chinese (books, news, subtitles and the web)."
                }
                WordTagExplanation(if (tag.label == "Rare") "Rare" else "${tag.label} $unit", body, "", "wordfreq")
            }
            "trad" -> WordTagExplanation(
                "Traditional form",
                "Written ${entry?.trad ?: ""} in traditional characters — Taiwan, Hong Kong and older texts.",
                "",
                "CC-CEDICT",
            )
            else -> WordTagExplanation(
                "Phrase",
                "Not a single dictionary word but a phrase of several words — learn it as a chunk.",
                "",
                "Not in the dictionary",
            )
        }
    }
}
