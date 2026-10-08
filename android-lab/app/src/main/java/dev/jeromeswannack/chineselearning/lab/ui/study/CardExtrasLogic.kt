package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import java.io.IOException
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * The pure rules behind the study card's extras, ported from frontend/src/pages/StudyPage.tsx
 * and the services it calls. No Android here, so they are unit-tested directly.
 */

/** The web's CLAUDE_AI_USER_ID (frontend/src/types.ts). */
const val CLAUDE_AI_USER_ID = "claude-ai"

/** DEFAULT_TTS_SPEED / DEFAULT_MINIMAX_VOICE / MINIMAX_VOICES in frontend/src/types.ts. */
private const val DEFAULT_TTS_SPEED = 0.6
private const val DEFAULT_MINIMAX_VOICE = "Chinese (Mandarin)_Radio_Host"

data class MiniMaxVoice(val id: String, val name: String)

val MINIMAX_VOICES = listOf(
    MiniMaxVoice("Chinese (Mandarin)_Gentleman", "Gentleman (Male, Formal)"),
    MiniMaxVoice("Chinese (Mandarin)_Male_Announcer", "Male Announcer"),
    MiniMaxVoice("Chinese (Mandarin)_Southern_Young_Man", "Southern Young Man"),
    MiniMaxVoice("Chinese (Mandarin)_Gentle_Youth", "Gentle Youth (Male)"),
    MiniMaxVoice("Chinese (Mandarin)_Straightforward_Boy", "Straightforward Boy"),
    MiniMaxVoice("Chinese (Mandarin)_Pure-hearted_Boy", "Pure-hearted Boy"),
    MiniMaxVoice("Chinese (Mandarin)_Unrestrained_Young_Man", "Unrestrained Young Man"),
    MiniMaxVoice("Chinese (Mandarin)_Sincere_Adult", "Sincere Adult (Male)"),
    MiniMaxVoice("Chinese (Mandarin)_Humorous_Elder", "Humorous Elder (Male)"),
    MiniMaxVoice("Chinese (Mandarin)_Kind-hearted_Elder", "Kind-hearted Elder (Male)"),
    MiniMaxVoice("Chinese (Mandarin)_Gentle_Senior", "Gentle Senior (Male)"),
    MiniMaxVoice("Chinese (Mandarin)_Sweet_Lady", "Sweet Lady"),
    MiniMaxVoice("Chinese (Mandarin)_Wise_Women", "Wise Woman"),
    MiniMaxVoice("Chinese (Mandarin)_Warm_Bestie", "Warm Bestie (Female)"),
    MiniMaxVoice("Chinese (Mandarin)_Warm_Girl", "Warm Girl"),
    MiniMaxVoice("Chinese (Mandarin)_Crisp_Girl", "Crisp Girl"),
    MiniMaxVoice("Chinese (Mandarin)_Soft_Girl", "Soft Girl"),
    MiniMaxVoice("Chinese (Mandarin)_IntellectualGirl", "Intellectual Girl"),
    MiniMaxVoice("Chinese (Mandarin)_Cute_Spirit", "Cute Spirit (Female)"),
    MiniMaxVoice("Chinese (Mandarin)_Lyrical_Voice", "Lyrical Voice (Female)"),
    MiniMaxVoice("Chinese (Mandarin)_Kind-hearted_Antie", "Kind-hearted Auntie"),
    MiniMaxVoice("Chinese (Mandarin)_News_Anchor", "News Anchor"),
    MiniMaxVoice("Chinese (Mandarin)_Radio_Host", "Radio Host"),
)

/** The web's NEEDS_INTERNET hint on disabled AI items. */
const val NEEDS_INTERNET = "Needs internet"

/** A tutor the learner can flag a card for (services/cardFlags.ts RememberedTutor). */
data class FlagTutor(val relationshipId: String, val name: String)

/** A tutor's note shown once on the card back (db LocalRecordingNote). */
data class TutorNote(
    val id: String,
    /** "recording" (a mark on my recording) or "flag" (a reply to my flag). */
    val kind: String,
    val cardId: String?,
    val noteId: String,
    val hanzi: String,
    val comment: String,
    val tutorName: String?,
    val updatedAt: String,
)

object CardExtrasLogic {
    /** `formatAddedDate`: "Added 1 Sep 2026" from the note's created_at (SQL UTC or ISO). */
    fun formatAddedDate(createdAt: String?, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String? {
        if (createdAt.isNullOrBlank()) return null
        val iso = createdAt.trim().replace(' ', 'T').let { if (it.endsWith("Z") || Regex("[+-]\\d\\d:\\d\\d$").containsMatchIn(it)) it else it + "Z" }
        val instant = runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { java.time.OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: return null
        return "Added " + DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM).withLocale(locale).format(instant.atZone(zone))
    }

    /** `writableCharacters` (shared/strokes/quiz.ts): the Han characters of [text]. */
    fun writableCharacters(text: String): List<String> =
        text.codePoints().toArray().filter { Character.UnicodeScript.of(it) == Character.UnicodeScript.HAN }.map { String(Character.toChars(it)) }

    /** `canWriteHanzi`: a word short enough to write by hand (sentence cards are skipped). */
    fun canWriteHanzi(hanzi: String): Boolean = writableCharacters(hanzi).size in 1..6

    /** `handleCharacterClick`: only look up actual Chinese characters, not punctuation or whitespace. */
    fun isLookupCharacter(ch: String): Boolean = ch.codePoints().anyMatch { it in 0x4E00..0x9FFF || it in 0x3400..0x4DBF }

    /** The tutor in one of my "tutors" relationships: the side that isn't me. */
    private fun tutorOf(rel: RelationshipDto): UserSummaryDto? =
        if (rel.requester_role == "tutor") rel.requester else rel.recipient

    /** `humanTutors`: my active tutors, Claude excluded — who a card can be flagged for. */
    fun humanTutors(rel: MyRelationshipsDto?): List<FlagTutor> =
        rel?.tutors.orEmpty()
            .filter { it.status == "active" }
            .mapNotNull { r -> tutorOf(r)?.let { r to it } }
            .filter { (_, other) -> other.id != CLAUDE_AI_USER_ID }
            .map { (r, other) -> FlagTutor(r.id, other.name?.takeIf { it.isNotBlank() } ?: other.email?.takeIf { it.isNotBlank() } ?: "your tutor") }

    /** The relationship with the Claude tutor, for "Roleplay this word". */
    fun claudeRelationshipId(rel: MyRelationshipsDto?): String? =
        rel?.tutors.orEmpty().firstOrNull { it.requester?.id == CLAUDE_AI_USER_ID || it.recipient?.id == CLAUDE_AI_USER_ID || it.requester_id == CLAUDE_AI_USER_ID || it.recipient_id == CLAUDE_AI_USER_ID }?.id

    /**
     * `getUnseenRecordingNotesForCard`: notes on this card, plus flag replies on the same note
     * whose card id is unknown; unseen only, newest first.
     */
    fun unseenNotesForCard(all: List<TutorNote>, seen: Set<String>, cardId: String, noteId: String): List<TutorNote> {
        val byCard = all.filter { it.cardId == cardId }
        val ids = byCard.mapTo(HashSet()) { it.id }
        val byNote = all.filter { it.noteId == noteId && it.kind == "flag" && it.id !in ids }
        return (byCard + byNote).filter { it.id !in seen }.sortedByDescending { it.updatedAt }
    }

    /** `TutorNoteLine` prefix. */
    fun tutorNoteFrom(note: TutorNote): String =
        if (note.kind == "flag") "${note.tutorName?.takeIf { it.isNotBlank() } ?: "Your tutor"} replied to your flag:"
        else "From ${note.tutorName?.takeIf { it.isNotBlank() } ?: "your tutor"}:"

    /** `describeAskError`: Ask Claude failures as a sentence (never an alert). */
    fun describeAskError(error: Throwable, aiAvailable: Boolean): String {
        if (!aiAvailable) return "Ask Claude needs an internet connection — you're offline right now."
        if (error is IOException && error !is dev.jeromeswannack.chineselearning.lab.data.HttpException) return "Couldn't reach Claude — check your connection and try again."
        val msg = (error as? dev.jeromeswannack.chineselearning.lab.data.HttpException)?.serverMessage() ?: error.message
        return if (!msg.isNullOrBlank()) "Claude couldn't answer: $msg" else "Claude couldn't answer that. Try again in a moment."
    }

    /** The random MiniMax voice for "New voice" and its speaker name ("Sweet Lady", suffix dropped). */
    fun randomVoice(random: kotlin.random.Random = kotlin.random.Random.Default): Pair<MiniMaxVoice, String> {
        val v = MINIMAX_VOICES[random.nextInt(MINIMAX_VOICES.size)]
        return v to v.name.replace(Regex("\\s*\\(.*\\)$"), "")
    }

    val defaultTtsSpeed get() = DEFAULT_TTS_SPEED
    val defaultVoice get() = DEFAULT_MINIMAX_VOICE

    /** Alternatives as the edit sheet shows them: one per line (JSON array on the note). */
    fun alternativesText(json: String?): String =
        json?.let { runCatching { kotlinx.serialization.json.Json.decodeFromString(ListSerializer(String.serializer()), it) }.getOrNull() }?.joinToString("\n").orEmpty()

    /** And back: non-blank trimmed lines as a JSON array, or null when there are none. */
    fun alternativesJson(text: String): String? {
        val list = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        return if (list.isEmpty()) null else kotlinx.serialization.json.Json.encodeToString(ListSerializer(String.serializer()), list)
    }
}
