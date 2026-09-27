package dev.jeromeswannack.chineselearning.lab.ui.profile

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.time.Instant

/**
 * A person's photo (an uploaded avatar at /api/audio/avatars/…, or their Google picture),
 * downloaded once into files/avatars and reused offline; their initial in a tinted circle
 * until it's there or when they have none. [preview] draws a bitmap directly (screenshots,
 * the just-cropped photo).
 */
@Composable
fun ProfilePhoto(url: String?, name: String?, email: String? = null, size: Dp = 44.dp, preview: ImageBitmap? = null) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val loaded by produceState<ImageBitmap?>(null, url, preview) {
        if (preview != null || url.isNullOrBlank() || app == null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(app.filesDir, "avatars").apply { mkdirs() }
                val file = File(dir, sha1(url) + ".img")
                if (!file.exists() || file.length() == 0L) app.repo.api.download(url, file)
                BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap()
            }.getOrNull()
        }
    }
    val bitmap = preview ?: loaded
    if (bitmap != null) {
        Image(bitmap, null, Modifier.size(size).clip(CircleShape), contentScale = ContentScale.Crop)
    } else {
        val initial = (name?.trim()?.takeIf { it.isNotEmpty() } ?: email?.takeIf { it.isNotBlank() } ?: "?").first().uppercase()
        Box(Modifier.size(size).clip(CircleShape).background(Lab.colors.accentSoft), contentAlignment = Alignment.Center) {
            Text(initial, color = Lab.colors.accent, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
        }
    }
}

private fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

/**
 * What someone wrote about themselves + their local time (the web's PersonAbout) — under the
 * name on the tutor / student page and in the Profile preview. Nothing when both are empty.
 */
@Composable
fun PersonAbout(about: String?, timeZone: String?, modifier: Modifier = Modifier, now: Instant? = null) {
    var tick by remember { mutableStateOf(now ?: Instant.now()) }
    if (now == null) LaunchedEffect(Unit) { while (true) { delay(30_000); tick = Instant.now() } }
    val time = ProfileRules.localTimeLabel(timeZone, tick)
    if (about.isNullOrBlank() && time == null) return
    Column(modifier) {
        if (!about.isNullOrBlank()) Text(about, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        if (time != null) Text("🕘 $time", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = if (about.isNullOrBlank()) Modifier else Modifier.padding(top = 6.dp))
    }
}
