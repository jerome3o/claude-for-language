package dev.jeromeswannack.chineselearning.lab.ui.editor

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * An illustration by its R2 key (reader pages, describe_image): the phone's copy first
 * (downloaded once into files/editor-images), else fetched from `/api/audio/<key>` — the web's
 * `useCachedImageUrl`. Shows a soft placeholder while loading or offline.
 */
@Composable
fun EditorImage(key: String?, modifier: Modifier = Modifier, height: Dp? = null, description: String? = null, crop: Boolean = false) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val bitmap by produceState<ImageBitmap?>(null, key) {
        if (key.isNullOrBlank() || app == null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(app.filesDir, "editor-images").apply { mkdirs() }
                val file = File(dir, key.replace(Regex("[^A-Za-z0-9._-]"), "_"))
                if (!file.exists() || file.length() == 0L) app.repo.api.download(Config.audioUrl(key, app.repo.api.baseUrl), file)
                BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap()
            }.getOrNull()
        }
    }
    val sized = if (height != null) modifier.height(height) else modifier
    val b = bitmap
    if (b != null) {
        Image(b, description, sized, contentScale = if (crop) ContentScale.Crop else ContentScale.FillWidth)
    } else {
        Box(sized.fillMaxWidth().height(height ?: 160.dp).background(Lab.colors.faint), contentAlignment = Alignment.Center) {}
    }
}
