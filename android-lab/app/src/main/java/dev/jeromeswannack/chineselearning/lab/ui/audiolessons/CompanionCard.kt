package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlock
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks

/**
 * The player's companion mini lesson (docs/AUDIO_LESSONS.md "Companion mini lesson"; the web's
 * components/audioLessons/CompanionCard.tsx): none yet → "✨ Make its mini lesson"; being written /
 * failed (Try again); locked → "🔒 Mini lesson waiting" + the unlock button; unlocked → "Mini lesson
 * ready: <title> → Start", prominent once the listen is done.
 */
data class CompanionView(
    /** generating | failed | locked | unlocked */
    val status: String,
    val lessonId: String?,
    val title: String?,
    val unlock: LessonUnlock? = null,
    val error: String? = null,
)

private val Violet = Color(0xFFA78BFA)
private val VioletDeep = Color(0xFF5B21B6)

/** "🔒 Mini lesson waiting" / "✓ Mini lesson unlocked" (list rows and the player). */
@Composable
fun CompanionBadge(status: String, modifier: Modifier = Modifier) {
    val (bg, fg) = when (status) {
        "unlocked" -> Color(0xFFDCFCE7) to Color(0xFF166534)
        "failed" -> Color(0xFFFEE2E2) to Color(0xFF991B1B)
        else -> Color(0xFFEDE9FE) to VioletDeep
    }
    Text(
        LessonUnlocks.companionBadge(status),
        modifier = modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 3.dp),
        color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun CardButton(label: String, primary: Boolean, enabled: Boolean = true, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp))
            .background(if (primary) Violet else Color.White.copy(alpha = 0.08f))
            .then(if (primary) Modifier else Modifier.border(1.dp, AlColors.glassBorder, RoundedCornerShape(22.dp)))
            .clickable(enabled = enabled, onClick = onClick).alpha(if (enabled) 1f else 0.5f)
            .testTag(tag).padding(horizontal = 18.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (primary) Color(0xFF1E1B4B) else AlColors.bright, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
}

@Composable
fun CompanionCard(
    view: CompanionView?,
    listened: Boolean,
    online: Boolean,
    busy: Boolean,
    onMake: () -> Unit,
    onUnlock: () -> Unit,
    onStart: (String) -> Unit,
) {
    val ready = listened && view != null && (view.status == "unlocked" || view.status == "locked")
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .background(if (ready) Color(0x298B5CF6) else Color.White.copy(alpha = 0.04f))
            .border(1.dp, if (ready) Violet else Color(0x73C4B5FD), RoundedCornerShape(16.dp))
            .testTag("al-companion").padding(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when {
            view == null -> {
                CardButton(if (busy) "Asking…" else "✨ Make its mini lesson", primary = false, enabled = online && !busy, tag = "al-companion-make", onClick = onMake)
                Text("A ~10–15 minute lesson on this podcast's words and sentences — it unlocks once you've listened.", color = AlColors.muted, fontSize = 13.sp, textAlign = TextAlign.Center)
            }
            view.status == "generating" -> CompanionBadge("generating")
            view.status == "failed" -> {
                CompanionBadge("failed")
                view.error?.let { Text(it, color = AlColors.muted, fontSize = 13.sp, textAlign = TextAlign.Center) }
                CardButton("🔄 Try again", primary = false, enabled = online && !busy, tag = "al-companion-retry", onClick = onMake)
            }
            view.status == "locked" -> {
                CompanionBadge("locked")
                Text(view.title ?: "Its mini lesson", color = AlColors.bright, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, textAlign = TextAlign.Center)
                if (view.unlock?.isAudio == false) Text("🔒 ${view.unlock.prompt.orEmpty()}", color = AlColors.muted, fontSize = 13.sp, textAlign = TextAlign.Center)
                CardButton(view.unlock?.let { LessonUnlocks.buttonLabel(it) } ?: "✓ I've listened — unlock", primary = true, enabled = !busy, tag = "al-companion-unlock", onClick = onUnlock)
            }
            else -> {
                val title = view.title ?: "its mini lesson"
                if (listened) {
                    Text("🔓 ${LessonUnlocks.readyLine(title)}", color = AlColors.bright, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.testTag("al-companion-ready"))
                    view.lessonId?.let { id -> CardButton("▶ Start", primary = true, tag = "al-companion-start") { onStart(id) } }
                } else {
                    CompanionBadge("unlocked")
                    view.lessonId?.let { id ->
                        Text("$title ›", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.heightIn(min = 44.dp).clickable { onStart(id) }.padding(vertical = 10.dp))
                    }
                }
            }
        }
    }
}
