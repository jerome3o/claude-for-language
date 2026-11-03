package dev.jeromeswannack.chineselearning.lab.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Buttons must read as buttons in both themes (Jerome: "in dark mode a lot of the buttons that
 * are a darker colour end up having no outline"). WCAG 1.4.11 non-text contrast: a button's
 * outline ≥ 3:1 against every surface it sits on; a label on the accent fill ≥ 4.5:1.
 * The web's twin: frontend/src/theme/buttonContrast.test.ts.
 */
class ThemeContrastTest {
    private fun channel(v: Float): Double = if (v <= 0.03928f) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    private fun luminance(c: Color) = 0.2126 * channel(c.red) + 0.7152 * channel(c.green) + 0.0722 * channel(c.blue)
    private fun ratio(a: Color, b: Color): Double {
        val x = luminance(a); val y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    private fun check(name: String, c: LabColors) {
        // Where buttons sit: the page, a card, and a button's own grey fill; accentSoft = a selected option.
        val surfaces = mapOf("background" to c.background, "card" to c.card, "faint" to c.faint, "accentSoft" to c.accentSoft)
        for ((s, bg) in surfaces) {
            val o = ratio(c.outline, bg)
            assertTrue("$name outline on $s = ${"%.2f".format(o)}:1 (needs ≥ 3)", o >= 3.0)
            val a = ratio(c.accentOutline, bg)
            assertTrue("$name accentOutline on $s = ${"%.2f".format(a)}:1 (needs ≥ 3)", a >= 3.0)
        }
        for (s in listOf("background" to c.background, "card" to c.card)) {
            val f = ratio(c.accent, s.second)
            assertTrue("$name primary fill on ${s.first} = ${"%.2f".format(f)}:1 (needs ≥ 3)", f >= 3.0)
        }
        val label = ratio(c.onAccent, c.accent)
        assertTrue("$name label on the accent = ${"%.2f".format(label)}:1 (needs ≥ 4.5)", label >= 4.5)
        // A disabled button's label (muted) stays readable on its grey fill.
        val muted = ratio(c.muted, c.faint)
        assertTrue("$name disabled label on faint = ${"%.2f".format(muted)}:1 (needs ≥ 3)", muted >= 3.0)
    }

    /** A translucent [top] over an opaque [under]. */
    private fun over(top: Color, under: Color) = Color(
        top.red * top.alpha + under.red * (1 - top.alpha),
        top.green * top.alpha + under.green * (1 - top.alpha),
        top.blue * top.alpha + under.blue * (1 - top.alpha),
    )

    /** 🎤 Read it aloud's marks (Jerome, dark mode: "pretty scuffed and hard to read"): visible marks, readable ink. */
    private fun checkMarks(name: String, c: LabColors) {
        for ((mark, tint) in listOf("tone" to (c.markTone to c.markToneTint), "wrong" to (c.markWrong to c.markWrongTint))) {
            val bg = over(tint.second, c.card)
            assertTrue("$name $mark mark on the card", ratio(tint.first, c.card) >= 3.0)
            assertTrue("$name $mark mark on its tint", ratio(tint.first, bg) >= 3.0)
            val ink = ratio(c.ink, bg)
            assertTrue("$name ink on the $mark tint = ${"%.2f".format(ink)}:1 (needs ≥ 4.5)", ink >= 4.5)
        }
    }

    @Test fun readAloudMarksReadInBothThemes() {
        checkMarks("dark", LabDarkColors)
        checkMarks("light", LabLightColors)
    }

    @Test fun darkButtonsHaveVisibleOutlines() = check("dark", LabDarkColors)

    @Test fun lightButtonsHaveVisibleOutlines() = check("light", LabLightColors)

    /** The card edge is deliberately quiet — which is why buttons must never use it as their outline. */
    @Test fun cardBorderIsTooQuietForAButton() {
        assertTrue(ratio(LabDarkColors.cardBorder, LabDarkColors.card) < 3.0)
        assertTrue(ratio(LabDarkColors.outline, LabDarkColors.card) > ratio(LabDarkColors.cardBorder, LabDarkColors.card) * 2)
    }
}
