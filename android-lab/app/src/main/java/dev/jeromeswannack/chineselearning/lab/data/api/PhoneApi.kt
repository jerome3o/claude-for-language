package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaMessage
import dev.jeromeswannack.chineselearning.lab.core.phone.PersonaReply
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.ui.phone.PersonaOfflineException
import kotlinx.serialization.Serializable
import java.io.IOException

/* 📱 Phone practice — the persona chat, the same endpoint as the web's api/phone.ts (worker routes/phone.ts). */

@Serializable
data class PersonaReplyBody(val scenario_id: String, val persona_id: String, val messages: List<PersonaMessage>, val context: String? = null)

/**
 * `POST /api/phone/persona-reply` — Claude playing the persona. No connection → [PersonaOfflineException]
 * (the chat shows "对方暂时无法回复（需要联网）" + 重试); an HTTP error is rethrown as is.
 */
suspend fun Api.personaReply(body: PersonaReplyBody): PersonaReply = try {
    post<PersonaReplyBody, PersonaReply>("/api/phone/persona-reply", body)
} catch (e: HttpException) {
    throw e
} catch (e: UnauthorizedException) {
    throw e
} catch (e: IOException) {
    throw PersonaOfflineException(e)
}
