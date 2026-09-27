package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// The lesson / reader editors and their Claude co-editor chat (worker/src/routes/lesson-editor.ts,
// reader-editor.ts; web: frontend/src/api/lessonEditor.ts, readerEditor.ts).

/** GET|PUT /api/lessons/:id — a lesson the caller owns or assigned. */
@Serializable
data class EditableLessonDto(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val icon: String? = null,
    val library_item_id: String? = null,
    val assigned_by: String? = null,
    val spec: JsonObject,
    val is_owner: Boolean = true,
)

/** GET|PUT /api/readers/:id/spec. */
@Serializable
data class EditableReaderDto(
    val id: String,
    val status: String = "ready",
    val is_published: Int = 1,
    val created_at: String = "",
    val spec: JsonObject,
    val image_jobs: Int? = null,
)

@Serializable
data class CreatedReaderDto(val id: String)

@Serializable
data class EditorChatMessageDto(
    val id: String,
    val role: String,
    val content: String = "",
    val created_at: String = "",
    /** 'pending' | 'accepted' | 'rejected' | null */
    val proposal_status: String? = null,
    val proposed_spec: JsonObject? = null,
    /** The server's diff of the proposal against the spec sent with the message (LessonDiff / ReaderDiff shape). */
    val proposal_diff: JsonObject? = null,
    val author_changes: List<String> = emptyList(),
)

@Serializable
data class EditorChatInfoDto(val id: String = "", val target_type: String = "", val target_id: String = "")

@Serializable
data class EditorChatStateDto(
    val chat: EditorChatInfoDto = EditorChatInfoDto(),
    val ai_available: Boolean = true,
    val messages: List<EditorChatMessageDto> = emptyList(),
)

@Serializable
data class SendEditorMessageResultDto(val user_message: EditorChatMessageDto, val message: EditorChatMessageDto)

@Serializable private data class LessonSpecBody(val spec: JsonElement)
@Serializable private data class ChatBody(val message: String, val current_spec: JsonObject)
@Serializable private data class AssistBody(val field: String, val chinese: String, val english: String? = null)
@Serializable private data class AssistResult(val text: String)
@Serializable private data class BlankReaderBody(val title_chinese: String, val title_english: String, val difficulty_level: String)
@Serializable data class PageImageDto(val image_url: String? = null)
@Serializable private data class TtsBody(val text: String, val speed: Double? = null)
@Serializable data class TtsDto(val audio_base64: String, val content_type: String = "audio/mpeg")

suspend fun Api.editableLesson(id: String): EditableLessonDto = get("/api/lessons/${enc(id)}")

suspend fun Api.saveEditableLesson(id: String, spec: JsonObject): EditableLessonDto = put("/api/lessons/${enc(id)}", LessonSpecBody(spec))

suspend fun Api.deleteCustomLesson(id: String) { delete<JsonElement>("/api/custom-lessons/${enc(id)}") }

/** targetType: "lesson" | "library" | "reader". */
suspend fun Api.editorChat(targetType: String, targetId: String): EditorChatStateDto = get("/api/editor-chat/${enc(targetType)}/${enc(targetId)}")

suspend fun Api.sendEditorMessage(targetType: String, targetId: String, message: String, currentSpec: JsonObject): SendEditorMessageResultDto =
    post("/api/editor-chat/${enc(targetType)}/${enc(targetId)}/messages", ChatBody(message, currentSpec))

/** status: "accept" | "reject". */
suspend fun Api.setProposalStatus(targetType: String, targetId: String, messageId: String, status: String) {
    post<JsonElement>("/api/editor-chat/${enc(targetType)}/${enc(targetId)}/messages/${enc(messageId)}/$status")
}

suspend fun Api.readerSpec(id: String): EditableReaderDto = get("/api/readers/${enc(id)}/spec")

suspend fun Api.saveReaderSpec(id: String, spec: JsonObject): EditableReaderDto = put("/api/readers/${enc(id)}/spec", LessonSpecBody(spec))

suspend fun Api.importReader(spec: JsonElement): EditableReaderDto = post("/api/readers/import", LessonSpecBody(spec))

/** "Create New" on the readers list: a blank reader to edit (NewReaderPage). */
suspend fun Api.createBlankReader(): CreatedReaderDto = post("/api/readers", BlankReaderBody("新故事", "New story", "beginner"))

suspend fun Api.deleteReader(id: String) { delete<JsonElement>("/api/readers/${enc(id)}") }

/** Translate a page ("english") or draft its illustration prompt ("image_prompt"), for unsaved text too. */
suspend fun Api.readerAssist(id: String, field: String, chinese: String, english: String?): String =
    post<AssistBody, AssistResult>("/api/readers/${enc(id)}/assist", AssistBody(field, chinese, english)).text

suspend fun Api.generateReaderPageImage(readerId: String, pageId: String): PageImageDto =
    post("/api/readers/${enc(readerId)}/pages/${enc(pageId)}/generate-image")

/** MiniMax TTS for any text at the lesson speed (web: getTTSWithCache, DEFAULT_TTS_SPEED 0.6). */
suspend fun Api.practiceTts(text: String, speed: Double = 0.6): TtsDto = post("/api/practice/tts", TtsBody(text, speed))
