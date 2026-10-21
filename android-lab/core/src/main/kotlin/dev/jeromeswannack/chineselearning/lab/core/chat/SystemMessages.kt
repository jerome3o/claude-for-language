package dev.jeromeswannack.chineselearning.lab.core.chat

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Port of shared/chats/system.ts — system messages (docs/CHAT.md "System messages"): lines the
 * platform posts into a chat on someone's behalf (the tutor changed the daily new cards, a video
 * call started, a card was flagged / a flag answered, the install how-to, a group-class link).
 * The person stays the sender, but the row is drawn from `system_kind` + `system_data`, third
 * person, from the VIEWER's side. Parity-tested (parity/fixtures/chat-system.ts → ChatSystemParityTest).
 */
object SystemMessages {
    val KINDS = listOf("study_budget", "call_started", "card_flag", "flag_reply", "install_howto", "group_class")

    /** `SystemContext`. */
    data class Context(
        val viewerIsSender: Boolean,
        /** The OTHER person in the chat. */
        val otherName: String?,
        val relationshipId: String? = null,
    )

    data class Action(val label: String, val path: String)

    /** `SystemMessageView`. [kind] = one of [KINDS] or "unknown". */
    data class View(
        val kind: String,
        val icon: String,
        val text: String,
        val quote: String? = null,
        val body: String? = null,
        val action: Action? = null,
        val quiet: Boolean = false,
    )

    fun isSystemMessage(kind: String?): Boolean = kind != null && NoteSearch.jsTrim(kind).isNotEmpty()

    private const val JS_SPACE = "\t\n\u000B\u000C\r                  　﻿"
    private val JS_SPACE_RUN = Regex("[\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

    /** Port of systemFirstName(): the first word of a name, else [fallback]. */
    fun firstName(name: String?, fallback: String): String {
        val trimmed = (name ?: "").trim { it in JS_SPACE }
        return trimmed.split(JS_SPACE_RUN)[0].ifEmpty { fallback }
    }

    private fun capitalise(s: String): String = if (s.isEmpty()) s else s.substring(0, 1).uppercase() + s.substring(1)

    /** The stored data: a JSON object, or the raw JSON string; anything else = empty. */
    private fun record(data: JsonElement?): JsonObject {
        if (data is JsonObject) return data
        if (data is JsonPrimitive && data.isString) {
            return try {
                Json.parseToJsonElement(data.content) as? JsonObject ?: JsonObject(emptyMap())
            } catch (_: Exception) {
                JsonObject(emptyMap())
            }
        }
        return JsonObject(emptyMap())
    }

    private fun JsonObject.str(key: String): String {
        val v = this[key] as? JsonPrimitive ?: return ""
        return if (v.isString) NoteSearch.jsTrim(v.content) else ""
    }

    private fun JsonObject.number(key: String): Double? {
        val v = this[key] as? JsonPrimitive ?: return null
        if (v.isString) return null
        return v.doubleOrNull?.takeIf { v.booleanOrNull == null }
    }

    private fun JsonObject.isTrue(key: String): Boolean {
        val v = this[key] as? JsonPrimitive ?: return false
        return !v.isString && v.booleanOrNull == true
    }

    private fun count(v: Double?): String {
        val n = if (v != null && v.isFinite()) maxOf(0.0, kotlin.math.floor(v)) else 0.0
        return Js.numberToString(n)
    }

    private fun budgetNumbers(d: JsonObject): String {
        val secondary = count(d.number("secondary_cards_per_day"))
        val extra = if (secondary != "0") " (+$secondary extra)" else " (no extra cards)"
        return "${count(d.number("new_cards_per_day"))} a day$extra"
    }

    /** Port of installHowToSteps(). */
    fun installHowToSteps(appUrl: String?): String {
        val url = NoteSearch.jsTrim(appUrl ?: "").ifEmpty { "the app’s address" }
        return "Android app (recommended):\n" +
            "1. Install Obtainium from the Play Store or https://github.com/ImranR98/Obtainium\n" +
            "2. In Obtainium tap \"Add App\" and paste https://github.com/jerome3o/claude-for-language\n" +
            "3. Install the app it finds, open it and sign in with Google once.\n\n" +
            "Or add a home-screen shortcut: open $url in Chrome, tap the ⋮ menu → \"Add to Home screen\" / \"Install app\".\n\n" +
            "Once it is installed, open it while you have internet so your words and audio download. After that it works without a connection."
    }

    private fun cardPath(noteId: String, tutorSide: Boolean, relationshipId: String?): String? {
        if (noteId.isEmpty()) return null
        if (!tutorSide) return "/cards/${Js.encodeURIComponent(noteId)}"
        val rel = NoteSearch.jsTrim(relationshipId ?: "")
        return if (rel.isNotEmpty()) "/connections/${Js.encodeURIComponent(rel)}/cards/${Js.encodeURIComponent(noteId)}" else null
    }

    /** Port of systemMessageView(): how a system message reads for this viewer; null for an ordinary one. */
    fun view(kindRaw: String?, data: JsonElement?, content: String?, ctx: Context): View? {
        if (!isSystemMessage(kindRaw)) return null
        val kind = NoteSearch.jsTrim(kindRaw!!)
        val d = record(data)
        val me = ctx.viewerIsSender
        fun v(icon: String, text: String, quote: String? = null, body: String? = null, action: Action? = null, quiet: Boolean = false) =
            View(kind, icon, text, quote, body, action, quiet)
        fun fallback() = View("unknown", "ℹ️", NoteSearch.jsTrim(content ?: ""))

        when (kind) {
            "study_budget" -> {
                if (d.number("new_cards_per_day") == null) return fallback()
                val to = if (d.isTrue("is_default")) "back to the usual " else "to "
                val nums = budgetNumbers(d)
                return if (me) v("📚", "You set ${firstName(ctx.otherName, "your student")}'s new cards $to$nums")
                else v("📚", "${capitalise(firstName(ctx.otherName, "your tutor"))} set your new cards $to$nums")
            }
            "call_started" -> {
                val callId = d.str("call_id")
                val who = firstName(ctx.otherName, "someone")
                if (d.isTrue("ended")) {
                    if (d.isTrue("missed")) {
                        return if (me) v("📹", "Video call · ${capitalise(who)} didn't join", quiet = true)
                        else v("📹", "Missed video call from $who", quiet = true)
                    }
                    return v("📹", "Video call ended", quiet = true)
                }
                val action = if (callId.isNotEmpty()) Action("Join", "/calls/${Js.encodeURIComponent(callId)}") else null
                return if (me) v("📹", "You started a video call", action = action) else v("📹", "${capitalise(who)} started a video call", action = action)
            }
            "card_flag" -> {
                val hanzi = d.str("hanzi")
                if (hanzi.isEmpty()) return fallback()
                val quote = d.str("message").ifEmpty { null }
                val action = cardPath(d.str("note_id"), !me, ctx.relationshipId)?.let { Action("Open card", it) }
                return if (me) v("🚩", "You flagged $hanzi for ${firstName(ctx.otherName, "your tutor")}", quote = quote, action = action)
                else v("🚩", "${capitalise(firstName(ctx.otherName, "your student"))} flagged $hanzi for you", quote = quote, action = action)
            }
            "flag_reply" -> {
                val hanzi = d.str("hanzi")
                if (hanzi.isEmpty()) return fallback()
                val quote = d.str("reply").ifEmpty { null }
                val action = cardPath(d.str("note_id"), me, ctx.relationshipId)?.let { Action("Open card", it) }
                return if (me) v("🚩", "You replied about $hanzi", quote = quote, action = action)
                else v("🚩", "${capitalise(firstName(ctx.otherName, "your tutor"))} replied about $hanzi", quote = quote, action = action)
            }
            "install_howto" -> {
                val body = installHowToSteps(d.str("app_url").ifEmpty { null })
                return if (me) v("📲", "You sent ${firstName(ctx.otherName, "your student")} how to install the app", body = body)
                else v("📲", "${capitalise(firstName(ctx.otherName, "your tutor"))} sent you how to install the app", body = body)
            }
            "group_class" -> {
                val name = d.str("group_name")
                if (name.isEmpty()) return fallback()
                val session = d.str("session_id")
                val action = if (!me && session.isNotEmpty()) Action("Join", "/group-class/${Js.encodeURIComponent(session)}") else null
                val body = "An experimental group class: your tutor and a few other students on one video call."
                return if (me) v("🧪", "You sent ${firstName(ctx.otherName, "your student")} the link to the group class “$name”")
                else v("🧪", "${capitalise(firstName(ctx.otherName, "your tutor"))} started the group class “$name”", action = action, body = body)
            }
            else -> return fallback()
        }
    }

    /** Port of systemViewText(): icon + text (+ “quote”) on one line. */
    fun viewText(view: View): String {
        val line = if (view.icon.isNotEmpty() && view.kind != "unknown") "${view.icon} ${view.text}" else view.text
        return if (view.quote != null) "$line: “${view.quote}”" else line
    }

    /** Port of systemMessageText(): '' for an ordinary message. */
    fun text(kind: String?, data: JsonElement?, content: String?, ctx: Context): String = view(kind, data, content, ctx)?.let(::viewText) ?: ""
}
