package dev.jeromeswannack.chineselearning.lab.ui.upnext

import androidx.compose.ui.graphics.Color
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpAmberInkDark
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpAmberInkLight
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabColors
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabDarkColors
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabLightColors
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Up next reads in both themes (Jerome, Nov 2026: "The Up next page doesn't look very good on dark mode" — the
 * ⚡ Today rows were a cream card with the dark theme's near-white words on it). Text ≥ 4.5:1 on what it sits on,
 * a button's outline ≥ 3:1 (WCAG 1.4.11, like ThemeContrastTest).
 */
class UpNextPaletteTest {
    private fun channel(v: Float): Double = if (v <= 0.03928f) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    private fun luminance(c: Color) = 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    private fun ratio(a: Color, b: Color): Double {
        val x = luminance(a); val y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    private fun atLeast(what: String, fg: Color, bg: Color, need: Double) {
        val r = ratio(fg, bg)
        assertTrue("$what = ${"%.2f".format(r)}:1 (needs ≥ $need)", r >= need)
    }

    private fun check(name: String, c: LabColors, p: UpNextPalette, bumpInk: Color) {
        // ⚡ Today row: the word, its meaning (ink), pinyin + source (muted), "⚡ from Minghui" (violet).
        atLeast("$name ink on a ⚡ Today row", c.ink, p.todayBg, 4.5)
        atLeast("$name muted on a ⚡ Today row", c.muted, p.todayBg, 4.5)
        atLeast("$name violet on a ⚡ Today row", p.violet, p.todayBg, 4.5)
        atLeast("$name violet on a card", p.violet, c.card, 4.5)
        // "↑ Up next" pill: label on its fill, outline on the row and on the page.
        atLeast("$name pill label", p.indigo, p.indigoSoft, 4.5)
        atLeast("$name pill outline on a ⚡ Today row", p.indigoLine, p.todayBg, 3.0)
        atLeast("$name pill outline on the page", p.indigoLine, c.background, 3.0)
        // The position badge, "✓ Up next" on a result, the drop-here row's words.
        atLeast("$name position number", p.indigo, p.indigoSoft, 4.5)
        atLeast("$name ✓ Up next on a card", p.indigo, c.card, 4.5)
        atLeast("$name ink on the drop-here row", c.ink, p.indigoSoft, 4.5)
        // The row's edge is visible against the page (a quiet edge, like a card's), and the row is not the card.
        assertTrue("$name ⚡ Today row differs from a card", luminance(p.todayBg) != luminance(c.card))
        // The Undo toast: white words.
        atLeast("$name toast", Color.White, p.toastBg, 4.5)
        // ⚡ words in amber (chip, "⚡ First in today’s study").
        atLeast("$name ⚡ amber words on a card", bumpInk, c.card, 4.5)
        atLeast("$name ⚡ amber words on the page", bumpInk, c.background, 4.5)
    }

    @Test fun light() = check("light", LabLightColors, UpNextLight, BumpAmberInkLight)

    @Test fun dark() = check("dark", LabDarkColors, UpNextDark, BumpAmberInkDark)
}
