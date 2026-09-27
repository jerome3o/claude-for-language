package dev.jeromeswannack.chineselearning.lab.ui.editor

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonValidator
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.data.api.EditorChatMessageDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/** Realistic editor data for screenshots (real hanzi, the bundled sample lessons). */
object EditorSamples {
    private fun exercises(id: String): List<JsonObject> = LessonCatalogue.sample(id)!!.spec.objs("sections").flatMap { it.objs("exercises") }

    /** A 把 lesson: a note, a word-order exercise, a choice, a half-written translate (with problems). */
    val lesson: JsonObject = JsJson.obj(
        "title" to JsJson.s("把 sentences in the kitchen"),
        "icon" to JsJson.s("🍳"),
        "description" to JsJson.s("Moving the object before the verb with 把."),
        "sections" to JsonArray(listOf(
            JsJson.obj(
                "title" to JsJson.s("Warm-up"),
                "exercises" to JsonArray(exercises("note") + exercises("scramble")),
            ),
            JsJson.obj(
                "title" to JsJson.s("Practice"),
                "exercises" to JsonArray(exercises("choice") + JsJson.obj("type" to JsJson.s("translate"), "english" to JsJson.s("Please put the bowl on the table."), "reference_hanzi" to JsJson.s(""))),
            ),
        )),
    )

    val lessonErrors = LessonValidator.validate(lesson)

    val conversation: JsonObject = LessonCatalogue.sample("conversation")!!.spec

    fun ui(spec: JsonObject = lesson, dirty: Boolean = true, view: EditorView = EditorView.EDIT, notice: String? = null) = LessonEditorUi(
        loading = false,
        spec = spec,
        savedCanonical = if (dirty) "" else JsJson.canonical(spec)!!,
        errors = LessonValidator.validate(spec),
        view = view,
        notice = notice,
    )

    private val proposalDiff = Json.parseToJsonElement(
        """{"changed":true,"meta":[],"sections":[],"exercises":[
            {"kind":"added","section":1,"index":2,"exercise":{"type":"listen_choice","audio":{"hanzi":"他把碗放在桌子上了。"},"options":[{"hanzi":"把"},{"hanzi":"吧"}],"correct":0}},
            {"kind":"changed","section":1,"index":1,"before":{"type":"translate","english":"Please put the bowl on the table."},"after":{"type":"translate","english":"Please put the bowl on the table.","reference_hanzi":"请把碗放在桌子上。"},
             "fields":[{"field":"reference_hanzi","before":"","after":"请把碗放在桌子上。"},{"field":"reference_pinyin","after":"qǐng bǎ wǎn fàng zài zhuōzi shang"}]}
        ]}""",
    ).jsonObject

    val chat = EditorChatUi(
        loading = false,
        messages = listOf(
            EditorChatMessageDto("u1", "user", "Fill in the translate answer and add a listening exercise contrasting 把 and 吧."),
            EditorChatMessageDto(
                "a1", "assistant",
                "I filled in the reference answer for the translate exercise and added a listen-and-pick contrasting 把 (bǎ) with 吧 (ba).",
                proposal_status = "pending",
                proposed_spec = lesson.with("title", "把 sentences in the kitchen"),
                proposal_diff = proposalDiff,
            ),
        ),
    )

    val reader: JsonObject = Json.parseToJsonElement(
        """{"title_chinese":"长春的冬天","title_english":"Winter in Changchun","difficulty_level":"beginner","topic":"winter","vocabulary_used":[{"hanzi":"冬天","pinyin":"dōngtiān","english":"winter"}],
            "pages":[
              {"id":"p1","content_chinese":"长春的冬天很冷。","content_pinyin":"Chángchūn de dōngtiān hěn lěng.","content_english":"Winter in Changchun is very cold.","image_prompt":"A snowy street in Changchun, warm storybook style","image_url":null},
              {"id":"p2","content_chinese":"小明穿上红色的大衣，走在雪里。","content_pinyin":"","content_english":"","image_prompt":null},
              {"id":"p3","content_chinese":"“好冷啊！”他说。","content_pinyin":"“Hǎo lěng a!” tā shuō.","content_english":"“So cold!” he said.","image_prompt":"A boy in a red coat laughing in the snow"}
            ]}""",
    ).jsonObject

    fun readerUi(spec: JsonObject = reader, view: EditorView = EditorView.EDIT) = ReaderEditorUi(
        loading = false,
        spec = spec,
        savedSpec = reader,
        errors = dev.jeromeswannack.chineselearning.lab.core.spec.ReaderValidator.validate(spec),
        view = view,
    )

    val readerChat = EditorChatUi(
        loading = false,
        messages = listOf(
            EditorChatMessageDto("u1", "user", "Simplify page 2"),
            EditorChatMessageDto(
                "a1", "assistant", "Page 2 is now two short sentences.", proposal_status = "accepted", proposed_spec = reader,
                proposal_diff = Json.parseToJsonElement(
                    """{"changed":true,"meta":[],"pages":[{"kind":"changed","index":1,"fromIndex":1,"after":{"content_chinese":"小明穿上红大衣。他走在雪里。"},
                        "fields":[{"field":"content_chinese","before":"小明穿上红色的大衣，走在雪里。","after":"小明穿上红大衣。他走在雪里。"}]}]}""",
                ).jsonObject,
            ),
        ),
    )
}
