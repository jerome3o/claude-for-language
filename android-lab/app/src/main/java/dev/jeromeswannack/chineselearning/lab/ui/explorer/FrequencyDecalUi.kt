package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
import dev.jeromeswannack.chineselearning.lab.core.explorer.DecalKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecal
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecals
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/*
 * Frequency decals (docs/LANGUAGE_EXPLORER.md "Frequency decals"; web
 * components/explorer/FrequencyDecal.tsx + explorer.css): a 1.5dp outline (2dp + a lemon fill
 * for the yellow tier on light) around a word /
 * character tile from its rank in the shipped word-freq list (core FrequencyDecals.tier,
 * parity-tested). Modifier.border draws inside the tile's bounds, so a decal never changes
 * its size or the layout.
 */

/** The decal of a word / character (null = no outline). A null provider = no frequency list → no decals. */
typealias DecalOf = (text: String, kind: DecalKind) -> FrequencyDecal?

/** Decals from the list shipped with the app (null if it couldn't be read). One map lookup per tile. */
fun shippedDecals(): DecalOf? = WordFrequency.shipped?.let { idx ->
    { text, kind -> FrequencyDecals.tier(if (kind == DecalKind.CHAR) idx.chars[text] else idx.words[text], kind) }
}

/**
 * The web's --freq-* tokens. Light (on #FFFDF8 / #FFFFFF): purple 4.2:1, green 3.2:1, yellow
 * 3.4:1, grey 2.5:1 (rare = the quietest, on purpose). Dark (on #1C1C20): 6.2 / 9.7 / 12.9 / 3.5.
 *
 * Yellow (top 2,000) is LEMON yellow, never amber / gold. A pure yellow line can't reach 3:1 on a
 * light card (every yellow bright enough to read as yellow is under 2:1 on white), so on light its
 * outline is a lemon-olive (#948C00, 3.4:1 on the card, 3.25:1 on its fill) 2dp wide around a pale
 * lemon fill (#FEF9C3) — the fill is what reads "yellow". On dark #FDE047 (yellow-300, 12.9:1) is
 * lemon on its own; #FACC15 read as orange there (Oct 2026). No fill on dark: any yellow tint over
 * #1C1C20 comes out khaki and pulls it back towards gold.
 */
object DecalColors {
    val light = mapOf(
        FrequencyDecal.TOP100 to Color(0xFF8B5CF6),
        FrequencyDecal.TOP1000 to Color(0xFF16A34A),
        FrequencyDecal.TOP2000 to Color(0xFF948C00),
        FrequencyDecal.RARE to Color(0xFF9CA3AF),
    )
    val dark = mapOf(
        FrequencyDecal.TOP100 to Color(0xFFA78BFA),
        FrequencyDecal.TOP1000 to Color(0xFF4ADE80),
        FrequencyDecal.TOP2000 to Color(0xFFFDE047),
        FrequencyDecal.RARE to Color(0xFF71717A),
    )

    /** The fill behind the yellow tier on the light theme (none on dark, none for the other tiers). */
    val yellowFillLight = Color(0xFFFEF9C3)
}

/** How one decal is drawn: the outline colour and width, and an optional fill (the yellow tier on light). */
data class DecalStyle(val color: Color, val width: Dp = 1.5.dp, val fill: Color? = null)

@Composable
fun decalStyle(tier: FrequencyDecal?): DecalStyle? {
    tier ?: return null
    val dark = Lab.colors.card.luminance() < 0.4f
    val color = (if (dark) DecalColors.dark else DecalColors.light)[tier] ?: return null
    return if (tier == FrequencyDecal.TOP2000) {
        DecalStyle(color, 2.dp, if (dark) null else DecalColors.yellowFillLight)
    } else {
        DecalStyle(color)
    }
}

/** The outline (+ the yellow tier's fill on light); nothing when [style] is null. */
fun Modifier.frequencyDecal(style: DecalStyle?, shape: Shape): Modifier =
    if (style == null) {
        this
    } else {
        (if (style.fill != null) this.background(style.fill, shape) else this).border(style.width, style.color, shape)
    }

const val FREQ_KEY_TOGGLE_TAG = "freq-key-toggle"
const val FREQ_KEY_TAG = "freq-key"

/** The ⓘ next to a list header ("Words with 字", "Related words"); 44dp touch target. */
@Composable
fun FrequencyKeyButton(open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier.size(44.dp).clip(CircleShape).clickable(onClick = onToggle).testTag(FREQ_KEY_TOGGLE_TAG)
            .semantics { contentDescription = "What the coloured outlines mean" },
        contentAlignment = Alignment.Center,
    ) {
        Text("ⓘ", fontSize = 17.sp, color = if (open) Lab.colors.ink else Lab.colors.muted)
    }
}

/** The one-line key: a swatch per decal + "purple top 100" … */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FrequencyKeyLine(modifier: Modifier = Modifier) {
    FlowRow(
        modifier.testTag(FREQ_KEY_TAG).semantics { contentDescription = "Outlines: ${FrequencyDecals.keyLine()}" },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        FrequencyDecals.KEY.forEachIndexed { i, k ->
            // The separator ends an entry, so a wrapped line starts with a swatch, never a "·".
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(13.dp).frequencyDecal(decalStyle(k.tier), RoundedCornerShape(4.dp)))
                Spacer(Modifier.width(4.dp))
                Text(
                    "${k.colour} ${k.label}" + if (i < FrequencyDecals.KEY.lastIndex) "  ·" else "",
                    style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(end = 2.dp),
                )
            }
        }
    }
}
