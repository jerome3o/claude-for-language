package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Where an answer's feedback can ask Claude about it (the web's components/study/answerAsk.tsx; docs/STUDY_SESSION.md
 * "Answer feedback: one line and a diff" → "💬 Ask Claude"): the study card (and the homework pass on it) provides it
 * while Claude can be reached — it opens the card's own Claude thread with the question already sent. Every
 * [AnswerDiffView] inside reads it: the small "💬 Ask Claude" link when the check gave no reason (core
 * `AnswerWhy.askOffered`), and "Explain more ›" when it has nothing to open in place. null = neither is offered.
 */
val LocalAnswerAsk = staticCompositionLocalOf<((String) -> Unit)?> { null }
