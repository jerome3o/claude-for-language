package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The web's file rules (frontend/src/services/chatMedia.ts fileProblem, FileBubble formatBytes /
 * fileIcon) and the worker's messagePreviewText cases (worker/src/routes/__tests__/chat-files.test.ts).
 */
class ChatFilesTest {
    @Test fun fileProblemFollowsTheServersWhitelistAndLimits() {
        assertNull(ChatFiles.fileProblem("HSK3 词汇.pdf", 840_000))
        assertNull(ChatFiles.fileProblem("Deck.APKG", 1))
        assertNull(ChatFiles.fileProblem("notes.final.docx", ChatFiles.FILE_MAX_BYTES))
        assertEquals(ChatFiles.WRONG_KIND, ChatFiles.fileProblem("page.html", 10))
        assertEquals(ChatFiles.WRONG_KIND, ChatFiles.fileProblem("icon.svg", 10))
        assertEquals(ChatFiles.TOO_BIG, ChatFiles.fileProblem("big.pdf", ChatFiles.FILE_MAX_BYTES + 1))
        assertEquals(ChatFiles.EMPTY, ChatFiles.fileProblem("empty.txt", 0))
        assertEquals("That kind of file can’t be sent — PDF, Office documents, text, zip, audio or pictures.", ChatFiles.WRONG_KIND)
    }

    @Test fun aNameWithoutADotIsJudgedByTheWholeNameLikeTheWeb() {
        // `'pdf'.split('.').pop()` is 'pdf', so the web lets a file called just "pdf" through (the server then refuses it).
        assertNull(ChatFiles.fileProblem("pdf", 10))
        assertEquals(ChatFiles.WRONG_KIND, ChatFiles.fileProblem("README", 10))
    }

    @Test fun videoOnlyChecksTheSize() {
        assertNull(ChatFiles.videoProblem(ChatFiles.VIDEO_MAX_BYTES))
        assertEquals("Video clips can be at most 25 MB — trim it or send a shorter one.", ChatFiles.videoProblem(ChatFiles.VIDEO_MAX_BYTES + 1))
    }

    @Test fun formatsBytesLikeTheWeb() {
        assertEquals("0 B", ChatFiles.formatBytes(0))
        assertEquals("1023 B", ChatFiles.formatBytes(1023))
        assertEquals("1 KB", ChatFiles.formatBytes(1024))
        assertEquals("2 KB", ChatFiles.formatBytes(1536)) // Math.round(1.5) = 2
        assertEquals("840 KB", ChatFiles.formatBytes(860_000))
        assertEquals("1.0 MB", ChatFiles.formatBytes(1024 * 1024))
        assertEquals("3.2 MB", ChatFiles.formatBytes((3.2 * 1024 * 1024).toLong()))
        assertEquals("10 MB", ChatFiles.formatBytes(10L * 1024 * 1024))
        assertEquals("25 MB", ChatFiles.formatBytes(ChatFiles.VIDEO_MAX_BYTES))
    }

    @Test fun iconsAndMetaByType() {
        assertEquals("📕", ChatFiles.fileIcon("a.PDF"))
        assertEquals("📝", ChatFiles.fileIcon("a.docx"))
        assertEquals("📊", ChatFiles.fileIcon("a.csv"))
        assertEquals("📽️", ChatFiles.fileIcon("a.pptx"))
        assertEquals("🗜️", ChatFiles.fileIcon("deck.apkg"))
        assertEquals("🎵", ChatFiles.fileIcon("a.m4a"))
        assertEquals("🖼️", ChatFiles.fileIcon("a.heic"))
        assertEquals("📄", ChatFiles.fileIcon("a.bin"))
        assertEquals("840 KB · PDF", ChatFiles.meta("HSK3.pdf", 860_000))
        assertEquals("12 B · README", ChatFiles.meta("README", 12))
    }

    @Test fun previewTextMatchesTheWorker() {
        assertEquals("📄 HSK3.pdf", ChatFiles.previewText("", "file", "HSK3.pdf"))
        assertEquals("🎬 Video: 看这个", ChatFiles.previewText("看这个", "video"))
        assertEquals("📷 Photo", ChatFiles.previewText("", "image"))
        assertEquals("📷 Photo: 好看", ChatFiles.previewText(" 好看 ", "image"))
        assertEquals("🎤 Voice message", ChatFiles.previewText("", "voice"))
        assertEquals("📄 File", ChatFiles.previewText("", "file"))
        assertEquals(" 你好 ", ChatFiles.previewText(" 你好 ", null))
        assertEquals("Message deleted", ChatFiles.previewText("", "file", "x.pdf", deletedAt = "2026-10-01T00:00:00Z"))
    }
}
