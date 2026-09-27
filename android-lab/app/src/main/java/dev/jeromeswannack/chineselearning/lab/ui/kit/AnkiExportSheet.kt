package dev.jeromeswannack.chineselearning.lab.ui.kit

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportProgress
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportResult
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExporter
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Which kind of thing is being exported (drives the help text and the progress option). */
enum class AnkiExportKind { DECK, LESSON, READER }

sealed interface AnkiExportPhase {
    data object Options : AnkiExportPhase
    data class Running(val progress: AnkiExportProgress?) : AnkiExportPhase
    /** [notice]: what Save / Share said ([noticeFailed] = it went wrong). */
    data class Done(val result: AnkiExportResult, val notice: String? = null, val noticeFailed: Boolean = false) : AnkiExportPhase
    data class Error(val message: String) : AnkiExportPhase
}

data class AnkiExportUi(
    val title: String,
    val kind: AnkiExportKind,
    val includeAudio: Boolean = true,
    val includeProgress: Boolean = false,
    val phase: AnkiExportPhase = AnkiExportPhase.Options,
    /** Offline when the export started — explains missing clips. */
    val wasOffline: Boolean = false,
)

class AnkiExportActions(
    val onIncludeAudio: (Boolean) -> Unit = {},
    val onIncludeProgress: (Boolean) -> Unit = {},
    val onExport: () -> Unit = {},
    val onShare: () -> Unit = {},
    val onSave: () -> Unit = {},
    val onClose: () -> Unit = {},
)

private fun plural(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"

/** The web modal's `progressText`. */
fun ankiProgressText(p: AnkiExportProgress?): String = when {
    p == null -> "Preparing…"
    p.stage == AnkiExportProgress.Stage.LOADING -> "Loading…"
    p.stage == AnkiExportProgress.Stage.AUDIO -> if (p.total == 0) "No audio to fetch" else "Fetching ${plural(p.total, "audio clip")}… (${p.done}/${p.total})"
    else -> "Building the Anki package…"
}

/** The web modal's `formatBytes`. */
fun ankiFormatBytes(bytes: Long): String =
    if (bytes >= 1024 * 1024) "${Js.toFixed(bytes / 1024.0 / 1024.0, 1)} MB" else "${maxOf(1L, Js.roundToLong(bytes / 1024.0))} KB"

/** The result line: "12 notes, 34 cards, 10 audio clips (2 missing) · 48 KB". */
fun ankiResultSummary(r: AnkiExportResult, includeAudio: Boolean): String = buildString {
    append(plural(r.notes, "note")).append(", ").append(plural(r.cards, "card"))
    if (includeAudio) {
        append(", ").append(plural(r.audioIncluded, "audio clip"))
        if (r.audioMissing > 0) append(" (${r.audioMissing} missing)")
    }
    append(" · ").append(ankiFormatBytes(r.bytes))
}

private fun helpText(kind: AnkiExportKind): String = "Saves an .apkg file you can open in Anki (desktop, AnkiDroid or AnkiMobile). " + when (kind) {
    AnkiExportKind.DECK -> "Each word becomes one note with the same three cards as here: Hanzi → Meaning, Meaning → Hanzi and Audio → Hanzi."
    AnkiExportKind.LESSON -> "Words become vocabulary notes (three cards each), sentences become Chinese → English cards."
    AnkiExportKind.READER -> "Every page becomes a Chinese → English card, and the reader’s vocabulary gets word cards."
} + " Exporting again later updates the same notes in Anki instead of duplicating them."

/**
 * "Export to Anki" — the web's AnkiExportModal as sheet content: options (include audio; for a
 * deck, include review progress), progress (stage + a springy bar while clips are fetched), and
 * the result (counts, missing clips explained, Share → AnkiDroid / Save to Downloads). Stateless:
 * [AnkiExportSheet] holds the state and runs the export; screenshot tests render this directly.
 */
@Composable
fun AnkiExportContent(ui: AnkiExportUi, actions: AnkiExportActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).animateContentSize(spring()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Export to Anki", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
        Text(ui.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        when (val phase = ui.phase) {
            AnkiExportPhase.Options -> {
                Text(helpText(ui.kind), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint.copy(alpha = 0.5f))) {
                    ToggleRow("🔊", "Include audio", ui.includeAudio, desc = "Bundles the pronunciation clips. Clips not cached on this device are fetched when online.", onChange = actions.onIncludeAudio)
                    if (ui.kind == AnkiExportKind.DECK) {
                        ToggleRow(
                            "📈", "Include review progress", ui.includeProgress,
                            desc = "Approximate: intervals and due dates carry over, learning steps are treated as due today. Off = every card starts new.",
                            onChange = actions.onIncludeProgress,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("Cancel", Modifier.weight(1f).heightIn(min = 48.dp), onClick = actions.onClose)
                    PrimaryPill("⬇ Export .apkg", Modifier.weight(1.4f).heightIn(min = 48.dp), onClick = actions.onExport)
                }
            }
            is AnkiExportPhase.Running -> {
                val p = phase.progress
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp, color = Lab.colors.accent)
                    Spacer(Modifier.width(12.dp))
                    Text(ankiProgressText(p), style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                }
                if (p?.stage == AnkiExportProgress.Stage.AUDIO && p.total > 0) {
                    val fraction by animateFloatAsState(p.done.toFloat() / p.total, spring(stiffness = 300f), label = "anki-progress")
                    Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).background(Lab.colors.faint)) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).clip(RoundedCornerShape(5.dp)).background(Lab.colors.accent))
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            is AnkiExportPhase.Done -> {
                val r = phase.result
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Good.copy(alpha = 0.12f)).padding(14.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text("✅", fontSize = 22.sp)
                    Spacer(Modifier.width(12.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Ready: ${r.filename}", fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                        Text(ankiResultSummary(r, ui.includeAudio), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    }
                }
                if (ui.includeAudio && r.audioMissing > 0) {
                    InlineNotice(
                        if (ui.wasOffline) "You’re offline — ${plural(r.audioMissing, "clip")} weren’t cached on this device, so those cards have no audio. Export again when online to include them."
                        else "${plural(r.audioMissing, "clip")} couldn’t be fetched; those cards were exported without audio.",
                        kind = if (ui.wasOffline) NoticeKind.Offline else NoticeKind.Warning,
                    )
                }
                phase.notice?.let { InlineNotice(it, kind = if (phase.noticeFailed) NoticeKind.Error else NoticeKind.Success) }
                Text("On this phone: Share → AnkiDroid. In Anki desktop: File → Import, pick the file.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                PrimaryPill("Share… (AnkiDroid, Drive…)", Modifier.fillMaxWidth().heightIn(min = 52.dp), onClick = actions.onShare)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("⬇ Save to Downloads", Modifier.weight(1.6f).heightIn(min = 48.dp), onClick = actions.onSave)
                    SecondaryPill("Done", Modifier.weight(1f).heightIn(min = 48.dp), onClick = actions.onClose)
                }
            }
            is AnkiExportPhase.Error -> {
                InlineNotice(phase.message, kind = NoticeKind.Error)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("Close", Modifier.weight(1f).heightIn(min = 48.dp), onClick = actions.onClose)
                    PrimaryPill("Try again", Modifier.weight(1f).heightIn(min = 48.dp), onClick = actions.onExport)
                }
            }
        }
    }
}

private fun AnkiExportTarget.kind() = when (this) {
    is AnkiExportTarget.Deck -> AnkiExportKind.DECK
    is AnkiExportTarget.Lesson -> AnkiExportKind.LESSON
    is AnkiExportTarget.Reader -> AnkiExportKind.READER
}

/** Hands the .apkg to another app (AnkiDroid, Drive, Messages…) through FileProvider. */
fun shareApkg(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, file.name)
        clipData = ClipData.newRawUri(file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, "Share ${file.name}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
}

/** Android 10+: copies the file into Downloads (MediaStore, no permission). Returns false below 10. */
fun saveApkgToDownloads(context: Context, file: File): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, file.name)
        put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
        put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Couldn't create the file in Downloads")
    try {
        resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
        resolver.delete(uri, null, null)
        throw e
    }
    return true
}

/**
 * The export sheet for [target] (null = closed). Owns the options and the running export:
 *
 *   var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }
 *   AnkiExportSheet(anki) { anki = null }
 *   … onAnki = { anki = AnkiExportTarget.Deck(deck.id, deck.name) }
 *
 * Built on the phone (data/anki/AnkiExporter.kt), so it works offline with the cached clips.
 */
@Composable
fun AnkiExportSheet(target: AnkiExportTarget?, onDismiss: () -> Unit) {
    if (target == null) return
    val context = LocalContext.current
    val app = context.applicationContext as LabApp
    val scope = rememberCoroutineScope()
    var ui by remember(target) { mutableStateOf(AnkiExportUi(target.title.ifBlank { "Untitled" }, target.kind())) }
    var job by remember(target) { mutableStateOf<Job?>(null) }
    fun notice(done: AnkiExportPhase.Done, outcome: Result<String>, failedPrefix: String) {
        outcome.onSuccess { app.haptics.correct() }
        ui = ui.copy(phase = done.copy(notice = outcome.getOrElse { "$failedPrefix: ${it.message}" }, noticeFailed = outcome.isFailure))
    }
    // Below Android 10 "Save" goes through the system file picker.
    val saveAs = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri: Uri? ->
        val done = ui.phase as? AnkiExportPhase.Done ?: return@rememberLauncherForActivityResult
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)!!.use { out -> done.result.file.inputStream().use { it.copyTo(out) } } }
                "Saved ${done.result.filename}"
            }
            notice(done, outcome, "Couldn't save the file")
        }
    }

    fun run() {
        if (job?.isActive == true) return
        app.haptics.tick()
        val offline = !app.online.value
        ui = ui.copy(phase = AnkiExportPhase.Running(null), wasOffline = offline)
        val includeAudio = ui.includeAudio
        val includeProgress = ui.includeProgress
        job = scope.launch {
            ui = try {
                val result = AnkiExporter.of(app).export(target, includeAudio, includeProgress) { p ->
                    scope.launch { if (ui.phase is AnkiExportPhase.Running) ui = ui.copy(phase = AnkiExportPhase.Running(p)) }
                }
                app.haptics.correct()
                ui.copy(phase = AnkiExportPhase.Done(result))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                app.haptics.wrong()
                ui.copy(phase = AnkiExportPhase.Error(e.userMessage().ifBlank { "Export failed" }))
            }
        }
    }

    val busy = ui.phase is AnkiExportPhase.Running
    LabBottomSheet(onDismiss = { if (!busy) onDismiss() }) {
        AnkiExportContent(
            ui,
            AnkiExportActions(
                onIncludeAudio = { ui = ui.copy(includeAudio = it) },
                onIncludeProgress = { ui = ui.copy(includeProgress = it) },
                onExport = ::run,
                onShare = {
                    val done = ui.phase as? AnkiExportPhase.Done
                    if (done != null) runCatching { shareApkg(context, done.result.file) }
                        .onFailure { notice(done, Result.failure(it), "Couldn't open the share sheet") }
                },
                onSave = {
                    val done = ui.phase as? AnkiExportPhase.Done
                    if (done != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            scope.launch {
                                val outcome = runCatching {
                                    withContext(Dispatchers.IO) { saveApkgToDownloads(context, done.result.file) }
                                    "Saved to Downloads: ${done.result.filename}"
                                }
                                notice(done, outcome, "Couldn't save the file")
                            }
                        } else {
                            saveAs.launch(done.result.filename)
                        }
                    }
                },
                onClose = { job?.cancel(); onDismiss() },
            ),
        )
    }
}
