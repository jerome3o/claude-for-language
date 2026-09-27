package dev.jeromeswannack.chineselearning.lab.shell

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Select text in any app → ⋮ → "Coach (Lab)" (ACTION_PROCESS_TEXT): opens `/coach?text=<selection>`
 * — the native coach when it is registered, else its placeholder hands off to the main app.
 */
class ProcessTextActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val selected = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
        startActivity(ShellLinks.intent(this, ShellLinks.coach(selected)))
        finish()
    }
}
