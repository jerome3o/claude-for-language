package dev.jeromeswannack.chineselearning.lab.ui.feedback

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import dev.jeromeswannack.chineselearning.lab.core.feedback.FeedbackRules
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** The Send feedback sheet (docs/FEEDBACK.md): after a shake, typed, and done. */
class FeedbackScreenshots : LabScreenshotTest() {
    /** A stand-in for the captured window: a study card. */
    private fun fakeScreen(): ImageBitmap {
        val bmp = ImageBitmap(412, 915)
        val c = Canvas(bmp)
        val paint = Paint()
        paint.color = Color(0xFFFEF3F2); c.drawRect(0f, 0f, 412f, 915f, paint)
        paint.color = Color.White; c.drawRect(24f, 120f, 388f, 640f, paint)
        paint.color = Color(0xFF6366F1); c.drawRect(24f, 820f, 388f, 876f, paint)
        paint.color = Color(0xFF111827); c.drawRect(150f, 300f, 262f, 360f, paint)
        return bmp
    }

    private val line = FeedbackRules.contextLine("lab", "0.142 (142)", "/study", "Google Pixel 9 Pro Fold", "Android 16", true, "shake")

    private fun frame(content: @androidx.compose.runtime.Composable () -> Unit) = @androidx.compose.runtime.Composable {
        Box(Modifier.fillMaxSize().background(Lab.colors.background), contentAlignment = Alignment.BottomCenter) {
            Box(Modifier.background(Lab.colors.card)) { content() }
        }
    }

    @Test fun shaken() = shoot("feedback-01-shaken") {
        frame {
            FeedbackSheetBody(FeedbackSheetUi(kind = "bug", screenshot = fakeScreen(), contextLine = line), FeedbackSheetActions(), voicePreview = VoiceDictationUi())
        }()
    }

    @Test fun typed() = shoot("feedback-02-typed") {
        frame {
            FeedbackSheetBody(
                FeedbackSheetUi(kind = "bug", message = "The rating buttons jumped under my thumb after I pressed Show answer.", screenshot = fakeScreen(), contextLine = line),
                FeedbackSheetActions(),
                voicePreview = VoiceDictationUi(mode = "type"),
            )
        }()
    }

    @Test fun withoutScreenshot() = shoot("feedback-03-no-screenshot") {
        frame {
            FeedbackSheetBody(
                FeedbackSheetUi(kind = "feedback", message = "Could the deck list show how many words are left?", screenshot = fakeScreen(), includeScreenshot = false, contextLine = line.replace(" · shaken", "")),
                FeedbackSheetActions(),
                voicePreview = VoiceDictationUi(mode = "type"),
            )
        }()
    }

    @Test fun done() = shoot("feedback-04-queued") {
        frame { FeedbackSheetBody(FeedbackSheetUi(done = FeedbackRules.Copy.QUEUED), FeedbackSheetActions()) }()
    }
}
