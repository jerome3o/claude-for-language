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
 * Context kinds and intents are the TypeScript strings: general · card · practice · chat_message;
 * ask · check · explain · translate.
 */
object ClaudeChats {
    const val GENERAL = "general"
    const val CARD = "card"
    const val PRACTICE = "practice"
    const val CHAT_MESSAGE = "chat_message"

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
    ) {
        /** Port of contextRef. */
        val ref: String?
            get() = when (kind) {
                CARD -> noteId
                PRACTICE -> conversationId
                CHAT_MESSAGE -> messageId
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
            else -> if (firstIntent != null && firstIntent != "ask") INTENT_BADGES[firstIntent] else null
        }
    }

    // ---------- chipsFor ----------

    /** [fill] = the question goes into the box to be finished (🆘 How do I say…) instead of being sent. */
    data class Chip(val id: String, val label: String, val question: String, val fill: Boolean = false)

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
        chip("cards", zh, "做卡片 Make flashcards", "Make flashcards", "请把这条消息里值得学的词做成卡片。", "Please make flashcards for the key words and phrases in this message."),
    )

    /** A role-play's help chips (port of practiceChips): 💡 hint, 🆘 how do I say… (into the box), ✏️ correct me. */
    private fun practiceChips(zh: Boolean) = listOf(
        chip("hint", zh, "💡 提示 Give me a hint", "💡 Give me a hint", "💡 提示一下：我下一句可以说什么？", "💡 Give me a hint: what could I say next?"),
        chip("say", zh, "🆘 怎么说 How do I say…", "🆘 How do I say…", "🆘 怎么说：", "🆘 How do I say: ").copy(fill = true),
        chip("correct", zh, "✏️ 纠正 Correct my last message", "✏️ Correct my last message", "✏️ 请改一下我上一句话。", "✏️ Please correct my last message."),
    )

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
            // Offered every time (never "used", never trimmed).
            PRACTICE -> return practiceChips(zh)
            else -> return emptyList()
        }.filter { it.id !in used }
        return if (replies > 0) list.take(CHIPS_AFTER_REPLY_MAX) else list
    }

    // ---------- composerFor ----------

    val INTENT_LABELS = mapOf("ask" to "Ask", "check" to "✏️ Check", "explain" to "🔍 Explain", "translate" to "🔤 Translate")

    const val PRACTICE_READ_ONLY_NOTE = "This practice chat is from the old chat screen and can’t go on — start a new one: ✏️ → 🎭 Practice a situation."

    data class Composer(val intents: List<String>, val primary: String?, val enabled: Boolean, val hint: String?, val readOnly: Boolean)

    /**
     * Port of composerFor: Check / Explain / Translate only start a general chat; everything else
     * (a card, a chat message, a role-play) asks. A [readOnly] thread (an old practice chat copied in) has none.
     */
    fun composerFor(kind: String, text: String, started: Boolean, readOnly: Boolean = false): Composer {
        val hasText = NoteSearch.jsTrim(text).isNotEmpty()
        if (readOnly) return Composer(emptyList(), null, false, PRACTICE_READ_ONLY_NOTE, true)
        if (kind != GENERAL || started) return Composer(listOf("ask"), "ask", hasText, null, false)
        val b = CoachActions.buttons(text)
        return Composer(listOf("ask") + b.actions.map { it.id }, "ask", b.enabled, b.hint, false)
    }

    // ---------- headerChipFor ----------

    /** Where the header chip leads: kind "card" (noteId) or "chat_message" (messageId, conversationId); null = nowhere. */
    data class Link(val kind: String, val noteId: String? = null, val messageId: String? = null, val conversationId: String? = null)

    data class HeaderChip(val icon: String, val text: String, val link: Link?)

    /** Port of headerChipFor. */
    fun headerChipFor(ctx: Context): HeaderChip? = when (ctx.kind) {
        CARD -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, Link(CARD, noteId = ctx.noteId)) }
        CHAT_MESSAGE -> HeaderChip("💬", "From a chat message", Link(CHAT_MESSAGE, messageId = ctx.messageId, conversationId = ctx.conversationId))
        PRACTICE -> contextBadge(ctx)!!.let { HeaderChip(it.icon, it.text, null) }
        else -> null
    }

    // ---------- resumeThreadFor ----------

    /** Port of RESUME_WINDOW_MS (= THREAD_GAP_MS, 30 minutes). */
    const val RESUME_WINDOW_MS = 30L * 60 * 1000

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
        // A new role-play never resumes (each is a new scene); an old copied one (its conversation) does.
        if (ctx.kind == PRACTICE && ctx.conversationId == null) return null
        val ref = ctx.ref
        var bestId: String? = null
        var bestAt = Long.MIN_VALUE
        for (t in threads) {
            if (t.archived || t.context.kind != ctx.kind || t.context.ref != ref) continue
            val at = parseMs(t.lastMessageAt) ?: parseMs(t.createdAt) ?: continue
            if (ctx.kind == CARD && nowMs - at > RESUME_WINDOW_MS) continue
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
}
