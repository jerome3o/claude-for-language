package dev.jeromeswannack.chineselearning.lab.ui.watch

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import dev.jeromeswannack.chineselearning.lab.Config
import java.util.Locale

/*
 * 📺 Watch: YouTube's own player (docs/WATCH.md "YouTube's rules"). A WebView loads a tiny page
 * that runs the official IFrame Player API (https://www.youtube.com/iframe_api) on the
 * youtube-nocookie.com host — no third-party library, nothing downloaded, proxied or cached, and
 * nothing drawn over the player (the screen keeps every control below / beside it).
 *
 * The page is loaded with the app's web origin as its base URL: YouTube's embed needs an origin /
 * referrer (error 152 / 153 without one). JS → Kotlin through one bridge object ([Bridge]): ready,
 * a tick every 150 ms (time, duration, state, title), errors. Kotlin → JS through [YouTubeController]
 * (play, pause, seekTo(seconds, true), setPlaybackRate).
 */

/** What the player tells the screen (called on the main thread). */
interface YouTubeListener {
    fun onReady()
    /** Every ~150 ms: position, length (0 until known), YT.PlayerState (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued), title. */
    fun onTick(positionMs: Long, durationMs: Long, state: Int, title: String)
    /** YT error codes: 2 bad id, 5 HTML5 error, 100 not found / private, 101 / 150 embedding off, 152 / 153 no origin. */
    fun onError(code: Int)
}

/** Kotlin → the player. Calls before the page is ready are dropped (the screen retries on the next action). */
class YouTubeController {
    @Volatile internal var web: WebView? = null

    fun play() = js("player&&player.playVideo()")
    fun pause() = js("player&&player.pauseVideo()")
    fun seekTo(ms: Long) = js("player&&player.seekTo(${String.format(Locale.US, "%.3f", ms.coerceAtLeast(0) / 1000.0)},true)")
    fun setRate(rate: Double) = js("player&&player.setPlaybackRate(${String.format(Locale.US, "%.2f", rate)})")

    private fun js(code: String) {
        val w = web ?: return
        w.post { runCatching { w.evaluateJavascript("try{$code}catch(e){}", null) } }
    }
}

object YouTubePage {
    /** The page's origin (YouTube checks it; must be https). */
    val BASE_URL: String = Config.WEB_URL.trimEnd('/') + "/"

    private val ID = Regex("^[A-Za-z0-9_-]{11}$")

    fun html(videoId: String, startMs: Long, rate: Double): String {
        require(ID.matches(videoId)) { "not a video id" }
        val start = (startMs.coerceAtLeast(0) / 1000)
        val origin = Config.WEB_URL.trimEnd('/')
        val r = String.format(Locale.US, "%.2f", rate)
        return """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;padding:0;background:#000;width:100%;height:100%;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player=null;
function tick(){try{var t=player.getCurrentTime()||0,d=player.getDuration()||0,s=player.getPlayerState(),v=player.getVideoData?player.getVideoData():null;LabWatch.onTick(Math.round(t*1000),Math.round(d*1000),s==null?-1:s,(v&&v.title)||'');}catch(e){}}
function onYouTubeIframeAPIReady(){
 player=new YT.Player('p',{host:'https://www.youtube-nocookie.com',videoId:'$videoId',width:'100%',height:'100%',
  playerVars:{playsinline:1,rel:0,cc_load_policy:0,fs:0,start:$start,origin:'$origin'},
  events:{
   onReady:function(){try{player.setPlaybackRate($r);}catch(e){}LabWatch.onReady();tick();setInterval(tick,150);},
   onStateChange:function(){tick();},
   onError:function(e){LabWatch.onError(e&&e.data!=null?e.data:-1);}
  }});
}
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>"""
    }
}

/** The JS bridge: every call hops to the main thread before it reaches the listener. */
private class Bridge(private val listener: () -> YouTubeListener?) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface fun onReady() { main.post { listener()?.onReady() } }

    @JavascriptInterface fun onTick(positionMs: Double, durationMs: Double, state: Int, title: String?) {
        val p = positionMs.toLong()
        val d = durationMs.toLong()
        val t = title.orEmpty()
        main.post { listener()?.onTick(p, d, state, t) }
    }

    @JavascriptInterface fun onError(code: Int) { main.post { listener()?.onError(code) } }
}

/**
 * The player itself. [startMs] / [rate] are read once, when the page loads (the screen seeks and
 * changes speed through [controller] afterwards). Size it ≥ 200 dp; draw nothing on top.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun YouTubePlayerView(
    videoId: String,
    startMs: Long,
    rate: Double,
    controller: YouTubeController,
    listener: YouTubeListener,
    modifier: Modifier = Modifier,
) {
    val holder = remember { arrayOfNulls<YouTubeListener>(1) }
    holder[0] = listener
    val html = remember(videoId) { YouTubePage.html(videoId, startMs, rate) }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            WebView(ctx).apply {
                setBackgroundColor(AndroidColor.BLACK)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                // ⏮ 🔁 ⏭ start playback from our buttons, not a tap inside the frame.
                settings.mediaPlaybackRequiresUserGesture = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                webChromeClient = WebChromeClient()
                webViewClient = object : WebViewClient() {
                    // A tap on the YouTube logo / title goes to the YouTube app or browser, never inside this frame.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        if (!request.isForMainFrame) return false
                        val url = request.url.toString()
                        dev.jeromeswannack.chineselearning.lab.ui.homework.openExternal(view.context, url)
                        return true
                    }
                }
                addJavascriptInterface(Bridge { holder[0] }, "LabWatch")
                loadDataWithBaseURL(YouTubePage.BASE_URL, html, "text/html", "utf-8", null)
                controller.web = this
            }
        },
        onRelease = { web ->
            if (controller.web === web) controller.web = null
            runCatching {
                web.evaluateJavascript("try{player&&player.pauseVideo()}catch(e){}", null)
                web.stopLoading()
                web.destroy()
            }
        },
    )
    DisposableEffect(Unit) { onDispose { holder[0] = null } }
}
