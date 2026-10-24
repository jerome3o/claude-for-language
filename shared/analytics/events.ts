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
  | 'meme_review'
  | 'clips'
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
  'voice_input.used': e('app', 'A voice-first text box (say it, or type it) settled one answer or take (surface = where: lesson_translate | lesson_dictation | coach | chat | …; outcome = submitted — said and submitted as heard | edit — ✏️ Edit put the transcript in the box | edited — an edited transcript submitted | typed — a typed answer submitted | retaken — 🔁 Retry | failed | empty | cancelled; via = live | upload | none; live_error as in study.take_transcribed; speech_ms = how long the mic was open; ms = stop → transcript; blocked = why speaking was off when typed: none | offline | denied | no_mic | unsupported | mic_error).', ['surface', 'outcome', 'via', 'live_error', 'speech_ms', 'ms', 'blocked']),

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
  'progress.known_mode': e('study', 'Switched the Progress page\'s Characters & words chart between Total and Per week (mode = total | rate; remembered per device).', ['mode']),
  'study.take_transcribed': e('study', 'A pronunciation take got its "You said" (via = live | upload | failed | offline; live_error = why the live Soniox stream gave nothing: none | timeout | soniox_<code> | closed | empty | socket | no_session | aborted; ms = Stop → result; where = homework when the card was a homework pass word, absent in Study).', ['via', 'live_error', 'ms', 'where']),
  'study.answer_spoken': e('study', 'Said the answer of a typing card with the 🎤 button (result = submitted | filled — ✏️ Edit put it in the box | retaken — 🔁 Retry on the review | failed | empty | cancelled; via = live | upload | none; live_error as in study.take_transcribed; speech_ms = how long the mic was open; ms = stop → transcript; auto_submit = "Skip the review" switch on; retry = a "🎤 Say it again" from the answer side; reviewed = the take went through the review step; edited = ✏️ Edit on the review; practice = "🎤 Say it" practice after 👁 Show answer with no attempt — never the card’s answer; where = homework on a homework pass word).', ['card_type', 'result', 'via', 'live_error', 'speech_ms', 'ms', 'auto_submit', 'retry', 'reviewed', 'edited', 'practice', 'where']),
  'study.spoken_answer_checked': e('study', 'A spoken answer was checked on a typing card (verdict = exact | punctuation_only | equivalent | alternative | sound — a homophone | contains — said inside a sentence | close — other tones | wrong; retry = the answer of a "🎤 Say it again"; reviewed = submitted from the review step; practice = "🎤 Say it" practice after Show answer — shown as "You said" only, the rating untouched; where = homework on a homework pass word).', ['card_type', 'verdict', 'retry', 'reviewed', 'practice', 'where']),
  'study.you_said_coach': e('study', 'Tapped the round ✎ (Check in Coach) on the orange "You said · Contains the answer" box (✏️ Check until Oct 2026): the sentence said around the answer opens in the Sentence Coach (Check my sentence); source = read (a read card\'s take) | spoken (a typing card answered by speaking) | practice (🎤 Say it after Show answer); where = homework on a homework pass word.', ['card_type', 'source', 'where']),
  'study.you_said_play': e('study', 'Tapped ▶ on a read card\'s "You said" box, or on the compact "You said" row under a spoken answer / 🎤 Say it practice on a typing card: played the take it was transcribed from (where = homework on a homework pass word).', ['card_type', 'where']),
  'study.deck_pill': e('study', 'Tapped the study card\'s 📚 deck pill (the deck name cut to one line): action = expand (the popover with the full name) | open_deck ("Open deck →" in it); where = homework (a homework pass word) | tutor_notes (practising tutor notes); unset = the study session.', ['action', 'where']),
  'study.char_sheet_open': e('study', 'Tapped a character on the card back: the character sheet (dictionary + words with it).', ['found', 'words']),
  'study.char_word_tap': e('study', 'Tapped a word in the character sheet\'s "Words with 字" list.', ['status', 'current']),
  'study.char_word_added': e('study', 'Added a word from the character sheet as a card.', []),
  'study.char_explain': e('study', '"More about 字" on the character sheet (short Claude explanation, cached for everyone).', []),
  // The language explorer (docs/LANGUAGE_EXPLORER.md): Character / Word views on a stack.
  'explorer.open': e('study', 'Opened the language explorer by tapping Chinese (source = where, kind = char / word).', ['source', 'kind']),
  'explorer.push': e('study', 'Tapped Chinese inside the explorer: another view pushed (kind = char / word, from = the view it was in).', ['kind', 'from', 'depth']),
  'explorer.more': e('study', '"More about this word" in the explorer\'s Word view.', ['kind']),
  'explorer.add_card': e('study', 'Added a word as a card from the explorer (kind = word — the Word view — or char — the Character view\'s "+ Add 字 as a card").', ['kind']),
  'explorer.bump': e('study', '"⚡ Study it today" from the explorer (kind = word | char).', ['kind']),
  'explorer.drill_start': e('study', 'Started a quick drill from the explorer (kind = char / word; practice only, no review events).', ['kind', 'items']),
  'explorer.drill_finish': e('study', 'Finished a quick drill from the explorer.', ['kind', 'items', 'correct', 'duration_ms']),
  'explorer.write': e('study', '"✍️ Write it" from the explorer\'s Character view.', []),
  'study.word_tag_open': e('study', 'Tapped a word tag (part of speech, register, measure word, HSK…) for its explanation (kind = pos | separable | transitivity | register | measure | hsk | frequency | spoken | trad | phrase; tag = its id, e.g. register:P; source = study | explorer | pass; tag_source = lexicon | ai — an AI-suggested ✨ pill).', ['kind', 'tag', 'source', 'tag_source']),
  'study.word_tag_word': e('study', 'Tapped Chinese inside a word tag\'s explanation sheet (a register note\'s "use 人品 in casual speech", a separable or measure-word example) → the language explorer (kind = the tag kind; tag_source = lexicon | ai; item = char | word; inside = the sheet was opened from inside the explorer).', ['kind', 'tag_source', 'item', 'inside']),
  'study.study_more': e('study', 'Pressed Study More (bonus new cards).', ['count']),
  'study.new_cards_paused': e('study', 'Home said "New cards paused" — today\'s review load is over the account\'s "Pause new cards on heavy days" limit (once a local day; load = reviews due today, limit = the setting).', ['load', 'limit']),
  'study.celebration': e('study', "Emptied today's queue (the once-a-day celebration).", ['reviews', 'active_ms']),
  'study.long_term_toggle': e('study', '"Add to my long-term review" switched for a word.', ['value']),
  'study.sentence_reveal': e('study', 'Tapped an example sentence row open.', ['step']),
  'study.sentence_explain': e('study', '"What\'s going on here?" on an example sentence.', []),
  'study.sentence_practise': e('study', '🎤 on an example sentence row (practice only — no review, no recording kept): mode = read (said the sentence shown) | translate (English-first: said it in Chinese); result = right | close | wrong | failed | empty; via = local (judged on the device, homophones count) | claude (a translate take that wasn\'t the sentence, judged by the lesson answer check) | offline (no check to be had).', ['mode', 'result', 'via']),
  'study.sentence_gate': e('study', '"Get two sentences right before Good / Easy" (Settings → Study): action = rated (a card rated while the gate applied) | blocked (a locked Good / Easy tapped) | unlocked (the last sentence needed was said right); unlocked = Good / Easy free at that moment; needed / got = sentences; card_type.', ['action', 'unlocked', 'needed', 'got', 'card_type']),
  'study.sentence_round': e('study', 'The Sentence round between a card\'s question and its answer (Settings → Study, "Sentence round before the answer"): action = shown (the round opened) | right | miss (a take judged close / wrong) | retry (Try again) | skip (Skip to the answer) | done (enough right, the answer opens unlocked); index = the exercise\'s place in the round (0–3); mode = read | translate; got / needed = exercises right so far / to get right.', ['action', 'index', 'mode', 'got', 'needed']),
  'study.listen_context': e('study', 'A listening card answered: its "Listen in context" question side — sentences played (incl. the auto-played first one), whether "Try the sentences first?" was shown, whether he chose "Play the word anyway".', ['sentences_played', 'word_first_prompt_shown', 'played_word_anyway']),
  'study.listen_more_sentences': e('study', '"+ More sentences" on a listening card\'s question side (sentences before / after).', ['before', 'after']),
  'study.tutor_note_practice': e('study', 'Practised cards from a tutor note.', ['count']),
  'study.tutor_model_play': e('study', "Played the tutor's model recording on a tutor note, or their own take beside it.", ['where', 'which']),
  'study.bump_added': e('study', '"⚡ Study it today": bumped cards the learner already had to the front of today\'s queue.', ['source', 'count', 'already']),
  'study.bump_studied': e('study', 'Rated a card from the ⚡ bump pocket.', ['card_type', 'queue']),
  'study.bump_cleared': e('study', 'Took a word out of the ⚡ bump pocket by hand.', ['source']),
  'study.other_card_types_open': e('study', 'Opened ⋯ → "Practise this word other ways…" on the study card.', ['from_type']),
  'study.other_card_types': e('study', '"Practise this word other ways…": sent other card types of the word into today (a card-level ⚡ bump). types = the chosen card types joined with /.', ['types', 'from_type', 'count', 'early']),
  'study.up_next_added': e('study', '"Up next": put words the learner already has on the ordered list introduced first within the daily budget (source = up_next_page | search | deck | card_hub | explorer | mcp | tutor | other).', ['source', 'count', 'already']),
  'study.up_next_moved': e('study', 'Reordered the "Up next" list (how = drag | top | bottom | drop — a search result dragged into place).', ['how']),
  'study.up_next_removed': e('study', 'Took a word off the "Up next" list by hand (the card is kept).', ['source']),
  'card.suspend': e('study', 'Suspended cards — out of all study until unsuspended (scope = card | word; source = study | card_hub | held_list | mcp).', ['scope', 'count', 'source']),
  'card.unsuspend': e('study', 'Unsuspended cards (source = study | card_hub | held_list | deck | mcp).', ['count', 'source']),
  'card.snooze': e('study', 'Snoozed cards — "not today" (length = tomorrow | week | month; scope = card | word).', ['scope', 'length', 'count', 'source']),
  'card.wake': e('study', 'Woke snoozed cards now (source = card_hub | held_list | deck | mcp).', ['count', 'source']),
  'card.forget': e('study', 'Forgot cards — reset to new with a forget event (scope = card | word; undone = the Undo right after).', ['scope', 'count', 'source', 'undone']),
  'card.leech_open': e('study', 'Opened the "⚠ Missed N×" leech sheet on a card (lapses = how many times missed).', ['lapses', 'card_type']),
  'settings.bury_siblings': e('settings', 'Turned "Don\'t show a word\'s other card types on the same day" on or off.', ['on']),

  // ── homework (student side) ────────────────────────────────────────────
  'homework.pass_start': e('homework', 'Opened a homework pass.', ['kind', 'items']),
  'homework.pass_item': e('homework', 'Answered one word of a homework pass — on the study card, never an FSRS review (result = right — Got it | wrong — Not yet; card_type = the card shown; answered = how it was tried before the reveal: take — the read card\'s 🎤 recording | spoken — a typing card said aloud | typed | choice — multiple choice | none — Show answer straight away; suggested = what the answer side suggested: right | wrong | none; followed = the choice matched the suggestion).', ['result', 'card_type', 'answered', 'suggested', 'followed']),
  'homework.pass_done': e('homework', 'Finished a homework pass.', ['kind', 'items']),
  'homework.pass_undo': e('homework', 'Took back the last Got it / Not yet in a homework pass with ↺ (an `undo` event; result = the answer undone: right | wrong; reopened = it had finished the pass).', ['result', 'reopened']),

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
  'chat.listening_part': e('chat', 'Listening mode: tapped a part of a hidden message (split at its pauses) or dragged along it.', ['how']),
  'chat.listening_reveal': e('chat', 'Listening mode: held a hidden message to reveal its text.', []),
  'chat.inbox_open': e('chat', 'Opened the Chats tab.', ['conversations', 'unread']),
  'chat.album_sent': e('chat', 'Sent several photos at once as one album.', ['count', 'offline']),
  'chat.album_viewer_open': e('chat', 'Opened a photo album in the full-screen viewer.', ['count', 'index']),
  'chat.system_action': e('chat', 'Tapped the button on a system message in the chat (Join, Open card…).', ['kind']),

  // ── calls ──────────────────────────────────────────────────────────────
  'call.start': e('calls', 'Started a video call.', ['solo']),
  'call.join': e('calls', 'Joined a call.', ['role']),
  'call.leave': e('calls', 'Left a call (it goes on).', ['duration_ms']),
  'call.end': e('calls', 'Ended a call for everyone.', ['duration_ms']),
  'call.board': e('calls', 'Opened a board tile (text / draw / chat).', ['tile']),
  'call.board_page': e('calls', 'Added / turned / followed a board page.', ['action']),
  'call.board_gloss': e('calls', 'Accepted a board tab-complete (direction = zh: pinyin + meaning after Chinese | en: Chinese + pinyin after English; via = tab | chip; source = server | local: the device’s own pinyin / dictionary meaning).', ['direction', 'via', 'source']),
  'call.board_gloss_lookup': e('calls', 'One board tab-complete lookup settled (outcome = server | cached | rate_limited | unavailable | failed | offline | backoff | superseded; status = HTTP status of a failure, 0 = none; ms = until the server answered / failed; shown = server | local | none).', ['direction', 'outcome', 'status', 'ms', 'shown']),
  'call.screen_share': e('calls', 'Started or stopped sharing the screen (sound = the share carries a tab or system sound).', ['on', 'sound']),
  'call.annotate': e('calls', 'Drew on a shared screen or material.', ['target']),
  'call.desktop_overlay': e('calls', 'Desktop app: the drawing overlay on the shared screen opened / closed (on), or drawing on the real screen was switched on / off (draw).', ['on', 'draw']),
  'call.material_present': e('calls', 'Presented a lesson material.', ['material_kind', 'pages']),
  'material.contents_open': e('calls', 'Opened a lesson material’s Contents (in a call or the material viewer).', ['where', 'source', 'entries']),
  'material.contents_jump': e('calls', 'Jumped to a section from a lesson material’s Contents.', ['where', 'source']),
  'call.activity_start': e('calls', 'Started an in-call activity (either person may; role = the starter’s side: tutor / student / solo).', ['activity_kind', 'role']),
  'call.activity_word_add': e('calls', 'In-call activity "Words you needed": added a word as a card.', ['activity_kind', 'word_kind', 'where']),
  'call.prepared_activity_start': e('calls', 'The tutor started one of the activities prepared for this student from earlier lessons (⋯ → 🎲 Activities → "For <student> · from last lesson").', ['activity_kind', 'position']),
  'call.layout': e('calls', 'Changed the call layout (▦).', ['preset']),
  'call.view_mode': e('calls', 'Switched between "Same view" and "My own view" in a call.', ['mode']),
  'call.view_bring': e('calls', '"Bring <name> to my view": made my view the shared one and invited the other person.', ['mode']),
  'call.view_join': e('calls', 'Joined the other person’s view from their invitation.', []),
  'call.timer': e('calls', 'Ran the call timer (action = set | start | pause | reset | clear; mode = countdown | stopwatch on set; minutes = the countdown length).', ['action', 'mode', 'minutes']),
  'call.presence_alert': e('calls', 'The other person joined / left the call: the toast showed (sound = the chime played).', ['kind', 'sound']),
  'call.sounds': e('calls', 'Switched call sounds (join / leave chimes, the timer bell) on or off.', ['on']),
  'call.annot_pip': e('calls', 'Opened the mini window of my shared screen with the drawings over my other windows (Chrome desktop).', []),
  'call.review_open': e('calls', 'Opened a call review / lesson report.', []),
  'call.homework_from_call': e('calls', 'Make homework from this lesson.', []),
  'group.create': e('calls', 'Group class (prototype): created a group of students.', ['students']),
  'group.class_start': e('calls', 'Group class (prototype): started a class (reused = one was already live).', ['students', 'reused']),
  'group.notify': e('calls', 'Group class (prototype): sent each student the class link in their 1:1 chat.', ['sent']),
  'group.join': e('calls', 'Group class (prototype): joined a class.', ['role', 'people']),
  'group.leave': e('calls', 'Group class (prototype): left a class (it goes on).', ['duration_ms']),
  'group.end': e('calls', 'Group class (prototype): the tutor ended the class for everyone.', ['duration_ms', 'people']),
  'group.control': e('calls', 'Group class (prototype): the tutor used a control (mute / mute_all / spotlight / lower_hand).', ['kind']),
  'group.screen_share': e('calls', 'Group class (prototype): started or stopped sharing the screen.', ['on']),
  'group.quiz': e('calls', 'Group class (prototype): asked a quiz question or showed its answer.', ['action', 'options']),

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
  'tutor.budget_change': e('tutor', "Changed a student's daily new cards (pause_over = their \"Pause new cards on heavy days\" limit when it changed: a number, or off).", ['new_cards', 'secondary_cards', 'reset', 'pause_over']),
  'tutor.student_profile_save': e('tutor', 'Saved the private student profile.', []),
  'tutor.prepared_activities_prepare': e('tutor', 'Asked for in-call activities for the next lesson ("Prepare activities" / "↻ Make more"; source = student_page | call).', ['source', 'ready']),
  'tutor.prepared_activity_preview': e('tutor', 'Opened the preview of a prepared in-call activity (source = student_page | call).', ['activity_kind', 'source']),
  'tutor.prepared_activity_dismiss': e('tutor', 'Dismissed a prepared in-call activity (source = student_page | call).', ['activity_kind', 'source']),
  'tutor.recording_mark': e('tutor', 'Marked a recording (listened / needs work).', ['status', 'source']),
  'tutor.model_recording_saved': e('tutor', 'Saved her own recording of how it should sound on a needs-work mark.', ['replaced', 'duration_ms', 'source']),
  'tutor.model_recording_removed': e('tutor', 'Removed her model recording from a needs-work mark.', ['source']),
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
  'meme_review.open': e('meme_review', 'Opened a 梗 Meme review issue (prototype; source = list / link; cached = read from the device; items = memes in it).', ['source', 'cached', 'items']),
  'meme_review.item_open': e('meme_review', 'Expanded one meme of an issue (item = its id m1…, position = 1-based).', ['item', 'position']),
  'meme_review.link_out': e('meme_review', 'Opened a meme\'s original video / post or a source in the browser (link = media / source; kind = video / post; platform = bilibili / youtube / weibo / …).', ['link', 'kind', 'platform']),
  'meme_review.add_card': e('meme_review', '"+ Add as card" for a meme (item = its id).', ['item']),
  'meme_review.quiz_finish': e('meme_review', 'Finished an issue\'s quiz (practice only, nothing recorded).', ['correct', 'total']),
  'meme_review.make_lesson': e('meme_review', '"Make a mini lesson from this issue" (status = started / writing / open — opened the lesson made before).', ['status']),
  'meme_review.generate': e('meme_review', 'A monthly meme-review issue started generating (via = cron / admin / mcp).', ['via', 'regenerate'], { server: true }),
  'meme_review.ready': e('meme_review', 'A monthly meme-review issue was written (items, searches and pictures used).', ['items', 'searches', 'images'], { server: true }),
  'meme_review.lesson_ready': e('meme_review', 'A mini lesson was made from a meme-review issue in the caller\'s account.', [], { server: true }),

  // ── clips (🎬 experimental, docs/CLIPS.md) ────────────────────────────
  'clips.open': e('clips', 'Opened the 🎬 Clips feed (clips = how many it holds, cached = shown from the device first, offline).', ['clips', 'cached', 'offline']),
  'clips.view': e('clips', 'A clip started playing in the feed (clip = its id, position = 1-based place in the feed, theme, muted).', ['clip', 'position', 'theme', 'muted']),
  'clips.complete': e('clips', 'Watched a clip to its end card (clip = its id, duration_ms = time it took, scenes).', ['clip', 'duration_ms', 'scenes']),
  'clips.like': e('clips', 'Liked / unliked a clip (on = liked; via = button / double_tap).', ['clip', 'on', 'via']),
  'clips.save': e('clips', 'Saved / unsaved a clip (on = saved).', ['clip', 'on']),
  'clips.learn_more': e('clips', 'Used the clip\'s Learn more sheet (action = open — the sheet opened / lesson / reader / podcast / study_words / add_card / more; via = double_tap / long_press / button / end_card; status = started / open / writing / failed).', ['clip', 'action', 'via', 'status']),
  'clips.quiz_answer': e('clips', 'Answered a clip\'s quiz scene (right = picked the answer; timeout = skipped — before Oct 2026: time ran out first).', ['clip', 'right', 'timeout']),
  'clips.interact': e('clips', 'Finished an interactive clip scene (layout = quiz / listen / order / reveal / speak; result = right / wrong / close / done / skipped; waited_ms = time before answering).', ['clip', 'layout', 'result', 'waited_ms']),
  'clips.next': e('clips', 'Went to the next / previous clip without swiping (via = button / key / end_card; dir = next / prev).', ['clip', 'via', 'dir']),
  'clips.explore': e('clips', 'Tapped Chinese in a clip into the language explorer (the clip pauses; layout = the scene\'s layout).', ['clip', 'layout']),
  'clips.caption_toggle': e('clips', 'Switched a clip caption / sound toggle (toggle = pinyin / english / mute / music; on).', ['toggle', 'on']),
  'clips.generate': e('clips', 'Clips started generating (count; via = app / mcp / more — "More clips like this").', ['count', 'via'], { server: true }),
  'audio_lesson.create': e('lessons', 'Asked for a new audio lesson (docs/AUDIO_LESSONS.md; format dialogue / sleep / story, chunks = a story lesson\'s lines).', ['format', 'target_minutes', 'chunks']),
  'audio_lesson.play': e('lessons', 'Started playing an audio lesson.', ['format', 'offline', 'resumed']),
  'audio_lesson.complete': e('lessons', 'Listened to an audio lesson to the end.', ['format', 'duration_ms']),
  'audio_lesson.sleep_timer': e('lessons', 'Set the sleep timer in the audio-lesson player (0 = off, -1 = end of chapter).', ['minutes', 'format']),
  'audio_lesson.download': e('lessons', 'Saved an audio lesson on the device for offline listening.', ['format']),
  'audio_lesson.podcast_feed': e('lessons', 'Settings → Audio lessons → Podcast feed (action: copy, open, open_apple, reset, off).', ['action']),
  'audio_lesson.music': e('lessons', 'Turned the soft music under an audio lesson on / off or changed its volume (docs/AUDIO_LESSONS.md "Music").', ['on', 'format', 'volume_pct']),
  'podcast.subscribe': e('lessons', 'Subscribed to a Chinese podcast (docs/PODCASTS.md; suggested = from the Suggested list, episodes = how many the feed has).', ['suggested', 'episodes'], { server: true }),
  'podcast.unsubscribe': e('lessons', 'Unsubscribed from a podcast (docs/PODCASTS.md).', []),
  'podcast.transcribe': e('lessons', 'Asked for an episode to be transcribed (docs/PODCASTS.md; shared = someone had already asked, status = its status then).', ['shared', 'status'], { server: true }),
  'podcast.open': e('lessons', 'Opened a podcast episode\'s segment player (docs/PODCASTS.md; status = the transcription\'s, offline = from the phone).', ['status', 'offline', 'segments']),
  'podcast.download': e('lessons', 'Saved a transcribed episode\'s audio on the phone (docs/PODCASTS.md).', ['mb']),
  'podcast.segment_play': e('lessons', 'Played one segment of a podcast episode (slow = 0.75×, replay = the same segment again, auto = continuous listening).', ['slow', 'replay', 'auto']),
  'podcast.reveal': e('lessons', 'Revealed the next line of a podcast segment (step = hanzi / pinyin / english).', ['step']),
  'podcast.add_card': e('lessons', 'Added words from a podcast segment as cards (count = cards made, existing = words already in a deck).', ['count', 'existing']),
  'podcast.make_lesson': e('lessons', 'Asked for a mini lesson made from a stretch of a podcast episode (docs/PODCASTS.md; from = the first segment).', ['from']),
  'podcast.lesson_created': e('lessons', 'A mini lesson was written from a podcast episode (exercises, segments it was written from).', ['exercises', 'segments'], { server: true }),

  // ── lessons ────────────────────────────────────────────────────────────
  'lesson.start': e('lessons', 'Started a mini lesson run (mode full / revision).', ['source', 'exercises', 'mode']),
  'lesson.complete': e('lessons', 'Finished a mini lesson run, retry round included (mode full / revision; missed = scored exercises missed first time — 0 = done for good, else a revision in a week; retries = exercises asked again; rating only from apps before Oct 2026).', ['rating', 'source', 'duration_ms', 'mode', 'missed', 'scored', 'retries']),
  'lesson.replay': e('lessons', 'Opened a mini lesson outside a homework pass (from: home, lessons_page, homework, player, coach; revision = its revision; status = new / revision / done).', ['from', 'practice', 'revision', 'status']),
  'lesson.resume': e('lessons', 'A mini lesson run left half-way continued (docs/STUDY_SESSION.md "Mini lessons": saved after every exercise, across days; at = the next exercise).', ['source', 'mode', 'exercises', 'at']),
  'lesson.retry': e('lessons', 'An exercise asked again in a lesson\'s retry round (right = put right, left = retries still owed).', ['type', 'right', 'left']),
  'lesson.items_checked': e('lessons', 'Check on a per-sentence lesson exercise — judge (every sentence ✓ / ✗) or gap_choice (a word for each gap): items = sentences, right = judged / picked right.', ['exercise_type', 'items', 'right']),
  'lesson.start_over': e('lessons', '"Start over" on a mini lesson run that was continuing.', ['source']),
  'lesson.audio': e('lessons', 'How a mini lesson\'s audio played this run, sent when it closes (docs/AUDIO.md "Lesson audio prefetch"): hits = clips played straight from the device, misses = fetched when asked for, stale = late clips dropped because the learner had moved on, max_wait_ms = the longest wait, clips = clips in the lesson, prefetched = clips the player fetched as it opened.', ['source', 'hits', 'misses', 'stale', 'max_wait_ms', 'clips', 'prefetched']),
  'lesson.replay_practice': e('lessons', 'Ended a replayed mini lesson with Practice only (nothing recorded) — apps before Oct 2026.', ['exercises', 'duration_ms'], { replacedBy: 'lesson.complete' }),
  'lesson.unlock': e('lessons', 'Unlocked a locked mini lesson (docs/STUDY_SESSION.md "Unlockable lessons"; via auto = the linked audio lesson was listened to, manual = the unlock button, player = the audio player\'s "Mini lesson ready" card; kind audio_lesson / manual).', ['via', 'kind']),
  'lesson.companion_created': e('lessons', 'A companion mini lesson of an audio lesson was written (docs/AUDIO_LESSONS.md "Companion mini lesson"; unlock audio_lesson / manual, replaced = a not-yet-started one rewritten).', ['unlock', 'format', 'exercises', 'rounds', 'replaced'], { server: true }),
  'lesson.companion_request': e('lessons', 'Asked for an audio lesson\'s companion mini lesson from the app (✨ Make its mini lesson).', ['format']),
  'study.done_for_good': e('study', '"Done for good" on a finished lesson — apps before Oct 2026 (now a lesson is done for good when everything was right first time).', ['kind', 'source'], { replacedBy: 'lesson.complete' }),
  'study.bring_back': e('study', '"Bring back" a lesson that was done for good — apps before Oct 2026.', ['kind'], { replacedBy: 'lesson.replay' }),
  'lesson.grammar_start': e('lessons', 'Started the OLD fixed-phase grammar lesson.', [], { replacedBy: 'lesson.start' }),
  'lesson.editor_save': e('lessons', 'Saved a lesson in the editor.', []),
  'lesson.catalogue_try': e('lessons', 'Tried a catalogue sample lesson.', ['exercise_type']),
  'lesson.answer_check': e('lessons', 'Claude checked a self-assessed lesson answer (docs/STUDY_SESSION.md "Claude checks your answer"; verdict correct / acceptable / almost / wrong / error / offline, ms = wait, cached = server or device cache, try = 1 for the first answer; local = the answer was exactly the model answer, checked on the device with no model call).', ['verdict', 'ms', 'cached', 'local', 'exercise_type', 'input', 'try']),
  'lesson.answer_retry': e('lessons', '🔁 Try again on a checked lesson answer (verdict = the check of the answer being retried).', ['verdict', 'exercise_type', 'try']),
  'lesson.answer_ask': e('lessons', '💬 Ask about this on a checked lesson answer: a question sent (turn = its number in the chat).', ['verdict', 'exercise_type', 'turn']),
  'lesson.speaking_transcribed': e('lessons', 'A free-speaking take in a mini lesson (oral_expression / speak) was transcribed for Claude\'s check (docs/STUDY_SESSION.md "Claude checks your speaking"; via = live / upload / offline / failed, live_error = why the live stream gave nothing, ms = wait after Stop, seconds = length of the take).', ['via', 'live_error', 'ms', 'seconds', 'exercise_type']),
  'lesson.conversation_audio_open': e('lessons', 'Opened the ⚙︎ Audio menu on a conversation exercise.', ['provider']),
  'lesson.conversation_audio_speed': e('lessons', 'Changed the conversation speed (Audio menu or Settings).', ['speed', 'provider', 'source']),
  'lesson.conversation_audio_voice': e('lessons', "Picked a speaker's voice in a conversation (automatic = back to the rotation).", ['provider', 'gender', 'automatic']),
  'lesson.conversation_audio_delivery': e('lessons', 'Changed the conversation delivery (natural / conversational / calm / cheerful).', ['delivery', 'provider', 'source']),
  'lesson.conversation_audio_regenerate': e('lessons', "Regenerated a conversation's audio.", ['lines', 'provider']),

  // ── coach ──────────────────────────────────────────────────────────────
  'coach.start': e('coach', 'Started a Sentence Coach conversation.', ['action']),
  'coach.quick_action': e('coach', 'Used a quick-action chip — apps before Oct 2026 (the chips are gone; ask in the chat).', ['action'], { replacedBy: 'coach.follow_up' }),
  'coach.follow_up': e('coach', 'Sent a follow-up message in the coach chat.', []),
  'coach.reply_resumed': e('coach', 'Came back to a coach conversation whose reply was still being written in the background.', []),
  'coach.reply_retry': e('coach', 'Pressed Retry on a coach reply that failed.', []),
  'coach.add_new_words': e('coach', '"➕ Add new words": added words of the sentence that were in no deck — apps before Oct 2026 (now the coach\'s words open the language explorer).', ['count', 'existing'], { replacedBy: 'explorer.add_card' }),
  'coach.sentence_card': e('coach', '"🃏 Card for this sentence": opened the add-card sheet with the whole sentence — apps before Oct 2026.', [], { replacedBy: 'explorer.add_card' }),
  'coach.practise_say': e('coach', '"🎤 Practise saying it" beside a coach answer\'s sentence: a take checked against it (result = match | sound | contains | close | wrong — the "You said" row\'s state — or failed | empty; nothing is stored).', ['result']),
  'coach.mistake_lesson_generate': e('coach', '"🎯 Mini lesson on this mistake": asked for a lesson on the mistake a check found (existing = the conversation already had one).', ['existing']),
  'coach.mistake_lesson_play': e('coach', 'Played a coach mistake lesson in the player (preview: nothing recorded while playing).', ['exercises', 'saved']),
  'coach.mistake_lesson_save': e('coach', '"Save to my mini lessons" on a coach mistake lesson (done = saved right after doing it, its completion recorded; missed = exercises missed first time; rating from apps before Oct 2026).', ['done', 'rating', 'missed']),
  'coach.mistake_lesson_written': e('coach', 'A coach mistake lesson was written (exercises, distinct types, model rounds incl. repairs).', ['exercises', 'types', 'rounds'], { server: true }),
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
  'card.picture_generate': e('decks', 'Asked for a generated picture on a card (🖼 Add picture / Regenerate; where = edit | hub | deck).', ['regenerate', 'where']),
  'card.picture_upload': e('decks', 'Put their own picture on a card (camera = taken with the camera, else picked from the phone).', ['camera', 'where']),
  'card.picture_remove': e('decks', 'Took the picture off a card.', ['where']),
  'card.picture_open': e('study', 'Tapped a card picture to see it big (side = front | back).', ['side', 'card_type']),
  'deck.illustrate': e('decks', 'Started "Illustrate this deck" (pictures = how many were asked for).', ['pictures']),
  'deck.illustrate_new': e('decks', 'Turned a deck\'s "Illustrate new cards" on / off.', ['on']),
  'folder.create': e('decks', 'Made a folder (decks / library lessons / readers).', ['kind', 'nested']),
  'folder.rename': e('decks', 'Renamed a folder.', ['kind']),
  'folder.delete': e('decks', 'Deleted a folder (its items go to Unfiled).', ['kind', 'items']),
  'folder.move_items': e('decks', 'Moved items into a folder (or Unfiled).', ['kind', 'count', 'unfiled']),
  'folder.move_folder': e('decks', 'Moved a folder inside another folder (or to the top level).', ['kind', 'depth']),

  // ── settings ───────────────────────────────────────────────────────────
  'settings.change': e('settings', 'Changed a setting (`setting` names it, `value` an enum).', ['setting', 'value']),
  'settings.revisit_changed': e('settings', 'Changed the "Lessons & readers" settings — revisit gaps / new lessons a day (or reset them) — apps before Oct 2026; the settings are gone (lessons revise until right first time).', ['fields', 'reset', 'new_lessons_per_day'], { replacedBy: 'lesson.complete' }),
  'settings.new_card_order': e('settings', 'Changed "Order new cards by" (Settings → New cards): which new words come first (incl. everyday words before formal ones), and whether a word of known characters starts with English → Chinese (or reset it). Props = the switch changed and the switches after the change.', ['field', 'reset', 'new_characters_first', 'new_words_first', 'most_common_first', 'sentences_last', 'known_characters_english_first', 'everyday_first']),
  'settings.analytics': e('settings', 'Turned usage data sharing on / off.', ['on']),
  'settings.full_sync': e('settings', 'Ran a full sync by hand.', []),
  'settings.debug_report': e('settings', 'Sent a debug report by hand.', []),
  'settings.sign_out_all': e('settings', 'Signed out of all devices (Settings → Sign out of all devices; every session of the account revoked).', []),

  // ── notifications ──────────────────────────────────────────────────────
  'notification.tapped': e('notifications', 'Opened the app from a notification.', ['kind']),

  // ── errors shown to the user ───────────────────────────────────────────
  'error.shown': e('errors', 'An error message was shown to the user.', ['code', 'where', 'status']),

  // ── server (written by the worker) ─────────────────────────────────────
  'server.content_created': e('server', 'A deck / notes / lesson / reader was created through the API.', ['kind', 'count', 'via'], { server: true }),
  'server.audio_lesson_built': e('server', 'An audio lesson finished rendering.', ['format', 'minutes', 'clips'], { server: true }),
  'server.podcast_transcribed': e('server', 'A podcast episode finished transcribing, or failed (docs/PODCASTS.md; stage = where it failed).', ['ok', 'stage', 'minutes', 'segments'], { server: true }),
  'server.podcast_feed_fetched': e('server', "A podcast app fetched a user's private audio-lesson feed.", ['items'], { server: true }),
  'server.homework_assigned': e('server', 'Homework assignments were written for a student.', ['kind', 'mode', 'count'], { server: true }),
  'server.ai_call': e('server', 'One model call: model, tokens and an estimated cost.', ['provider', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cost_usd', 'status', 'route'], { server: true }),
  'server.push_sent': e('server', 'A push notification was sent.', ['channel', 'kind', 'ok'], { server: true }),
  'server.email_sent': e('server', 'An e-mail was sent.', ['kind', 'ok'], { server: true }),
  'server.word_tags_batch': e('server', 'One batch of the AI word tags (transitivity + register + Everyday speech) was run: batch_size = notes in it, notes tagged, tags shown (not low confidence, or Everyday speech), everyday = notes called Everyday speech, tokens, estimated cost; via = create | edit | backfill.', ['batch_size', 'tagged', 'shown', 'everyday', 'input_tokens', 'output_tokens', 'cost_usd', 'via'], { server: true }),
  'server.word_tags_backfill': e('server', "Untagged (or outdated-version) notes were queued for the AI word tags (via = sync — the hourly background fill — or api — POST /api/notes/word-tags/backfill / MCP).", ['queued', 'via'], { server: true }),
  'server.prepared_activities': e('server', 'In-call activities were prepared for a student\'s next lesson (trigger = lesson | nightly | manual; count written, refused after repair, model rounds, tokens, ms).', ['trigger', 'count', 'refused', 'rounds', 'input_tokens', 'output_tokens', 'ms'], { server: true }),
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

/** Where each app runs. `android-hybrid` is the Capacitor shell, `lab` the native app, `desktop` the Electron app (desktop/). */
export const ANALYTICS_PLATFORMS = ['web', 'pwa', 'android-hybrid', 'lab', 'desktop'] as const;
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
  'study.listen_context',
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
