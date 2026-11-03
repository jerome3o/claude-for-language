package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable
import java.text.Normalizer

/**
 * Reader word recap — a port of shared/study/wordRecap.ts, parity-tested
 * (parity/fixtures/word-recap.ts → WordRecapParityTest). While a graded reader is read, the RUN
 * collects every word chip tapped and every word a 🎤 Read it aloud take heard wrong (another
 * character, a tone slip, a missed one — never a homophone, never extra words); after the finish
 * "📝 Recap N words" is offered: a one-off pass in story order (homework pass rules, practice only)
 * with a switch per word, OFF by default — "Add to my long-term review" (a new card) or "⚡ Study it
 * today" (a word he already has). docs/STUDY_SESSION.md "Reader word recap".
 */
@Serializable
data class WordRecapWord(
    val hanzi: String,
    val pinyin: String = "",
    val gloss: String = "",
    val sentence: String = "",
    val page_english: String = "",
    val page: Int = 0,
    val pos: Int = 0,
    /** "tapped" | "said_wrong", in that order. */
    val reasons: List<String> = emptyList(),
    val said: List<String> = emptyList(),
    val at: String = "",
)

@Serializable
data class WordRecapRun(
    val reader_id: String,
    val started_at: String,
    val finished_at: String? = null,
    val recapped_at: String? = null,
    val words: List<WordRecapWord> = emptyList(),
    /** The recap's answers (`item_id` = the word's [WordRecap.key]; `assignment_id` = the reader). */
    val events: List<HomeworkEvent> = emptyList(),
    val keep: List<String> = emptyList(),
)

object WordRecap {
    data class Tap(val text: String, val pinyin: String, val gloss: String, val sentence: String, val page: Int, val pos: Int, val pageEnglish: String)
    data class Mistake(val text: String, val pinyin: String, val pos: Int, val said: List<String>)
    data class Word(val text: String, val pinyin: String, val gloss: String)
    data class Page(val index: Int, val text: String, val english: String, val words: List<Word>?)
    data class Choices(val add: List<WordRecapWord>, val bump: List<WordRecapWord>)

    const val TAPPED = "tapped"
    const val SAID_WRONG = "said_wrong"
    private val REASON_ORDER = listOf(TAPPED, SAID_WRONG)

    private val NOT_LETTER_OR_DIGIT = Regex("[^\\p{L}\\p{N}]")
    private val HAN = Regex("\\p{IsHan}")

    /** `recapKey`: NFC, letters and digits only. */
    fun key(text: String): String = NOT_LETTER_OR_DIGIT.replace(Normalizer.normalize(text, Normalizer.Form.NFC), "")

    /** `isRecapWord`: it has a Chinese character. */
    fun isWord(text: String): Boolean = HAN.containsMatchIn(key(text))

    fun emptyRun(readerId: String, now: String) = WordRecapRun(reader_id = readerId, started_at = now)

    /** `recapRunFor`: the stored run while it is this reader's and not finished before [openedAt]; else a new one. */
    fun runFor(existing: WordRecapRun?, readerId: String, openedAt: String, now: String): WordRecapRun {
        if (existing != null && existing.reader_id == readerId && (existing.finished_at == null || existing.finished_at > openedAt)) return existing
        return emptyRun(readerId, now)
    }

    private val storyOrder = Comparator<WordRecapWord> { a, b ->
        when {
            a.page != b.page -> a.page - b.page
            a.pos != b.pos -> a.pos - b.pos
            else -> a.at.compareTo(b.at).coerceIn(-1, 1)
        }
    }

    private fun withReason(reasons: List<String>, r: String): List<String> {
        val set = reasons.toHashSet().apply { add(r) }
        return REASON_ORDER.filter { it in set }
    }

    private fun addWord(run: WordRecapRun, text: String, pinyin: String, gloss: String, sentence: String, pageEnglish: String, page: Int, pos: Int, reason: String, said: List<String>, now: String): WordRecapRun {
        val k = key(text)
        if (k.isEmpty() || !HAN.containsMatchIn(k)) return run
        val i = run.words.indexOfFirst { key(it.hanzi) == k }
        val words = if (i < 0) {
            run.words + WordRecapWord(text, pinyin, gloss, sentence, pageEnglish, page, pos, listOf(reason), LinkedHashSet(said).toList(), now)
        } else {
            val old = run.words[i]
            val earlier = page < old.page || (page == old.page && pos < old.pos)
            val merged = old.copy(
                pinyin = old.pinyin.ifEmpty { pinyin },
                gloss = old.gloss.ifEmpty { gloss },
                sentence = if (earlier) sentence else old.sentence,
                page_english = if (earlier) pageEnglish else old.page_english,
                page = if (earlier) page else old.page,
                pos = if (earlier) pos else old.pos,
                reasons = withReason(old.reasons, reason),
                said = LinkedHashSet(old.said + said).toList(),
            )
            run.words.mapIndexed { j, x -> if (j == i) merged else x }
        }
        return run.copy(words = words.sortedWith(storyOrder))
    }

    /** `addRecapTap`. */
    fun addTap(run: WordRecapRun, t: Tap, now: String): WordRecapRun =
        addWord(run, t.text, t.pinyin, t.gloss, t.sentence, t.pageEnglish, t.page, t.pos, TAPPED, emptyList(), now)

    private val MISTAKE_MARKS = setOf(ReadAloud.Mark.WRONG, ReadAloud.Mark.CLOSE, ReadAloud.Mark.MISSED)
    private fun isMistakeReason(line: String) = !line.startsWith("extra ") && !line.contains(" — sounded right (written ")

    /** `recapMistakes`: the words a take read as another character, with a tone slip or missed. */
    fun mistakes(result: ReadAloud.Result, words: List<String>? = null): List<Mistake> {
        val out = ArrayList<Mistake>()
        for (d in ReadAloud.differences(result, words)) {
            if (d.end <= d.start) continue
            val span = result.chars.subList(d.start, minOf(d.end, result.chars.size))
            if (span.none { !it.unitCont && it.mark in MISTAKE_MARKS }) continue
            out += Mistake(d.page, d.pagePinyin, d.start, d.reasons.filter(::isMistakeReason))
        }
        return out
    }

    private fun cpLen(s: String) = s.codePointCount(0, s.length)

    /** Code point [cp] of [text] as a UTF-16 index (clamped to the end). */
    private fun utf16At(text: String, cp: Int): Int {
        var i = 0
        var n = 0
        while (i < text.length) {
            if (n == cp) return i
            i += Character.charCount(text.codePointAt(i))
            n++
        }
        return i
    }

    private fun glossAt(words: List<Word>?, pos: Int, text: String): String {
        if (words == null) return ""
        var at = 0
        for (w in words) {
            if (at == pos && w.text == text) return w.gloss
            at += cpLen(w.text)
        }
        return ""
    }

    /** `addRecapMistakes`. */
    fun addMistakes(run: WordRecapRun, page: Page, result: ReadAloud.Result, now: String): WordRecapRun {
        var next = run
        for (m in mistakes(result, page.words?.map { it.text })) {
            val from = utf16At(page.text, m.pos)
            val to = utf16At(page.text, m.pos + cpLen(m.text))
            next = addWord(next, m.text, m.pinyin, glossAt(page.words, m.pos, m.text), ReaderWords.sentenceAround(page.text, from, to), page.english, page.index, m.pos, SAID_WRONG, m.said, now)
        }
        return next
    }

    fun finish(run: WordRecapRun, now: String) = run.copy(finished_at = now)
    fun markRecapped(run: WordRecapRun, now: String) = run.copy(recapped_at = now)
    fun available(run: WordRecapRun?): Boolean = run != null && run.finished_at != null && run.words.isNotEmpty()

    fun itemIds(run: WordRecapRun): List<String> = run.words.map { key(it.hanzi) }
    fun wordFor(run: WordRecapRun, k: String): WordRecapWord? = run.words.firstOrNull { key(it.hanzi) == k }
    fun progress(run: WordRecapRun): PassProgress = Homework.passProgress(itemIds(run), run.events)
    fun bar(run: WordRecapRun): RetryBar = RetryBars.passRetryBar(itemIds(run), run.events)

    fun answer(run: WordRecapRun, k: String, right: Boolean, now: String, id: String) =
        run.copy(events = run.events + HomeworkEvent(id = id, assignment_id = run.reader_id, item_id = k, result = if (right) "right" else "wrong", created_at = now))

    fun restart(run: WordRecapRun) = run.copy(events = emptyList(), recapped_at = null)

    fun setKeep(run: WordRecapRun, k: String, on: Boolean): WordRecapRun {
        val keep = run.keep.filter { it != k }
        return run.copy(keep = if (on) keep + k else keep)
    }

    fun isKept(run: WordRecapRun, k: String) = k in run.keep

    /** `recapRightFirstTime`. */
    fun rightFirstTime(run: WordRecapRun): Int {
        val first = LinkedHashMap<String, String>()
        for (e in run.events) {
            if (e.result != "right" && e.result != "wrong") continue
            if (e.item_id !in first) first[e.item_id] = e.result
        }
        val ids = itemIds(run).toHashSet()
        return first.count { (id, r) -> id in ids && r == "right" }
    }

    /** `recapChoices`. */
    fun choices(run: WordRecapRun, owned: (String) -> Boolean): Choices {
        val add = ArrayList<WordRecapWord>()
        val bump = ArrayList<WordRecapWord>()
        for (w in run.words) {
            val k = key(w.hanzi)
            if (k !in run.keep) continue
            if (owned(k)) bump += w else add += w
        }
        return Choices(add, bump)
    }

    const val DECK = "From my readers"
    const val DECK_DESCRIPTION = "Words you chose to keep from your graded readers."
    const val CLUE_MAX = 24

    /** `recapSentenceClue`. */
    fun sentenceClue(word: WordRecapWord): String {
        val s = NoteSearch.jsTrim(word.sentence)
        if (s.isEmpty() || s.contains('\n') || !s.contains(word.hanzi) || key(s) == key(word.hanzi)) return ""
        if (cpLen(s) > CLUE_MAX) return ""
        if (CardStandard.problems(sentenceClue = s).isNotEmpty()) return ""
        return s
    }

    fun promptLabel(n: Int) = "📝 Recap $n ${if (n == 1) "word" else "words"}"

    fun promptLine(run: WordRecapRun): String {
        val tapped = run.words.count { TAPPED in it.reasons }
        val said = run.words.count { SAID_WRONG in it.reasons }
        val parts = ArrayList<String>()
        if (tapped > 0) parts += "$tapped you tapped"
        if (said > 0) parts += "$said you read aloud differently"
        return if (parts.isEmpty()) "" else "Words from this story: ${parts.joinToString(" · ")}."
    }

    fun whyLines(word: WordRecapWord): List<String> {
        val out = ArrayList<String>()
        if (TAPPED in word.reasons) out += "You tapped it while reading"
        if (SAID_WRONG in word.reasons) {
            if (word.said.isEmpty()) out += "You read it aloud differently"
            for (line in word.said) out += "Read aloud: $line"
        }
        return out
    }

    const val KEEP_NEW = "Add to my long-term review"
    const val KEEP_OWNED = "⚡ Study it today"
    fun keepLabel(owned: Boolean) = if (owned) KEEP_OWNED else KEEP_NEW

    fun doneLine(added: Int, bumped: Int): String {
        val parts = ArrayList<String>()
        if (added > 0) parts += "$added ${if (added == 1) "word" else "words"} added to your long-term review"
        if (bumped > 0) parts += "$bumped for today ⚡"
        return if (parts.isEmpty()) "Nothing kept — that’s fine." else parts.joinToString(" · ")
    }
}
