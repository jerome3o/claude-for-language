package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.SiblingStatus
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.SiblingStrength
import dev.jeromeswannack.chineselearning.lab.ui.study.SiblingsUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * Where he's at with each card of the word — under "📚 You have this" in the explorer (docs/LANGUAGE_EXPLORER.md
 * "Card variants"; web components/explorer/CardVariants.tsx). Jerome, Nov 2026: "three little buttons … that show
 * me where I'm at with each variation of the card, like the answer card ⋯ menu."
 *
 * The SAME tiles as the study card's ⋯ sheet (core SiblingStatus, ui/study/SiblingCardsUi.kt): 读 Read · 写 Write ·
 * 听 Listen with the status line + strength from this phone's replayed state (offline), a dashed one for a type the
 * word lacks. Every card of the note shows (no card on screen); "in today" = the ⚡ pocket's cards of the note. A tap
 * opens the card's panel in place: ⚡ Study it today (the ⋯ sheet's card-level bump) · Unsuspend / Wake now.
 */

const val EXPLORER_VARIANTS_TAG = "explorer-variants"
const val EXPLORER_VARIANT_PANEL_TAG = "explorer-variant-panel"
const val EXPLORER_VARIANT_BUMP_TAG = "explorer-variant-bump"
const val EXPLORER_VARIANT_RELEASE_TAG = "explorer-variant-release"
const val EXPLORER_VARIANT_DONE_TAG = "explorer-variant-done"
fun explorerVariantTag(cardType: String) = "explorer-variant-$cardType"

/** The block's state: the tiles (null = still reading), the open card, the last ⚡ line. */
data class CardVariantsUi(
    val siblings: SiblingsUi? = null,
    val openId: String? = null,
    val busy: Boolean = false,
    val done: String? = null,
    val error: String? = null,
)

/** Stateless (screenshot tests): the row of tiles + the open card's panel. */
@Composable
fun CardVariantsBlock(
    ui: CardVariantsUi,
    hanzi: String,
    onTile: (SiblingStatus.Tile) -> Unit,
    onBump: (SiblingStatus.Tile) -> Unit,
    onRelease: (SiblingStatus.Tile) -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = ui.siblings ?: return
    if (s.tiles.isEmpty() && s.missing.isEmpty()) return
    Column(modifier.fillMaxWidth().testTag(EXPLORER_VARIANTS_TAG)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (t in s.tiles) {
                VariantTile(
                    symbol = t.symbol, name = t.name, line = t.line, strength = t.strength, tone = t.tone,
                    description = SiblingStatus.tileLabel(t), open = t.cardId == ui.openId,
                    modifier = Modifier.weight(1f).testTag(explorerVariantTag(t.cardType)).semantics { stateDescription = t.status },
                    onClick = { onTile(t) },
                )
            }
            for (type in s.missing) {
                val (symbol, name) = SiblingStatus.typeMeta(type)
                VariantTile(
                    symbol = symbol, name = name, line = SiblingStatus.missingLine(type), strength = null, tone = SiblingStatus.TONE_NEUTRAL,
                    description = "$name card: ${SiblingStatus.missingLine(type)}", open = false,
                    modifier = Modifier.weight(1f).testTag(explorerVariantTag(type)), onClick = null,
                )
            }
        }
        val open = s.tiles.firstOrNull { it.cardId == ui.openId }
        if (open != null) {
            Spacer(Modifier.height(8.dp))
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(10.dp)).padding(10.dp).testTag(EXPLORER_VARIANT_PANEL_TAG),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("${open.symbol} ${open.detail} · $hanzi", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryPill(
                        if (ui.busy && open.bump != null) "Adding…" else SiblingStatus.bumpLabel(open.bump),
                        Modifier.weight(1.4f).height(48.dp).testTag(EXPLORER_VARIANT_BUMP_TAG),
                        enabled = open.bump != null && !ui.busy,
                        onClick = { onBump(open) },
                    )
                    if (open.release != null) SecondaryPill(
                        if (open.release == "unsuspend") "▶ Unsuspend" else "⏰ Wake now",
                        Modifier.weight(1f).height(48.dp).testTag(EXPLORER_VARIANT_RELEASE_TAG),
                        enabled = !ui.busy,
                        onClick = { onRelease(open) },
                    )
                }
                if (open.bump == null && open.bumpNote != null) Text(open.bumpNote.orEmpty(), style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
                ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
            }
        }
        ui.done?.let {
            Spacer(Modifier.height(8.dp))
            InlineNotice(it, kind = NoticeKind.Success, modifier = Modifier.fillMaxWidth().testTag(EXPLORER_VARIANT_DONE_TAG))
        }
    }
}

@Composable
private fun VariantTile(
    symbol: String,
    name: String,
    line: String,
    strength: Int?,
    tone: String,
    description: String,
    open: Boolean,
    modifier: Modifier,
    onClick: (() -> Unit)?,
) {
    val shape = RoundedCornerShape(10.dp)
    val border = if (open) Lab.colors.ink else Lab.colors.cardBorder
    Column(
        modifier
            .heightIn(min = 52.dp)
            .clip(shape)
            .background(Lab.colors.card)
            .then(
                if (onClick != null) Modifier.border(if (open) 2.dp else 1.dp, border, shape)
                else Modifier.drawBehind {
                    drawRoundRect(border, cornerRadius = CornerRadius(10.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))))
                },
            )
            .then(if (onClick != null) Modifier.bouncyClickable(onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                if (onClick == null) disabled()
            }
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(symbol, fontSize = 16.sp, color = if (onClick != null) Lab.colors.ink else Lab.colors.muted)
            Text(
                name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold,
                color = if (onClick != null) Lab.colors.ink else Lab.colors.muted, maxLines = 1, modifier = Modifier.weight(1f),
            )
            if (strength != null) SiblingStrength(strength, tone)
        }
        Text(
            line, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.alpha(if (tone == SiblingStatus.TONE_HELD) 0.85f else 1f),
        )
    }
}

/**
 * The block wired to the phone: tiles from [ExplorerEnv.wordCards] (read again after each action), ⚡ through
 * [ExplorerEnv.bumpCardType] (a card-level bump, source explorer), Unsuspend / Wake through [ExplorerEnv.releaseCard].
 * Nothing when the env has no card reader (previews).
 */
@Composable
fun CardVariantsHost(noteId: String, hanzi: String, kind: String, env: ExplorerEnv, controller: ExplorerController) {
    var ui by remember(noteId) { mutableStateOf(CardVariantsUi()) }
    var reload by remember(noteId) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(noteId, reload) {
        val s = runCatching { env.wordCards(noteId) }.getOrNull()
        ui = ui.copy(siblings = s)
    }
    CardVariantsBlock(
        ui, hanzi,
        onTile = { t ->
            if (ui.openId == t.cardId) {
                ui = ui.copy(openId = null, error = null)
            } else {
                env.tick()
                controller.record("explorer.card_variant_open", mapOf("kind" to kind, "card_type" to t.cardType, "status" to t.status))
                ui = ui.copy(openId = t.cardId, error = null)
            }
        },
        onBump = { t ->
            val bump = env.bumpCardType ?: return@CardVariantsBlock
            if (ui.busy || t.bump == null) return@CardVariantsBlock
            ui = ui.copy(busy = true, error = null)
            scope.launch {
                try {
                    bump(noteId, t.cardType)
                    controller.record("explorer.card_variant_action", mapOf("kind" to kind, "card_type" to t.cardType, "action" to "bump"))
                    ui = ui.copy(busy = false, openId = null, done = SiblingStatus.bumpedMessage(t.detail, false))
                    reload++
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    ui = ui.copy(busy = false, error = e.message ?: "Could not add the card")
                }
            }
        },
        onRelease = { t ->
            val release = env.releaseCard ?: return@CardVariantsBlock
            val action = t.release ?: return@CardVariantsBlock
            if (ui.busy) return@CardVariantsBlock
            ui = ui.copy(busy = true)
            scope.launch {
                try {
                    controller.record("explorer.card_variant_action", mapOf("kind" to kind, "card_type" to t.cardType, "action" to action))
                    release(t.cardId)
                } finally {
                    ui = ui.copy(busy = false, openId = null)
                    reload++
                }
            }
        },
    )
}
