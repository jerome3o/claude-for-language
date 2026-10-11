package dev.jeromeswannack.chineselearning.lab.ui.kit

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation

/**
 * Voice-first boxes outside the lessons (the coach, the chat composer, Ask Claude, Discuss, Flag for
 * tutor — the web's `useVoiceDictation` + `VoiceTextInputView` used directly): the SAME controller as
 * [VoiceTextField] ([rememberVoiceDictation]) wired to the caller's text and submit, so a screen can lay
 * the states out its own way (the chat's one-row composer, the coach's action buttons on the review).
 *
 * [value] is the caller's typed text; [onFill] gets what ✏️ Edit puts in the box; [onSubmit] the answer.
 * The microphone permission is asked on the first 🎤; refused → typing with the reason.
 */
@Composable
fun rememberVoiceFirstActions(
    controller: VoiceDictationController,
    value: String,
    onFill: (String) -> Unit,
    onSubmit: (DictatedAnswer) -> Unit,
): VoiceTextFieldActions {
    val latestValue by rememberUpdatedState(value)
    val submit by rememberUpdatedState(onSubmit)
    val fill by rememberUpdatedState(onFill)
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
    return VoiceTextFieldActions(
        say = say,
        stop = controller::stop,
        cancel = controller::cancel,
        retake = say,
        edit = controller::edit,
        type = controller::type,
        submit = { controller.submit(latestValue) },
        retryUpload = controller::retryUpload,
    )
}

/**
 * A [VoiceTextField], or — when [preview] is given (screenshot tests, which have no microphone) — the
 * same box drawn in that state.
 */
@Composable
fun VoiceFirstField(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: (DictatedAnswer) -> Unit,
    surface: String,
    modifier: Modifier = Modifier,
    submitLabel: String = VoiceDictation.Copy.SUBMIT,
    placeholder: String = "",
    multiline: Boolean = false,
    lang: String = "zh",
    enabled: Boolean = true,
    preview: VoiceDictationUi? = null,
) {
    if (preview != null) {
        VoiceTextFieldContent(preview, value, onValueChange, VoiceTextFieldActions(), modifier, submitLabel, placeholder, multiline, lang, enabled)
    } else {
        VoiceTextField(value, onValueChange, onSubmit, surface, modifier, submitLabel, placeholder, multiline, lang, enabled = enabled)
    }
}
