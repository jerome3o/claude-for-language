package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * What the lesson form needs from its screen (web: components/editor/LessonForm.tsx).
 * [open] holds which sections are collapsed ("s<i>") and which exercise cards are open
 * ("e<si>:<ei>"); a card never toggled opens when its exercise is still empty.
 */
class LessonFormHost(
    val onChange: (JsonObject) -> Unit,
    val speak: Speak,
    val open: SnapshotStateMap<String, Boolean>,
    /** Ask before a destructive edit; [onYes] runs if confirmed. */
    val confirm: (title: String, text: String, onYes: () -> Unit) -> Unit,
    val notice: (String) -> Unit,
    val pickType: (section: Int) -> Unit,
    val haptic: () -> Unit = {},
)

private fun sections(spec: JsonObject): List<JsonObject> = spec.objs("sections")

private fun withSections(spec: JsonObject, list: List<JsonObject>) = spec.withObjs("sections", list)

/** The form as LazyColumn items: header fields, then each section with its exercise cards. */
fun LazyListScope.lessonFormItems(spec: JsonObject, errors: List<String>, host: LessonFormHost) {
    val secs = sections(spec)
    item("head") { LessonHeadFields(spec, errors, host) }
    secs.forEachIndexed { si, section ->
        val collapsed = host.open["s$si"] == false
        item("section-$si") { SectionHeader(spec, si, section, errors, collapsed, host) }
        if (!collapsed) {
            val exercises = section.objs("exercises")
            exercises.forEachIndexed { ei, ex ->
                item("ex-$si-$ei-${ex.str("type")}") { ExerciseCard(spec, si, ei, ex, errors, host) }
            }
            item("add-ex-$si") {
                AddButton("Add exercise", { host.pickType(si) }, Modifier.padding(start = 12.dp), big = true)
            }
        }
    }
    item("add-section") {
        AddButton("Add section", { host.haptic(); host.onChange(withSections(spec, secs + JsJson.obj("exercises" to JsonArray(emptyList())))) }, big = true)
    }
}

@Composable
private fun LessonHeadFields(spec: JsonObject, errors: List<String>, host: LessonFormHost) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
            EdField("Icon", Modifier.width(84.dp)) {
                EdTextField(spec.text("icon"), { host.onChange(spec.with("icon", it.ifEmpty { null })) }, placeholder = "🎓", maxLength = 8, label = "Icon (emoji)")
            }
            EdField("Title", Modifier.weight(1f)) {
                EdTextField(spec.text("title"), { host.onChange(spec.with("title", it)) }, placeholder = "Ordering at a café", maxLength = 200)
            }
        }
        EdField("Description", hint = "one sentence, optional") {
            EdTextField(spec.text("description"), { host.onChange(spec.with("description", it.ifEmpty { null })) }, placeholder = "What the lesson covers", singleLine = false, minLines = 2)
        }
        ErrorList(errors.filter { !it.startsWith("sections[") })
    }
}

@Composable
private fun SectionHeader(spec: JsonObject, si: Int, section: JsonObject, errors: List<String>, collapsed: Boolean, host: LessonFormHost) {
    val secs = sections(spec)
    val exercises = section.objs("exercises")
    Column(
        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MiniButton(if (collapsed) "▸" else "▾", { host.open["s$si"] = collapsed }, description = if (collapsed) "Expand section" else "Collapse section")
            EdTextField(
                section.text("title"),
                { host.onChange(withSections(spec, secs.replaceAt(si, section.with("title", it.ifEmpty { null })))) },
                Modifier.weight(1f),
                placeholder = "Section ${si + 1} title (optional)",
            )
            Text("${exercises.size}", color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Section ${si + 1}", color = Lab.colors.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
            RowControls(
                si, secs.size,
                onMove = { from, to -> host.haptic(); host.onChange(withSections(spec, secs.moveItem(from, to))) },
                onRemove = {
                    if (secs.size == 1) host.notice("A lesson needs at least one section.")
                    else if (exercises.isEmpty()) host.onChange(withSections(spec, secs.removeAtIndex(si)))
                    else host.confirm("Delete section ${si + 1}?", "Delete section ${si + 1} and its ${exercises.size} exercise(s)?") { host.onChange(withSections(spec, secs.removeAtIndex(si))) }
                },
                removeLabel = "Delete section",
            )
        }
        ErrorList(errorsFor(errors, si))
    }
}

@Composable
private fun ExerciseCard(spec: JsonObject, si: Int, ei: Int, ex: JsonObject, errors: List<String>, host: LessonFormHost) {
    val secs = sections(spec)
    val section = secs[si]
    val exercises = section.objs("exercises")
    val exErrors = errorsFor(errors, si, ei)
    val summary = LessonDiff.primaryText(ex)
    val key = "e$si:$ei"
    val open = host.open[key] ?: summary.isEmpty()
    fun setExercises(list: List<JsonObject>) = host.onChange(withSections(spec, secs.replaceAt(si, section.withObjs("exercises", list))))

    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = 12.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Lab.colors.card)
            .border(1.dp, if (exErrors.isNotEmpty()) Palette.Again.copy(alpha = 0.45f) else Lab.colors.cardBorder, RoundedCornerShape(16.dp)),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable { host.haptic(); host.open[key] = !open }.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                Text("${ei + 1}", fontSize = 13.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.width(10.dp))
            Text(LessonCatalogue.icon(ex.str("type")), fontSize = 20.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(LessonCatalogue.name(ex.str("type")), style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                Text(
                    summary.ifEmpty { "empty" },
                    color = if (summary.isEmpty()) Lab.colors.muted else Lab.colors.ink,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (exErrors.isNotEmpty()) {
                Box(Modifier.size(24.dp).clip(CircleShape).background(Palette.Again), contentAlignment = Alignment.Center) {
                    Text("!", color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
                Spacer(Modifier.width(6.dp))
            }
            Text(if (open) "▾" else "▸", color = Lab.colors.muted, fontSize = 18.sp)
        }
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp), horizontalArrangement = Arrangement.End) {
            RowControls(
                ei, exercises.size,
                onMove = { from, to -> host.haptic(); setExercises(exercises.moveItem(from, to)) },
                onDuplicate = { host.haptic(); setExercises(exercises.insertAt(ei + 1, ex)) },
                onRemove = {
                    if (exercises.size > 1) setExercises(exercises.removeAtIndex(ei))
                    else host.confirm("Delete this exercise?", "Delete the only exercise in this section?") { setExercises(exercises.removeAtIndex(ei)) }
                },
                removeLabel = "Delete exercise",
            )
        }
        AnimatedVisibility(
            open,
            enter = expandVertically(spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)) + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ExerciseForm(ex, { setExercises(exercises.replaceAt(ei, it)) }, host.speak, exErrors)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    MiniButton("Auto-fill missing pinyin", { host.haptic(); setExercises(exercises.replaceAt(ei, fillMissingPinyin(ex))) })
                }
            }
        }
    }
}

/** "+ Add exercise": every type from the registry with its one-line summary (TypePicker). */
@Composable
fun ExerciseTypePicker(onPick: (String) -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss, title = "Add an exercise") {
        for (info in LessonCatalogue.types) {
            NavRow(info.icon, info.name, desc = info.summary, onClick = { onPick(info.type) })
        }
    }
}

/** Adds a blank exercise of [type] at the end of section [si]; returns the new spec and the card key to open. */
fun addExercise(spec: JsonObject, si: Int, type: String): Pair<JsonObject, String> {
    val secs = sections(spec)
    val section = secs[si]
    val exercises = section.objs("exercises")
    val next = withSections(spec, secs.replaceAt(si, section.withObjs("exercises", exercises + LessonCatalogue.defaultExercise(type))))
    return next to "e$si:${exercises.size}"
}
