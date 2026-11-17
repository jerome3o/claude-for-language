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

    /**
     * The answer diff's marks — COLOUR ONLY since Nov 2026 (Jerome: "we don't need the outlines and the color and the
     * underlines … make the colors a little bit more subtle as well. Not too subtle"): each mark is the character's own
     * colour, so it must read as text (≥ 4.5:1) on the card, the page and a result surface's tint ("You said" sits on
     * one), stay apart from the body ink, and the four stay apart from each other. Web twin: theme/answerMarks.test.ts.
     */
    private fun checkMarks(name: String, c: LabColors, wrongTone: Color, closeTone: Color) {
        val marks = listOf("wrong" to c.markWrong, "tone" to c.markTone, "extra" to c.markExtra, "missing" to c.markMissing)
        val surfaces = listOf(
            "card" to c.card, "background" to c.background,
            "wrong surface" to over(wrongTone.copy(alpha = 0.08f), c.card), "close surface" to over(closeTone.copy(alpha = 0.08f), c.card),
        )
        for ((mark, color) in marks) {
            for ((s, bg) in surfaces) {
                val r = ratio(color, bg)
                assertTrue("$name $mark on the $s = ${"%.2f".format(r)}:1 (needs ≥ 4.5)", r >= 4.5)
            }
            assertTrue("$name $mark vs the ink", ratio(color, c.ink) >= 1.5)
        }
        for ((i, a) in marks.withIndex()) for (b in marks.drop(i + 1)) {
            val d = kotlin.math.sqrt(
                ((a.second.red - b.second.red) * 255).toDouble().pow(2) + ((a.second.green - b.second.green) * 255).toDouble().pow(2) +
                    ((a.second.blue - b.second.blue) * 255).toDouble().pow(2),
            )
            assertTrue("$name ${a.first} vs ${b.first} too alike", d > 60)
        }
    }

    @Test fun answerDiffMarksReadInBothThemes() {
        // The result surfaces' colours (ResultColors.tone(WRONG / CLOSE)).
        checkMarks("dark", LabDarkColors, Color(0xFFEF4444), Color(0xFFFACC15))
        checkMarks("light", LabLightColors, Color(0xFFDC2626), Color(0xFFEAB308))
    }

    @Test fun darkButtonsHaveVisibleOutlines() = check("dark", LabDarkColors)

    @Test fun lightButtonsHaveVisibleOutlines() = check("light", LabLightColors)

    /** The card edge is deliberately quiet — which is why buttons must never use it as their outline. */
    @Test fun cardBorderIsTooQuietForAButton() {
        assertTrue(ratio(LabDarkColors.cardBorder, LabDarkColors.card) < 3.0)
        assertTrue(ratio(LabDarkColors.outline, LabDarkColors.card) > ratio(LabDarkColors.cardBorder, LabDarkColors.card) * 2)
    }
}
