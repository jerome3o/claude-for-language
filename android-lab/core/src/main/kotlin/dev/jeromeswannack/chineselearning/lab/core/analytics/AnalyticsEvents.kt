package dev.jeromeswannack.chineselearning.lab.core.analytics

/**
 * Port of shared/analytics/events.ts — the usage-event catalogue (docs/ANALYTICS.md): every
 * event the apps and the server may record, with the ONLY prop keys each may carry.
 * AnalyticsParityTest requires this list to equal the TypeScript one exactly (names, area,
 * props, server, replacedBy, the verbose-only list), so adding an event = one line in
 * events.ts + one line here.
 *
 * PRIVACY RULE: props are ids, enums, counts, durations and booleans ONLY — never message
 * text, card content, typed answers, recordings, transcripts, tokens, URLs or e-mails.
 * [AnalyticsPrivacy.sanitizeProps] enforces it before anything is queued.
 */
data class AnalyticsEventDef(
    val name: String,
    val area: String,
    val props: List<String>,
    /** Written by the worker, never sent by a client. */
    val server: Boolean = false,
    /** This is the OLD way; the named event is the new one. */
    val replacedBy: String? = null,
)

object AnalyticsEvents {
    private fun ev(name: String, area: String, props: List<String>, server: Boolean = false, replacedBy: String? = null) =
        AnalyticsEventDef(name, area, props, server, replacedBy)

    /** Port of ANALYTICS_EVENTS, in the same order. */
    val ALL: List<AnalyticsEventDef> = listOf(
        ev("app.open", "app", listOf("install_kind")),
        ev("app.screen_view", "app", listOf("duration_ms", "from")),
        ev("app.update_applied", "app", emptyList()),
        ev("study.session_start", "study", listOf("scope", "due", "new_cards", "offline")),
        ev("study.session_end", "study", listOf("reviews", "duration_ms", "reason")),
        ev("study.card_rated", "study", listOf("rating", "card_type", "queue", "time_ms", "recorded", "multiple_choice")),
        ev("study.ask_claude", "study", listOf("card_type")),
        ev("study.edit_card", "study", emptyList()),
        ev("study.flag_card", "study", emptyList()),
        ev("study.sentence_coach", "study", emptyList()),
        ev("study.write_it", "study", emptyList()),
        ev("study.study_more", "study", listOf("count")),
        ev("study.celebration", "study", listOf("reviews", "active_ms")),
        ev("study.long_term_toggle", "study", listOf("value")),
        ev("study.sentence_reveal", "study", listOf("step")),
        ev("study.sentence_explain", "study", emptyList()),
        ev("study.tutor_note_practice", "study", listOf("count")),
        ev("study.bump_added", "study", listOf("source", "count", "already")),
        ev("study.bump_studied", "study", listOf("card_type", "queue")),
        ev("study.bump_cleared", "study", listOf("source")),
        ev("homework.pass_start", "homework", listOf("kind", "items")),
        ev("homework.pass_item", "homework", listOf("result")),
        ev("homework.pass_done", "homework", listOf("kind", "items")),
        ev("chat.open", "chat", listOf("is_ai", "unread")),
        ev("chat.send", "chat", listOf("kind", "is_ai", "reply", "offline")),
        ev("chat.menu_action", "chat", listOf("action", "kind")),
        ev("chat.reaction", "chat", emptyList()),
        ev("chat.make_flashcards", "chat", listOf("count", "focus")),
        ev("chat.correction", "chat", emptyList()),
        ev("chat.check_draft", "chat", emptyList()),
        ev("chat.forward", "chat", listOf("kind")),
        ev("chat.search", "chat", listOf("results")),
        ev("chat.pinyin_toggle", "chat", listOf("aid", "on")),
        ev("chat.discuss", "chat", emptyList()),
        ev("chat.listening_mode", "chat", listOf("scope", "on")),
        ev("chat.listening_play", "chat", listOf("slow")),
        ev("chat.listening_reveal", "chat", emptyList()),
        ev("chat.inbox_open", "chat", listOf("conversations", "unread")),
        ev("call.start", "calls", listOf("solo")),
        ev("call.join", "calls", listOf("role")),
        ev("call.leave", "calls", listOf("duration_ms")),
        ev("call.end", "calls", listOf("duration_ms")),
        ev("call.board", "calls", listOf("tile")),
        ev("call.board_page", "calls", listOf("action")),
        ev("call.screen_share", "calls", listOf("on")),
        ev("call.annotate", "calls", listOf("target")),
        ev("call.material_present", "calls", listOf("material_kind", "pages")),
        ev("call.activity_start", "calls", listOf("activity_kind")),
        ev("call.layout", "calls", listOf("preset")),
        ev("call.review_open", "calls", emptyList()),
        ev("call.homework_from_call", "calls", emptyList()),
        ev("tutor.send_homework", "tutor", listOf("items", "mode", "kind", "split_days")),
        ev("tutor.remove_homework", "tutor", listOf("kind")),
        ev("tutor.lesson_notes_add", "tutor", listOf("draft")),
        ev("tutor.session_notes", "tutor", emptyList()),
        ev("tutor.homework_draft_message", "tutor", emptyList()),
        ev("tutor.homework_draft_assign", "tutor", listOf("items")),
        ev("tutor.library_save", "tutor", listOf("created")),
        ev("tutor.library_assign", "tutor", listOf("students")),
        ev("tutor.library_push_update", "tutor", emptyList()),
        ev("tutor.catalogue_copy", "tutor", listOf("exercise_type")),
        ev("tutor.budget_change", "tutor", listOf("new_cards", "secondary_cards", "reset")),
        ev("tutor.student_profile_save", "tutor", emptyList()),
        ev("tutor.recording_mark", "tutor", listOf("status")),
        ev("tutor.flag_reply", "tutor", emptyList()),
        ev("tutor.queue_move", "tutor", listOf("to")),
        ev("tutor.invite_create", "tutor", listOf("decks")),
        ev("tutor.insights_summary", "tutor", emptyList()),
        ev("tutor.try_as_student", "tutor", listOf("kind")),
        ev("reader.open", "readers", listOf("source", "pages")),
        ev("reader.finish", "readers", listOf("rating", "pages")),
        ev("reader.word_tap", "readers", emptyList()),
        ev("reader.word_more", "readers", emptyList()),
        ev("reader.word_add_card", "readers", emptyList()),
        ev("reader.generate", "readers", emptyList()),
        ev("reader.editor_save", "readers", listOf("pages")),
        ev("reader.audio_block", "readers", listOf("action")),
        ev("quest.generate", "quests", listOf("difficulty")),
        ev("quest.play", "quests", emptyList()),
        ev("quest.complete", "quests", listOf("moves")),
        ev("picture_hunt.create", "picture_hunt", listOf("source")),
        ev("picture_hunt.play_done", "picture_hunt", listOf("found", "total", "gave_up")),
        ev("lesson.start", "lessons", listOf("source", "exercises")),
        ev("lesson.complete", "lessons", listOf("rating", "source", "duration_ms")),
        ev("lesson.grammar_start", "lessons", emptyList(), replacedBy = "lesson.start"),
        ev("lesson.editor_save", "lessons", emptyList()),
        ev("lesson.catalogue_try", "lessons", listOf("exercise_type")),
        ev("coach.start", "coach", listOf("action")),
        ev("coach.quick_action", "coach", listOf("action")),
        ev("coach.follow_up", "coach", emptyList()),
        ev("deck.create", "decks", listOf("source")),
        ev("deck.generate", "decks", emptyList()),
        ev("deck.note_add", "decks", emptyList()),
        ev("deck.note_edit", "decks", listOf("where")),
        ev("deck.paste_list", "decks", listOf("added", "updated", "skipped", "failed")),
        ev("deck.enrich_words", "decks", listOf("words")),
        ev("deck.reorder", "decks", listOf("how")),
        ev("deck.export_anki", "decks", listOf("kind")),
        ev("deck.search", "decks", listOf("results", "server")),
        ev("deck.share", "decks", listOf("update")),
        ev("deck.check_issue_applied", "decks", listOf("field", "kind", "where")),
        ev("deck.check_issue_dismissed", "decks", listOf("field", "kind", "where")),
        ev("deck.check_started", "decks", listOf("words", "scope")),
        ev("deck.check_applied", "decks", listOf("count", "source", "scope")),
        ev("folder.create", "decks", listOf("kind", "nested")),
        ev("folder.rename", "decks", listOf("kind")),
        ev("folder.delete", "decks", listOf("kind", "items")),
        ev("folder.move_items", "decks", listOf("kind", "count", "unfiled")),
        ev("settings.change", "settings", listOf("setting", "value")),
        ev("settings.analytics", "settings", listOf("on")),
        ev("settings.full_sync", "settings", emptyList()),
        ev("settings.debug_report", "settings", emptyList()),
        ev("notification.tapped", "notifications", listOf("kind")),
        ev("error.shown", "errors", listOf("code", "where", "status")),
        ev("server.content_created", "server", listOf("kind", "count", "via"), server = true),
        ev("server.homework_assigned", "server", listOf("kind", "mode", "count"), server = true),
        ev("server.ai_call", "server", listOf("provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cost_usd", "status", "route"), server = true),
        ev("server.push_sent", "server", listOf("channel", "kind", "ok"), server = true),
        ev("server.email_sent", "server", listOf("kind", "ok"), server = true),
        ev("server.coach_auto_detect", "server", emptyList(), server = true, replacedBy = "coach.start"),
        ev("server.study_session_api", "server", emptyList(), server = true, replacedBy = "study.session_start"),
    )

    val BY_NAME: Map<String, AnalyticsEventDef> = ALL.associateBy { it.name }

    /** Port of isAnalyticsEvent. */
    fun isEvent(name: String?): Boolean = name != null && name in BY_NAME

    /** Port of isClientEvent: catalogue events a client may send (server events are refused). */
    fun isClientEvent(name: String?): Boolean = name != null && BY_NAME[name]?.server == false

    /** Port of SCREEN_REPLACED_BY (route patterns, screenName()). */
    val SCREEN_REPLACED_BY: Map<String, String> = mapOf("/search" to "/decks")

    /** Port of ANALYTICS_PLATFORMS; the Lab app is "lab". */
    val PLATFORMS: List<String> = listOf("web", "pwa", "android-hybrid", "lab")

    /** Port of ANALYTICS_LEVELS: off = nothing; basic = no screen views / per-card events; verbose = everything. */
    val LEVELS: List<String> = listOf("off", "basic", "verbose")

    /** Port of VERBOSE_ONLY_EVENTS: high-volume events dropped at the `basic` level. */
    val VERBOSE_ONLY_EVENTS: List<String> = listOf(
        "app.screen_view",
        "study.card_rated",
        "study.sentence_reveal",
        "homework.pass_item",
        "reader.word_tap",
        "reader.audio_block",
        "chat.listening_play",
    )

    /** Port of parseAnalyticsLevel (anything unknown = verbose). */
    fun parseLevel(raw: Any?): String {
        val s = (raw as? String)?.let { jsTrim(it).lowercase() } ?: return "verbose"
        return if (s in LEVELS) s else "verbose"
    }

    /** Port of eventAllowedAtLevel. */
    fun allowedAtLevel(name: String, level: String): Boolean = when (level) {
        "off" -> false
        "basic" -> name !in VERBOSE_ONLY_EVENTS
        else -> true
    }

    /** Port of USAGE_RETENTION_DAYS. */
    const val USAGE_RETENTION_DAYS = 180

    /** JS String.prototype.trim (whitespace + line terminators, incl. U+FEFF / U+3000 …). */
    internal fun jsTrim(s: String): String {
        fun ws(c: Char) = c == '﻿' || c == ' ' || c == ' ' || c in ' '..' ' ||
            c == ' ' || c == ' ' || c == ' ' || c == ' ' || c == '　' ||
            c == ' ' || c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r'
        return s.trim(::ws)
    }
}
