package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivities
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivity
import dev.jeromeswannack.chineselearning.lab.core.calls.StudentCoverage
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.time.Instant

/*
 * "🎲 Ready for next lesson" and "What <student> has covered" on the tutor's student page
 * (web: components/tutor/PreparedActivitiesSection.tsx + CoverageSection.tsx;
 * docs/VIDEO_CALLS.md "Prepared activities"). Rules: core PreparedActivities (parity-tested).
 */

/** The amber of the "why" line (web `.pa-why`). */
private val WhyColor = Color(0xFFB45309)
private val UsedColor = Color(0xFF047857)

/** What the student page's section shows (from PreparedActivitiesController). */
data class PreparedSectionUi(
    val activities: List<PreparedActivity>? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val preparing: Boolean = false,
    val canPrepare: Boolean = true,
    val jobError: String? = null,
    val actionError: String? = null,
    val undo: PreparedActivity? = null,
)

data class PreparedSectionActions(
    val prepare: () -> Unit = {},
    val dismiss: (PreparedActivity) -> Unit = {},
    val restore: (PreparedActivity) -> Unit = {},
    val previewed: (PreparedActivity) -> Unit = {},
)

/** What's inside one prepared activity: its summary and the words / lines / questions. */
@Composable
fun PreparedPreview(a: PreparedActivity, modifier: Modifier = Modifier) {
    Column(modifier.testTag("prepared-preview"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(a.spec.summary, color = Lab.colors.muted, fontSize = 13.sp)
        PreparedActivities.preview(a.spec, 10).forEach { line -> Text("• $line", color = Lab.colors.ink, fontSize = 14.sp) }
    }
}

/**
 * One prepared activity: icon, title, why; tapping the row opens the preview ([onTap] overrides
 * that — the call menu starts it), [trailing] is the row's end control (✕ here, 👁 in the call).
 */
@Composable
fun PreparedRow(
    a: PreparedActivity,
    open: Boolean,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    val info = CallActivities.KIND_INFO[a.spec.kind]
    val used = a.status == "used"
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).alpha(if (used) 0.75f else 1f)
            .animateContentSize().testTag("prepared-${a.id}"),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).heightIn(min = 52.dp).bouncyClickable(pressedScale = 0.98f, onClick = onTap).padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(info?.icon ?: "🎲", fontSize = 20.sp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        a.spec.title + (a.spec.titleZh?.let { " · $it" } ?: ""),
                        color = Lab.colors.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    )
                    Text(a.why, color = WhyColor, fontSize = 13.sp)
                    if (used) Text("✓ Used", color = UsedColor, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
            trailing?.invoke()
        }
        if (open) PreparedPreview(a, Modifier.padding(start = 42.dp, end = 12.dp, bottom = 12.dp))
    }
}

@Composable
private fun PreparedPrivateBadge() {
    Text(
        "🔒 Only you see these",
        style = MaterialTheme.typography.labelMedium,
        color = Lab.colors.muted,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/** "🎲 Ready for next lesson": the prepared activities with preview, ✕ (+ Undo), Prepare / Make more. */
@Composable
fun PreparedActivitiesSection(studentName: String, ui: PreparedSectionUi, actions: PreparedSectionActions) {
    val name = PreparedActivities.firstName(studentName)
    val all = PreparedActivities.order(ui.activities.orEmpty())
    val ready = all.filter { it.status == "ready" }
    val used = all.filter { it.status == "used" }
    var openId by remember { mutableStateOf<String?>(null) }
    var showUsed by remember { mutableStateOf(false) }
    Column(Modifier.testTag("prepared-activities"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("🎲 Ready for next lesson") { PreparedPrivateBadge() }
        TeachCard {
            when {
                ui.activities == null && ui.loading -> MutedLine("Loading…")
                ui.activities == null && ui.error != null -> InlineNotice(ui.error, kind = NoticeKind.Error)
                else -> {
                    Text(
                        PreparedActivities.headline(ready.size) + (ready.firstOrNull()?.sourceLabel?.let { " · from $it" } ?: ""),
                        color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.testTag("prepared-headline"),
                    )
                    if (ready.isEmpty() && !ui.preparing) {
                        MutedLine("Activities for your next call with $name, written from your previous lessons — the new words, the corrections, what $name keeps getting wrong and recent homework. They wait in the call’s ⋯ → 🎲 Activities.")
                    }
                    ready.forEach { a ->
                        PreparedRow(a, open = openId == a.id, onTap = {
                            if (openId != a.id) actions.previewed(a)
                            openId = if (openId == a.id) null else a.id
                        }) {
                            Box(
                                Modifier.width(48.dp).heightIn(min = 52.dp).bouncyClickable { actions.dismiss(a) }.testTag("prepared-dismiss"),
                                contentAlignment = Alignment.Center,
                            ) { Text("✕", color = Lab.colors.muted, fontSize = 16.sp) }
                        }
                    }
                    ui.undo?.let { u ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MutedLine("Dismissed “${u.spec.title}”", Modifier.weight(1f))
                            InlineButton("Undo") { actions.restore(u) }
                        }
                    }
                    if (ui.preparing) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.heightIn(min = 44.dp).testTag("prepared-working")) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                            MutedLine("Preparing activities from $name’s last lessons… about a minute")
                        }
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TeachButton(
                                if (ready.isEmpty()) "🎲 Prepare activities for next lesson" else "↻ Make more",
                                Modifier.testTag("prepared-make"), primary = ready.isEmpty(), enabled = ui.canPrepare, onClick = actions.prepare,
                            )
                            if (ready.isNotEmpty()) MutedLine("In your next call: ⋯ → 🎲 Activities", Modifier.weight(1f))
                        }
                    }
                    ui.jobError?.takeIf { !ui.preparing }?.let { InlineNotice("Couldn’t prepare them: $it. Try again.", kind = NoticeKind.Error) }
                    ui.actionError?.let { InlineNotice(it, kind = NoticeKind.Error) }
                    if (used.isNotEmpty()) {
                        InlineButton(if (showUsed) "Hide the ${used.size} already used" else "Show the ${used.size} already used") { showUsed = !showUsed }
                        if (showUsed) used.take(12).forEach { a ->
                            PreparedRow(a, open = openId == a.id, onTap = { openId = if (openId == a.id) null else a.id })
                        }
                    }
                }
            }
        }
    }
}

/** "What <student> has covered": lessons (topics, new words, corrections), words met / known, recent words. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CoverageSection(studentName: String, coverage: StudentCoverage?, loading: Boolean, now: Instant = Instant.now()) {
    val name = PreparedActivities.firstName(studentName)
    var all by remember { mutableStateOf(false) }
    Column(Modifier.testTag("coverage-section"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TeachSectionTitle("What $name has covered")
        TeachCard {
            if (coverage == null) {
                MutedLine(if (loading) "Loading…" else "Not loaded yet")
                return@TeachCard
            }
            val headline = PreparedActivities.coverageHeadline(coverage)
            Text(headline.ifEmpty { "Nothing on record for $name yet." }, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            val lessons = if (all) coverage.lessons else coverage.lessons.take(4)
            lessons.forEach { l ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(TeachingFormat.shortDate(l.date, now, java.time.ZoneOffset.UTC), color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(56.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        l.title?.let { Text(it, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
                        if (l.topics.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            l.topics.forEach { CoverageChip(it, Color(0xFFEEF2FF), Color(0xFF3730A3)) }
                        }
                        MutedLine(
                            (if (l.source == "call") "📹 Video lesson" else "📝 Lesson notes") +
                                (if (l.newWords > 0) " · ${l.newWords} new word${if (l.newWords == 1) "" else "s"}" else "") +
                                (if (l.corrections > 0) " · ${l.corrections} correction${if (l.corrections == 1) "" else "s"}" else ""),
                        )
                    }
                }
            }
            if (coverage.lessons.size > 4) InlineButton(if (all) "Show fewer" else "Show all ${coverage.lessons.size}") { all = !all }
            if (coverage.recentWords.isNotEmpty()) {
                MutedLine("Recent words")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    coverage.recentWords.take(18).forEach { CoverageChip(it.hanzi, Color(0xFFFEF3C7), Color(0xFF78350F), 15) }
                }
            }
        }
    }
}

@Composable
private fun CoverageChip(text: String, bg: Color, fg: Color, size: Int = 13) {
    Text(text, color = fg, fontSize = size.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 9.dp, vertical = 3.dp))
}
