package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer

/*
 * Port of shared/lesson/heardCheck.ts — what the ear can't tell (Nov 2026: Jerome heard 她责怪我, said "He blames me."
 * and got "≈ Nearly · Wrong subject"). A check where the learner only HEARD the Chinese (listen_translate: the
 * Sentence round's listen slot, a mini lesson's "Listen and translate") never counts against them he / she / it
 * (他 / 她 / 它 are one sound, tā), a tense the Chinese doesn't mark, or singular vs plural; [HeardCheck.forgive]
 * makes sure of it after the model, conservatively. Applied to every check the app receives or reads from its cache
 * (data/api/AnswerCheckApi.kt). Parity-tested by HeardCheckParityTest (parity/fixtures/heard-check.ts).
 */
object HeardCheck {
    /** Port of isHeardOnlyCheck(). */
    fun isHeardOnly(exerciseType: String): Boolean = exerciseType == "listen_translate"

    /** Port of heardChinese(): a meaning check's prompt, else the model answer. */
    fun heardChinese(input: AnswerCheckInput): String =
        if (LessonAnswerCheck.isMeaning(input.exerciseType, input.answer, input.modelAnswer)) input.promptEn else input.modelAnswer

    /** Port of TA_PRONOUNS. */
    const val TA_PRONOUNS = "他她它牠祂"
    private fun isTa(ch: String) = ch.length in 1..2 && TA_PRONOUNS.contains(ch)

    private fun cps(s: String): List<String> = LessonAnswers.chars(s)

    /** Port of hasTaPronoun(). */
    fun hasTaPronoun(zh: String): Boolean = cps(zh).any { isTa(it) }

    /** Port of taKey(): checkKey with 她 / 它 / 牠 / 祂 read as 他. */
    fun taKey(s: String): String = cps(LessonAnswerCheck.checkKey(s)).joinToString("") { if (isTa(it)) "他" else it }

    /** Port of UNHEARD_TENSE_MARKERS. */
    val TENSE_MARKERS: List<String> = listOf(
        "了", "过", "着", "在", "会", "将", "要", "没", "刚", "已", "曾", "正", "昨",
        "明天", "明年", "明早", "明晚", "前天", "后天", "前年", "后年", "去年", "上个", "下个", "上周", "下周", "上星期", "下星期",
        "上次", "下次", "以前", "以后", "之前", "之后", "将来", "未来", "马上", "快要", "就要", "待会", "等会", "从前", "当时",
        "那时", "后来", "早就", "今后",
    )

    private fun nfkc(s: String) = Normalizer.normalize(s, Normalizer.Form.NFKC)

    /** Port of marksTense(). */
    fun marksTense(zh: String): Boolean {
        val text = nfkc(zh)
        return TENSE_MARKERS.any { text.contains(it) }
    }

    // ============ English compared by ear ============

    private val ARTICLES = setOf("a", "an", "the")
    private val PRONOUN_KEY = linkedMapOf(
        "he" to "ta", "she" to "ta", "it" to "ta", "him" to "ta", "her" to "ta", "his" to "ta", "hers" to "ta", "its" to "ta",
        "himself" to "taself", "herself" to "taself", "itself" to "taself",
    )

    /** Port of THIRD_PERSON_WORDS. */
    val THIRD_PERSON_WORDS: List<String> = PRONOUN_KEY.keys.toList()
    private val AUX_DROPPED = setOf("will", "shall", "do", "does", "did")
    private val AUX_BE = setOf("am", "is", "are", "was", "were", "be", "been", "being")
    private val AUX_HAVE = setOf("has", "have", "had")
    private val S_IS = setOf("he", "she", "it", "that", "there", "what", "who", "here", "where")

    private val IRREGULAR_VERBS: List<List<String>> = listOf(
        listOf("go", "went", "gone"), listOf("see", "saw", "seen"), listOf("eat", "ate", "eaten"), listOf("come", "came"), listOf("take", "took", "taken"),
        listOf("give", "gave", "given"), listOf("say", "said"), listOf("tell", "told"), listOf("buy", "bought"), listOf("think", "thought"), listOf("make", "made"),
        listOf("find", "found"), listOf("get", "got", "gotten"), listOf("leave", "left"), listOf("meet", "met"), listOf("run", "ran"), listOf("write", "wrote", "written"),
        listOf("speak", "spoke", "spoken"), listOf("feel", "felt"), listOf("know", "knew", "known"), listOf("sit", "sat"), listOf("stand", "stood"),
        listOf("begin", "began", "begun"), listOf("bring", "brought"), listOf("hear", "heard"), listOf("keep", "kept"), listOf("sleep", "slept"), listOf("lose", "lost"),
        listOf("pay", "paid"), listOf("send", "sent"), listOf("spend", "spent"), listOf("teach", "taught"), listOf("understand", "understood"), listOf("win", "won"),
        listOf("drink", "drank", "drunk"), listOf("forget", "forgot", "forgotten"), listOf("fall", "fell", "fallen"), listOf("break", "broke", "broken"),
        listOf("choose", "chose", "chosen"), listOf("drive", "drove", "driven"), listOf("fly", "flew", "flown"), listOf("grow", "grew", "grown"),
        listOf("throw", "threw", "thrown"), listOf("wear", "wore", "worn"), listOf("catch", "caught"), listOf("fight", "fought"), listOf("hold", "held"),
        listOf("lend", "lent"), listOf("build", "built"), listOf("sell", "sold"), listOf("sing", "sang", "sung"), listOf("swim", "swam", "swum"),
        listOf("ride", "rode", "ridden"), listOf("wake", "woke", "woken"), listOf("steal", "stole", "stolen"), listOf("hide", "hid", "hidden"),
        listOf("draw", "drew", "drawn"), listOf("feed", "fed"), listOf("lead", "led"), listOf("mean", "meant"), listOf("do", "did", "done"),
        listOf("be", "was", "were", "been"), listOf("have", "had"),
    )
    private val EXTRA_FORMS = mapOf(
        "goes" to "go", "going" to "go", "does" to "do", "doing" to "do", "has" to "have", "having" to "have",
        "am" to "be", "is" to "be", "are" to "be", "being" to "be", "sees" to "see", "seeing" to "see",
    )
    private val PAST_FORMS: Set<String> = IRREGULAR_VERBS.flatMap { it.drop(1) }.toSet()
    private val UNDOUBLE = setOf('b', 'd', 'g', 'm', 'n', 'p', 'r', 't')
    private val ES_PLURAL = Regex("(?:s|x|z|ch|sh)es$")
    private val NOT_S_PLURAL = Regex("(?:ss|us|is)$")

    private fun undouble(s: String): String {
        val n = s.length
        return if (n >= 4 && s[n - 1] == s[n - 2] && s[n - 1] in UNDOUBLE) s.dropLast(1) else s
    }

    /** Port of pluralStem(). */
    fun pluralStem(t: String): String {
        if (t.length <= 3) return t
        if (t.endsWith("ies")) return t.dropLast(3) + "y"
        if (ES_PLURAL.containsMatchIn(t)) return t.dropLast(2)
        if (t.endsWith("s") && !NOT_S_PLURAL.containsMatchIn(t)) return t.dropLast(1)
        return t
    }

    private fun regularStem(t: String): String {
        if (t.length <= 3) return t
        var s = when {
            t.endsWith("ied") && t.length > 4 -> t.dropLast(3) + "y"
            t.endsWith("ing") && t.length > 5 -> undouble(t.dropLast(3))
            t.endsWith("ed") && t.length > 4 -> undouble(t.dropLast(2))
            else -> pluralStem(t)
        }
        if (s.length > 3 && s.endsWith("e")) s = s.dropLast(1)
        return s
    }

    private val IRREGULAR_STEM: Map<String, String> = buildMap {
        for (v in IRREGULAR_VERBS) for (f in v.drop(1)) put(f, regularStem(v[0]))
        for ((form, base) in EXTRA_FORMS) put(form, regularStem(base))
    }

    /** Port of tenseStem(). */
    fun tenseStem(t: String): String = IRREGULAR_STEM[t] ?: regularStem(t)

    private fun verbish(t: String): Boolean =
        (t.endsWith("ing") && t.length > 4) || (t.endsWith("ed") && t.length > 3) || t in PAST_FORMS

    private fun expand(token: String): List<String> {
        when (token) {
            "won't" -> return listOf("will", "not")
            "can't", "cannot" -> return listOf("can", "not")
            "shan't" -> return listOf("shall", "not")
            "ain't" -> return listOf("is", "not")
        }
        fun cut(n: Int, word: String) = listOf(token.dropLast(n), word)
        if (token.endsWith("n't")) return cut(3, "not")
        if (token.endsWith("'ll")) return cut(3, "will")
        if (token.endsWith("'re")) return cut(3, "are")
        if (token.endsWith("'ve")) return cut(3, "have")
        if (token.endsWith("'m")) return cut(2, "am")
        if (token.endsWith("'d")) return cut(2, "d")
        if (token.endsWith("'s") && token.dropLast(2) in S_IS) return cut(2, "is")
        return listOf(token.replace("'", ""))
    }

    private val APOSTROPHES = Regex("[’‘`]")
    private val WORD_SPLIT = Regex("[^\\p{L}\\p{N}']+")

    /** Port of englishWords(). */
    fun englishWords(text: String): List<String> {
        val s = APOSTROPHES.replace(nfkc(text).lowercase(), "'")
        return WORD_SPLIT.split(s).filter { it.isNotEmpty() }.flatMap { expand(it) }.filter { it.isNotEmpty() && it != "'" }
    }

    /** Port of heardMeaningKey(). */
    fun meaningKey(text: String, pronouns: Boolean, tense: Boolean): String {
        var toks = englishWords(text).filter { it !in ARTICLES }
        if (pronouns) toks = toks.map { PRONOUN_KEY[it] ?: it }
        if (tense) {
            val out = mutableListOf<String>()
            toks.forEachIndexed { i, t ->
                if (t in AUX_DROPPED) return@forEachIndexed
                if (t in AUX_BE || t in AUX_HAVE) {
                    var j = i + 1
                    while (j < toks.size && toks[j] == "not") j++
                    if (j < toks.size && verbish(toks[j])) return@forEachIndexed
                    out.add(if (t in AUX_BE) "be" else "have")
                    return@forEachIndexed
                }
                out.add(t)
            }
            toks = out
        }
        return toks.joinToString(" ") { if (tense) tenseStem(it) else pluralStem(it) }
    }

    // ============ The check's own lines ============

    private fun w(words: String) = "(?<![A-Za-z0-9_])(?:$words)(?![A-Za-z0-9_])"
    private val THIRD_RE = Regex(w(THIRD_PERSON_WORDS.joinToString("|")), RegexOption.IGNORE_CASE)
    private val FIRST_SECOND = Regex(w("i|me|my|mine|myself|you|your|yours|yourself|we|us|our|ours|they|them|their|theirs"), RegexOption.IGNORE_CASE)
    private val GENDER_CUE = Regex(w("gender|genders|pronoun|pronouns|male|female|masculine|feminine|man|woman|animate|inanimate"), RegexOption.IGNORE_CASE)
    private val TENSE_CUE = Regex(w("tense|tenses|past|present|future|aspect"), RegexOption.IGNORE_CASE)
    private val OTHER_ISSUE = Regex(
        w(
            listOf(
                "negat[a-z]*", "never", "opposite", "missed", "missing", "left out", "leave out", "forgot", "forgotten", "didn't", "doesn't",
                "don't", "isn't", "wasn't", "won't", "did not", "does not", "do not", "no longer", "verb", "action", "place", "where", "when",
                "time", "number", "plural", "singular", "swap[a-z]*", "revers[a-z]*", "order", "who did",
            ).joinToString("|"),
        ),
        RegexOption.IGNORE_CASE,
    )
    private val QUOTED = Regex("\"([^\"]*)\"|“([^”]*)”")

    private data class Quoted(val quoted: List<String>, val rest: String)

    private fun quotedParts(text: String): Quoted {
        val quoted = mutableListOf<String>()
        val rest = QUOTED.replace(text) { m ->
            quoted.add(m.groups[1]?.value ?: m.groups[2]?.value ?: "")
            " "
        }
        return Quoted(quoted, rest)
    }

    private fun isHan(ch: String) = Character.UnicodeScript.of(ch.codePointAt(0)) == Character.UnicodeScript.HAN
    private fun hanChars(s: String): List<String> = cps(s).filter { isHan(it) }

    /** Port of unheardPronounLine(). */
    fun pronounLine(text: String, quote: String? = null): Boolean {
        val line = APOSTROPHES.replace(text, "'")
        val han = hanChars(line + (quote ?: ""))
        if (!han.all { isTa(it) || it == "们" }) return false
        val (quoted, rest) = quotedParts(line)
        if (FIRST_SECOND.containsMatchIn(rest) || OTHER_ISSUE.containsMatchIn(rest) || TENSE_CUE.containsMatchIn(rest)) return false
        for (q in quoted) {
            if (!englishWords(q).all { t -> t in THIRD_PERSON_WORDS || cps(t).all { isTa(it) || it == "们" } }) return false
        }
        val thirds = THIRD_RE.findAll(line).map { it.value.lowercase() }.toSet()
        val tas = han.filter { isTa(it) }.toSet()
        return GENDER_CUE.containsMatchIn(rest) || thirds.size >= 2 || tas.size >= 2 || (tas.isNotEmpty() && thirds.isNotEmpty())
    }

    /** Port of unheardTenseLine(). */
    fun tenseLine(text: String, quote: String? = null): Boolean {
        val line = APOSTROPHES.replace(text, "'")
        if (LessonAnswerCheck.hasHan(line) || LessonAnswerCheck.hasHan(quote ?: "")) return false
        val (quoted, rest) = quotedParts(line)
        if (FIRST_SECOND.containsMatchIn(rest) || OTHER_ISSUE.containsMatchIn(rest) || GENDER_CUE.containsMatchIn(rest) || THIRD_RE.containsMatchIn(rest)) return false
        val keys = quoted.map { meaningKey(it, pronouns = true, tense = true) }.toSet()
        if (keys.size > 1) return false
        val plain = quoted.map { meaningKey(it, pronouns = true, tense = false) }.toSet()
        return TENSE_CUE.containsMatchIn(rest) || (quoted.size >= 2 && plain.size >= 2)
    }

    // ============ The rule ============

    private val NEGATIONS = setOf("not", "no", "never", "nobody", "nothing", "none", "neither", "nor", "nowhere")
    private val PERSONS = mapOf(
        "i" to "i", "me" to "i", "my" to "i", "mine" to "i", "myself" to "i", "you" to "you", "your" to "you", "yours" to "you", "yourself" to "you", "yourselves" to "you",
        "we" to "we", "us" to "we", "our" to "we", "ours" to "we", "ourselves" to "we", "they" to "they", "them" to "they", "their" to "they", "theirs" to "they", "themselves" to "they",
    )

    /** Port of sameRolesAndPolarity(). */
    fun sameRolesAndPolarity(answer: String, reference: String): Boolean {
        fun facts(s: String): Pair<Int, String> {
            val words = englishWords(s)
            return words.count { it in NEGATIONS } to words.mapNotNull { PERSONS[it] }.distinct().sorted().joinToString(",")
        }
        return facts(answer) == facts(reference)
    }

    const val PRONOUN_HEADLINE = "Right — by ear, tā can be he, she or it."
    const val TENSE_HEADLINE = "Right — the Chinese doesn't mark the tense here."
    const val BOTH_HEADLINE = "Right — tā can be he, she or it, and no tense is marked."
    const val RIGHT_HEADLINE = "Right — you understood it."
    const val TA_HEADLINE = "Right — 他, 她 and 它 all sound tā, so any of them works."

    /** Port of heardHeadline(). */
    fun headline(pronoun: Boolean, tense: Boolean): String = when {
        pronoun && tense -> BOTH_HEADLINE
        pronoun -> PRONOUN_HEADLINE
        tense -> TENSE_HEADLINE
        else -> RIGHT_HEADLINE
    }

    private fun upgraded(headline: String) =
        AnswerCheck(verdict = "correct", headline = headline, corrected = "", correctedPinyin = "", tips = emptyList(), suggested = "got_it")

    /** Port of forgiveUnheard(). */
    fun forgive(check: AnswerCheck, input: AnswerCheckInput): AnswerCheck {
        if (!isHeardOnly(input.exerciseType)) return check
        val zh = heardChinese(input)
        val pronouns = hasTaPronoun(zh)
        val meaning = LessonAnswerCheck.isMeaning(input.exerciseType, input.answer, input.modelAnswer)
        val tense = meaning && LessonAnswerCheck.hasHan(zh) && !marksTense(zh)
        if (!pronouns && !tense) return check
        fun forgivenLine(text: String, quote: String? = null) = (pronouns && pronounLine(text, quote)) || (tense && tenseLine(text, quote))
        val good = check.verdict == "correct" || check.verdict == "acceptable"
        if (good) {
            val tips = check.tips.filter { !forgivenLine(it.text, it.quote) }
            val headlineForgiven = forgivenLine(check.headline)
            if (tips.size == check.tips.size && !headlineForgiven) return check
            val headline = when {
                !headlineForgiven -> check.headline
                meaning -> headline(pronouns && pronounLine(check.headline), tense && tenseLine(check.headline))
                else -> TA_HEADLINE
            }
            if (headlineForgiven && tips.isEmpty()) return upgraded(headline)
            return check.copy(headline = headline, tips = tips)
        }
        if (meaning) {
            val a = meaningKey(input.answer, pronouns, tense)
            val m = meaningKey(input.modelAnswer, pronouns, tense)
            if (a.isNotEmpty() && a == m) {
                val pronounMattered = pronouns && meaningKey(input.answer, false, tense) != meaningKey(input.modelAnswer, false, tense)
                val tenseMattered = tense && meaningKey(input.answer, pronouns, false) != meaningKey(input.modelAnswer, pronouns, false)
                return upgraded(headline(pronounMattered, tenseMattered))
            }
            if (check.verdict != "almost" || !sameRolesAndPolarity(input.answer, input.modelAnswer)) return check
            val lines = listOf(check.headline to null) + check.tips.map { it.text to it.quote }
            if (!lines.all { (t, q) -> forgivenLine(t, q) }) return check
            val aboutPronoun = pronouns && lines.any { (t, q) -> pronounLine(t, q) }
            val aboutTense = tense && lines.any { (t, q) -> tenseLine(t, q) }
            return upgraded(headline(aboutPronoun, aboutTense))
        }
        // Answered in Chinese: 他 / 她 / 它 are one sound.
        val mine = taKey(input.answer)
        if (mine.isNotEmpty() && mine == taKey(input.modelAnswer)) return upgraded(TA_HEADLINE)
        if (check.corrected.isNotEmpty() && taKey(check.corrected) == mine && check.tips.all { pronounLine(it.text, it.quote) }) {
            return upgraded(TA_HEADLINE)
        }
        return check
    }
}
