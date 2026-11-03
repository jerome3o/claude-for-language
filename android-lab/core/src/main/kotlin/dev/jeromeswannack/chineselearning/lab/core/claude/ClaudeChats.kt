package dev.jeromeswannack.chineselearning.lab.core.claude

import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import java.time.Instant

/**
 * Claude threads — what each context's thread screen offers (docs/CHAT.md "Claude thread view"):
 * port of shared/claude/contexts.ts (`chipsFor`, `composerFor`, `headerChipFor`, `resumeThreadFor`,
 * `claudeReplyPollMs`, `turnStatusLine`) and of `contextBadge` in shared/claude/context.ts.
 * Parity-tested (parity/fixtures/claude-chats.ts → ClaudeChatsParityTest).
 *
 * Context kinds and intents are the TypeScript strings: general · card · practice · chat_message ·
 * reader · exercise; ask · check · explain · translate.
 */
object ClaudeChats {
    const val GENERAL = "general"
    const val CARD = "card"
    const val PRACTICE = "practice"
    const val CHAT_MESSAGE = "chat_message"
    const val READER = "reader"
    const val EXERCISE = "exercise"

    /** Port of READER_CONTEXT_WORDS_MAX: a reader page's looked-up / misread words on the context. */
    const val READER_CONTEXT_WORDS_MAX = 12

    /** A thread's context as the screen needs it: the kind, its ref fields and the badge snapshot. */
    data class Context(
        val kind: String,
        val noteId: String? = null,
        val messageId: String? = null,
        val conversationId: String? = null,
        val scenario: String? = null,
        val label: String? = null,
        /** A card thread asked right after a typed answer. */
        val typed: Boolean = false,
        /** A reader thread: the reader, its page (id + 1-based number), the page's looked-up / misread words. */
        val readerId: String? = null,
        val pageId: String? = null,
        val page: Int? = null,
        val lookedUp: List<String> = emptyList(),
        val saidWrong: List<String> = emptyList(),
        /** An exercise thread: the lesson, the exercise's key and type, his checked answer's verdict. */
        val lessonId: String? = null,
        val exerciseKey: String? = null,
        val exerciseType: String? = null,
        /** He asked with an answer on this showing (its verdict when it was checked). */
        val hasAnswer: Boolean = false,
        val answerVerdict: String? = null,
    ) {
        /** Port of contextRef. */
        val ref: String?
            get() = when (kind) {
                CARD -> noteId
                PRACTICE -> conversationId
                CHAT_MESSAGE -> messageId
                READER -> if (pageId != null) "$readerId:$pageId" else readerId
                EXERCISE -> "$lessonId:$exerciseKey"
                else -> null
            }
    }

    // ---------- contextBadge ----------

    data class Badge(val icon: String, val text: String)

    private val INTENT_BADGES = mapOf(
        "check" to Badge("✏️", "Check"),
        "explain" to Badge("🔍", "Explain"),
        "translate" to Badge("🔤", "Translate"),
    )

    /** Port of contextBadge: where the chat happened; a general chat has none unless it started with a Coach button. */
    fun contextBadge(ctx: Context, firstIntent: String? = null): Badge? {
        val label = ctx.label?.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""
        return when (ctx.kind) {
            CARD -> Badge("📇", "Asked on card$label")
            PRACTICE -> Badge("🎭", "Practice${ctx.scenario?.takeIf { it.isNotEmpty() }?.let { " · ${it.take(40)}" } ?: label}")
            CHAT_MESSAGE -> Badge("💬", "About a message$label")
            READER -> Badge("📖", "Reader$label${ctx.page?.let { " p.$it" } ?: ""}")
            EXERCISE -> Badge("🧩", "Exercise$label")
            else -> if (firstIntent != null && firstIntent != "ask") INTENT_BADGES[firstIntent] else null
        }
    }

    // ---------- chipsFor ----------

    data class Chip(val id: String, val label: String, val question: String)

    const val CHIPS_AFTER_REPLY_MAX = 3

    private fun chip(id: String, zh: Boolean, zhLabel: String, enLabel: String, zhQ: String, enQ: String) =
        Chip(id, if (zh) zhLabel else enLabel, if (zh) zhQ else enQ)

    private fun generalChips(zh: Boolean) = listOf(
        chip("phrase", zh, "实用的句子 A useful phrase", "A useful phrase", "教我一个日常生活中很常用的句子。", "Teach me one useful everyday Chinese phrase, with pinyin and an example of when to say it."),
        chip("quiz", zh, "考考我 Quiz me", "Quiz me", "用我学过的词考考我，一次问一个问题。", "Quiz me on a few words I have been learning, one question at a time."),
        chip("story", zh, "小故事 A short story", "A short story", "用很简单的中文讲一个很短的故事。", "Tell me a very short story in simple Chinese, then explain the new words."),
    )

    private fun chatMessageChips(zh: Boolean) = listOf(
        chip("meaning", zh, "什么意思 What does it mean", "What does it mean", "这条消息是什么意思？请一个词一个词地解释。", "What does this message mean? Break it down word by word."),
        chip("natural", zh, "自然吗 Is it natural", "Is it natural", "这样说自然吗？有没有更地道的说法？", "Is this natural Chinese? How would a native speaker say it?"),
        chip("reply", zh, "怎么回复 How to reply", "How to reply", "我可以怎么回复？给我两三个简单的回答。", "How could I reply? Give me two or three simple replies with pinyin."),
    )

    private fun readerChips(zh: Boolean, ctx: Context): List<Chip> {
        val list = mutableListOf<Chip>()
        if (ctx.lookedUp.size + ctx.saidWrong.size > 0) {
            list += chip("my_words", zh, "我查的词 The words I looked up", "The words I looked up", "请解释一下我在这一页查过的词和读错的词。", "Explain the words I looked up or read wrong on this page, each in its sentence.")
        }
        list += chip("page_meaning", zh, "这页讲什么 What does this page mean?", "What does this page mean?", "这一页讲的是什么？请一句一句地说一说。", "What does this page mean? Go through it sentence by sentence.")
        list += chip("grammar", zh, "语法 Explain the grammar in this sentence", "Explain the grammar in this sentence", "请讲一下这一页句子里的语法。", "Explain the grammar in the sentences on this page.")
        list += chip("quiz", zh, "考考我 Quiz me on this page", "Quiz me on this page", "用这一页的内容考考我，一次问一个问题。", "Quiz me on this page, one question at a time.")
        return list
    }

    private val CHOICE_EXERCISES = setOf("choice", "listen_choice", "judge", "gap_choice", "match")
    private val OWN_ANSWER_EXERCISES = setOf("translate", "listen_translate", "speak", "oral_expression", "describe_image", "sentence_making", "write_typed", "write_handwriting", "dictation")

    private fun exerciseChips(zh: Boolean, ctx: Context): List<Chip> {
        val list = mutableListOf<Chip>()
        val type = ctx.exerciseType ?: ""
        val verdict = ctx.answerVerdict
        if (ctx.hasAnswer && (verdict == "wrong" || verdict == "almost")) {
            list += chip("why_wrong", zh, "为什么错了 Why is my answer wrong?", "Why is my answer wrong?", "我的答案为什么不对？应该怎么说？", "Why is my answer wrong? What should I have said, and why?")
        } else if (ctx.hasAnswer) {
            list += chip("my_answer", zh, "我的答案 Is my answer OK?", "Is my answer OK?", "我的答案自然吗？还可以怎么说？", "Is my answer natural? How else could I say it?")
        }
        list += when {
            type == "note" -> chip("explain", zh, "讲一讲 Explain this note", "Explain this note", "请用更简单的话讲一讲这个语法点。", "Explain this point again in simpler words, with one more example.")
            type == "scramble" -> chip("explain", zh, "语序 Explain the word order", "Explain the word order", "这个句子为什么是这个语序？", "Why are the words in this order? Explain the structure.")
            type in CHOICE_EXERCISES -> chip("explain", zh, "为什么 Explain the right answer", "Explain the right answer", "为什么这个是对的答案？别的为什么不对？", "Why is the right answer right, and why are the others wrong?")
            type in OWN_ANSWER_EXERCISES -> chip("explain", zh, "参考答案 Explain the model answer", "Explain the model answer", "请解释一下参考答案，一个词一个词地说。", "Explain the model answer word by word.")
            else -> chip("explain", zh, "讲一讲 Explain this exercise", "Explain this exercise", "请讲一讲这个练习考的是什么。", "What is this exercise practising? Explain it.")
        }
        list += chip("example", zh, "再来一个例子 Give me another example", "Give me another example", "请再给我一个例子。", "Give me another example of this, with pinyin and English.")
        list += chip("one_more", zh, "再练一个 One more like this", "One more like this", "给我出一个类似的小练习，先别告诉我答案。", "Give me one more exercise like this to try — don’t tell me the answer yet.")
        return list
    }

    /** Port of chipsFor: the suggestion chips above a thread's composer. */
    fun chipsFor(
        ctx: Context,
        language: String,
        typedAnswer: Boolean = false,
        hasSentence: Boolean = false,
        replies: Int = 0,
        used: Collection<String> = emptyList(),
    ): List<Chip> {
        val zh = language == AskClaude.ZH
        val list = when (ctx.kind) {
            CARD -> AskClaude.quickActions(language, typedAnswer || ctx.typed, hasSentence).map { Chip(it.id, it.label, it.question) }
            GENERAL -> generalChips(zh)
            CHAT_MESSAGE -> chatMessageChips(zh)
            READER -> readerChips(zh, ctx)
            EXERCISE -> exerciseChips(zh, ctx)
            else -> return emptyList()
        }.filter { it.id !in used }
        return if (replies > 0) list.take(CHIPS_AFTER_REPLY_MAX) else list
    }

    // ---------- composerFor ----------

    val INTENT_LABELS = mapOf("ask" to "Ask", "check" to "✏️ Check", "explain" to "🔍 Explain", "translate" to "🔤 Translate")

    const val PRACTICE_READ_ONLY_NOTE = "This practice chat is read-only for now — practise a new situation from the chat with your tutor."

    data class Composer(val intents: List<String>, val primary: String?, val enabled: Boolean, val hint: String?, val readOnly: Boolean)

    /** Port of composerFor: Check / Explain / Translate only start a general chat; everything else asks. */
    fun composerFor(kind: String, text: String, started: Boolean): Composer {
        val hasText = NoteSearch.jsTrim(text).isNotEmpty()
        if (kind == PRACTICE) return Composer(emptyList(), null, false, PRACTICE_READ_ONLY_NOTE, true)
        if (kind != GENERAL || started) return Composer(listOf("ask"), "ask", hasText, null, false)
        val b = CoachActions.buttons(text)
        return Composer(listOf("ask") + b.actions.map { it.id }, "ask", b.enabled, b.hint, false)
    }

    // ---------- headerChipFor ----------

    /**
     * Where the header chip leads: kind "card" (noteId), "chat_message" (messageId, conversationId),
     * "reader" (readerId, page) or "exercise" (lessonId, exerciseKey); null = nowhere.
     */
    data class Link(
        val kind: String,
        val noteId: String? = null,
        val messageId: String? = null,
        val conversationId: String? = null,
        val readerId: String? = null,
        val page: Int? = null,
        val lessonId: String? = null,
        val exerciseKey: String? = null,
    )

    data class HeaderChip(val icon: String, val text: String, val link: Link?)

    /** Port of headerChipFor. */
    fun headerChipFor(ctx: Context): HeaderChip? = when (ctx.kind) {
        CARD -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, Link(CARD, noteId = ctx.noteId)) }
        CHAT_MESSAGE -> HeaderChip("💬", "From a chat message", Link(CHAT_MESSAGE, messageId = ctx.messageId, conversationId = ctx.conversationId))
        PRACTICE -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, null) }
        READER -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, Link(READER, readerId = ctx.readerId, page = ctx.page)) }
        EXERCISE -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, Link(EXERCISE, lessonId = ctx.lessonId, exerciseKey = ctx.exerciseKey)) }
        else -> null
    }

    // ---------- resumeThreadFor ----------

    /** Port of RESUME_WINDOW_MS (= THREAD_GAP_MS, 30 minutes). */
    const val RESUME_WINDOW_MS = 30L * 60 * 1000

    /** The contexts whose thread resumes only within [RESUME_WINDOW_MS]: a card, a reader page, an exercise. */
    private val WINDOWED_KINDS = setOf(CARD, READER, EXERCISE)

    data class ResumeCandidate(
        val id: String,
        val context: Context,
        val lastMessageAt: String?,
        val createdAt: String,
        val archived: Boolean = false,
    )

    private fun parseMs(iso: String?): Long? = try {
        iso?.let { Instant.parse(it).toEpochMilli() }
    } catch (_: Exception) {
        null
    }

    /** Port of resumeThreadFor: the thread opening Claude in [ctx] continues, or null for a new one. */
    fun resumeThreadFor(threads: List<ResumeCandidate>, ctx: Context, nowMs: Long): String? {
        if (ctx.kind == GENERAL) return null
        val ref = ctx.ref
        var bestId: String? = null
        var bestAt = Long.MIN_VALUE
        for (t in threads) {
            if (t.archived || t.context.kind != ctx.kind || t.context.ref != ref) continue
            val at = parseMs(t.lastMessageAt) ?: parseMs(t.createdAt) ?: continue
            if (ctx.kind in WINDOWED_KINDS && nowMs - at > RESUME_WINDOW_MS) continue
            if (bestId == null || at > bestAt || (at == bestAt && t.id > bestId)) {
                bestId = t.id
                bestAt = at
            }
        }
        return bestId
    }

    // ---------- claudeReplyPollMs ----------

    const val POLL_FAST_MS = 400L
    const val POLL_FAST_FOR_MS = 10_000L
    const val POLL_SLOW_MS = 1500L
    const val LIVE_FRESH_MS = 3000L

    /** Port of claudeReplyPollMs: the slow safety net while live events arrive, else 400 ms for 10 s then 1.5 s. */
    fun replyPollMs(pendingForMs: Long, liveOpen: Boolean = false, sinceEventMs: Long? = null): Long {
        if (liveOpen && sinceEventMs != null && sinceEventMs < LIVE_FRESH_MS) return POLL_SLOW_MS
        return if (pendingForMs < POLL_FAST_FOR_MS) POLL_FAST_MS else POLL_SLOW_MS
    }

    // ---------- turnStatusLine ----------

    private val CARD_TOOLS = setOf("search_cards", "get_note_cards", "get_deck_info", "list_student_decks")
    private val PROGRESS_TOOLS = setOf("get_note_history", "get_overall_stats", "get_deck_progress", "get_due_cards")

    /** Port of turnStatusLine: what the bubble says while Claude works (null = nothing). */
    fun turnStatusLine(status: String?, tool: String?, language: String): String? {
        val zh = language == AskClaude.ZH
        if (status == "tool") {
            if (tool != null && tool in CARD_TOOLS) return if (zh) "在看你的卡片… Looking through your cards…" else "Looking through your cards…"
            if (tool != null && tool in PROGRESS_TOOLS) return if (zh) "在看你的学习记录… Looking at your progress…" else "Looking at your progress…"
            return if (zh) "在查… Looking it up…" else "Looking it up…"
        }
        if (status == "thinking") return if (zh) "想一想… Thinking…" else "Thinking…"
        return null
    }

    // ---------- readerPageWords ----------

    /** A reader word recap word as [readerPageWords] reads it (core WordRecap's word). */
    data class RecapWordLike(val hanzi: String, val page: Int, val pos: Int, val reasons: List<String>)

    data class PageWords(val lookedUp: List<String>, val saidWrong: List<String>)

    /**
     * Port of readerPageWords: ONE page's tapped (`lookedUp`) and misread (`saidWrong`) words of this
     * reading, story order, each ≤ [READER_CONTEXT_WORDS_MAX].
     */
    fun readerPageWords(words: List<RecapWordLike>, page: Int): PageWords {
        val onPage = words.filter { it.page == page && NoteSearch.jsTrim(it.hanzi).isNotEmpty() }.sortedBy { it.pos }
        fun pick(reason: String): List<String> {
            val out = mutableListOf<String>()
            for (w in onPage) {
                val h = NoteSearch.jsTrim(w.hanzi)
                if (reason in w.reasons && h !in out) out += h
                if (out.size >= READER_CONTEXT_WORDS_MAX) break
            }
            return out
        }
        return PageWords(pick("tapped"), pick("said_wrong"))
    }
}
