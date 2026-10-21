package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Test tags of the study card's deck pill and its popup. */
const val DECK_PILL_TAG = "study-deck-pill"
const val DECK_PILL_LABEL_TAG = "study-deck-pill-label"
const val DECK_PILL_FULL_TAG = "study-deck-pill-full"
const val DECK_PILL_OPEN_TAG = "study-deck-pill-open"
const val DECK_PILL_NAME_TAG = "study-deck-pill-name"

/** The visible pill's widest (a quiet line under the meaning, centred on the answer side). */
val DECK_PILL_MAX_WIDTH = 200.dp

/**
 * The study card's deck pill (web: components/study/DeckPill.tsx): "📚 <deck name>" on one line,
 * caption-size and muted, cut with an ellipsis. It is shown on the ANSWER side only, under the
 * meaning / word tags — on the question side the deck name could hint the answer. A tap shows a
 * small popup with the FULL name (suffixes like "(from tutor)" kept) and "Open deck →"; a tap
 * elsewhere or back closes it. The pill's own clickable consumes the tap, so it never peeks back
 * at the question. The touch target is 44 dp tall (invisible); the visible pill is small inside it.
 */
@Composable
fun DeckPill(
    name: String,
    modifier: Modifier = Modifier,
    onOpenDeck: (() -> Unit)? = null,
    /** The popup opened (haptic tick + analytics). */
    onExpand: () -> Unit = {},
    /** Screenshots / tests: start open. */
    startOpen: Boolean = false,
) {
    var open by remember { mutableStateOf(startOpen) }
    var heightPx by remember { mutableIntStateOf(0) }
    Box(modifier) {
        Box(
            Modifier
                .testTag(DECK_PILL_TAG)
                .onSizeChanged { heightPx = it.height }
                .heightIn(min = 44.dp)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                    if (!open) onExpand()
                    open = !open
                }
                .semantics {
                    contentDescription = "Deck: $name"
                    stateDescription = if (open) "Expanded" else "Collapsed"
                    role = Role.Button
                },
            contentAlignment = Alignment.Center,
        ) {
            val bg = if (open) Lab.colors.cardBorder else Lab.colors.faint.copy(alpha = 0.7f)
            Row(
                Modifier.widthIn(max = DECK_PILL_MAX_WIDTH).clip(CircleShape).background(bg)
                    .padding(start = 6.dp, end = 8.dp, top = 1.dp, bottom = 1.dp),
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("📚", style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), modifier = Modifier.alpha(0.8f))
                Text(
                    name,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = if (open) Lab.colors.ink else Lab.colors.muted,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag(DECK_PILL_LABEL_TAG),
                )
            }
        }
        if (open) {
            Popup(
                alignment = Alignment.TopCenter,
                offset = IntOffset(0, heightPx),
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                val shown = remember { MutableTransitionState(false).apply { targetState = true } }
                AnimatedVisibility(shown, enter = fadeIn() + scaleIn(initialScale = 0.92f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 0f))) {
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = Lab.colors.card,
                        shadowElevation = 8.dp,
                        modifier = Modifier.testTag(DECK_PILL_FULL_TAG).widthIn(min = 160.dp, max = 300.dp)
                            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)),
                    ) {
                        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = if (onOpenDeck != null) 0.dp else 12.dp)) {
                            Text("DECK", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                            Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.testTag(DECK_PILL_NAME_TAG))
                            if (onOpenDeck != null) {
                                Box(
                                    Modifier.testTag(DECK_PILL_OPEN_TAG).heightIn(min = 44.dp)
                                        .clickable { open = false; onOpenDeck() },
                                    contentAlignment = Alignment.CenterStart,
                                ) {
                                    Text("Open deck →", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
