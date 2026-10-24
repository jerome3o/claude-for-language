package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.delay

/** Test tags of "Stop showing this sentence". */
object SentenceHideTags {
    const val SHEET = "sentence-hide-sheet"
    const val REASON = "sentence-hide" // + "-<reason>"
    const val UNDO = "sentence-hidden-undo"
    const val COMING = "sentences-coming"
    const val HIDE_TOOL = "sentence-set-hide"
    const val SHOW_HIDDEN = "sentence-set-show-hidden"
    const val UNHIDE = "sentence-set-unhide"
}

/**
 * "Stop showing this sentence" (the web's components/study/SentenceHideSheet.tsx; words in core
 * [SentenceHistory]): the sentence, why — four reason chips; a chip hides it at once.
 */
@Composable
fun SentenceHideSheet(hanzi: String, translation: String?, onHide: (reason: String) -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss, title = "🙈 ${SentenceHistory.HIDE_TITLE}") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).testTag(SentenceHideTags.SHEET), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(hanzi, color = Lab.colors.ink, fontSize = 20.sp)
            if (!translation.isNullOrBlank()) Text(translation, color = Lab.colors.muted, fontSize = 15.sp)
            Text(SentenceHistory.HIDE_HINT, color = Lab.colors.muted, fontSize = 14.sp)
            SentenceHistory.HIDE_REASONS.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { r ->
                        Box(
                            Modifier.weight(1f).heightIn(min = 52.dp).clip(RoundedCornerShape(14.dp))
                                .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp))
                                .bouncyClickable(true, 0.96f, role = Role.Button) { onHide(r) }
                                .testTag("${SentenceHideTags.REASON}-$r"),
                            contentAlignment = Alignment.Center,
                        ) { Text(SentenceHistory.HIDE_REASON_LABEL[r].orEmpty(), color = Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
                    }
                }
            }
            SecondaryPill("Cancel", Modifier.fillMaxWidth(), onClick = onDismiss)
        }
    }
}

/** "Sentence hidden · Undo" at the bottom, gone by itself after a few seconds. */
@Composable
fun SentenceUndoToast(text: String, onUndo: () -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val done by rememberUpdatedState(onDone)
    LaunchedEffect(text) {
        delay(4500)
        done()
    }
    Row(
        modifier.padding(16.dp).shadow(8.dp, RoundedCornerShape(28.dp))
            .clip(RoundedCornerShape(28.dp)).background(Color(0xFF1F2937)).padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Color.White, fontSize = 15.sp)
        Spacer(Modifier.width(12.dp))
        Box(
            Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(Color(0xFFFBBF24)).clickable { onUndo() }
                .padding(horizontal = 16.dp).testTag(SentenceHideTags.UNDO),
            contentAlignment = Alignment.Center,
        ) { Text("Undo", color = Color(0xFF1F2937), fontWeight = FontWeight.Bold) }
    }
}

/** "✨ New sentences coming for this word". */
@Composable
fun SentencesComingNote(modifier: Modifier = Modifier) {
    Text(
        SentenceHistory.COMING_NOTE,
        modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 12.dp, vertical = 8.dp).testTag(SentenceHideTags.COMING),
        color = Lab.colors.ink, fontSize = 14.sp,
    )
}
