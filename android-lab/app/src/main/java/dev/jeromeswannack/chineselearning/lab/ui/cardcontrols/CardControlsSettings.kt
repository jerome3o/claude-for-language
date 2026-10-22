package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardHolds
import dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Settings → Study (web components/cardControls/CardControlsSettings.tsx): "Don't show a word's other
 * card types on the same day" (Anki's sibling burying, off by default, per account — core CardHolds)
 * and the way into "Suspended & snoozed cards".
 */
@Composable
fun CardControlsSettingsCard(app: LabApp, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(app.prefs.burySiblings) }
    val version by app.repo.dataVersion.collectAsState()
    var counts by remember { mutableStateOf(0 to 0) }
    LaunchedEffect(version) {
        on = app.prefs.burySiblings
        val active = withContext(Dispatchers.IO) { HoldStore.activeByCard(app.repo.dao) }.values
        counts = active.count { it.kind == CardHolds.SUSPEND } to active.count { it.kind == CardHolds.SNOOZE }
    }
    CardControlsSettingsView(on, counts.first, counts.second, onToggle = { next -> on = next; scope.launch { HoldStore.setBurySiblings(app, next) } }, onOpen = { open(Routes.HELD_CARDS) })
}

/** Stateless (screenshots). */
@Composable
fun CardControlsSettingsView(on: Boolean, suspended: Int, snoozed: Int, onToggle: (Boolean) -> Unit, onOpen: () -> Unit) {
    LabCard {
        ToggleRow(
            "🃏", "Don't show a word's other card types on the same day", on,
            desc = if (on) "Once you review one card of a word, its other new and review cards wait until tomorrow. Cards you're still learning, and words you bumped to today (⚡), still come."
            else "Off — a word can come up as several card types on the same day.",
            onChange = onToggle,
        )
        RowDivider()
        NavRow(
            "⏸️", "Suspended & snoozed cards",
            desc = if (suspended + snoozed == 0) "None" else listOfNotNull(if (suspended > 0) "$suspended suspended" else null, if (snoozed > 0) "$snoozed snoozed" else null).joinToString(" · "),
            onClick = onOpen,
        )
    }
}
