package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.ui.text.AnnotatedString

/**
 * Markdown flattened into one AnnotatedString (inline styles kept; lists, quotes and tables become
 * lines) — only for a place that must be a single `Text` (a notification, a one-line preview).
 * Everything else renders with [MarkdownText] (`Markdown.kt`), the full block renderer.
 */
fun markdownLite(src: String): AnnotatedString = markdownAnnotated(src)
