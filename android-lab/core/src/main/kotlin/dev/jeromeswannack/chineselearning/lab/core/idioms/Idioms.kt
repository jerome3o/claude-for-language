package dev.jeromeswannack.chineselearning.lab.core.idioms

import dev.jeromeswannack.chineselearning.lab.core.PictureHuntMatch
import kotlinx.serialization.Serializable
import java.text.Normalizer

/*
 * Port of shared/idioms (docs/IDIOMS.md) — 成语 Idioms (beta): the entry shape the API serves
 * (one generated entry per idiom, shared by every account), the starter list, the cache key,
 * the explorer's "📜 Story & usage" rule, the "+ Add as card" fields and the "Try it" score
 * line. Parity-tested against the TypeScript (parity/fixtures/idioms.ts, IdiomsParityTest).
 * The validator (shared/idioms/validate.ts) runs on the server only: clients read entries it
 * already cleaned.
 */

/** Port of `IdiomChar`. */
@Serializable
data class IdiomChar(val hanzi: String, val pinyin: String, val gloss: String)

/** Port of `IdiomLine` (a story paragraph, an example, a collocation). */
@Serializable
data class IdiomLine(val hanzi: String, val pinyin: String, val english: String)

/** Port of `IdiomRef` (a 近义 / 反义 idiom). */
@Serializable
data class IdiomRef(val hanzi: String, val pinyin: String, val english: String)

/** Port of `IdiomQuizQuestion`. */
@Serializable
data class IdiomQuizQuestion(
    val kind: String,
    val prompt: String,
    val options: List<String>,
    val answer: Int,
    val explanation: String,
)

/** Port of `IdiomOrigin`. kind: classical | folk | modern | uncertain. */
@Serializable
data class IdiomOrigin(
    val kind: String,
    val source: String? = null,
    val era: String? = null,
    val summary: String,
    val story: List<IdiomLine>,
    val note: String? = null,
)

/** Port of `IdiomUsage`. register: written | spoken | both; sentiment: praise | criticism | neutral. */
@Serializable
data class IdiomUsage(
    val roles: List<String>,
    val register: String,
    val sentiment: String,
    val note: String,
    val collocations: List<IdiomLine>,
    val examples: List<IdiomLine>,
    val mistake: String,
)

/** Port of `IdiomEntry`. */
@Serializable
data class IdiomEntry(
    val hanzi: String,
    val pinyin: String,
    val literal: List<IdiomChar>,
    val literal_english: String,
    val meaning: String,
    val explanation_zh: String,
    val explanation_pinyin: String,
    val origin: IdiomOrigin,
    val usage: IdiomUsage,
    val synonyms: List<IdiomRef>,
    val antonyms: List<IdiomRef>,
    val quiz: List<IdiomQuizQuestion>,
    /** high | medium | low */
    val confidence: String,
    val confidence_note: String? = null,
)

/** Port of `IdiomRecord`. status: generating | ready | failed | not_idiom | missing. */
@Serializable
data class IdiomRecord(
    val hanzi: String,
    val status: String,
    val entry: IdiomEntry? = null,
    val error: String? = null,
    val suggestion: String? = null,
    val generator_version: Int = 1,
    val updated_at: String? = null,
)

/** Port of `IdiomSummary`. */
@Serializable
data class IdiomSummary(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val status: String,
    val starter: Boolean = false,
)

/** Port of `StarterIdiom`. kind: story | everyday. */
data class StarterIdiom(val hanzi: String, val pinyin: String, val english: String, val kind: String)

/** Port of `IdiomCardFields`. */
data class IdiomCardFields(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val funFacts: String,
    val sentenceClue: String? = null,
    val sentenceCluePinyin: String? = null,
    val sentenceClueTranslation: String? = null,
)

object Idioms {
    const val MIN_CHARS = 3
    const val MAX_CHARS = 12

    /** Port of `IDIOM_ROLES`. */
    val ROLES: Map<String, String> = linkedMapOf(
        "谓语" to "predicate",
        "定语" to "attributive",
        "状语" to "adverbial",
        "补语" to "complement",
        "宾语" to "object",
        "主语" to "subject",
        "分句" to "stand-alone clause",
    )

    /** Port of `STARTER_IDIOMS` (shared/idioms/starter.ts) — kept identical by the parity test. */
    val STARTER: List<StarterIdiom> = listOf(
        StarterIdiom("画蛇添足", "huà shé tiān zú", "ruin something by adding what isn’t needed", "story"),
        StarterIdiom("守株待兔", "shǒu zhū dài tù", "wait idly for luck to strike again", "story"),
        StarterIdiom("自相矛盾", "zì xiāng máo dùn", "contradict oneself", "story"),
        StarterIdiom("亡羊补牢", "wáng yáng bǔ láo", "mend the pen after losing a sheep — better late than never", "story"),
        StarterIdiom("井底之蛙", "jǐng dǐ zhī wā", "a frog in a well — someone with a narrow view", "story"),
        StarterIdiom("塞翁失马", "sài wēng shī mǎ", "a blessing in disguise", "story"),
        StarterIdiom("对牛弹琴", "duì niú tán qín", "play the lute to a cow — talk to the wrong audience", "story"),
        StarterIdiom("刻舟求剑", "kè zhōu qiú jiàn", "act without seeing that things have changed", "story"),
        StarterIdiom("拔苗助长", "bá miáo zhù zhǎng", "spoil things by being too eager", "story"),
        StarterIdiom("掩耳盗铃", "yǎn ěr dào líng", "fool oneself", "story"),
        StarterIdiom("狐假虎威", "hú jiǎ hǔ wēi", "borrow someone’s power to bully others", "story"),
        StarterIdiom("叶公好龙", "yè gōng hào lóng", "claim to love what one actually fears", "story"),
        StarterIdiom("杯弓蛇影", "bēi gōng shé yǐng", "be frightened by one’s own imagination", "story"),
        StarterIdiom("胸有成竹", "xiōng yǒu chéng zhú", "have a plan already worked out", "story"),
        StarterIdiom("卧薪尝胆", "wò xīn cháng dǎn", "endure hardship to prepare for a comeback", "story"),
        StarterIdiom("破釜沉舟", "pò fǔ chén zhōu", "burn one’s bridges — no way back", "story"),
        StarterIdiom("纸上谈兵", "zhǐ shàng tán bīng", "theory with no practice — an armchair strategist", "story"),
        StarterIdiom("指鹿为马", "zhǐ lù wéi mǎ", "call a deer a horse — deliberately twist the truth", "story"),
        StarterIdiom("望梅止渴", "wàng méi zhǐ kě", "console oneself with false hopes", "story"),
        StarterIdiom("画龙点睛", "huà lóng diǎn jīng", "add the finishing touch", "story"),
        StarterIdiom("班门弄斧", "bān mén nòng fǔ", "show off in front of an expert", "story"),
        StarterIdiom("废寝忘食", "fèi qǐn wàng shí", "so absorbed one forgets to sleep and eat", "story"),
        StarterIdiom("熟能生巧", "shú néng shēng qiǎo", "practice makes perfect", "story"),
        StarterIdiom("半途而废", "bàn tú ér fèi", "give up halfway", "story"),
        StarterIdiom("入乡随俗", "rù xiāng suí sú", "when in Rome, do as the Romans do", "everyday"),
        StarterIdiom("九牛一毛", "jiǔ niú yì máo", "a drop in the ocean", "story"),
        StarterIdiom("一举两得", "yì jǔ liǎng dé", "kill two birds with one stone", "everyday"),
        StarterIdiom("一心一意", "yì xīn yí yì", "wholeheartedly", "everyday"),
        StarterIdiom("三心二意", "sān xīn èr yì", "half-hearted, unable to make up one’s mind", "everyday"),
        StarterIdiom("七上八下", "qī shàng bā xià", "on edge, very anxious", "everyday"),
        StarterIdiom("乱七八糟", "luàn qī bā zāo", "in a complete mess", "everyday"),
        StarterIdiom("一路顺风", "yí lù shùn fēng", "have a good trip", "everyday"),
        StarterIdiom("一模一样", "yì mú yí yàng", "exactly alike", "everyday"),
        StarterIdiom("一见钟情", "yí jiàn zhōng qíng", "love at first sight", "everyday"),
        StarterIdiom("千方百计", "qiān fāng bǎi jì", "by every possible means", "everyday"),
        StarterIdiom("五颜六色", "wǔ yán liù sè", "colourful, of every colour", "everyday"),
        StarterIdiom("人山人海", "rén shān rén hǎi", "huge crowds of people", "everyday"),
        StarterIdiom("不可思议", "bù kě sī yì", "unbelievable, inconceivable", "everyday"),
        StarterIdiom("不知不觉", "bù zhī bù jué", "without noticing, before one knows it", "everyday"),
        StarterIdiom("津津有味", "jīn jīn yǒu wèi", "with great relish", "everyday"),
        StarterIdiom("莫名其妙", "mò míng qí miào", "baffling, for no apparent reason", "everyday"),
        StarterIdiom("马到成功", "mǎ dào chéng gōng", "win success at once", "everyday"),
        StarterIdiom("东张西望", "dōng zhāng xī wàng", "look around in all directions", "everyday"),
        StarterIdiom("半信半疑", "bàn xìn bàn yí", "half believing, half doubting", "everyday"),
        StarterIdiom("名副其实", "míng fù qí shí", "living up to its name", "everyday"),
        StarterIdiom("井井有条", "jǐng jǐng yǒu tiáo", "in perfect order", "everyday"),
    )

    private val BY_HANZI = STARTER.associateBy { it.hanzi }

    /** Port of `starterIdiom`. */
    fun starter(hanzi: String): StarterIdiom? = BY_HANZI[hanzi]

    /** Port of `isStarterIdiom`. */
    fun isStarter(hanzi: String): Boolean = BY_HANZI.containsKey(hanzi)

    private fun isHan(cp: Int): Boolean = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN

    /** JS `\s` (Unicode mode). */
    private fun isJsSpace(cp: Int): Boolean = cp == 0x09 || cp == 0x0A || cp == 0x0B || cp == 0x0C || cp == 0x0D || cp == 0x20 ||
        cp == 0xA0 || cp == 0x1680 || cp in 0x2000..0x200A || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F ||
        cp == 0x3000 || cp == 0xFEFF

    /** `\p{P}` / `\p{S}`. */
    private fun isPunctOrSymbol(cp: Int): Boolean = when (Character.getType(cp).toByte()) {
        Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION, Character.END_PUNCTUATION,
        Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION, Character.OTHER_PUNCTUATION,
        Character.MATH_SYMBOL, Character.CURRENCY_SYMBOL, Character.MODIFIER_SYMBOL, Character.OTHER_SYMBOL,
        -> true
        else -> false
    }

    /** Port of `normalizeIdiomHanzi`: NFKC, whitespace / punctuation / symbols stripped, trad → simp. */
    fun normalize(text: String): String {
        val s = Normalizer.normalize(text, Normalizer.Form.NFKC)
        val out = StringBuilder()
        s.codePoints().forEach { cp -> if (!isJsSpace(cp) && !isPunctOrSymbol(cp)) out.appendCodePoint(cp) }
        return PictureHuntMatch.toSimplified(out.toString())
    }

    /** Port of `idiomKeyProblem`: why it can't be looked up (null = it can). */
    fun keyProblem(text: String): String? {
        val key = normalize(text)
        if (key.isEmpty()) return "Type a 成语 in Chinese characters"
        val cps = key.codePoints().toArray()
        if (cps.any { !isHan(it) }) return "Type the 成语 in Chinese characters only"
        if (cps.size < MIN_CHARS) return "A 成语 has at least $MIN_CHARS characters"
        if (cps.size > MAX_CHARS) return "That is longer than a 成语 (at most $MAX_CHARS characters)"
        return null
    }

    /** Port of `isIdiomShaped`: exactly four Han characters. */
    fun isShaped(text: String): Boolean {
        val cps = text.codePoints().toArray()
        return cps.size == 4 && cps.all { isHan(it) }
    }

    private val IDIOM_GLOSS = Regex("""\(idiom\)|\bidiom\b|\bchengyu\b""", RegexOption.IGNORE_CASE)

    /** Port of `showIdiomLink`: the explorer Word view's "📜 Story & usage" row. */
    fun showLink(hanzi: String, known: Boolean = false, senses: List<String> = emptyList()): Boolean {
        if (!isShaped(hanzi)) return false
        if (isStarter(hanzi) || known) return true
        return senses.any { IDIOM_GLOSS.containsMatchIn(it) }
    }

    /** Port of `idiomQuizScoreLine`. */
    fun quizScoreLine(correct: Int, total: Int): String {
        if (total <= 0) return ""
        if (correct == total) return "$correct / $total — 太棒了! You’ve got this one."
        if (correct * 2 >= total) return "$correct / $total — nearly there."
        return "$correct / $total — read the story once more and try again."
    }

    /** Port of `idiomRolesLabel`. */
    fun rolesLabel(roles: List<String>): String = roles.joinToString(", ") { r -> ROLES[r]?.let { "$r ($it)" } ?: r }

    /** Port of `idiomSentimentLabel`. */
    fun sentimentLabel(s: String): String = when (s) {
        "praise" -> "褒义 (approving)"
        "criticism" -> "贬义 (critical)"
        "neutral" -> "中性 (neutral)"
        else -> s
    }

    /** Port of `idiomRegisterLabel`. */
    fun registerLabel(r: String): String = when (r) {
        "written" -> "书面 (written)"
        "spoken" -> "口语 (spoken)"
        "both" -> "written and spoken"
        else -> r
    }

    /** Port of `idiomOriginLine`. */
    fun originLine(entry: IdiomEntry): String {
        val o = entry.origin
        val where = listOfNotNull(o.source?.takeIf { it.isNotEmpty() }, o.era?.takeIf { it.isNotEmpty() }).joinToString(", ")
        val summary = if (o.summary.isNotEmpty()) ": ${o.summary}" else ""
        return when {
            o.kind == "uncertain" -> "Origin uncertain$summary"
            o.kind == "modern" -> "A modern idiom$summary"
            where.isNotEmpty() -> "Origin: $where — ${o.summary}"
            else -> "Origin: ${o.summary}"
        }
    }

    /** Port of `idiomCardFields`: the card-standard card made from an entry. */
    fun cardFields(entry: IdiomEntry): IdiomCardFields {
        val literal = entry.literal.joinToString(" · ") { "${it.hanzi} (${it.pinyin}) ${it.gloss}" }
        val usageBits = listOf(rolesLabel(entry.usage.roles), sentimentLabel(entry.usage.sentiment), registerLabel(entry.usage.register))
            .filter { it.isNotEmpty() }.joinToString(" · ")
        val lines = mutableListOf(
            "$literal${if (entry.literal_english.isNotEmpty()) " — literally “${entry.literal_english}”" else ""}.",
            "Means: ${entry.meaning}",
            originLine(entry),
            "Usage: $usageBits${if (entry.usage.note.isNotEmpty()) ". ${entry.usage.note}" else ""}",
        )
        if (entry.usage.mistake.isNotEmpty()) lines += "Common mistake: ${entry.usage.mistake}"
        val first = entry.usage.examples.firstOrNull()
        return IdiomCardFields(
            hanzi = entry.hanzi,
            pinyin = entry.pinyin,
            english = entry.meaning,
            funFacts = lines.joinToString("\n"),
            sentenceClue = first?.hanzi,
            sentenceCluePinyin = first?.pinyin,
            sentenceClueTranslation = first?.english,
        )
    }
}
