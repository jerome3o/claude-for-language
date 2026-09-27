package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A settings group: heading, one-line explanation, then the controls (the web's `.settings-section`). */
@Composable
fun SettingsSection(title: String, desc: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    LabCard(modifier) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
            if (desc != null) Text(desc, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            content()
        }
    }
}

/**
 * The web's budget Stepper: label + hint, − value +. Holding a button repeats (faster and
 * faster), the number rolls with a spring, and every step ticks.
 */
@Composable
fun Stepper(label: String, hint: String, value: Int, onChange: (Int) -> Unit, max: Int, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        StepButton("−", "Fewer $label", enabled && value > 0) { onChange(value - 1) }
        AnimatedContent(
            value,
            transitionSpec = {
                val up = targetState > initialState
                (slideInVertically(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) { if (up) it else -it }) togetherWith
                    (slideOutVertically { if (up) -it else it })
            },
            label = "stepper",
            modifier = Modifier.widthIn(min = 48.dp),
        ) { v ->
            Text("$v", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 48.dp))
        }
        StepButton("+", "More $label", enabled && value < max) { onChange(value + 1) }
    }
}

@Composable
private fun StepButton(symbol: String, description: String, enabled: Boolean, onStep: () -> Unit) {
    val step by rememberUpdatedState(onStep)
    val on by rememberUpdatedState(enabled)
    Box(
        Modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(Lab.colors.faint)
            .alpha(if (enabled) 1f else 0.4f)
            .semantics { contentDescription = description; role = Role.Button }
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    if (!on) return@detectTapGestures
                    step()
                    coroutineScope {
                        val repeat = launch {
                            delay(420)
                            var gap = 140L
                            while (on) {
                                step()
                                delay(gap)
                                gap = (gap * 0.85).toLong().coerceAtLeast(45)
                            }
                        }
                        tryAwaitRelease()
                        repeat.cancel()
                    }
                })
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(symbol, fontSize = 24.sp, color = Lab.colors.ink)
    }
}

/** One choice of several (the web's `.settings-segmented`). */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, enabled: Boolean = true, onSelect: (T) -> Unit) {
    ChipRow {
        options.forEach { (value, label) ->
            LabChip(label, selected = value == selected, enabled = enabled) { onSelect(value) }
        }
    }
}

/** A small muted line under a control ("Saved ✓", "Queued 20 words…"), red when [error]. */
@Composable
fun StatusLine(text: String?, error: Boolean = false) {
    if (text == null) return
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = if (error) dev.jeromeswannack.chineselearning.lab.ui.theme.Palette.Again else Lab.colors.muted,
        )
        Spacer(Modifier.width(0.dp))
    }
}
