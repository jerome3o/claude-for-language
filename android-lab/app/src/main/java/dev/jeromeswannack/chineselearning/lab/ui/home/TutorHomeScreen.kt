package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavSection
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

data class TutorHomeUi(
    val firstName: String? = null,
    /** Active students; null while the relationships aren't known yet. */
    val studentCount: Int? = null,
    /** (id, name) in queue order. */
    val decks: List<Pair<String, String>> = emptyList(),
)

/**
 * `/` for a tutor account (web: components/home/TutorHome.tsx): no streak, no due-card
 * button — students, the things they make, and "Try it as your student".
 */
@Composable
fun TutorHomeScreen(ui: TutorHomeUi, onOpen: (String) -> Unit) {
    LabScreen(title = ui.firstName?.let { "Hi $it" } ?: "Teaching", subtitle = "Your students, and everything you make for them.") {
        item {
            Row(
                Modifier.fillMaxWidth().bouncyClickable { onOpen(Routes.CONNECTIONS) }.clip(RoundedCornerShape(22.dp)).background(Lab.colors.accentSoft).padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("👥", fontSize = 30.sp)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        when (val n = ui.studentCount) {
                            null -> "Your students"
                            0 -> "Invite your first student"
                            else -> "$n student${if (n == 1) "" else "s"}"
                        },
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink,
                    )
                    Text("How they are doing, what needs attention, send homework", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                Text("›", color = Lab.colors.muted, fontSize = 22.sp)
            }
        }
        item {
            NavSection(
                "Make",
                rows = listOf(
                    { NavRow("🗂️", "Lesson Library", desc = "Mini lessons you assign", onClick = { onOpen(Routes.LIBRARY) }) },
                    { NavRow("📚", "Readers", desc = "Graded stories to share", onClick = { onOpen(Routes.readers()) }) },
                    { NavRow("🃏", "Decks", desc = "Word lists you send as homework", onClick = { onOpen(Routes.DECKS) }) },
                    { NavRow("📹", "Video calls (beta)", desc = "Lessons with a whiteboard and a transcript", onClick = { onOpen(Routes.calls()) }) },
                ),
            )
        }
        item {
            Column {
                NavSection(
                    "Try it as your student",
                    rows = if (ui.decks.isEmpty()) listOf({ NavRow("🃏", "Your decks will appear here") })
                    else ui.decks.take(5).map { (id, name) -> { NavRow("▶", name, desc = "Try this deck", onClick = { onOpen(Routes.deckTry(id)) }) } },
                )
                Text(
                    "Go through a deck or a lesson exactly as a student gets it. Nothing is recorded — no reviews, no streak, no schedule.",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                )
            }
        }
    }
}
