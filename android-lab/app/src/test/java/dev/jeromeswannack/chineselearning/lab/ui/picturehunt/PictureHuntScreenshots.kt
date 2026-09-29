package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.HuntBox
import dev.jeromeswannack.chineselearning.lab.core.HuntFeedback
import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.core.HuntRegion
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import org.robolectric.annotation.Config

/** A drawn kitchen scene with a few boxes and polygons (no network, no real photo). */
object SampleHunt {
    private fun o(id: String, hanzi: String, pinyin: String, english: String, vararg regions: HuntRegion, alternatives: List<String> = emptyList()) =
        HuntObject(id, hanzi, pinyin, english, alternatives, regions = regions.toList())

    private fun box(x: Double, y: Double, w: Double, h: Double) = HuntRegion(HuntBox(x, y, w, h))
    private fun poly(x: Double, y: Double, w: Double, h: Double, vararg pts: Pair<Double, Double>) =
        HuntRegion(HuntBox(x, y, w, h), pts.map { listOf(it.first, it.second) })

    val objects = listOf(
        o("o1", "桌子", "zhuōzi", "table", box(0.08, 0.62, 0.84, 0.30), alternatives = listOf("饭桌")),
        o(
            "o2", "茶杯", "chábēi", "teacup",
            poly(0.22, 0.47, 0.12, 0.15, 0.22 to 0.47, 0.34 to 0.47, 0.32 to 0.62, 0.24 to 0.62),
            poly(0.62, 0.49, 0.10, 0.13, 0.62 to 0.49, 0.72 to 0.49, 0.705 to 0.62, 0.635 to 0.62),
            alternatives = listOf("杯子"),
        ).copy(
            funFacts = "茶 (chá) tea + 杯 (bēi) cup: a cup for tea.\nAlso 杯子 for any cup.",
            sentenceClue = "桌子上有两个茶杯。",
            sentenceCluePinyin = "Zhuōzi shang yǒu liǎng gè chábēi.",
            sentenceClueTranslation = "There are two teacups on the table.",
        ),
        o("o3", "茶壶", "cháhú", "teapot", poly(0.40, 0.38, 0.18, 0.24, 0.43 to 0.40, 0.55 to 0.40, 0.58 to 0.52, 0.53 to 0.62, 0.45 to 0.62, 0.40 to 0.52)),
        o("o4", "台灯", "táidēng", "desk lamp", box(0.78, 0.18, 0.14, 0.44), alternatives = listOf("灯")),
        o("o5", "窗户", "chuānghu", "window", box(0.08, 0.06, 0.34, 0.30)),
        o("o6", "钟", "zhōng", "clock", poly(0.52, 0.06, 0.14, 0.18, 0.59 to 0.06, 0.66 to 0.15, 0.59 to 0.24, 0.52 to 0.15), alternatives = listOf("时钟")),
        o("o7", "苹果", "píngguǒ", "apple", box(0.80, 0.66, 0.08, 0.08)),
    )

    /** The scene, painted: wall, window, clock, lamp, table, pot, cups, apple. */
    val image: ImageBitmap by lazy {
        val w = 1200
        val h = 900
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        fun rect(x: Double, y: Double, bw: Double, bh: Double, color: Int, r: Float = 12f) { p.color = color; c.drawRoundRect(RectF((x * w).toFloat(), (y * h).toFloat(), ((x + bw) * w).toFloat(), ((y + bh) * h).toFloat()), r, r, p) }
        c.drawColor(0xFFF3E3C3.toInt())
        rect(0.0, 0.56, 1.0, 0.44, 0xFFB98B5E.toInt(), 0f)
        rect(0.08, 0.06, 0.34, 0.30, 0xFF7FB7E6.toInt())
        rect(0.245, 0.06, 0.01, 0.30, 0xFFFFFFFF.toInt(), 0f); rect(0.08, 0.205, 0.34, 0.01, 0xFFFFFFFF.toInt(), 0f)
        p.color = 0xFFFFFFFF.toInt(); c.drawCircle((0.59 * w).toFloat(), (0.15 * h).toFloat(), 0.065f * w, p)
        p.color = 0xFF333333.toInt(); p.strokeWidth = 8f
        c.drawLine((0.59 * w).toFloat(), (0.15 * h).toFloat(), (0.59 * w).toFloat(), (0.09 * h).toFloat(), p)
        c.drawLine((0.59 * w).toFloat(), (0.15 * h).toFloat(), (0.63 * w).toFloat(), (0.15 * h).toFloat(), p)
        rect(0.83, 0.30, 0.02, 0.32, 0xFF444444.toInt(), 4f); rect(0.78, 0.18, 0.14, 0.14, 0xFFF6C744.toInt(), 30f)
        rect(0.08, 0.62, 0.84, 0.06, 0xFF8A5A33.toInt(), 6f); rect(0.12, 0.68, 0.04, 0.24, 0xFF8A5A33.toInt(), 4f); rect(0.84, 0.68, 0.04, 0.24, 0xFF8A5A33.toInt(), 4f)
        rect(0.42, 0.42, 0.14, 0.20, 0xFF2F7D6D.toInt(), 60f); rect(0.54, 0.46, 0.05, 0.03, 0xFF2F7D6D.toInt(), 8f)
        rect(0.225, 0.48, 0.11, 0.14, 0xFFFFFFFF.toInt(), 14f); rect(0.625, 0.50, 0.09, 0.12, 0xFFFFFFFF.toInt(), 14f)
        p.color = 0xFFD7263D.toInt(); c.drawCircle((0.84 * w).toFloat(), (0.70 * h).toFloat(), 0.035f * w, p)
        bmp.asImageBitmap()
    }

    fun hunt(id: String, title: String, status: String, progress: String? = null, error: String? = null, best: Int? = null, plays: Int = 0) =
        PictureHuntDto(id, title, if (id == "u") "upload" else "generated", title, status, progress, error, objects.size, 1200, 900, best, plays, created_at = "2026-09-28 08:00:00", updated_at = "2026-09-28 08:00:00")
}

class PictureHuntScreenshots : LabScreenshotTest() {
    private val list = listOf(
        SampleHunt.hunt("g", "a street food market in China", "generating", progress = "naming 14 objects"),
        SampleHunt.hunt("k", "a busy home kitchen", "ready", best = 5, plays = 2),
        SampleHunt.hunt("n", "a classroom", "ready"),
        SampleHunt.hunt("e", "a train station platform", "error", error = "The picture came out without anything to name — try again."),
    )

    @Test fun list() = shoot("picture-hunt-01-list") {
        PictureHuntsScreen(PictureHuntsUi(hunts = Loadable(list), thumbs = mapOf("k" to SampleHunt.image), prompt = "a busy home kitchen"), PictureHuntsActions(onBack = {}))
    }

    @Test fun photoMode() = shoot("picture-hunt-02-photo") {
        PictureHuntsScreen(
            PictureHuntsUi(hunts = Loadable(list.drop(1)), thumbs = mapOf("k" to SampleHunt.image), mode = HuntSourceMode.UPLOAD, photo = PickedPhoto("PXL_20260928_081512.jpg", SampleHunt.image), caption = "我的厨房"),
            PictureHuntsActions(onBack = {}),
        )
    }

    private fun playing(found: List<String>, hint: HuntHint?, feedback: HuntFeedback?) = PictureHuntPlayUi(
        title = "a busy home kitchen",
        objects = SampleHunt.objects,
        image = SampleHunt.image,
        aspect = 4f / 3f,
        state = HuntPlayState(found = found, lastFound = null, hint = hint, hints = hint?.let { mapOf(it.objectId to 1) }.orEmpty(), hintsUsed = if (hint != null) 1 else 0, feedback = feedback, remainingSeconds = 187.0, bestBefore = 5),
        input = TextFieldValue("杯", TextRange(1)),
    )

    private val inProgress = playing(
        found = listOf("o1", "o2", "o6"),
        hint = HuntHint("o3", "茶＿"),
        feedback = HuntFeedback("found", "✓ 钟 · zhōng · clock"),
    )

    @Test fun play() = shoot("picture-hunt-03-play", settleMs = 500) { PictureHuntPlayScreen(inProgress, PictureHuntPlayActions()) }

    @Test fun closeFeedback() = shoot("picture-hunt-04-close", settleMs = 500) {
        PictureHuntPlayScreen(playing(listOf("o1"), null, HuntFeedback("close", "So close — something here has 茶 in its name")), PictureHuntPlayActions())
    }

    private val reveal = inProgress.copy(
        state = HuntPlayState(phase = HuntPhase.REVEAL, end = HuntEnd.GAVE_UP, found = listOf("o1", "o2", "o6"), bestBefore = 5),
        input = TextFieldValue(""),
    )

    @Test fun revealed() = shoot("picture-hunt-05-reveal", settleMs = 500) { PictureHuntPlayScreen(reveal, PictureHuntPlayActions()) }

    /** The object sheet as it sits over the reveal (drawn inline: Robolectric's root capture misses dialog windows). */
    @Test fun revealSheet() = shoot("picture-hunt-06-object-sheet", settleMs = 500) {
        Box(Modifier.fillMaxSize()) {
            PictureHuntPlayScreen(reveal, PictureHuntPlayActions())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)))
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Box(Modifier.padding4().clip(RoundedCornerShape(50)).background(Lab.colors.faint).sizeGrip())
                }
                ObjectSheetContent(SampleHunt.objects[1], found = true, online = true, actions = PictureHuntPlayActions())
            }
        }
    }

    @Test fun allFound() = shoot("picture-hunt-07-all-found", settleMs = 800) {
        PictureHuntPlayScreen(
            inProgress.copy(state = HuntPlayState(phase = HuntPhase.REVEAL, end = HuntEnd.ALL, found = SampleHunt.objects.map { it.id }, bestBefore = 5), input = TextFieldValue("")),
            PictureHuntPlayActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("picture-hunt-08-play-unfolded", settleMs = 500) { PictureHuntPlayScreen(inProgress, PictureHuntPlayActions()) }

    @Config(qualifiers = UNFOLDED)
    @Test fun listUnfolded() = shoot("picture-hunt-09-list-unfolded") {
        PictureHuntsScreen(PictureHuntsUi(hunts = Loadable(list), thumbs = mapOf("k" to SampleHunt.image)), PictureHuntsActions(onBack = {}))
    }

    @Test fun offline() = shoot("picture-hunt-10-offline-dark", dark = true) {
        PictureHuntsScreen(PictureHuntsUi(hunts = Loadable(list.drop(1), offline = true, updatedAt = System.currentTimeMillis() - 3_600_000), thumbs = mapOf("k" to SampleHunt.image), online = false), PictureHuntsActions(onBack = {}))
    }
}

private fun Modifier.padding4() = this.then(Modifier.padding(top = 10.dp, bottom = 6.dp))
private fun Modifier.sizeGrip() = this.then(Modifier.size(width = 40.dp, height = 4.dp))
