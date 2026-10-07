package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.data.api.resetNewCardOrder
import dev.jeromeswannack.chineselearning.lab.data.api.saveNewCardOrder
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** Test tag of the section (web: data-testid="new-card-order"). */
const val NEW_CARD_ORDER_TAG = "new-card-order"

/** The blue of new (primary) cards — the switches' and step numbers' colour, as on the web. */
private val NewBlue = Color(0xFF2563EB)
private val NewBlueSoft = Color(0xFFDBEAFE)

/**
 * Settings → New cards → "Order new cards by" (the web's NewCardOrderSection; core NewCardOrder):
 * which brand-new words the daily budget introduces first. Four switches applied in order as
 * tiers, then the deck order. Stateless for screenshots; [NewCardOrderSettingsCard] wires it up.
 */
@Composable
fun NewCardOrderSection(
    order: NewCardOrder,
    busy: Boolean,
    note: String?,
    onToggle: (key: String, on: Boolean) -> Unit,
    onReset: () -> Unit,
) {
    SettingsSection(
        "Order new cards by",
        "Which new words come first each day. Your daily budget decides how many; these decide which.",
        Modifier.testTag(NEW_CARD_ORDER_TAG),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Lab.colors.background),
        ) {
            var step = 0
            NewCardOrder.OPTIONS.forEachIndexed { i, opt ->
                val on = order[opt.key]
                if (on) step++
                if (i > 0) HorizontalDivider(color = Lab.colors.cardBorder)
                OrderRow(if (on) "$step" else "–", opt.label, opt.hint, on, !busy, Modifier.testTag("nco-${opt.key}")) { onToggle(opt.key, it) }
            }
            HorizontalDivider(color = Lab.colors.cardBorder)
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                StepBadge("↓", on = false, muted = true)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text("Then your deck order", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted)
                    Text("The rest come deck by deck, top of your deck list first.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
        }
        Text(
            "⚡ Bumped words, your decks' daily limits and homework from your tutor work as before.",
            style = MaterialTheme.typography.bodySmall,
            color = Lab.colors.muted,
        )
        if (!order.isDefault) SecondaryPill("Reset to default", enabled = !busy, onClick = onReset)
        StatusLine(note, error = note != null && note.startsWith("Couldn't"))
    }
}

@Composable
private fun OrderRow(step: String, label: String, hint: String, on: Boolean, enabled: Boolean, modifier: Modifier, onChange: (Boolean) -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(enabled = enabled, role = Role.Switch) { onChange(!on) }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepBadge(step, on)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = if (on) Lab.colors.ink else Lab.colors.muted)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        Switch(
            checked = on,
            onCheckedChange = onChange,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = NewBlue),
        )
    }
}

@Composable
private fun StepBadge(text: String, on: Boolean, muted: Boolean = false) {
    val bg by animateColorAsState(if (on) NewBlueSoft else if (muted) Color.Transparent else Lab.colors.faint, label = "step-bg")
    val scale by animateFloatAsState(if (on) 1f else 0.9f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "step-scale")
    Box(Modifier.size(28.dp).scale(scale).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (on) Color(0xFF1D4ED8) else Lab.colors.muted)
    }
}

/**
 * The section with its state: the phone's copy (prefs, offline — every StudyQueue.build reads
 * it), each switch saved at once through PUT /api/profile/new-card-order. Offline: the switch
 * flips back and says it needs a connection (the server keeps one order per account).
 */
@Composable
fun NewCardOrderSettingsCard(app: LabApp) {
    var order by remember { mutableStateOf(app.prefs.newCardOrder) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val online by app.online.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    fun track(saved: NewCardOrder, field: String?) = app.analytics.track(
        "settings.new_card_order",
        buildMap {
            if (field != null) put("field", field)
            put("reset", field == null)
            put("new_characters_first", saved.newCharactersFirst)
            put("new_words_first", saved.newWordsFirst)
            put("most_common_first", saved.mostCommonFirst)
            put("sentences_last", saved.sentencesLast)
        },
    )
    fun save(next: NewCardOrder, field: String?, call: suspend () -> NewCardOrder) {
        val before = order
        if (!online) { note = "Couldn't save: you're offline — try again with a connection."; return }
        order = next
        busy = true
        note = null
        app.haptics.tick()
        scope.launch {
            runCatching { call() }
                .onSuccess { saved ->
                    app.prefs.newCardOrder = saved
                    order = saved
                    note = "Saved ✓"
                    track(saved, field)
                }
                .onFailure { order = before; note = "Couldn't save: ${it.userMessage()}" }
            busy = false
        }
    }
    NewCardOrderSection(
        order, busy, note,
        onToggle = { key, on -> save(order.with(key, on), key) { app.repo.api.saveNewCardOrder(key, on) } },
        onReset = { save(NewCardOrder.DEFAULT, null) { app.repo.api.resetNewCardOrder() } },
    )
}
