package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallGoals
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTranscript
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * 🎯 Structures to use in the call (core CallGoals, web components/calls/CallGoalsPanel.tsx): the top-bar chip both
 * people see ("🎯 1/4") and the sheet it opens — each structure big with its line, meaning and the lesson's
 * example (▶), ✓ + what he said when used, "✓ checking…" while the check runs, the near miss; ↑ / ↓ / ✕ for
 * either person, ✓ Tick / Untick for the tutor; "Add a structure" (a pattern like 一…就…).
 */
data class GoalActions(
    val onAction: (CallGoals.Action) -> Unit = {},
    /** Open / close the sheet ([how] = chip | menu). */
    val onOpen: (Boolean, String) -> Unit = { _, _ -> },
    /** ▶ on an example (cache-first practice TTS). */
    val onSpeak: (String) -> Unit = {},
)

/** The chip: nothing until the room has a list. */
@Composable
fun CallGoalsChip(goals: CallGoals.Goals?, flashing: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val label = CallGoals.chipLabel(goals) ?: return
    val done = goals != null && goals.goals.isNotEmpty() && goals.goals.all { it.status == CallGoals.Status.USED }
    val pulse by rememberInfiniteTransition(label = "goals-flash").animateFloat(0f, 1f, infiniteRepeatable(tween(450), RepeatMode.Reverse), label = "goals-pulse")
    val bg by animateColorAsState(
        when {
            flashing -> androidx.compose.ui.graphics.lerp(Color(0xFF16A34A), Color(0x2422C55E), pulse)
            done -> Color(0xFF15803D)
            else -> Color(0x2422C55E)
        },
        label = "goals-bg",
    )
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .border(1.dp, Color(0x6686EFAC), RoundedCornerShape(999.dp))
            .semantics { contentDescription = CallGoals.chipAria(goals) }
            .bouncyClickable(onClick = onClick)
            .testTag("call-goals-chip")
            .heightIn(min = 36.dp)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (done) Color.White else Color(0xFFDCFCE7), fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

/** The sheet's body. */
@Composable
fun ColumnScope.CallGoalsSheet(s: CallState, actions: GoalActions) {
    val goals = s.goals ?: return
    var text by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    val add = {
        val p = CallGoals.parseGoalPattern(text)
        when {
            p == null -> problem = "Type a pattern with its Chinese words, e.g. 一…就… or 除了…还…"
            goals.goals.any { it.name == p.first } -> problem = "That one is already on the list."
            else -> {
                actions.onAction(CallGoals.Action.Add(text))
                text = ""
                problem = null
            }
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 20.dp).testTag("call-goals-sheet"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            if (goals.goals.isNotEmpty()) CallGoals.intro(s.goalsMine, goals.studentName) else CallGoals.emptyText(s.goalsMine, goals.studentName, goals.available),
            color = Lab.colors.muted, fontSize = 14.sp,
        )
        val note = CallGoals.listenNote(s.goalsListen, s.goalsMine)
        if (note != null && goals.goals.isNotEmpty()) Text(
            note, fontSize = 13.sp,
            color = if (s.goalsListen == "listening") Color(0xFF16A34A) else Color(0xFFB45309),
            modifier = Modifier.testTag("call-goals-listen"),
        )
        goals.goals.forEachIndexed { i, g -> GoalCard(g, i, goals.goals.size, s, actions) }
        if (goals.goals.size < CallGoals.GOALS_LIST_MAX) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; problem = null },
                placeholder = { Text(CallGoals.GOALS_ADD_PLACEHOLDER) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { add() }),
                modifier = Modifier.weight(1f).testTag("call-goals-input"),
            )
            Box(
                Modifier.clip(RoundedCornerShape(10.dp)).background(if (text.isBlank()) Lab.colors.muted.copy(alpha = 0.4f) else Lab.colors.accent)
                    .bouncyClickable { if (text.isNotBlank()) add() }.heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 12.dp).testTag("call-goals-add"),
                contentAlignment = Alignment.Center,
            ) { Text("Add", color = Color.White, fontWeight = FontWeight.SemiBold) }
        }
        problem?.let { Text(it, color = Color(0xFFDC2626), fontSize = 13.sp) }
    }
}

@Composable
private fun GoalCard(g: CallGoals.Goal, i: Int, n: Int, s: CallState, actions: GoalActions) {
    val used = g.status == CallGoals.Status.USED
    val border = when (g.status) {
        CallGoals.Status.USED -> Color(0xFF22C55E)
        CallGoals.Status.CHECKING -> Color(0xFFA3E635)
        else -> Lab.colors.muted.copy(alpha = 0.35f)
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (used) Color(0x2622C55E) else Lab.colors.ink.copy(alpha = 0.04f))
            .border(1.dp, border, RoundedCornerShape(12.dp))
            .padding(12.dp)
            .testTag("call-goal-$i"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(24.dp).clip(CircleShape).background(if (used) Color(0xFF22C55E) else Color.Transparent).border(2.dp, border, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text(if (used) "✓" else if (g.status == CallGoals.Status.CHECKING) "…" else "", color = if (used) Color(0xFF052E16) else Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
            Text(g.name, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            if (i > 0) SmallTool("↑", "Move ${g.name} up") { actions.onAction(CallGoals.Action.Move(g.id, i - 1)) }
            if (i < n - 1) SmallTool("↓", "Move ${g.name} down") { actions.onAction(CallGoals.Action.Move(g.id, i + 1)) }
            SmallTool("✕", "Remove ${g.name}") { actions.onAction(CallGoals.Action.Remove(g.id)) }
        }
        g.line?.let { Text(it, color = Lab.colors.ink.copy(alpha = 0.8f), fontSize = 14.sp) }
        g.meaning?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
        g.example?.let { ex ->
            Text(
                "▶ $ex", fontSize = 16.sp, color = Lab.colors.ink,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Lab.colors.ink.copy(alpha = 0.06f)).bouncyClickable { actions.onSpeak(ex) }.padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }
        val hit = g.used
        val checking = g.checking
        val near = g.near
        when {
            used && hit != null -> {
                val at = s.startedAt?.let { st -> if (hit.at >= st) " · ${CallTranscript.formatOffset(hit.at - st)}" else "" } ?: ""
                Text(CallGoals.hitCaption(hit) + at, color = Color(0xFF16A34A), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                if (hit.text.isNotEmpty()) Text("“${hit.text}”", fontSize = 17.sp, color = Lab.colors.ink, modifier = Modifier.testTag("call-goal-hit-$i"))
            }
            g.status == CallGoals.Status.CHECKING && checking != null -> {
                Text(CallGoals.GOAL_CHECKING_LABEL, color = Color(0xFF65A30D), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text("“${checking.text}”", fontSize = 17.sp, color = Lab.colors.ink)
            }
            g.status == CallGoals.Status.NEAR && near != null -> {
                Text("Close — not quite the structure:", color = Color(0xFFB45309), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text("“${near.text}”", fontSize = 17.sp, color = Lab.colors.ink)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(CallGoals.sourceLine(g.source, g.lastMet), color = Lab.colors.muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
            if (s.ticksGoals && !used) Pill(CallGoals.GOAL_TICK_LABEL, Color(0xFF16A34A), "call-goal-tick-$i") { actions.onAction(CallGoals.Action.Tick(g.id)) }
            if (s.ticksGoals && (used || g.status == CallGoals.Status.CHECKING)) Pill(CallGoals.GOAL_UNTICK_LABEL, Lab.colors.muted, "call-goal-untick-$i") { actions.onAction(CallGoals.Action.Untick(g.id)) }
        }
    }
}

@Composable
private fun SmallTool(text: String, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).semantics { contentDescription = label }.bouncyClickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Lab.colors.muted, fontSize = 16.sp) }
}

@Composable
private fun Pill(text: String, color: Color, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.widthIn(min = 64.dp).heightIn(min = 40.dp).clip(RoundedCornerShape(999.dp)).border(1.dp, color, RoundedCornerShape(999.dp))
            .bouncyClickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
}
