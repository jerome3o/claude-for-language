package dev.jeromeswannack.chineselearning.lab

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import dev.jeromeswannack.chineselearning.lab.data.CrashLog

/**
 * "Last crash / freeze": shown once, on the open after a run that crashed or froze, BEFORE the
 * app's own UI (MainActivity hands over here when [CrashLog.hasUnseenCrash]). Plain Views — no
 * Compose, Room or sync — so it opens even when the app's own start-up is what breaks.
 * Copy puts the trace on the clipboard, Send to Claude uploads it (POST /api/debug/crash),
 * Continue marks it seen and opens the app.
 */
class LastCrashActivity : Activity() {
    private lateinit var trace: TextView
    private var text: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        root.addView(TextView(this).apply {
            text = "The app crashed or froze last time"
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
        })
        root.addView(TextView(this).apply {
            text = "This is what it was doing. It has been sent to Claude automatically if you were online — tap Send to Claude to send it again."
            textSize = 14f
            setPadding(0, pad / 2, 0, pad / 2)
        })
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            this.text = label
            isAllCaps = false
            setOnClickListener { onClick() }
            buttons.addView(this, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        button("Copy") { copy() }
        button("Send to Claude") { send() }
        button("Continue") { proceed() }
        root.addView(buttons)
        trace = TextView(this).apply {
            text = "Loading…"
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        root.addView(
            ScrollView(this).apply { addView(trace) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        setContentView(root)
        // Reading the system's ANR dump is disk + binder work: off the main thread.
        val main = Handler(Looper.getMainLooper())
        Thread {
            val t = runCatching { CrashLog.lastCrashText(applicationContext) }.getOrElse { "Couldn't read the crash: $it" }
            main.post { text = t; trace.text = t }
        }.start()
    }

    private fun copy() {
        runCatching {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Lab crash", text))
            Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
        }
    }

    private fun send() {
        val main = Handler(Looper.getMainLooper())
        val shown = text
        Thread {
            val ok = CrashLog.sendShown(applicationContext, version(), shown)
            main.post { Toast.makeText(this, if (ok) "Sent to Claude" else "Couldn't send — copy it instead", Toast.LENGTH_LONG).show() }
        }.start()
    }

    private fun proceed() {
        CrashLog.markCrashSeen(this)
        startActivity(Intent(this, MainActivity::class.java).putExtra(EXTRA_SKIP, true))
        finish()
    }

    private fun version(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "unknown"

    companion object {
        const val EXTRA_SKIP = "lab_skip_last_crash"
    }
}
