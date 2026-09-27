package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderExport
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderValidator
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.core.spec.without
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** What the reader form needs (web: components/editor/ReaderForm.tsx). [open] = page index → expanded. */
class ReaderFormHost(
    val onChange: (JsonObject) -> Unit,
    val speak: Speak,
    val open: SnapshotStateMap<Int, Boolean>,
    val confirm: (title: String, text: String, onYes: () -> Unit) -> Unit,
    /** null when offline / unavailable: the Translate / Suggest buttons hide (web: `assist` null). */
    val assist: ((index: Int, field: String) -> Unit)?,
    val illustrate: ((index: Int) -> Unit)?,
    val busy: Map<Int, String>,
    val pageNotes: Map<Int, String>,
    val haptic: () -> Unit = {},
)

fun blankPage(): JsonObject = JsJson.obj(
    "content_chinese" to JsJson.s(""), "content_pinyin" to JsJson.s(""), "content_english" to JsJson.s(""), "image_prompt" to JsonNull,
)

private fun pages(spec: JsonObject) = spec.objs("pages")

/** New pages open; with 3 or fewer pages all start open, else only the first (the web's initial state). */
fun defaultPageOpen(spec: JsonObject, index: Int): Boolean = pages(spec).size <= 3 || index == 0

fun LazyListScope.readerFormItems(spec: JsonObject, savedSpec: JsonObject?, errors: List<String>, host: ReaderFormHost) {
    val list = pages(spec)
    val savedPromptById = savedSpec?.objs("pages").orEmpty().filter { it.str("id") != null }.associate { it.str("id")!! to (it.str("image_prompt")) }
    val savedIds = savedSpec?.objs("pages").orEmpty().mapNotNull { it.str("id") }.toSet()
    item("reader-head") { ReaderHead(spec, errors, host) }
    item("pages-head") {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Pages", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
            Text("${list.size}", color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            MiniButton("Expand all", { list.indices.forEach { host.open[it] = true } })
            MiniButton("Collapse all", { list.indices.forEach { host.open[it] = false } })
        }
    }
    list.forEachIndexed { i, page ->
        val pid = page.str("id")
        item("page-${pid ?: "new"}-$i") {
            PageCard(spec, i, page, pageErrors(errors, i + 1), host, savedPrompt = if (pid != null && pid in savedIds) savedPromptById[pid] ?: "" else null)
        }
    }
    item("add-page") {
        AddButton("Add page", {
            host.haptic()
            host.open[list.size] = true
            host.onChange(spec.withObjs("pages", list + blankPage()))
        }, big = true)
    }
}

@Composable
private fun ReaderHead(spec: JsonObject, errors: List<String>, host: ReaderFormHost) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ErrorList(errors.filter { !Regex("^Page \\d+:").containsMatchIn(it) })
        EdField("中文 title") {
            HanziInput(spec.text("title_chinese"), { host.onChange(spec.with("title_chinese", it)) }, host.speak, placeholder = "长春的冬天")
        }
        EdField("English title") { EdTextField(spec.text("title_english"), { host.onChange(spec.with("title_english", it)) }, placeholder = "Winter in Changchun") }
        EdField("Difficulty") {
            dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow {
                for (d in ReaderValidator.DIFFICULTIES) {
                    dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip(ReaderExport.difficultyLabel(d), selected = d == spec.str("difficulty_level")) { host.haptic(); host.onChange(spec.with("difficulty_level", d)) }
                }
            }
        }
        EdField("Topic", hint = "optional") {
            EdTextField(spec.text("topic"), { host.onChange(spec.with("topic", if (it.isEmpty()) JsonNull else JsJson.s(it))) }, placeholder = "winter, daily life…")
        }
    }
}

@Composable
private fun PageCard(spec: JsonObject, index: Int, page: JsonObject, errors: List<String>, host: ReaderFormHost, savedPrompt: String?) {
    val list = pages(spec)
    val open = host.open[index] ?: defaultPageOpen(spec, index)
    val prompt = JsJson.trim(page.text("image_prompt"))
    val imageKey = page.str("image_url")
    val hasId = page.str("id") != null
    val promptSaved = savedPrompt != null && JsJson.trim(savedPrompt) == prompt
    val canIllustrate = host.illustrate != null && hasId && prompt.isNotEmpty() && promptSaved && imageKey.isNullOrEmpty()
    val busy = host.busy[index]
    val chinese = page.text("content_chinese")
    val summary = JsJson.trim(chinese).ifEmpty { JsJson.trim(page.text("content_english")) }.ifEmpty { "Empty page" }
    fun set(p: JsonObject) = host.onChange(spec.withObjs("pages", list.replaceAt(index, p)))
    fun insertAt(at: Int, p: JsonObject) {
        // Open state is by position: shift the ones after the insert, open the new page.
        val shifted = host.open.toMap()
        host.open.clear()
        shifted.forEach { (k, v) -> host.open[if (k >= at) k + 1 else k] = v }
        host.open[at] = true
        host.onChange(spec.withObjs("pages", list.insertAt(at, p)))
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
            .border(1.dp, if (errors.isNotEmpty()) Palette.Again.copy(alpha = 0.45f) else Lab.colors.cardBorder, RoundedCornerShape(16.dp)),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable { host.haptic(); host.open[index] = !open }.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                Text("${index + 1}", fontSize = 13.sp, color = Lab.colors.muted, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.width(10.dp))
            if (!imageKey.isNullOrEmpty()) EditorImage(imageKey, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)), height = 44.dp, crop = true)
            else Text(if (prompt.isNotEmpty()) "🖼" else "📄", fontSize = 20.sp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Page ${index + 1}${if (chinese.isNotEmpty()) " · ${JsJson.trim(chinese).length} chars" else ""}", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                Text(summary, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (summary == "Empty page") Lab.colors.muted else Lab.colors.ink, fontSize = 17.sp)
                if (errors.isNotEmpty()) Text("${errors.size} problem${if (errors.size == 1) "" else "s"}", color = Palette.Again, style = MaterialTheme.typography.labelMedium)
            }
            Text(if (open) "▾" else "▸", color = Lab.colors.muted, fontSize = 18.sp)
        }
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp), horizontalArrangement = Arrangement.End) {
            RowControls(
                index, list.size,
                onMove = { from, to ->
                    if (to < 0 || to >= list.size) return@RowControls
                    host.haptic()
                    val a = host.open[from]
                    val b = host.open[to]
                    if (b != null) host.open[from] = b else host.open.remove(from)
                    if (a != null) host.open[to] = a else host.open.remove(to)
                    host.onChange(spec.withObjs("pages", list.moveItem(from, to)))
                },
                onDuplicate = { host.haptic(); insertAt(index + 1, page.without("id", "image_url")) },
                onRemove = {
                    val remove = {
                        val shifted = host.open.toMap()
                        host.open.clear()
                        shifted.forEach { (k, v) -> if (k != index) host.open[if (k > index) k - 1 else k] = v }
                        host.onChange(spec.withObjs("pages", list.removeAtIndex(index)))
                    }
                    if (JsJson.trim(chinese).isNotEmpty()) host.confirm("Delete page ${index + 1}?", "Its text and illustration go with it.", remove) else remove()
                },
                removeLabel = "Delete page",
            )
        }
        AnimatedVisibility(open, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ErrorList(errors)
                EdField("中文", hint = "the page text") {
                    EdTextField(chinese, { set(page.with("content_chinese", it)) }, placeholder = "长春的冬天很冷。", singleLine = false, minLines = 3, chinese = true)
                    ControlsRow {
                        Spacer(Modifier.weight(1f))
                        MiniButton("🔊", { host.speak(chinese) }, enabled = JsJson.trim(chinese).isNotEmpty(), description = "Play")
                        MiniButton("拼音", { host.haptic(); set(page.with("content_pinyin", toPagePinyin(chinese))) }, enabled = JsJson.trim(chinese).isNotEmpty(), description = "Fill pinyin from the Chinese")
                    }
                }
                EdField("Pinyin", hint = "tone marks; may be left blank") {
                    EdTextField(page.text("content_pinyin"), { set(page.with("content_pinyin", it)) }, placeholder = "Chángchūn de dōngtiān hěn lěng.", singleLine = false)
                }
                EdField("English") {
                    EdTextField(page.text("content_english"), { set(page.with("content_english", it)) }, placeholder = "Winter in Changchun is very cold.", singleLine = false, minLines = 2)
                    if (host.assist != null) ControlsRow {
                        Spacer(Modifier.weight(1f))
                        MiniButton(if (busy == "english") "…" else "Translate", { host.assist.invoke(index, "english") }, enabled = busy == null && host.busy.isEmpty() && JsJson.trim(chinese).isNotEmpty(), description = "Translate the Chinese with Claude")
                    }
                }
                EdField("Illustration", hint = "English scene description; blank = no picture") {
                    EdTextField(page.text("image_prompt"), { set(page.with("image_prompt", it)) }, placeholder = "A child in a red coat walking down a snowy street in Changchun, warm storybook style", singleLine = false, minLines = 2)
                    ControlsRow {
                        Spacer(Modifier.weight(1f))
                        if (host.assist != null) MiniButton(if (busy == "image_prompt") "…" else "Suggest", { host.assist.invoke(index, "image_prompt") }, enabled = host.busy.isEmpty() && JsJson.trim(chinese).isNotEmpty(), description = "Draft a prompt from the page with Claude")
                        if (host.illustrate != null) MiniButton(if (busy == "illustrate") "…" else "Illustrate", { host.illustrate.invoke(index) }, enabled = host.busy.isEmpty() && canIllustrate, description = "Generate the illustration now")
                    }
                    when {
                        !imageKey.isNullOrEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            EditorImage(imageKey, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), description = prompt.ifEmpty { "Illustration" })
                            Text("Change the prompt and save to redraw.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                        }
                        prompt.isNotEmpty() -> Text(
                            if (hasId && promptSaved) "Illustration pending — it is drawn in the background after Save, or press Illustrate." else "Saved pages are illustrated in the background.",
                            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                        )
                    }
                }
                host.pageNotes[index]?.let { ErrorList(listOf(it)) }
                AddButton("Insert page after", { host.haptic(); insertAt(index + 1, blankPage()) })
            }
        }
    }
}

@Suppress("unused")
private val keep = Color.Unspecified
