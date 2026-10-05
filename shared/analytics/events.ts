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
  'study.ask_claude': e('study', 'Asked Claude about the card on screen.', ['card_type']),
  'study.edit_card': e('study', 'Opened Edit card from a study card.', []),
  'study.flag_card': e('study', 'Flagged a card for the tutor.', []),
  'study.sentence_coach': e('study', 'Opened the Sentence coach from a study card.', []),
  'study.write_it': e('study', 'Opened stroke-order practice (Write it).', []),
  'study.char_sheet_open': e('study', 'Tapped a character on the card back: the character sheet (dictionary + words with it).', ['found', 'words']),
  'study.char_word_tap': e('study', 'Tapped a word in the character sheet\'s "Words with 字" list.', ['status', 'current']),
  'study.char_word_added': e('study', 'Added a word from the character sheet as a card.', []),
  'study.char_explain': e('study', '"More about 字" on the character sheet (short Claude explanation, cached for everyone).', []),
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
  'call.screen_share': e('calls', 'Started or stopped sharing the screen.', ['on']),
  'call.annotate': e('calls', 'Drew on a shared screen or material.', ['target']),
  'call.material_present': e('calls', 'Presented a lesson material.', ['material_kind', 'pages']),
  'call.activity_start': e('calls', 'Started an in-call activity.', ['activity_kind']),
  'call.layout': e('calls', 'Changed the call layout (▦).', ['preset']),
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
  'reader.finish': e('readers', 'Rated / finished a reader.', ['rating', 'pages']),
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

  // ── lessons ────────────────────────────────────────────────────────────
  'lesson.start': e('lessons', 'Started a mini lesson.', ['source', 'exercises']),
  'lesson.complete': e('lessons', 'Finished a mini lesson.', ['rating', 'source', 'duration_ms']),
  'lesson.grammar_start': e('lessons', 'Started the OLD fixed-phase grammar lesson.', [], { replacedBy: 'lesson.start' }),
  'lesson.editor_save': e('lessons', 'Saved a lesson in the editor.', []),
  'lesson.catalogue_try': e('lessons', 'Tried a catalogue sample lesson.', ['exercise_type']),

  // ── coach ──────────────────────────────────────────────────────────────
  'coach.start': e('coach', 'Started a Sentence Coach conversation.', ['action']),
  'coach.quick_action': e('coach', 'Used a quick-action chip.', ['action']),
  'coach.follow_up': e('coach', 'Sent a follow-up message in the coach chat.', []),

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
  'settings.analytics': e('settings', 'Turned usage data sharing on / off.', ['on']),
  'settings.full_sync': e('settings', 'Ran a full sync by hand.', []),
  'settings.debug_report': e('settings', 'Sent a debug report by hand.', []),

  // ── notifications ──────────────────────────────────────────────────────
  'notification.tapped': e('notifications', 'Opened the app from a notification.', ['kind']),

  // ── errors shown to the user ───────────────────────────────────────────
  'error.shown': e('errors', 'An error message was shown to the user.', ['code', 'where', 'status']),

  // ── server (written by the worker) ─────────────────────────────────────
  'server.content_created': e('server', 'A deck / notes / lesson / reader was created through the API.', ['kind', 'count', 'via'], { server: true }),
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
