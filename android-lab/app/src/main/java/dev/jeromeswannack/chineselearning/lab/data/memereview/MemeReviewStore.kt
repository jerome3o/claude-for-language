package dev.jeromeswannack.chineselearning.lab.data.memereview

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssue
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueRecord
import dev.jeromeswannack.chineselearning.lab.data.api.MemeIssueListDto
import dev.jeromeswannack.chineselearning.lab.data.api.MemeIssueResponseDto
import dev.jeromeswannack.chineselearning.lab.data.api.memeIssue
import dev.jeromeswannack.chineselearning.lab.data.api.memeIssues
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia
import java.io.File

/**
 * 梗 Meme review on the phone (prototype; web services/memeReview.ts, docs/MEME_REVIEW.md): an
 * issue opened here is kept in the JsonCache (`meme-review/issue/<month>`) with its pictures as
 * files (LessonMedia's image cache), so it reads offline afterwards; the last list too. Links to
 * the original videos / posts need a connection. Nothing in the study sync touches it.
 */
object MemeReviewStore {
    const val ISSUE_KIND = "meme-review-issue"
    const val LIST_KIND = "meme-review-list"
    const val LIST_KEY = "meme-review/list"
    fun key(month: String) = "meme-review/issue/$month"

    private fun media(app: LabApp) = LessonMedia(app.filesDir, app.repo.api)

    suspend fun cached(app: LabApp, month: String): MemeIssueRecord? = runCatching { app.cache.get<MemeIssueRecord>(key(month)) }.getOrNull()

    /** Ready issues on this phone (the list's ✓ and the offline list). */
    suspend fun onPhone(app: LabApp): List<MemeIssueRecord> =
        runCatching { app.cache.all(ISSUE_KIND, MemeIssueRecord.serializer()) }.getOrDefault(emptyList()).filter { it.status == "ready" && it.issue != null }

    private suspend fun store(app: LabApp, record: MemeIssueRecord) {
        if (record.status != "ready" || record.issue == null) return
        runCatching { app.cache.put(key(record.month), ISSUE_KIND, record) }
    }

    /** The server's issue (stored when ready). Throws offline / on an error. */
    suspend fun fetch(app: LabApp, month: String): MemeIssueResponseDto = app.repo.api.memeIssue(month).also { store(app, it.issue) }

    suspend fun cachedList(app: LabApp): MemeIssueListDto? = runCatching { app.cache.get<MemeIssueListDto>(LIST_KEY) }.getOrNull()

    suspend fun refreshList(app: LabApp): MemeIssueListDto = app.repo.api.memeIssues().also { runCatching { app.cache.put(LIST_KEY, LIST_KIND, it) } }

    /** A picture's file: on the phone, else downloaded when online. */
    suspend fun picture(app: LabApp, key: String?): File? = media(app).image(key, app.online.value)

    /** Every picture of the issue, downloaded in the background for offline. */
    suspend fun cachePictures(app: LabApp, issue: MemeIssue) {
        if (!app.online.value) return
        val m = media(app)
        for (item in issue.items) runCatching { m.image(item.picture.image_key, online = true) }
    }
}
