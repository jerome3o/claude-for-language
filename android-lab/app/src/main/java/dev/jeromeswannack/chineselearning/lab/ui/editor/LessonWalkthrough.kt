package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.serialization.json.JsonObject

/*
 * A non-scoring walkthrough of a lesson spec, one exercise at a time with ‹ › and a jump list
 * (web: components/editor/LessonPreview.tsx). Used by the editor's Preview, "Try it" and the
 * catalogue trials: nothing is recorded. Word order, choices and matching are playable; the
 * self-assessed types show their prompt and reveal the model answer.
 */

data class FlatExercise(val exercise: JsonObject, val section: Int, val sectionTitle: String?, val sectionStart: Boolean)

fun flattenLesson(spec: JsonObject): List<FlatExercise> = buildList {
    spec.objs("sections").forEachIndexed { si, section ->
        val title = section.str("title")
        section.objs("exercises").forEachIndexed { ei, ex -> add(FlatExercise(ex, si, title, ei == 0 && !title.isNullOrEmpty())) }
    }
}

/** Is the exercise complete enough to render (LessonPreview `renderable`)? */
fun renderable(ex: JsonObject): Boolean = when (ex.str("type")) {
    "scramble" -> ex.strings("tiles").isNotEmpty() && ex.strings("correct_order").isNotEmpty()
    "choice", "listen_choice" -> ex.objs("options").size >= 2 && (ex.int("correct") ?: -1) in ex.objs("options").indices
    "match" -> ex.objs("pairs").size >= 2
    "sentence_making" -> ex.objs("words").isNotEmpty()
    "conversation" -> ex.objs("speakers").size >= 2 && ex.objs("lines").isNotEmpty() && ex.objs("questions").isNotEmpty() &&
        ex.objs("lines").all { (it.int("speaker") ?: -1) in ex.objs("speakers").indices }
    else -> true
}

@Composable
fun LessonWalkthrough(spec: JsonObject, speak: Speak, modifier: Modifier = Modifier, note: String = "Preview — nothing is recorded.", onFinished: (() -> Unit)? = null) {
    val items = remember(spec) { flattenLesson(spec) }
    var idx by rememberSaveable { mutableIntStateOf(0) }
    var attempt by remember { mutableIntStateOf(0) }
    var jumping by remember { mutableStateOf(false) }
    if (items.isEmpty()) {
        Box(modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
            Text("Add an exercise to preview it.", color = Lab.colors.muted)
        }
        return
    }
    val clamped = idx.coerceIn(0, items.size - 1)
    val current = items[clamped]
    fun go(next: Int) { idx = next.coerceIn(0, items.size - 1); attempt++ }

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MiniButton("‹", { go(clamped - 1) }, enabled = clamped > 0, description = "Previous exercise")
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                    .bouncyClickable { jumping = true }.padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    "${clamped + 1}. ${LessonCatalogue.icon(current.exercise.str("type"))} ${LessonCatalogue.name(current.exercise.str("type"))} — ${LessonDiff.primaryText(current.exercise).take(30).ifEmpty { "(empty)" }}",
                    maxLines = 1, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium,
                )
            }
            MiniButton("›", { go(clamped + 1) }, enabled = clamped < items.size - 1, description = "Next exercise")
            MiniButton("↺", { attempt++ }, description = "Restart this exercise")
        }
        Text("$note ${clamped + 1} of ${items.size}", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 20.dp))
        val progress by animateFloatAsState(clamped.toFloat() / items.size, spring(), label = "progress")
        Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.faint)) {
            Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(Lab.colors.accent))
        }
        AnimatedContent(clamped to attempt, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "exercise", modifier = Modifier.weight(1f)) { (i, _) ->
            val item = items[i]
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (item.sectionStart) Text(item.sectionTitle!!, style = MaterialTheme.typography.titleMedium, color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)
                if (!renderable(item.exercise)) {
                    Text("This exercise isn't complete yet — fill in its fields to preview it.", color = Lab.colors.muted)
                } else {
                    ExercisePreview(item.exercise, speak)
                }
                Spacer(Modifier.height(4.dp))
                if (i < items.size - 1) PrimaryPill("Next", Modifier.fillMaxWidth().height(52.dp)) { go(i + 1) }
                else if (onFinished != null) PrimaryPill("Finish", Modifier.fillMaxWidth().height(52.dp), color = Palette.Good) { onFinished() }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
    if (jumping) {
        LabBottomSheet({ jumping = false }, title = "Jump to exercise") {
            items.forEachIndexed { i, it ->
                NavRow(
                    LessonCatalogue.icon(it.exercise.str("type")),
                    "${i + 1}. ${LessonCatalogue.name(it.exercise.str("type"))}",
                    desc = LessonDiff.primaryText(it.exercise).take(60).ifEmpty { "(empty)" },
                    onClick = { jumping = false; go(i) },
                )
            }
        }
    }
}

@Composable
private fun Prompt(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)

@Composable
private fun Instruction(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)

@Composable
private fun SentenceBlock(s: JsonObject, speak: Speak, showPinyin: Boolean = true, showEnglish: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(s.text("hanzi"), fontSize = 22.sp, color = Lab.colors.ink)
            if (showPinyin && s.text("pinyin").isNotEmpty()) Text(s.text("pinyin"), color = Lab.colors.muted)
            if (showEnglish && s.text("english").isNotEmpty()) Text(s.text("english"), color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
        }
        if (s.text("hanzi").isNotBlank()) MiniButton("🔊", { speak(s.text("hanzi")) }, description = "Play")
    }
}

/** "Show answer" → the model answer (self-assessed types). */
@Composable
private fun Reveal(label: String = "Show answer", content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf(false) }
    AnimatedContent(shown, label = "reveal") { s ->
        if (s) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
        else SecondaryPill(label, Modifier.fillMaxWidth().height(48.dp)) { shown = true }
    }
}

@Composable
private fun OptionTile(text: String, state: Boolean?, onClick: () -> Unit, sub: String? = null) {
    val bg by animateColorAsState(
        when (state) { true -> Palette.Good.copy(alpha = 0.18f); false -> Palette.Again.copy(alpha = 0.15f); null -> Lab.colors.card }, label = "opt",
    )
    Column(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(14.dp)).background(bg)
            .border(1.dp, when (state) { true -> Palette.Good; false -> Palette.Again; null -> Lab.colors.cardBorder }, RoundedCornerShape(14.dp))
            .bouncyClickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(text, fontSize = 18.sp, color = Lab.colors.ink)
        if (sub != null) Text(sub, color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExercisePreview(ex: JsonObject, speak: Speak) {
    when (ex.str("type")) {
        "note" -> {
            if (ex.text("title").isNotEmpty()) Text(ex.text("title"), style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
            for (p in ex.text("body").split(Regex("\n{2,}")).filter { it.isNotBlank() }) Text(p, color = Lab.colors.ink, style = MaterialTheme.typography.bodyLarge)
            for (s in ex.objs("sentences")) SentenceBlock(s, speak)
        }
        "scramble" -> {
            Prompt("Put the words in order")
            val order = ex.strings("correct_order")
            val alts = (ex["alt_orders"] as? kotlinx.serialization.json.JsonArray).orEmpty().map { a -> (a as? kotlinx.serialization.json.JsonArray).orEmpty().map { JsJson.str(it) ?: "" } }
            val tiles = remember(ex) { ex.strings("tiles").withIndex().shuffled(java.util.Random(ex.hashCode().toLong())) }
            val placed = remember(ex) { mutableStateListOf<Int>() }
            var checked by remember(ex) { mutableStateOf<Boolean?>(null) }
            var hint by remember(ex) { mutableStateOf(false) }
            Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(10.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in placed) Tile(tiles.first { it.index == i }.value) { placed.remove(i); checked = null }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (t in tiles) if (t.index !in placed) Tile(t.value) { placed.add(t.index); checked = null }
            }
            if (hint) Instruction(ex.text("english")) else SecondaryPill("Show English hint", Modifier.height(44.dp)) { hint = true }
            PrimaryPill("Check", Modifier.fillMaxWidth().height(52.dp), enabled = placed.size == tiles.size) {
                val built = placed.map { i -> tiles.first { it.index == i }.value }
                checked = built == order || alts.any { it == built }
                speak(order.joinToString(""))
            }
            checked?.let { ok ->
                Text(if (ok) "✓ Correct — ${order.joinToString("")}" else "✗ ${order.joinToString("")}", color = if (ok) Palette.Good else Palette.Again, fontWeight = FontWeight.SemiBold)
            }
        }
        "choice", "listen_choice" -> {
            val listen = ex.str("type") == "listen_choice"
            val audio = ex["audio"].asObject()
            if (listen) {
                Prompt(ex.text("question").ifEmpty { "Which one did you hear?" })
                PrimaryPill("🔊 Play", Modifier.height(52.dp)) { speak(audio.text("hanzi")) }
            } else Prompt(ex.text("question"))
            val correct = ex.int("correct") ?: 0
            var picked by remember(ex) { mutableStateOf<Int?>(null) }
            ex.objs("options").forEachIndexed { i, o ->
                val answered = picked != null
                OptionTile(
                    o.text("hanzi"),
                    state = if (!answered) null else if (i == correct) true else if (i == picked) false else null,
                    onClick = { if (picked == null) { picked = i; speak(o.text("hanzi")) } },
                    sub = if (answered) listOf(o.text("pinyin"), o.text("english")).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null } else null,
                )
            }
            if (picked != null) {
                if (listen) SentenceBlock(audio, speak)
                if (ex.text("explanation").isNotEmpty()) Instruction(ex.text("explanation"))
            }
        }
        "translate" -> {
            Instruction("Translate into Chinese")
            Prompt(ex.text("english"))
            Reveal {
                SentenceBlock(JsJson.obj("hanzi" to ex["reference_hanzi"], "pinyin" to ex["reference_pinyin"]), speak)
                if (ex.text("note").isNotEmpty()) Instruction(ex.text("note"))
            }
        }
        "match" -> MatchPreview(ex, speak)
        "describe_image" -> {
            Prompt(ex.text("task").ifEmpty { "Describe the picture in Chinese." })
            val key = ex.str("image_url")
            if (!key.isNullOrEmpty()) EditorImage(key, Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)), description = "Illustration")
            else Box(Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(12.dp), contentAlignment = Alignment.Center) {
                Text("🖼 The illustration is drawn after saving:\n${ex.text("image_prompt")}", color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
            Reveal("Show the reference") { SentenceBlock(JsJson.obj("hanzi" to ex["reference_hanzi"], "pinyin" to ex["reference_pinyin"], "english" to ex["reference_english"]), speak) }
        }
        "speak" -> {
            Instruction("Say it out loud")
            Prompt(ex.text("prompt"))
            (ex["example"] as? JsonObject)?.let { e -> Reveal("Show an example") { SentenceBlock(e, speak) } }
        }
        "listen_translate" -> {
            Instruction("Listen, then translate what you heard into English")
            PrimaryPill("🔊 Play", Modifier.height(52.dp)) { speak(ex["audio"].asObject().text("hanzi")) }
            Reveal {
                SentenceBlock(ex["audio"].asObject(), speak)
                if (ex.text("note").isNotEmpty()) Instruction(ex.text("note"))
            }
        }
        "sentence_making" -> {
            Instruction(if (ex.str("input") == "handwrite") "Make a sentence — write it by hand" else "Make a sentence")
            Prompt(ex.text("task").ifEmpty { "Write your own sentence using these words." })
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (w in ex.objs("words")) Tile(listOf(w.text("hanzi"), w.text("pinyin"), w.text("english")).filter { it.isNotEmpty() }.joinToString(" ")) { speak(w.text("hanzi")) }
            }
            (ex["example"] as? JsonObject)?.let { e -> Reveal("Show an example") { SentenceBlock(e, speak) } }
        }
        "write_typed", "write_handwriting" -> {
            val answer = ex["answer"].asObject()
            val cues = ex.strings("cues").ifEmpty { listOf("english", "pinyin") }
            Instruction(if (ex.str("type") == "write_handwriting") "Write it by hand" else "Type it in characters")
            if (ex.text("prompt").isNotEmpty()) Prompt(ex.text("prompt"))
            if ("english" in cues && answer.text("english").isNotEmpty()) Prompt(answer.text("english"))
            if ("pinyin" in cues && answer.text("pinyin").isNotEmpty()) Text(answer.text("pinyin"), color = Lab.colors.muted, fontSize = 18.sp)
            if ("audio" in cues) SecondaryPill("🔊 Play", Modifier.height(48.dp)) { speak(answer.text("hanzi")) }
            Reveal { SentenceBlock(answer, speak) }
        }
        "dictation" -> {
            Instruction(if (ex.str("input") == "handwrite") "Dictation — write what you hear by hand" else "Dictation — type what you hear")
            PrimaryPill("🔊 Play", Modifier.height(52.dp)) { speak(ex["audio"].asObject().text("hanzi")) }
            Reveal {
                SentenceBlock(ex["audio"].asObject(), speak)
                if (ex.text("note").isNotEmpty()) Instruction(ex.text("note"))
            }
        }
        "oral_expression" -> {
            Instruction("Answer out loud — the learner's answer is recorded for you")
            Prompt(ex.text("prompt"))
            (ex["question_audio"] as? JsonObject)?.let { q -> SentenceBlock(q, speak, showPinyin = false, showEnglish = false) }
            val hints = ex.objs("hints")
            if (hints.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (w in hints) Tile(listOf(w.text("hanzi"), w.text("pinyin")).filter { it.isNotEmpty() }.joinToString(" ")) { speak(w.text("hanzi")) }
            }
            Instruction("About ${ex.int("target_seconds") ?: 30} seconds")
            (ex["example"] as? JsonObject)?.let { e -> Reveal("Show the model answer") { SentenceBlock(e, speak) } }
        }
        "conversation" -> ConversationPreview(ex, speak)
        else -> Instruction("This exercise type can't be previewed here.")
    }
}

@Composable
private fun Tile(text: String, onClick: () -> Unit) {
    Text(
        text, fontSize = 18.sp, color = Lab.colors.ink,
        modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.accentSoft).bouncyClickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

@Composable
private fun MatchPreview(ex: JsonObject, speak: Speak) {
    Prompt("Match each word with its meaning")
    val pairs = ex.objs("pairs")
    val left = remember(ex) { pairs.indices.shuffled(java.util.Random(ex.hashCode().toLong())) }
    val right = remember(ex) { pairs.indices.shuffled(java.util.Random(ex.hashCode().toLong() + 7)) }
    val done = remember(ex) { mutableStateListOf<Int>() }
    var sel by remember(ex) { mutableStateOf<Int?>(null) }
    var wrong by remember(ex) { mutableStateOf<Int?>(null) }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (i in left) OptionTile(pairs[i].text("hanzi"), if (i in done) true else if (sel == i) null else null, {
                if (i !in done) { sel = i; wrong = null; speak(pairs[i].text("hanzi")) }
            }, sub = if (sel == i && i !in done) "selected" else null)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (j in right) OptionTile(pairs[j].text("english"), if (j in done) true else if (wrong == j) false else null, {
                val s = sel ?: return@OptionTile
                if (j == s) { done.add(j); sel = null } else wrong = j
            })
        }
    }
    if (done.size == pairs.size) Text("✓ All matched", color = Palette.Good, fontWeight = FontWeight.SemiBold)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConversationPreview(ex: JsonObject, speak: Speak) {
    val speakers = ex.objs("speakers")
    val lines = ex.objs("lines")
    Instruction("Listen to the conversation, then answer")
    Prompt(ex.text("situation"))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        lines.forEachIndexed { i, l -> Tile("▶ ${i + 1}") { speak(l.text("hanzi")) } }
    }
    ex.objs("questions").forEachIndexed { qi, q ->
        Text("${qi + 1}. ${q.text("question")}", color = Lab.colors.ink, fontWeight = FontWeight.SemiBold)
        val options = q.strings("options")
        if (q["options"] != null) {
            var picked by remember(ex, qi) { mutableStateOf<Int?>(null) }
            val correct = q.int("correct") ?: 0
            options.forEachIndexed { oi, o ->
                OptionTile(o, if (picked == null) null else if (oi == correct) true else if (oi == picked) false else null, { if (picked == null) picked = oi })
            }
        } else Reveal("Show the answer") { Instruction(q.text("answer")) }
    }
    Reveal("Show the transcript") {
        for (l in lines) {
            val name = speakers.getOrNull(l.int("speaker") ?: -1)?.text("name").orEmpty()
            Text(name, color = Lab.colors.muted, style = MaterialTheme.typography.labelMedium)
            SentenceBlock(l, speak)
        }
    }
}

@Suppress("unused")
private val Transparent = Color.Transparent
