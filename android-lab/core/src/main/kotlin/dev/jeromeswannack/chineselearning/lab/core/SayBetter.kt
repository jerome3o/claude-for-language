package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Check my Chinese automatically" — the client half of shared/chats/autoCheck.ts (docs/CHAT.md
 * "Auto-check"): the indicator / sheet state of one message as its sender sees it, its accessible
 * label and the Settings switch's default. Parity-tested (parity/fixtures/chat-round2.ts →
 * ChatRound2ParityTest).
 */
object SayBetter {
    const val CORRECTED = "corrected"
    const val IMPROVABLE = "improvable"

    /**
     * Port of sayBetterState: 'corrected' (the tutor's correction wins) | 'improvable' (the
     * background check found something, about the current text) | null. Only the sender, only
     * live text messages. [correctionText] null with [hasCorrection] = a correction whose text is
     * not known here (treated as present).
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
    ): String? {
        if (!deletedAt.isNullOrEmpty() || senderId != viewerId || !attachmentKind.isNullOrEmpty()) return null
        if (hasCorrection && correctionText != "") return CORRECTED
        if (autoCheckStatus == "improvable" && autoCheckText == content) return IMPROVABLE
        return null
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
