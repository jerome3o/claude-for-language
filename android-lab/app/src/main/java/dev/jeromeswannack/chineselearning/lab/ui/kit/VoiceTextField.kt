package dev.jeromeswannack.chineselearning.lab.ui.kit

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxProtocol
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPrefs
import dev.jeromeswannack.chineselearning.lab.ui.study.devicePinyinLine
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags (prefix + suffix, like the web's data-testid `voice-input-*`). */
object VoiceTextFieldTags {
    const val ROOT = "voice-input"
    const val SAY = "voice-input-say"
    const val TYPE = "voice-input-type"
    const val STOP = "voice-input-stop"
    const val CANCEL = "voice-input-cancel"
    const val LIVE = "voice-input-live"
    const val REVIEW = "voice-input-review"
    const val REVIEW_TEXT = "voice-input-review-text"
    const val RETAKE = "voice-input-retake"
    const val EDIT = "voice-input-edit"
    const val SUBMIT = "voice-input-submit"
    const val TEXT = "voice-input-text"
    const val MIC = "voice-input-mic"
    const val RETRY_UPLOAD = "voice-input-retry-upload"
    const val BLOCKED = "voice-input-blocked"
}

/** The buttons of [VoiceTextFieldContent] (stateless, so screenshot tests can render every state). */
data class VoiceTextFieldActions(
    val say: () -> Unit = {},
    val stop: () -> Unit = {},
    val cancel: () -> Unit = {},
    val retake: () -> Unit = {},
    val edit: () -> Unit = {},
    val type: () -> Unit = {},
    val submit: () -> Unit = {},
    val retryUpload: () -> Unit = {},
)

/**
 * A voice-first text box — "say it, or type it" (the web's `VoiceTextInput`; rules in core
 * [VoiceDictation]; docs/STUDY_SESSION.md "Voice-first text boxes"): ✏️ Type · 🎤 Say it → ✕ Cancel ·
 * ⏹ Stop with the words streaming in → the review, 🔁 Retry · ✏️ Edit · ✓ Submit, no keyboard until
 * Edit / Type; the typing box keeps a 🎤 to go back; offline / no microphone → typing with a reason.
 * [onSubmit] gets the text and where it came from (spoken | edited | typed).
 */
@Composable
fun VoiceTextField(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: (DictatedAnswer) -> Unit,
    surface: String,
    modifier: Modifier = Modifier,
    submitLabel: String = VoiceDictation.Copy.SUBMIT,
    placeholder: String = "",
    multiline: Boolean = false,
    lang: String = "zh",
    defaultMode: String? = null,
    enabled: Boolean = true,
    autoSubmit: Boolean = false,
) {
    val controller = rememberVoiceDictation(surface, lang, defaultMode, autoSubmit)
    val ui by controller.ui.collectAsState()
    val latestValue by rememberUpdatedState(value)
    val submit by rememberUpdatedState(onSubmit)
    val fill by rememberUpdatedState(onValueChange)
    LaunchedEffect(controller) {
        controller.onSubmit = { submit(it) }
        controller.onFill = { fill(it) }
    }
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) controller.say(latestValue) else controller.micUnavailable("denied")
    }
    val say: () -> Unit = {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) controller.say(latestValue) else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    VoiceTextFieldContent(
        ui = ui,
        value = value,
        onValueChange = onValueChange,
        actions = VoiceTextFieldActions(
            say = say,
            stop = controller::stop,
            cancel = controller::cancel,
            retake = say,
            edit = controller::edit,
            type = controller::type,
            submit = { controller.submit(latestValue) },
            retryUpload = controller::retryUpload,
        ),
        modifier = modifier,
        submitLabel = submitLabel,
        placeholder = placeholder,
        multiline = multiline,
        lang = lang,
        enabled = enabled,
    )
}

/** The controller for one box, wired to the app (recorder, live key, upload, analytics, connection). */
@Composable
fun rememberVoiceDictation(surface: String, lang: String = "zh", defaultMode: String? = null, autoSubmit: Boolean = false): VoiceDictationController {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val app = context.applicationContext as? LabApp
    val online = app?.online?.collectAsState()
    val forced = app?.let { StudyPrefs.get(it).forcedOffline.collectAsState() }
    val isOnline = { (online?.value ?: false) && forced?.value != true }
    val controller = remember(surface) {
        val engine: DictationEngine = if (app != null) AppDictationEngine(app, scope) else NoDictationEngine
        VoiceDictationController(
            scope = scope,
            engine = engine,
            surface = surface,
            lang = lang,
            defaultMode = defaultMode,
            online = { (app?.online?.value ?: false) && app?.let { StudyPrefs.get(it).forcedOffline.value } != true },
            track = { name, props -> app?.analytics?.track(name, props) },
            autoSubmit = autoSubmit,
            onLiveError = { reason ->
                android.util.Log.w("voice-input", "live gave nothing, uploaded instead: $reason")
                if (SonioxProtocol.invalidatesKey(reason)) (engine as? AppDictationEngine)?.invalidateKey()
            },
        ).also { c -> if (engine is AppDictationEngine) c.onDispose = { engine.release() } }
    }
    val connected = isOnline()
    LaunchedEffect(connected) { controller.refreshBlocked() }
    DisposableEffect(controller) { onDispose { controller.dispose(); controller.onDispose() } }
    return controller
}

/** No microphone here (previews / tests without the app). */
private object NoDictationEngine : DictationEngine {
    override fun open(languageHints: List<String>, onUpdate: (SonioxProtocol.Transcript) -> Unit) = null
    override fun start(live: dev.jeromeswannack.chineselearning.lab.ui.study.LiveStream?) = false
    override fun stop(): java.io.File? = null
    override val mime = "audio/wav"
    override suspend fun upload(take: java.io.File, mime: String, liveError: String?): String = throw java.io.IOException("no engine")
}

/** The box, rendered from [ui] (stateless). */
@Composable
fun VoiceTextFieldContent(
    ui: VoiceDictationUi,
    value: String,
    onValueChange: (String) -> Unit,
    actions: VoiceTextFieldActions,
    modifier: Modifier = Modifier,
    submitLabel: String = VoiceDictation.Copy.SUBMIT,
    placeholder: String = "",
    multiline: Boolean = false,
    lang: String = "zh",
    enabled: Boolean = true,
    filledFromVoice: String? = null,
) {
    val state = ui.state
    val controls = VoiceDictation.controls(state)
    Column(modifier.fillMaxWidth().testTag(VoiceTextFieldTags.ROOT), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.mode == VoiceDictation.TYPE) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { if (state.blocked == null) runCatching { focus.requestFocus() } }
            // A TextFieldValue so text put in from outside (✏️ Edit) has its caret at the end.
            var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
            if (field.text != value) field = TextFieldValue(value, TextRange(value.length))
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = field,
                    onValueChange = { field = it; if (it.text != value) onValueChange(it.text) },
                    enabled = enabled,
                    placeholder = { if (placeholder.isNotEmpty()) Text(placeholder, color = Lab.colors.muted) },
                    singleLine = !multiline,
                    minLines = if (multiline) 3 else 1,
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = Lab.colors.ink),
                    keyboardOptions = KeyboardOptions(imeAction = if (multiline) ImeAction.Default else ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { actions.submit() }),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.weight(1f).focusRequester(focus).testTag(VoiceTextFieldTags.TEXT),
                )
                if ("mic" in controls) {
                    Box(
                        Modifier
                            .padding(top = 4.dp)
                            .size(52.dp)
                            .clip(CircleShape)
                            .border(1.dp, Lab.colors.cardBorder, CircleShape)
                            .background(Lab.colors.card)
                            .bouncyClickable(enabled, 0.92f, onClick = actions.say)
                            .semantics { contentDescription = VoiceDictation.Copy.MIC_LABEL }
                            .testTag(VoiceTextFieldTags.MIC),
                        contentAlignment = Alignment.Center,
                    ) { Text("🎤", fontSize = 22.sp) }
                }
            }
            state.blocked?.let { b ->
                Text(
                    VoiceDictation.blockReason(b),
                    style = MaterialTheme.typography.bodySmall,
                    color = Lab.colors.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().testTag(VoiceTextFieldTags.BLOCKED),
                )
            }
            PrimaryPill(
                "✓  $submitLabel",
                Modifier.fillMaxWidth().height(56.dp).testTag(VoiceTextFieldTags.SUBMIT),
                enabled = enabled && VoiceDictation.answer(state, "", value, filledFromVoice) != null,
                onClick = actions.submit,
            )
            return@Column
        }

        if (ui.busy) LiveBox(ui)
        if (ui.phase == "review") ReviewText(ui.finalText, lang)
        if ("retry_upload" in controls) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Palette.Again.copy(alpha = 0.10f))
                    .border(1.dp, Palette.Again.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                    .clickable(onClick = actions.retryUpload)
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 14.dp, vertical = 7.dp)
                    .testTag(VoiceTextFieldTags.RETRY_UPLOAD),
            ) {
                Text(
                    if (ui.failure == "offline") VoiceDictation.Copy.OFFLINE else VoiceDictation.Copy.FAILED,
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center,
                )
                Text(VoiceDictation.Copy.FAILED_NOTE, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (c in controls) {
                when (c) {
                    "type" -> Side("✏️ ${VoiceDictation.Copy.TYPE}", VoiceTextFieldTags.TYPE, "Type instead", enabled, actions.type)
                    "say" -> Wide("🎤  ${VoiceDictation.Copy.SAY}", VoiceTextFieldTags.SAY, enabled, Lab.colors.accent, actions.say)
                    "cancel" -> Side("✕ ${VoiceDictation.Copy.CANCEL}", VoiceTextFieldTags.CANCEL, VoiceDictation.Copy.CANCEL, enabled, actions.cancel)
                    "stop" -> Wide("⏹  ${VoiceDictation.Copy.STOP}", VoiceTextFieldTags.STOP, enabled, Palette.Again, actions.stop, "Stop and use what I said")
                    "finishing" -> Wide(VoiceDictation.Copy.FINISHING, VoiceTextFieldTags.STOP, false, Lab.colors.accent, {})
                    "retake" -> if (ui.phase == "failed") Wide("🔁  ${VoiceDictation.Copy.RETAKE}", VoiceTextFieldTags.RETAKE, enabled, Lab.colors.accent, actions.retake)
                        else Side("🔁 ${VoiceDictation.Copy.RETAKE}", VoiceTextFieldTags.RETAKE, VoiceDictation.Copy.RETAKE, enabled, actions.retake)
                    "edit" -> Side("✏️ ${VoiceDictation.Copy.EDIT}", VoiceTextFieldTags.EDIT, "Edit what I said", enabled, actions.edit)
                    "submit" -> Wide("✓  $submitLabel", VoiceTextFieldTags.SUBMIT, enabled, Lab.colors.accent, actions.submit)
                }
            }
        }
        if (ui.phase == "failed" && ui.failure == "empty") {
            Text(VoiceDictation.Copy.EMPTY, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Wide(label: String, tag: String, enabled: Boolean, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit, description: String = label) {
    PrimaryPill(label, Modifier.weight(1f).height(60.dp).testTag(tag).semantics { contentDescription = description }, enabled = enabled, color = color, onClick = onClick)
}

@Composable
private fun Side(label: String, tag: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    SecondaryPill(
        label,
        Modifier.height(60.dp).testTag(tag).semantics { contentDescription = description },
        enabled = enabled,
        horizontalPadding = 12.dp,
        fontSize = 14.sp,
        onClick = onClick,
    )
}

/** What is being said, live: confirmed text in ink, the provisional tail grey. */
@Composable
private fun LiveBox(ui: VoiceDictationUi) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clip(RoundedCornerShape(18.dp))
            .border(1.5.dp, Palette.Again.copy(alpha = 0.45f), RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(VoiceTextFieldTags.LIVE),
        contentAlignment = Alignment.Center,
    ) {
        if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) {
            Text(if (ui.phase == "finishing") VoiceDictation.Copy.FINISHING else VoiceDictation.Copy.LISTENING, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.muted)
        } else {
            Text(
                buildAnnotatedString {
                    append(ui.finalText)
                    pushStyle(SpanStyle(color = Lab.colors.muted.copy(alpha = 0.7f)))
                    append(ui.partialText)
                    pop()
                },
                style = MaterialTheme.typography.titleLarge,
                color = Lab.colors.ink,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The review: what was heard, big and read-only (hanzi with the phone's pinyin under it). */
@Composable
private fun ReviewText(text: String, lang: String) {
    val pinyin = remember(text, lang) { if (lang == "zh") devicePinyinLine(text) else "" }
    val size = when {
        lang != "zh" -> 22.sp
        text.length <= 6 -> 36.sp
        text.length <= 14 -> 30.sp
        else -> 24.sp
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag(VoiceTextFieldTags.REVIEW),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, fontSize = size, lineHeight = size * 1.25f, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag(VoiceTextFieldTags.REVIEW_TEXT))
        if (pinyin.isNotEmpty()) Text(pinyin, style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}
