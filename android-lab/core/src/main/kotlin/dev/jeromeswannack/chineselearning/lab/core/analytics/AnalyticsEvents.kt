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
        ev("voice_input.used", "app", listOf("surface", "outcome", "via", "live_error", "speech_ms", "ms", "blocked")),
        ev("study.session_start", "study", listOf("scope", "due", "new_cards", "offline")),
        ev("study.session_end", "study", listOf("reviews", "duration_ms", "reason")),
        ev("study.card_rated", "study", listOf("rating", "card_type", "queue", "time_ms", "recorded", "multiple_choice")),
        ev("study.ask_claude", "study", listOf("card_type", "language", "quick")),
        ev("study.ask_claude_language", "study", listOf("language", "source")),
        ev("study.ask_claude_tool", "study", listOf("action", "role")),
        ev("study.ask_claude_listening", "study", listOf("on", "source")),
        ev("study.ask_claude_listen_play", "study", listOf("auto", "slow")),
        ev("study.ask_claude_listen_reveal", "study", emptyList()),
        ev("study.edit_card", "study", emptyList()),
        ev("study.flag_card", "study", emptyList()),
        ev("study.sentence_coach", "study", emptyList()),
        ev("study.write_it", "study", emptyList()),
        ev("progress.known_mode", "study", listOf("mode")),
        ev("study.take_transcribed", "study", listOf("via", "live_error", "ms", "where")),
        ev("study.answer_spoken", "study", listOf("card_type", "result", "via", "live_error", "speech_ms", "ms", "auto_submit", "retry", "reviewed", "edited", "practice", "where")),
        ev("study.spoken_answer_checked", "study", listOf("card_type", "verdict", "retry", "reviewed", "practice", "where")),
        ev("study.you_said_coach", "study", listOf("card_type", "source", "where")),
        ev("study.you_said_play", "study", listOf("card_type", "where")),
        ev("study.deck_pill", "study", listOf("action", "where")),
        ev("study.char_sheet_open", "study", listOf("found", "words")),
        ev("study.char_word_tap", "study", listOf("status", "current")),
        ev("study.char_word_added", "study", emptyList()),
        ev("study.char_explain", "study", emptyList()),
        ev("explorer.open", "study", listOf("source", "kind")),
        ev("explorer.push", "study", listOf("kind", "from", "depth")),
        ev("explorer.more", "study", listOf("kind")),
        ev("explorer.add_card", "study", emptyList()),
        ev("explorer.bump", "study", emptyList()),
        ev("explorer.drill_start", "study", listOf("kind", "items")),
        ev("explorer.drill_finish", "study", listOf("kind", "items", "correct", "duration_ms")),
        ev("explorer.write", "study", emptyList()),
        ev("study.word_tag_open", "study", listOf("kind", "tag", "source", "tag_source")),
        ev("study.study_more", "study", listOf("count")),
        ev("study.new_cards_paused", "study", listOf("load", "limit")),
        ev("study.celebration", "study", listOf("reviews", "active_ms")),
        ev("study.long_term_toggle", "study", listOf("value")),
        ev("study.sentence_reveal", "study", listOf("step")),
        ev("study.sentence_explain", "study", emptyList()),
        ev("study.tutor_note_practice", "study", listOf("count")),
        ev("study.tutor_model_play", "study", listOf("where", "which")),
        ev("study.bump_added", "study", listOf("source", "count", "already")),
        ev("study.bump_studied", "study", listOf("card_type", "queue")),
        ev("study.bump_cleared", "study", listOf("source")),
        ev("study.up_next_added", "study", listOf("source", "count", "already")),
        ev("study.up_next_moved", "study", listOf("how")),
        ev("study.up_next_removed", "study", listOf("source")),
        ev("homework.pass_start", "homework", listOf("kind", "items")),
        ev("homework.pass_item", "homework", listOf("result", "card_type", "answered", "suggested", "followed")),
        ev("homework.pass_done", "homework", listOf("kind", "items")),
        ev("homework.pass_undo", "homework", listOf("result", "reopened")),
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
        ev("chat.listening_part", "chat", listOf("how")),
        ev("chat.listening_reveal", "chat", emptyList()),
        ev("chat.inbox_open", "chat", listOf("conversations", "unread")),
        ev("chat.album_sent", "chat", listOf("count", "offline")),
        ev("chat.album_viewer_open", "chat", listOf("count", "index")),
        ev("chat.system_action", "chat", listOf("kind")),
        ev("call.start", "calls", listOf("solo")),
        ev("call.join", "calls", listOf("role")),
        ev("call.leave", "calls", listOf("duration_ms")),
        ev("call.end", "calls", listOf("duration_ms")),
        ev("call.board", "calls", listOf("tile")),
        ev("call.board_page", "calls", listOf("action")),
        ev("call.board_gloss", "calls", listOf("direction", "via")),
        ev("call.screen_share", "calls", listOf("on", "sound")),
        ev("call.annotate", "calls", listOf("target")),
        ev("call.desktop_overlay", "calls", listOf("on", "draw")),
        ev("call.material_present", "calls", listOf("material_kind", "pages")),
        ev("material.contents_open", "calls", listOf("where", "source", "entries")),
        ev("material.contents_jump", "calls", listOf("where", "source")),
        ev("call.activity_start", "calls", listOf("activity_kind", "role")),
        ev("call.activity_word_add", "calls", listOf("activity_kind", "word_kind", "where")),
        ev("call.prepared_activity_start", "calls", listOf("activity_kind", "position")),
        ev("call.layout", "calls", listOf("preset")),
        ev("call.view_mode", "calls", listOf("mode")),
        ev("call.view_bring", "calls", listOf("mode")),
        ev("call.view_join", "calls", emptyList()),
        ev("call.timer", "calls", listOf("action", "mode", "minutes")),
        ev("call.presence_alert", "calls", listOf("kind", "sound")),
        ev("call.sounds", "calls", listOf("on")),
        ev("call.annot_pip", "calls", emptyList()),
        ev("call.review_open", "calls", emptyList()),
        ev("call.homework_from_call", "calls", emptyList()),
        ev("group.create", "calls", listOf("students")),
        ev("group.class_start", "calls", listOf("students", "reused")),
        ev("group.notify", "calls", listOf("sent")),
        ev("group.join", "calls", listOf("role", "people")),
        ev("group.leave", "calls", listOf("duration_ms")),
        ev("group.end", "calls", listOf("duration_ms", "people")),
        ev("group.control", "calls", listOf("kind")),
        ev("group.screen_share", "calls", listOf("on")),
        ev("group.quiz", "calls", listOf("action", "options")),
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
        ev("tutor.budget_change", "tutor", listOf("new_cards", "secondary_cards", "reset", "pause_over")),
        ev("tutor.student_profile_save", "tutor", emptyList()),
        ev("tutor.prepared_activities_prepare", "tutor", listOf("source", "ready")),
        ev("tutor.prepared_activity_preview", "tutor", listOf("activity_kind", "source")),
        ev("tutor.prepared_activity_dismiss", "tutor", listOf("activity_kind", "source")),
        ev("tutor.recording_mark", "tutor", listOf("status", "source")),
        ev("tutor.model_recording_saved", "tutor", listOf("replaced", "duration_ms", "source")),
        ev("tutor.model_recording_removed", "tutor", listOf("source")),
        ev("tutor.recording_queue_open", "tutor", listOf("view", "items", "scoring")),
        ev("tutor.recording_reference_play", "tutor", listOf("source")),
        ev("tutor.flag_reply", "tutor", emptyList()),
        ev("tutor.queue_move", "tutor", listOf("to")),
        ev("tutor.invite_create", "tutor", listOf("decks")),
        ev("tutor.insights_summary", "tutor", emptyList()),
        ev("tutor.try_as_student", "tutor", listOf("kind")),
        ev("reader.open", "readers", listOf("source", "pages")),
        ev("reader.finish", "readers", listOf("how", "rating", "pages")),
        ev("reader.story_play", "readers", listOf("from_page", "pages", "speed", "offline")),
        ev("reader.story_stop", "readers", listOf("page", "pages")),
        ev("reader.word_tap", "readers", emptyList()),
        ev("reader.word_more", "readers", emptyList()),
        ev("reader.word_add_card", "readers", emptyList()),
        ev("reader.generate", "readers", emptyList()),
        ev("reader.editor_save", "readers", listOf("pages")),
        ev("reader.audio_block", "readers", listOf("action")),
        ev("reader.speed_changed", "readers", listOf("speed")),
        ev("quest.generate", "quests", listOf("difficulty")),
        ev("quest.play", "quests", emptyList()),
        ev("quest.complete", "quests", listOf("moves")),
        ev("picture_hunt.create", "picture_hunt", listOf("source")),
        ev("picture_hunt.play_done", "picture_hunt", listOf("found", "total", "gave_up")),
        ev("idioms.open", "idioms", listOf("source", "cached")),
        ev("idioms.generate", "idioms", listOf("status", "retry"), server = true),
        ev("idioms.add_card", "idioms", emptyList()),
        ev("idioms.quiz", "idioms", listOf("correct", "total")),
        ev("meme_review.open", "meme_review", listOf("source", "cached", "items")),
        ev("meme_review.item_open", "meme_review", listOf("item", "position")),
        ev("meme_review.link_out", "meme_review", listOf("link", "kind", "platform")),
        ev("meme_review.add_card", "meme_review", listOf("item")),
        ev("meme_review.quiz_finish", "meme_review", listOf("correct", "total")),
        ev("meme_review.make_lesson", "meme_review", listOf("status")),
        ev("meme_review.generate", "meme_review", listOf("via", "regenerate"), server = true),
        ev("meme_review.ready", "meme_review", listOf("items", "searches", "images"), server = true),
        ev("meme_review.lesson_ready", "meme_review", emptyList(), server = true),
        ev("audio_lesson.create", "lessons", listOf("format", "target_minutes", "chunks")),
        ev("audio_lesson.play", "lessons", listOf("format", "offline", "resumed")),
        ev("audio_lesson.complete", "lessons", listOf("format", "duration_ms")),
        ev("audio_lesson.sleep_timer", "lessons", listOf("minutes", "format")),
        ev("audio_lesson.download", "lessons", listOf("format")),
        ev("audio_lesson.podcast_feed", "lessons", listOf("action")),
        ev("audio_lesson.music", "lessons", listOf("on", "format", "volume_pct")),
        ev("podcast.subscribe", "lessons", listOf("suggested", "episodes"), server = true),
        ev("podcast.unsubscribe", "lessons", emptyList()),
        ev("podcast.transcribe", "lessons", listOf("shared", "status"), server = true),
        ev("podcast.open", "lessons", listOf("status", "offline", "segments")),
        ev("podcast.download", "lessons", listOf("mb")),
        ev("podcast.segment_play", "lessons", listOf("slow", "replay", "auto")),
        ev("podcast.reveal", "lessons", listOf("step")),
        ev("podcast.add_card", "lessons", listOf("count", "existing")),
        ev("podcast.make_lesson", "lessons", listOf("from")),
        ev("podcast.lesson_created", "lessons", listOf("exercises", "segments"), server = true),
        ev("lesson.start", "lessons", listOf("source", "exercises", "mode")),
        ev("lesson.complete", "lessons", listOf("rating", "source", "duration_ms", "mode", "missed", "scored", "retries")),
        ev("lesson.replay", "lessons", listOf("from", "practice", "revision", "status")),
        ev("lesson.resume", "lessons", listOf("source", "mode", "exercises", "at")),
        ev("lesson.retry", "lessons", listOf("type", "right", "left")),
        ev("lesson.start_over", "lessons", listOf("source")),
        ev("lesson.audio", "lessons", listOf("source", "hits", "misses", "stale", "max_wait_ms", "clips", "prefetched")),
        ev("lesson.replay_practice", "lessons", listOf("exercises", "duration_ms"), replacedBy = "lesson.complete"),
        ev("lesson.unlock", "lessons", listOf("via", "kind")),
        ev("lesson.companion_created", "lessons", listOf("unlock", "format", "exercises", "rounds", "replaced"), server = true),
        ev("lesson.companion_request", "lessons", listOf("format")),
        ev("study.done_for_good", "study", listOf("kind", "source"), replacedBy = "lesson.complete"),
        ev("study.bring_back", "study", listOf("kind"), replacedBy = "lesson.replay"),
        ev("lesson.grammar_start", "lessons", emptyList(), replacedBy = "lesson.start"),
        ev("lesson.editor_save", "lessons", emptyList()),
        ev("lesson.catalogue_try", "lessons", listOf("exercise_type")),
        ev("lesson.answer_check", "lessons", listOf("verdict", "ms", "cached", "exercise_type", "input", "try")),
        ev("lesson.answer_retry", "lessons", listOf("verdict", "exercise_type", "try")),
        ev("lesson.answer_ask", "lessons", listOf("verdict", "exercise_type", "turn")),
        ev("lesson.conversation_audio_open", "lessons", listOf("provider")),
        ev("lesson.conversation_audio_speed", "lessons", listOf("speed", "provider", "source")),
        ev("lesson.conversation_audio_voice", "lessons", listOf("provider", "gender", "automatic")),
        ev("lesson.conversation_audio_delivery", "lessons", listOf("delivery", "provider", "source")),
        ev("lesson.conversation_audio_regenerate", "lessons", listOf("lines", "provider")),
        ev("coach.start", "coach", listOf("action")),
        ev("coach.quick_action", "coach", listOf("action")),
        ev("coach.follow_up", "coach", emptyList()),
        ev("coach.reply_resumed", "coach", emptyList()),
        ev("coach.reply_retry", "coach", emptyList()),
        ev("coach.add_new_words", "coach", listOf("count", "existing")),
        ev("coach.sentence_card", "coach", emptyList()),
        ev("coach.mistake_lesson_generate", "coach", listOf("existing")),
        ev("coach.mistake_lesson_play", "coach", listOf("exercises", "saved")),
        ev("coach.mistake_lesson_save", "coach", listOf("done", "rating", "missed")),
        ev("coach.mistake_lesson_written", "coach", listOf("exercises", "types", "rounds"), server = true),
        ev("chat.open_in_coach", "chat", listOf("source", "action")),
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
        ev("card.picture_generate", "decks", listOf("regenerate", "where")),
        ev("card.picture_upload", "decks", listOf("camera", "where")),
        ev("card.picture_remove", "decks", listOf("where")),
        ev("card.picture_open", "study", listOf("side", "card_type")),
        ev("deck.illustrate", "decks", listOf("pictures")),
        ev("deck.illustrate_new", "decks", listOf("on")),
        ev("folder.create", "decks", listOf("kind", "nested")),
        ev("folder.rename", "decks", listOf("kind")),
        ev("folder.delete", "decks", listOf("kind", "items")),
        ev("folder.move_items", "decks", listOf("kind", "count", "unfiled")),
        ev("folder.move_folder", "decks", listOf("kind", "depth")),
        ev("settings.change", "settings", listOf("setting", "value")),
        ev("settings.revisit_changed", "settings", listOf("fields", "reset", "new_lessons_per_day"), replacedBy = "lesson.complete"),
        ev("settings.new_card_order", "settings", listOf("field", "reset", "new_characters_first", "new_words_first", "most_common_first", "sentences_last", "known_characters_english_first", "everyday_first")),
        ev("settings.analytics", "settings", listOf("on")),
        ev("settings.full_sync", "settings", emptyList()),
        ev("settings.debug_report", "settings", emptyList()),
        ev("settings.sign_out_all", "settings", emptyList()),
        ev("notification.tapped", "notifications", listOf("kind")),
        ev("error.shown", "errors", listOf("code", "where", "status")),
        ev("server.content_created", "server", listOf("kind", "count", "via"), server = true),
        ev("server.audio_lesson_built", "server", listOf("format", "minutes", "clips"), server = true),
        ev("server.podcast_transcribed", "server", listOf("ok", "stage", "minutes", "segments"), server = true),
        ev("server.podcast_feed_fetched", "server", listOf("items"), server = true),
        ev("server.homework_assigned", "server", listOf("kind", "mode", "count"), server = true),
        ev("server.ai_call", "server", listOf("provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cost_usd", "status", "route"), server = true),
        ev("server.push_sent", "server", listOf("channel", "kind", "ok"), server = true),
        ev("server.email_sent", "server", listOf("kind", "ok"), server = true),
        ev("server.word_tags_batch", "server", listOf("batch_size", "tagged", "shown", "everyday", "input_tokens", "output_tokens", "cost_usd", "via"), server = true),
        ev("server.word_tags_backfill", "server", listOf("queued", "via"), server = true),
        ev("server.prepared_activities", "server", listOf("trigger", "count", "refused", "rounds", "input_tokens", "output_tokens", "ms"), server = true),
        ev("server.recording_check", "server", listOf("scored", "match", "note", "audio_ms"), server = true),
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
    val PLATFORMS: List<String> = listOf("web", "pwa", "android-hybrid", "lab", "desktop")

    /** Port of ANALYTICS_LEVELS: off = nothing; basic = no screen views / per-card events; verbose = everything. */
    val LEVELS: List<String> = listOf("off", "basic", "verbose")

    /** Port of VERBOSE_ONLY_EVENTS: high-volume events dropped at the `basic` level. */
    val VERBOSE_ONLY_EVENTS: List<String> = listOf(
        "app.screen_view",
        "study.card_rated",
        "study.sentence_reveal",
        "homework.pass_item",
        "reader.word_tap",
        "explorer.push",
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
