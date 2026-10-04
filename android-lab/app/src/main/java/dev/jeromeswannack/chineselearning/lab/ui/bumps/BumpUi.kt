package dev.jeromeswannack.chineselearning.lab.ui.bumps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill

/*
 * "⚡ Study it today" pieces shared by every add-card sheet, the Coach, the deck page and the
 * study card (data/bumps/BumpStore.kt, core Bumps.kt). When a word is already a card, the
 * PRIMARY action is "⚡ Study it today" and "Add anyway" becomes secondary (web: the same rule).
 */

/** The primary label when the word is already in a deck. */
const val STUDY_IT_TODAY = "⚡ Study it today"

/** The amber of the ⚡ pocket (Home's chip, the card badge). */
val BumpAmber = Color(0xFFB45309)

/** Bumps the local note(s) spelled `hanzi` and returns the toast text (core Bumps.bumpedMessage). */
typealias BumpHanzi = suspend (hanzi: List<String>, preferDeck: String?) -> String

/**
 * The real bump for a sheet in the running app; null outside it (previews / screenshot tests
 * pass their own lambda), in which case the sheets keep their old "Add anyway" only.
 */
@Composable
fun rememberBumpHanzi(source: String): BumpHanzi? {
    val app = LocalContext.current.applicationContext as? LabApp ?: return null
    return remember(app, source) {
        { hanzi, preferDeck ->
            app.haptics.tick()
            BumpStore.bumpHanzi(app, hanzi, source, preferDeck).message
        }
    }
}

/** "⚡ Today" (or "⚡ from Minghui") on a card from the bump pocket. */
@Composable
fun BumpChip(bumpedBy: String?, modifier: Modifier = Modifier) {
    Text(
        if (bumpedBy.isNullOrBlank()) "⚡ Today" else "⚡ from ${bumpedBy.substringBefore(' ')}",
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = BumpAmber,
        maxLines = 1,
        modifier = modifier.testTag("bump-chip").clip(CircleShape).background(BumpAmber.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/**
 * The footer when the word is already a card: "Add anyway" (secondary) beside
 * "⚡ Study it today" (primary; "⚡ Bumped" once done).
 */
@Composable
fun BumpFirstRow(
    bumpedMessage: String?,
    busy: Boolean,
    onAddAnyway: () -> Unit,
    onBump: () -> Unit,
    modifier: Modifier = Modifier,
    addLabel: String = "Add anyway",
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SecondaryPill(addLabel, Modifier.weight(1f).height(50.dp).testTag("bump-add-anyway"), enabled = !busy && bumpedMessage == null, onClick = onAddAnyway)
        PrimaryPill(
            if (bumpedMessage != null) "⚡ Bumped" else STUDY_IT_TODAY, Modifier.weight(1.3f).height(50.dp).testTag("bump-study-today"),
            enabled = !busy && bumpedMessage == null, onClick = onBump,
        )
    }
}
