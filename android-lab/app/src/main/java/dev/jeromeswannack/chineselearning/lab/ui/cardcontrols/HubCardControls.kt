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

/** One card type of the word with its hold today (null = in study) and its lapses (a leech at 8+). */
data class HubHoldRow(val cardId: String, val cardType: String, val hold: CardHold?, val lapses: Int = 0)

/**
 * The card hub's controls (web components/cardControls/HubCardControls.tsx): each card type with its
 * hold — ⏸️ Suspended / 💤 Snoozed · 29 Oct and Unsuspend / Wake now — or 💤 Snooze… / ⏸️ Suspend…
 * (the study card's sheet), ↺ Forget… (back to New, Undo on the line after) and, on a leech, the
 * "⚠️ Missed 8×" pill → the leech sheet. From Room, offline.
 */
@Composable
fun HubCardControls(app: LabApp, noteId: String, hanzi: String) {
    val scope = rememberCoroutineScope()
    val version by app.repo.dataVersion.collectAsState()
    var rows by remember { mutableStateOf<List<HubHoldRow>>(emptyList()) }
    var sheet by remember { mutableStateOf<Pair<String, HubHoldRow>?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    var forgotten by remember { mutableStateOf<dev.jeromeswannack.chineselearning.lab.data.forgets.ForgetStore.Outcome?>(null) }
    var leech by remember { mutableStateOf<HubHoldRow?>(null) }
    LaunchedEffect(version, noteId) {
        rows = withContext(Dispatchers.IO) {
            val held = HoldStore.activeByCard(app.repo.dao)
            app.repo.dao.cardsOfNotes(listOf(noteId))
                .sortedBy { listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi").indexOf(it.cardType).let { i -> if (i < 0) 9 else i } }
                .map { HubHoldRow(it.id, it.cardType, held[it.id], it.lapses) }
        }
    }
    LaunchedEffect(toast) { if (toast != null) { kotlinx.coroutines.delay(if (forgotten != null) 6000 else 3500); toast = null; forgotten = null } }
    HubCardControlsView(
        rows, HoldStore.localToday(), toast,
        onRelease = { r -> scope.launch { toast = HoldStore.release(app, listOf(r.cardId), "card_hub") } },
        onHold = { kind, r -> sheet = kind to r },
        onLeech = { r ->
            leech = r
            app.analytics.track("card.leech_open", mapOf("lapses" to r.lapses, "card_type" to r.cardType))
        },
        canUndo = forgotten != null,
        onUndo = {
            val f = forgotten ?: return@HubCardControlsView
            forgotten = null
            scope.launch { toast = dev.jeromeswannack.chineselearning.lab.data.forgets.ForgetStore.undo(app, f.ids, "card_hub") }
        },
    )
    leech?.let { r ->
        LeechSheet(
            lapses = r.lapses,
            load = { withContext(Dispatchers.IO) { dev.jeromeswannack.chineselearning.lab.core.Leech.info(app.repo.replayEvents(r.cardId)) } },
            actions = LeechSheetActions(
                onSnooze = if (r.hold == null) ({ sheet = CardHolds.SNOOZE to r }) else null,
                onSuspend = if (r.hold == null) ({ sheet = CardHolds.SUSPEND to r }) else null,
                onForget = { sheet = "forget" to r },
            ),
            onDismiss = { leech = null },
        )
    }
    sheet?.takeIf { it.first == "forget" }?.let { (_, r) ->
        ForgetSheet(
            hanzi = hanzi, cardType = r.cardType, wordCardTypes = rows.map { it.cardType },
            onApply = { wholeWord ->
                val ids = if (wholeWord) rows.map { it.cardId } else listOf(r.cardId)
                scope.launch {
                    val outcome = dev.jeromeswannack.chineselearning.lab.data.forgets.ForgetStore.forget(app, ids, if (ids.size > 1) "note" else "card", "card_hub")
                    forgotten = outcome
                    toast = outcome.message
                }
            },
            onDismiss = { sheet = null },
        )
    }
    sheet?.takeIf { it.first != "forget" }?.let { (kind, r) ->
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
fun HubCardControlsView(
    rows: List<HubHoldRow>,
    today: String,
    toast: String?,
    onRelease: (HubHoldRow) -> Unit,
    onHold: (kind: String, HubHoldRow) -> Unit,
    onLeech: (HubHoldRow) -> Unit = {},
    canUndo: Boolean = false,
    onUndo: () -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().testTag("hub-card-controls"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (r in rows) {
            // One card type per block: its name + hold on one line, the actions under it (412dp wide).
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val hold = r.hold
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(cardTypeLabel(r.cardType), color = Lab.colors.ink, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
                    if (hold != null) {
                        val (icon, text) = CardHolds.tag(hold.kind, hold.until, today)
                        HoldTag(icon, text)
                    }
                }
                if (dev.jeromeswannack.chineselearning.lab.core.Leech.isLeech(r.lapses)) LeechPill(r.lapses, onOpen = { onLeech(r) })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (hold != null) {
                        SecondaryPill(if (hold.kind == CardHolds.SNOOZE) "Wake now" else "Unsuspend", onClick = { onRelease(r) }, modifier = Modifier.testTag("hub-release"))
                    } else {
                        SecondaryPill("💤 Snooze…", onClick = { onHold(CardHolds.SNOOZE, r) }, modifier = Modifier.testTag("hub-snooze"))
                        SecondaryPill("⏸️ Suspend…", onClick = { onHold(CardHolds.SUSPEND, r) }, modifier = Modifier.testTag("hub-suspend"))
                    }
                }
                SecondaryPill("↺ Forget…", onClick = { onHold("forget", r) }, modifier = Modifier.testTag("hub-forget"))
            }
        }
        if (toast != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(toast, color = Lab.colors.muted, modifier = Modifier.weight(1f, fill = false))
                if (canUndo) SecondaryPill("Undo", onClick = onUndo, modifier = Modifier.testTag("hub-forget-undo"))
            }
        }
    }
}
