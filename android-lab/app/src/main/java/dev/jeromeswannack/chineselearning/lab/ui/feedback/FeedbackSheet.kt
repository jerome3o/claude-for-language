package dev.jeromeswannack.chineselearning.lab.ui.feedback

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.feedback.FeedbackRules
import dev.jeromeswannack.chineselearning.lab.data.feedback.FeedbackCenter
import dev.jeromeswannack.chineselearning.lab.data.feedback.FeedbackPrefs
import dev.jeromeswannack.chineselearning.lab.data.feedback.FeedbackSendResult
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.ToggleRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceFirstField
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the sheet shows (stateless, so screenshot tests can render every state). */
data class FeedbackSheetUi(
    val kind: String = "feedback",
    val message: String = "",
    val screenshot: ImageBitmap? = null,
    val includeScreenshot: Boolean = true,
    val contextLine: String = "",
    val sending: Boolean = false,
    /** Sent / saved line once done. */
    val done: String? = null,
    val error: String? = null,
)

class FeedbackSheetActions(
    val setKind: (String) -> Unit = {},
    val setMessage: (String) -> Unit = {},
    val setIncludeScreenshot: (Boolean) -> Unit = {},
    val send: (String) -> Unit = {},
)

/**
 * The Send feedback sheet (the web's FeedbackSheet, docs/FEEDBACK.md): 🐛 Something's wrong / 💡 Idea,
 * the voice-first message box (say it, or type it — its Send sends), the screenshot of the window with
 * "Include screenshot" to leave it out, the context line. [voicePreview] draws the box in a fixed
 * state for screenshot tests (no microphone there).
 */
@Composable
fun FeedbackSheetBody(ui: FeedbackSheetUi, actions: FeedbackSheetActions, modifier: Modifier = Modifier, voicePreview: VoiceDictationUi? = null) {
    SheetScaffold(
        modifier,
        header = { SheetTitle(FeedbackRules.Copy.TITLE) },
        footer = null,
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
    ) {
        if (ui.done != null) {
            InlineNotice(ui.done, kind = NoticeKind.Success)
            return@SheetScaffold
        }
        ChipRow {
            LabChip(FeedbackRules.Copy.BUG_CHIP, Modifier.testTag("feedback-kind-bug"), selected = ui.kind == "bug", enabled = !ui.sending) { actions.setKind("bug") }
            LabChip(FeedbackRules.Copy.IDEA_CHIP, Modifier.testTag("feedback-kind-feedback"), selected = ui.kind == "feedback", enabled = !ui.sending) { actions.setKind("feedback") }
        }
        VoiceFirstField(
            value = ui.message,
            onValueChange = actions.setMessage,
            onSubmit = { a -> actions.send(a.text) },
            surface = "feedback",
            submitLabel = if (ui.sending) "Sending…" else "Send",
            placeholder = FeedbackRules.Copy.PLACEHOLDER,
            multiline = true,
            lang = "en",
            enabled = !ui.sending,
            preview = voicePreview,
        )
        ui.screenshot?.let { shot ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                Text(FeedbackRules.Copy.SCREENSHOT_ON, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                Switch(
                    checked = ui.includeScreenshot,
                    onCheckedChange = actions.setIncludeScreenshot,
                    enabled = !ui.sending,
                    modifier = Modifier.testTag("feedback-include-shot"),
                    colors = SwitchDefaults.colors(checkedTrackColor = Lab.colors.accent),
                )
            }
            if (ui.includeScreenshot) {
                Image(
                    shot,
                    contentDescription = "Screenshot of the app",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .heightIn(max = 280.dp)
                        .widthIn(max = 200.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(10.dp)),
                )
                Text(FeedbackRules.Copy.SCREENSHOT_NOTE, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
        if (ui.contextLine.isNotBlank()) Text(ui.contextLine, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (ui.message.isBlank() && ui.screenshot != null && ui.includeScreenshot) {
            SecondaryPill("Send the screenshot only", Modifier.padding(bottom = 8.dp).testTag("feedback-send-shot"), enabled = !ui.sending) { actions.send("") }
        }
    }
}

/** The sheet over the whole app while [FeedbackCenter] has a request (MainActivity). */
@Composable
fun FeedbackHost(app: LabApp) {
    val req by FeedbackCenter.request.collectAsState()
    val r = req ?: return
    val scope = rememberCoroutineScope()
    var ui by remember(r.id) { mutableStateOf(FeedbackSheetUi(kind = if (r.via == "shake") "bug" else "feedback", contextLine = r.context.line())) }
    val shot by produceState<ImageBitmap?>(null, r.id) {
        value = r.screenshot?.let { f -> withContext(Dispatchers.IO) { runCatching { BitmapFactory.decodeFile(f.absolutePath)?.asImageBitmap() }.getOrNull() } }
    }
    LaunchedEffect(ui.done) {
        if (ui.done != null) {
            delay(1600)
            FeedbackCenter.dismiss()
        }
    }
    LabSheetFrame(onDismiss = { if (!ui.sending) FeedbackCenter.dismiss() }) {
        FeedbackSheetBody(
            ui.copy(screenshot = shot),
            FeedbackSheetActions(
                setKind = { ui = ui.copy(kind = it) },
                setMessage = { ui = ui.copy(message = it, error = null) },
                setIncludeScreenshot = { ui = ui.copy(includeScreenshot = it) },
                send = { text ->
                    if (ui.sending) return@FeedbackSheetActions
                    ui = ui.copy(sending = true, error = null)
                    scope.launch {
                        val out = FeedbackCenter.send(app, r, text, ui.kind, ui.includeScreenshot && shot != null)
                        ui = when (out) {
                            FeedbackSendResult.Sent -> { app.haptics.tick(); ui.copy(sending = false, done = FeedbackRules.Copy.SENT) }
                            FeedbackSendResult.Queued -> ui.copy(sending = false, done = FeedbackRules.Copy.QUEUED)
                            is FeedbackSendResult.Failed -> ui.copy(sending = false, error = out.message)
                        }
                    }
                },
            ),
        )
    }
}

/** Settings → Feedback: Send feedback + "Shake to send feedback" (per device, on by default). */
@Composable
fun FeedbackSettingsCard(app: LabApp) {
    val prefs = remember { FeedbackPrefs(app) }
    var on by remember { mutableStateOf(prefs.shakeOn) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Feedback", style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
        Text("Something wrong, or an idea? Send it with a screenshot of the app.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        SecondaryPill("💬 Send feedback", Modifier.testTag("settings-send-feedback")) { FeedbackCenter.open(app, "settings") }
        ToggleRow("📳", FeedbackRules.Copy.SHAKE_SETTING, on, desc = "Never during a call or a recording") {
            on = it
            prefs.shakeOn = it
            app.analytics.track("settings.change", mapOf("setting" to "shake_feedback", "value" to if (it) "on" else "off"))
        }
    }
}

/**
 * A feedback item's screenshot in its detail sheet: private media (`/api/audio/feedback/…`), so it is
 * downloaded with the session (Api.download sends it) into the cache, then shown. Nothing while it
 * loads; a quiet line when it can't be fetched.
 */
@Composable
fun FeedbackScreenshot(app: LabApp, url: String) {
    val image by produceState<Result<ImageBitmap>?>(null, url) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = java.io.File(app.cacheDir, "feedback-shots").apply { mkdirs() }
                val file = java.io.File(dir, url.hashCode().toUInt().toString(16) + ".img")
                if (!file.exists() || file.length() == 0L) app.repo.api.download(dev.jeromeswannack.chineselearning.lab.Config.audioUrl(url), file)
                BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap() ?: error("not a picture")
            }
        }
    }
    val r = image ?: return
    r.onSuccess { bmp ->
        Image(
            bmp,
            contentDescription = "Screenshot",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(10.dp)),
        )
    }.onFailure {
        Text("Screenshot unavailable", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}
