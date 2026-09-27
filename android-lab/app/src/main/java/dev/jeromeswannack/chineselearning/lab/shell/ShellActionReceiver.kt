package dev.jeromeswannack.chineselearning.lab.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.jeromeswannack.chineselearning.lab.LabApp
import kotlinx.coroutines.launch

/** The card notification's actions: Show answer, Again / Good / Easy, Next card (the hybrid's HomeworkActionReceiver). */
class ShellActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? LabApp ?: return
        val cardId = intent.getStringExtra(EXTRA_CARD_ID)
        val pending = goAsync()
        app.scope.launch {
            try {
                when (intent.action) {
                    ACTION_REVEAL -> if (cardId != null) Shell.reveal(app, cardId)
                    ACTION_RATE -> if (cardId != null) Shell.rate(app, cardId, intent.getIntExtra(EXTRA_RATING, 2))
                    ACTION_NEXT -> Shell.next(app)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_REVEAL = "dev.jeromeswannack.chineselearning.lab.shell.REVEAL"
        const val ACTION_RATE = "dev.jeromeswannack.chineselearning.lab.shell.RATE"
        const val ACTION_NEXT = "dev.jeromeswannack.chineselearning.lab.shell.NEXT"
        const val EXTRA_CARD_ID = "card_id"
        const val EXTRA_RATING = "rating"
    }
}
