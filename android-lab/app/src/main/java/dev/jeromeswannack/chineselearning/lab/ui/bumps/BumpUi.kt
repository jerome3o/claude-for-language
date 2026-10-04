package dev.jeromeswannack.chineselearning.lab.ui.bumps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SentenceBumps
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

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

/**
 * The Coach's "⚡ Study words from this today…" picker (core SentenceBumps; web
 * components/bumps/SentenceBumpSheet.tsx): one row per word of the sentence he already has —
 * hanzi · pinyin · meaning — with NOTHING ticked; rows already in today's pocket show ⚡ and
 * can't be ticked. Cancel and "⚡ Add N to today" are pinned ([SheetScaffold]).
 */
@Composable
fun SentenceBumpForm(
    words: List<BumpStore.BumpWord>,
    bumpedIds: Set<String>,
    onAdd: (List<String>) -> Unit,
    onCancel: () -> Unit,
    initialPicked: Set<String> = emptySet(),
) {
    var picked by remember(words) { mutableStateOf(initialPicked) }
    val chosen = words.map { it.noteId }.filter { it in picked && it !in bumpedIds }
    SheetScaffold(
        header = { SheetTitle(SentenceBumps.SHEET_TITLE) },
        footer = {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp).testTag("sentence-bump-cancel"), onClick = onCancel)
            PrimaryPill(
                SentenceBumps.addToTodayLabel(chosen.size), Modifier.weight(1.4f).height(52.dp).testTag("sentence-bump-add"),
                enabled = chosen.isNotEmpty(), color = BumpAmber,
            ) { if (chosen.isNotEmpty()) onAdd(chosen) }
        },
        spacing = 0.dp,
    ) {
        Text(
            "Tick the ones to put first in today’s study.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(bottom = 6.dp),
        )
        words.forEachIndexed { i, w ->
            val on = w.noteId in bumpedIds
            SentenceBumpRow(w, checked = on || w.noteId in picked, bumped = on) {
                picked = if (w.noteId in picked) picked - w.noteId else picked + w.noteId
            }
            if (i < words.lastIndex) HorizontalDivider(color = Lab.colors.cardBorder)
        }
    }
}

@Composable
private fun SentenceBumpRow(w: BumpStore.BumpWord, checked: Boolean, bumped: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(enabled = !bumped, pressedScale = 0.98f, role = Role.Checkbox, onClick = onToggle)
            .alpha(if (bumped) 0.7f else 1f).testTag("sentence-bump-row-${w.noteId}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked, { onToggle() }, enabled = !bumped,
            colors = CheckboxDefaults.colors(checkedColor = BumpAmber, disabledCheckedColor = BumpAmber.copy(alpha = 0.45f)),
            modifier = Modifier.testTag("sentence-bump-check-${w.noteId}"),
        )
        Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(w.hanzi, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                if (w.pinyin.isNotBlank()) Text(w.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(bottom = 2.dp))
            }
            if (w.english.isNotBlank()) Text(w.english, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 2)
        }
        if (bumped) Text("⚡", fontSize = 18.sp, color = BumpAmber, modifier = Modifier.padding(horizontal = 8.dp).testTag("sentence-bump-on-${w.noteId}"))
    }
}

/** [SentenceBumpForm] as a bottom sheet. */
@Composable
fun SentenceBumpSheet(words: List<BumpStore.BumpWord>, bumpedIds: Set<String>, onAdd: (List<String>) -> Unit, onDismiss: () -> Unit) {
    LabSheetFrame(onDismiss) { SentenceBumpForm(words, bumpedIds, onAdd, onCancel = onDismiss) }
}
