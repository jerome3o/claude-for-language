package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.LessonPatternIntro
import dev.jeromeswannack.chineselearning.lab.core.LessonPatterns
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.ui.clips.ClipPlayer
import dev.jeromeswannack.chineselearning.lab.ui.clips.ClipPlayerActions

/*
 * "▶ Watch the intro" on a structure card (web components/lessons/StructureIntro.tsx; docs/STUDY_SESSION.md
 * "Structure intro"): the card's intro clip (core LessonPatternIntro, parity-tested) played full screen by the
 * 🎬 Clips player — a title, the pattern building up, the examples read with their parts lighting up, a closing
 * line; captions with 拼 / EN, tap = pause, ↻ Watch again. Nothing starts until he taps ▶; nothing is recorded
 * but analytics. The lines are the app voice at the clip speed, prefetched with the lesson (offline).
 */

object StructureIntroTags {
    const val ROOT = "structure-intro"
    const val CLOSE = "structure-intro-close"
}

@Composable
fun StructureIntro(card: LessonPatterns.Card, source: String, index: Int, count: Int, onClose: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val spec = remember(card) { LessonPatternIntro.clip(card) }
    val clip = remember(spec) { ClipRecord(id = "intro-${spec.hashCode().toUInt().toString(16)}", status = "ready", source = "generated", title = spec.title, theme = spec.style.theme, spec = spec) }
    var prefs by remember { mutableStateOf(runCatching { ClipStore.prefs(context) }.getOrDefault(ClipStore.CaptionPrefs())) }
    val finished = remember { booleanArrayOf(false) }
    fun track(action: String, extra: Map<String, Any?> = emptyMap()) {
        app?.analytics?.track(
            "lesson.structure_intro",
            mapOf("action" to action, "source" to source, "index" to index, "count" to count, "scenes" to spec.scenes.size) + extra,
        )
    }
    LaunchedEffect(Unit) { track("play") }
    val close = {
        if (!finished[0]) track("close")
        onClose()
    }

    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).testTag(StructureIntroTags.ROOT)) {
            ClipPlayer(
                clip,
                active = true,
                prefs = prefs,
                actions = ClipPlayerActions(
                    onComplete = { ms -> finished[0] = true; track("finish", mapOf("duration_ms" to ms)) },
                    onPrefs = { p, _ -> prefs = p; runCatching { ClipStore.savePrefs(context, p) } },
                    lineAudio = { text, voice -> app?.let { ClipStore.lineAudio(it, text, voice) } },
                ),
                introDone = onClose,
            )
            Box(
                Modifier.align(Alignment.TopStart).statusBarsPadding().padding(start = 10.dp, top = 18.dp).size(44.dp).clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.4f)).clickable(role = Role.Button, onClick = close)
                    .semantics { contentDescription = "Close the intro" }.testTag(StructureIntroTags.CLOSE),
                contentAlignment = Alignment.Center,
            ) { Text("✕", color = Color.White, fontSize = 20.sp) }
        }
    }
}
