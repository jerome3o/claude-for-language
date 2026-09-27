package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/*
 * Compact renderings of a proposal's diff — the server's `proposal_diff` (a LessonDiff /
 * ReaderDiff object) as rows with + − ~ ↕ badges (web: DiffCard.tsx, ReaderDiffCard.tsx).
 */

private fun short(v: JsonElement?, max: Int = 50): String = JsJson.short(v, max)

private fun isNullish(v: JsonElement?) = v == null || v is JsonNull

@Composable
private fun Badge(kind: String) {
    val (sym, color) = when (kind) {
        "added" -> "+" to Palette.Good
        "removed" -> "−" to Palette.Again
        "moved" -> "↕" to Palette.Easy
        else -> "~" to Palette.Hard
    }
    Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Text(sym, color = color, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

@Composable
private fun DiffRow(kind: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Badge(kind)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) { content() }
    }
}

@Composable
private fun FieldChangeLine(label: String, before: JsonElement?, after: JsonElement?, max: Int = 40) {
    val b = if (isNullish(before) || JsJson.str(before) == "") null else short(before, max)
    val a = if (isNullish(after)) null else short(after, max)
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(label) }
            append(": ")
            if (b != null) withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough, color = Color.Gray)) { append(b) }
            if (b != null && a != null) append(" → ")
            if (a != null) append(a)
        },
        style = MaterialTheme.typography.bodySmall,
        color = Lab.colors.ink,
    )
}

@Composable
private fun Empty(text: String) = Text(text, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)

@Composable
fun LessonDiffCard(diff: JsonObject) {
    if (diff["changed"]?.let { JsJson.truthy(it) } != true) {
        Empty("No changes — the proposal matches the current lesson.")
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (m in diff.objs("meta")) DiffRow("changed") { FieldChangeLine(m.text("field"), m["before"], m["after"], 50) }
        for (s in diff.objs("sections")) {
            val kind = s.str("kind") ?: "changed"
            val n = (s.int("index") ?: 0) + 1
            DiffRow(kind) {
                val text = if (kind == "renamed") "Section $n renamed: ${s.str("before") ?: "untitled"} → ${s.str("after") ?: "untitled"}"
                else "Section $n “${s.str("title") ?: "untitled"}” $kind (${s.int("exerciseCount") ?: 0} exercises)"
                Text(text, style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink)
            }
        }
        for (e in diff.objs("exercises")) {
            val kind = e.str("kind") ?: "changed"
            val ex = (if (kind == "changed") e["after"] else e["exercise"]).asObject()
            DiffRow(kind) {
                val where = "§${(e.int("section") ?: 0) + 1}.${(e.int("index") ?: 0) + 1}" +
                    if (kind == "moved") " (from §${(e.int("fromSection") ?: 0) + 1}.${(e.int("fromIndex") ?: 0) + 1})" else ""
                Text(where, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                Text(
                    "${LessonCatalogue.icon(ex.str("type"))} ${LessonCatalogue.name(ex.str("type"))}  ${short(JsJson.s(LessonDiff.primaryText(ex)))}",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink,
                )
                if (kind == "changed") for (f in e.objs("fields")) FieldChangeLine(f.text("field"), f["before"], f["after"])
            }
        }
    }
}

@Composable
fun ReaderDiffCard(diff: JsonObject) {
    if (diff["changed"]?.let { JsJson.truthy(it) } != true) {
        Empty("No changes — the proposal matches the current reader.")
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (m in diff.objs("meta")) DiffRow("changed") { FieldChangeLine(ReaderDiff.fieldLabel(m.text("field")), m["before"], m["after"], 50) }
        for (p in diff.objs("pages")) {
            val kind = p.str("kind") ?: "changed"
            val page = (if (kind == "changed") p["after"] else p["page"]).asObject()
            val index = p.int("index") ?: 0
            val from = p.int("fromIndex")
            DiffRow(kind) {
                val where = "Page ${index + 1}" + when {
                    kind == "moved" && from != null -> " (from page ${from + 1})"
                    kind == "changed" && from != null && from != index -> " (was page ${from + 1})"
                    else -> ""
                }
                Text(where, style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                Text(short(page["content_chinese"]), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink)
                if (kind == "changed") for (f in p.objs("fields")) FieldChangeLine(ReaderDiff.fieldLabel(f.text("field")), f["before"], f["after"])
            }
        }
    }
}

@Suppress("unused")
private fun Modifier.pad() = padding(0.dp)
