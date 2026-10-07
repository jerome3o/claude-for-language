package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Check my Chinese automatically" — the client half of shared/chats/autoCheck.ts (docs/CHAT.md
 * "Auto-check"): the indicator / sheet state of one message as its sender sees it, its accessible
 * label, the Settings switch's default and "Open in Coach" (docs/CHAT.md "Chat ↔ Coach"). Parity-tested (parity/fixtures/chat-round2.ts →
 * ChatRound2ParityTest).
 */
object SayBetter {
    const val CORRECTED = "corrected"
    const val IMPROVABLE = "improvable"

    /**
     * Port of autoCheckText: the text a message's auto-check is about — a voice message's
     * transcript (once there is one: '' while transcript_status is set and not 'done'), otherwise
     * the message text, which for a photo / file / video is its caption. '' = nothing to check.
     */
    fun autoCheckText(content: String?, attachmentKind: String?, transcript: String?, transcriptStatus: String?): String {
        if (attachmentKind == "voice") {
            if (!transcriptStatus.isNullOrEmpty() && transcriptStatus != "done") return ""
            return if (NoteSearch.jsTrim(transcript.orEmpty()).isNotEmpty()) transcript!! else ""
        }
        return content.orEmpty()
    }

    /**
     * Port of sayBetterState: 'corrected' (the tutor's correction wins, text messages only) |
     * 'improvable' (the background check found something, about the current [autoCheckText]) |
     * null. Only the sender. [correctionText] null with [hasCorrection] = a correction whose text
     * is not known here (treated as present). An empty [attachmentKind] counts as no attachment.
     */
    fun state(
        senderId: String,
        content: String,
        deletedAt: String?,
        attachmentKind: String?,
        hasCorrection: Boolean,
        correctionText: String?,
        autoCheckStatus: String?,
        autoCheckText: String?,
        viewerId: String,
        transcript: String? = null,
        transcriptStatus: String? = null,
    ): String? {
        if (!deletedAt.isNullOrEmpty() || senderId != viewerId) return null
        val kind = attachmentKind?.takeIf { it.isNotEmpty() }
        if (kind == null && hasCorrection && correctionText != "") return CORRECTED
        val text = autoCheckText(content, kind, transcript, transcriptStatus)
        if (text.isNotEmpty() && autoCheckStatus == "improvable" && autoCheckText == text) return IMPROVABLE
        return null
    }

    /** What "Open in Coach" sends: the text and 'check' (my own message) | 'explain' (someone else's). */
    data class CoachRequest(val text: String, val action: String)

    /**
     * Port of openInCoachRequest: null without Chinese; my own message is CHECKED (the text the
     * auto-check looked at), someone else's EXPLAINED.
     */
    fun openInCoachRequest(
        senderId: String,
        content: String,
        deletedAt: String?,
        attachmentKind: String?,
        transcript: String?,
        transcriptStatus: String?,
        viewerId: String,
    ): CoachRequest? {
        if (!deletedAt.isNullOrEmpty()) return null
        val text = NoteSearch.jsTrim(autoCheckText(content, attachmentKind, transcript, transcriptStatus))
        if (text.isEmpty() || !text.any { c -> c in '\u3400'..'\u9FFF' || c in '\uF900'..'\uFAFF' }) return null
        return CoachRequest(text, if (senderId == viewerId) "check" else "explain")
    }

    /** Port of showCoachChip: the "🎓 Open in Coach" chip under MY bubble, only when the auto-check found something. */
    fun showCoachChip(
        senderId: String,
        content: String,
        deletedAt: String?,
        attachmentKind: String?,
        transcript: String?,
        transcriptStatus: String?,
        autoCheckStatus: String?,
        autoCheckText: String?,
        viewerId: String,
    ): Boolean {
        if (!deletedAt.isNullOrEmpty() || senderId != viewerId) return false
        val text = autoCheckText(content, attachmentKind, transcript, transcriptStatus)
        return text.isNotEmpty() && autoCheckStatus == "improvable" && autoCheckText == text
    }

    /**
     * Port of coachDeepLink: `/coach?text=…&action=check[&from_message=<id>]`, encoded like
     * URLSearchParams (application/x-www-form-urlencoded: space → '+', only `*-._` and
     * alphanumerics kept — the same set as [java.net.URLEncoder]).
     */
    fun coachDeepLink(req: CoachRequest, messageId: String?): String {
        fun enc(s: String) = java.net.URLEncoder.encode(s, Charsets.UTF_8)
        val q = StringBuilder("text=").append(enc(req.text)).append("&action=").append(enc(req.action))
        if (!messageId.isNullOrEmpty()) q.append("&from_message=").append(enc(messageId))
        return "/coach?$q"
    }

    /** Port of sayBetterLabel. */
    fun label(state: String?, tutorName: String?): String = when (state) {
        CORRECTED -> "${(tutorName?.takeIf { it.isNotEmpty() } ?: "Your tutor").split(" ")[0]} corrected this — hold to see"
        IMPROVABLE -> "Could be better — hold to see"
        else -> ""
    }

    /** Port of autoCheckSettingShown: the stored choice, else on unless it is a tutor account. */
    fun settingShown(setting: Boolean?, accountRole: String?): Boolean = setting ?: (accountRole != "tutor")
}
