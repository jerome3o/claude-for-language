package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.cards.NoteImage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.noteimages.DeckIllustrateDto
import dev.jeromeswannack.chineselearning.lab.data.noteimages.NoteImages
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the sheet shows (stateless body, screenshot-tested). */
data class IllustrateUi(
    val status: DeckIllustrateDto? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val online: Boolean = true,
)

const val ILLUSTRATE_INTRO =
    "A friendly picture of each card’s meaning — never any writing. It shows with the English when you write the Chinese, and on the answer side of the other cards. You can also put your own photo on any card (Edit card → Picture)."

/**
 * "🖼 Illustrate this deck" — the web's IllustrateDeckSheet: the cost first, then one picture per
 * card without one, drawn in the background (closing never stops them), and the deck's
 * "Illustrate new cards" switch (off by default: each picture costs money).
 */
@Composable
fun IllustrateDeckContent(ui: IllustrateUi, onStart: () -> Unit, onToggleNew: (Boolean) -> Unit, onClose: () -> Unit) {
    val s = ui.status
    val drawing = (s?.pending ?: 0) > 0
    SheetScaffold(
        header = {
            SheetTitle("🖼 Illustrate this deck")
            s?.deck_name?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 6.dp)) }
        },
        footerAbove = if (!ui.online) { { InlineNotice("You're offline — pictures need a connection.", kind = NoticeKind.Offline) } } else null,
        footer = {
            if (s != null && s.available && s.estimate.pictures > 0) {
                PrimaryPill(
                    if (ui.busy) "Starting…" else "🖼 Draw ${s.estimate.pictures} picture${if (s.estimate.pictures == 1) "" else "s"}",
                    Modifier.weight(1f).height(52.dp).testTag(ILLUSTRATE_START_TAG),
                    enabled = ui.online && !ui.busy,
                ) { onStart() }
            } else {
                SecondaryPill(if (drawing) "Close — they keep coming" else "Done", Modifier.weight(1f).height(52.dp)) { onClose() }
            }
        },
    ) {
        if (s == null) {
            if (ui.error != null) InlineNotice(ui.error, kind = NoticeKind.Error) else LoadingState()
            return@SheetScaffold
        }
        Text(ILLUSTRATE_INTRO, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
        Text(
            NoteImage.progressLabel(s.total, s.with_image, s.pending, s.failed),
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, fontWeight = FontWeight.Medium,
            modifier = Modifier.testTag(ILLUSTRATE_PROGRESS_TAG),
        )
        LinearProgressIndicator(
            progress = { if (s.total > 0) s.with_image.toFloat() / s.total else 0f },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(8.dp)),
            color = Lab.colors.accent,
            trackColor = Lab.colors.faint,
        )
        if (drawing) Text("Drawing… you can close this — they keep coming in the background.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        if (s.available) {
            Text(
                NoteImage.estimate(s.missing.toDouble()).label,
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, fontWeight = FontWeight.Medium,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint.copy(alpha = 0.5f)).padding(horizontal = 12.dp, vertical = 8.dp).testTag(ILLUSTRATE_ESTIMATE_TAG),
            )
        } else {
            Text("Pictures can’t be generated right now — you can still add your own photo to a card.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        }
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(enabled = s.available && ui.online) { onToggleNew(!s.illustrate_new) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = s.illustrate_new, onCheckedChange = { onToggleNew(it) }, enabled = s.available && ui.online, colors = CheckboxDefaults.colors(checkedColor = Lab.colors.accent))
            Column(Modifier.weight(1f)) {
                Text("Illustrate new cards automatically", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                Text("Each new card in this deck gets a picture (about the same price each).", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

/** The sheet with its state: loads the status, polls every 3 s while pictures are drawn. */
@Composable
fun IllustrateDeckSheet(app: LabApp, deckId: String, onProgress: () -> Unit, onClose: () -> Unit) {
    val images = remember { NoteImages(app.repo.api, app.repo.dao, app.filesDir) }
    val online by app.online.collectAsState()
    val scope = rememberCoroutineScope()
    var ui by remember { mutableStateOf(IllustrateUi()) }

    suspend fun load() {
        try {
            val before = ui.status?.with_image
            val s = images.deckStatus(deckId)
            ui = ui.copy(status = s, error = null)
            if (before != null && s.with_image > before) onProgress()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ui = ui.copy(error = e.userMessage())
        }
    }

    LaunchedEffect(deckId) { load() }
    LaunchedEffect(ui.status?.pending) {
        while ((ui.status?.pending ?: 0) > 0) {
            delay(3_000)
            load()
        }
    }
    LabSheetFrame(onDismiss = onClose) {
        IllustrateDeckContent(
            ui.copy(online = online),
            onStart = {
                ui = ui.copy(busy = true, error = null)
                scope.launch {
                    try {
                        val res = images.illustrateDeck(deckId)
                        app.analytics.track("deck.illustrate", mapOf("pictures" to res.pending + res.ready))
                        ui = ui.copy(status = res.status, busy = false)
                        if (res.ready > 0) onProgress()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        ui = ui.copy(busy = false, error = e.userMessage())
                    }
                }
            },
            onToggleNew = { on ->
                val prev = ui.status ?: return@IllustrateDeckContent
                ui = ui.copy(status = prev.copy(illustrate_new = on))
                scope.launch {
                    try {
                        images.setIllustrateNew(deckId, on)
                        app.analytics.track("deck.illustrate_new", mapOf("on" to on))
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        ui = ui.copy(status = prev, error = e.userMessage())
                    }
                }
            },
            onClose = onClose,
        )
    }
}

const val ILLUSTRATE_START_TAG = "illustrate-start"
const val ILLUSTRATE_PROGRESS_TAG = "illustrate-progress"
const val ILLUSTRATE_ESTIMATE_TAG = "illustrate-estimate"
