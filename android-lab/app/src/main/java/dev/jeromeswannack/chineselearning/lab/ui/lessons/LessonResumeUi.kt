package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore

/**
 * The [LessonResumeHandle] for a real run of [lessonId] (session, Home / today's list,
 * homework pass): the run saved earlier today, if it can still be continued, and saving
 * after every exercise. Read once per lesson + spec, so a recomposition (leaving Study and
 * coming back, a new process) picks the saved run up again. Previews never use this.
 */
@Composable
fun rememberLessonResume(context: Context, lessonId: String, spec: CustomLessonSpec): LessonResumeHandle {
    val store = remember(context) { LessonProgressStore.get(context) }
    val hash = remember(spec) { LessonProgressStore.specHash(spec) }
    return remember(lessonId, hash) { lessonResumeHandle(store, lessonId, spec, hash) }
}

/** Same, outside composition (tests). */
fun lessonResumeHandle(store: LessonProgressStore, lessonId: String, spec: CustomLessonSpec, hash: String = LessonProgressStore.specHash(spec)): LessonResumeHandle {
    val count = flattenSpec(spec).size
    return LessonResumeHandle(
        saved = store.restore(lessonId, hash, count),
        onProgress = { index, correct, total, startedAt, attempts, recordings -> store.save(lessonId, hash, index, correct, total, startedAt, attempts, recordings) },
        onStartOver = { store.clear(lessonId, deleteRecordings = true) },
    )
}
