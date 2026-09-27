package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.serialization.json.JsonObject

/*
 * Form primitives for the lesson and reader editors (web: components/editor/fields.tsx):
 * labelled fields, a hanzi input with 🔊 + 拼音, the hanzi / pinyin / English block, row
 * controls (▲ ▼ ⧉ ✕), add buttons, segmented toggles and the validator's problems.
 * Inputs are 16sp so nothing zooms; every button is at least 40dp.
 */

typealias Speak = (String) -> Unit

@Composable
fun EdField(label: String, modifier: Modifier = Modifier, hint: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
            if (hint != null) {
                Spacer(Modifier.width(8.dp))
                Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
        content()
    }
}

@Composable
fun EdTextField(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLength: Int? = null,
    chinese: Boolean = false,
    number: Boolean = false,
    label: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { v -> onChange(if (maxLength != null) v.take(maxLength) else v) },
        modifier = modifier.fillMaxWidth().then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier),
        placeholder = placeholder?.let { { Text(it, color = Lab.colors.muted.copy(alpha = 0.7f), fontSize = 16.sp) } },
        singleLine = singleLine,
        minLines = minLines,
        textStyle = TextStyle(fontSize = if (chinese) 18.sp else 16.sp, color = Lab.colors.ink),
        keyboardOptions = if (number) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Lab.colors.accent,
            unfocusedBorderColor = Lab.colors.cardBorder,
            focusedContainerColor = Lab.colors.background,
            unfocusedContainerColor = Lab.colors.background,
            cursorColor = Lab.colors.accent,
        ),
    )
}

/** A small square-ish button: ▲ ▼ ⧉ ✕ 🔊 拼音 Translate… */
@Composable
fun MiniButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, danger: Boolean = false, description: String? = null) {
    Box(
        modifier
            .heightIn(min = 40.dp)
            .widthIn(min = 40.dp)
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(10.dp))
            .bouncyClickable(enabled, 0.9f, onClick = onClick)
            .alpha(if (enabled) 1f else 0.35f)
            .padding(horizontal = 8.dp)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 14.sp, color = if (danger) Palette.Again else Lab.colors.ink, fontWeight = FontWeight.Medium)
    }
}

/** Hanzi input with 🔊 and, when [onPinyin] is set, 拼音 (fills tone-marked pinyin into a sibling field). */
@Composable
fun HanziInput(value: String, onChange: (String) -> Unit, speak: Speak, modifier: Modifier = Modifier, onPinyin: ((String) -> Unit)? = null, placeholder: String = "中文") {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        EdTextField(value, onChange, Modifier.weight(1f), placeholder = placeholder, chinese = true, singleLine = false)
        MiniButton("🔊", { speak(value) }, enabled = JsJson.trim(value).isNotEmpty(), description = "Play")
        if (onPinyin != null) MiniButton("拼音", { onPinyin(toPinyin(value)) }, enabled = JsJson.trim(value).isNotEmpty(), description = "Fill pinyin from the hanzi")
    }
}

/** A hanzi / pinyin / English block (fields.tsx `SentenceEditor`). Blank pinyin / English are removed. */
@Composable
fun SentenceEditor(value: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak, modifier: Modifier = Modifier, englishRequired: Boolean = false, englishLabel: String? = null) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        HanziInput(value.text("hanzi"), { onChange(value.with("hanzi", it)) }, speak, onPinyin = { onChange(value.with("pinyin", it)) })
        EdTextField(value.text("pinyin"), { onChange(value.with("pinyin", it.ifEmpty { null })) }, placeholder = "pinyin (nǐ hǎo)", singleLine = false)
        EdTextField(value.text("english"), { onChange(value.with("english", it.ifEmpty { null })) }, placeholder = englishLabel ?: if (englishRequired) "English (required)" else "English", singleLine = false)
    }
}

/** ▲ ▼ (⧉) ✕ for any ordered list: sentences, options, pairs, exercises, sections, pages. */
@Composable
fun RowControls(index: Int, count: Int, onMove: (Int, Int) -> Unit, onRemove: () -> Unit, onDuplicate: (() -> Unit)? = null, removeLabel: String = "Remove") {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        MiniButton("▲", { onMove(index, index - 1) }, enabled = index > 0, description = "Move up")
        MiniButton("▼", { onMove(index, index + 1) }, enabled = index < count - 1, description = "Move down")
        if (onDuplicate != null) MiniButton("⧉", onDuplicate, description = "Duplicate")
        MiniButton("✕", onRemove, danger = true, description = removeLabel)
    }
}

/** "+ Add …" — dashed-looking outline, full width when [big]. */
@Composable
fun AddButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, big: Boolean = false) {
    Box(
        modifier
            .then(if (big) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = if (big) 52.dp else 44.dp)
            .clip(RoundedCornerShape(14.dp))
            .border(1.5.dp, Lab.colors.accent.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .bouncyClickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("+ $label", color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** Segmented control; [multi] allows several on (the writing cues). */
@Composable
fun Segmented(options: List<Pair<String, String>>, isOn: (String) -> Boolean, onTap: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)),
    ) {
        options.forEachIndexed { i, (id, label) ->
            val on = isOn(id)
            val bg by animateColorAsState(if (on) Lab.colors.accent else Color.Transparent, label = "seg")
            Box(
                Modifier
                    .weight(1f, fill = false)
                    .heightIn(min = 44.dp)
                    .background(bg)
                    .clickable { onTap(id) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
            if (i < options.size - 1) Box(Modifier.width(1.dp).heightIn(min = 44.dp).background(Lab.colors.cardBorder))
        }
    }
}

/** The validator's problems, red, one per line. */
@Composable
fun ErrorList(errors: List<String>, modifier: Modifier = Modifier) {
    if (errors.isEmpty()) return
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.Again.copy(alpha = 0.08f)).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (e in errors) Text("• $e", color = Palette.Again, style = MaterialTheme.typography.bodySmall)
    }
}

/** A list row with its content and trailing controls; [correct] tints it green (the ✓ option). */
@Composable
fun ListRow(modifier: Modifier = Modifier, correct: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (correct) Palette.Good.copy(alpha = 0.10f) else Lab.colors.faint.copy(alpha = 0.55f))
            .border(1.dp, if (correct) Palette.Good.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(14.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

/** The ✓ radio that marks the correct option. */
@Composable
fun CorrectMark(on: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(if (on) Palette.Good else Color.Transparent, label = "correct")
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(bg)
            .border(1.5.dp, if (on) Palette.Good else Lab.colors.cardBorder, RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = if (on) "Correct answer" else "Mark as the correct answer" },
        contentAlignment = Alignment.Center,
    ) {
        Text("✓", color = if (on) Color.White else Lab.colors.muted, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun ControlsRow(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), content = content)
}
