package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatAutoCheckSamples as A
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/** docs/CHAT.md "Chat ↔ Coach": a photo whose caption the auto-check found something in. */
object ChatCoachSamples {
    private val now = Instant.now()
    private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()

    /** Mine: a photo with the caption 我昨天去了商店买东西了, checked (the last of its group, so the time shows too). */
    val photo = ChatMessageDto(
        "ph", conversation_id = "c1", sender_id = "me", sender = S.me, content = A.TEXT, created_at = at(14),
        attachment = ChatAttachmentDto(kind = "image", width = 1200, height = 900, mime = "image/jpeg"), auto_check = A.check,
    )

    /** Mine: a voice message whose transcript was checked. */
    val voice = ChatMessageDto(
        "vo", conversation_id = "c1", sender_id = "me", sender = S.me, content = "", created_at = at(13),
        attachment = ChatAttachmentDto(kind = "voice", duration_ms = 3200, transcript_status = "done", transcript = A.TEXT), auto_check = A.check,
    )

    val ui = S.student.copy(messages = listOf(A.m1, photo, A.m5.copy(created_at = at(10))), aids = dev.jeromeswannack.chineselearning.lab.core.ChatLearning.Aids(), otherReadAt = at(9))
}
