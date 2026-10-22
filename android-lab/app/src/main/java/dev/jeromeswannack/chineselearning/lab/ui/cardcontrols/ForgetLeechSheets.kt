package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.Leech
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The warning's amber, used for a border + tint only — the ⚠️ and the words carry the meaning. */
private val Amber = Color(0xFFF97316)

/**
 * "Forget this card…" (web components/cardControls/ForgetSheet.tsx; docs/STUDY_SESSION.md "Forget"):
 * the warning FIRST, then This card only / All card types of this word, then ↺ Forget.
 * [onApply] gets wholeWord.
 */
@Composable
fun ForgetSheet(
    hanzi: String,
    cardType: String,
    wordCardTypes: List<String>,
    onApply: (wholeWord: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var wholeWord by remember { mutableStateOf(false) }
    val count = if (wholeWord && wordCardTypes.size > 1) wordCardTypes.size else 1
    LabBottomSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp).testTag("card-forget-sheet"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "↺ " + Leech.forgetTitle(if (count > 1) "note" else "card", count) + " " + hanzi,
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink,
            )
            WarningBox(Leech.forgetWarning(count), Modifier.testTag("forget-warning"))
            if (wordCardTypes.size > 1) {
                ScopeRow(on = !wholeWord, label = "This card only", sub = cardTypeLabel(cardType), tag = "forget-scope-card") { wholeWord = false }
                ScopeRow(
                    on = wholeWord, label = "All card types of this word",
                    sub = "${wordCardTypes.size} cards: " + wordCardTypes.joinToString(" · ") { cardTypeLabel(it) }, tag = "forget-scope-word",
                ) { wholeWord = true }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                PrimaryPill(Leech.forgetButton(count), onClick = { onApply(wholeWord); onDismiss() }, modifier = Modifier.testTag("forget-confirm"))
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}

@Composable
private fun WarningBox(text: String, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier.fillMaxWidth().clip(shape).border(1.dp, Amber, shape).background(Amber.copy(alpha = 0.10f)).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("⚠️", fontSize = 18.sp)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
    }
}

@Composable
private fun ScopeRow(on: Boolean, label: String, sub: String, tag: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(shape)
            .border(if (on) 2.dp else 1.dp, if (on) Lab.colors.ink else Lab.colors.outline, shape)
            .bouncyClickable(onClick = onClick)
            .semantics { role = Role.RadioButton; selected = on }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (on) "◉" else "○", fontSize = 18.sp, color = Lab.colors.ink)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(label, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, color = Lab.colors.ink)
            Text(sub, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        }
    }
}

/** "⚠️ Missed 8×" on the answer side of a leech (web LeechPill): an icon AND words. Nothing below the threshold. */
@Composable
fun LeechPill(lapses: Int?, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val pill = Leech.pill(lapses) ?: return
    val shape = RoundedCornerShape(50)
    Box(
        modifier.heightIn(min = 32.dp).clip(shape).border(1.dp, Amber, shape).background(Amber.copy(alpha = 0.12f))
            .bouncyClickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 6.dp).testTag("leech-pill"),
        contentAlignment = Alignment.Center,
    ) {
        Text("${pill.icon} ${pill.text}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
    }
}

/** What the leech sheet can do; null = not offered here. */
class LeechSheetActions(
    val onEdit: (() -> Unit)? = null,
    val onMemoryHook: (() -> Unit)? = null,
    val onSnooze: (() -> Unit)? = null,
    val onSuspend: (() -> Unit)? = null,
    val onForget: (() -> Unit)? = null,
)

private val DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.UK)
private val DAY_MONTH_YEAR = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK)

private fun dateLabel(iso: String): String = runCatching {
    val d = Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    if (d.year == java.time.LocalDate.now().year) d.format(DAY_MONTH) else d.format(DAY_MONTH_YEAR)
}.getOrDefault(iso.take(10))

/**
 * The leech sheet (web LeechSheet): how often, when, the recent ratings, and what helps — Edit card ·
 * Ask Claude for a memory hook · Snooze · Suspend · Forget. Never acts by itself. [load] replays the
 * card's events + forgets (Leech.info); until it returns the card's cached [lapses] is shown.
 */
@Composable
fun LeechSheet(
    lapses: Int,
    load: suspend () -> Leech.Info?,
    actions: LeechSheetActions,
    onDismiss: () -> Unit,
) {
    var info by remember { mutableStateOf<Leech.Info?>(null) }
    LaunchedEffect(Unit) { info = runCatching { load() }.getOrNull() }
    val missed = info?.lapses ?: lapses
    val last = info?.lapseDates?.lastOrNull()
    LabBottomSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp).testTag("leech-sheet"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("⚠️ " + Leech.headline(missed), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            Text(Leech.EXPLANATION, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("${missed}×", "missed after learning it", Modifier.weight(1f))
                Stat(last?.let(::dateLabel) ?: "—", "last missed", Modifier.weight(1f))
            }
            info?.recent?.takeIf { it.isNotEmpty() }?.let { recent ->
                Text("Recent ratings", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Column(Modifier.testTag("leech-recent")) {
                    for (r in recent) {
                        Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                            Text(
                                Leech.ratingTag(r.rating) + if (r.lapse) " — missed" else "",
                                fontWeight = if (r.lapse) FontWeight.Bold else FontWeight.Normal, color = Lab.colors.ink, modifier = Modifier.weight(1f),
                            )
                            Text(dateLabel(r.reviewedAt), color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            Text("What helps", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            val buttons = listOfNotNull(
                actions.onEdit?.let { Triple("✏️ Edit card", "leech-edit", it) },
                actions.onMemoryHook?.let { Triple("💡 Ask Claude for a memory hook", "leech-hook", it) },
                actions.onSnooze?.let { Triple("💤 Snooze…", "leech-snooze", it) },
                actions.onSuspend?.let { Triple("⏸️ Suspend…", "leech-suspend", it) },
                actions.onForget?.let { Triple("↺ Forget this card…", "leech-forget", it) },
            )
            for ((label, tag, act) in buttons) {
                val shape = RoundedCornerShape(12.dp)
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(shape).border(1.dp, Lab.colors.outline, shape).background(Lab.colors.card)
                        .bouncyClickable { onDismiss(); act() }.padding(horizontal = 16.dp, vertical = 12.dp).testTag(tag),
                    contentAlignment = Alignment.CenterStart,
                ) { Text(label, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink) }
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier.clip(shape).border(1.dp, Lab.colors.outline, shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Lab.colors.ink)
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    }
}
