package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.JudgeGap
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.core.spec.without
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The editor forms for "Judge each sentence" and "Choose the word" (web: JudgeForm / GapChoiceForm
 * in components/editor/ExerciseForm.tsx). Immutable edits on the exercise JSON; the validator's
 * problems show under the form.
 */

@Composable
internal fun JudgeForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val sentences = ex.objs("sentences")
    val set = { i: Int, s: JsonObject -> onChange(ex.withObjs("sentences", sentences.replaceAt(i, s))) }
    EdField("Instruction", hint = "optional — default “Correct or incorrect?”") {
        EdTextField(ex.text("question"), { onChange(ex.withClean("question", it)) }, placeholder = "e.g. Is 了 in the right place?")
    }
    EdField("Sentences to judge", hint = "${sentences.size}/8 — a mix of right and wrong, one point each") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            sentences.forEachIndexed { i, s ->
                val right = s["correct"]?.let { (it as? JsonPrimitive)?.content == "true" } ?: false
                ListRow {
                    ControlsRow {
                        Segmented(listOf("yes" to "✓ Correct", "no" to "✗ Has a mistake"), { (it == "yes") == right }, { v ->
                            set(i, if (v == "yes") s.with("correct", JsonPrimitive(true)).without("correction")
                            else s.with("correct", JsonPrimitive(false)).with("correction", s["correction"] ?: JsJson.obj("hanzi" to JsJson.s(""))).with("explanation", s["explanation"] ?: JsJson.s("")))
                        }, Modifier.weight(1f, fill = false))
                    }
                    SentenceEditor(s, { v -> set(i, s.with("hanzi", v["hanzi"]).with("pinyin", v["pinyin"]).with("english", v["english"])) }, speak)
                    if (!right) {
                        Text("CORRECT VERSION", color = Lab.colors.muted, fontSize = 12.sp)
                        SentenceEditor(s["correction"] as? JsonObject ?: JsJson.obj("hanzi" to JsJson.s("")), { v -> set(i, s.with("correction", v)) }, speak)
                    }
                    EdTextField(
                        s.text("explanation"),
                        { v -> set(i, if (right) s.withClean("explanation", v) else s.with("explanation", v)) },
                        placeholder = if (right) "Note (optional, shown after Check)" else "Why it is wrong — one line (required)",
                    )
                    ControlsRow {
                        Spacer(Modifier.weight(1f))
                        RowControls(i, sentences.size, { from, to -> onChange(ex.withObjs("sentences", sentences.moveItem(from, to))) }, { if (sentences.size > 3) onChange(ex.withObjs("sentences", sentences.removeAtIndex(i))) })
                    }
                }
            }
            if (sentences.size < 8) AddButton("Add sentence", { onChange(ex.withObjs("sentences", sentences + JsJson.obj("hanzi" to JsJson.s(""), "correct" to JsonPrimitive(true)))) })
        }
    }
}

@Composable
private fun WordsEditor(words: List<String>, onChange: (List<String>) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        words.forEachIndexed { i, w ->
            ControlsRow {
                EdTextField(w, { onChange(words.replaceAt(i, it)) }, Modifier.weight(1f), placeholder = "Word ${i + 1}")
                if (words.size > 2) MiniButton("✕", { onChange(words.removeAtIndex(i)) }, danger = true, description = "Remove word")
            }
        }
        if (words.size < 4) AddButton("Add word", { onChange(words + "") })
    }
}

@Composable
internal fun GapChoiceForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val items = ex.objs("items")
    val shared = ex["options"]?.let { ex.strings("options") }
    val set = { i: Int, item: JsonObject -> onChange(ex.withObjs("items", items.replaceAt(i, item))) }
    EdField("Instruction", hint = "optional — e.g. 刚 or 刚才?") {
        EdTextField(ex.text("question"), { onChange(ex.withClean("question", it)) }, placeholder = "e.g. 刚 or 刚才?")
    }
    EdField("Words to choose from", hint = "2–4, shared by every sentence (a sentence can have its own)") {
        if (shared != null) {
            WordsEditor(shared) { onChange(ex.withStrings("options", it)) }
            MiniButton("Give each sentence its own words", {
                onChange(ex.without("options").withObjs("items", items.map { it["options"]?.let { _ -> it } ?: it.withStrings("options", shared) }))
            })
        } else {
            AddButton("Shared words", { onChange(ex.withStrings("options", listOf("", ""))) })
        }
    }
    EdField("Sentences", hint = "${items.size}/8 — write the gap as ${JudgeGap.GAP_MARKER}; pinyin / English are for the FULL sentence") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items.forEachIndexed { i, item ->
                val sentence = item.text("sentence")
                val answer = item.text("answer")
                val gaps = JudgeGap.gapCount(sentence)
                val own = item["options"]?.let { item.strings("options") }
                val options = own ?: shared ?: emptyList()
                val full = JudgeGap.fillGap(sentence, answer)
                val ready = JsJson.trim(answer).isNotEmpty() && gaps == 1
                ListRow {
                    EdTextField(sentence, { set(i, item.with("sentence", it)) }, placeholder = "他${JudgeGap.GAP_MARKER}走。")
                    if (gaps != 1) Text("Put exactly one gap ${JudgeGap.GAP_MARKER} in the sentence.", color = Lab.colors.muted, fontSize = 13.sp)
                    if (own != null) WordsEditor(own) { set(i, item.withStrings("options", it)) }
                    val words = options.filter { JsJson.trim(it).isNotEmpty() }
                    if (words.isNotEmpty()) ControlsRow {
                        Segmented(words.map { it to if (it == answer) "✓ $it" else it }, { it == answer }, { set(i, item.with("answer", it)) }, Modifier.weight(1f, fill = false))
                    }
                    if (ready) Text("Full sentence: $full", color = Lab.colors.muted, fontSize = 13.sp)
                    ControlsRow {
                        EdTextField(item.text("pinyin"), { set(i, item.with("pinyin", it.ifEmpty { null })) }, Modifier.weight(1f), placeholder = "pinyin of the full sentence")
                        MiniButton("🔊", { speak(full) }, enabled = ready, description = "Play the full sentence")
                        MiniButton("拼音", { set(i, item.with("pinyin", toPinyin(full))) }, enabled = ready, description = "Fill pinyin from the full sentence")
                    }
                    EdTextField(item.text("english"), { set(i, item.with("english", it.ifEmpty { null })) }, placeholder = "English")
                    EdTextField(item.text("explanation"), { set(i, item.with("explanation", it.ifEmpty { null })) }, placeholder = "Why this word (optional, shown after Check)")
                    ControlsRow {
                        if (own == null) MiniButton("Own words", { set(i, item.withStrings("options", shared ?: listOf("", ""))) })
                        else if (shared != null) MiniButton("Use the shared words", { set(i, item.without("options")) })
                        Spacer(Modifier.weight(1f))
                        RowControls(i, items.size, { from, to -> onChange(ex.withObjs("items", items.moveItem(from, to))) }, { if (items.size > 2) onChange(ex.withObjs("items", items.removeAtIndex(i))) })
                    }
                }
            }
            if (items.size < 8) AddButton("Add sentence", { onChange(ex.withObjs("items", items + JsJson.obj("sentence" to JsJson.s(JudgeGap.GAP_MARKER), "answer" to JsJson.s("")))) })
        }
    }
}

