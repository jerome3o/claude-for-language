package dev.jeromeswannack.chineselearning.lab.data.materials

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import dev.jeromeswannack.chineselearning.lab.core.Materials
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.CompleteMaterialBody
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialDto
import dev.jeromeswannack.chineselearning.lab.data.api.MaterialPageTextBody
import dev.jeromeswannack.chineselearning.lab.data.api.NewMaterialBody
import dev.jeromeswannack.chineselearning.lab.data.api.completeMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.createMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.deleteMaterial
import dev.jeromeswannack.chineselearning.lab.data.api.uploadMaterialOriginal
import dev.jeromeswannack.chineselearning.lab.data.api.uploadMaterialPage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.File

/** Web `UploadStage`: drawing pages, uploading them, finishing. */
sealed interface UploadStage {
    data class Rendering(val done: Int, val total: Int) : UploadStage
    data class Uploading(val done: Int, val total: Int) : UploadStage
    data object Finishing : UploadStage

    /** The button's label while it works (web `stageLabel`). */
    val label: String get() = when (this) {
        is Rendering -> "Preparing page $done of $total…"
        is Uploading -> "Uploading page ${done + 1} of $total…"
        Finishing -> "Finishing…"
    }
}

/** A picked file: name, type and size as the content resolver tells them. */
data class PickedFile(val name: String, val mime: String?, val size: Long)

/** Thrown with a sentence to show (web `materialFileProblem`). */
class MaterialFileProblem(message: String) : IllegalArgumentException(message)

/**
 * Add a material (web services/materials/upload.ts `addMaterial`): check the file, render its pages on
 * the phone ([MaterialRenderer]), register it, upload the original and every page, then finish with the
 * pages' text. My own pages are kept on the phone from the start. On a failure the half-made material is
 * deleted again.
 */
class MaterialUploader(private val api: Api, private val store: MaterialStore, private val workDir: File) {
    suspend fun add(file: File, picked: PickedFile, title: String? = null, onProgress: (UploadStage) -> Unit = {}): MaterialDto {
        Materials.fileProblem(picked.name, picked.mime, picked.size.toDouble())?.let { throw MaterialFileProblem(it) }
        val kind = Materials.kindOf(picked.name, picked.mime)!!
        val outDir = File(workDir, "render-${System.nanoTime()}")
        try {
            val rendered = MaterialRenderer(outDir).render(file, kind) { d, t -> onProgress(UploadStage.Rendering(d, t)) }
            val material = api.createMaterial(NewMaterialBody(title ?: Materials.titleFromFileName(picked.name), picked.name, picked.mime.orEmpty(), picked.size)).material
            try {
                api.uploadMaterialOriginal(material.id, file, picked.mime.orEmpty())
                for ((i, p) in rendered.pages.withIndex()) {
                    onProgress(UploadStage.Uploading(i, rendered.pages.size))
                    api.uploadMaterialPage(material.id, i, p.image)
                    runCatching { store.keepUploaded(material.id, i, p.image) }
                }
                onProgress(UploadStage.Finishing)
                return api.completeMaterial(material.id, CompleteMaterialBody(rendered.pages.mapIndexed { i, p -> MaterialPageTextBody(i, p.text, p.notes) }, rendered.renderNote)).material
            } catch (e: Throwable) {
                withContext(NonCancellable) { runCatching { api.deleteMaterial(material.id) }; store.forget(material.id) }
                throw e
            }
        } finally {
            withContext(NonCancellable + Dispatchers.IO) { outDir.deleteRecursively() }
        }
    }

    companion object {
        /** Name / type / size of a picked document, and a private copy to read (PdfRenderer and ZipFile need a file). */
        suspend fun copyIn(context: Context, uri: Uri, workDir: File): Pair<File, PickedFile> = withContext(Dispatchers.IO) {
            val cr = context.contentResolver
            var name = uri.lastPathSegment?.substringAfterLast('/') ?: "material"
            var size = -1L
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { i -> c.getString(i)?.let { name = it } }
                    c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                }
            }
            val mime = cr.getType(uri)
            // Refuse an unsupported / too big file before copying 50 MB.
            if (size >= 0) Materials.fileProblem(name, mime, size.toDouble())?.let { throw MaterialFileProblem(it) }
            val dest = File(workDir.apply { mkdirs() }, "pick-${System.nanoTime()}")
            try {
                cr.openInputStream(uri)?.use { input -> dest.outputStream().use { input.copyTo(it) } } ?: throw MaterialFileProblem("Couldn’t open that file")
            } catch (e: CancellationException) {
                dest.delete(); throw e
            }
            dest to PickedFile(name, mime, if (size >= 0) size else dest.length())
        }

        /** What the system file picker offers (web `accept`). */
        val ACCEPT = arrayOf(
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "image/png", "image/jpeg", "image/webp",
        )
    }
}
