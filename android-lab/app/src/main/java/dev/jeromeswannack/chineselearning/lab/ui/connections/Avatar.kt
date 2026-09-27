package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** A person's initial in a tinted circle (🤖 for Claude). The Lab app loads no remote pictures. */
@Composable
fun Avatar(name: String?, email: String? = null, size: Dp = 44.dp, isClaude: Boolean = false) {
    val initial = (name?.takeIf { it.isNotBlank() } ?: email?.takeIf { it.isNotBlank() } ?: "?").first().uppercase()
    Box(Modifier.size(size).clip(CircleShape).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
        Text(if (isClaude) "🤖" else initial, color = Lab.colors.accent, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
    }
}
