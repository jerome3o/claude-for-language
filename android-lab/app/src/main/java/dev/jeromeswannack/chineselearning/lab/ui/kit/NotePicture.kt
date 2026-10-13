package dev.jeromeswannack.chineselearning.lab.ui.kit

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.noteimages.NoteImages
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A note's picture (the web's components/noteImage/NoteImage.tsx; core cards/NoteImage.kt):
 * a modest rounded square — the answer row never leaves the folded phone's screen — and a tap
 * shows it big. Nothing at all when there is no picture, or offline before it was downloaded.
 * [preview] draws a given bitmap (screenshots).
 */
@Composable
fun NotePicture(
    imageKey: String?,
    size: Dp,
    modifier: Modifier = Modifier,
    side: String? = null,
    cardType: String? = null,
    enlarge: Boolean = true,
    tag: String = NOTE_PICTURE_TAG,
    preview: ImageBitmap? = null,
) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val bitmap by produceState(preview, imageKey, preview) {
        if (preview != null || imageKey.isNullOrBlank() || app == null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val file = NoteImages(app.repo.api, app.repo.dao, app.filesDir).image(imageKey, online = true)
                file?.let { BitmapFactory.decodeFile(it.absolutePath)?.asImageBitmap() }
            }.getOrNull()
        }
    }
    val b = bitmap ?: return
    var open by remember { mutableStateOf(false) }
    Image(
        b,
        "Picture for this card",
        modifier
            .testTag(tag)
            .size(size)
            .clip(RoundedCornerShape(if (size < 64.dp) 8.dp else 16.dp))
            .background(Lab.colors.faint)
            .then(if (enlarge) Modifier.clickable {
                open = true
                if (side != null) app?.analytics?.track("card.picture_open", mapOf("side" to side, "card_type" to cardType))
            } else Modifier),
        contentScale = ContentScale.Crop,
    )
    if (open) {
        Dialog(onDismissRequest = { open = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(
                Modifier.fillMaxSize().background(Color(0xDB0F172A))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { open = false }
                    .testTag(NOTE_PICTURE_BIG_TAG),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    b, "Picture for this card",
                    Modifier.padding(16.dp).widthIn(max = 720.dp).fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(18.dp)),
                    contentScale = ContentScale.Fit,
                )
            }
        }
    }
}

const val NOTE_PICTURE_TAG = "note-picture"
const val NOTE_PICTURE_BIG_TAG = "note-picture-big"
