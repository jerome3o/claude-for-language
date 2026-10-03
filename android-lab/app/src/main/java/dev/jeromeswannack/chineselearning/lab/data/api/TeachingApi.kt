package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/*
 * Package F — the tutor side (web: api/tutorDashboard.ts, api/homework.ts, api/cardFlags.ts,
 * api/insights.ts, api/lessonEditor.ts getStudentLessons, types/tutorDashboard.ts).
 * DTOs declare only what the Lab screens use (decoding ignores unknown keys).
 */

// ---------------- dashboard / student overview ----------------

@Serializable
data class TodayStatsDto(val reviews: Int = 0, val accuracy: Double? = null, val time_ms: Long = 0)

@Serializable
data class StudyStatusDto(
    val last_studied_at: String? = null,
    val studied_today: Boolean = false,
    val streak_days: Int = 0,
    val active_days_30: Int = 0,
    val today: TodayStatsDto = TodayStatsDto(),
)

@Serializable
data class NoteRefDto(
    val id: String,
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_id: String? = null,
    val deck_name: String? = null,
)

@Serializable
data class RecordingRefDto(val event_id: String, val recording_url: String)

@Serializable
data class NeedsAttentionDto(
    val note: NoteRefDto,
    val attempts: Int = 0,
    val again_count: Int = 0,
    val hard_count: Int = 0,
    val wrong_answers: List<String> = emptyList(),
    val wrong_typed_count: Int = 0,
    val last_reviewed_at: String? = null,
    val recording: RecordingRefDto? = null,
    val recordings_unheard: Int = 0,
)

@Serializable
data class HomeworkDeckDto(
    val shared_deck_id: String,
    val source_deck_id: String = "",
    val target_deck_id: String = "",
    val source_deck_name: String = "",
    val target_deck_name: String? = null,
    val shared_at: String = "",
    val cards_total: Int = 0,
    val cards_started: Int = 0,
    val cards_mastered: Int = 0,
    val notes_missing: Int = 0,
    val percent_started: Int = 0,
    val percent_mastered: Int = 0,
    val notes_total: Int = 0,
    val notes_introduced: Int = 0,
    val words_to_go: Int = 0,
    val days_to_go: Int = 0,
    val queue_position: Int? = null,
    val queue_total: Int = 0,
)

@Serializable
data class HomeworkLessonDto(
    val lesson_id: String,
    val title: String = "",
    val icon: String? = null,
    val created_at: String = "",
    val completions: Int = 0,
    val last_completed_at: String? = null,
    val last_rating: Int? = null,
)

@Serializable
data class HomeworkSummaryDto(
    val percent: Int? = null,
    val decks: List<HomeworkDeckDto> = emptyList(),
    val lessons: List<HomeworkLessonDto> = emptyList(),
)

@Serializable
data class SetupStepDto(val key: String, val title: String = "", val done: Boolean = false, val detail: String = "")

@Serializable
data class InviteRefDto(val id: String, val url: String, val status: String = "", val redeemed_at: String? = null)

@Serializable
data class SetupAudioDto(val cached: Int? = null, val total: Int = 0)

@Serializable
data class SetupStatusDto(
    val steps: List<SetupStepDto> = emptyList(),
    val done_count: Int = 0,
    val install_kind: String? = null,
    val audio: SetupAudioDto = SetupAudioDto(),
    val last_opened_at: String? = null,
    val invite: InviteRefDto? = null,
)

@Serializable
data class ActivityDayDto(val day: String, val reviews: Int = 0, val accuracy: Double? = null, val time_ms: Long = 0)

@Serializable
data class PillsDto(
    val struggling_words: Int = 0,
    val recordings_to_hear: Int = 0,
    val homework_percent: Int? = null,
    val flags_open: Int = 0,
)

@Serializable
data class StudentOverviewDto(
    val relationship_id: String,
    val student: UserSummaryDto,
    val joined_at: String = "",
    val joined_via_invite: Boolean = false,
    val is_new: Boolean = false,
    val status: StudyStatusDto = StudyStatusDto(),
    val pills: PillsDto = PillsDto(),
    val needs_attention: List<NeedsAttentionDto> = emptyList(),
    val homework: HomeworkSummaryDto = HomeworkSummaryDto(),
    val setup: SetupStatusDto = SetupStatusDto(),
    val activity: List<ActivityDayDto> = emptyList(),
    val last_conversation_id: String? = null,
    /** The tutor has written a private student profile (null from an older server). */
    val has_profile: Boolean? = null,
)

@Serializable
data class PendingInviteDto(
    val id: String,
    val url: String,
    val email: String? = null,
    val created_at: String = "",
    val expires_at: String? = null,
    val note: String? = null,
    val share_deck_count: Int = 0,
    val opened_at: String? = null,
)

@Serializable
data class HomeworkDeckSummaryDto(
    val deck_id: String,
    val name: String = "",
    val note_count: Int = 0,
    val student_count: Int = 0,
    val last_shared_at: String = "",
)

@Serializable
data class TutorDashboardDto(
    val students: List<StudentOverviewDto> = emptyList(),
    val invites: List<PendingInviteDto> = emptyList(),
    val homework_decks: List<HomeworkDeckSummaryDto> = emptyList(),
    val generated_at: String? = null,
)

/** The web's `new Date().getTimezoneOffset()`: minutes to ADD to local time to get UTC. */
fun tzOffsetMinutes(zone: ZoneId = ZoneId.systemDefault()): Int = -ZonedDateTime.now(zone).offset.totalSeconds / 60

/** Today as the web's `localDate()` ('YYYY-MM-DD' on this phone). */
fun localToday(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()

private fun rel(relId: String) = "/api/relationships/${enc(relId)}"

suspend fun Api.tutorDashboard(): TutorDashboardDto = get("/api/tutor/dashboard?tz_offset=${tzOffsetMinutes()}")

suspend fun Api.studentOverview(relId: String): StudentOverviewDto = get("${rel(relId)}/overview?tz_offset=${tzOffsetMinutes()}")

@Serializable
data class OpenConversationDto(val conversation_id: String, val created: Boolean = false)

suspend fun Api.openConversation(relId: String): OpenConversationDto = post("${rel(relId)}/conversations/open")

@Serializable
data class HowToSentDto(val conversation_id: String? = null)

suspend fun Api.sendInstallHowTo(relId: String): HowToSentDto = post("${rel(relId)}/send-howto")

@Serializable
data class SharedDeckUpdateDto(val added: Int = 0, val kept: Int = 0, val audio_filled: Int = 0, val updated: Int = 0)

suspend fun Api.updateSharedDeckCopy(relId: String, sharedDeckId: String): SharedDeckUpdateDto =
    post("${rel(relId)}/shared-decks/${enc(sharedDeckId)}/update")

@Serializable
data class QueueMoveBody(val to: String)

@Serializable
data class SharedDeckMoveDto(val queue_position: Int, val queue_total: Int)

/** [to]: top | up | down | bottom (shared/decks QueueMove). */
suspend fun Api.moveSharedDeck(relId: String, sharedDeckId: String, to: String): SharedDeckMoveDto =
    post("${rel(relId)}/shared-decks/${enc(sharedDeckId)}/move", QueueMoveBody(to))

suspend fun Api.removeRelationship(relId: String) = delete<Unit>(rel(relId))

suspend fun Api.revokeInvite(id: String) = delete<Unit>("/api/invites/${enc(id)}")

// ---------------- conversations / lessons / lesson log ----------------

@Serializable
data class LastMessageDto(val content: String = "", val attachment_kind: String? = null, val deleted_at: String? = null)

@Serializable
data class ConversationDto(
    val id: String,
    val title: String? = null,
    val created_at: String = "",
    val last_message_at: String? = null,
    val last_message: LastMessageDto? = null,
    /** PR 2 (docs/CHAT.md): messages from the other person after my read marker. */
    val unread: Int = 0,
)

suspend fun Api.conversations(relId: String): List<ConversationDto> = get("${rel(relId)}/conversations")

@Serializable
data class StudentLessonDto(
    val id: String,
    val title: String = "",
    val icon: String? = null,
    val source: String = "",
    val exercise_count: Int = 0,
    val assigned_by: String? = null,
    val assigned_by_me: Boolean = false,
    val completions: Int = 0,
    val last_completed_at: String? = null,
    val last_rating: Int? = null,
    val last_attempt_id: String? = null,
)

@Serializable
private data class StudentLessonsDto(val lessons: List<StudentLessonDto> = emptyList())

suspend fun Api.studentLessons(relId: String): List<StudentLessonDto> = get<StudentLessonsDto>("${rel(relId)}/student-lessons").lessons

@Serializable
data class LessonLogEntryDto(val id: String, val lesson_at: String, val notes: String? = null, val created_at: String = "")

@Serializable
private data class LessonLogDto(val entries: List<LessonLogEntryDto> = emptyList())

suspend fun Api.lessonLog(relId: String): List<LessonLogEntryDto> = get<LessonLogDto>("${rel(relId)}/lesson-log").entries

@Serializable
data class LogLessonBody(val lesson_at: String, val notes: String? = null)

suspend fun Api.logLesson(relId: String, lessonAt: String, notes: String?) =
    post<LogLessonBody, Unit>("${rel(relId)}/lesson-log", LogLessonBody(lessonAt, notes))

suspend fun Api.deleteLessonLogEntry(relId: String, id: String) = delete<Unit>("${rel(relId)}/lesson-log/${enc(id)}")

@Serializable
data class StudentSharedDeckDto(val id: String, val deck_name: String = "", val note_count: Int = 0, val shared_at: String = "")

suspend fun Api.studentSharedDecks(relId: String): List<StudentSharedDeckDto> = get("${rel(relId)}/student-shared-decks")

@Serializable
data class LibraryItemSummaryDto(
    val id: String,
    val title: String = "",
    val icon: String? = null,
    val assignment_count: Int = 0,
    val exercise_count: Int = 0,
)

@Serializable
private data class LibraryListDto(val items: List<LibraryItemSummaryDto> = emptyList())

suspend fun Api.lessonLibrary(): List<LibraryItemSummaryDto> = get<LibraryListDto>("/api/lesson-library").items

// ---------------- homework assignments + load (docs/HOMEWORK.md) ----------------

@Serializable
data class AssignmentDto(
    val id: String,
    val kind: String = "deck",
    val target_id: String = "",
    val source_id: String? = null,
    val title: String = "",
    val mode: String = "fsrs",
    val due_date: String? = null,
    val item_count: Int = 0,
    val part_index: Int = 0,
    val part_count: Int = 1,
    val status: String = "active",
    val done_count: Int = 0,
    val completed_at: String? = null,
    val created_at: String = "",
)

@Serializable
data class LoadDayDto(val date: String, val items: Int = 0, val words: Int = 0)

@Serializable
data class LoadOneOffDto(
    val items: Int = 0,
    val words: Int = 0,
    val other: Int = 0,
    val overdue_items: Int = 0,
    val overdue_words: Int = 0,
    val due_today_items: Int = 0,
    val by_day: List<LoadDayDto> = emptyList(),
)

@Serializable
data class LoadFsrsDto(val words_to_go: Int = 0, val days_to_go: Int = 0, val new_per_day: Int = 0)

@Serializable
data class HomeworkLoadDto(
    val one_off: LoadOneOffDto = LoadOneOffDto(),
    val fsrs: LoadFsrsDto = LoadFsrsDto(),
    /** light | moderate | heavy */
    val level: String = "light",
    val summary: String = "",
)

@Serializable
data class RelationshipHomeworkDto(
    val assignments: List<AssignmentDto> = emptyList(),
    val load: HomeworkLoadDto = HomeworkLoadDto(),
    val today: String = "",
)

suspend fun Api.relationshipHomework(relId: String): RelationshipHomeworkDto = get("${rel(relId)}/homework?today=${localToday()}")

@Serializable
data class AssignItemDto(
    val kind: String,
    val source_id: String,
    val mode: String,
    val due_date: String? = null,
    val split_days: Int? = null,
    val priority: String? = null,
    val skip_known: Boolean? = null,
)

@Serializable
data class AssignBody(val items: List<AssignItemDto>, val today: String)

@Serializable
data class SkippedDto(val source_id: String = "", val hanzi: List<String> = emptyList())

@Serializable
data class AssignErrorDto(val source_id: String = "", val error: String = "")

@Serializable
data class AssignResponseDto(
    val assignments: List<AssignmentDto> = emptyList(),
    val skipped: List<SkippedDto> = emptyList(),
    val errors: List<AssignErrorDto> = emptyList(),
)

suspend fun Api.assignHomework(relId: String, items: List<AssignItemDto>): AssignResponseDto =
    post("${rel(relId)}/homework", AssignBody(items, localToday()))

@Serializable
data class AssignmentPatchBody(val due_date: String? = null, val status: String? = null)

suspend fun Api.updateHomeworkAssignment(relId: String, id: String, patch: AssignmentPatchBody) =
    patch<AssignmentPatchBody, Unit>("${rel(relId)}/homework/${enc(id)}", patch)

// ---------------- card flags + Ask-Claude threads (tutor view) ----------------

@Serializable
data class TeachFlagDto(
    val id: String,
    val note_id: String,
    val message: String = "",
    /** open | resolved */
    val status: String = "open",
    val tutor_reply: String? = null,
    val replied_at: String? = null,
    val created_at: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_name: String = "",
    val student_name: String? = null,
    val tutor_name: String? = null,
)

@Serializable
data class TeachFlagsDto(val flags: List<TeachFlagDto> = emptyList(), val open: Int = 0)

suspend fun Api.cardFlags(relId: String, status: String = "all"): TeachFlagsDto = get("${rel(relId)}/card-flags?status=$status")

@Serializable
data class ReplyBody(val reply: String)

suspend fun Api.replyToCardFlag(flagId: String, reply: String) = post<ReplyBody, Unit>("/api/card-flags/${enc(flagId)}/reply", ReplyBody(reply))

suspend fun Api.resolveCardFlag(flagId: String) = post<Unit>("/api/card-flags/${enc(flagId)}/resolve")

suspend fun Api.reopenCardFlag(flagId: String) = post<Unit>("/api/card-flags/${enc(flagId)}/reopen")

@Serializable
data class ClaudeQuestionDto(
    val id: String,
    val note_id: String,
    val question: String = "",
    val answer: String = "",
    val asked_at: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_name: String = "",
)

@Serializable
data class ClaudeChatsDto(val questions: List<ClaudeQuestionDto> = emptyList(), val next_cursor: String? = null, val total: Int = 0)

suspend fun Api.studentClaudeChats(relId: String, limit: Int = 40, before: String? = null, noteId: String? = null): ClaudeChatsDto {
    val q = buildList {
        add("limit=$limit")
        if (before != null) add("before=${enc(before)}")
        if (noteId != null) add("note_id=${enc(noteId)}")
    }.joinToString("&")
    return get("${rel(relId)}/claude-chats?$q")
}

// ---------------- account, decks, calls (what the tutor screens need of them) ----------------

/** The two /api/auth/me flags the Students tab needs (Prefs keeps the rest). */
@Serializable
data class TeachingMeDto(val id: String = "", val can_invite: Boolean = false, val is_admin: Boolean = false)

suspend fun Api.teachingMe(): TeachingMeDto = get("/api/auth/me")

@Serializable
data class TeachNewDeckBody(val name: String)

@Serializable
data class CreatedDeckDto(val id: String, val name: String = "")

/** "+ New homework deck → Write it" (POST /api/decks; the content service fills the defaults). */
suspend fun Api.createDeckNamed(name: String): CreatedDeckDto = post("/api/decks", TeachNewDeckBody(name))

@Serializable
data class CallRefDto(
    val id: String,
    /** Who is connected to the call's room right now (absent from an older server). */
    val present_user_ids: List<String>? = null,
)

@Serializable
data class CallsDto(val calls: List<CallRefDto> = emptyList()) {
    /**
     * The live call someone is actually in (web: the banner rule, shared/calls/alerts.ts) — a row
     * that is still "live" with nobody connected is not offered; without presence data, the first.
     */
    fun occupiedCallId(): String? = calls.firstOrNull { it.present_user_ids == null || it.present_user_ids.isNotEmpty() }?.id
}

suspend fun Api.liveCalls(relId: String): CallsDto = get("/api/calls?relationship_id=${enc(relId)}&live=1")

@Serializable
data class NewCallBody(val relationship_id: String)

@Serializable
data class CreatedCallDto(val call: CallRefDto)

suspend fun Api.startCall(relId: String): CreatedCallDto = post("/api/calls", NewCallBody(relId))

// ---------------- invites (web: api/invites.ts, components/invites/InviteSheet.tsx) ----------------

@Serializable
data class CreateInviteBody(
    val inviter_role: String?,
    val share_deck_ids: List<String>,
    val welcome_message: String?,
    val email: String?,
    val expires_in_days: Int?,
    val max_uses: Int,
    val note: String?,
)

@Serializable
data class InviteDto(
    val id: String,
    val url: String = "",
    val email: String? = null,
    val inviter_role: String? = null,
    /** JSON array text, as stored. */
    val share_deck_ids: String? = null,
    val max_uses: Int = 1,
    val expires_at: String? = null,
    val welcome_message: String? = null,
)

suspend fun Api.createInvite(body: CreateInviteBody): InviteDto = post("/api/invites", body)

@Serializable
data class TeachStarterDeckDto(val deck: CreatedDeckDto, val created: Boolean = false, val word_count: Int = 0)

suspend fun Api.createStarterDeck(): TeachStarterDeckDto = post("/api/decks/starter")

// ---------------- insights, history, recording marks (web: api/insights.ts, types/insights.ts) ----------------

@Serializable
data class InsightTotalsDto(
    val reviews: Int = 0,
    val unique_notes: Int = 0,
    val days_active: Int = 0,
    val accuracy: Double = 0.0,
    val again_rate: Double = 0.0,
    val time_ms: Long = 0,
    val new_words_introduced: Int = 0,
)

@Serializable
data class InsightAttemptDto(
    val event_id: String,
    val card_type: String = "hanzi_to_meaning",
    val rating: Int = 2,
    val reviewed_at: String = "",
    val time_spent_ms: Long? = null,
    val user_answer: String? = null,
    val recording_url: String? = null,
)

@Serializable
data class StrugglingDto(
    val note: NoteRefDto,
    val attempts: Int = 0,
    val again_count: Int = 0,
    val again_rate: Double = 0.0,
    val hard_count: Int = 0,
    val forgot_count: Int = 0,
    val avg_time_ms: Double? = null,
    val wrong_answers: List<String> = emptyList(),
    val recordings_count: Int = 0,
    val events: List<InsightAttemptDto> = emptyList(),
)

@Serializable
data class GoingWellDto(
    val note: NoteRefDto,
    val attempts: Int = 0,
    val easy_count: Int = 0,
    /** consistent | graduated */
    val reason: String = "consistent",
    val max_interval_days: Int? = null,
)

@Serializable
data class RecordingMarkDto(val review_event_id: String = "", val status: String = "listened", val comment: String? = null, val updated_at: String = "")

@Serializable
data class InsightRecordingDto(
    val event_id: String,
    val note: NoteRefDto,
    val card_type: String = "hanzi_to_meaning",
    val rating: Int = 2,
    val reviewed_at: String = "",
    val recording_url: String = "",
    val user_answer: String? = null,
    val mark: RecordingMarkDto? = null,
)

@Serializable
data class ActivityLessonDto(val lesson_id: String, val title: String = "", val rating: Int? = null, val completed_at: String = "")

@Serializable
data class ActivityReaderDto(val reader_id: String, val title_chinese: String = "", val title_english: String = "", val rating: Int = 2, val reviewed_at: String = "")

@Serializable
data class ActivityQuestDto(val quest_id: String, val title: String = "", val completed_at: String = "", val best_moves: Int? = null)

@Serializable
data class InsightActivityDto(
    val lessons: List<ActivityLessonDto> = emptyList(),
    val readers: List<ActivityReaderDto> = emptyList(),
    val quests: List<ActivityQuestDto> = emptyList(),
)

@Serializable
data class InsightRangeDto(val from: String = "", val to: String = "")

@Serializable
data class InsightsReportDto(
    val range: InsightRangeDto = InsightRangeDto(),
    val totals: InsightTotalsDto = InsightTotalsDto(),
    val struggling: List<StrugglingDto> = emptyList(),
    val going_well: List<GoingWellDto> = emptyList(),
    val activity: InsightActivityDto = InsightActivityDto(),
    val recordings: List<InsightRecordingDto> = emptyList(),
)

private fun qs(vararg p: Pair<String, String?>): String {
    val present = p.filter { !it.second.isNullOrEmpty() }
    return if (present.isEmpty()) "" else "?" + present.joinToString("&") { (k, v) -> "$k=${enc(v!!)}" }
}

suspend fun Api.studentInsights(relId: String, from: String? = null, to: String? = null): InsightsReportDto =
    get("${rel(relId)}/insights${qs("from" to from, "to" to to)}")

@Serializable
data class StudentSummaryDto(
    val id: String,
    val range_from: String = "",
    val range_to: String = "",
    val narrative_en: String = "",
    val narrative_zh: String = "",
    val created_at: String = "",
)

@Serializable
private data class SummariesDto(val summaries: List<StudentSummaryDto> = emptyList())

@Serializable
private data class SummaryDto(val summary: StudentSummaryDto)

suspend fun Api.studentSummaries(relId: String): List<StudentSummaryDto> = get<SummariesDto>("${rel(relId)}/insights/summaries").summaries

suspend fun Api.writeStudentSummary(relId: String, range: InsightRangeDto): StudentSummaryDto =
    post<InsightRangeDto, SummaryDto>("${rel(relId)}/insights/summary", range).summary

@Serializable
data class MarkBody(val status: String, val comment: String? = null)

@Serializable
private data class MarkDto(val mark: RecordingMarkDto)

suspend fun Api.markRecording(relId: String, eventId: String, body: MarkBody): RecordingMarkDto =
    put<MarkBody, MarkDto>("${rel(relId)}/recordings/${enc(eventId)}/mark", body).mark

suspend fun Api.clearRecordingMark(relId: String, eventId: String) = delete<Unit>("${rel(relId)}/recordings/${enc(eventId)}/mark")

@Serializable
data class HistoryEventDto(
    val event_id: String,
    val card_type: String = "hanzi_to_meaning",
    val note_id: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_name: String = "",
    val rating: Int = 2,
    val time_spent_ms: Long? = null,
    val user_answer: String? = null,
    val recording_url: String? = null,
    val reviewed_at: String = "",
)

@Serializable
data class DeckRefDto(val id: String, val name: String = "")

@Serializable
data class HistoryPageDto(
    val range: InsightRangeDto = InsightRangeDto(),
    val events: List<HistoryEventDto> = emptyList(),
    val next_cursor: String? = null,
    val decks: List<DeckRefDto>? = null,
)

data class HistoryQuery(
    val from: String? = null,
    val deckId: String? = null,
    val cardType: String? = null,
    val rating: Int? = null,
    val q: String? = null,
    val cursor: String? = null,
    val limit: Int = 100,
)

suspend fun Api.studentHistory(relId: String, h: HistoryQuery): HistoryPageDto = get(
    "${rel(relId)}/history" + qs(
        "from" to h.from, "deck_id" to h.deckId, "card_type" to h.cardType, "rating" to h.rating?.toString(),
        "q" to h.q, "cursor" to h.cursor, "limit" to h.limit.toString(),
    ),
)

// ---------------- session-notes jobs, lesson notes → homework drafts (docs/HOMEWORK.md §4) ----------------

@Serializable
data class JobStepDto(val at: String = "", val text: String = "", /** info | tool | warn | done | error */ val kind: String = "info")

@Serializable
data class JobDeckDto(val id: String, val name: String = "", val note_count: Int = 0, val target_deck_id: String? = null, /** Set once the tutor took it back (homework removal). */ val removed_at: String? = null)

@Serializable
data class JobLessonDto(val library_item_id: String, val title: String = "", val lesson_id: String? = null, val exercise_count: Int = 0, val removed_at: String? = null)

@Serializable
data class JobReaderDto(val id: String, val title_english: String = "", val title_chinese: String = "", val page_count: Int = 0, val target_reader_id: String? = null, val removed_at: String? = null)

@Serializable
data class JobResultDto(
    val deck: JobDeckDto? = null,
    val lessons: List<JobLessonDto> = emptyList(),
    val reader: JobReaderDto? = null,
    val summary: String? = null,
    val skipped: List<String> = emptyList(),
)

@Serializable
data class ChatLineDto(/** tutor | assistant */ val role: String = "assistant", val text: String = "", val at: String = "")

@Serializable
data class SessionJobDto(
    val id: String,
    val title: String? = null,
    val notes: String = "",
    val notes_chars: Int = 0,
    val lesson_at: String? = null,
    /** queued | running | done | failed | cancelled */
    val status: String = "queued",
    val progress: String? = null,
    val steps: List<JobStepDto> = emptyList(),
    val result: JobResultDto = JobResultDto(),
    val error: String? = null,
    val source_call_id: String? = null,
    val created_at: String = "",
    /** 1 / true for a draft (the rows are SQLite ints; some routes send booleans). */
    val review: kotlinx.serialization.json.JsonPrimitive? = null,
    val assigned_at: String? = null,
    val chat: List<ChatLineDto> = emptyList(),
) {
    val active: Boolean get() = status == "queued" || status == "running"
    val isDraft: Boolean get() = review?.content.let { it == "1" || it == "true" }
}

@Serializable
private data class JobsDto(val jobs: List<SessionJobDto> = emptyList())

@Serializable
private data class JobDto(val job: SessionJobDto)

private fun sn(relId: String) = "${rel(relId)}/session-notes"

suspend fun Api.sessionNotesJobs(relId: String, limit: Int = 50): List<SessionJobDto> = get<JobsDto>("${sn(relId)}?limit=$limit").jobs

@Serializable
data class SubmitSessionNotesBody(
    val notes: String,
    val title: String? = null,
    val lesson_at: String? = null,
    val priority: String? = null,
    val auto_share: Boolean? = null,
    val log_lesson: Boolean? = null,
)

suspend fun Api.submitSessionNotes(relId: String, body: SubmitSessionNotesBody): SessionJobDto = post<SubmitSessionNotesBody, JobDto>(sn(relId), body).job

suspend fun Api.retrySessionJob(relId: String, id: String): SessionJobDto = post<JobDto>("${sn(relId)}/${enc(id)}/retry").job

suspend fun Api.cancelSessionJob(relId: String, id: String): SessionJobDto = post<JobDto>("${sn(relId)}/${enc(id)}/cancel").job

suspend fun Api.deleteSessionJob(relId: String, id: String) = delete<Unit>("${sn(relId)}/${enc(id)}")

@Serializable
data class LessonNotesJobBriefDto(
    val id: String,
    val status: String = "queued",
    val progress: String? = null,
    val review: Boolean = false,
    val assigned_at: String? = null,
    val error: String? = null,
)

@Serializable
data class LessonNotesEntryDto(
    val id: String,
    val lesson_at: String = "",
    val title: String? = null,
    val notes: String? = null,
    val job: LessonNotesJobBriefDto? = null,
)

@Serializable
private data class EntriesDto(val entries: List<LessonNotesEntryDto> = emptyList())

suspend fun Api.lessonNotes(relId: String): List<LessonNotesEntryDto> = get<EntriesDto>("${rel(relId)}/lesson-notes").entries

@Serializable
data class AddLessonNotesBody(val notes: String, val title: String? = null, val lesson_at: String? = null, val draft: Boolean)

@Serializable
data class AddLessonNotesDto(val entry: LessonNotesEntryDto? = null, val job: LessonNotesJobBriefDto? = null)

suspend fun Api.addLessonNotes(relId: String, body: AddLessonNotesBody): AddLessonNotesDto = post("${rel(relId)}/lesson-notes", body)

@Serializable
data class DraftJobDto(val job: LessonNotesJobBriefDto)

suspend fun Api.draftFromLessonNotes(relId: String, logId: String): DraftJobDto = post("${rel(relId)}/lesson-notes/${enc(logId)}/draft")

@Serializable
data class DraftPlanItemDto(
    val key: String,
    val kind: String,
    val source_id: String,
    val title: String = "",
    val include: Boolean = true,
    val mode: String = "one_off",
    val due_date: String? = null,
)

@Serializable
data class DraftPlanDto(
    val split_days: Int = 1,
    val priority: String = "core",
    val include_known: List<String> = emptyList(),
    val items: List<DraftPlanItemDto> = emptyList(),
)

@Serializable
data class KnownDto(val deck_name: String = "", val state: String = "")

@Serializable
data class DraftWordDto(val id: String, val hanzi: String = "", val pinyin: String = "", val english: String = "", val known: KnownDto? = null, val skipped: Boolean = false)

@Serializable
data class DraftViewDto(
    val student_name: String = "",
    val job: SessionJobDto,
    val plan: DraftPlanDto = DraftPlanDto(),
    val words: List<DraftWordDto> = emptyList(),
    val kept_count: Int = 0,
    val skipped_count: Int = 0,
    val load: HomeworkLoadDto = HomeworkLoadDto(),
    val load_after: HomeworkLoadDto = HomeworkLoadDto(),
    val assignments: List<AssignmentDto> = emptyList(),
) {
    val working: Boolean get() = job.active
}

private fun draftPath(relId: String, jobId: String) = "${rel(relId)}/homework-drafts/${enc(jobId)}"

suspend fun Api.homeworkDraft(relId: String, jobId: String): DraftViewDto = get("${draftPath(relId, jobId)}?today=${localToday()}")

@Serializable
data class PlanBody(val plan: DraftPlanDto, val today: String)

suspend fun Api.saveDraftPlan(relId: String, jobId: String, plan: DraftPlanDto): DraftViewDto = put("${draftPath(relId, jobId)}/plan", PlanBody(plan, localToday()))

@Serializable
data class DraftMessageBody(val message: String)

suspend fun Api.sendDraftMessage(relId: String, jobId: String, message: String): DraftJobDto = post("${draftPath(relId, jobId)}/messages", DraftMessageBody(message))

@Serializable
data class TodayBody(val today: String)

suspend fun Api.assignHomeworkDraft(relId: String, jobId: String): AssignResponseDto = post("${draftPath(relId, jobId)}/assign", TodayBody(localToday()))

/** DELETE /api/notes/:id — removing a word from a draft deletes it from the tutor's draft deck (as the web). */
suspend fun Api.deleteDraftWord(noteId: String) = delete<Unit>("/api/notes/${enc(noteId)}")

// ---------------- the tutor's card hub (GET /api/relationships/:relId/notes/:noteId/hub; NoteHubDto is package C's) ----------------

suspend fun Api.studentNoteHub(relId: String, noteId: String): NoteHubDto = get("${rel(relId)}/notes/${enc(noteId)}/hub")

// ---------------- student progress: 30 days, a day, a card on a day, a shared deck (web: api/client.ts) ----------------

@Serializable
data class ProgressSummaryDto(val total_reviews_30d: Int = 0, val total_days_active: Int = 0, val average_accuracy: Double = 0.0, val total_time_ms: Long = 0)

@Serializable
data class ProgressDayDto(val date: String, val reviews_count: Int = 0, val unique_cards: Int = 0, val accuracy: Double = 0.0, val time_spent_ms: Long = 0)

@Serializable
data class DailyProgressDto(
    val student: UserSummaryDto? = null,
    val summary: ProgressSummaryDto = ProgressSummaryDto(),
    val days: List<ProgressDayDto> = emptyList(),
    /** Characters / words known (shared/progress/known.ts, from the server's card state). */
    val known: KnownSummaryDto? = null,
)

@Serializable
data class KnownCountsDto(val known: Int = 0, val learning: Int = 0)

@Serializable
data class KnownSummaryDto(val characters: KnownCountsDto = KnownCountsDto(), val words: KnownCountsDto = KnownCountsDto(), val sentences: KnownCountsDto = KnownCountsDto())

suspend fun Api.studentDailyProgress(relId: String): DailyProgressDto = get("${rel(relId)}/student-progress/daily")

@Serializable
data class DaySummaryDto(val total_reviews: Int = 0, val unique_cards: Int = 0, val accuracy: Double = 0.0, val time_spent_ms: Long = 0)

@Serializable
data class DayCardDto(
    val card_id: String,
    val card_type: String = "hanzi_to_meaning",
    val note: NoteRefDto,
    val review_count: Int = 0,
    val ratings: List<Int> = emptyList(),
    val has_answers: Boolean = false,
    val has_recordings: Boolean = false,
)

@Serializable
data class DayCardsDto(val date: String = "", val summary: DaySummaryDto = DaySummaryDto(), val cards: List<DayCardDto> = emptyList())

suspend fun Api.studentDay(relId: String, date: String): DayCardsDto = get("${rel(relId)}/student-progress/day/${enc(date)}")

@Serializable
data class CardDayNoteDto(val id: String, val hanzi: String = "", val pinyin: String = "", val english: String = "", val audio_url: String? = null)

@Serializable
data class CardDayCardDto(val id: String, val card_type: String = "hanzi_to_meaning", val note: CardDayNoteDto)

@Serializable
data class CardDayReviewDto(val id: String, val reviewed_at: String = "", val rating: Int = 2, val time_spent_ms: Long? = null, val user_answer: String? = null, val recording_url: String? = null)

@Serializable
data class CardDayDto(val card: CardDayCardDto, val reviews: List<CardDayReviewDto> = emptyList())

suspend fun Api.studentCardDay(relId: String, date: String, cardId: String): CardDayDto = get("${rel(relId)}/student-progress/day/${enc(date)}/card/${enc(cardId)}")

@Serializable
data class CompletionDto(val total_cards: Int = 0, val cards_seen: Int = 0, val cards_mastered: Int = 0, val percent_seen: Int = 0, val percent_mastered: Int = 0)

@Serializable
data class TypeStatsDto(val total: Int = 0, val new: Int = 0, val learning: Int = 0, val familiar: Int = 0, val mastered: Int = 0)

@Serializable
data class TypeBreakdownDto(val hanzi_to_meaning: TypeStatsDto = TypeStatsDto(), val meaning_to_hanzi: TypeStatsDto = TypeStatsDto(), val audio_to_hanzi: TypeStatsDto = TypeStatsDto())

@Serializable
data class RecentRatingsDto(val hanzi_to_meaning: List<Int> = emptyList(), val meaning_to_hanzi: List<Int> = emptyList(), val audio_to_hanzi: List<Int> = emptyList())

@Serializable
data class NoteProgressDto(val hanzi: String = "", val pinyin: String = "", val english: String = "", val mastery_percent: Int = 0, val recent_ratings: RecentRatingsDto = RecentRatingsDto())

@Serializable
data class DeckActivityDto(val last_studied_at: String? = null, val total_study_time_ms: Long = 0, val reviews_last_7_days: Int = 0)

@Serializable
data class SharedDeckProgressDto(
    val deck_name: String = "",
    val shared_at: String = "",
    val student: UserSummaryDto? = null,
    val completion: CompletionDto = CompletionDto(),
    val card_type_breakdown: TypeBreakdownDto = TypeBreakdownDto(),
    val notes: List<NoteProgressDto> = emptyList(),
    val activity: DeckActivityDto = DeckActivityDto(),
)

/** [studentShared] = a deck the STUDENT shared with me (`student-shared-decks`). */
suspend fun Api.sharedDeckProgress(relId: String, id: String, studentShared: Boolean): SharedDeckProgressDto =
    get("${rel(relId)}/${if (studentShared) "student-shared-decks" else "shared-decks"}/${enc(id)}/progress")
