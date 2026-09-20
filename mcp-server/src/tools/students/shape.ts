/**
 * Pure helpers for the student tools: trimming the API's responses down to
 * what Claude needs in a chat, defaults for dates, audio URLs. No I/O, so
 * everything here is unit-tested in ../students.test.ts.
 */
import type {
  CardType,
  ConversationRow,
  DashboardInvite,
  GoingWellNote,
  HistoryEvent,
  InsightRecording,
  InviteRow,
  MessageRow,
  MyRelationships,
  NeedsAttentionItem,
  RelationshipWithUsers,
  SharedDeckProgress,
  StrugglingNote,
  StudentOverview,
  StudentSummaryRow,
} from './types.js';

export const RATING_LABELS = ['again', 'hard', 'good', 'easy'] as const;

export function ratingLabel(rating: number | null | undefined): string | null {
  if (rating == null) return null;
  return RATING_LABELS[rating] ?? String(rating);
}

/** The API stores a recording as an R2 key (`recordings/<id>.webm`); it plays from `/api/audio/<key>`. */
export function audioUrl(apiBase: string, key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  const base = apiBase.replace(/\/+$/, '');
  if (key.startsWith('/api/audio/')) return `${base}${key}`;
  return `${base}/api/audio/${key.replace(/^\/+/, '')}`;
}

/** `YYYY-MM-DD` is accepted as-is (the API widens `to` to the end of that day); anything else must parse as a date. */
export function normalizeDateParam(value: string | undefined, name: string): string | undefined {
  if (value == null || value.trim() === '') return undefined;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`${name} must be an ISO date (YYYY-MM-DD or full timestamp), got "${value}"`);
  return d.toISOString();
}

export function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ---------- Students ----------

function compactNote(note: NeedsAttentionItem['note']) {
  return { note_id: note.id, hanzi: note.hanzi, pinyin: note.pinyin, english: note.english, deck: note.deck_name };
}

export function compactNeedsAttention(item: NeedsAttentionItem, apiBase: string) {
  return {
    ...compactNote(item.note),
    attempts: item.attempts,
    again_count: item.again_count,
    hard_count: item.hard_count,
    wrong_answers: item.wrong_answers,
    last_reviewed_at: item.last_reviewed_at,
    recordings_unheard: item.recordings_unheard,
    latest_recording: item.recording
      ? { event_id: item.recording.event_id, audio_url: audioUrl(apiBase, item.recording.recording_url) }
      : null,
  };
}

/** One dashboard row per student: everything a tutor scans before deciding whom to look at. */
export function compactStudentRow(o: StudentOverview, apiBase: string, needsAttentionLimit = 5) {
  return {
    relationship_id: o.relationship_id,
    student: { id: o.student.id, name: o.student.name, email: o.student.email },
    joined_at: o.joined_at,
    is_new: o.is_new,
    status: {
      studied_today: o.status.studied_today,
      streak_days: o.status.streak_days,
      active_days_30: o.status.active_days_30 ?? null,
      last_studied_at: o.status.last_studied_at,
      today: o.status.today,
    },
    pills: o.pills,
    needs_attention: o.needs_attention.slice(0, needsAttentionLimit).map((i) => compactNeedsAttention(i, apiBase)),
    homework: {
      percent: o.homework.percent,
      cards_total: o.homework.cards_total,
      cards_started: o.homework.cards_started,
      cards_mastered: o.homework.cards_mastered,
      lessons_total: o.homework.lessons_total,
      lessons_completed: o.homework.lessons_completed,
    },
    ...(o.is_new ? { setup: compactSetup(o.setup) } : {}),
    last_conversation_id: o.last_conversation_id,
  };
}

export function compactSetup(setup: StudentOverview['setup']) {
  return {
    done_count: setup.done_count,
    steps: setup.steps.map((s) => ({ key: s.key, done: s.done, detail: s.detail })),
    install_kind: setup.install_kind,
    audio_cached: setup.audio.cached,
    audio_total: setup.audio.total,
    last_opened_at: setup.last_opened_at,
    invite: setup.invite ? { id: setup.invite.id, url: setup.invite.url, status: setup.invite.status } : null,
  };
}

/** The full student page: the row plus every needs-attention word, homework decks/lessons, setup and recent days. */
export function compactStudentOverview(o: StudentOverview, apiBase: string) {
  return {
    ...compactStudentRow(o, apiBase, Number.MAX_SAFE_INTEGER),
    joined_via_invite: o.joined_via_invite,
    homework: {
      percent: o.homework.percent,
      cards_total: o.homework.cards_total,
      cards_started: o.homework.cards_started,
      cards_mastered: o.homework.cards_mastered,
      lessons_total: o.homework.lessons_total,
      lessons_completed: o.homework.lessons_completed,
      decks: o.homework.decks.map((d) => ({
        shared_deck_id: d.shared_deck_id,
        name: d.source_deck_name,
        student_deck_id: d.target_deck_id,
        shared_at: d.shared_at,
        cards_total: d.cards_total,
        cards_started: d.cards_started,
        cards_mastered: d.cards_mastered,
        percent_started: d.percent_started,
        percent_mastered: d.percent_mastered,
        words_missing_from_copy: d.notes_missing,
      })),
      lessons: o.homework.lessons.map((l) => ({
        lesson_id: l.lesson_id,
        title: l.title,
        completions: l.completions,
        last_completed_at: l.last_completed_at,
        last_rating: ratingLabel(l.last_rating),
      })),
    },
    setup: compactSetup(o.setup),
    recent_days: o.activity,
  };
}

export function compactDashboardInvite(i: DashboardInvite) {
  return {
    invite_id: i.id,
    url: i.url,
    email: i.email,
    inviter_role: i.inviter_role,
    created_at: i.created_at,
    expires_at: i.expires_at,
    link_opened_at: i.opened_at,
    share_deck_count: i.share_deck_count,
    note: i.note,
  };
}

function otherParty(rel: RelationshipWithUsers, myUserId: string) {
  const other = rel.requester_id === myUserId ? rel.recipient : rel.requester;
  return { id: other.id, name: other.name, email: other.email };
}

/** Relationships where the signed-in user is the STUDENT, plus pending requests either way. */
export function compactMyRelationships(mine: MyRelationships, myUserId: string) {
  return {
    my_tutors: mine.tutors.map((rel) => ({
      relationship_id: rel.id,
      tutor: otherParty(rel, myUserId),
      since: rel.accepted_at ?? rel.created_at,
    })),
    pending_incoming: mine.pending_incoming.map((rel) => ({
      relationship_id: rel.id,
      from: otherParty(rel, myUserId),
      they_would_be: rel.requester_role,
      created_at: rel.created_at,
    })),
    pending_outgoing: mine.pending_outgoing.map((rel) => ({
      relationship_id: rel.id,
      to: otherParty(rel, myUserId),
      i_would_be: rel.requester_role,
      created_at: rel.created_at,
    })),
  };
}

// ---------- Insights ----------

export function compactStruggling(s: StrugglingNote) {
  const { events: _events, note, ...rest } = s;
  return { ...compactNote(note), deck_id: note.deck_id, ...rest };
}

export function compactGoingWell(g: GoingWellNote) {
  const { note, ...rest } = g;
  return { ...compactNote(note), ...rest };
}

export function compactRecording(r: InsightRecording, apiBase: string) {
  return {
    event_id: r.event_id,
    hanzi: r.note.hanzi,
    pinyin: r.note.pinyin,
    english: r.note.english,
    deck: r.note.deck_name,
    card_type: r.card_type,
    rating: ratingLabel(r.rating),
    recorded_at: r.reviewed_at,
    audio_url: audioUrl(apiBase, r.recording_url),
    user_answer: r.user_answer,
    mark: r.mark ? { status: r.mark.status, comment: r.mark.comment, updated_at: r.mark.updated_at } : null,
  };
}

export function filterRecordings(recordings: InsightRecording[], onlyUnmarked: boolean): InsightRecording[] {
  return onlyUnmarked ? recordings.filter((r) => !r.mark) : recordings;
}

export function compactHistoryEvent(e: HistoryEvent, apiBase: string) {
  return {
    event_id: e.event_id,
    reviewed_at: e.reviewed_at,
    hanzi: e.hanzi,
    pinyin: e.pinyin,
    english: e.english,
    deck: e.deck_name,
    deck_id: e.deck_id,
    card_type: e.card_type,
    rating: ratingLabel(e.rating),
    user_answer: e.user_answer,
    time_spent_ms: e.time_spent_ms,
    audio_url: audioUrl(apiBase, e.recording_url),
    note_id: e.note_id,
    card_id: e.card_id,
  };
}

export function compactSummary(s: StudentSummaryRow) {
  return {
    summary_id: s.id,
    range_from: s.range_from,
    range_to: s.range_to,
    narrative_en: s.narrative_en,
    narrative_zh: s.narrative_zh,
    created_at: s.created_at,
  };
}

// ---------- Conversations ----------

export function compactConversation(c: ConversationRow) {
  return {
    conversation_id: c.id,
    title: c.title,
    with: { id: c.other_user.id, name: c.other_user.name },
    is_ai_conversation: !!c.is_ai_conversation,
    created_at: c.created_at,
    last_message_at: c.last_message_at,
    last_message: c.last_message
      ? { sender_id: c.last_message.sender_id, content: c.last_message.content, created_at: c.last_message.created_at }
      : null,
  };
}

export function compactMessage(m: MessageRow, myUserId: string, apiBase: string) {
  return {
    message_id: m.id,
    from: m.sender_id === myUserId ? 'me' : m.sender.name || m.sender_id,
    sender_id: m.sender_id,
    content: m.content,
    created_at: m.created_at,
    ...(m.translation ? { translation: m.translation } : {}),
    ...(m.check_status ? { check_status: m.check_status, check_feedback: m.check_feedback } : {}),
    ...(m.recording_url ? { audio_url: audioUrl(apiBase, m.recording_url) } : {}),
    ...(m.reply_to ? { reply_to: { message_id: m.reply_to.id, content: m.reply_to.content } } : {}),
  };
}

/** The last `limit` messages in chronological order (the API returns them oldest first). */
export function lastMessages<T>(messages: T[], limit: number): T[] {
  if (messages.length <= limit) return messages;
  return messages.slice(messages.length - limit);
}

// ---------- Homework decks ----------

export function compactSharedDeckProgress(p: SharedDeckProgress, maxNotes: number) {
  return {
    deck_name: p.deck_name,
    shared_at: p.shared_at,
    completion: p.completion,
    by_card_type: p.card_type_breakdown,
    activity: p.activity,
    words_total: p.notes.length,
    words: p.notes.slice(0, maxNotes).map((n) => ({
      hanzi: n.hanzi,
      pinyin: n.pinyin,
      english: n.english,
      mastery_percent: n.mastery_percent,
      recent_ratings: Object.fromEntries(
        (Object.keys(n.recent_ratings) as CardType[]).map((k) => [k, n.recent_ratings[k].map((r) => ratingLabel(r))])
      ),
    })),
  };
}

// ---------- Invites ----------

export function parseDeckIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function compactInvite(i: InviteRow) {
  return {
    invite_id: i.id,
    url: i.url,
    status: i.status,
    email: i.email,
    inviter_role: i.inviter_role,
    share_deck_ids: parseDeckIds(i.share_deck_ids),
    uses: `${i.use_count}/${i.max_uses}`,
    created_at: i.created_at,
    expires_at: i.expires_at,
    link_opened_at: i.opened_at,
    note: i.note,
    welcome_message: i.welcome_message,
    ...(i.creator_email ? { created_by: i.creator_name || i.creator_email } : {}),
    redemptions: (i.redemptions ?? []).map((r) => ({
      user_id: r.user_id,
      name: r.user_name,
      email: r.user_email,
      redeemed_at: r.redeemed_at,
    })),
  };
}
