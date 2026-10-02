package dev.jeromeswannack.chineselearning.lab.ui.materials

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.jeromeswannack.chineselearning.lab.core.PptxSlides
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialPageDto
import dev.jeromeswannack.chineselearning.lab.data.materials.SlideDrawer
import dev.jeromeswannack.chineselearning.lab.ui.calls.MaterialPageSource

/** Lesson materials for screenshots: real lesson content, the slides painted by the app's own [SlideDrawer]. */
object MaterialsSamples {
    private const val W = 12_192_000.0
    private const val H = 6_858_000.0

    private fun p(text: String, size: Double = 0.0, bold: Boolean = false, color: String? = null, bullet: Boolean = false, level: Int = 0, align: String = "l") =
        PptxSlides.Paragraph(listOf(PptxSlides.Run(text, size, bold, color)), bullet, level, align)

    val slides = listOf(
        PptxSlides.Slide(
            0, W, H, "#FFF7ED",
            listOf(
                PptxSlides.TextBox(-1.0, -1.0, -1.0, -1.0, "ctrTitle", listOf(p("第五课：把字句", 54.0, true, "#9A3412", align = "ctr"))),
                PptxSlides.TextBox(-1.0, -1.0, -1.0, -1.0, "subTitle", listOf(p("Lesson 5 · the 把 construction", 24.0, color = "#7C2D12", align = "ctr"))),
            ),
            "Start with the picture of the messy room.",
        ),
        PptxSlides.Slide(
            1, W, H, null,
            listOf(
                PptxSlides.TextBox(-1.0, -1.0, -1.0, -1.0, "title", listOf(p("把 + object + verb + result", 40.0, true))),
                PptxSlides.TextBox(
                    600_000.0, 1_700_000.0, 11_000_000.0, 4_600_000.0, "body",
                    listOf(
                        p("我把作业做完了。", 30.0, bullet = true),
                        p("wǒ bǎ zuòyè zuò wán le — I finished my homework.", 20.0, color = "#6B7280", bullet = true, level = 1),
                        p("请把门关上。", 30.0, bullet = true),
                        p("qǐng bǎ mén guān shàng — Please close the door.", 20.0, color = "#6B7280", bullet = true, level = 1),
                        p("他把杯子打破了。", 30.0, bullet = true),
                    ),
                ),
            ),
            "Ask for three examples from his own week.",
        ),
        PptxSlides.Slide(
            2, W, H, "#ECFEFF",
            listOf(
                PptxSlides.TextBox(-1.0, -1.0, -1.0, -1.0, "title", listOf(p("练习 · Practice", 40.0, true, "#155E75"))),
                PptxSlides.TextBox(800_000.0, 1_800_000.0, 10_500_000.0, 3_600_000.0, null, listOf(p("把书放在桌子上 | 把窗户打开 | 把衣服洗干净", 26.0))),
            ),
            "",
        ),
    )

    fun slideBitmap(i: Int, width: Int = 1600): ImageBitmap {
        val s = slides[i % slides.size]
        val bmp = Bitmap.createBitmap(width, Math.round(width * s.height / s.width).toInt(), Bitmap.Config.ARGB_8888)
        SlideDrawer.draw(Canvas(bmp), s, width, emptyMap())
        return bmp.asImageBitmap()
    }

    val source = object : MaterialPageSource {
        override suspend fun page(materialId: String, page: Int): ImageBitmap = slideBitmap(page)
        override suspend fun notes(materialId: String): List<String> = slides.map { it.notes }
    }

    val lesson5 = MaterialDto(
        "m1", "u-tutor", "第五课 把字句 — slides", "pptx", "Lesson 5 – 把字句.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        2_400_000, "ready", 12, dev.jeromeswannack.chineselearning.lab.core.Materials.PPTX_RENDER_NOTE, true, 1, 1, mine = true, shared_with = listOf("r1"),
    )
    val list = listOf(
        lesson5,
        MaterialDto("m2", "u-tutor", "HSK 2 vocabulary — food", "pdf", "hsk2-food.pdf", "application/pdf", 880_000, "ready", 4, null, true, 1, 1, mine = true),
        MaterialDto("m3", "u-tutor", "Menu from 小龙坎", "image", "menu.jpg", "image/jpeg", 410_000, "ready", 1, null, false, 1, 1, mine = true),
        MaterialDto("m4", "u-tutor", "Tones drill", "pdf", "tones.pdf", "application/pdf", 0, "uploading", 0, null, false, 1, 1, mine = true),
        MaterialDto("m5", "u-other", "Reading: 我的周末", "pdf", "weekend.pdf", "application/pdf", 120_000, "ready", 3, null, true, 1, 1, mine = false, owner_name = "王老师"),
    )

    val detail = MaterialDetailDto(
        lesson5.copy(page_count = 3),
        slides.mapIndexed { i, s -> MaterialPageDto(i, 1600, 900, PptxSlides.slideText(s), s.notes, "/api/materials/m1/pages/$i/image") },
    )
}
