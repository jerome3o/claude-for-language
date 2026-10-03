package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.data.Api

/** `GET /api/me/chats` — the Chats tab: every conversation, last message, unread, newest first. */
suspend fun Api.chatList(): ChatListResponse = get("/api/me/chats")
