package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonValidator
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject
import org.junit.Test
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.robolectric.annotation.Config

/** The lesson and reader editors (package G). `./gradlew :app:recordRoborazziDebug --tests '*EditorScreenshots*'`. */
class EditorScreenshots : LabScreenshotTest() {
    private val lesson = EditorSamples.lesson

    @Test fun lessonEdit() = shoot("editor-01-lesson-edit") {
        LessonEditorScreen(EditorSamples.ui(), EditorChatUi(loading = false), "library", "Library master copy", LessonEditorActions())
    }

    @Test fun lessonPreview() = shoot("editor-02-lesson-preview") {
        LessonEditorScreen(EditorSamples.ui(view = EditorView.PREVIEW, dirty = false), EditorChatUi(loading = false), "library", "Library master copy", LessonEditorActions())
    }

    @Test fun lessonChat() = shoot("editor-03-lesson-chat") {
        LessonEditorScreen(EditorSamples.ui(view = EditorView.CHAT), EditorSamples.chat, "library", "Library master copy", LessonEditorActions())
    }

    @Test fun lessonSaved() = shoot("editor-04-lesson-saved") {
        val fixed = lesson.withObjs("sections", lesson.objs("sections").mapIndexed { si, s ->
            if (si != 1) s else s.withObjs("exercises", s.objs("exercises").map { ex -> if (ex.text("type") == "translate") ex.with("reference_hanzi", "请把碗放在桌子上。") else ex })
        })
        LessonEditorScreen(EditorSamples.ui(fixed, dirty = false, notice = "Saved"), EditorChatUi(loading = false), "lesson", "Your lesson", LessonEditorActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun lessonUnfolded() = shoot("editor-05-lesson-unfolded") {
        LessonEditorScreen(EditorSamples.ui(), EditorSamples.chat, "library", "Library master copy", LessonEditorActions())
    }

    @Test fun lessonDark() = shoot("editor-06-lesson-dark", dark = true) {
        LessonEditorScreen(EditorSamples.ui(), EditorChatUi(loading = false), "library", "Library master copy", LessonEditorActions())
    }

    @Test fun readerEdit() = shoot("editor-07-reader-edit") {
        ReaderEditorScreen(EditorSamples.readerUi(EditorSamples.reader.with("title_english", "Winter in Changchun!")), EditorChatUi(loading = false), ReaderEditorActions())
    }

    @Test fun readerPreview() = shoot("editor-08-reader-preview") {
        ReaderEditorScreen(EditorSamples.readerUi(view = EditorView.PREVIEW), EditorChatUi(loading = false), ReaderEditorActions())
    }

    @Test fun readerChat() = shoot("editor-09-reader-chat") {
        ReaderEditorScreen(EditorSamples.readerUi(view = EditorView.CHAT), EditorSamples.readerChat, ReaderEditorActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun readerUnfolded() = shoot("editor-10-reader-unfolded") {
        ReaderEditorScreen(EditorSamples.readerUi(), EditorSamples.readerChat, ReaderEditorActions())
    }

    @Test fun trial() = shoot("editor-11-catalogue-trial") {
        LessonTrialScreen("Checking in at a hotel", EditorSamples.conversation, null, {}, {}, {})
    }

    @Test fun loadError() = shoot("editor-12-load-error") {
        LessonEditorScreen(LessonEditorUi(loading = false, loadError = "No connection — try again when you're online."), EditorChatUi(), "library", "", LessonEditorActions())
    }

    /** Every exercise type's form, filled from its catalogue sample (one tall shot per type). */
    @Config(qualifiers = "w412dp-h2400dp-xxhdpi")
    @Test fun allForms() {
        var current by androidx.compose.runtime.mutableStateOf<JsonObject?>(null)
        compose.setContent {
            dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme(dark = false) {
                val ex = current
                if (ex != null) LabScreenFrame {
                    val spec = dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.obj(
                        "title" to dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.s("x"),
                        "sections" to kotlinx.serialization.json.JsonArray(listOf(dev.jeromeswannack.chineselearning.lab.core.spec.JsJson.obj("exercises" to kotlinx.serialization.json.JsonArray(listOf(ex))))),
                    )
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        androidx.compose.material3.Text("${LessonCatalogue.icon(ex.text("type"))} ${LessonCatalogue.name(ex.text("type"))}", color = Lab.colors.ink)
                        ExerciseForm(ex, {}, {}, errorsFor(LessonValidator.validate(spec), 0, 0))
                    }
                }
            }
        }
        for (info in LessonCatalogue.types) {
            current = LessonCatalogue.samples.first { it.type == info.type }.spec.objs("sections").flatMap { it.objs("exercises") }.first { it.text("type") == info.type }
            compose.mainClock.advanceTimeBy(1_000)
            compose.onRoot().captureRoboImage("screenshots/editor-form-${info.type}.png")
        }
    }
}
