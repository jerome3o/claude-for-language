package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.importReader
import dev.jeromeswannack.chineselearning.lab.data.api.problems
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * The readers list's ⋯ → "Import JSON" (web: ReadersListPage `handleImport`): pick a reader
 * exported from the editor, create it with `POST /api/readers/import` and open its editor.
 * For the readers list (package B): `val importReader = rememberReaderImporter(nav) { msg -> … }`.
 */
@Composable
fun rememberReaderImporter(nav: LabNav, onMessage: (String) -> Unit): () -> Unit {
    val scope = rememberCoroutineScope()
    return rememberJsonPicker(
        onText = { text ->
            val parsed = runCatching { Json.parseToJsonElement(text) }.getOrNull()
            if (parsed == null) {
                onMessage("That file is not valid JSON.")
            } else scope.launch {
                try {
                    val reader = nav.app.repo.api.importReader(parsed)
                    nav.app.haptics.correct()
                    nav.open(Routes.readerEdit(reader.id))
                } catch (e: Exception) {
                    val problems = (e as? HttpException)?.problems().orEmpty()
                    onMessage(if (problems.isNotEmpty()) "Could not import:\n${problems.joinToString("\n")}" else "Could not import: ${e.userMessage()}")
                }
            }
        },
        onError = onMessage,
    )
}
