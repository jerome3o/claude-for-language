package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore

/**
 * The [LessonResumeHandle] for a real run of [lessonId] (Home, the Mini Lessons page, a homework
 * pass): the half-done run saved on this phone — another day, after a restart, offline — and
 * saving after every exercise. Read once per lesson + shape, so a recomposition (a new process)
 * picks the saved run up again. Previews never use this.
 */
@Composable
fun rememberLessonResume(context: Context, lessonId: String, spec: CustomLessonSpec): LessonResumeHandle {
    val store = remember(context) { LessonProgressStore.get(context) }
    val shape = remember(spec) { LessonProgressStore.shape(spec) }
    return remember(lessonId, shape) { lessonResumeHandle(store, lessonId, spec) }
}

/** Same, outside composition (tests). */
fun lessonResumeHandle(store: LessonProgressStore, lessonId: String, spec: CustomLessonSpec): LessonResumeHandle =
    LessonResumeHandle(
        saved = store.restore(lessonId, LessonProgressStore.shape(spec)),
        onProgress = { store.save(it.copy(lessonId = lessonId)) },
        onStartOver = { store.clear(lessonId, deleteRecordings = true) },
    )
