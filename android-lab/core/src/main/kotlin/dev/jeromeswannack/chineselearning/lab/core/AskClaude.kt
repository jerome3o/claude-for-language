package dev.jeromeswannack.chineselearning.lab.core

/**
 * Ask Claude on the study card, immersion edition (docs/STUDY_SESSION.md "Ask Claude"): the client
 * half of shared/study/askClaude.ts (the answer language, the quick-question chips) and of
 * `askClaudeMenu` in shared/chats/messageMenu.ts (the chat's long-press menu, only the parts that
 * fit). Parity-tested (parity/fixtures/ask-claude.ts → AskClaudeParityTest).
 */
object AskClaude {
    const val ZH = "zh"
    const val EN = "en"

    /** Port of DEFAULT_ASK_LANGUAGE: answers in Chinese. */
    const val DEFAULT_LANGUAGE = ZH

    /** Port of ASK_SENTENCE_TOOLS_MAX: the sentence tools only on a sentence-sized text. */
    const val SENTENCE_TOOLS_MAX = 120

    /** Port of parseAskLanguage: 'zh' | 'en', else null ("default"). */
    fun parseLanguage(v: String?): String? = if (v == ZH || v == EN) v else null

    /** Port of effectiveAskLanguage. */
    fun effectiveLanguage(setting: String?): String = parseLanguage(setting) ?: DEFAULT_LANGUAGE

    /** One quick-question chip (port of AskQuickAction). */
    data class QuickAction(val id: String, val label: String, val question: String)

    /** Port of askQuickActions. */
    fun quickActions(language: String, typedAnswer: Boolean, hasSentence: Boolean): List<QuickAction> {
        val zh = language == ZH
        fun qa(id: String, zhLabel: String, enLabel: String, zhQ: String, enQ: String) =
            QuickAction(id, if (zh) zhLabel else enLabel, if (zh) zhQ else enQ)
        return buildList {
            add(qa("sentences", "造句 Use in sentence", "Use in sentence", "请用这个词造几个简单的句子。", "Please use this word in a few example sentences with pinyin and English translations."))
            add(qa("characters", "每个字 Explain characters", "Explain characters", "请解释这个词里的每个字。", "Please break down each character in this word, explaining the radicals, components, and individual meanings."))
            add(qa("related", "相关的词 Related words", "Related words", "跟这个词有关的词还有哪些？", "What are some related words or phrases I should learn alongside this one?"))
            if (typedAnswer) add(qa("check_answer", "我的答案 Check my answer", "Check my answer", "我的答案对吗？如果不对，哪里错了？", "Is my answer correct, grammatically and in meaning? If not, explain what is wrong and how I can improve."))
            add(qa("grammar", "语法 Explain grammar", "Explain grammar", "请讲一下这个词的用法和语法。", "Can you explain the grammar of this sentence and break down each word?"))
            add(qa("fun_fact", "小知识 Add a fun fact", "Add a fun fact", "请给这张卡片加一个有意思的小知识。", "Add a brief, interesting fun fact or cultural context to this card."))
            if (hasSentence) add(qa("sentence", "例句 Explain sentence", "Explain sentence", "请解释一下这张卡片的例句。", "Please explain the example sentence for this card. Break down the grammar, explain each word, and provide any cultural context."))
        }
    }

    /** Port of AskMenuMessage: the learner's question ([mine]) or Claude's answer. */
    data class MenuMessage(
        val mine: Boolean,
        val text: String,
        val translation: String? = null,
        /** The background check of my own Chinese: 'ok' | 'improvable' and the text it was about. */
        val autoCheckStatus: String? = null,
        val autoCheckText: String? = null,
        /** An English Markdown answer: Copy only. */
        val markdown: Boolean = false,
    )

    private fun item(id: String, label: String, icon: String, needsInternet: Boolean, active: Boolean = false) =
        MessageMenu.Item(id, label, icon, needsInternet, active = active)

    /** Port of askClaudeMenu. No reactions, reply, forward, pin, edit, delete or select. */
    fun menu(msg: MenuMessage, pinyinOn: Boolean = false, translateOn: Boolean = false): MessageMenu.Menu {
        val text = NoteSearch.jsTrim(msg.text)
        if (text.isEmpty()) return MessageMenu.Menu(false, emptyList())
        val copy = item(MessageMenu.COPY, "Copy", "📋", false)
        if (msg.markdown) return MessageMenu.Menu(false, listOf(copy))
        val zh = MessageTools.looksLikeChinese(text)
        val short = text.length <= SENTENCE_TOOLS_MAX
        val viewer = "me"
        val sender = if (msg.mine) viewer else "claude"
        val sayBetter = SayBetter.state(sender, msg.text, null, null, false, null, msg.autoCheckStatus, msg.autoCheckText, viewer) != null
        val coach = SayBetter.openInCoachRequest(sender, msg.text, null, null, null, null, viewer) != null && (msg.mine || short)
        val coachItem = item(MessageMenu.OPEN_COACH, "Open in Coach", "🎓", true)
        val items = mutableListOf<MessageMenu.Item>()
        if (sayBetter) items += item(MessageMenu.SAY_BETTER, "How to say it better", "✨", false)
        if (coach && sayBetter) items += coachItem
        items += copy
        if (zh) {
            val translated = !msg.translation.isNullOrEmpty()
            items += item(MessageMenu.TRANSLATE, if (translateOn) "Hide translation" else "Translate", "🌐", !translated && !translateOn, active = translateOn)
            items += item(MessageMenu.PINYIN, if (pinyinOn) "Hide pinyin" else "Pinyin", "拼", false, active = pinyinOn)
            if (short) {
                items += item(MessageMenu.EXPLAIN, "Explain", "🔍", true)
                items += item(MessageMenu.SAVE_CARD, "Save as flashcard", "🃏", true)
            }
        }
        if (coach && !sayBetter) items += coachItem
        if (zh) items += item(MessageMenu.PLAY, "Read aloud", "🔊", true)
        return MessageMenu.Menu(false, items)
    }
}
