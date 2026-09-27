package dev.jeromeswannack.chineselearning.lab.ui.editor

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonExport
import dev.jeromeswannack.chineselearning.lab.core.spec.ReaderExport
import kotlinx.serialization.json.JsonObject

/** One export format: the file's name, MIME type and text (built on the phone — works offline). */
data class ExportFile(val filename: String, val mime: String, val text: String)

enum class ExportFormat(val ext: String, val mime: String, val label: String) {
    MD("md", "text/markdown", "Markdown"),
    JSON("json", "application/json", "JSON"),
    CSV("csv", "text/csv", "CSV (Quizlet)"),
}

/** The web's `lessonToMarkdown / lessonToJson / lessonToCsv` + `lessonExportFilename`. */
fun lessonExport(spec: JsonObject, format: ExportFormat): ExportFile = ExportFile(
    LessonExport.filename(spec, format.ext),
    format.mime,
    when (format) {
        ExportFormat.MD -> LessonExport.toMarkdown(spec)
        ExportFormat.JSON -> LessonExport.toJson(spec)
        ExportFormat.CSV -> LessonExport.toCsv(spec)
    },
)

fun readerExport(spec: JsonObject, format: ExportFormat): ExportFile = ExportFile(
    ReaderExport.filename(spec, format.ext),
    format.mime,
    when (format) {
        ExportFormat.MD -> ReaderExport.toMarkdown(spec)
        ExportFormat.JSON -> ReaderExport.toJson(spec)
        ExportFormat.CSV -> ReaderExport.toCsv(spec)
    },
)

/**
 * Exports the way a phone does it (the web downloads a file): **Share** hands the text to any
 * app (Messages, Drive, Keep…), **Save** writes the file where the tutor picks (Storage Access
 * Framework — no permissions), **Print** renders the Markdown as a page for the system print
 * dialog (Save as PDF), the web's print view.
 *
 *   val exporter = rememberExporter()
 *   exporter.share(lessonExport(spec, ExportFormat.MD))
 */
class Exporter internal constructor(
    private val context: Context,
    private val save: (ExportFile) -> Unit,
) {
    fun share(file: ExportFile) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = if (file.mime == "application/json") "text/plain" else file.mime
            putExtra(Intent.EXTRA_SUBJECT, file.filename)
            putExtra(Intent.EXTRA_TITLE, file.filename)
            putExtra(Intent.EXTRA_TEXT, file.text)
        }
        context.startActivity(Intent.createChooser(send, "Share ${file.filename}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Opens the system "save as" screen; the file is written when a place is picked. */
    fun saveAs(file: ExportFile) = save(file)

    /** Prints [markdown] (a lesson / reader Markdown export) through the system print dialog. */
    fun print(title: String, markdown: String) {
        val web = WebView(context)
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                val pm = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                pm.print(title, view.createPrintDocumentAdapter(title), PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
            }
        }
        web.loadDataWithBaseURL(null, PrintHtml.page(title, markdown), "text/html", "utf-8", null)
    }
}

@Composable
fun rememberExporter(onSaved: (String) -> Unit = {}, onError: (String) -> Unit = {}): Exporter {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<ExportFile?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri: Uri? ->
        val file = pending
        pending = null
        if (uri == null || file == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)!!.use { it.write(file.text.toByteArray(Charsets.UTF_8)) }
        }.onSuccess { onSaved("Saved ${file.filename}") }.onFailure { onError("Couldn't save the file: ${it.message}") }
    }
    return remember(context) {
        Exporter(context) { file ->
            pending = file
            launcher.launch(file.filename)
        }
    }
}

/**
 * Picks a JSON file (Import JSON): the text arrives in [onText], or a sentence in [onError].
 * `val pick = rememberJsonPicker(…); pick()`.
 */
@Composable
fun rememberJsonPicker(onText: (String) -> Unit, onError: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching { context.contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) } }
            .onSuccess(onText)
            .onFailure { onError("Couldn't read that file: ${it.message}") }
    }
    return { launcher.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }
}

/** A lesson / reader Markdown export as a printable HTML page (the web's print views, from the same text). */
object PrintHtml {
    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    private fun inline(s: String): String {
        var t = esc(s)
        t = t.replace(Regex("`([^`]+)`"), "<span class=\"tile\">$1</span>")
        t = t.replace(Regex("\\*\\*([^*]+)\\*\\*"), "<strong>$1</strong>")
        t = t.replace(Regex("(?<![\\w*])\\*([^*]+)\\*(?![\\w*])"), "<em>$1</em>")
        t = t.replace(Regex("(?<![\\w_])_([^_]+)_(?![\\w_])"), "<em class=\"hint\">$1</em>")
        return t
    }

    fun body(markdown: String): String {
        val out = StringBuilder()
        val lines = markdown.trimEnd().lines()
        var i = 0
        var inList = false
        fun closeList() { if (inList) { out.append("</ul>"); inList = false } }
        while (i < lines.size) {
            val line = lines[i]
            when {
                line.startsWith("|") -> {
                    closeList()
                    out.append("<table>")
                    while (i < lines.size && lines[i].startsWith("|")) {
                        val cells = lines[i].trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() }
                        if (cells.all { it.matches(Regex("-+")) }) { i++; continue }
                        out.append("<tr>").append(cells.joinToString("") { "<td>${inline(it)}</td>" }).append("</tr>")
                        i++
                    }
                    out.append("</table>")
                    continue
                }
                line.startsWith("### ") -> { closeList(); out.append("<h3>${inline(line.removePrefix("### "))}</h3>") }
                line.startsWith("## ") -> { closeList(); out.append("<h2>${inline(line.removePrefix("## "))}</h2>") }
                line.startsWith("# ") -> { closeList(); out.append("<h1>${inline(line.removePrefix("# "))}</h1>") }
                line == "---" -> { closeList(); out.append("<hr>") }
                line.startsWith("> ") -> { closeList(); out.append("<blockquote>${inline(line.removePrefix("> "))}</blockquote>") }
                line.startsWith("- ") -> { if (!inList) { out.append("<ul>"); inList = true }; out.append("<li>${inline(line.removePrefix("- "))}</li>") }
                line.isBlank() -> closeList()
                else -> { closeList(); out.append("<p>${inline(line)}</p>") }
            }
            i++
        }
        closeList()
        return out.toString()
    }

    fun page(title: String, markdown: String): String = """<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:sans-serif;color:#1c1b19;margin:24px;line-height:1.5;font-size:14px}
h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:22px 0 6px;border-bottom:1px solid #ddd}h3{font-size:14px;margin:16px 0 4px}
p{margin:4px 0}.tile{display:inline-block;border:1px solid #999;border-radius:6px;padding:1px 8px;margin:2px}
table{border-collapse:collapse;margin:6px 0}td{border:1px solid #ccc;padding:4px 10px}
.hint{color:#6b665c}blockquote{color:#6b665c;margin:6px 0;padding-left:10px;border-left:3px solid #ddd}hr{margin:22px 0}
</style></head><body>${body(markdown)}</body></html>"""
}
