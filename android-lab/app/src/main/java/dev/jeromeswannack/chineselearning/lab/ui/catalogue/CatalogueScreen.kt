package dev.jeromeswannack.chineselearning.lab.ui.catalogue

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.ExerciseTypeInfo
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.SampleLesson
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.library.LibraryText
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

// The exercise catalogue: every lesson exercise type from the shared registry (bundled, so it
// works offline), what it trains, how it's checked, and a sample lesson to try or copy.

/** Types added with the practice set — badged "New" (the web's NEW_TYPES). */
val NEW_TYPES = setOf("sentence_making", "write_typed", "write_handwriting", "dictation", "oral_expression", "conversation")

/** The web's SKILL_ORDER. */
val SKILL_ORDER = listOf("listening", "speaking", "writing", "reading", "teaching")

data class CatalogueUi(
    /** null = All. */
    val skill: String? = null,
    /** The sample being copied (every Copy button waits). */
    val copying: String? = null,
    val error: String? = null,
)

data class CatalogueActions(
    val onBack: () -> Unit = {},
    val onSkill: (String?) -> Unit = {},
    val onTry: (SampleLesson) -> Unit = {},
    val onCopy: (SampleLesson) -> Unit = {},
)

data class CatalogueGroup(val skill: String, val types: List<ExerciseTypeInfo>)

/** SKILL_ORDER groups of the registry, filtered by [skill] (null = all). */
fun catalogueGroups(skill: String?): List<CatalogueGroup> = SKILL_ORDER
    .filter { skill == null || it == skill }
    .map { s -> CatalogueGroup(s, LessonCatalogue.types.filter { it.skill == s }) }
    .filter { it.types.isNotEmpty() }

fun exerciseCount(sample: SampleLesson): Int = LibraryText.exerciseCount(sample.spec)

@Composable
fun CatalogueScreen(ui: CatalogueUi, actions: CatalogueActions) {
    val groups = catalogueGroups(ui.skill)
    LabScreen(title = "🧭 Exercise catalogue", onBack = actions.onBack) {
        item(key = "intro") {
            Text(
                buildAnnotatedString {
                    append("The building blocks of a mini lesson. Each one comes with a sample lesson — ")
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)) { append("Try it") }
                    append(" to take it yourself (nothing is recorded), or copy it into your library to adapt and assign. Claude can use every type when it drafts or edits a lesson for you.")
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        item(key = "filters") {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LabChip("All", selected = ui.skill == null) { actions.onSkill(null) }
                SKILL_ORDER.forEach { s ->
                    val label = LessonCatalogue.skill(s)
                    LabChip("${label.icon} ${label.name}", selected = ui.skill == s) { actions.onSkill(s) }
                }
            }
        }
        if (ui.error != null) item(key = "error") { InlineNotice(ui.error, kind = NoticeKind.Error) }
        groups.forEach { g ->
            item(key = "h-${g.skill}") {
                val label = LessonCatalogue.skill(g.skill)
                SectionHeader("${label.icon} ${label.name}")
            }
            items(g.types, key = { "t-${it.type}" }) { info -> TypeCard(info, ui.copying, actions) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TypeCard(info: ExerciseTypeInfo, copying: String?, actions: CatalogueActions) {
    val sample = LessonCatalogue.samples.firstOrNull { it.type == info.type }
    LabCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
                    Text(info.icon, fontSize = 24.sp)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(info.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        if (info.type in NEW_TYPES) {
                            Spacer(Modifier.width(8.dp))
                            Badge("New", Palette.Good)
                        }
                    }
                    Text(info.summary, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
            Text(info.description, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("✔︎ ${info.checking}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                if (info.needs == "microphone") Badge("🎙 Uses the microphone", Palette.Easy)
                if (info.needs == "handwriting") Badge("✍️ Writing pad", Palette.Secondary)
            }
            if (sample != null) {
                HorizontalDivider(color = Lab.colors.faint)
                val n = exerciseCount(sample)
                Text(
                    "${sample.spec.str("icon") ?: "🎓"} Sample: ${sample.spec.str("title").orEmpty()} · $n exercise${if (n == 1) "" else "s"}",
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryPill("▶ Try it", Modifier.height(46.dp)) { actions.onTry(sample) }
                    SecondaryPill(
                        if (copying == sample.id) "Copying…" else "＋ Copy to my library",
                        Modifier.weight(1f).height(46.dp),
                        enabled = copying == null,
                    ) { actions.onCopy(sample) }
                }
            }
        }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.14f)).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}
