package dev.jeromeswannack.chineselearning.lab.ui.cards

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.cards.NoteImage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.noteimages.NoteImageView
import dev.jeromeswannack.chineselearning.lab.data.noteimages.NoteImages
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.NotePicture
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.profile.PhotoCropSheet
import dev.jeromeswannack.chineselearning.lab.ui.profile.PhotoFiles
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** What the Picture section shows (stateless panel, screenshot-tested). */
data class NotePictureUi(
    val imageKey: String? = null,
    val source: String? = null,
    val status: String? = null,
    val busy: String? = null,
    val error: String? = null,
    val online: Boolean = true,
) {
    val state: String get() = NoteImage.state(imageKey, status)
}

class NotePictureActions(
    val onGenerate: () -> Unit = {},
    val onCamera: () -> Unit = {},
    val onChoose: () -> Unit = {},
    val onRemove: () -> Unit = {},
)

/**
 * The note's picture in the card editor and on the card hub — the web's NotePictureSection:
 * ✨ Generate picture (↻ Regenerate), 📷 Take photo, 🖼 Choose photo (square crop, ≤ 800 px JPEG
 * made on the phone — no EXIF), Remove. Acts at once (not part of the form's Save).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotePicturePanel(ui: NotePictureUi, actions: NotePictureActions, preview: ImageBitmap? = null) {
    Column(Modifier.fillMaxWidth().testTag(NOTE_PICTURE_SECTION_TAG), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Picture", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.padding(top = 10.dp))
        Text(
            "Shown with the English when you write the Chinese, and on the answer side of the other cards.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            val state = ui.state
            if (ui.imageKey != null && (state == "ready" || state == "pending")) {
                NotePicture(ui.imageKey, size = 112.dp, enlarge = true, tag = NOTE_PICTURE_PREVIEW_TAG, preview = preview)
            } else {
                PicturePlaceholder(state)
            }
            FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val idle = ui.busy == null && ui.online
                SecondaryPill(
                    when { ui.busy == "generate" -> "Starting…"; ui.imageKey != null -> "↻ Regenerate"; else -> "✨ Generate picture" },
                    Modifier.testTag(NOTE_PICTURE_GENERATE_TAG),
                    enabled = idle && state != "pending",
                ) { actions.onGenerate() }
                SecondaryPill("📷 Take photo", enabled = idle) { actions.onCamera() }
                SecondaryPill("🖼 Choose photo", enabled = idle) { actions.onChoose() }
                if (ui.imageKey != null) SecondaryPill(if (ui.busy == "remove") "…" else "Remove", enabled = idle) { actions.onRemove() }
            }
        }
        if (ui.state == "pending" && ui.imageKey != null) Text("Drawing a new picture…", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        if (ui.source == "upload" && ui.state == "ready") Text("Your own picture", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        if (!ui.online) InlineNotice("You're offline — pictures change when you're back online.", kind = NoticeKind.Offline)
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
    }
}

@Composable
private fun PicturePlaceholder(state: String) {
    val drawing = state == "pending"
    val pulse by rememberInfiniteTransition(label = "drawing").animateFloat(
        0.55f, 1f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "pulse",
    )
    Box(
        Modifier.size(112.dp).clip(RoundedCornerShape(16.dp))
            .then(if (drawing) Modifier.background(Lab.colors.faint).alpha(pulse) else Modifier.border(2.dp, Lab.colors.faint, RoundedCornerShape(16.dp)))
            .padding(8.dp)
            .testTag(if (drawing) NOTE_PICTURE_DRAWING_TAG else NOTE_PICTURE_EMPTY_TAG),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            when (state) { "pending" -> "Drawing the picture…"; "failed" -> "The picture couldn’t be drawn — try again"; else -> "No picture yet" },
            style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, textAlign = TextAlign.Center,
        )
    }
}

/** The stateful Picture section for [noteId]: reads Room, calls the API, polls while drawing. */
@Composable
fun NotePictureSection(app: LabApp, noteId: String, where: String, onChange: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val images = remember { NoteImages(app.repo.api, app.repo.dao, app.filesDir) }
    val online by app.online.collectAsState()
    var ui by remember(noteId) { mutableStateOf(NotePictureUi()) }
    var photo by remember { mutableStateOf<Bitmap?>(null) }
    var photoFromCamera by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }

    fun apply(v: NoteImageView) {
        ui = ui.copy(imageKey = v.image_key, source = v.image_source, status = v.image_status, busy = null)
        onChange()
    }

    fun act(busy: String, block: suspend () -> NoteImageView) {
        ui = ui.copy(busy = busy, error = null)
        scope.launch {
            try {
                apply(withContext(Dispatchers.IO) { block() })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ui = ui.copy(busy = null, error = e.userMessage())
            }
        }
    }

    LaunchedEffect(noteId) {
        val n = withContext(Dispatchers.IO) { app.repo.dao.note(noteId) }
        ui = ui.copy(imageKey = n?.imageKey, source = n?.imageSource, status = n?.imageStatus)
    }
    // While a picture is being drawn: ask every 3 s (the web's pollNoteImage).
    LaunchedEffect(noteId, ui.state) {
        if (ui.state != "pending") return@LaunchedEffect
        repeat(80) {
            delay(3_000)
            val v = runCatching { withContext(Dispatchers.IO) { images.get(noteId) } }.getOrNull() ?: return@repeat
            apply(v)
            if (v.image_status != "pending") return@LaunchedEffect
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { photoFromCamera = false; photo = decode(context, uri) { ui = ui.copy(error = it) } }
    }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri
        if (ok && uri != null) scope.launch { photoFromCamera = true; photo = decode(context, uri) { ui = ui.copy(error = it) } }
    }

    NotePicturePanel(
        ui.copy(online = online),
        NotePictureActions(
            onGenerate = {
                val regenerate = ui.imageKey != null
                act("generate") { images.generate(noteId, regenerate) }
                app.analytics.track("card.picture_generate", mapOf("regenerate" to regenerate, "where" to where))
            },
            onCamera = {
                val dir = File(context.cacheDir, "shared").apply { mkdirs() }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", File(dir, "card-picture-camera.jpg"))
                cameraUri = uri
                camera.launch(uri)
            },
            onChoose = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            onRemove = { confirmRemove = true },
        ),
    )
    if (confirmRemove) {
        ConfirmDialog(
            title = "Remove the picture?",
            text = "Take the picture off this card.",
            confirmLabel = "Remove",
            danger = true,
            onConfirm = {
                act("remove") { images.remove(noteId) }
                app.analytics.track("card.picture_remove", mapOf("where" to where))
            },
            onDismiss = { confirmRemove = false },
        )
    }
    photo?.let { bmp ->
        PhotoCropSheet(
            photo = bmp,
            busy = ui.busy == "upload",
            error = ui.error,
            onCancel = { photo = null },
            onConfirm = { rect ->
                val camera = photoFromCamera
                act("upload") {
                    val jpeg = PhotoFiles.renderJpeg(bmp, rect, File(app.cacheDir, "card-pictures"), target = NoteImage.UPLOAD_PX, name = "card-picture.jpg")
                    try { images.upload(noteId, jpeg) } finally { jpeg.delete() }
                }
                app.analytics.track("card.picture_upload", mapOf("camera" to camera, "where" to where))
                photo = null
            },
            title = "Crop the picture",
            round = false,
            confirmLabel = "Use this picture",
        )
    }
    DisposableEffect(noteId) { onDispose { photo = null } }
}

private suspend fun decode(context: Context, uri: Uri, onError: (String) -> Unit): Bitmap? = try {
    withContext(Dispatchers.IO) { PhotoFiles.decode(context, uri) }
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    onError("This photo couldn't be opened. Try a JPEG or PNG.")
    null
}

const val NOTE_PICTURE_SECTION_TAG = "note-picture-section"
const val NOTE_PICTURE_PREVIEW_TAG = "note-picture-preview"
const val NOTE_PICTURE_GENERATE_TAG = "note-picture-generate"
const val NOTE_PICTURE_EMPTY_TAG = "note-picture-empty"
const val NOTE_PICTURE_DRAWING_TAG = "note-picture-drawing"
