package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonValidator
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.core.spec.without
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * One form per exercise type (web: components/editor/ExerciseForm.tsx). Each edits the
 * exercise immutably through [onChange]; the validator's problems show under it.
 */

private fun blankSentence() = JsJson.obj("hanzi" to JsJson.s(""))

private fun splitTiles(text: String): List<String> = text.split(Regex("[\\s|/]+")).map { JsJson.trim(it) }.filter { it.isNotEmpty() }

private fun sameMultiset(a: List<String>, b: List<String>): Boolean = a.size == b.size && a.groupingBy { it }.eachCount() == b.groupingBy { it }.eachCount()

@Composable
fun ExerciseForm(exercise: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak, errors: List<String>) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        when (exercise.str("type")) {
            "note" -> NoteForm(exercise, onChange, speak)
            "scramble" -> ScrambleForm(exercise, onChange, speak)
            "choice" -> ChoiceForm(exercise, onChange, speak, listen = false)
            "translate" -> TranslateForm(exercise, onChange, speak)
            "match" -> MatchForm(exercise, onChange, speak)
            "describe_image" -> DescribeImageForm(exercise, onChange, speak)
            "speak" -> SpeakForm(exercise, onChange, speak)
            "listen_choice" -> ChoiceForm(exercise, onChange, speak, listen = true)
            "listen_translate" -> ListenTranslateForm(exercise, onChange, speak)
            "sentence_making" -> SentenceMakingForm(exercise, onChange, speak)
            "write_typed", "write_handwriting" -> WriteForm(exercise, onChange, speak)
            "dictation" -> DictationForm(exercise, onChange, speak)
            "oral_expression" -> OralExpressionForm(exercise, onChange, speak)
            "conversation" -> ConversationForm(exercise, onChange, speak)
            else -> Text("This exercise type isn't known to the editor — use Advanced → Raw JSON.", color = Lab.colors.muted)
        }
        ErrorList(errors)
    }
}

// ---------------- sentence lists ----------------

/** Rows of sentences with ▲▼✕ and, for choices, the ✓ radio (keeps "correct" pointing at the same option). */
@Composable
private fun SentenceList(
    items: List<JsonObject>,
    onChange: (List<JsonObject>) -> Unit,
    speak: Speak,
    addLabel: String,
    max: Int? = null,
    min: Int = 0,
    correct: Int? = null,
    onCorrect: ((Int) -> Unit)? = null,
    onBoth: ((List<JsonObject>, Int) -> Unit)? = null,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEachIndexed { i, s ->
            ListRow(correct = onCorrect != null && correct == i) {
                ControlsRow {
                    if (onCorrect != null) CorrectMark(correct == i) { onCorrect(i) }
                    androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                    RowControls(
                        i, items.size,
                        onMove = { from, to ->
                            if (to < 0 || to >= items.size) return@RowControls
                            val next = items.moveItem(from, to)
                            if (onBoth != null && correct != null) onBoth(next, if (correct == from) to else if (correct == to) from else correct) else onChange(next)
                        },
                        onRemove = {
                            if (items.size <= min) return@RowControls
                            val next = items.removeAtIndex(i)
                            if (onBoth != null && correct != null) onBoth(next, if (correct == i) 0 else if (correct > i) correct - 1 else correct) else onChange(next)
                        },
                    )
                }
                SentenceEditor(s, { v -> onChange(items.replaceAt(i, v)) }, speak)
            }
        }
        if (max == null || items.size < max) AddButton(addLabel, { onChange(items + blankSentence()) })
    }
}

/** hanzi / pinyin / meaning rows (match pairs, target words, hints). */
@Composable
private fun WordRows(items: List<JsonObject>, onChange: (List<JsonObject>) -> Unit, speak: Speak, addLabel: String, max: Int, min: Int, placeholder: String, englishKey: String = "english", blank: () -> JsonObject) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEachIndexed { i, w ->
            ListRow {
                HanziInput(w.text("hanzi"), { onChange(items.replaceAt(i, w.with("hanzi", it))) }, speak, onPinyin = { onChange(items.replaceAt(i, w.with("pinyin", it))) }, placeholder = placeholder)
                EdTextField(w.text("pinyin"), { onChange(items.replaceAt(i, w.with("pinyin", it.ifEmpty { null }))) }, placeholder = "pinyin")
                EdTextField(w.text(englishKey), { v ->
                    // A match pair's english is required (kept as ""); a word's is optional.
                    onChange(items.replaceAt(i, if (englishKey == "english" && blank().containsKey("english")) w.with("english", v) else w.with("english", v.ifEmpty { null })))
                }, placeholder = "meaning")
                ControlsRow {
                    androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                    RowControls(i, items.size, onMove = { from, to -> onChange(items.moveItem(from, to)) }, onRemove = { if (items.size > min) onChange(items.removeAtIndex(i)) })
                }
            }
        }
        if (items.size < max) AddButton(addLabel, { onChange(items + blank()) })
    }
}

@Composable
private fun OptionalSentence(value: JsonObject?, onChange: (JsonObject?) -> Unit, speak: Speak, addLabel: String) {
    if (value == null) {
        AddButton(addLabel, { onChange(blankSentence()) })
    } else {
        ListRow {
            SentenceEditor(value, onChange, speak)
            ControlsRow {
                androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                MiniButton("✕", { onChange(null) }, danger = true, description = "Remove")
            }
        }
    }
}

// ---------------- per-type forms ----------------

@Composable
private fun NoteForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("Title", hint = "optional") { EdTextField(ex.text("title"), { onChange(ex.withClean("title", it)) }, placeholder = "e.g. The 把 pattern") }
    EdField("Teaching text", hint = "blank line = new paragraph") {
        EdTextField(ex.text("body"), { onChange(ex.withClean("body", it)) }, placeholder = "Explain the point in a few sentences…", singleLine = false, minLines = 4)
    }
    EdField("Example sentences") { SentenceList(ex.objs("sentences"), { onChange(ex.withObjs("sentences", it)) }, speak, "Add sentence") }
}

@Composable
private fun ScrambleForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val order = ex.strings("correct_order")
    val tiles = ex.strings("tiles")
    var orderText by remember { mutableStateOf(order.joinToString(" ")) }
    var altText by remember { mutableStateOf(ex.objs("alt_orders").let { (ex["alt_orders"] as? JsonArray).orEmpty().joinToString("\n") { a -> (a as? JsonArray).orEmpty().joinToString(" ") { JsJson.str(it) ?: "" } } }) }
    val tilesMatch = sameMultiset(tiles, order)

    EdField("English meaning") { EdTextField(ex.text("english"), { onChange(ex.with("english", it)) }, placeholder = "I want a cup of coffee") }
    EdField("Correct order", hint = "separate tiles with spaces") {
        ControlsRow {
            EdTextField(orderText, { text ->
                orderText = text
                val next = splitTiles(text)
                // Tiles follow the order unless hand-edited into a different multiset.
                val newTiles = if (tilesMatch || tiles.isEmpty()) next else tiles
                onChange(ex.withStrings("correct_order", next).withStrings("tiles", newTiles))
            }, Modifier.weight(1f), placeholder = "我 要 一杯 咖啡", chinese = true)
            MiniButton("🔊", { speak(order.joinToString("")) }, enabled = order.isNotEmpty(), description = "Play")
        }
    }
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (t in tiles) Text(t, color = Lab.colors.ink, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Lab.colors.accentSoft).padding(horizontal = 10.dp, vertical = 6.dp))
        if (tiles.isEmpty()) Text("No tiles yet — type the correct order above.", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
    }
    if (!tilesMatch && tiles.isNotEmpty()) MiniButton("Reset tiles from correct order", { onChange(ex.withStrings("tiles", order)) })
    EdField("Other accepted orders", hint = "optional, one per line") {
        EdTextField(altText, { text ->
            altText = text
            val alt = text.split("\n").map(::splitTiles).filter { it.isNotEmpty() }
            onChange(ex.with("alt_orders", if (alt.isEmpty()) null else JsonArray(alt.map { a -> JsonArray(a.map { JsonPrimitive(it) }) })))
        }, placeholder = "我 要 咖啡 一杯", singleLine = false, minLines = 2, chinese = true)
    }
}

@Composable
private fun ChoiceForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak, listen: Boolean) {
    if (listen) {
        EdField("What is played", hint = "hidden until answered") { SentenceEditor(ex["audio"].asObject(), { onChange(ex.with("audio", it)) }, speak) }
        EdField("Question", hint = "optional") { EdTextField(ex.text("question"), { onChange(ex.withClean("question", it)) }, placeholder = "Which word did you hear?") }
    } else {
        EdField("Question or situation") { EdTextField(ex.text("question"), { onChange(ex.with("question", it)) }, placeholder = "Your friend looks tired. What do you say?") }
    }
    EdField("Options", hint = "tick the correct one") {
        SentenceList(
            ex.objs("options"), { onChange(ex.withObjs("options", it)) }, speak, "Add option", max = 5, min = 2,
            correct = ex.int("correct") ?: 0,
            onCorrect = { onChange(ex.withInt("correct", it)) },
            onBoth = { list, c -> onChange(ex.withObjs("options", list).withInt("correct", c)) },
        )
    }
    EdField("Explanation", hint = "shown after answering") { EdTextField(ex.text("explanation"), { onChange(ex.withClean("explanation", it)) }) }
}

@Composable
private fun TranslateForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("English to translate") { EdTextField(ex.text("english"), { onChange(ex.with("english", it)) }, placeholder = "Two coffees, please") }
    EdField("Reference answer (Chinese)") { HanziInput(ex.text("reference_hanzi"), { onChange(ex.with("reference_hanzi", it)) }, speak, onPinyin = { onChange(ex.with("reference_pinyin", it)) }) }
    EdField("Reference pinyin") { EdTextField(ex.text("reference_pinyin"), { onChange(ex.withClean("reference_pinyin", it)) }, placeholder = "qǐng gěi wǒ liǎng bēi kāfēi") }
    EdField("Note", hint = "optional guidance shown with the answer") { EdTextField(ex.text("note"), { onChange(ex.withClean("note", it)) }, placeholder = "Different wording is fine") }
}

@Composable
private fun MatchForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("Pairs", hint = "2–8, no duplicates") {
        WordRows(ex.objs("pairs"), { onChange(ex.withObjs("pairs", it)) }, speak, "Add pair", max = 8, min = 2, placeholder = "汉字") {
            JsJson.obj("hanzi" to JsJson.s(""), "english" to JsJson.s(""))
        }
    }
}

@Composable
private fun DescribeImageForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val key = ex.str("image_url")
    if (!key.isNullOrEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            EditorImage(key, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), description = "Generated illustration")
            Text("Changing the scene description generates a new picture on save.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
    EdField("Scene for the illustration", hint = "English, detailed, no text in the image") {
        EdTextField(ex.text("image_prompt"), { onChange(ex.with("image_prompt", it)) }, placeholder = "A woman ordering coffee at a busy café counter, morning light…", singleLine = false, minLines = 3)
    }
    EdField("Task", hint = "optional") { EdTextField(ex.text("task"), { onChange(ex.withClean("task", it)) }, placeholder = "Describe what the woman is doing.") }
    EdField("Reference description (Chinese)") { HanziInput(ex.text("reference_hanzi"), { onChange(ex.with("reference_hanzi", it)) }, speak, onPinyin = { onChange(ex.with("reference_pinyin", it)) }) }
    EdField("Reference pinyin") { EdTextField(ex.text("reference_pinyin"), { onChange(ex.withClean("reference_pinyin", it)) }) }
    EdField("Reference English") { EdTextField(ex.text("reference_english"), { onChange(ex.withClean("reference_english", it)) }) }
}

@Composable
private fun SpeakForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("What to say") { EdTextField(ex.text("prompt"), { onChange(ex.with("prompt", it)) }, placeholder = "Order two coffees, one iced.") }
    EdField("Example answer", hint = "optional, shown afterwards") {
        OptionalSentence(ex["example"] as? JsonObject, { onChange(ex.with("example", it)) }, speak, "Add example")
    }
}

@Composable
private fun ListenTranslateForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("What is played", hint = "English is the answer (required)") { SentenceEditor(ex["audio"].asObject(), { onChange(ex.with("audio", it)) }, speak, englishRequired = true) }
    EdField("Note", hint = "optional guidance shown with the answer") { EdTextField(ex.text("note"), { onChange(ex.withClean("note", it)) }) }
}

@Composable
private fun InputModeToggle(ex: JsonObject, onChange: (JsonObject) -> Unit) {
    val mode = ex.str("input") ?: "type"
    Segmented(listOf("type" to "⌨️ Typed", "handwrite" to "✍️ Handwritten"), { it == mode }, { onChange(ex.with("input", it)) })
}

@Composable
private fun AlternativesField(ex: JsonObject, onChange: (JsonObject) -> Unit) {
    var text by remember { mutableStateOf(ex.strings("alternatives").joinToString("\n")) }
    EdField("Also accept", hint = "optional, one per line") {
        EdTextField(text, { v ->
            text = v
            val list = v.split("\n").map { JsJson.trim(it) }.filter { it.isNotEmpty() }
            onChange(ex.withStrings("alternatives", list.ifEmpty { null }))
        }, singleLine = false, minLines = 2, chinese = true)
    }
}

@Composable
private fun SentenceMakingForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("Target words", hint = "1–4, the sentence must use all of them") {
        WordRows(ex.objs("words"), { onChange(ex.withObjs("words", it)) }, speak, "Add word", max = 4, min = 1, placeholder = "词语") { blankSentence() }
    }
    EdField("Task / situation", hint = "optional") { EdTextField(ex.text("task"), { onChange(ex.withClean("task", it)) }, placeholder = "Explain why you were late today.") }
    EdField("The learner writes by") { InputModeToggle(ex, onChange) }
    EdField("Example answer", hint = "optional, shown afterwards") { OptionalSentence(ex["example"] as? JsonObject, { onChange(ex.with("example", it)) }, speak, "Add example") }
}

private val CUE_LABELS = listOf("english" to "English", "pinyin" to "Pinyin", "audio" to "🔊 Audio")

@Composable
private fun WriteForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val handwriting = ex.str("type") == "write_handwriting"
    val answer = ex["answer"].asObject()
    val chars = LessonValidator.hanCount(answer.text("hanzi"))
    EdField("What to write", hint = if (handwriting) "$chars/12 characters — a word or short phrase" else "hanzi is the answer; English / pinyin are the cues") {
        SentenceEditor(answer, { onChange(ex.with("answer", it)) }, speak)
    }
    val cues = (ex["cues"] as? JsonArray)?.mapNotNull { JsJson.str(it) } ?: listOf("english", "pinyin")
    EdField("Show as the cue") {
        Segmented(CUE_LABELS, { it in cues }, { c ->
            val next = if (c in cues) cues - c else cues + c
            onChange(ex.withStrings("cues", next.ifEmpty { cues }))
        })
    }
    EdField("Instruction", hint = "optional") { EdTextField(ex.text("prompt"), { onChange(ex.withClean("prompt", it)) }, placeholder = "Where do you borrow books?") }
    if (!handwriting) AlternativesField(ex, onChange)
}

@Composable
private fun DictationForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("What is played", hint = "the hanzi is the answer") { SentenceEditor(ex["audio"].asObject(), { onChange(ex.with("audio", it)) }, speak) }
    EdField("The learner writes by") { InputModeToggle(ex, onChange) }
    if (ex.str("input") != "handwrite") AlternativesField(ex, onChange)
    EdField("Note", hint = "optional, shown with the answer") { EdTextField(ex.text("note"), { onChange(ex.withClean("note", it)) }) }
}

@Composable
private fun OralExpressionForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    EdField("What to talk about") { EdTextField(ex.text("prompt"), { onChange(ex.with("prompt", it)) }, placeholder = "Talk about what you did last weekend.", singleLine = false, minLines = 2) }
    EdField("Question played in Chinese", hint = "optional") { OptionalSentence(ex["question_audio"] as? JsonObject, { onChange(ex.with("question_audio", it)) }, speak, "Add a spoken question") }
    EdField("Useful words", hint = "optional, up to 8") {
        WordRows(ex.objs("hints"), { onChange(ex.with("hints", if (it.isEmpty()) null else JsonArray(it))) }, speak, "Add word", max = 8, min = 0, placeholder = "词语") { blankSentence() }
    }
    EdField("Model answer", hint = "optional, shown after recording") { OptionalSentence(ex["example"] as? JsonObject, { onChange(ex.with("example", it)) }, speak, "Add model answer") }
    EdField("About how long", hint = "seconds") {
        val v = ex.int("target_seconds")
        EdTextField(v?.toString() ?: "", { t -> onChange(ex.withInt("target_seconds", t.filter(Char::isDigit).take(4).toIntOrNull())) }, placeholder = "30", number = true)
    }
}

@Composable
private fun ConversationForm(ex: JsonObject, onChange: (JsonObject) -> Unit, speak: Speak) {
    val speakers = ex.objs("speakers")
    val lines = ex.objs("lines")
    val questions = ex.objs("questions")

    EdField("Situation", hint = "shown before listening") { EdTextField(ex.text("situation"), { onChange(ex.with("situation", it)) }, placeholder = "Checking in at a hotel") }
    EdField("Speakers", hint = "each gets a different voice") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            speakers.forEachIndexed { i, s ->
                ListRow {
                    EdTextField(s.text("name"), { onChange(ex.withObjs("speakers", speakers.replaceAt(i, s.with("name", it)))) }, placeholder = if (i == 0) "前台 Receptionist" else "客人 Guest")
                    ControlsRow {
                        val voice = s.str("voice") ?: if (i % 2 == 0) "female" else "male"
                        Segmented(listOf("female" to "👩 Female", "male" to "👨 Male"), { it == voice }, { v -> onChange(ex.withObjs("speakers", speakers.replaceAt(i, s.with("voice", v)))) })
                        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                        if (speakers.size > 2) MiniButton("✕", {
                            onChange(
                                ex.withObjs("speakers", speakers.removeAtIndex(i))
                                    .withObjs("lines", lines.filter { it.int("speaker") != i }.map { l -> val sp = l.int("speaker") ?: 0; if (sp > i) l.withInt("speaker", sp - 1) else l }),
                            )
                        }, danger = true, description = "Remove speaker")
                    }
                }
            }
            if (speakers.size < 3) AddButton("Add speaker", { onChange(ex.withObjs("speakers", speakers + JsJson.obj("name" to JsJson.s(""), "voice" to JsJson.s("female")))) })
        }
    }
    EdField("Lines", hint = "${lines.size}/24 — the learner hears these, text hidden") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            lines.forEachIndexed { i, line ->
                ListRow {
                    ControlsRow {
                        Segmented(
                            speakers.mapIndexed { j, s -> j.toString() to (s.text("name").ifEmpty { "Speaker ${j + 1}" }).take(14) },
                            { it == (line.int("speaker") ?: 0).toString() },
                            { onChange(ex.withObjs("lines", lines.replaceAt(i, line.withInt("speaker", it.toInt())))) },
                            Modifier.weight(1f, fill = false),
                        )
                    }
                    SentenceEditor(line, { v ->
                        val next = line.with("hanzi", v["hanzi"]).with("pinyin", v["pinyin"]).with("english", v["english"])
                        onChange(ex.withObjs("lines", lines.replaceAt(i, next)))
                    }, speak)
                    ControlsRow {
                        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                        RowControls(i, lines.size, { from, to -> onChange(ex.withObjs("lines", lines.moveItem(from, to))) }, { if (lines.size > 2) onChange(ex.withObjs("lines", lines.removeAtIndex(i))) })
                    }
                }
            }
            if (lines.size < 24) AddButton("Add line", {
                val last = lines.lastOrNull()
                val speaker = if (last != null) ((last.int("speaker") ?: 0) + 1) % maxOf(1, speakers.size) else 0
                onChange(ex.withObjs("lines", lines + JsJson.obj("speaker" to JsonPrimitive(speaker), "hanzi" to JsJson.s(""))))
            })
        }
    }
    EdField("Comprehension questions", hint = "1–6, one point each") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            questions.forEachIndexed { i, q ->
                val setQ = { nq: JsonObject -> onChange(ex.withObjs("questions", questions.replaceAt(i, nq))) }
                val choice = q["options"] != null
                ListRow {
                    EdTextField(q.text("question"), { setQ(q.with("question", it)) }, placeholder = "How many nights is the guest staying?")
                    ControlsRow {
                        Segmented(listOf("mc" to "Multiple choice", "free" to "Free answer"), { (it == "mc") == choice }, { mode ->
                            val base = JsJson.obj("question" to q["question"], "explanation" to q["explanation"])
                            setQ(
                                if (mode == "mc") base.with("options", q["options"] ?: JsonArray(listOf(JsJson.s(""), JsJson.s("")))).with("correct", q["correct"] ?: JsonPrimitive(0))
                                else base.with("answer", q["answer"] ?: JsJson.s("")),
                            )
                        }, Modifier.weight(1f, fill = false))
                    }
                    if (choice) {
                        val options = q.strings("options")
                        val correct = q.int("correct")
                        options.forEachIndexed { oi, o ->
                            ControlsRow {
                                CorrectMark(correct == oi) { setQ(q.withInt("correct", oi)) }
                                EdTextField(o, { v -> setQ(q.withStrings("options", options.replaceAt(oi, v))) }, Modifier.weight(1f), placeholder = "Option ${oi + 1}")
                                if (options.size > 2) MiniButton("✕", {
                                    val c = correct ?: 0
                                    setQ(q.withStrings("options", options.removeAtIndex(oi)).withInt("correct", if (c == oi) 0 else if (c > oi) c - 1 else c))
                                }, danger = true, description = "Remove option")
                            }
                        }
                        if (options.size < 5) AddButton("Add option", { setQ(q.withStrings("options", options + "")) })
                    } else {
                        EdTextField(q.text("answer"), { setQ(q.with("answer", it)) }, placeholder = "Model answer (the learner checks theirs against it)")
                    }
                    EdTextField(q.text("explanation"), { setQ(q.with("explanation", it.ifEmpty { null })) }, placeholder = "Explanation (optional, shown after answering)")
                    ControlsRow {
                        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                        RowControls(i, questions.size, { from, to -> onChange(ex.withObjs("questions", questions.moveItem(from, to))) }, { if (questions.size > 1) onChange(ex.withObjs("questions", questions.removeAtIndex(i))) })
                    }
                }
            }
            if (questions.size < 6) AddButton("Add question", {
                onChange(ex.withObjs("questions", questions + JsJson.obj("question" to JsJson.s(""), "options" to JsonArray(listOf(JsJson.s(""), JsJson.s(""))), "correct" to JsonPrimitive(0))))
            })
        }
    }
}

/** For `without` users elsewhere in the package. */
internal fun JsonObject.dropImage(): JsonObject = without("image_url")
