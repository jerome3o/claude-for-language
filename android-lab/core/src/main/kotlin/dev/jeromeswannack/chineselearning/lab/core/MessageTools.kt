package dev.jeromeswannack.chineselearning.lab.core

/*
 * Role-aware per-message tools for the chat. Port of shared/chats/messageTools.ts
 * (toolsForMessage, looksLikeChinese) — parity-tested (parity/fixtures/chat.ts).
 *
 * Inline (always visible): Reply, Play (Chinese only). Menu (⋯ / long-press): React;
 * Check my Chinese (own Chinese messages, learner only; "View corrections" once checked
 * with corrections); Translate (other party's Chinese — "Make a card from this" for a
 * tutor); Word by word (learner, other party's Chinese); Discuss with Claude; Copy.
 */

data class MessageTool(val id: String, val label: String, val icon: String, val needsInternet: Boolean)

data class MessageToolSet(val inline: List<MessageTool>, val menu: List<MessageTool>, val isMine: Boolean, val hasChinese: Boolean)

object MessageTools {
    /** Port of looksLikeChinese: any UTF-16 unit in U+4E00–U+9FFF. */
    fun looksLikeChinese(text: String): Boolean = text.any { it in '一'..'鿿' }

    /** Port of toolsForMessage. [viewerRole] is 'tutor' | 'student'; [checkStatus] 'correct' | 'needs_improvement' | null. */
    fun toolsForMessage(
        senderId: String,
        content: String,
        checkStatus: String?,
        hasDiscussion: Boolean,
        viewerRole: String,
        isAiConversation: Boolean,
        viewerId: String,
    ): MessageToolSet {
        val isMine = senderId == viewerId
        val hasChinese = looksLikeChinese(content)
        val isLearner = viewerRole == "student" || isAiConversation

        val inline = mutableListOf(MessageTool("reply", "Reply", "↩", false))
        if (hasChinese) inline += MessageTool("play", "Play", "🔊", true)

        val menu = mutableListOf(MessageTool("react", "React", "😊", true))
        if (isMine && hasChinese && isLearner) {
            if (checkStatus == "needs_improvement") menu += MessageTool("view_corrections", "View corrections", "📝", false)
            else if (checkStatus != "correct") menu += MessageTool("check", "Check my Chinese", "✓", true)
        }
        if (!isMine && hasChinese) {
            menu += MessageTool("translate", if (isLearner) "Translate & make flashcard" else "Make a card from this", "🔤", true)
            if (isLearner) menu += MessageTool("word_by_word", "Word by word", "🈯", true)
        }
        menu += MessageTool("discuss", if (hasDiscussion) "Continue discussion with Claude" else "Discuss with Claude", "💬", true)
        menu += MessageTool("copy", "Copy text", "📋", false)
        return MessageToolSet(inline, menu, isMine, hasChinese)
    }
}
