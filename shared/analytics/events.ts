/**
 * The usage-event catalogue (docs/ANALYTICS.md): every event the apps and the
 * server may record, with the props each one may carry. ONE list for the web
 * app, the Lab app (android-lab/core/…/analytics/AnalyticsEvents.kt, parity-
 * tested against this file) and the worker (POST /api/analytics/events drops
 * names it does not know).
 *
 * Adding an event = one line here (+ the Kotlin mirror) and one `track(...)`
 * call where it happens.
 *
 * PRIVACY RULE: props are ids, enums, counts, durations and booleans ONLY.
 * Never message text, card content, typed answers, recordings, transcripts,
 * tokens, URLs or e-mail addresses. `sanitizeProps` (privacy.ts) enforces it:
 * a key not listed for the event is dropped, and so is any string value that is
 * not a short id / enum token.
 */

export type AnalyticsArea =
  | 'app'
  | 'study'
  | 'homework'
  | 'chat'
  | 'calls'
  | 'tutor'
  | 'readers'
  | 'quests'
  | 'picture_hunt'
  | 'idioms'
  | 'lessons'
  | 'coach'
  | 'decks'
  | 'settings'
  | 'notifications'
  | 'errors'
  | 'server';

export interface AnalyticsEventDef {
  area: AnalyticsArea;
  /** What it means, for the docs and the MCP tools. */
  description: string;
  /** The only prop keys this event may carry (privacy rule above). */
  props: readonly string[];
  /** Written by the worker, never sent by a client. */
  server?: boolean;
  /**
   * This event is the OLD way of doing something; the named event is the new
   * one. feature_adoption reports any use of it as "old path still in use".
   */
  replacedBy?: string;
}

const e = (
  area: AnalyticsArea,
  description: string,
  props: readonly string[] = [],
  extra: Pick<AnalyticsEventDef, 'server' | 'replacedBy'> = {}
): AnalyticsEventDef => ({ area, description, props, ...extra });

export const ANALYTICS_EVENTS = {
  // ── app ────────────────────────────────────────────────────────────────
  'app.open': e('app', 'The app was opened or came back after 30 min away (a new analytics session).', ['install_kind']),
  'app.screen_view': e('app', 'Left a screen; `screen` is the route pattern, duration_ms the time on it.', ['duration_ms', 'from']),
  'app.update_applied': e('app', 'A new app version was installed / reloaded.', []),

  // ── study ──────────────────────────────────────────────────────────────
  'study.session_start': e('study', 'Opened Study with cards to do.', ['scope', 'due', 'new_cards', 'offline']),
  'study.session_end': e('study', 'Left Study (or emptied the queue).', ['reviews', 'duration_ms', 'reason']),
  'study.card_rated': e('study', 'Rated a card.', ['rating', 'card_type', 'queue', 'time_ms', 'recorded', 'multiple_choice']),
  'study.ask_claude': e('study', 'Asked Claude about the card on screen (language = what the answer was asked in: zh | en; quick = a quick-question chip).', ['card_type', 'language', 'quick']),
  'study.ask_claude_language': e('study', 'Changed what Ask Claude answers in (中文 / English) — from Settings or the Ask Claude sheet header.', ['language', 'source']),
  'study.ask_claude_tool': e('study', 'Used a learning tool on an Ask Claude message: a word chip, a long-press menu item, the coach chip (role = mine | claude).', ['action', 'role']),
  'study.ask_claude_listening': e('study', 'Switched Ask Claude 🎧 Listen first on / off (Claude\'s Chinese answers arrive hidden) — from the sheet header or Settings.', ['on', 'source']),
  'study.ask_claude_listen_play': e('study', 'Ask Claude 🎧: a hidden answer played (auto = by itself when it arrived; slow = the 0.75× chip).', ['auto', 'slow']),
  'study.ask_claude_listen_reveal': e('study', 'Ask Claude 🎧: held (or 👁) a hidden answer to reveal its text.', []),
  'study.edit_card': e('study', 'Opened Edit card from a study card.', []),
  'study.flag_card': e('study', 'Flagged a card for the tutor.', []),
  'study.sentence_coach': e('study', 'Opened the Sentence coach from a study card.', []),
  'study.write_it': e('study', 'Opened stroke-order practice (Write it).', []),
  'study.take_transcribed': e('study', 'A pronunciation take got its "You said" (via = live | upload | failed | offline; live_error = why the live Soniox stream gave nothing: none | timeout | soniox_<code> | closed | empty | socket | no_session | aborted; ms = Stop → result).', ['via', 'live_error', 'ms']),
  'study.answer_spoken': e('study', 'Said the answer of a typing card with the 🎤 button (result = submitted | filled | failed | empty | cancelled; via = live | upload | none; live_error as in study.take_transcribed; speech_ms = how long the mic was open; ms = stop → transcript; auto_submit = "Submit spoken answers automatically").', ['card_type', 'result', 'via', 'live_error', 'speech_ms', 'ms', 'auto_submit']),
  'study.spoken_answer_checked': e('study', 'A spoken answer was checked on a typing card (verdict = exact | punctuation_only | equivalent | alternative | sound — a homophone | close — other tones | wrong).', ['card_type', 'verdict']),
  'study.char_sheet_open': e('study', 'Tapped a character on the card back: the character sheet (dictionary + words with it).', ['found', 'words']),
  'study.char_word_tap': e('study', 'Tapped a word in the character sheet\'s "Words with 字" list.', ['status', 'current']),
  'study.char_word_added': e('study', 'Added a word from the character sheet as a card.', []),
  'study.char_explain': e('study', '"More about 字" on the character sheet (short Claude explanation, cached for everyone).', []),
  // The language explorer (docs/LANGUAGE_EXPLORER.md): Character / Word views on a stack.
  'explorer.open': e('study', 'Opened the language explorer by tapping Chinese (source = where, kind = char / word).', ['source', 'kind']),
  'explorer.push': e('study', 'Tapped Chinese inside the explorer: another view pushed (kind = char / word, from = the view it was in).', ['kind', 'from', 'depth']),
  'explorer.more': e('study', '"More about this word" in the explorer\'s Word view.', ['kind']),
  'explorer.add_card': e('study', 'Added a word as a card from the explorer.', []),
  'explorer.bump': e('study', '"⚡ Study it today" from the explorer.', []),
  'explorer.drill_start': e('study', 'Started a quick drill from the explorer (kind = char / word; practice only, no review events).', ['kind', 'items']),
  'explorer.drill_finish': e('study', 'Finished a quick drill from the explorer.', ['kind', 'items', 'correct', 'duration_ms']),
  'explorer.write': e('study', '"✍️ Write it" from the explorer\'s Character view.', []),
  'study.study_more': e('study', 'Pressed Study More (bonus new cards).', ['count']),
  'study.celebration': e('study', "Emptied today's queue (the once-a-day celebration).", ['reviews', 'active_ms']),
  'study.long_term_toggle': e('study', '"Add to my long-term review" switched for a word.', ['value']),
  'study.sentence_reveal': e('study', 'Tapped an example sentence row open.', ['step']),
  'study.sentence_explain': e('study', '"What\'s going on here?" on an example sentence.', []),
  'study.tutor_note_practice': e('study', 'Practised cards from a tutor note.', ['count']),
  'study.bump_added': e('study', '"⚡ Study it today": bumped cards the learner already had to the front of today\'s queue.', ['source', 'count', 'already']),
  'study.bump_studied': e('study', 'Rated a card from the ⚡ bump pocket.', ['card_type', 'queue']),
  'study.bump_cleared': e('study', 'Took a word out of the ⚡ bump pocket by hand.', ['source']),

  // ── homework (student side) ────────────────────────────────────────────
  'homework.pass_start': e('homework', 'Opened a homework pass.', ['kind', 'items']),
  'homework.pass_item': e('homework', 'Answered one item of a homework pass.', ['result']),
  'homework.pass_done': e('homework', 'Finished a homework pass.', ['kind', 'items']),

  // ── chat ───────────────────────────────────────────────────────────────
  'chat.open': e('chat', 'Opened a conversation.', ['is_ai', 'unread']),
  'chat.send': e('chat', 'Sent a message.', ['kind', 'is_ai', 'reply', 'offline']),
  'chat.menu_action': e('chat', 'Chose an item in the message menu (long-press / ⋯).', ['action', 'kind']),
  'chat.reaction': e('chat', 'Reacted to a message.', []),
  'chat.make_flashcards': e('chat', 'Saved cards with Make flashcards.', ['count', 'focus']),
  'chat.correction': e('chat', 'The tutor corrected a message.', []),
  'chat.check_draft': e('chat', 'Check my Chinese on the compose box.', []),
  'chat.forward': e('chat', 'Forwarded a message.', ['kind']),
  'chat.search': e('chat', 'Searched inside a conversation.', ['results']),
  'chat.pinyin_toggle': e('chat', 'Switched the 拼 / EN reading aids of a conversation.', ['aid', 'on']),
  'chat.discuss': e('chat', 'Discuss with Claude on a message.', []),
  'chat.listening_mode': e('chat', 'Listening mode switched for a conversation, or the default for new chats.', ['scope', 'on']),
  'chat.listening_play': e('chat', 'Listening mode: tapped a hidden message to hear it.', ['slow']),
  'chat.listening_reveal': e('chat', 'Listening mode: held a hidden message to reveal its text.', []),
  'chat.inbox_open': e('chat', 'Opened the Chats tab.', ['conversations', 'unread']),

  // ── calls ──────────────────────────────────────────────────────────────
  'call.start': e('calls', 'Started a video call.', ['solo']),
  'call.join': e('calls', 'Joined a call.', ['role']),
  'call.leave': e('calls', 'Left a call (it goes on).', ['duration_ms']),
  'call.end': e('calls', 'Ended a call for everyone.', ['duration_ms']),
  'call.board': e('calls', 'Opened a board tile (text / draw / chat).', ['tile']),
  'call.board_page': e('calls', 'Added / turned / followed a board page.', ['action']),
  'call.screen_share': e('calls', 'Started or stopped sharing the screen (sound = the share carries a tab or system sound).', ['on', 'sound']),
  'call.annotate': e('calls', 'Drew on a shared screen or material.', ['target']),
  'call.material_present': e('calls', 'Presented a lesson material.', ['material_kind', 'pages']),
  'material.contents_open': e('calls', 'Opened a lesson material’s Contents (in a call or the material viewer).', ['where', 'source', 'entries']),
  'material.contents_jump': e('calls', 'Jumped to a section from a lesson material’s Contents.', ['where', 'source']),
  'call.activity_start': e('calls', 'Started an in-call activity (either person may; role = the starter’s side: tutor / student / solo).', ['activity_kind', 'role']),
  'call.activity_word_add': e('calls', 'In-call activity "Words you needed": added a word as a card.', ['activity_kind', 'word_kind', 'where']),
  'call.layout': e('calls', 'Changed the call layout (▦).', ['preset']),
  'call.view_mode': e('calls', 'Switched between "Same view" and "My own view" in a call.', ['mode']),
  'call.view_bring': e('calls', '"Bring <name> to my view": made my view the shared one and invited the other person.', ['mode']),
  'call.view_join': e('calls', 'Joined the other person’s view from their invitation.', []),
  'call.review_open': e('calls', 'Opened a call review / lesson report.', []),
  'call.homework_from_call': e('calls', 'Make homework from this lesson.', []),

  // ── tutor ──────────────────────────────────────────────────────────────
  'tutor.send_homework': e('tutor', 'Sent homework from the Send homework sheet.', ['items', 'mode', 'kind', 'split_days']),
  'tutor.remove_homework': e('tutor', 'Took homework back from a student.', ['kind']),
  'tutor.lesson_notes_add': e('tutor', 'Added lesson notes (drafting homework by default).', ['draft']),
  'tutor.session_notes': e('tutor', 'Submitted session notes to the homework agent.', []),
  'tutor.homework_draft_message': e('tutor', 'Asked Claude to change a homework draft.', []),
  'tutor.homework_draft_assign': e('tutor', 'Assigned a homework draft.', ['items']),
  'tutor.library_save': e('tutor', 'Saved a library lesson in the editor.', ['created']),
  'tutor.library_assign': e('tutor', 'Assigned a library lesson to students.', ['students']),
  'tutor.library_push_update': e('tutor', 'Pushed a library lesson update to copies.', []),
  'tutor.catalogue_copy': e('tutor', 'Copied a catalogue sample into the library.', ['exercise_type']),
  'tutor.budget_change': e('tutor', "Changed a student's daily new cards.", ['new_cards', 'secondary_cards', 'reset']),
  'tutor.student_profile_save': e('tutor', 'Saved the private student profile.', []),
  'tutor.recording_mark': e('tutor', 'Marked a recording (listened / needs work).', ['status', 'source']),
  'tutor.recording_queue_open': e('tutor', 'Opened the "Needs your ear" recording queue (or All recordings).', ['view', 'items', 'scoring']),
  'tutor.recording_reference_play': e('tutor', "Played the reference clip next to the student's recording.", ['source']),
  'tutor.flag_reply': e('tutor', 'Replied to a flagged card.', []),
  'tutor.queue_move': e('tutor', "Moved a deck in the student's queue.", ['to']),
  'tutor.invite_create': e('tutor', 'Created an invite link.', ['decks']),
  'tutor.insights_summary': e('tutor', 'Asked for the Claude-written insights summary.', []),
  'tutor.try_as_student': e('tutor', 'Tried a deck / lesson as the student (preview).', ['kind']),

  // ── readers ────────────────────────────────────────────────────────────
  'reader.open': e('readers', 'Opened a graded reader.', ['source', 'pages']),
  'reader.finish': e('readers', 'Finished a reader (Finish button, or listened to the end with Play whole story). Old events carry a rating.', ['how', 'rating', 'pages']),
  'reader.story_play': e('readers', 'Started "▶ Play whole story" (pages play one after another, turning the pages).', ['from_page', 'pages', 'speed', 'offline']),
  'reader.story_stop': e('readers', 'Stopped "Play whole story" before the end.', ['page', 'pages']),
  'reader.word_tap': e('readers', 'Tapped a word chip.', []),
  'reader.word_more': e('readers', '"More about this word".', []),
  'reader.word_add_card': e('readers', 'Added a reader word as a card.', []),
  'reader.generate': e('readers', 'Asked for a new reader.', []),
  'reader.editor_save': e('readers', 'Saved a reader in the editor.', ['pages']),
  'reader.audio_block': e('readers', 'Used the phrase-block scrubber (jump / step).', ['action']),
  'reader.speed_changed': e('readers', 'Changed the reader playback speed (1 / 0.75 / 0.5).', ['speed']),

  // ── quests & picture hunts ─────────────────────────────────────────────
  'quest.generate': e('quests', 'Asked for a new quest.', ['difficulty']),
  'quest.play': e('quests', 'Opened a quest to play.', []),
  'quest.complete': e('quests', 'Finished a quest.', ['moves']),
  'picture_hunt.create': e('picture_hunt', 'Made a picture hunt.', ['source']),
  'picture_hunt.play_done': e('picture_hunt', 'Finished a picture hunt round.', ['found', 'total', 'gave_up']),
  'idioms.open': e('idioms', 'Opened a 成语 idiom page (source = list / search / explorer / related; cached = read from the device).', ['source', 'cached']),
  'idioms.generate': e('idioms', 'An idiom entry started generating (status after the request; retry = Retry after a failure).', ['status', 'retry'], { server: true }),
  'idioms.add_card': e('idioms', '"+ Add as card" from an idiom page.', []),
  'idioms.quiz': e('idioms', 'Finished the "Try it" check on an idiom page (practice only, nothing recorded).', ['correct', 'total']),
  'audio_lesson.create': e('lessons', 'Asked for a new audio lesson (docs/AUDIO_LESSONS.md).', ['format', 'target_minutes']),
  'audio_lesson.play': e('lessons', 'Started playing an audio lesson.', ['format', 'offline', 'resumed']),
  'audio_lesson.complete': e('lessons', 'Listened to an audio lesson to the end.', ['format', 'duration_ms']),
  'audio_lesson.sleep_timer': e('lessons', 'Set the sleep timer in the audio-lesson player (0 = off, -1 = end of chapter).', ['minutes', 'format']),
  'audio_lesson.download': e('lessons', 'Saved an audio lesson on the device for offline listening.', ['format']),
  'audio_lesson.podcast_feed': e('lessons', 'Settings → Audio lessons → Podcast feed (action: copy, open, open_apple, reset, off).', ['action']),
  'audio_lesson.music': e('lessons', 'Turned the soft music under an audio lesson on / off or changed its volume (docs/AUDIO_LESSONS.md "Music").', ['on', 'format', 'volume_pct']),

  // ── lessons ────────────────────────────────────────────────────────────
  'lesson.start': e('lessons', 'Started a mini lesson.', ['source', 'exercises']),
  'lesson.complete': e('lessons', 'Finished a mini lesson.', ['rating', 'source', 'duration_ms']),
  'study.done_for_good': e('study', '"Done for good" on a finished lesson: never scheduled again (readers until Oct 2026; now read once).', ['kind', 'source']),
  'study.bring_back': e('study', '"Bring back" a lesson that was done for good.', ['kind']),
  'lesson.grammar_start': e('lessons', 'Started the OLD fixed-phase grammar lesson.', [], { replacedBy: 'lesson.start' }),
  'lesson.editor_save': e('lessons', 'Saved a lesson in the editor.', []),
  'lesson.catalogue_try': e('lessons', 'Tried a catalogue sample lesson.', ['exercise_type']),
  'lesson.conversation_audio_open': e('lessons', 'Opened the ⚙︎ Audio menu on a conversation exercise.', ['provider']),
  'lesson.conversation_audio_speed': e('lessons', 'Changed the conversation speed (Audio menu or Settings).', ['speed', 'provider', 'source']),
  'lesson.conversation_audio_voice': e('lessons', "Picked a speaker's voice in a conversation (automatic = back to the rotation).", ['provider', 'gender', 'automatic']),
  'lesson.conversation_audio_delivery': e('lessons', 'Changed the conversation delivery (natural / conversational / calm / cheerful).', ['delivery', 'provider', 'source']),
  'lesson.conversation_audio_regenerate': e('lessons', "Regenerated a conversation's audio.", ['lines', 'provider']),

  // ── coach ──────────────────────────────────────────────────────────────
  'coach.start': e('coach', 'Started a Sentence Coach conversation.', ['action']),
  'coach.quick_action': e('coach', 'Used a quick-action chip.', ['action']),
  'coach.follow_up': e('coach', 'Sent a follow-up message in the coach chat.', []),
  'coach.reply_resumed': e('coach', 'Came back to a coach conversation whose reply was still being written in the background.', []),
  'coach.reply_retry': e('coach', 'Pressed Retry on a coach reply that failed.', []),
  'coach.add_new_words': e('coach', '"➕ Add new words": added words of the sentence that were in no deck.', ['count', 'existing']),
  'coach.sentence_card': e('coach', '"🃏 Card for this sentence": opened the add-card sheet with the whole sentence.', []),
  'chat.open_in_coach': e('chat', 'Opened a chat message in the Sentence Coach (menu item, the bubble chip or the How-to-say-it-better sheet).', ['source', 'action']),

  // ── decks ──────────────────────────────────────────────────────────────
  'deck.create': e('decks', 'Created a deck.', ['source']),
  'deck.generate': e('decks', 'Generate with Claude.', []),
  'deck.note_add': e('decks', 'Added a note by hand.', []),
  'deck.note_edit': e('decks', 'Edited a note.', ['where']),
  'deck.paste_list': e('decks', 'Saved a pasted word list.', ['added', 'updated', 'skipped', 'failed']),
  'deck.enrich_words': e('decks', '"Write them with Claude" in Paste a list.', ['words']),
  'deck.reorder': e('decks', 'Moved a deck in the study queue.', ['how']),
  'deck.export_anki': e('decks', 'Exported to Anki.', ['kind']),
  'deck.search': e('decks', 'Searched cards on the Decks tab.', ['results', 'server']),
  'deck.share': e('decks', 'Shared / updated a deck copy for a student.', ['update']),
  'deck.check_issue_applied': e('decks', 'Applied a word check fix ("⚠ Possible issue" → Apply fix).', ['field', 'kind', 'where']),
  'deck.check_issue_dismissed': e('decks', 'Dismissed a word check issue.', ['field', 'kind', 'where']),
  'deck.check_started': e('decks', 'Started "Check for errors" on a deck.', ['words', 'scope']),
  'deck.check_applied': e('decks', 'Applied fixes from a deck check.', ['count', 'source', 'scope']),
  'folder.create': e('decks', 'Made a folder (decks / library lessons / readers).', ['kind', 'nested']),
  'folder.rename': e('decks', 'Renamed a folder.', ['kind']),
  'folder.delete': e('decks', 'Deleted a folder (its items go to Unfiled).', ['kind', 'items']),
  'folder.move_items': e('decks', 'Moved items into a folder (or Unfiled).', ['kind', 'count', 'unfiled']),

  // ── settings ───────────────────────────────────────────────────────────
  'settings.change': e('settings', 'Changed a setting (`setting` names it, `value` an enum).', ['setting', 'value']),
  'settings.revisit_changed': e('settings', 'Changed the "Lessons & readers" settings — revisit gaps / new lessons a day (or reset them).', ['fields', 'reset', 'new_lessons_per_day']),
  'settings.new_card_order': e('settings', 'Changed "Order new cards by" (Settings → New cards): which new words come first (or reset it). Props = the switch changed and the switches after the change.', ['field', 'reset', 'new_characters_first', 'new_words_first', 'most_common_first', 'sentences_last']),
  'settings.analytics': e('settings', 'Turned usage data sharing on / off.', ['on']),
  'settings.full_sync': e('settings', 'Ran a full sync by hand.', []),
  'settings.debug_report': e('settings', 'Sent a debug report by hand.', []),

  // ── notifications ──────────────────────────────────────────────────────
  'notification.tapped': e('notifications', 'Opened the app from a notification.', ['kind']),

  // ── errors shown to the user ───────────────────────────────────────────
  'error.shown': e('errors', 'An error message was shown to the user.', ['code', 'where', 'status']),

  // ── server (written by the worker) ─────────────────────────────────────
  'server.content_created': e('server', 'A deck / notes / lesson / reader was created through the API.', ['kind', 'count', 'via'], { server: true }),
  'server.audio_lesson_built': e('server', 'An audio lesson finished rendering.', ['format', 'minutes', 'clips'], { server: true }),
  'server.podcast_feed_fetched': e('server', "A podcast app fetched a user's private audio-lesson feed.", ['items'], { server: true }),
  'server.homework_assigned': e('server', 'Homework assignments were written for a student.', ['kind', 'mode', 'count'], { server: true }),
  'server.ai_call': e('server', 'One model call: model, tokens and an estimated cost.', ['provider', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cost_usd', 'status', 'route'], { server: true }),
  'server.push_sent': e('server', 'A push notification was sent.', ['channel', 'kind', 'ok'], { server: true }),
  'server.email_sent': e('server', 'An e-mail was sent.', ['kind', 'ok'], { server: true }),
  'server.recording_check': e('server', 'A pronunciation recording was checked (transcript + Azure score).', ['scored', 'match', 'note', 'audio_ms'], { server: true }),
  'server.coach_auto_detect': e('server', 'A coach conversation started WITHOUT an action (old clients).', [], { server: true, replacedBy: 'coach.start' }),
  'server.study_session_api': e('server', 'POST /api/study/sessions — kept only for old clients.', [], { server: true, replacedBy: 'study.session_start' }),
} as const satisfies Record<string, AnalyticsEventDef>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

export function isAnalyticsEvent(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/** Events a client may send (server events are refused from clients). */
export function isClientEvent(name: unknown): name is AnalyticsEventName {
  return isAnalyticsEvent(name) && !(ANALYTICS_EVENTS[name] as AnalyticsEventDef).server;
}

/**
 * Screens that were replaced by a newer one: an old screen still being visited
 * is "old path still in use". Keys and values are route patterns (screenName()).
 */
export const SCREEN_REPLACED_BY: Readonly<Record<string, string>> = {
  '/search': '/decks',
};

/** Where each app runs. `android-hybrid` is the Capacitor shell, `lab` the native app. */
export const ANALYTICS_PLATFORMS = ['web', 'pwa', 'android-hybrid', 'lab'] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

/** off = nothing recorded; basic = no screen views / no per-card events; verbose = everything. */
export const ANALYTICS_LEVELS = ['off', 'basic', 'verbose'] as const;
export type AnalyticsLevel = (typeof ANALYTICS_LEVELS)[number];

/** High-volume events dropped at the `basic` level. */
export const VERBOSE_ONLY_EVENTS: readonly AnalyticsEventName[] = [
  'app.screen_view',
  'study.card_rated',
  'study.sentence_reveal',
  'homework.pass_item',
  'reader.word_tap',
  'explorer.push',
  'reader.audio_block',
  'chat.listening_play',
];

export function parseAnalyticsLevel(raw: unknown): AnalyticsLevel {
  return typeof raw === 'string' && (ANALYTICS_LEVELS as readonly string[]).includes(raw.trim().toLowerCase())
    ? (raw.trim().toLowerCase() as AnalyticsLevel)
    : 'verbose';
}

export function eventAllowedAtLevel(name: string, level: AnalyticsLevel): boolean {
  if (level === 'off') return false;
  if (level === 'basic') return !(VERBOSE_ONLY_EVENTS as readonly string[]).includes(name);
  return true;
}

/** Days a usage event is kept (the worker's daily cron prunes older rows). */
export const USAGE_RETENTION_DAYS = 180;
