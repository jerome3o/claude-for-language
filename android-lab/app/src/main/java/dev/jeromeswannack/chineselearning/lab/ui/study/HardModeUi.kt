package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.PassAngles
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of Hard mode (the web's data-testids). */
object HardModeTags {
    const val CHIP = "hard-mode-chip"
    const val MENU = "hard-mode-menu"
    fun option(mode: String) = "hard-mode-option-$mode"
    const val FEEDBACK = "hard-feedback"
    const val SAID = "hard-said"
    const val TRY_AGAIN = "hard-try-again"
    const val SHOW_ANSWER = "hard-show-answer"
    const val NEXT = "hard-next"
    const val GAVE_UP = "hard-gave-up"
    const val CHIP_DOT = "hard-mode-chip-dot"
}

private val ChipRed = Color(0xFFDC2626)
private val ChipAll = Color(0xFFD97706)

/**
 * The study session's header chip (the web's components/study/HardModeChip.tsx): 🎯 Off / Red / All —
 * a tap opens the three choices (Off · Red cards only · All cards) with a hint each. Per device
 * (StudyPrefs.hardMode); the card on screen follows at once.
 */
@Composable
fun HardModeChip(mode: String, onChange: (String) -> Unit, startOpen: Boolean = false, compact: Boolean = false, pass: Boolean = false) {
    // `pass`: the homework pass's own chip (core PassAngles, docs/HOMEWORK.md §3d): All words · Words I miss · Off.
    val chipLabel = if (pass) PassAngles.chipLabel(mode) else HardMode.chipLabel(mode)
    val title = if (pass) PassAngles.TITLE else HardMode.TITLE
    val option = if (pass) PassAngles.OPTION else HardMode.OPTION
    val hint = if (pass) PassAngles.OPTION_HINT else HardMode.OPTION_HINT
    var open by remember { mutableStateOf(startOpen) }
    val color = when (mode) {
        HardMode.RED -> ChipRed
        HardMode.ALL -> ChipAll
        else -> Lab.colors.muted
    }
    Box {
        if (compact) {
            // A tight header (StudyTopBarFit): 🎯 alone in a 44 dp target, the state as a coloured dot
            // (none when Off, the 🎯 dimmed); the full "Hard mode: Red cards only" is its label.
            Box(
                Modifier
                    .size(CompactChipSize)
                    .bouncyClickable { open = true }
                    .semantics { contentDescription = chipLabel }
                    .testTag(HardModeTags.CHIP),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(34.dp).clip(CircleShape).background(color.copy(alpha = if (mode == HardMode.OFF) 0.08f else 0.14f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("🎯", Modifier.alpha(if (mode == HardMode.OFF) 0.45f else 1f), fontSize = 15.sp, maxLines = 1, softWrap = false)
                }
                if (mode != HardMode.OFF) {
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(top = 6.dp, end = 4.dp).size(10.dp).clip(CircleShape)
                            .background(Lab.colors.background).padding(1.5.dp).clip(CircleShape).background(color)
                            .testTag(HardModeTags.CHIP_DOT),
                    )
                }
            }
        } else {
            Row(
                Modifier
                    .heightIn(min = 32.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = if (mode == HardMode.OFF) 0.08f else 0.14f))
                    .bouncyClickable { open = true }
                    .padding(horizontal = 10.dp, vertical = 5.dp)
                    .semantics { contentDescription = chipLabel }
                    .testTag(HardModeTags.CHIP),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(HardMode.CHIP.getValue(mode), color = color, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, softWrap = false)
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.testTag(HardModeTags.MENU)) {
            Text(
                "🎯 $title", Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                color = Lab.colors.ink, fontWeight = FontWeight.Bold, fontSize = 14.sp,
            )
            HardMode.MODES.forEach { m ->
                Row(
                    Modifier
                        .widthIn(min = 260.dp)
                        .heightIn(min = 52.dp)
                        .bouncyClickable {
                            open = false
                            if (m != mode) onChange(m)
                        }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .testTag(HardModeTags.option(m)),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = m == mode, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Lab.colors.accent))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(option.getValue(m), color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Text(hint.getValue(m), color = Lab.colors.muted, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

/** Settings → Study → "Hard mode" (the web's `HardModeSetting`): the three choices as radio rows. */
@Composable
fun HardModeChoices(mode: String, onChange: (String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        NavRow(icon = "🎯", label = HardMode.TITLE, desc = HardMode.DESCRIPTION)
        HardMode.MODES.forEach { m ->
            NavRow(
                icon = "",
                label = HardMode.OPTION.getValue(m),
                desc = HardMode.OPTION_HINT.getValue(m),
                modifier = Modifier.testTag("hard-mode-setting-$m"),
                trailing = { RadioButton(selected = m == mode, onClick = { onChange(m) }, colors = RadioButtonDefaults.colors(selectedColor = Lab.colors.accent)) },
                onClick = { onChange(m) },
            )
        }
    }
}

/** Settings → Study → "Hard mode in homework" (the web's `PassHardModeSetting`; default All). */
@Composable
fun PassHardModeChoices(mode: String, onChange: (String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        NavRow(icon = "🎯", label = PassAngles.TITLE, desc = PassAngles.DESCRIPTION)
        HardMode.MODES.forEach { m ->
            NavRow(
                icon = "",
                label = PassAngles.OPTION.getValue(m),
                desc = PassAngles.OPTION_HINT.getValue(m),
                modifier = Modifier.testTag("pass-hard-mode-setting-$m"),
                trailing = { RadioButton(selected = m == mode, onClick = { onChange(m) }, colors = RadioButtonDefaults.colors(selectedColor = Lab.colors.accent)) },
                onClick = { onChange(m) },
            )
        }
    }
}

/**
 * Hard mode's check of the question's own answer, on the question (the web's HardModeFeedback.tsx):
 * ✓ Right → "Next: harder questions" (it goes on by itself after a beat); ✗ Not quite / ≈ Nearly →
 * 🔁 Try again, or 👁 Show answer (a miss: Again or Hard). Never shows the card's answer.
 */
@Composable
fun HardModeFeedbackPanel(
    result: String,
    said: String?,
    spoken: Boolean,
    roundFollows: Boolean,
    onTryAgain: () -> Unit,
    onShowAnswer: () -> Unit,
    onNext: () -> Unit,
) {
    val (border, ink) = when (result) {
        "right" -> Palette.Good to Palette.Good
        "close" -> Palette.Gold to Palette.Gold
        "wrong" -> Palette.Again to Palette.Again
        else -> Lab.colors.cardBorder to Lab.colors.muted
    }
    val pop = remember(result) { Animatable(0.92f) }
    LaunchedEffect(result) { pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
    Column(
        Modifier
            .fillMaxWidth()
            .scale(pop.value)
            .clip(RoundedCornerShape(18.dp))
            .background(border.copy(alpha = 0.08f))
            .border(2.dp, border, RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite }
            .testTag(HardModeTags.FEEDBACK),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (result) {
            "checking" -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(HardMode.CHECKING, color = Lab.colors.muted, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
            "unknown" -> Text(HardMode.UNKNOWN, color = Lab.colors.muted, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            else -> Text(HardMode.RESULT.getValue(result), color = ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
        if (said != null && result != "checking" && result != "unknown") {
            Text(HardMode.saidLine(said, spoken), Modifier.testTag(HardModeTags.SAID), color = Lab.colors.ink, fontSize = 16.sp, textAlign = TextAlign.Center)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when (result) {
                "right" -> PrimaryPill("${HardMode.nextLabel(roundFollows)} →", Modifier.weight(1f).height(54.dp).testTag(HardModeTags.NEXT), onClick = onNext)
                "checking" -> SecondaryPill("👁 ${HardMode.SHOW_ANSWER}", Modifier.weight(1f).height(52.dp).testTag(HardModeTags.SHOW_ANSWER), onClick = onShowAnswer)
                "unknown" -> {
                    SecondaryPill("🔁 ${HardMode.TRY_AGAIN}", Modifier.weight(1f).height(52.dp).testTag(HardModeTags.TRY_AGAIN), onClick = onTryAgain)
                    PrimaryPill("${HardMode.nextLabel(roundFollows)} →", Modifier.weight(1f).height(52.dp).testTag(HardModeTags.NEXT), onClick = onNext)
                }
                else -> {
                    SecondaryPill("👁 ${HardMode.SHOW_ANSWER}", Modifier.weight(1f).height(52.dp).testTag(HardModeTags.SHOW_ANSWER), onClick = onShowAnswer)
                    PrimaryPill("🔁 ${HardMode.TRY_AGAIN}", Modifier.weight(1f).height(52.dp).testTag(HardModeTags.TRY_AGAIN), onClick = onTryAgain)
                }
            }
        }
        if (result == "wrong" || result == "close") {
            Text(HardMode.MISS_NOTE, color = Lab.colors.muted, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
    }
}
