package dev.jeromeswannack.chineselearning.lab.shell

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes

/**
 * 📺 Watch (docs/WATCH.md): Share a video in the YouTube app → "Watch (Lab)" (ACTION_SEND text/plain).
 * Hands only the shared text to `/watch/share?text=…` through the app's own internal
 * link, like [ProcessTextActivity]; that screen picks the YouTube link out of it (Watch.parseYouTubeVideoId)
 * and opens the player — anything else shows a friendly message on the list.
 */
class ShareToWatchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val subject = intent?.getStringExtra(Intent.EXTRA_SUBJECT)
        // The text carries the link ("小欢喜 第1集 https://youtu.be/…"); the subject only when there's no text.
        val shared = (text?.takeIf { it.isNotBlank() } ?: subject.orEmpty()).take(2000)
        startActivity(ShellLinks.intent(this, Routes.watchShare(shared.ifBlank { null })))
        finish()
    }
}
