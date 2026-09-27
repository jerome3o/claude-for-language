package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.StudentProfileFields
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable

// The tutor's private profile of a student (worker routes/student-profile.ts; web:
// frontend/src/api/studentProfile.ts). Tutor only — the student never reads it.

@Serializable
data class StudentProfileDto(
    val relationship_id: String = "",
    val body: String = "",
    val level: String? = null,
    val handwriting: Boolean? = null,
    val words_per_lesson: Int? = null,
    val updated_at: String = "",
) {
    fun fields() = StudentProfileFields(body, level, handwriting, words_per_lesson)
}

@Serializable
data class StudentProfileEnvelope(val profile: StudentProfileDto? = null)

/** PUT replaces the whole profile, so every field is sent — nulls included. */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class StudentProfileBody(
    @EncodeDefault val body: String = "",
    @EncodeDefault val level: String? = null,
    @EncodeDefault val handwriting: Boolean? = null,
    @EncodeDefault val words_per_lesson: Int? = null,
) {
    companion object {
        fun of(f: StudentProfileFields) = StudentProfileBody(f.body, f.level, f.handwriting, f.wordsPerLesson)
    }
}

suspend fun Api.studentProfile(relId: String): StudentProfileEnvelope = get("/api/relationships/${enc(relId)}/student-profile")

/** An empty profile is deleted: the answer's `profile` is then null. */
suspend fun Api.saveStudentProfile(relId: String, fields: StudentProfileFields): StudentProfileEnvelope =
    put("/api/relationships/${enc(relId)}/student-profile", StudentProfileBody.of(fields))
