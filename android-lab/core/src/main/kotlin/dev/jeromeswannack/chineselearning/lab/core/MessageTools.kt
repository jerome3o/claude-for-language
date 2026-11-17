package dev.jeromeswannack.chineselearning.lab.core

/*
 * Does a chat text have Chinese in it? Port of shared/chats/messageTools.ts `looksLikeChinese` —
 * parity-tested (parity/fixtures/chat.ts). The gate of every learning tool in the chat (MessageMenu,
 * the composer's Check my Chinese, word chips).
 */
object MessageTools {
    /** Port of looksLikeChinese: any UTF-16 unit in U+4E00–U+9FFF. */
    fun looksLikeChinese(text: String): Boolean = text.any { it in '一'..'鿿' }
}
