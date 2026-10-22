package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardHold
import dev.jeromeswannack.chineselearning.lab.core.CardHolds
import dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One card type of the word with its hold today (null = in study). */
data class HubHoldRow(val cardId: String, val cardType: String, val hold: CardHold?)

/**
 * The card hub's controls (web components/cardControls/HubCardControls.tsx): each card type with its
 * hold — ⏸ Suspended / 💤 Snoozed · 29 Oct and Unsuspend / Wake now — or 💤 Snooze… / ⏸ Suspend…
 * (the study card's sheet). From Room, offline.
 */
@Composable
fun HubCardControls(app: LabApp, noteId: String, hanzi: String) {
    val scope = rememberCoroutineScope()
    val version by app.repo.dataVersion.collectAsState()
    var rows by remember { mutableStateOf<List<HubHoldRow>>(emptyList()) }
    var sheet by remember { mutableStateOf<Pair<String, HubHoldRow>?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(version, noteId) {
        rows = withContext(Dispatchers.IO) {
            val held = HoldStore.activeByCard(app.repo.dao)
            app.repo.dao.cardsOfNotes(listOf(noteId))
                .sortedBy { listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi").indexOf(it.cardType).let { i -> if (i < 0) 9 else i } }
                .map { HubHoldRow(it.id, it.cardType, held[it.id]) }
        }
    }
    LaunchedEffect(toast) { if (toast != null) { kotlinx.coroutines.delay(3500); toast = null } }
    HubCardControlsView(
        rows, HoldStore.localToday(), toast,
        onRelease = { r -> scope.launch { toast = HoldStore.release(app, listOf(r.cardId), "card_hub") } },
        onHold = { kind, r -> sheet = kind to r },
    )
    sheet?.let { (kind, r) ->
        CardControlSheet(
            kind = kind, hanzi = hanzi, cardType = r.cardType, wordCardTypes = rows.map { it.cardType }, today = HoldStore.localToday(),
            onApply = { length, wholeWord ->
                val ids = if (wholeWord) rows.map { it.cardId } else listOf(r.cardId)
                scope.launch { toast = HoldStore.hold(app, ids, kind, length, if (ids.size > 1) "word" else "card", "card_hub") }
            },
            onDismiss = { sheet = null },
        )
    }
}

/** Stateless (screenshots). */
@Composable
fun HubCardControlsView(rows: List<HubHoldRow>, today: String, toast: String?, onRelease: (HubHoldRow) -> Unit, onHold: (kind: String, HubHoldRow) -> Unit) {
    Column(Modifier.fillMaxWidth().testTag("hub-card-controls"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (r in rows) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(cardTypeLabel(r.cardType), color = Lab.colors.ink, modifier = Modifier.width(132.dp))
                val hold = r.hold
                if (hold != null) {
                    val (icon, text) = CardHolds.tag(hold.kind, hold.until, today)
                    HoldTag(icon, text, Modifier.weight(1f, fill = false))
                    SecondaryPill(if (hold.kind == CardHolds.SNOOZE) "Wake now" else "Unsuspend", onClick = { onRelease(r) }, modifier = Modifier.testTag("hub-release"))
                } else {
                    SecondaryPill("💤 Snooze…", onClick = { onHold(CardHolds.SNOOZE, r) }, modifier = Modifier.testTag("hub-snooze"))
                    SecondaryPill("⏸ Suspend…", onClick = { onHold(CardHolds.SUSPEND, r) }, modifier = Modifier.testTag("hub-suspend"))
                }
            }
        }
        if (toast != null) Text(toast, color = Lab.colors.muted)
    }
}
