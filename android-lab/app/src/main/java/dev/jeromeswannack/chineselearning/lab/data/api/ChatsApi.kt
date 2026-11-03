package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.data.Api

/**
 * `GET /api/me/chats?exclude_ai=1` — the Chats tab: every conversation, last message, unread, newest
 * first; without the old Claude practice chats already in the Claude threads (they show as practice
 * threads; new role-plays are threads — docs/CHAT.md "Practice with Claude").
 */
suspend fun Api.chatList(): ChatListResponse = get("/api/me/chats?exclude_ai=1")
