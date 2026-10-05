package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityAction
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityKinds
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivityPhases
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySession
import dev.jeromeswannack.chineselearning.lab.core.calls.ActivitySpec
import dev.jeromeswannack.chineselearning.lab.core.calls.CallActivities
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** A moment the activity tile wants felt (haptics + the Sounds fx, wired in CallRoute). */
enum class ActivityFeel { TICK, CORRECT, WRONG, DONE }

/** What the activity tile does (CallController's activity actions). */
data class ActivityActions(
    /** Act in the running session (the room runs the engine). */
    val act: (ActivityAction) -> Unit = {},
    /** ✕ — close it for both (its result is kept with the lesson). */
    val close: () -> Unit = {},
    /** Say a Chinese line on this device only (a dialogue line, a phrase, the answerer's replay). */
    val speak: (String) -> Unit = {},
    val feel: (ActivityFeel) -> Unit = {},
)

/** The room the activity tile leaves at its top for the faces box in a top corner (render-only, like the web's CallTiles). */
val LocalActivityInsetTop = compositionLocalOf { 0.dp }

/** TILE_HEADER.activity: the tile's header row; in a top corner the faces box sits below it. */
private val HEADER = 48.dp

private val Right = Palette.Good
private val Wrong = Palette.Again

/** Screenshots: render the tile as a solo player would after "Viewing as B" (null = the default). */
data class ActivityUiSeed(val viewAs: String? = null, val pickerOpen: Boolean = false, val cellSheet: String? = null, val hostMenu: Boolean = false)

/**
 * The in-call activity on the stage (web components/calls/ActivityTile.tsx): the room's session,
 * drawn from [me]'s side. Every control shows only when the engine would accept it from me
 * (`reduce(session, action, me) != null`), so the buttons always follow the rules exactly.
 */
@Composable
fun ActivityTile(
    s: ActivitySession,
    me: String,
    actions: ActivityActions,
    modifier: Modifier = Modifier,
    topInset: Dp = 0.dp,
    endInset: Dp = 0.dp,
    compact: Boolean = false,
    seed: ActivityUiSeed = ActivityUiSeed(),
    /** The tutor's "Show for student", in the header before ✕. */
    headerAction: (@Composable () -> Unit)? = null,
) {
    val mine = CallActivities.rolesOf(s, me)
    val solo = mine.size == 2
    var viewAs by rememberSaveable(s.sessionId) { mutableStateOf(seed.viewAs ?: s.spec.tutorRole) }
    // The role whose screen I see: mine; both in a solo call (switchable); a stranger sees B's.
    val role = when {
        solo -> viewAs
        mine.isNotEmpty() -> mine.first()
        else -> "b"
    }
    val v = ActivityView(s, me, role, actions)

    // Feel the reveals and the end (both devices), never on first sight.
    var seen by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(s.sessionId, s.round, s.phase) {
        val key = "${s.sessionId}:${s.round}:${s.phase}"
        val first = seen == null
        seen = key
        if (first) return@LaunchedEffect
        when (s.phase) {
            ActivityPhases.REVEAL -> when (s.results.firstOrNull { it.round == s.round }?.correct) {
                true -> actions.feel(ActivityFeel.CORRECT)
                false -> actions.feel(ActivityFeel.WRONG)
                null -> actions.feel(ActivityFeel.TICK)
            }
            ActivityPhases.DONE -> actions.feel(ActivityFeel.DONE)
        }
    }

    if (compact) {
        Column(modifier.fillMaxSize().background(Lab.colors.background).padding(10.dp), verticalArrangement = Arrangement.Center) {
            Text("${CallActivities.KIND_INFO[s.spec.kind]?.icon ?: "🎲"} ${s.spec.title}", color = Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(progressLabel(s), color = Lab.colors.muted, fontSize = 12.sp)
        }
        return
    }

    Column(modifier.fillMaxSize().background(Lab.colors.background).testTag("activity-tile")) {
        ActivityHeader(v, solo, onViewAs = { viewAs = it; actions.feel(ActivityFeel.TICK) }, endInset = endInset, initialMenu = seed.hostMenu, action = headerAction)
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val wide = maxWidth >= 600.dp
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = topInset).padding(horizontal = if (wide) 32.dp else 16.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.widthIn(max = 640.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    AnimatedContent(
                        targetState = Triple(s.sessionId, s.round, s.phase == ActivityPhases.DONE),
                        transitionSpec = { (fadeIn() + scaleIn(spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow), initialScale = 0.96f)) togetherWith fadeOut() },
                        label = "activity-round",
                    ) { _ ->
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (s.phase == ActivityPhases.DONE) DoneBody(v)
                            else when (s.spec.kind) {
                                ActivityKinds.DESCRIBE -> DescribeBody(v)
                                ActivityKinds.INFO_GAP -> InfoGapBody(v, seed.cellSheet)
                                ActivityKinds.ROLEPLAY -> RoleplayBody(v)
                                ActivityKinds.BUILD -> BuildBody(v)
                                ActivityKinds.QUIZ -> QuizBody(v)
                                ActivityKinds.DICTATION -> DictationBody(v)
                                else -> UnknownBody(v)
                            }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

/** Everything a body needs: the session, whose view it is, and what I may do. */
private class ActivityView(val s: ActivitySession, val me: String, val role: String, val actions: ActivityActions) {
    val spec: ActivitySpec get() = s.spec
    val other: String get() = CallActivities.otherRole(role)
    val phase: String get() = s.phase
    /** The engine would take [a] from me now. */
    fun can(a: ActivityAction): Boolean = CallActivities.reduce(s, a, me, 0) != null
    fun act(a: ActivityAction, feel: ActivityFeel? = ActivityFeel.TICK) {
        feel?.let(actions.feel)
        actions.act(a)
    }
    fun name(role: String): String = firstName(s.names[s.roles.of(role)] ?: "Someone")
    /** The other person's name — "your partner" in a solo call (I'm both). */
    fun otherName(): String = if (s.roles.a == s.roles.b) "your partner" else name(other)
    val result get() = s.results.firstOrNull { it.round == s.round }
}

private fun firstName(n: String) = n.trim().substringBefore(' ').ifEmpty { n }

private fun progressLabel(s: ActivitySession): String {
    val total = CallActivities.totalRounds(s.spec)
    if (s.phase == ActivityPhases.DONE) return "Finished"
    return when (s.spec.kind) {
        ActivityKinds.ROLEPLAY -> "Line ${s.round + 1} / $total"
        ActivityKinds.INFO_GAP -> if (s.phase == ActivityPhases.REVEAL) "Checked" else "Fill in the table"
        else -> "Round ${s.round + 1} / $total"
    }
}

// ------------------------------------------------------------------ header

@Composable
private fun ActivityHeader(v: ActivityView, solo: Boolean, onViewAs: (String) -> Unit, endInset: Dp, initialMenu: Boolean, action: (@Composable () -> Unit)? = null) {
    val s = v.s
    val info = CallActivities.KIND_INFO[s.spec.kind]
    val score = CallActivities.scoreOf(s)
    var menu by remember { mutableStateOf(initialMenu) }
    val controls = listOf(
        ActivityAction.Skip to "⏭ Skip this round",
        ActivityAction.ResetRound to "↺ Reset the round",
        ActivityAction.SwapRoles to "⇄ Swap roles",
        ActivityAction.Restart to "⟲ Start again",
        ActivityAction.Finish to "🏁 End the activity",
    ).filter { (a, _) -> v.can(a) }
    Row(
        Modifier.fillMaxWidth().height(HEADER).background(Lab.colors.card).padding(start = 12.dp, end = 4.dp + endInset),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(info?.icon ?: "🎲", fontSize = 20.sp)
        Column(Modifier.weight(1f)) {
            Text(s.spec.title, color = Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(progressLabel(s), color = Lab.colors.muted, fontSize = 11.sp, maxLines = 1)
        }
        if (score.scored > 0) Pill("✓ ${score.correct}/${score.scored}", if (score.correct > 0) Right.copy(alpha = 0.14f) else Lab.colors.faint, if (score.correct > 0) Right else Lab.colors.muted)
        if (solo) RoleSwitch(v, onViewAs)
        else if (CallActivities.rolesOf(s, v.me).isNotEmpty()) Pill("You: ${s.spec.roleNames.of(v.role)}", Lab.colors.accentSoft, Lab.colors.accent, Modifier.widthIn(max = 150.dp))
        if (controls.isNotEmpty()) Box {
            HeaderButton("⋯", "Activity menu") { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                controls.forEach { (a, label) ->
                    DropdownMenuItem(text = { Text(label, fontSize = 15.sp) }, onClick = { menu = false; v.act(a) }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
        action?.invoke()
        HeaderButton("✕", "Close the activity") { v.actions.feel(ActivityFeel.TICK); v.actions.close() }
    }
}

@Composable
private fun RoleSwitch(v: ActivityView, onViewAs: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(10.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(10.dp)).semantics { contentDescription = "Viewing as" }) {
        listOf("a", "b").forEach { r ->
            val on = v.role == r
            Box(
                Modifier.heightIn(min = 36.dp).background(if (on) Lab.colors.accent else Color.Transparent).bouncyClickable { onViewAs(r) }.padding(horizontal = 10.dp).testTag("view-as-$r"),
                contentAlignment = Alignment.Center,
            ) { Text(if (r == "a") "A" else "B", color = if (on) Color.White else Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
        }
    }
}

@Composable
private fun HeaderButton(label: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).bouncyClickable(onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.ink, fontSize = 18.sp) }
}

@Composable
private fun Pill(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) {
    Text(
        text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 9.dp, vertical = 4.dp),
    )
}

// ------------------------------------------------------------------ shared pieces

@Composable
private fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center, modifier = modifier.fillMaxWidth())
}

@Composable
private fun Waiting(text: String) {
    val pulse by animateFloatAsState(1f, label = "waiting")
    Row(Modifier.alpha(pulse).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("⏳", fontSize = 16.sp)
        Text(text, color = Lab.colors.muted, fontSize = 15.sp, fontStyle = FontStyle.Italic)
    }
}

@Composable
private fun Card(modifier: Modifier = Modifier, border: Color = Lab.colors.cardBorder, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.dp, border, RoundedCornerShape(18.dp)).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        content = content,
    )
}

/** A big choice button: neutral, picked (accent), right (green) or wrong (red). */
@Composable
private fun OptionButton(label: String, state: OptionState, enabled: Boolean, modifier: Modifier = Modifier, big: Boolean = true, onClick: () -> Unit) {
    val bg by animateColorAsState(
        when (state) {
            OptionState.RIGHT -> Right.copy(alpha = 0.16f)
            OptionState.WRONG -> Wrong.copy(alpha = 0.14f)
            OptionState.PICKED -> Lab.colors.accentSoft
            else -> Lab.colors.card
        },
        label = "option",
    )
    val border = when (state) {
        OptionState.RIGHT -> Right
        OptionState.WRONG -> Wrong
        OptionState.PICKED -> Lab.colors.accent
        else -> Lab.colors.cardBorder
    }
    val pop by animateFloatAsState(if (state == OptionState.RIGHT || state == OptionState.PICKED) 1.03f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "pop")
    Box(
        modifier.scale(pop).heightIn(min = if (big) 72.dp else 52.dp).clip(RoundedCornerShape(16.dp)).background(bg)
            .border(if (state == OptionState.NONE) 1.dp else 2.dp, border, RoundedCornerShape(16.dp))
            .bouncyClickable(enabled = enabled, onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        val mark = when (state) { OptionState.RIGHT -> "✓ "; OptionState.WRONG -> "✗ "; else -> "" }
        Text(mark + label, color = Lab.colors.ink, fontSize = if (big) 26.sp else 17.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
    }
}

private enum class OptionState { NONE, PICKED, RIGHT, WRONG }

@Composable
private fun OptionGrid(options: List<String>, big: Boolean, state: (Int, String) -> OptionState, enabled: Boolean, onPick: (Int, String) -> Unit) {
    // Two columns (four options of a describe round, a measure-word quiz); one when the labels are long.
    val cols = if (options.size >= 3 && options.all { it.length <= 6 }) 2 else 1
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        options.withIndex().chunked(cols).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (i, o) -> OptionButton(o, state(i, o), enabled, Modifier.weight(1f), big) { onPick(i, o) } }
                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun RowScope.Grow() = Spacer(Modifier.weight(1f))

@Composable
private fun Actions(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically, content = content)
}

@Composable
private fun SpeakButton(text: String, speak: (String) -> Unit, label: String = "▶") {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(Lab.colors.accentSoft).bouncyClickable { speak(text) }.semantics { contentDescription = "Play $text" },
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.accent, fontSize = 16.sp) }
}

@Composable
private fun NextButton(v: ActivityView, label: String = "Next ▸") {
    if (v.can(ActivityAction.Next)) PrimaryPill(label, Modifier.height(52.dp).testTag("activity-next")) { v.act(ActivityAction.Next) }
    else if (v.phase == ActivityPhases.REVEAL) Waiting("${firstName(v.s.names[v.s.host] ?: "Your tutor")} moves on when you’re both ready")
}

@Composable
private fun Verdict(correct: Boolean?, right: String, wrong: String) {
    if (correct == null) return
    Text(
        if (correct) "✓ $right" else "✗ $wrong", color = if (correct) Right else Wrong,
        fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
    )
}

// ------------------------------------------------------------------ describe & guess

@Composable
private fun DescribeBody(v: ActivityView) {
    val item = v.spec.itemList.getOrNull(v.s.round) ?: return
    val options = v.s.data.options.orEmpty()
    if (v.phase == ActivityPhases.REVEAL) {
        Card(border = if (v.result?.correct == true) Right else Wrong) {
            Text(item.emoji.orEmpty(), fontSize = 56.sp)
            Text(item.hanzi.orEmpty(), color = Lab.colors.ink, fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text("${item.pinyin} · ${item.english}", color = Lab.colors.muted, fontSize = 15.sp)
        }
        Verdict(v.result?.correct, "${v.name("b")} got it!", "${v.name("b")} picked ${v.s.data.pick}")
        OptionGrid(options, big = true, state = { _, o -> if (o == item.hanzi) OptionState.RIGHT else if (o == v.s.data.pick) OptionState.WRONG else OptionState.NONE }, enabled = false) { _, _ -> }
        Actions { NextButton(v) }
        return
    }
    if (v.role == "a") {
        Card {
            Text(item.emoji.orEmpty(), fontSize = 72.sp)
            Text(item.hanzi.orEmpty(), color = Lab.colors.ink, fontSize = 38.sp, fontWeight = FontWeight.Bold)
            Text(item.pinyin, color = Lab.colors.muted, fontSize = 16.sp)
            Text(item.english, color = Lab.colors.muted, fontSize = 15.sp)
        }
        Hint("Describe it in Chinese — don’t say the word")
        item.hints?.takeIf { it.isNotEmpty() }?.let { hints ->
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                hints.forEach { h ->
                    Text(h, color = Lab.colors.ink, fontSize = 17.sp, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).bouncyClickable { v.actions.speak(h) }.padding(horizontal = 12.dp, vertical = 8.dp))
                }
            }
        }
        Waiting("${v.otherName().replaceFirstChar { it.uppercase() }} is guessing…")
    } else {
        Hint("Listen to ${v.name("a")}’s description and pick")
        OptionGrid(options, big = true, state = { _, _ -> OptionState.NONE }, enabled = v.can(ActivityAction.Pick(options.firstOrNull() ?: ""))) { _, o -> v.act(ActivityAction.Pick(o)) }
    }
}

// ------------------------------------------------------------------ information gap

@Composable
private fun InfoGapBody(v: ActivityView, seedCell: String?) {
    val spec = v.spec
    val answers = v.s.data.answers.orEmpty()
    val reveal = v.phase == ActivityPhases.REVEAL
    var sheetFor by remember { mutableStateOf(seedCell) }
    val choices = spec.choices.orEmpty()
    fun pinyinOf(h: String) = choices.firstOrNull { it.hanzi == h }?.pinyin
    spec.prompt?.takeIf { it.isNotBlank() }?.let { Hint(it) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).background(Lab.colors.card)) {
        Row(Modifier.fillMaxWidth().background(Lab.colors.faint).padding(vertical = 8.dp)) {
            Spacer(Modifier.weight(0.9f))
            spec.columns.orEmpty().forEach { c -> Text(c, Modifier.weight(1f), color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, fontSize = 15.sp) }
        }
        spec.rowList.forEachIndexed { ri, row ->
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(row.label, Modifier.weight(0.9f).padding(start = 10.dp), color = Lab.colors.muted, fontSize = 14.sp)
                row.cells.forEachIndexed { ci, cell ->
                    val key = CallActivities.cellKey(ri, ci)
                    val got = answers[key]
                    Box(Modifier.weight(1f).padding(4.dp), contentAlignment = Alignment.Center) {
                        when {
                            reveal -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(cell.value, color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                                val ok = got == cell.value
                                Text(
                                    if (got.isNullOrEmpty()) "✗ blank" else if (ok) "✓ ${v.name(CallActivities.otherRole(cell.owner))}" else "✗ $got",
                                    color = if (ok) Right else Wrong, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                )
                            }
                            cell.owner == v.role -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(cell.value, color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                                pinyinOf(cell.value)?.let { Text(it, color = Lab.colors.muted, fontSize = 11.sp) }
                                if (!got.isNullOrEmpty()) Text("they put: $got", color = Lab.colors.muted.copy(alpha = 0.8f), fontSize = 11.sp, fontStyle = FontStyle.Italic)
                            }
                            else -> {
                                val canFill = v.can(ActivityAction.Fill(key, null)) || v.can(ActivityAction.Fill(key, choices.firstOrNull()?.hanzi ?: ""))
                                Box(
                                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                                        .background(if (got.isNullOrEmpty()) Lab.colors.faint else Lab.colors.accentSoft)
                                        .border(1.5.dp, if (got.isNullOrEmpty()) Lab.colors.cardBorder else Lab.colors.accent, RoundedCornerShape(12.dp))
                                        .bouncyClickable(enabled = canFill) { sheetFor = key; v.actions.feel(ActivityFeel.TICK) }
                                        .testTag("cell-$key"),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(if (got.isNullOrEmpty()) "？" else got, color = if (got.isNullOrEmpty()) Lab.colors.muted else Lab.colors.accent, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (reveal) {
        Verdict(v.result?.correct, "Every blank right!", "${v.result?.answer ?: ""} right")
        Actions { NextButton(v, "Finish ▸") }
    } else {
        val blanks = CallActivities.blanksFor(spec, v.role)
        val filled = blanks.count { !answers[it].isNullOrEmpty() }
        Hint("Your blanks: $filled / ${blanks.size} filled — ask ${v.otherName()} in Chinese")
        if (v.can(ActivityAction.Reveal)) PrimaryPill("Check answers", Modifier.height(52.dp)) { v.act(ActivityAction.Reveal) }
    }
    spec.phrases?.takeIf { it.isNotEmpty() }?.let { phrases ->
        Card {
            Text("Useful phrases", color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
            phrases.forEach { p ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(p.hanzi, color = Lab.colors.ink, fontSize = 17.sp)
                        Text(p.pinyin, color = Lab.colors.muted, fontSize = 13.sp)
                        Text(p.english, color = Lab.colors.muted, fontSize = 13.sp)
                    }
                    SpeakButton(p.hanzi, v.actions.speak)
                }
            }
        }
    }
    sheetFor?.let { key ->
        LabBottomSheet(onDismiss = { sheetFor = null }, title = "Fill in the blank") {
            choices.forEach { c ->
                val on = answers[key] == c.hanzi
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).background(if (on) Lab.colors.accentSoft else Color.Transparent)
                        .bouncyClickable(pressedScale = 0.99f) { sheetFor = null; v.act(ActivityAction.Fill(key, c.hanzi)) }.padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(c.hanzi, color = Lab.colors.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                    Column(Modifier.weight(1f)) {
                        Text(c.pinyin, color = Lab.colors.muted, fontSize = 14.sp)
                        Text(c.english, color = Lab.colors.muted, fontSize = 13.sp)
                    }
                    if (on) Text("✓", color = Lab.colors.accent, fontWeight = FontWeight.Bold)
                }
            }
            if (!answers[key].isNullOrEmpty()) SecondaryPill("Clear", Modifier.padding(16.dp).fillMaxWidth(), danger = true) { sheetFor = null; v.act(ActivityAction.Fill(key, null)) }
            Spacer(Modifier.height(16.dp))
        }
    }
}

// ------------------------------------------------------------------ role-play

@Composable
private fun RoleplayBody(v: ActivityView) {
    val spec = v.spec
    val lines = spec.lineList
    val line = lines.getOrNull(v.s.round) ?: return
    var pinyin by rememberSaveable(v.s.sessionId) { mutableStateOf(true) }
    var english by rememberSaveable(v.s.sessionId) { mutableStateOf(false) }
    spec.setting?.takeIf { it.isNotBlank() }?.let { Text("📍 $it", color = Lab.colors.muted, fontSize = 14.sp, fontStyle = FontStyle.Italic, textAlign = TextAlign.Center) }
    // The lines so far, dimmed (the last three).
    lines.take(v.s.round).takeLast(3).forEach { l ->
        Row(Modifier.fillMaxWidth().alpha(0.5f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(spec.speakers?.of(l.speaker).orEmpty(), color = Lab.colors.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(56.dp))
            Text(l.hanzi, color = Lab.colors.ink, fontSize = 15.sp)
        }
    }
    val myLine = CallActivities.holds(v.s, v.me, line.speaker)
    Card(border = if (myLine) Lab.colors.accent else Lab.colors.cardBorder) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Pill("${spec.speakers?.of(line.speaker).orEmpty()} · ${v.name(line.speaker)}", if (myLine) Lab.colors.accentSoft else Lab.colors.faint, if (myLine) Lab.colors.accent else Lab.colors.ink)
            Grow()
            SpeakButton(line.hanzi, v.actions.speak)
        }
        Text(line.hanzi, color = Lab.colors.ink, fontSize = 26.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        if (pinyin) Text(line.pinyin, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
        if (english) Text(line.english, color = Lab.colors.muted, fontSize = 15.sp, fontStyle = FontStyle.Italic, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            ToggleChip("拼", pinyin) { pinyin = !pinyin; v.actions.feel(ActivityFeel.TICK) }
            ToggleChip("EN", english) { english = !english; v.actions.feel(ActivityFeel.TICK) }
        }
    }
    Hint(if (myLine) "Your line — read it aloud" else "${v.name(line.speaker)}’s line")
    Actions {
        if (v.can(ActivityAction.LineBack)) SecondaryPill("◂ Back") { v.act(ActivityAction.LineBack) }
        if (v.can(ActivityAction.LineDone)) PrimaryPill("Done ▸", Modifier.height(52.dp).testTag("line-done")) { v.act(ActivityAction.LineDone) }
    }
    Text("Line ${v.s.round + 1} of ${lines.size}", color = Lab.colors.muted, fontSize = 12.sp)
}

@Composable
private fun ToggleChip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 40.dp).widthIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
            .background(if (on) Lab.colors.accent else Lab.colors.faint).bouncyClickable(onClick = onClick).padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
}

// ------------------------------------------------------------------ sentence building

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BuildBody(v: ActivityView) {
    val item = v.spec.itemList.getOrNull(v.s.round) ?: return
    val tiles = item.tiles.orEmpty()
    val placed = v.s.data.placed.orEmpty()
    val pool = v.s.data.pool.orEmpty()
    if (v.phase == ActivityPhases.REVEAL) {
        Card(border = if (v.result?.correct == true) Right else Wrong) {
            Text(tiles.joinToString(""), color = Lab.colors.ink, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(item.pinyin, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
            Text(item.english, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
        Verdict(v.result?.correct, "You built it right", "You built: ${v.result?.answer?.ifEmpty { "(nothing)" } ?: ""}")
        Text("🗣 Now both say it aloud", color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        val said = v.s.data.said.orEmpty()
        val people = listOf(v.s.roles.a, v.s.roles.b).distinct()
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            people.forEach { uid ->
                val done = uid in said
                val who = firstName(v.s.names[uid] ?: "Someone")
                if (uid == v.me && !done && v.can(ActivityAction.Said)) PrimaryPill("I said it ✓", Modifier.height(48.dp)) { v.act(ActivityAction.Said, ActivityFeel.CORRECT) }
                else Pill(if (done) "✓ $who said it" else "$who…", if (done) Right.copy(alpha = 0.14f) else Lab.colors.faint, if (done) Right else Lab.colors.muted)
            }
        }
        Actions { NextButton(v) }
        return
    }
    Card {
        Text(item.english, color = Lab.colors.ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
    // The answer row: placed tiles (tap to take one back).
    FlowRow(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).clip(RoundedCornerShape(16.dp)).border(2.dp, Lab.colors.accent.copy(alpha = 0.5f), RoundedCornerShape(16.dp)).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (placed.isEmpty()) Text("Tap the words below in order", color = Lab.colors.muted, fontSize = 15.sp, modifier = Modifier.padding(10.dp))
        placed.forEach { t -> TileChip(tiles.getOrNull(t).orEmpty(), true, v.can(ActivityAction.Unplace(t))) { v.act(ActivityAction.Unplace(t)) } }
    }
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        pool.filter { it !in placed }.forEach { t -> TileChip(tiles.getOrNull(t).orEmpty(), false, v.can(ActivityAction.Place(t))) { v.act(ActivityAction.Place(t)) } }
    }
    Actions {
        if (v.can(ActivityAction.ClearTiles)) SecondaryPill("Clear") { v.act(ActivityAction.ClearTiles) }
        if (v.can(ActivityAction.Reveal)) PrimaryPill("Reveal answer", Modifier.height(52.dp)) { v.act(ActivityAction.Reveal) }
    }
    if (!v.can(ActivityAction.Reveal)) Hint("Build it together — ${v.name(if (v.s.host == v.s.roles.a) "a" else "b")} reveals the answer")
}

@Composable
private fun TileChip(label: String, placed: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 52.dp).widthIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
            .background(if (placed) Lab.colors.accentSoft else Lab.colors.card)
            .border(1.5.dp, if (placed) Lab.colors.accent else Lab.colors.cardBorder, RoundedCornerShape(12.dp))
            .bouncyClickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.ink, fontSize = 22.sp, fontWeight = FontWeight.Medium) }
}

// ------------------------------------------------------------------ quick quiz

@Composable
private fun QuizBody(v: ActivityView) {
    val q = v.spec.questionList.getOrNull(v.s.round) ?: return
    val asker = v.role == "a"
    val pick = v.s.data.pick?.toIntOrNull()
    val audio = q.audio?.takeIf { it.isNotBlank() }
    when (v.phase) {
        ActivityPhases.READY -> if (asker) {
            Card {
                if (q.prompt.isNotBlank()) Text(q.prompt, color = Lab.colors.ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                audio?.let { Text("🔊 plays: $it", color = Lab.colors.muted, fontSize = 16.sp) }
            }
            OptionGrid(q.options, big = false, state = { i, _ -> if (i == q.answer) OptionState.RIGHT else OptionState.NONE }, enabled = false) { _, _ -> }
            Hint(if (audio != null) "It plays on both phones when you ask" else "Read it out, or just ask")
            if (v.can(ActivityAction.Ask)) PrimaryPill("Ask ▸", Modifier.height(52.dp).testTag("quiz-ask")) { v.act(ActivityAction.Ask) }
        } else {
            Card { Text("❓", fontSize = 44.sp); Waiting("${v.name("a")} is about to ask…") }
        }
        ActivityPhases.PLAY -> {
            Card {
                if (q.prompt.isNotBlank()) Text(q.prompt, color = Lab.colors.ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                else Text("🔊 Listen", color = Lab.colors.ink, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                if (audio != null) {
                    if (asker && v.can(ActivityAction.PlayAudio)) SecondaryPill("🔊 Play for both") { v.act(ActivityAction.PlayAudio) }
                    else if (!asker) SecondaryPill("🔊 Hear it again") { v.actions.speak(audio) }
                    if (asker) Text("plays: $audio", color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
            if (asker) {
                OptionGrid(q.options, big = false, state = { i, _ -> if (i == pick) OptionState.PICKED else OptionState.NONE }, enabled = false) { _, _ -> }
                if (pick != null) Text("${v.name("b")} picked: ${q.options.getOrNull(pick).orEmpty()}", color = Lab.colors.accent, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                else Waiting("Waiting for ${v.otherName()} to pick…")
                if (v.can(ActivityAction.Reveal)) PrimaryPill("Reveal", Modifier.height(52.dp)) { v.act(ActivityAction.Reveal) }
            } else {
                OptionGrid(q.options, big = false, state = { i, _ -> if (i == pick) OptionState.PICKED else OptionState.NONE }, enabled = v.can(ActivityAction.Pick("0"))) { i, _ -> v.act(ActivityAction.Pick(i.toString())) }
                if (pick != null) Hint("${v.name("a")} sees your pick — wait for the reveal")
            }
        }
        else -> {
            Card(border = if (v.result?.correct == true) Right else Wrong) {
                if (q.prompt.isNotBlank()) Text(q.prompt, color = Lab.colors.ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                audio?.let { Text("🔊 $it", color = Lab.colors.ink, fontSize = 22.sp) }
            }
            OptionGrid(q.options, big = false, state = { i, _ -> if (i == q.answer) OptionState.RIGHT else if (i == pick) OptionState.WRONG else OptionState.NONE }, enabled = false) { _, _ -> }
            Verdict(v.s.data.mark, "Right", if (pick == null) "No answer" else "Not quite")
            q.explanation?.let { Text(it, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center) }
            MarkAndNext(v)
        }
    }
}

@Composable
private fun MarkAndNext(v: ActivityView) {
    Actions {
        if (v.can(ActivityAction.Mark(true))) {
            val mark = v.s.data.mark
            SecondaryPill(if (mark == true) "✓ Marked right" else "Mark right") { v.act(ActivityAction.Mark(true), ActivityFeel.CORRECT) }
            SecondaryPill(if (mark == false) "✗ Marked wrong" else "Mark wrong", danger = true) { v.act(ActivityAction.Mark(false), ActivityFeel.WRONG) }
        }
    }
    Actions { NextButton(v) }
}

// ------------------------------------------------------------------ dictation

@Composable
private fun DictationBody(v: ActivityView) {
    val item = v.spec.itemList.getOrNull(v.s.round) ?: return
    val asker = v.role == "a"
    val d = v.s.data
    when (v.phase) {
        ActivityPhases.READY -> if (asker) {
            Card {
                Text(item.hanzi.orEmpty(), color = Lab.colors.ink, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                Text(item.pinyin, color = Lab.colors.muted, fontSize = 16.sp)
                Text(item.english, color = Lab.colors.muted, fontSize = 15.sp)
            }
            Hint("Say it aloud, then Start")
            if (v.can(ActivityAction.Ask)) PrimaryPill("Start ▸", Modifier.height(52.dp).testTag("dictation-start")) { v.act(ActivityAction.Ask) }
        } else {
            Card { Text("✍️", fontSize = 44.sp); Waiting("Get ready… ${v.name("a")} will say a word") }
        }
        ActivityPhases.PLAY -> if (asker) {
            Card {
                Text(item.hanzi.orEmpty(), color = Lab.colors.ink, fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text(item.pinyin, color = Lab.colors.muted, fontSize = 15.sp)
            }
            if (v.can(ActivityAction.PlayAudio)) SecondaryPill("🔊 Play for both") { v.act(ActivityAction.PlayAudio) }
            val draft = d.draft.orEmpty()
            Card(border = Lab.colors.accent.copy(alpha = 0.5f)) {
                Text(if (d.submitted == true) "${v.name("b")} wrote:" else "${v.name("b")} is typing:", color = Lab.colors.muted, fontSize = 13.sp)
                Text(draft.ifEmpty { "…" }, color = Lab.colors.ink, fontSize = 28.sp, fontWeight = FontWeight.Medium, modifier = Modifier.testTag("live-draft"))
            }
            if (v.can(ActivityAction.Reveal)) PrimaryPill("Reveal", Modifier.height(52.dp)) { v.act(ActivityAction.Reveal) }
        } else WriterField(v)
        else -> {
            val diff = LessonAnswers.diffHanzi(d.draft.orEmpty(), item.hanzi.orEmpty())
            Card(border = if (d.mark == true) Right else Wrong) {
                Text(item.hanzi.orEmpty(), color = Lab.colors.ink, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                Text("${item.pinyin} · ${item.english}", color = Lab.colors.muted, fontSize = 15.sp)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Written", color = Lab.colors.muted, fontSize = 13.sp)
                Text(
                    buildAnnotatedString {
                        if (diff.typed.isEmpty()) withStyle(SpanStyle(color = Lab.colors.muted)) { append("(nothing)") }
                        diff.typed.forEach { m -> withStyle(SpanStyle(color = if (m.hit) Right else Wrong)) { append(m.ch) } }
                    },
                    fontSize = 30.sp, fontWeight = FontWeight.Medium, modifier = Modifier.testTag("dictation-diff"),
                )
                if (diff.expected.any { !it.hit }) Text(
                    buildAnnotatedString {
                        append("Missed: ")
                        diff.expected.filter { !it.hit }.forEach { m -> withStyle(SpanStyle(color = Wrong, fontWeight = FontWeight.Bold)) { append(m.ch) } }
                    },
                    color = Lab.colors.muted, fontSize = 15.sp,
                )
            }
            Verdict(d.mark, "Right", "Not quite")
            MarkAndNext(v)
        }
    }
}

/** The writer's box: any IME; what I type stays mine while I type (the room's echo only fills it in when I'm not in it). */
@Composable
private fun WriterField(v: ActivityView) {
    val d = v.s.data
    var text by remember(v.s.sessionId, v.s.round) { mutableStateOf(d.draft.orEmpty()) }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(d.draft) { if (!focused) text = d.draft.orEmpty() }
    val submitted = d.submitted == true
    Card { Text("🎧", fontSize = 40.sp); Text("Write what ${v.name("a")} says", color = Lab.colors.ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
    OutlinedTextField(
        value = text,
        onValueChange = { t ->
            val cut = t.take(CallActivities.MAX_DRAFT_CHARS)
            text = cut
            v.actions.act(ActivityAction.Draft(cut))
        },
        enabled = !submitted && v.can(ActivityAction.Submit),
        singleLine = true,
        placeholder = { Text("汉字…", fontSize = 24.sp) },
        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 28.sp, color = Lab.colors.ink, textAlign = TextAlign.Center),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { if (v.can(ActivityAction.Submit)) v.act(ActivityAction.Submit) }),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Lab.colors.accent),
        modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }.testTag("dictation-field"),
    )
    if (submitted) Waiting("Sent ✓ — waiting for ${v.name("a")}")
    else if (v.can(ActivityAction.Submit)) PrimaryPill("Submit", Modifier.height(52.dp), enabled = text.isNotBlank()) { v.act(ActivityAction.Submit) }
}

// ------------------------------------------------------------------ done

@Composable
private fun DoneBody(v: ActivityView) {
    val sum = CallActivities.summary(v.s)
    Text("🎉", fontSize = 56.sp)
    Text("Well done!", color = Lab.colors.ink, fontSize = 24.sp, fontWeight = FontWeight.Bold)
    if (sum.scored > 0) Text("${sum.correct} / ${sum.scored} right", color = Right, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
    Text("${sum.played} of ${sum.totalRounds} ${if (v.spec.kind == ActivityKinds.ROLEPLAY) "lines" else "rounds"} played", color = Lab.colors.muted, fontSize = 14.sp)
    if (sum.lines.isNotEmpty()) Card {
        sum.lines.take(24).forEach { l ->
            Text(
                l, fontSize = 14.sp, modifier = Modifier.fillMaxWidth(),
                color = when { l.contains(" ✓") -> Lab.colors.ink; l.contains(" ✗") -> Wrong; else -> Lab.colors.ink },
            )
        }
    }
    Actions {
        if (v.can(ActivityAction.Restart)) SecondaryPill("⟲ Play again") { v.act(ActivityAction.Restart) }
        PrimaryPill("Close", Modifier.height(52.dp)) { v.actions.feel(ActivityFeel.TICK); v.actions.close() }
    }
}

@Composable
private fun UnknownBody(v: ActivityView) {
    InlineNotice("“${v.spec.title}” needs a newer version of the app.", kind = NoticeKind.Info)
    PrimaryPill("Close", Modifier.height(52.dp)) { v.actions.close() }
}

// ------------------------------------------------------------------ picker

/**
 * ⋯ → 🎲 Activities: the bundled activities grouped by kind (ACTIVITY_KIND_INFO), each with its level,
 * topic and one line of what you do. Starting one while another runs replaces it (its result is kept).
 */
@Composable
fun ActivityPickerSheet(running: ActivitySession?, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        if (running != null && running.phase != ActivityPhases.DONE) {
            InlineNotice("“${running.spec.title}” is running. Starting another ends the current one (its result is kept).", kind = NoticeKind.Info, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        Hint("Two-person exercises you play together, live. Roles are set for you — the tutor leads.", Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        for (kind in ActivityKinds.ALL) {
            val specs = dev.jeromeswannack.chineselearning.lab.core.calls.ActivityCatalogue.ALL.filter { it.kind == kind }
            if (specs.isEmpty()) continue
            val info = CallActivities.KIND_INFO[kind]
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(info?.icon ?: "🎲", fontSize = 20.sp)
                Column {
                    Text(info?.name ?: kind, color = Lab.colors.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text(info?.blurb.orEmpty(), color = Lab.colors.muted, fontSize = 12.sp)
                }
            }
            specs.forEach { sp ->
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.card)
                        .border(1.dp, if (running?.spec?.id == sp.id) Lab.colors.accent else Lab.colors.cardBorder, RoundedCornerShape(16.dp))
                        .bouncyClickable(pressedScale = 0.98f) { onPick(sp.id) }.padding(14.dp).testTag("pick-${sp.id}"),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(sp.title, color = Lab.colors.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Pill(sp.level.replaceFirstChar { it.uppercase() }, Lab.colors.faint, Lab.colors.muted)
                    }
                    sp.titleZh?.let { Text(it, color = Lab.colors.ink, fontSize = 15.sp) }
                    Text(sp.topic, color = Lab.colors.accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text(sp.summary, color = Lab.colors.muted, fontSize = 13.sp)
                }
            }
        }
    }
}
