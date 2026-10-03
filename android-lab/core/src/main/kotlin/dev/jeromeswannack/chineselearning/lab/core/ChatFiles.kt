package dev.jeromeswannack.chineselearning.lab.core

/**
 * Files and video clips in the chat — round 2 PR 3 (docs/CHAT.md). Ports of the web's pure helpers:
 * `fileProblem` / `FILE_EXTENSIONS` / the size limits (frontend/src/services/chatMedia.ts),
 * `formatBytes` / `fileIcon` (components/chat/FileBubble.tsx) and the worker's notification text
 * `messagePreviewText` (worker/src/services/chat/media.ts). Unit-tested in ChatFilesTest with the
 * web's and the worker's own cases.
 */
object ChatFiles {
    const val FILE_MAX_BYTES = 20L * 1024 * 1024
    const val VIDEO_MAX_BYTES = 25L * 1024 * 1024

    /** The extensions the server takes as a file (worker FILE_TYPES), in the web's order. */
    val FILE_EXTENSIONS = listOf(
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "txt", "csv", "md", "rtf", "zip", "apkg", "epub", "mp3", "m4a",
        "jpg", "jpeg", "png", "gif", "webp", "heic",
    )

    /** The type each extension is served as (worker FILE_TYPES) — what the device opens it as. */
    val FILE_TYPES: Map<String, String> = mapOf(
        "pdf" to "application/pdf",
        "doc" to "application/msword",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" to "application/vnd.ms-excel",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" to "application/vnd.ms-powerpoint",
        "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" to "application/vnd.oasis.opendocument.text",
        "txt" to "text/plain",
        "csv" to "text/csv",
        "md" to "text/markdown",
        "rtf" to "application/rtf",
        "zip" to "application/zip",
        "apkg" to "application/octet-stream",
        "epub" to "application/epub+zip",
        "mp3" to "audio/mpeg",
        "m4a" to "audio/mp4",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "gif" to "image/gif",
        "webp" to "image/webp",
        "heic" to "image/heic",
    )

    const val WRONG_KIND = "That kind of file can’t be sent — PDF, Office documents, text, zip, audio or pictures."
    const val TOO_BIG = "Files can be at most 20 MB."
    const val EMPTY = "That file is empty."
    const val VIDEO_TOO_BIG = "Video clips can be at most 25 MB — trim it or send a shorter one."

    /** `name.split('.').pop().toLowerCase()`: the text after the last dot (the whole name when there is none). */
    fun lastSegment(name: String): String = name.substringAfterLast('.').lowercase()

    /** Port of fileProblem: why a picked file can't be sent, or null. */
    fun fileProblem(name: String, size: Long): String? {
        if (lastSegment(name) !in FILE_EXTENSIONS) return WRONG_KIND
        if (size > FILE_MAX_BYTES) return TOO_BIG
        if (size == 0L) return EMPTY
        return null
    }

    /** The web's video check (ChatPage handleVideoPicked): only the size. */
    fun videoProblem(size: Long): String? = if (size > VIDEO_MAX_BYTES) VIDEO_TOO_BIG else null

    /** Port of formatBytes: 512 B, 840 KB, 3.2 MB, 12 MB. */
    fun formatBytes(n: Long): String {
        if (n < 1024) return "$n B"
        if (n < 1024 * 1024) return "${Js.round(n / 1024.0).toLong()} KB"
        return "${Js.toFixed(n / (1024.0 * 1024.0), if (n < 10L * 1024 * 1024) 1 else 0)} MB"
    }

    /** Port of fileIcon: 📕 PDF, 📝 text, 📊 sheets, 📽️ slides, 🗜️ archives, 🎵 audio, 🖼️ pictures, else 📄. */
    fun fileIcon(name: String): String = when (lastSegment(name)) {
        "pdf" -> "📕"
        "doc", "docx", "odt", "rtf", "txt", "md" -> "📝"
        "xls", "xlsx", "csv" -> "📊"
        "ppt", "pptx" -> "📽️"
        "zip", "apkg", "epub" -> "🗜️"
        "mp3", "m4a" -> "🎵"
        "jpg", "jpeg", "png", "gif", "webp", "heic" -> "🖼️"
        else -> "📄"
    }

    /** "PDF" for the bubble's "840 KB · PDF" (the web's `name.split('.').pop().toUpperCase()`). */
    fun typeLabel(name: String): String = name.substringAfterLast('.').uppercase()

    /** "840 KB · PDF" (no type when the name has none). */
    fun meta(name: String, bytes: Long): String {
        val ext = typeLabel(name)
        return formatBytes(bytes) + if (ext.isNotEmpty()) " · $ext" else ""
    }

    /**
     * Port of the worker's messagePreviewText: the one-line text a notification / reply quote shows —
     * 📷 Photo, 🎤 Voice message, 📄 <name> (📄 File without one), 🎬 Video, each with ": caption".
     */
    fun previewText(content: String, attachmentKind: String?, fileName: String? = null, deletedAt: String? = null): String {
        if (!deletedAt.isNullOrEmpty()) return "Message deleted"
        if (attachmentKind.isNullOrEmpty()) return content
        val caption = NoteSearch.jsTrim(content)
        val label = when (attachmentKind) {
            "image" -> "📷 Photo"
            "voice" -> "🎤 Voice message"
            "file" -> if (fileName != null) "📄 $fileName" else "📄 File"
            "video" -> "🎬 Video"
            else -> return content
        }
        return if (caption.isNotEmpty()) "$label: $caption" else label
    }
}
