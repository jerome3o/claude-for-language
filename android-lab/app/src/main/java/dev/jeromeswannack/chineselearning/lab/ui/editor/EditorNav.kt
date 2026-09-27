package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonExport
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderExport
import dev.jeromeswannack.chineselearning.lab.data.api.createBlankReader
import dev.jeromeswannack.chineselearning.lab.data.api.editableLesson
import dev.jeromeswannack.chineselearning.lab.data.api.libraryItem
import dev.jeromeswannack.chineselearning.lab.data.api.readerSpec
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.serialization.json.JsonObject

/**
 * Package G's editor routes (web paths): the lesson editor for library items and lessons, the
 * reader editor, "Try it" for a library lesson, the catalogue's sample-lesson trials and the
 * print views. Registered with one line in ui/nav/FeatureGraphs.kt.
 */
fun NavGraphBuilder.editorGraph(nav: LabNav) {
    composable(Routes.route("/library/{id}/edit")) { entry ->
        LessonEditorRoute(nav, "library", entry.arguments?.getString("id").orEmpty())
    }
    composable(Routes.route("/lessons/{id}/edit")) { entry ->
        LessonEditorRoute(nav, "lesson", entry.arguments?.getString("id").orEmpty())
    }
    composable(Routes.route("/readers/{id}/edit")) { entry ->
        ReaderEditorRoute(nav, entry.arguments?.getString("id").orEmpty())
    }
    composable(Routes.route("/library/{id}/try")) { entry ->
        LessonTryRoute(nav, entry.arguments?.getString("id").orEmpty())
    }
    composable(Routes.route("/library/catalogue/{sampleId}")) { entry ->
        CatalogueTrialRoute(nav, entry.arguments?.getString("sampleId").orEmpty())
    }
    composable(Routes.route("/library/{id}/print")) { entry -> PrintRoute(nav, "library", entry.arguments?.getString("id").orEmpty()) }
    composable(Routes.route("/lessons/{id}/print")) { entry -> PrintRoute(nav, "lesson", entry.arguments?.getString("id").orEmpty()) }
    composable(Routes.route("/readers/{id}/print")) { entry -> PrintRoute(nav, "reader", entry.arguments?.getString("id").orEmpty()) }
}

@Composable
private fun rememberSpeaker(app: LabApp): Speak {
    val scope = rememberCoroutineScope()
    val speaker = remember { LessonSpeaker(app, scope) }
    DisposableEffect(Unit) { onDispose { speaker.stop() } }
    return speaker::speak
}

@Composable
private fun LessonEditorRoute(nav: LabNav, target: String, id: String) {
    val app = nav.app
    val vm: LessonEditorViewModel = viewModel(key = "lesson-editor-$target-$id", factory = LessonEditorViewModel.Factory(EditorDeps.from(app), target, id))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val chat by vm.chat.ui.collectAsStateWithLifecycle()
    val speak = rememberSpeaker(app)
    val exporter = rememberExporter(onSaved = { vm.notify(it) }, onError = { vm.notify(it, error = true) })
    LaunchedEffect(Unit) { dev.jeromeswannack.chineselearning.lab.core.Pinyin.preload() }
    val backTo = if (target == "library") Routes.libraryItem(id) else Routes.lessons()
    val spec = ui.spec
    LessonEditorScreen(
        ui = ui,
        chat = chat,
        target = target,
        subtitle = vm.subtitle,
        actions = LessonEditorActions(
            onSpec = vm::setSpec,
            onSave = vm::save,
            onBack = { if (!nav.controller.popBackStack()) nav.open(backTo) },
            onView = vm::setView,
            onDiscardDraft = vm::discardDraft,
            onRetry = vm::load,
            onDuplicate = if (target == "library") ({ vm.duplicate { copy -> nav.open(Routes.libraryEdit(copy)) } }) else null,
            onExport = { format, share -> spec?.let { val f = lessonExport(it, format); if (share) exporter.share(f) else exporter.saveAs(f) } },
            onPrint = { spec?.let { exporter.print(it.text("title").ifEmpty { "Lesson" }, LessonExport.toMarkdown(it)) } },
            onAnki = { nav.openInMainApp(if (target == "library") Routes.libraryItem(id) else Routes.lessonEdit(id)) },
            onRawJson = vm::applyRawJson,
            onArchive = if (ui.isOwner) ({ vm.archiveOrDelete { nav.open(if (target == "library") Routes.LIBRARY else Routes.lessons()) } }) else null,
            speak = speak,
            previewEnv = rememberExerciseEnv(app, preview = true),
            chat = EditorChatActions(
                onDraft = vm.chat::setDraft,
                onSend = { text -> spec?.let { vm.chat.send(text, it, pendingChangesFor(chat.messages, it, EditorChatKind.LESSON)) } },
                onDecide = vm.chat::decide,
                onRetry = vm.chat::reload,
            ),
            haptic = { app.haptics.tick() },
        ),
    )
}

@Composable
private fun LessonTryRoute(nav: LabNav, id: String) {
    val app = nav.app
    val env = rememberExerciseEnv(app, preview = true)
    val loaded by produceState<Pair<JsonObject?, String?>>(null to null, id) {
        val cached = app.cache.get("editor/lesson/library/$id", CachedLessonTarget.serializer())?.spec
        value = cached to null
        value = try { app.repo.api.libraryItem(id).spec to null } catch (e: Exception) { if (cached != null) cached to null else null to e.userMessage() }
    }
    val back = { if (!nav.controller.popBackStack()) nav.open(Routes.libraryItem(id)) }
    LessonTrialScreen(loaded.first?.text("title") ?: "Try it", loaded.first, loaded.second, env, back, back)
}

@Composable
private fun CatalogueTrialRoute(nav: LabNav, sampleId: String) {
    val app = nav.app
    val env = rememberExerciseEnv(app, preview = true)
    val sample = remember(sampleId) { LessonCatalogue.sample(sampleId) }
    val back = { if (!nav.controller.popBackStack()) nav.open(Routes.catalogue()) }
    LessonTrialScreen(
        sample?.spec?.text("title") ?: "Sample lesson",
        sample?.spec,
        if (sample == null) "That sample lesson doesn't exist." else null,
        env, back, back,
    )
}

/**
 * The print views (`/library/:id/print`, `/lessons/:id/print`, `/readers/:id/print`): the
 * printable page on screen, with Print / Save as PDF and Share.
 */
@Composable
private fun PrintRoute(nav: LabNav, target: String, id: String) {
    val app = nav.app
    val exporter = rememberExporter()
    val doc by produceState<Triple<String, String, String?>?>(null, target, id) {
        value = try {
            when (target) {
                "reader" -> app.repo.api.readerSpec(id).spec.let { Triple(it.text("title_chinese"), ReaderExport.toMarkdown(it), null) }
                "library" -> app.repo.api.libraryItem(id).spec.let { Triple(it.text("title"), LessonExport.toMarkdown(it), null) }
                else -> app.repo.api.editableLesson(id).spec.let { Triple(it.text("title"), LessonExport.toMarkdown(it), null) }
            }
        } catch (e: Exception) {
            Triple("", "", e.userMessage())
        }
    }
    LabScreenFrame {
        ScreenTitle(doc?.first?.ifEmpty { null } ?: "Print view", onBack = { nav.back() })
        val d = doc
        when {
            d == null -> LoadingState()
            d.third != null -> ErrorState(d.third!!)
            else -> Column(Modifier.fillMaxSize()) {
                androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryPill("🖨 Print / PDF", Modifier.weight(1f).height(52.dp)) { exporter.print(d.first, d.second) }
                    SecondaryPill("Share", Modifier.weight(1f).height(52.dp)) {
                        exporter.share(ExportFile("${d.first}.md", "text/markdown", d.second))
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    AndroidView(factory = { ctx -> android.webkit.WebView(ctx) }, update = { it.loadDataWithBaseURL(null, PrintHtml.page(d.first, d.second), "text/html", "utf-8", null) }, modifier = Modifier.fillMaxSize())
                }
            }
        }
    }
}

/** `/readers/:id/edit` (owner only); `/readers/new/edit` makes a blank reader first (web: NewReaderPage). */
@Composable
private fun ReaderEditorRoute(nav: LabNav, id: String) {
    val app = nav.app
    if (id == "new") {
        val created by produceState<Pair<String?, String?>>(null to null) {
            value = try { app.repo.api.createBlankReader().id to null } catch (e: Exception) { null to "Couldn't create a new reader — ${e.userMessage()}" }
        }
        LaunchedEffect(created.first) {
            created.first?.let { newId ->
                nav.controller.popBackStack()
                nav.open(Routes.readerEdit(newId))
            }
        }
        LabScreenFrame {
            ScreenTitle("New reader", onBack = { nav.back() })
            if (created.second != null) ErrorState(created.second!!) else LoadingState(text = "Creating your reader…")
        }
        return
    }
    val vm: ReaderEditorViewModel = viewModel(key = "reader-editor-$id", factory = ReaderEditorViewModel.Factory(EditorDeps.from(app), id))
    val ui by vm.ui.collectAsStateWithLifecycle()
    val chat by vm.chat.ui.collectAsStateWithLifecycle()
    val speak = rememberSpeaker(app)
    val exporter = rememberExporter(onSaved = { vm.notify(it) }, onError = { vm.notify(it, error = true) })
    LaunchedEffect(Unit) { dev.jeromeswannack.chineselearning.lab.core.Pinyin.preload() }
    val spec = ui.spec
    ReaderEditorScreen(
        ui = ui,
        chat = chat,
        actions = ReaderEditorActions(
            onSpec = vm::setSpec,
            onSave = vm::save,
            onBack = { if (!nav.controller.popBackStack()) nav.open(Routes.readers()) },
            onView = vm::setView,
            onDiscardDraft = vm::discardDraft,
            onRetry = vm::load,
            onRead = { nav.open(Routes.reader(id)) },
            onExport = { format, share -> spec?.let { val f = readerExport(it, format); if (share) exporter.share(f) else exporter.saveAs(f) } },
            onPrint = { spec?.let { exporter.print(it.text("title_chinese").ifEmpty { "Reader" }, ReaderExport.toMarkdown(it)) } },
            onAnki = { nav.openInMainApp(Routes.readerEdit(id)) },
            onRawJson = vm::applyRawJson,
            onDelete = { vm.delete { nav.open(Routes.readers()) } },
            onAssist = vm::assist,
            onIllustrate = vm::illustrate,
            speak = speak,
            chat = EditorChatActions(
                onDraft = vm.chat::setDraft,
                onSend = { text -> spec?.let { vm.chat.send(text, it, pendingChangesFor(chat.messages, it, EditorChatKind.READER)) } },
                onDecide = vm.chat::decide,
                onRetry = vm.chat::reload,
            ),
            haptic = { app.haptics.tick() },
        ),
    )
}
