package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer

/*
 * Port of shared/import (the "Paste a list" word importer): pinyin.ts, parse.ts and plan.ts,
 * parity-tested in ImportParityTest against the TypeScript (parity/fixtures/import.ts).
 *
 * JS regex semantics are spelled out: `\s` is JS whitespace ([JS_S]), `\d` is ASCII, `\b` is
 * an ASCII word boundary, `/i` folds only ASCII + ü/Ü here, `String.replace(string, …)`
 * replaces the FIRST occurrence and `split` keeps trailing empty strings (Kotlin's does too).
 */

/** JS `\s` as a character class body. */
private const val WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
private const val JS_S = "[$WS]"
private const val JS_NOT_S = "[^$WS]"

private fun nfc(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFC)
private fun jsTrim(s: String): String = NoteSearch.jsTrim(s)
private fun lower(s: String): String = s.lowercase(java.util.Locale.ROOT)
private fun upper(s: String): String = s.uppercase(java.util.Locale.ROOT)

/** Port of shared/import/pinyin.ts. */
object ImportPinyin {
    private val TONE_MARKS = mapOf(
        'a' to listOf('ā', 'á', 'ǎ', 'à'),
        'e' to listOf('ē', 'é', 'ě', 'è'),
        'i' to listOf('ī', 'í', 'ǐ', 'ì'),
        'o' to listOf('ō', 'ó', 'ǒ', 'ò'),
        'u' to listOf('ū', 'ú', 'ǔ', 'ù'),
        'ü' to listOf('ǖ', 'ǘ', 'ǚ', 'ǜ'),
    )
    private val MARKED_TO_BASE: Map<Char, Char> = TONE_MARKS.flatMap { (base, marks) -> marks.map { it to base } }.toMap()
    private const val MARKED = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ"

    private val INITIALS = listOf("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w")
    private val FINAL_SET = setOf(
        "a", "o", "e", "i", "u", "ü", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "er",
        "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong",
        "ua", "uo", "uai", "ui", "uan", "un", "uang", "ueng",
        "üe", "üan", "ün",
    )
    private const val SYLLABLE_MAX = 7

    /** `stripTones`: tone-marked vowels → plain, tone digits dropped. */
    fun stripTones(text: String): String {
        val sb = StringBuilder()
        for (ch in nfc(text)) {
            if (ch in '1'..'5') continue
            sb.append(MARKED_TO_BASE[ch] ?: ch)
        }
        return sb.toString()
    }

    private val MARKED_RE = Regex("[$MARKED]")
    private val DIGIT_TONE = Regex("[a-zA-ZüÜ][1-5](?![A-Za-z0-9_])")

    /** `hasToneInfo`: tone marks, or a tone digit ending a syllable. */
    fun hasToneInfo(text: String): Boolean = MARKED_RE.containsMatchIn(nfc(text)) || DIGIT_TONE.containsMatchIn(text)

    private fun isSyllable(plain: String): Boolean {
        val s = lower(plain).removePrefix("'")
        if (s.isEmpty()) return false
        val core = if (s.endsWith("r") && s.length > 2 && s !in FINAL_SET && !s.endsWith("er")) s.dropLast(1) else s
        for (ini in INITIALS) {
            if (core.startsWith(ini) && core.substring(ini.length) in FINAL_SET) return true
        }
        return core in FINAL_SET || core == "ê" || core == "r"
    }

    private val SEG_OK = Regex("^[a-zü']+$")

    /** `segmentPinyin`: greedy longest syllables with backtracking; null when it isn't pinyin. */
    fun segmentPinyin(run: String): List<String>? {
        val s = lower(stripTones(run)).replace('v', 'ü')
        if (!SEG_OK.matches(s)) return null
        val memo = HashMap<Int, List<String>?>()
        fun go(i: Int): List<String>? {
            if (i == s.length) return emptyList()
            if (memo.containsKey(i)) return memo[i]
            var best: List<String>? = null
            val start = if (s[i] == '\'') i + 1 else i
            var len = minOf(SYLLABLE_MAX, s.length - start)
            while (len >= 1) {
                val piece = s.substring(start, start + len)
                if (isSyllable(piece)) {
                    val rest = go(start + len)
                    if (rest != null) {
                        best = listOf(piece) + rest
                        break
                    }
                }
                len--
            }
            memo[i] = best
            return best
        }
        return go(0)
    }

    private val TOKEN_SPLIT = Regex("[$WS\\-·]+")
    private val TOKEN_PUNCT = Regex("[,.!?;:，。！？；：()（）\"“”]")

    /** `pinyinSyllableCount`: every token must segment into syllables; the total, or null. */
    fun syllableCount(text: String): Int? {
        val tokens = jsTrim(text).split(TOKEN_SPLIT).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return null
        var count = 0
        for (t in tokens) {
            val seg = segmentPinyin(TOKEN_PUNCT.replace(t, "")) ?: return null
            count += seg.size
        }
        return count
    }

    private fun markSyllable(plain: String, tone: Int): String {
        if (tone < 1 || tone > 4) return plain
        var i = plain.indexOf('a')
        if (i == -1) i = plain.indexOf('e')
        if (i == -1) i = if (plain.indexOf("ou") == -1) -1 else plain.indexOf('o')
        if (i == -1) {
            for (k in plain.length - 1 downTo 0) {
                if (plain[k] in "aeiouü") {
                    i = k
                    break
                }
            }
        }
        if (i == -1) return plain
        return plain.substring(0, i) + TONE_MARKS.getValue(plain[i])[tone - 1] + plain.substring(i + 1)
    }

    private val HAS_DIGIT_TONE = Regex("[a-zA-ZüÜ][1-5]")
    private val RUN_WITH_DIGIT = Regex("([a-zA-ZüÜvV]+)([1-5])")

    /** `toneNumbersToMarks`: "ni3 hao3" → "nǐ hǎo", "lv4" → "lǜ"; other text only NFC'd. */
    fun toneNumbersToMarks(text: String): String {
        val n = nfc(text)
        if (!HAS_DIGIT_TONE.containsMatchIn(n)) return n
        return RUN_WITH_DIGIT.replace(n) { m ->
            val tone = m.groupValues[2].toInt()
            val plain = m.groupValues[1].replace('v', 'ü').replace('V', 'Ü')
            val seg = segmentPinyin(plain)
            if (seg.isNullOrEmpty()) return@replace plain
            val last = seg.last()
            val head = plain.substring(0, plain.length - last.length)
            val c = plain[head.length].toString()
            val isUpper = c == upper(c) && c != lower(c)
            val marked = markSyllable(lower(last), tone)
            head + if (isUpper) upper(marked.substring(0, 1)) + marked.substring(1) else marked
        }
    }

    private val WS_RUN = Regex("$JS_S+")

    /** `normalizePinyin`: trim, NFC, collapse spaces, tone digits → marks. */
    fun normalize(text: String): String = jsTrim(WS_RUN.replace(toneNumbersToMarks(text), " "))
}

/** Port of shared/import/parse.ts `parseWordList`. */
object WordListParser {
    enum class ColumnSeparator(val wire: String) { AUTO("auto"), TAB("tab"), COMMA("comma"), PIPE("pipe"), COLON("colon"), SPACE("space"), CUSTOM("custom") }
    enum class RowSeparator(val wire: String) { AUTO("auto"), NEWLINE("newline"), SEMICOLON("semicolon") }
    enum class Role(val wire: String) { HANZI("hanzi"), PINYIN("pinyin"), ENGLISH("english"), SENTENCE("sentence"), NOTES("notes"), IGNORE("ignore") }

    const val NO_CHINESE = "no_chinese"
    const val DUPLICATE_IN_PASTE = "duplicate_in_paste"

    data class Row(
        val index: Int,
        val raw: String,
        val hanzi: String,
        val pinyin: String,
        val english: String,
        val sentence: String,
        val notes: String,
        val problems: List<String>,
        /** Pinyin / translation for [sentence] when something supplied them (Claude, on-device pinyin). */
        val sentencePinyin: String? = null,
        val sentenceTranslation: String? = null,
    )

    data class Detected(val columnSeparator: ColumnSeparator, val rowSeparator: RowSeparator, val columns: List<Role>, val headerDropped: Boolean)

    data class Result(val rows: List<Row>, val detected: Detected)

    private val HAN = Regex("\\p{IsHan}")
    private val HAN_ALL = Regex("\\p{IsHan}")
    private val HAN_RUN = Regex("[\\p{IsHan}〇々]+")
    private val BULLET = Regex("^$JS_S*(?:[-•*·▪◦]|[0-9]{1,3}[.、)）:]|\\([0-9]{1,3}\\)|[①-⑳])$JS_S*")
    private val HEADER_WORDS = Regex(
        "^(hanzi|han$JS_S?zi|chinese|characters?|simplified|traditional|汉字|漢字|中文|词语|生词|单词|词|word|words|term|pinyin|拼音|english|meaning|definition|translation|意思|英文|英语|释义|sentence|example|例句|例子|notes?|备注|笔记|fun$JS_S?facts?)$",
        RegexOption.IGNORE_CASE,
    )
    private val ZW = Regex("[\\u200B-\\u200D\\uFEFF]")
    private val WS_RUN = Regex("$JS_S+")
    private val NORM_DROP = Regex("[$WS\\u200B-\\u200D\\uFEFF]")
    private val NORM_PUNCT = Regex("[。，、！？：；“”‘’（）()\\[\\]【】《》.,!?;:'\"-]")

    /** `normalizeHanzi`: the matching key (no spaces, no punctuation). */
    fun normalizeHanzi(text: String): String = NORM_PUNCT.replace(NORM_DROP.replace(nfc(text), ""), "")

    private fun clean(text: String): String =
        jsTrim(WS_RUN.replace(ZW.replace(nfc(text), "").replace('　', ' '), " "))

    private val NOT_LETTER = Regex("[${WS}0-9\\p{P}]")

    private fun hanShare(text: String): Double {
        val letters = NOT_LETTER.replace(text, "")
        if (letters.isEmpty()) return 0.0
        val han = HAN_ALL.findAll(letters).count()
        return han.toDouble() / letters.length
    }

    /** `classifyCell`: a cell's role by its script; [hanziLength] lets toneless pinyin count syllables. */
    fun classifyCell(cell: String, hanziLength: Int? = null): Role {
        val text = clean(cell)
        if (text.isEmpty()) return Role.IGNORE
        val share = hanShare(text)
        if (share >= 0.5) return Role.HANZI
        if (share > 0) return Role.ENGLISH
        val syllables = ImportPinyin.syllableCount(text)
        if (syllables != null) {
            if (ImportPinyin.hasToneInfo(text)) return Role.PINYIN
            if (hanziLength != null && syllables == hanziLength && hanziLength > 0) return Role.PINYIN
        }
        return Role.ENGLISH
    }

    private val NEWLINE = Regex("\\r?\\n")
    private val SEMI = Regex("[;；]")

    private fun detectRowSeparator(text: String, wanted: RowSeparator): RowSeparator {
        if (wanted != RowSeparator.AUTO) return wanted
        val lines = text.split(NEWLINE).filter { jsTrim(it).isNotEmpty() }
        if (lines.size <= 1 && SEMI.containsMatchIn(text)) return RowSeparator.SEMICOLON
        return RowSeparator.NEWLINE
    }

    private fun splitRows(text: String, sep: RowSeparator): List<String> {
        val parts = if (sep == RowSeparator.SEMICOLON) text.split(SEMI) else text.split(NEWLINE)
        return parts.map { jsTrim(BULLET.replaceFirst(it, "")) }.filter { it.isNotEmpty() }
    }

    private val HAS_TAB = Regex("\\t")
    private val HAS_PIPE = Regex("\\|")
    private val HAS_COMMA = Regex("[,，]")
    private val HAS_COLON = Regex("$JS_S[-—–]$JS_S|[：]|(?<=\\p{IsHan})$JS_S*:$JS_S*")
    private val COLON_SPLIT = Regex("$JS_S[-—–]$JS_S|[：]|(?<=\\p{IsHan})$JS_S*:$JS_S*|(?<=$JS_NOT_S)$JS_S*:$JS_S+")

    private fun detectColumnSeparator(lines: List<String>, wanted: ColumnSeparator): ColumnSeparator {
        if (wanted != ColumnSeparator.AUTO) return wanted
        val n = if (lines.isEmpty()) 1.0 else lines.size.toDouble()
        fun share(re: Regex) = lines.count { re.containsMatchIn(it) } / n
        if (share(HAS_TAB) >= 0.5) return ColumnSeparator.TAB
        if (share(HAS_PIPE) >= 0.5) return ColumnSeparator.PIPE
        if (share(HAS_COMMA) >= 0.6) return ColumnSeparator.COMMA
        if (share(HAS_COLON) >= 0.6) return ColumnSeparator.COLON
        return ColumnSeparator.SPACE
    }

    private fun splitCells(line: String, sep: ColumnSeparator, custom: String): List<String> = when (sep) {
        ColumnSeparator.TAB -> line.split("\t")
        ColumnSeparator.PIPE -> line.split("|")
        ColumnSeparator.COMMA -> line.split(HAS_COMMA)
        ColumnSeparator.COLON -> line.split(COLON_SPLIT)
        ColumnSeparator.CUSTOM -> if (custom.isNotEmpty()) line.split(custom) else listOf(line)
        ColumnSeparator.SPACE, ColumnSeparator.AUTO -> scriptSplit(line)
    }

    private val BRACKETS = Regex("[()（）\\[\\]【】]")
    private val CJK_PUNCT = Regex("[。，！？：；]")

    private fun replaceFirstLiteral(s: String, find: String, with: String): String {
        val i = s.indexOf(find)
        return if (i < 0) s else s.substring(0, i) + with + s.substring(i + find.length)
    }

    /** `scriptSplit`: no separator — cut at script boundaries (word · pinyin · English · sentence). */
    private fun scriptSplit(line: String): List<String> {
        val text = BRACKETS.replace(clean(line), " ")
        val hanRuns = HAN_RUN.findAll(text).map { it.value }.toList()
        val word = hanRuns.firstOrNull() ?: return listOf(text)
        val rest = jsTrim(replaceFirstLiteral(text, word, " "))
        val sentence = hanRuns.drop(1).filter { it.length > 1 }
        var latin = rest
        for (s in hanRuns.drop(1)) latin = replaceFirstLiteral(latin, s, " ")
        latin = jsTrim(WS_RUN.replace(CJK_PUNCT.replace(latin, " "), " "))
        val tokens = if (latin.isNotEmpty()) latin.split(" ") else emptyList()
        val pinyinTokens = ArrayList<String>()
        var syllables = 0
        var i = 0
        while (i < tokens.size && syllables < word.length) {
            val t = tokens[i]
            val count = ImportPinyin.syllableCount(t) ?: break
            if (!ImportPinyin.hasToneInfo(t) && syllables + count > word.length) break
            pinyinTokens += t
            syllables += count
            i++
        }
        val pinyinOk = pinyinTokens.isNotEmpty() && (pinyinTokens.any(ImportPinyin::hasToneInfo) || syllables == word.length)
        val pinyin = if (pinyinOk) pinyinTokens.joinToString(" ") else ""
        val english = (if (pinyinOk) tokens.drop(i) else tokens).joinToString(" ")
        val cells = mutableListOf(word, pinyin, english)
        if (sentence.isNotEmpty()) cells += sentence.joinToString("")
        return cells
    }

    private fun isHeader(cells: List<String>): Boolean {
        val named = cells.map(::clean).filter { it.isNotEmpty() }
        if (named.isEmpty()) return false
        val matches = named.count { HEADER_WORDS.matches(it) }
        return matches >= maxOf(1, Math.ceil(named.size * 0.6).toInt()) && named.none { HAN.containsMatchIn(it) && !HEADER_WORDS.matches(it) }
    }

    /** `voteColumns`: a role per column over the rows with the modal cell count. */
    private fun voteColumns(rowsCells: List<List<String>>): List<Role> {
        val counts = LinkedHashMap<Int, Int>()
        for (cells in rowsCells) counts[cells.size] = (counts[cells.size] ?: 0) + 1
        var width = 0
        var best = 0
        for ((w, c) in counts) if (c > best || (c == best && w > width)) { width = w; best = c }
        if (width < 2 || best < maxOf(1.0, rowsCells.size * 0.5)) return emptyList()
        val aligned = rowsCells.filter { it.size == width }
        val votes = List(width) { LinkedHashMap<Role, Int>() }
        for (cells in aligned) {
            val hanIdx = cells.indexOfFirst { classifyCell(it) == Role.HANZI }
            val hanziLength = if (hanIdx >= 0) normalizeHanzi(cells[hanIdx]).length else null
            cells.forEachIndexed { i, cell ->
                val role = classifyCell(cell, hanziLength)
                if (role != Role.IGNORE) votes[i][role] = (votes[i][role] ?: 0) + 1
            }
        }
        val roles = votes.map { v ->
            var role = Role.IGNORE
            var n = 0
            for ((r, c) in v) if (c > n) { role = r; n = c }
            role
        }
        val seen = HashSet<Role>()
        return roles.map { r ->
            when {
                r == Role.IGNORE -> r
                r in seen -> when (r) {
                    Role.HANZI -> if (Role.SENTENCE in seen) Role.NOTES else { seen += Role.SENTENCE; Role.SENTENCE }
                    Role.ENGLISH, Role.PINYIN -> if (Role.NOTES in seen) Role.IGNORE else { seen += Role.NOTES; Role.NOTES }
                    else -> Role.IGNORE
                }
                else -> { seen += r; r }
            }
        }
    }

    private fun emptyFields(): MutableMap<Role, String> = Role.entries.associateWithTo(LinkedHashMap()) { "" }

    private fun assignByScript(cells: List<String>): MutableMap<Role, String> {
        val out = emptyFields()
        val cleaned = cells.map(::clean).filter { it.isNotEmpty() }
        val hanIdx = cleaned.indexOfFirst { classifyCell(it) == Role.HANZI }
        val hanziLength = if (hanIdx >= 0) normalizeHanzi(cleaned[hanIdx]).length else null
        for (cell in cleaned) {
            var role = classifyCell(cell, hanziLength)
            if (role == Role.HANZI && out.getValue(Role.HANZI).isNotEmpty()) role = if (out.getValue(Role.SENTENCE).isNotEmpty()) Role.NOTES else Role.SENTENCE
            if (role == Role.PINYIN && out.getValue(Role.PINYIN).isNotEmpty()) role = Role.ENGLISH
            if (role == Role.ENGLISH && out.getValue(Role.ENGLISH).isNotEmpty()) role = Role.NOTES
            if (role == Role.IGNORE) continue
            val cur = out.getValue(role)
            out[role] = if (cur.isNotEmpty()) "$cur $cell" else cell
        }
        return out
    }

    private fun finishRow(index: Int, raw: String, f: Map<Role, String>): Row {
        val problems = ArrayList<String>()
        val hanzi = clean(f.getValue(Role.HANZI))
        if (hanzi.isEmpty() || !HAN.containsMatchIn(hanzi)) problems += NO_CHINESE
        return Row(
            index, raw, hanzi, ImportPinyin.normalize(f.getValue(Role.PINYIN)), clean(f.getValue(Role.ENGLISH)),
            clean(f.getValue(Role.SENTENCE)), clean(f.getValue(Role.NOTES)), problems,
        )
    }

    /** `parseWordList(text, options)`. */
    fun parse(
        text: String,
        columnSeparator: ColumnSeparator = ColumnSeparator.AUTO,
        customSeparator: String = "",
        rowSeparator: RowSeparator = RowSeparator.AUTO,
    ): Result {
        val rowSep = detectRowSeparator(text, rowSeparator)
        var lines = splitRows(text, rowSep)
        val colSep = detectColumnSeparator(lines, columnSeparator)
        var rowsCells = lines.map { l -> splitCells(l, colSep, customSeparator).map(::clean) }

        var headerDropped = false
        if (rowsCells.size > 1 && isHeader(rowsCells[0])) {
            headerDropped = true
            rowsCells = rowsCells.drop(1)
            lines = lines.drop(1)
        }

        val columns = if (colSep == ColumnSeparator.SPACE) emptyList() else voteColumns(rowsCells)
        val rows = rowsCells.mapIndexed { i, cells ->
            var fields: Map<Role, String>
            if (columns.isNotEmpty() && cells.size == columns.size) {
                val f = emptyFields()
                cells.forEachIndexed { c, cell ->
                    val role = columns[c]
                    if (role == Role.IGNORE || cell.isEmpty()) return@forEachIndexed
                    val cur = f.getValue(role)
                    f[role] = if (cur.isNotEmpty()) "$cur $cell" else cell
                }
                fields = if (f.getValue(Role.HANZI).isEmpty()) assignByScript(cells) else f
            } else {
                fields = assignByScript(cells)
            }
            finishRow(i, lines[i], fields)
        }.toMutableList()

        // Same word twice in one paste: the last one wins, earlier ones are flagged.
        val lastByHanzi = HashMap<String, Int>()
        for (r in rows) if (NO_CHINESE !in r.problems) lastByHanzi[normalizeHanzi(r.hanzi)] = r.index
        for ((k, r) in rows.withIndex()) {
            if (NO_CHINESE in r.problems) continue
            if (lastByHanzi[normalizeHanzi(r.hanzi)] != r.index) rows[k] = r.copy(problems = r.problems + DUPLICATE_IN_PASTE)
        }
        return Result(rows, Detected(colSep, rowSep, columns, headerDropped))
    }
}

/** Port of shared/import/plan.ts. */
object ImportPlanner {
    enum class Policy(val wire: String) { UPDATE("update"), SKIP("skip"), DUPLICATE("duplicate") }
    enum class Action(val wire: String) { ADD("add"), UPDATE("update"), UNCHANGED("unchanged"), SKIP("skip"), PROBLEM("problem") }

    data class Existing(val id: String, val hanzi: String, val pinyin: String, val english: String, val funFacts: String? = null, val sentenceClue: String? = null)

    /** field: pinyin | english | fun_facts | sentence_clue */
    data class Change(val field: String, val from: String, val to: String)

    data class Planned(
        val row: WordListParser.Row,
        val action: Action,
        val existing: Existing? = null,
        val changes: List<Change> = emptyList(),
        /** "pinyin" / "english" still empty on an add. */
        val missing: List<String> = emptyList(),
        /** no_chinese | duplicate_in_paste | incomplete | excluded | policy */
        val reason: String? = null,
    )

    data class Summary(val add: Int, val update: Int, val unchanged: Int, val skipped: Int, val problems: Int)

    private val WS_RUN = Regex("$JS_S+")
    private fun norm(s: String?): String = jsTrim(WS_RUN.replace(nfc(s.orEmpty()), " "))

    /** `planImport(rows, existingNotes, policy, excluded)`. */
    fun plan(rows: List<WordListParser.Row>, existingNotes: List<Existing>, policy: Policy, excluded: Set<Int> = emptySet()): List<Planned> {
        val byHanzi = LinkedHashMap<String, Existing>()
        for (n in existingNotes) {
            val key = WordListParser.normalizeHanzi(n.hanzi)
            if (key.isNotEmpty() && key !in byHanzi) byHanzi[key] = n
        }
        return rows.map { row ->
            if (WordListParser.NO_CHINESE in row.problems) return@map Planned(row, Action.PROBLEM, reason = "no_chinese")
            if (WordListParser.DUPLICATE_IN_PASTE in row.problems) return@map Planned(row, Action.SKIP, reason = "duplicate_in_paste")
            if (row.index in excluded) return@map Planned(row, Action.SKIP, reason = "excluded")
            val existing = byHanzi[WordListParser.normalizeHanzi(row.hanzi)]
            if (existing == null || policy == Policy.DUPLICATE) {
                val missing = ArrayList<String>()
                if (norm(row.pinyin).isEmpty()) missing += "pinyin"
                if (norm(row.english).isEmpty()) missing += "english"
                return@map if (missing.isNotEmpty()) Planned(row, Action.PROBLEM, missing = missing, reason = "incomplete") else Planned(row, Action.ADD)
            }
            if (policy == Policy.SKIP) return@map Planned(row, Action.SKIP, existing, reason = "policy")
            val changes = ArrayList<Change>()
            fun consider(field: String, to: String, from: String?) {
                if (norm(to).isNotEmpty() && norm(to) != norm(from)) changes += Change(field, norm(from), norm(to))
            }
            consider("pinyin", row.pinyin, existing.pinyin)
            consider("english", row.english, existing.english)
            consider("fun_facts", row.notes, existing.funFacts)
            consider("sentence_clue", row.sentence, existing.sentenceClue)
            if (changes.isNotEmpty()) Planned(row, Action.UPDATE, existing, changes) else Planned(row, Action.UNCHANGED, existing)
        }
    }

    fun summarize(plan: List<Planned>): Summary {
        var add = 0; var update = 0; var unchanged = 0; var skipped = 0; var problems = 0
        for (p in plan) when (p.action) {
            Action.ADD -> add++
            Action.UPDATE -> update++
            Action.UNCHANGED -> unchanged++
            Action.SKIP -> skipped++
            Action.PROBLEM -> problems++
        }
        return Summary(add, update, unchanged, skipped, problems)
    }
}
