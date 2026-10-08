package dev.jeromeswannack.chineselearning.lab.core

/**
 * The long-press menu of one chat message — chat round 2 (docs/CHAT.md "Round 2"). Port of
 * `messageMenu` / `menuText` in shared/chats/messageMenu.ts, parity-tested
 * (parity/fixtures/chat-round2.ts → ChatRound2ParityTest). Bubbles carry no buttons: every tool
 * lives here, in this order: How to say it better (first, on my own message the auto-check flagged
 * or the tutor corrected — [SayBetter]) and Open in Coach right after it, Reply, Copy, Forward, Translate, Pinyin, Explain, Save as flashcard, Open in Coach (any
 * message with Chinese: mine is checked, theirs explained — when not already second), Make
 * flashcards from selection, Check my Chinese, Correct, Read aloud, Word by word (Claude practice
 * chat), Discuss with Claude, Pin, Info, Edit, Delete, Select. A reaction bar sits on top ([Menu.reactions]).
 */
object MessageMenu {
    /** `MenuMessage`: what the menu reads off a message. */
    data class Message(
        val senderId: String,
        val content: String,
        val deletedAt: String? = null,
        /** Still in the outbox. */
        val pending: Boolean = false,
        /** image | voice | file | video | null. */
        val attachmentKind: String? = null,
        val transcript: String? = null,
        /** The voice transcript's state ('pending' | 'done' | 'failed' | null). */
        val transcriptStatus: String? = null,
        val attachmentTranslation: String? = null,
        /** Machine translation already on the message (text messages). */
        val translation: String? = null,
        val hasCorrection: Boolean = false,
        /** The correction's text, when known (an empty one is no correction for "How to say it better"). */
        val correctionText: String? = null,
        /** 'correct' | 'needs_improvement' | null. */
        val checkStatus: String? = null,
        /** The background check: 'ok' | 'improvable' and the text it was about (only the sender has it). */
        val autoCheckStatus: String? = null,
        val autoCheckText: String? = null,
        val hasDiscussion: Boolean = false,
        val pinnedAt: String? = null,
    )

    data class Item(
        val id: String,
        val label: String,
        val icon: String,
        val needsInternet: Boolean,
        /** A toggle that is currently on. */
        val active: Boolean = false,
        /** Shown in red (Delete). */
        val danger: Boolean = false,
    )

    data class Menu(val reactions: Boolean, val items: List<Item>)

    // Action ids (`MenuActionId`).
    const val SAY_BETTER = "say_better"
    const val OPEN_COACH = "open_coach"
    const val REPLY = "reply"
    const val COPY = "copy"
    const val FORWARD = "forward"
    const val TRANSLATE = "translate"
    const val PINYIN = "pinyin"
    const val EXPLAIN = "explain"
    const val SAVE_CARD = "save_card"
    const val SELECT_CARDS = "select_cards"
    const val CHECK = "check"
    const val VIEW_CORRECTIONS = "view_corrections"
    const val CORRECT = "correct"
    const val REMOVE_CORRECTION = "remove_correction"
    const val CORRECTION_CARD = "correction_card"
    const val PLAY = "play"
    const val WORD_BY_WORD = "word_by_word"
    const val DISCUSS = "discuss"
    const val PIN = "pin"
    const val UNPIN = "unpin"
    const val INFO = "info"
    const val EDIT = "edit"
    const val DELETE = "delete"
    const val SELECT = "select"

    /** The quick reactions on top of the menu (docs/CHAT.md: 👍 ❤️ 😂 😮 😢 🙏 +). */
    val REACTIONS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

    private fun truthy(s: String?) = !s.isNullOrEmpty()

    /** Port of menuText: the voice transcript, else the message / caption (trimmed). */
    fun menuText(content: String?, attachmentKind: String?, transcript: String?): String =
        if (attachmentKind == "voice") NoteSearch.jsTrim(transcript.orEmpty()) else NoteSearch.jsTrim(content.orEmpty())

    fun menuText(m: Message): String = menuText(m.content, m.attachmentKind, m.transcript)

    /** Port of messageMenu. [viewerRole] is 'tutor' | 'student'. */
    fun messageMenu(
        msg: Message,
        viewerRole: String,
        isAiConversation: Boolean,
        viewerId: String,
        pinyinOn: Boolean = false,
        translateOn: Boolean = false,
    ): Menu {
        if (truthy(msg.deletedAt)) return Menu(false, emptyList())
        val text = menuText(msg)
        val kind = msg.attachmentKind
        val noKind = kind.isNullOrEmpty()
        if (msg.pending) return Menu(false, if (text.isNotEmpty()) listOf(Item(COPY, "Copy", "📋", false)) else emptyList())
        val isMine = msg.senderId == viewerId
        val isLearner = viewerRole == "student" || isAiConversation
        val zh = text.isNotEmpty() && MessageTools.looksLikeChinese(text)
        val translated = if (kind == "voice") truthy(msg.attachmentTranslation) else truthy(msg.translation)
        val items = mutableListOf<Item>()
        // Auto-check found something, or the tutor corrected it: the first thing to reach for.
        val k = kind?.takeIf { it.isNotEmpty() }
        val sayBetter = SayBetter.state(
            msg.senderId, msg.content, msg.deletedAt, k, msg.hasCorrection, msg.correctionText,
            msg.autoCheckStatus, msg.autoCheckText, viewerId, msg.transcript, msg.transcriptStatus,
        ) != null
        if (sayBetter) items += Item(SAY_BETTER, "How to say it better", "✨", false)
        // "Open in Coach": my own message (as the learner) is checked there, anyone else's explained.
        val coach = SayBetter.openInCoachRequest(msg.senderId, msg.content, msg.deletedAt, k, msg.transcript, msg.transcriptStatus, viewerId)
        val openCoach = coach != null && (!isMine || isLearner)
        val coachItem = Item(OPEN_COACH, "Open in Coach", "🎓", true)
        if (openCoach && sayBetter) items += coachItem
        // A current auto-check answers "Check my Chinese" already.
        val autoChecked = msg.autoCheckStatus != null &&
            msg.autoCheckText == SayBetter.autoCheckText(msg.content, k, msg.transcript, msg.transcriptStatus)
        items += Item(REPLY, "Reply", "↩️", false)
        if (text.isNotEmpty()) items += Item(COPY, "Copy", "📋", false)
        if (!isAiConversation) items += Item(FORWARD, "Forward", "↪️", true)
        if (zh && (kind != "voice" || translated)) {
            items += Item(TRANSLATE, if (translateOn) "Hide translation" else "Translate", "🌐", !translated && !translateOn, active = translateOn)
        }
        if (zh) {
            items += Item(PINYIN, if (pinyinOn) "Hide pinyin" else "Pinyin", "拼", false, active = pinyinOn)
            items += Item(EXPLAIN, "Explain", "🔍", true)
            items += Item(SAVE_CARD, "Save as flashcard", "🃏", true)
        }
        if (openCoach && !sayBetter) items += coachItem
        if (text.isNotEmpty()) items += Item(SELECT_CARDS, "Make flashcards from selection", "🗂️", true)
        if (isMine && zh && isLearner && noKind && !autoChecked) {
            if (msg.checkStatus == "needs_improvement") items += Item(VIEW_CORRECTIONS, "View corrections", "📝", false)
            else if (msg.checkStatus != "correct") items += Item(CHECK, "Check my Chinese", "✅", true)
        }
        if (!isAiConversation && msg.hasCorrection && isMine) items += Item(CORRECTION_CARD, "Make a card from the correction", "✏️", true)
        if (!isAiConversation && viewerRole == "tutor" && !isMine && noKind && NoteSearch.jsTrim(msg.content).isNotEmpty()) {
            items += Item(CORRECT, if (msg.hasCorrection) "Edit correction" else "Correct", "✏️", true)
            if (msg.hasCorrection) items += Item(REMOVE_CORRECTION, "Remove correction", "✖️", true)
        }
        if (zh && kind != "voice") items += Item(PLAY, "Read aloud", "🔊", true)
        if (isAiConversation && !isMine && zh && isLearner && noKind) items += Item(WORD_BY_WORD, "Word by word", "🈯", true)
        if (text.isNotEmpty()) items += Item(DISCUSS, if (msg.hasDiscussion) "Continue with Claude" else "Discuss with Claude", "💬", true)
        if (!isAiConversation) {
            items += if (truthy(msg.pinnedAt)) Item(UNPIN, "Unpin", "📌", true) else Item(PIN, "Pin", "📌", true)
            items += Item(INFO, "Info", "ℹ️", false)
            if (isMine && kind != "voice") items += Item(EDIT, if (kind == "image") "Edit caption" else "Edit", "✏️", true)
            if (isMine) items += Item(DELETE, "Delete", "🗑️", true, danger = true)
        }
        items += Item(SELECT, "Select", "☑️", false)
        return Menu(true, items)
    }

    private val ALBUM_KEEPS = listOf(REPLY, COPY, FORWARD, EXPLAIN, SAVE_CARD, PIN, UNPIN, INFO, EDIT, DELETE)

    /**
     * Port of albumMenu (docs/CHAT.md "Photo albums"): the album bubble's menu — Reply, Copy / Explain /
     * Save as flashcard (the caption), Forward all, Pin, Info, Edit caption, Delete all; reactions stay.
     */
    fun albumMenu(menu: Menu, photoCount: Int): Menu {
        val n = photoCount.coerceAtLeast(0)
        val items = menu.items.filter { it.id in ALBUM_KEEPS }.map {
            when (it.id) {
                FORWARD -> it.copy(label = "Forward all $n")
                DELETE -> it.copy(label = "Delete all $n")
                EDIT -> it.copy(label = "Edit caption")
                else -> it
            }
        }
        return Menu(menu.reactions, items)
    }
}
