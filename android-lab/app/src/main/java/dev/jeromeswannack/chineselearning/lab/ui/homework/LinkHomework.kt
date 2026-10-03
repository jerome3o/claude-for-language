package dev.jeromeswannack.chineselearning.lab.ui.homework

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.DueLabel
import dev.jeromeswannack.chineselearning.lab.core.HomeworkLinks
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/*
 * Link homework on the student's side (docs/HOMEWORK.md §8; web: pages/HomeworkPassPage.tsx
 * LinkPass): the title, site, YouTube thumbnail, the tutor's instructions, "Open link ↗"
 * (external browser), then "Mark as done" with an optional note back to the tutor — a `done`
 * event carrying `note`, offline-first through the HomeworkStore outbox like every pass event.
 */

/** Opens [url] in the browser / the app that handles it (YouTube, Bilibili…). False when nothing can. */
fun openExternal(context: Context, url: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (_: ActivityNotFoundException) {
    false
}

/**
 * A link's thumbnail (YouTube's public one), 16:9 with a ▶ over it; downloaded once into the
 * cache so it shows offline after. A dark frame with ▶ until it's there or offline. [preview]
 * draws a bitmap directly (screenshots).
 */
@Composable
fun LinkThumbnail(url: String, modifier: Modifier = Modifier, preview: ImageBitmap? = null) {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val loaded by produceState<ImageBitmap?>(null, url, preview) {
        if (preview != null || app == null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(app.cacheDir, "link-thumbs").apply { mkdirs() }
                val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
                val file = File(dir, "$name.jpg")
                if (!file.exists() || file.length() == 0L) app.repo.api.download(url, file)
                BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap()
            }.getOrNull()
        }
    }
    val bitmap = preview ?: loaded
    Box(
        modifier.aspectRatio(16f / 9f).clip(RoundedCornerShape(16.dp)).background(Color(0xFF111827)).testTag("link-thumbnail"),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.size(56.dp).clip(CircleShape).background(Color(0xCCEF4444)), contentAlignment = Alignment.Center) {
            Text("▶", color = Color.White, fontSize = 24.sp)
        }
    }
}

/** What the link page shows ([PassUi.Link]'s fields). */
data class LinkPassUi(
    val title: String,
    val url: String?,
    val instructions: String?,
    val thumbnailUrl: String?,
    val due: DueLabel,
    val tutorName: String?,
    /** Marked done (here or on another device). */
    val done: Boolean,
    /** The note sent with "Mark as done", if any. */
    val note: String?,
    val busy: Boolean = false,
    /** Done in this sitting (the celebration line). */
    val justDone: Boolean = false,
)

/** The link page body (inside the pass frame, under its top bar). */
@Composable
fun LinkPassContent(
    ui: LinkPassUi,
    onOpen: (String) -> Unit,
    onMarkDone: (String?) -> Unit,
    onClose: () -> Unit,
    thumbnailPreview: ImageBitmap? = null,
    initialNote: String = "",
) {
    var note by remember { mutableStateOf(initialNote) }
    var opened by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp).testTag("hw-link-pass"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 560.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val site = ui.url?.let { HomeworkLinks.linkSiteName(it) }.orEmpty()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("🔗 ${site.ifEmpty { "Link" }}", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                if (ui.done) dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill("done", dueColor("done"))
                else DueChip(ui.due)
            }
            Text(ui.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
            val thumb = ui.thumbnailUrl ?: ui.url?.let { HomeworkLinks.linkThumbnail(it) }
            if (thumb != null && ui.url != null) {
                LinkThumbnail(thumb, Modifier.fillMaxWidth(), preview = thumbnailPreview)
            }
            ui.instructions?.takeIf { it.isNotBlank() }?.let { text ->
                LabCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(ui.tutorName?.let { "From $it" } ?: "What to do", style = MaterialTheme.typography.labelLarge, color = Lab.colors.muted)
                        Text(text, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                    }
                }
            }
            if (ui.url != null) {
                PrimaryPill("Open link ↗", Modifier.fillMaxWidth().height(56.dp).testTag("hw-link-open")) { opened = true; onOpen(ui.url) }
            } else {
                InlineNotice("This link is missing — ask your tutor to send it again.", kind = NoticeKind.Warning)
            }
            if (ui.done) {
                LabCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(if (ui.justDone) "🎉 Done — ${ui.tutorName ?: "your tutor"} can see it." else "✓ You marked this done.", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Palette.Good)
                        ui.note?.takeIf { it.isNotBlank() }?.let { Text("Your note: “$it”", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink) }
                    }
                }
                SecondaryPill("Back to homework", Modifier.fillMaxWidth(), onClick = onClose)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            if (opened) "Finished? Mark it done — add a note for ${ui.tutorName ?: "your tutor"} if you like." else "When you've done it, mark it done.",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        )
                        OutlinedTextField(
                            note, { if (it.length <= HomeworkLinks.LINK_NOTE_MAX) note = it }, Modifier.fillMaxWidth().heightIn(min = 88.dp).testTag("hw-link-note"),
                            enabled = !ui.busy, label = { Text("Note for ${ui.tutorName ?: "your tutor"} (optional)") },
                            placeholder = { Text("e.g. 我听懂了大部分！第二段有点快。") },
                        )
                        PrimaryPill(
                            if (ui.busy) "Saving…" else "✓ Mark as done", Modifier.fillMaxWidth().height(56.dp).testTag("hw-link-done"),
                            enabled = !ui.busy, color = Palette.Good,
                        ) { onMarkDone(HomeworkLinks.cleanLinkNote(note)) }
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("Links open outside the app; nothing is recorded until you mark it done.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}
