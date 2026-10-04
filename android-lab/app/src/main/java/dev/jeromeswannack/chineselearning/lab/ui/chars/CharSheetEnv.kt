package dev.jeromeswannack.chineselearning.lab.ui.chars

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The running app's [CharSheetActions]: the device dictionary, Room statuses, analytics, haptics. */
@Composable
fun rememberCharSheetActions(app: LabApp, onOpenCard: ((String) -> Unit)? = null): CharSheetActions = remember(app) {
    val dict = CharDict.of(app)
    CharSheetActions(
        lookup = dict::lookup,
        statuses = { words, cardHanzi -> CharDict.statuses(app.repo.dao, words, cardHanzi) },
        explain = dict::explain,
        deckNames = { ids ->
            withContext(Dispatchers.IO) {
                val decks = app.repo.dao.decks().associate { it.id to it.name }
                app.repo.dao.notes(ids).mapNotNull { decks[it.deckId] }.distinct()
            }
        },
        track = { event, props -> app.analytics.track(event, props) },
        onOpenCard = onOpenCard,
        tick = { app.haptics.tick() },
    )
}
