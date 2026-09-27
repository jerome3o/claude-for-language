package dev.jeromeswannack.chineselearning.lab.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** The web app's rating / queue colours, so both apps read the same. */
object Palette {
    val Again = Color(0xFFEF4444)
    val Hard = Color(0xFFF97316)
    val Good = Color(0xFF22C55E)
    val Easy = Color(0xFF3B82F6)
    val New = Color(0xFF3B82F6)
    val Secondary = Color(0xFFA855F7)
    val Learning = Color(0xFFEF4444)
    val Review = Color(0xFF22C55E)
    val Gold = Color(0xFFEAB308)
    val Confetti = listOf(Color(0xFF22C55E), Color(0xFF3B82F6), Color(0xFFF97316), Color(0xFFEF4444), Color(0xFFA855F7), Color(0xFFEAB308))
}

@Immutable
data class LabColors(
    val background: Color,
    val card: Color,
    val cardBorder: Color,
    val ink: Color,
    val muted: Color,
    val faint: Color,
    val accent: Color,
    val accentSoft: Color,
)

private val Light = LabColors(
    background = Color(0xFFF4F1EA),
    card = Color(0xFFFFFDF8),
    cardBorder = Color(0xFFE7E0D2),
    ink = Color(0xFF1C1B19),
    muted = Color(0xFF6B665C),
    faint = Color(0xFFEDE7DA),
    accent = Color(0xFFC2410C),
    accentSoft = Color(0xFFFFEDD5),
)

private val Dark = LabColors(
    background = Color(0xFF111113),
    card = Color(0xFF1C1C20),
    cardBorder = Color(0xFF2C2C33),
    ink = Color(0xFFF5F3EE),
    muted = Color(0xFFA19D94),
    faint = Color(0xFF26262C),
    accent = Color(0xFFFB923C),
    accentSoft = Color(0xFF3A2416),
)

val LocalLabColors = staticCompositionLocalOf { Light }

object Lab {
    val colors: LabColors @Composable get() = LocalLabColors.current
}

@Composable
fun LabTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) Dark else Light
    val scheme = if (dark) {
        darkColorScheme(primary = c.accent, background = c.background, surface = c.card, onBackground = c.ink, onSurface = c.ink)
    } else {
        lightColorScheme(primary = c.accent, background = c.background, surface = c.card, onBackground = c.ink, onSurface = c.ink)
    }
    val base = Typography()
    val typography = base.copy(
        displayLarge = TextStyle(fontSize = 64.sp, fontWeight = FontWeight.Medium, lineHeight = 76.sp),
        headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalLabColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}
