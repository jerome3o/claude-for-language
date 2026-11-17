package dev.jeromeswannack.chineselearning.lab.ui.study

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * ONE look for every judged result (core ResultState, ResultStateUi): the components that show a verdict never pick
 * their own green / gold / orange (that is how the yellow "Contains" box, the Gold "≈ Nearly" and the orange round "✗"
 * drifted apart — Jerome, Nov 2026: "a discrepancy in the UX"). They go through ResultColors / resultSurface. Confetti
 * and spark colours are decoration, not a state, and may use the palette. Web twin: frontend
 * components/study/resultColors.test.ts.
 */
class ResultColorsGuardTest {
    private val files = listOf(
        "YouSaidBox.kt", "HardModeUi.kt", "SentenceRoundUi.kt", "SentenceListenUi.kt", "SentencePractiseUi.kt", "RightMomentUi.kt",
        "../lessons/SentenceCheckViews.kt",
    )
    private val forbidden = Regex("""Palette\.(Good|Gold|Hard|Partial\w*)|0xFF15803D|0xFF4ADE80|0xFFD97706|0xFFA16207""")

    private fun dir(): File {
        val candidates = listOf(
            File("src/main/java/dev/jeromeswannack/chineselearning/lab/ui/study"),
            File("app/src/main/java/dev/jeromeswannack/chineselearning/lab/ui/study"),
        )
        return candidates.first { it.isDirectory }
    }

    @Test
    fun resultComponentsUseTheOneStateColours() {
        val offenders = mutableListOf<String>()
        for (name in files) {
            File(dir(), name).readLines().forEachIndexed { i, line ->
                val code = line.substringBefore("//").trim()
                if (code.startsWith("*") || code.startsWith("/*")) return@forEachIndexed
                if ("Confetti" in code || "SparkBurst" in code || "ChipAll" in code) return@forEachIndexed
                if (forbidden.containsMatchIn(code)) offenders += "$name:${i + 1}: ${line.trim()}"
            }
        }
        assertTrue("Hard-coded result colours outside ResultStateUi:\n" + offenders.joinToString("\n"), offenders.isEmpty())
    }
}
