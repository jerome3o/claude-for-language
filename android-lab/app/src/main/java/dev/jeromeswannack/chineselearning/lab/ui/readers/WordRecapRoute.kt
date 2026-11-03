package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.readers.WordRecapStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The word recap pass of one run, wired to the store (data/readers/WordRecapStore.kt) — the web's
 * components/readerRecap/WordRecapPass.tsx. Used by `/readers/:id/recap` ([runId] = the reader id)
 * and `/coach/chat/:id/recap` ([runId] = [WordRecap.chatRunId]). [onRun] = the page's start event,
 * once the run is there.
 */
@Composable
fun WordRecapRoute(nav: LabNav, runId: String, source: String, sourceLabel: String, onRun: (words: Int) -> Unit = {}) {
    val app = nav.app
    val run by remember(runId) { WordRecapStore.observe(app.cache, runId) }.collectAsState(initial = null)
    val wordsKey = run?.words?.joinToString("|") { it.hanzi }
    val owned by produceState(emptySet<String>(), wordsKey) { value = run?.let { WordRecapStore.owned(app, it).keys } ?: emptySet() }
    val online by app.online.collectAsState()
    var doneLine by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val runtime = remember(app) { LessonRuntime.of(app) }
    var tracked by remember { mutableStateOf(false) }
    LaunchedEffect(run != null) {
        val r = run
        if (r != null && !tracked) {
            tracked = true
            onRun(r.words.size)
        }
    }
    ReaderRecapScreen(
        RecapUi(title = "Word recap", run = run, sourceLabel = sourceLabel, source = source, owned = owned, online = online, doneLine = doneLine),
        RecapActions(
            answer = { key, right ->
                if (right) app.haptics.correct() else app.haptics.wrong()
                scope.launch { WordRecapStore.answer(app.cache, runId, key, right) }
            },
            keep = { key, on -> app.haptics.tick(); scope.launch { WordRecapStore.keep(app.cache, runId, key, on) } },
            restart = { scope.launch { WordRecapStore.restart(app.cache, runId) } },
            done = {
                scope.launch {
                    val o = WordRecapStore.finishRecap(app, runId)
                    app.haptics.celebrate()
                    doneLine = WordRecap.doneLine(o.added, o.bumped)
                    delay(1200)
                    nav.back()
                }
            },
            close = nav::back,
            speak = { text -> runtime.audio.speak(text) },
        ),
    )
}
