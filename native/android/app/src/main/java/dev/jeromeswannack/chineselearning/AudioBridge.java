package dev.jeromeswannack.chineselearning;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Plays the app's short clips (card audio, example sentences) through
 * Android's own media stack instead of the WebView's.
 *
 * Every attempt to make audio reliable inside the WebView fell short: its
 * renderer is a sandboxed, low-priority process, and the first second of a
 * clip stuttered whenever the page was busy (a card reveal, a decode landing)
 * — measured as audio-thread time lost with the main thread idle, and clean
 * on an immediate replay. Nothing on the web side can raise that thread's
 * priority. MediaPlayer runs in the system media server with large buffers
 * and real-time audio threads, which is why every other app on the phone
 * sounds fine.
 *
 * Exposed to the page as window.AndroidAudio; the frontend prefers it
 * whenever present (see frontend/src/utils/audioPlayback.ts) and falls back
 * to an &lt;audio&gt; element in real browsers.
 *
 * Protocol: play(id, source) starts a clip and returns immediately; source is
 * either a data: URL carrying the clip bytes (cached clips) or an https URL
 * (streamed). Progress comes back as window events:
 *   new CustomEvent('android-audio', { detail: { id, event } })
 * with event one of 'play', 'ended', 'error'. Only the most recent id plays;
 * a new play() stops the previous clip without reporting on it.
 */
class AudioBridge {

    private static final String TAG = "AudioBridge";

    private final Activity activity;
    private final WebView webView;

    /** Only touched on the UI thread. */
    private MediaPlayer player;
    private File playingFile;

    /** The clip the page asked for most recently; older callbacks are dropped. */
    private volatile int currentId = 0;

    AudioBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /**
     * Runs on the JS bridge thread. Decoding the bytes and writing the file
     * happens here so the UI thread only does the (cheap) player setup.
     */
    @JavascriptInterface
    public boolean play(int id, String source) {
        if (source == null || source.isEmpty()) {
            return false;
        }
        currentId = id;

        final File file;
        final String url;
        if (source.startsWith("data:")) {
            url = null;
            try {
                file = writeClip(id, source);
            } catch (Exception e) {
                Log.e(TAG, "writing clip failed", e);
                return false;
            }
        } else {
            file = null;
            url = source;
        }

        activity.runOnUiThread(() -> {
            if (currentId != id) {
                if (file != null) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                return;
            }
            releasePlayer();
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                if (file != null) {
                    mp.setDataSource(file.getPath());
                } else {
                    mp.setDataSource(url);
                }
                mp.setOnPreparedListener(p -> {
                    if (currentId != id) {
                        return;
                    }
                    p.start();
                    emit(id, "play");
                });
                mp.setOnCompletionListener(p -> {
                    if (currentId == id) {
                        emit(id, "ended");
                    }
                });
                mp.setOnErrorListener((p, what, extra) -> {
                    Log.w(TAG, "playback error what=" + what + " extra=" + extra);
                    if (currentId == id) {
                        emit(id, "error");
                    }
                    return true;
                });
                player = mp;
                playingFile = file;
                mp.prepareAsync();
            } catch (Exception e) {
                Log.e(TAG, "starting clip failed", e);
                mp.release();
                if (file != null) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                if (currentId == id) {
                    emit(id, "error");
                }
            }
        });
        return true;
    }

    /** Stop the clip with this id; a stale id (already superseded) is a no-op. */
    @JavascriptInterface
    public void stop(int id) {
        if (currentId != id) {
            return;
        }
        currentId = 0;
        activity.runOnUiThread(this::releasePlayer);
    }

    /** Free the player and its file; call from the activity's onDestroy too. */
    void release() {
        currentId = 0;
        activity.runOnUiThread(this::releasePlayer);
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.reset();
            } catch (Exception ignored) {
                // Already in an error state
            }
            player.release();
            player = null;
        }
        if (playingFile != null) {
            //noinspection ResultOfMethodCallIgnored
            playingFile.delete();
            playingFile = null;
        }
    }

    /** Decode a data: URL into a per-clip file in the cache directory. */
    private File writeClip(int id, String dataUrl) throws IOException {
        int comma = dataUrl.indexOf(',');
        if (comma < 0) {
            throw new IOException("malformed data URL");
        }
        byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        File dir = new File(activity.getCacheDir(), "audio");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("cannot create cache dir");
        }
        File file = new File(dir, "clip-" + id + ".mp3");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file;
    }

    private void emit(int id, String event) {
        String js = "window.dispatchEvent(new CustomEvent('android-audio',{detail:{id:" + id
                + ",event:" + JSONObject.quote(event) + "}}))";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
