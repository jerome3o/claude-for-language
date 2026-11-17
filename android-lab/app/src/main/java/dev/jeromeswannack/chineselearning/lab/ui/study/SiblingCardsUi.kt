package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ResultState
import dev.jeromeswannack.chineselearning.lab.core.SiblingStatus
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.delay

/**
 * The word's other cards — the top row of the card's ⋯ sheet (core SiblingStatus; web
 * components/study/SiblingCards.tsx; docs/STUDY_SESSION.md "The word's other cards in ⋯").
 * [tiles] = every OTHER card of the note; [missing] = card types the word lacks (a disabled tile).
 */
data class SiblingsUi(
    val tiles: List<SiblingStatus.Tile> = emptyList(),
    val missing: List<String> = emptyList(),
)

/** One other card's small sheet while it is open ([cardId]); [done] = the line after ⚡. */
data class SiblingSheetUi(
    val cardId: String,
    val busy: Boolean = false,
    val done: String? = null,
    val error: String? = null,
)

/** The tiles' and the sheet's actions (StudyViewModel: refreshSiblings / openSibling / bumpSibling / …). */
class SiblingActions(
    val refresh: () -> Unit = {},
    val open: (cardId: String) -> Unit = {},
    val bump: () -> Unit = {},
    /** Unsuspend / Wake now. */
    val release: () -> Unit = {},
    /** Snooze… / Suspend… applied: [kind] "snooze" | "suspend". */
    val hold: (cardId: String, kind: String, length: String?, wholeWord: Boolean) -> Unit = { _, _, _, _ -> },
    val forget: (cardId: String, wholeWord: Boolean) -> Unit = { _, _ -> },
    /** "Open card details": the card hub. */
    val details: (cardId: String) -> Unit = {},
    /** Analytics of an action that opens another sheet (snooze / suspend / forget). */
    val track: (cardId: String, action: String) -> Unit = { _, _ -> },
    val close: () -> Unit = {},
)

/** The strength steps' colour: a KNOWN card the result "right" colour, a leech the "close" (needs work) one, else ink. */
@Composable
private fun strengthColor(tone: String): Color = when (tone) {
    SiblingStatus.TONE_KNOWN -> ResultColors.tone(ResultState.RIGHT)
    SiblingStatus.TONE_LEECH -> ResultColors.tone(ResultState.CLOSE)
    else -> Lab.colors.muted
}

@Composable
fun SiblingStrength(strength: Int, tone: String, modifier: Modifier = Modifier) {
    val on = strengthColor(tone).let { if (tone == SiblingStatus.TONE_HELD) it.copy(alpha = 0.5f) else it }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        for (n in 1..3) {
            Box(
                Modifier.width(5.dp).height((3 + 3 * n).dp).clip(RoundedCornerShape(1.dp))
                    .background(if (n <= strength) on else Lab.colors.cardBorder),
            )
        }
    }
}

/** The ⋯ sheet's top row: one tile per other card type (+ a dashed one for a type the word lacks). */
@Composable
fun SiblingTilesRow(ui: SiblingsUi?, onOpen: (SiblingStatus.Tile) -> Unit, modifier: Modifier = Modifier) {
    if (ui == null || (ui.tiles.isEmpty() && ui.missing.isEmpty())) return
    Column(modifier.fillMaxWidth().testTag("sibling-tiles")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in ui.tiles) {
                SiblingTileView(
                    symbol = t.symbol, name = t.name, line = t.line, strength = t.strength, tone = t.tone,
                    description = SiblingStatus.tileLabel(t),
                    modifier = Modifier.weight(1f).testTag("sibling-tile-${t.cardType}"),
                    onClick = { onOpen(t) },
                )
            }
            for (type in ui.missing) {
                val (symbol, name) = SiblingStatus.typeMeta(type)
                SiblingTileView(
                    symbol = symbol, name = name, line = SiblingStatus.missingLine(type), strength = null, tone = SiblingStatus.TONE_NEUTRAL,
                    description = "$name card: ${SiblingStatus.missingLine(type)}",
                    modifier = Modifier.weight(1f).testTag("sibling-tile-$type"),
                    onClick = null,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = Lab.colors.cardBorder)
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun SiblingTileView(
    symbol: String,
    name: String,
    line: String,
    strength: Int?,
    tone: String,
    description: String,
    modifier: Modifier,
    onClick: (() -> Unit)?,
) {
    val shape = RoundedCornerShape(10.dp)
    val border = Lab.colors.cardBorder
    Column(
        modifier
            .heightIn(min = 60.dp)
            .clip(shape)
            .then(
                if (onClick != null) Modifier.border(1.dp, border, shape)
                else Modifier.drawBehind {
                    drawRoundRect(border, cornerRadius = CornerRadius(10.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))))
                },
            )
            .then(if (onClick != null) Modifier.bouncyClickable(onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                if (onClick == null) disabled()
            }
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(symbol, fontSize = 18.sp, color = if (onClick != null) Lab.colors.ink else Lab.colors.muted)
            Text(
                name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (onClick != null) Lab.colors.ink else Lab.colors.muted,
                modifier = Modifier.weight(1f),
            )
            if (strength != null) SiblingStrength(strength, tone)
        }
        Text(line, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.alpha(if (tone == SiblingStatus.TONE_HELD) 0.85f else 1f))
    }
}

/**
 * One other card's sheet: its type + the word, its status and strength, then ⚡ Study it today ·
 * Snooze… / Suspend… (or Unsuspend / Wake now) · Forget this card… · Open card details.
 * [holds] / [forget] / [details] false = not offered here (a homework pass, practice).
 */
@Composable
fun SiblingCardSheet(
    hanzi: String,
    tile: SiblingStatus.Tile,
    ui: SiblingSheetUi,
    actions: SiblingActions,
    canBump: Boolean,
    holds: Boolean,
    forget: Boolean,
    details: Boolean,
    onHoldSheet: (kind: String) -> Unit,
    onForgetSheet: () -> Unit,
    onDismiss: () -> Unit,
) {
    LabBottomSheet(onDismiss = onDismiss) {
        SiblingCardForm(hanzi, tile, ui, actions, canBump, holds, forget, details, onHoldSheet, onForgetSheet, onDismiss)
    }
}

@Composable
fun SiblingCardForm(
    hanzi: String,
    tile: SiblingStatus.Tile,
    ui: SiblingSheetUi,
    actions: SiblingActions,
    canBump: Boolean,
    holds: Boolean,
    forget: Boolean,
    details: Boolean,
    onHoldSheet: (kind: String) -> Unit,
    onForgetSheet: () -> Unit,
    onDismiss: () -> Unit,
    autoClose: Boolean = true,
) {
    LaunchedEffect(ui.done) { if (ui.done != null && autoClose) { delay(1600); onDismiss() } }
    Column(Modifier.fillMaxWidth().testTag("sibling-sheet")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(tile.symbol, fontSize = 28.sp, color = Lab.colors.ink)
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${tile.detail} · $hanzi", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(tile.line, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.testTag("sibling-sheet-status"))
                    SiblingStrength(tile.strength, tile.tone)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        if (ui.done != null) {
            Text(
                "✓ ${ui.done.removePrefix("⚡ ")}",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = Lab.colors.ink,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp)).background(Lab.colors.background)
                    .padding(horizontal = 14.dp, vertical = 14.dp).testTag("sibling-sheet-done"),
            )
            return@Column
        }
        val act = { action: String -> actions.track(tile.cardId, action) }
        if (canBump) {
            NavRow(
                icon = "⚡",
                label = SiblingStatus.bumpLabel(tile.bump).removePrefix("⚡ ") + if (ui.busy) "…" else "",
                enabled = tile.bump != null && !ui.busy,
                modifier = Modifier.testTag("sibling-action-bump"),
                trailing = {
                    when {
                        ui.busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                        tile.bumpNote != null -> Text(tile.bumpNote.orEmpty(), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                        else -> Unit
                    }
                },
                onClick = { actions.bump() },
            )
        }
        if (tile.release != null && holds) {
            NavRow(
                icon = if (tile.release == "unsuspend") "▶" else "⏰",
                label = if (tile.release == "unsuspend") "Unsuspend" else "Wake now",
                modifier = Modifier.testTag("sibling-action-release"),
                onClick = { actions.release() },
            )
        } else if (holds) {
            NavRow(icon = "💤", label = "Snooze…", modifier = Modifier.testTag("sibling-action-snooze"),
                trailing = { Text("Not today", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted) },
                onClick = { act("snooze"); onHoldSheet("snooze") })
            NavRow(icon = "⏸️", label = "Suspend…", modifier = Modifier.testTag("sibling-action-suspend"), onClick = { act("suspend"); onHoldSheet("suspend") })
        }
        if (tile.canForget && forget) {
            NavRow(icon = "↺", label = "Forget this card…", modifier = Modifier.testTag("sibling-action-forget"),
                trailing = { Text("Back to New", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted) },
                onClick = { act("forget"); onForgetSheet() })
        }
        if (details) {
            NavRow(icon = "📇", label = "Open card details", modifier = Modifier.testTag("sibling-action-details"), onClick = { actions.details(tile.cardId) })
        }
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error, modifier = Modifier.padding(horizontal = 16.dp)) }
    }
}
