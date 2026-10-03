package dev.jeromeswannack.chineselearning.lab.core.chat

import dev.jeromeswannack.chineselearning.lab.core.Js

/**
 * Port of shared/chats/listening.ts — chat listening mode (docs/CHAT.md "Listening mode"): the
 * other person's Chinese text messages arrive as a hidden bubble; a tap plays it, a long press
 * reveals it. Parity-tested by parity/fixtures/chat-listening.ts → ChatListeningParityTest.
 *
 * Times are ISO strings compared as strings (UTF-16 code units, like JS `>`).
 */
object ChatListening {
    /** `LISTENING_PREVIEW`: what a notification / the inbox shows instead of a hidden message. */
    const val LISTENING_PREVIEW = "🎧 New message"

    /** `HIDE_ALL_SINCE`: "Hide all" — every message of the other person hides (except revealed ones). */
    const val HIDE_ALL_SINCE = "1970-01-01T00:00:00.000Z"

    /** `LISTENING_PREFETCH_COUNT`: how many of a conversation's newest messages get their clip prefetched. */
    const val LISTENING_PREFETCH_COUNT = 20

    /** `REVEALED_MAX`: most revealed ids remembered per conversation (oldest dropped first). */
    const val REVEALED_MAX = 500

    /** `ListeningSetting`: [since] = messages created AFTER it hide; null = not decided yet. */
    data class Setting(val on: Boolean, val since: String?)

    /** `ListeningMessage`. [attachmentKind] 'image' | 'voice' | 'file' | 'video' stays as is. */
    data class Message(
        val id: String,
        val senderId: String,
        val content: String,
        val createdAt: String,
        val deletedAt: String? = null,
        val attachmentKind: String? = null,
    )

    /** The inbox row's newest message (`ChatListLastMessage` + `deleted`). */
    data class LastMessage(
        val id: String,
        val senderId: String,
        val createdAt: String,
        val preview: String,
        val attachmentKind: String? = null,
        val deleted: Boolean = false,
    )

    private fun isHanUnit(c: Char): Boolean = c in '一'..'鿿' || c in '㐀'..'䶿'

    /** Port of hasHan(): `/[一-鿿㐀-䶿]/` (BMP code units, no `u` flag). */
    fun hasHan(text: String): Boolean = text.any(::isHanUnit)

    /** Port of effectiveListening(): the conversation's own row, else the account default (not decided yet). */
    fun effectiveListening(row: Setting?, defaultOn: Boolean): Setting = row?.let { Setting(it.on, it.since) } ?: Setting(defaultOn, null)

    /** Port of listeningCandidate(): the other person's, not deleted, plain text with Chinese. */
    fun listeningCandidate(msg: Message, viewerId: String): Boolean {
        if (msg.senderId == viewerId) return false
        if (!msg.deletedAt.isNullOrEmpty()) return false
        if (!msg.attachmentKind.isNullOrEmpty()) return false
        return hasHan(msg.content)
    }

    /** Port of listeningThreshold(): `since`, else the read marker the chat opened with, else everything. */
    fun listeningThreshold(setting: Setting, readMarkerAtOpen: String?): String = setting.since ?: readMarkerAtOpen ?: HIDE_ALL_SINCE

    /** Port of shouldHideMessage(). */
    fun shouldHideMessage(msg: Message, viewerId: String, setting: Setting, readMarkerAtOpen: String? = null, revealed: Collection<String> = emptyList()): Boolean {
        if (!setting.on) return false
        if (!listeningCandidate(msg, viewerId)) return false
        if (msg.id in revealed) return false
        return msg.createdAt > listeningThreshold(setting, readMarkerAtOpen)
    }

    /** Port of sinceWhenTurnedOn(): the newest message time on screen, else [nowIso]. */
    fun sinceWhenTurnedOn(createdAts: Iterable<String>, nowIso: String): String {
        var newest = ""
        for (t in createdAts) if (t > newest) newest = t
        return newest.ifEmpty { nowIso }
    }

    /** Port of addRevealed(): [id] moved to the end, capped at the newest [max]. */
    fun addRevealed(revealed: List<String>, id: String, max: Int = REVEALED_MAX): List<String> {
        val next = revealed.filter { it != id } + id
        return if (next.size > max) next.subList(next.size - max, next.size).toList() else next
    }

    /** Port of listeningPreview(): "🎧 New message" while the row's newest message is hidden, else null. */
    fun listeningPreview(last: LastMessage?, viewerId: String, setting: Setting, readMarker: String? = null, revealed: Collection<String> = emptyList()): String? {
        if (last == null) return null
        val msg = Message(
            id = last.id, senderId = last.senderId, content = last.preview, createdAt = last.createdAt,
            deletedAt = if (last.deleted) last.createdAt else null,
            attachmentKind = last.attachmentKind,
        )
        return if (shouldHideMessage(msg, viewerId, setting, readMarker, revealed)) LISTENING_PREVIEW else null
    }

    /** Port of prefetchSelection(): the other person's Chinese text messages, newest first, at most [limit]. */
    fun <T> prefetchSelection(messages: List<T>, viewerId: String, limit: Int = LISTENING_PREFETCH_COUNT, of: (T) -> Message): List<T> {
        val out = ArrayList<T>()
        var i = messages.size - 1
        while (i >= 0 && out.size < limit) {
            val m = messages[i]
            if (listeningCandidate(of(m), viewerId)) out += m
            i--
        }
        return out
    }

    /** JS `\s`. */
    private fun isJsSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000b', '\u000c', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    private fun isLatinOrDigit(c: Char): Boolean = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9'

    /** Port of estimateSpeechSeconds(): ~3 characters a second, ~2 Latin words a second, at least 1. */
    fun estimateSpeechSeconds(text: String): Double {
        // `for (const ch of text)` walks code points; a surrogate pair never matches the BMP class.
        var han = 0
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            if (Character.charCount(cp) == 1 && isHanUnit(cp.toChar())) han++
            i += Character.charCount(cp)
        }
        // replace(han → ' ').split(/\s+/).filter(/[A-Za-z0-9]/)
        var words = 0
        val token = StringBuilder()
        fun flush() {
            if (token.any(::isLatinOrDigit)) words++
            token.setLength(0)
        }
        for (c in text) {
            val ch = if (isHanUnit(c)) ' ' else c
            if (isJsSpace(ch)) flush() else token.append(ch)
        }
        flush()
        return maxOf(1.0, Js.round(han / 3.0 + words / 2.0))
    }

    /** Port of formatListeningDuration(): "0:04". */
    fun formatListeningDuration(seconds: Double): String {
        val s = maxOf(0.0, Js.round(seconds)).toLong()
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /**
     * Port of listeningBars(): [count] heights in 0.25..1, stable per message id (FNV-1a over
     * UTF-16 units, then an LCG) — Int arithmetic wraps exactly like `Math.imul` / `>>> 0`.
     */
    fun listeningBars(id: String, count: Int = 24): List<Double> {
        var h = 0x811c9dc5.toInt()
        for (c in id) h = (h xor c.code) * 0x01000193
        var s = h
        val out = ArrayList<Double>(maxOf(count, 0))
        for (i in 0 until count) {
            s = s * 1664525 + 1013904223
            val v = (s.toLong() and 0xffffffffL).toDouble() / 4294967296.0
            val env = 0.6 + 0.4 * StrictMath.sin((Math.PI * (i + 0.5)) / count)
            out += Js.round((0.25 + 0.75 * v * env) * 100) / 100
        }
        return out
    }
}
