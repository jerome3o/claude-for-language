package dev.jeromeswannack.chineselearning.lab.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneCopy
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEngine.ScenarioResult
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneEvent
import dev.jeromeswannack.chineselearning.lab.core.phone.PhoneVocab
import dev.jeromeswannack.chineselearning.lab.core.phone.ScenarioSpec
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorableText

/*
 * The learning aids around the phone (web phone/TaskPanel.tsx; English — they are not part of the
 * simulated UI): the task card (situation, goal in English + Chinese, the facts you need, the goal
 * checklist), the 💡 hint bubble (the next step in English, then the Chinese to look for), and the
 * finish summary (time, hints, mistakes, slips, bonus, the task's words with "+ Card").
 */

private val LEVEL = mapOf("easy" to "Easy", "medium" to "Medium", "hard" to "Hard")
private val TASK_INK = Color(0xFF1F2329)
private val TASK_MUTED = Color(0xFF6B7280)
private val TASK_LINE = Color(0xFFE5E7EB)
private val TASK_ACCENT = Color(0xFF2F7DE1)
private val DONE = Color(0xFF16A34A)

@Composable
fun LevelPill(difficulty: String) {
    val (bg, fg) = when (difficulty) {
        "easy" -> Color(0xFFDCFCE7) to Color(0xFF15803D)
        "medium" -> Color(0xFFFEF3C7) to Color(0xFFB45309)
        else -> Color(0xFFFEE2E2) to Color(0xFFB91C1C)
    }
    Text(LEVEL[difficulty] ?: difficulty, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = fg, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 7.dp, vertical = 2.dp))
}

@Composable
private fun AidButton(label: String, tag: String? = null, primary: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(if (primary) TASK_ACCENT else Color.White).border(1.dp, if (primary) TASK_ACCENT else TASK_LINE, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp).then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (primary) Color.White else TASK_INK, textAlign = TextAlign.Center) }
}

@Composable
private fun GoalLine(mark: String, label: String, done: Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(mark, fontSize = 15.sp, color = if (done) DONE else TASK_MUTED, modifier = Modifier.width(18.dp))
        Text(label, fontSize = 14.sp, color = if (done) DONE else TASK_INK, lineHeight = 20.sp)
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun TaskCard(spec: ScenarioSpec, events: List<PhoneEvent>, inline: Boolean, onClose: (() -> Unit)?, onGiveUp: () -> Unit, onRestart: () -> Unit, onExit: () -> Unit) {
    val states = PhoneEngine.goalStates(spec, events)
    var zh by remember { mutableStateOf(false) }
    Column(
        Modifier.then(if (inline) Modifier.fillMaxWidth() else Modifier.widthIn(max = 420.dp)).clip(RoundedCornerShape(16.dp)).background(Color.White)
            .verticalScroll(rememberScrollState()).padding(16.dp).testTag("phone-task"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LevelPill(spec.difficulty)
            Text(spec.title.en, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = TASK_INK, modifier = Modifier.weight(1f))
            if (onClose != null) Box(Modifier.heightIn(min = 40.dp).widthIn(min = 40.dp).clickable(onClick = onClose).testTag("phone-task-close"), contentAlignment = Alignment.Center) { Text("✕", color = TASK_MUTED, fontSize = 16.sp) }
        }
        Text(spec.situation, fontSize = 14.sp, color = TASK_MUTED, lineHeight = 20.sp)
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFF0F6FF)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Your task", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TASK_ACCENT)
            Text(spec.goal.en, fontSize = 15.sp, color = TASK_INK, lineHeight = 21.sp, modifier = Modifier.testTag("phone-task-goal"))
            Text(if (zh) "Hide the Chinese" else "In Chinese", fontSize = 13.sp, color = TASK_ACCENT, fontWeight = FontWeight.SemiBold, modifier = Modifier.heightIn(min = 32.dp).clickable { zh = !zh }.padding(vertical = 6.dp).testTag("phone-task-zh"))
            if (zh) ExplorableText(spec.goal.zh, source = "phone", fontSize = 16.sp, color = TASK_INK, lineHeight = 24.sp)
        }
        spec.facts?.takeIf { it.isNotEmpty() }?.let { facts ->
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) { for (f in facts) Text("• ${f.en}", fontSize = 13.sp, color = TASK_INK, lineHeight = 19.sp) }
        }
        Column(Modifier.testTag("phone-task-goals")) {
            for (s in states) GoalLine(if (s.done) "✓" else if (s.goal.optional) "☆" else "○", s.goal.label.en, s.done)
        }
        Text("Long-press any Chinese on the phone to look it up. 💡 shows the next step.", fontSize = 12.sp, color = TASK_MUTED, lineHeight = 17.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AidButton("Leave (progress kept)", "phone-exit", onClick = onExit)
            AidButton("Start over", "phone-restart", onClick = onRestart)
            AidButton("I'm done", "phone-give-up", onClick = onGiveUp)
        }
        Text("Apps: " + spec.apps.joinToString(" · ") { "${PhoneCopy.app(it).name} (${PhoneCopy.app(it).kindEn})" }, fontSize = 11.sp, color = TASK_MUTED)
    }
}

@Composable
fun HintBubble(spec: ScenarioSpec, index: Int, canNext: Boolean, onNext: () -> Unit, onClose: () -> Unit) {
    val h = spec.hints.getOrNull(index) ?: return
    Column(
        Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFFFFBEB)).border(1.dp, Color(0xFFFDE68A), RoundedCornerShape(14.dp)).padding(14.dp).testTag("phone-hint"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("💡 Step ${index + 1} of ${spec.hints.size}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF92400E), modifier = Modifier.weight(1f))
            Box(Modifier.heightIn(min = 36.dp).widthIn(min = 36.dp).clickable(onClick = onClose).testTag("phone-hint-close"), contentAlignment = Alignment.Center) { Text("✕", color = TASK_MUTED) }
        }
        Text(h.en, fontSize = 14.sp, color = TASK_INK, lineHeight = 20.sp)
        ExplorableText(h.zh, source = "phone", fontSize = 16.sp, color = TASK_INK, lineHeight = 24.sp)
        if (canNext) AidButton("Next hint", "phone-hint-next", onClick = onNext)
    }
}

@Composable
private fun Stat(value: String, label: String, tag: String? = null, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TASK_INK, modifier = if (tag != null) Modifier.testTag(tag) else Modifier)
        Text(label, fontSize = 12.sp, color = TASK_MUTED)
    }
}

@Composable
fun PhoneSummary(spec: ScenarioSpec, result: ScenarioResult, onAgain: () -> Unit, onList: () -> Unit, onKeepGoing: (() -> Unit)?, onAdd: (PhoneVocab) -> Unit) {
    Box(Modifier.fillMaxSize().background(Color(0x99000000)).clickable(enabled = false) {}.testTag("phone-summary"), contentAlignment = Alignment.Center) {
        Column(
            Modifier.padding(16.dp).widthIn(max = 460.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (result.success) "🎉" else "📋", fontSize = 40.sp)
                Text(if (result.success) "Task complete!" else "Task not finished", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = if (result.success) DONE else TASK_INK, modifier = Modifier.testTag("phone-summary-title"))
                Text(spec.title.en, fontSize = 13.sp, color = TASK_MUTED)
            }
            Row(Modifier.fillMaxWidth()) {
                Stat(PhoneEngine.formatDuration(result.duration_ms), "time", "phone-summary-time", Modifier.weight(1f))
                Stat(result.hints_used.toString(), if (result.hints_used == 1) "hint" else "hints", "phone-summary-hints", Modifier.weight(1f))
                Stat((result.mistakes.size + result.slips).toString(), "slips", null, Modifier.weight(1f))
                if (result.bonus_total > 0) Stat("${result.bonus_done.size}/${result.bonus_total}", "bonus", null, Modifier.weight(1f))
            }
            Column {
                for (g in spec.goals) {
                    val done = g.id in result.goals_done || g.id in result.bonus_done
                    GoalLine(if (done) "✓" else if (g.optional) "☆" else "✗", g.label.en, done)
                }
            }
            if (result.mistakes.isNotEmpty() || result.slips > 0) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFFEF2F2)).padding(12.dp).testTag("phone-summary-mistakes"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("What went wrong", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color(0xFF991B1B))
                    for (m in result.mistakes) Text("• ${m.label.en}（${m.label.zh}）", fontSize = 13.sp, color = TASK_INK, lineHeight = 19.sp)
                    if (result.slips > 0) Text("• ${if (result.slips == 1) "One form or password slip" else "${result.slips} form or password slips"} (a wrong code, a missing field…)", fontSize = 13.sp, color = TASK_INK, lineHeight = 19.sp)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Words from this task", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = TASK_INK)
                for (v in spec.vocab) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("phone-summary-word"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ExplorableText(v.hanzi, source = "phone", fontSize = 18.sp, color = TASK_INK)
                        Column(Modifier.weight(1f)) {
                            Text(v.pinyin, fontSize = 13.sp, color = TASK_INK)
                            Text(v.english, fontSize = 12.sp, color = TASK_MUTED)
                        }
                        AidButton("+ Card", "phone-add-card-${v.hanzi}") { onAdd(v) }
                    }
                }
            }
            SummaryActions(onKeepGoing, onAgain, onList)
        }
    }
}

@Composable
private fun ColumnScope.SummaryActions(onKeepGoing: (() -> Unit)?, onAgain: () -> Unit, onList: () -> Unit) {
    if (onKeepGoing != null) AidButton("Keep using the phone", "phone-keep-going", modifier = Modifier.fillMaxWidth(), onClick = onKeepGoing)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AidButton("Try again", "phone-again", modifier = Modifier.weight(1f), onClick = onAgain)
        AidButton("More tasks", "phone-back-to-list", primary = true, modifier = Modifier.weight(1f), onClick = onList)
    }
}
