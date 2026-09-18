package dev.jeromeswannack.chineselearning;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaPlayer;
import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Random;

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
 * Protocol (v2 — the page feature-detects `playClip`; v1.51 shipped only
 * `play`/`stop`):
 *
 *   play(id, source)            v1: start a clip; source is a data: URL or https URL.
 *   playClip(id, key, source)   v2: same, but a non-empty `key` names the clip in
 *                               the on-device cache: the bytes are kept under it,
 *                               and a later playClip(id, key, "") plays them without
 *                               the page having to hand the bytes over again.
 *   hasClip(key)                whether the cache holds `key`.
 *   stop(id)                    stop the clip with this id; a superseded id is ignored.
 *   setCompression(on)          run every clip through a compressor + limiter.
 *   setKeepAwake(on)            allow the silent keep-alive stream (see holdOutput).
 *   holdOutput(hold)            refcounted: while held (a study screen is open) and
 *                               the app is in the foreground, a near-silent track
 *                               keeps the audio output out of standby, so a clip
 *                               never starts on a cold output.
 *   describe()                  JSON snapshot of the bridge state, for Settings.
 *
 * Progress comes back as window events:
 *   new CustomEvent('android-audio', { detail: { id, event, stats? } })
 * with event one of 'play', 'ended', 'error', 'superseded'. Only the most
 * recent id plays; a new play stops the previous clip and reports
 * 'superseded' on it. 'ended' and 'error' carry `stats`: what the media
 * stack did with the clip (see ClipStats), because the page cannot see it.
 */
class AudioBridge {

    private static final String TAG = "AudioBridge";

    static final int PROTOCOL_VERSION = 2;

    /** Cached clips beyond this are trimmed oldest-first. */
    private static final long CACHE_LIMIT_BYTES = 256L * 1024 * 1024;

    /** How often the sampler compares the player's position with the clock. */
    private static final int SAMPLE_INTERVAL_MS = 100;

    /** MediaPlayer.MEDIA_INFO_AUDIO_NOT_PLAYING (API 26): the output starved. */
    private static final int MEDIA_INFO_AUDIO_NOT_PLAYING = 804;
    private static final int MEDIA_INFO_BUFFERING_START = 701;

    private final Activity activity;
    private final WebView webView;
    private final AudioManager audioManager;
    private final Handler main = new Handler(Looper.getMainLooper());

    /**
     * One audio session for every clip, so the compressor is created once and
     * applies to each MediaPlayer in turn.
     */
    private final int sessionId;

    /** Only touched on the UI thread. */
    private MediaPlayer player;
    /** A non-cached clip's temp file, deleted when the player is released. */
    private File playingFile;

    /** The clip the page asked for most recently; older callbacks are dropped. */
    private volatile int currentId = 0;

    // ---- Preferences from the page (default off until the page applies its settings) ----
    private volatile boolean compressionWanted = false;
    private volatile boolean keepAwakeWanted = false;

    /** UI thread. */
    private DynamicsProcessing effect;
    private String effectState = "off";
    private int holds = 0;
    private boolean foreground = true;
    private AudioTrack keepAlive;

    AudioBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.audioManager = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
        this.sessionId = audioManager.generateAudioSessionId();
    }

    private static AudioAttributes attributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
    }

    // =====================================================================
    // Playback
    // =====================================================================

    /** v1 entry point, kept for the page that predates the cache. */
    @JavascriptInterface
    public boolean play(int id, String source) {
        return playClip(id, "", source);
    }

    @JavascriptInterface
    public boolean hasClip(String key) {
        if (key == null || key.isEmpty()) {
            return false;
        }
        return cacheFile(key).isFile();
    }

    /**
     * Runs on the JS bridge thread. Decoding the bytes and writing the file
     * happens here so the UI thread only does the (cheap) player setup.
     */
    @JavascriptInterface
    public boolean playClip(int id, String key, String source) {
        final long requestedAt = SystemClock.elapsedRealtime();
        final String cacheKey = key == null ? "" : key;
        final boolean hasSource = source != null && !source.isEmpty();

        final File file;
        final boolean cached;
        final String url;
        if (!cacheKey.isEmpty() && !hasSource) {
            File f = cacheFile(cacheKey);
            if (!f.isFile()) {
                return false;
            }
            //noinspection ResultOfMethodCallIgnored
            f.setLastModified(System.currentTimeMillis());
            file = f;
            cached = true;
            url = null;
        } else if (!hasSource) {
            return false;
        } else if (source.startsWith("data:")) {
            url = null;
            try {
                if (cacheKey.isEmpty()) {
                    file = writeTempClip(id, source);
                    cached = false;
                } else {
                    file = writeCachedClip(cacheKey, source);
                    cached = true;
                    trimCache();
                }
            } catch (Exception e) {
                Log.e(TAG, "writing clip failed", e);
                return false;
            }
        } else {
            file = null;
            cached = false;
            url = source;
        }

        int previous = currentId;
        currentId = id;
        if (previous != 0 && previous != id) {
            // Another player on the page took the output. Tell the old one,
            // or its button stays lit and its "audio busy" gate stays held.
            emit(previous, "superseded", null);
        }

        activity.runOnUiThread(() -> {
            if (currentId != id) {
                if (file != null && !cached) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                return;
            }
            releasePlayer();
            ensureEffect();
            ClipStats clipStats = new ClipStats(requestedAt, cached);
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setAudioAttributes(attributes());
                mp.setAudioSessionId(sessionId);
                if (file != null) {
                    mp.setDataSource(file.getPath());
                } else {
                    mp.setDataSource(url);
                }
                mp.setOnPreparedListener(p -> {
                    if (currentId != id || player != p) {
                        return;
                    }
                    long now = SystemClock.elapsedRealtime();
                    clipStats.prepareMs = (int) (now - clipStats.requestedAt);
                    p.start();
                    clipStats.startedAt = SystemClock.elapsedRealtime();
                    clipStats.startMs = (int) (clipStats.startedAt - clipStats.requestedAt);
                    emit(id, "play", null);
                    main.postDelayed(new Sampler(id, p, clipStats), SAMPLE_INTERVAL_MS);
                });
                mp.setOnInfoListener((p, what, extra) -> {
                    if (what == MEDIA_INFO_AUDIO_NOT_PLAYING) {
                        clipStats.notPlaying++;
                    } else if (what == MEDIA_INFO_BUFFERING_START) {
                        clipStats.buffering++;
                    }
                    return true;
                });
                mp.setOnCompletionListener(p -> {
                    if (currentId == id) {
                        clipStats.finish(p);
                        emit(id, "ended", clipStats.toJson());
                    }
                });
                mp.setOnErrorListener((p, what, extra) -> {
                    Log.w(TAG, "playback error what=" + what + " extra=" + extra);
                    if (currentId == id) {
                        clipStats.error = what + "/" + extra;
                        clipStats.finish(null);
                        emit(id, "error", clipStats.toJson());
                    }
                    return true;
                });
                player = mp;
                playingFile = cached ? null : file;
                mp.prepareAsync();
            } catch (Exception e) {
                Log.e(TAG, "starting clip failed", e);
                mp.release();
                if (file != null && !cached) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                if (currentId == id) {
                    clipStats.error = "setup";
                    emit(id, "error", clipStats.toJson());
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
        activity.runOnUiThread(() -> {
            releasePlayer();
            holds = 0;
            updateKeepAlive();
            releaseEffect();
        });
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

    // =====================================================================
    // Measurement
    // =====================================================================

    /**
     * What the media stack did with one clip. The page's own diagnostics
     * measure an &lt;audio&gt; element by sampling its clock; a MediaPlayer
     * is sampled the same way here, on the UI thread, so a report can say
     * whether the clip lost time and what it was playing into.
     */
    private final class ClipStats {
        final long requestedAt;
        final boolean cached;
        long startedAt = 0;
        int prepareMs = -1;
        int startMs = -1;
        int driftMs = 0;
        int worstDriftMs = 0;
        int samples = 0;
        int notPlaying = 0;
        int buffering = 0;
        int durationMs = -1;
        int positionMs = -1;
        String error = null;
        final String route;
        final int volume;
        final int volumeMax;
        final String effectAtStart;
        final boolean outputHeld;

        ClipStats(long requestedAt, boolean cached) {
            this.requestedAt = requestedAt;
            this.cached = cached;
            this.route = describeRoute();
            this.volume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            this.volumeMax = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            this.effectAtStart = effectState;
            this.outputHeld = keepAlive != null;
        }

        void sample(MediaPlayer p) {
            int position;
            try {
                position = p.getCurrentPosition();
            } catch (IllegalStateException e) {
                return;
            }
            long elapsed = SystemClock.elapsedRealtime() - startedAt;
            int drift = (int) (elapsed - position);
            driftMs = drift;
            if (drift > worstDriftMs) {
                worstDriftMs = drift;
            }
            samples++;
        }

        void finish(MediaPlayer p) {
            if (p == null) {
                return;
            }
            try {
                durationMs = p.getDuration();
                positionMs = p.getCurrentPosition();
            } catch (IllegalStateException ignored) {
                // Player already torn down
            }
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("bridge", PROTOCOL_VERSION);
                o.put("cached", cached);
                o.put("prepare_ms", prepareMs);
                o.put("start_ms", startMs);
                o.put("drift_ms", driftMs);
                o.put("worst_drift_ms", worstDriftMs);
                o.put("samples", samples);
                o.put("not_playing", notPlaying);
                o.put("buffering", buffering);
                o.put("duration_ms", durationMs);
                o.put("position_ms", positionMs);
                o.put("route", route);
                o.put("volume", volume);
                o.put("volume_max", volumeMax);
                o.put("effect", effectAtStart);
                o.put("output_held", outputHeld);
                if (error != null) {
                    o.put("error", error);
                }
            } catch (Exception ignored) {
                // JSONObject.put only throws for NaN/infinite doubles
            }
            return o;
        }
    }

    /** Samples the running clip until it is no longer the current one. */
    private final class Sampler implements Runnable {
        private final int id;
        private final MediaPlayer mp;
        private final ClipStats clipStats;

        Sampler(int id, MediaPlayer mp, ClipStats clipStats) {
            this.id = id;
            this.mp = mp;
            this.clipStats = clipStats;
        }

        @Override
        public void run() {
            if (currentId != id || player != mp) {
                return;
            }
            boolean playing;
            try {
                playing = mp.isPlaying();
            } catch (IllegalStateException e) {
                return;
            }
            if (!playing) {
                return;
            }
            clipStats.sample(mp);
            main.postDelayed(this, SAMPLE_INTERVAL_MS);
        }
    }

    /** Best effort: which kind of output is connected. */
    private String describeRoute() {
        try {
            AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            boolean bluetooth = false;
            boolean wired = false;
            boolean speaker = false;
            for (AudioDeviceInfo d : devices) {
                switch (d.getType()) {
                    case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                    case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                    case AudioDeviceInfo.TYPE_HEARING_AID:
                    case AudioDeviceInfo.TYPE_BLE_HEADSET:
                    case AudioDeviceInfo.TYPE_BLE_SPEAKER:
                    case AudioDeviceInfo.TYPE_BLE_BROADCAST:
                        bluetooth = true;
                        break;
                    case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                    case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                    case AudioDeviceInfo.TYPE_USB_HEADSET:
                    case AudioDeviceInfo.TYPE_USB_DEVICE:
                        wired = true;
                        break;
                    case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                        speaker = true;
                        break;
                    default:
                        break;
                }
            }
            if (bluetooth) {
                return "bluetooth";
            }
            if (wired) {
                return "wired";
            }
            return speaker ? "speaker" : "unknown";
        } catch (Exception e) {
            return "unknown";
        }
    }

    // =====================================================================
    // Compressor + limiter
    // =====================================================================

    @JavascriptInterface
    public void setCompression(boolean on) {
        compressionWanted = on;
        activity.runOnUiThread(this::ensureEffect);
    }

    /**
     * Speech from the TTS is quiet on average with peaks ~17 dB above it, so
     * the phone runs near full volume and the peaks hit the speaker's own
     * protection. A gentle compressor brings the average up; a limiter keeps
     * the peaks off the ceiling. Both are the platform's DynamicsProcessing
     * effect on the shared session — no re-encoding, and each clip is
     * processed by the media server, not the page.
     */
    private void ensureEffect() {
        if (!compressionWanted) {
            releaseEffect();
            effectState = "off";
            return;
        }
        if (effect != null) {
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            effectState = "unsupported";
            return;
        }
        try {
            DynamicsProcessing.Config.Builder builder = new DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_TIME_RESOLUTION,
                    2, // channels: the mixer's format, whatever the clip is
                    false, 0, // no pre-EQ
                    true, 1, // one full-band compressor
                    false, 0, // no post-EQ
                    true); // limiter
            builder.setPreferredFrameDuration(10f);
            DynamicsProcessing dp = new DynamicsProcessing(0, sessionId, builder.build());

            DynamicsProcessing.MbcBand band = new DynamicsProcessing.MbcBand(
                    true,
                    20000f, // cutoff: the single band covers everything
                    4f, // attack ms
                    80f, // release ms
                    3f, // ratio
                    -22f, // threshold dBFS: just above the average speech level
                    6f, // knee width dB
                    -70f, // noise gate threshold: effectively off
                    1f, // expander ratio: off
                    0f, // pre gain dB
                    6f); // post gain dB: the loudness win
            dp.setMbcBandAllChannelsTo(0, band);

            DynamicsProcessing.Limiter limiter = new DynamicsProcessing.Limiter(
                    true, true,
                    0, // link group
                    1f, // attack ms
                    60f, // release ms
                    10f, // ratio
                    -3f, // threshold dBFS
                    0f); // post gain
            dp.setLimiterAllChannelsTo(limiter);

            dp.setEnabled(true);
            effect = dp;
            effectState = "on";
        } catch (Exception e) {
            Log.w(TAG, "compressor unavailable", e);
            effectState = "unavailable";
        }
    }

    private void releaseEffect() {
        if (effect != null) {
            try {
                effect.setEnabled(false);
            } catch (Exception ignored) {
                // Already gone
            }
            effect.release();
            effect = null;
        }
    }

    // =====================================================================
    // Keep the output awake
    // =====================================================================

    @JavascriptInterface
    public void setKeepAwake(boolean on) {
        keepAwakeWanted = on;
        activity.runOnUiThread(this::updateKeepAlive);
    }

    @JavascriptInterface
    public void holdOutput(boolean hold) {
        activity.runOnUiThread(() -> {
            holds = Math.max(0, holds + (hold ? 1 : -1));
            updateKeepAlive();
        });
    }

    /** Called from the activity: the keep-alive only runs while visible. */
    void setForeground(boolean inForeground) {
        activity.runOnUiThread(() -> {
            foreground = inForeground;
            updateKeepAlive();
        });
    }

    /**
     * Android drops the audio output into standby after a few seconds of
     * silence, and the first buffers after it wakes are where a clip pops
     * and stumbles — Jerome's "quiet, then a level change, clean on replay".
     * Bluetooth headsets lose even more, re-opening their link per clip.
     * A looping track of ±1 LSB noise (about -90 dBFS, inaudible, but not
     * digital silence the HAL could optimise away) keeps the output open
     * while a study screen is up. No audio focus is requested, so other apps'
     * music is untouched.
     */
    private void updateKeepAlive() {
        boolean want = keepAwakeWanted && holds > 0 && foreground;
        if (want && keepAlive == null) {
            startKeepAlive();
        } else if (!want && keepAlive != null) {
            stopKeepAlive();
        }
    }

    private void startKeepAlive() {
        final int rate = 48000;
        final int frames = rate; // one second, looped
        short[] buffer = new short[frames];
        Random random = new Random();
        for (int i = 0; i < frames; i++) {
            buffer[i] = (short) (random.nextBoolean() ? 1 : -1);
        }
        try {
            AudioTrack track = new AudioTrack.Builder()
                    .setAudioAttributes(attributes())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(rate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(frames * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build();
            track.write(buffer, 0, frames);
            track.setLoopPoints(0, frames, -1);
            track.play();
            keepAlive = track;
        } catch (Exception e) {
            Log.w(TAG, "keep-alive unavailable", e);
        }
    }

    private void stopKeepAlive() {
        try {
            keepAlive.stop();
        } catch (Exception ignored) {
            // Already stopped
        }
        keepAlive.release();
        keepAlive = null;
    }

    // =====================================================================
    // State for Settings
    // =====================================================================

    @JavascriptInterface
    public String describe() {
        JSONObject o = new JSONObject();
        try {
            o.put("bridge", PROTOCOL_VERSION);
            o.put("compression", compressionWanted);
            o.put("effect", effectState);
            o.put("keep_awake", keepAwakeWanted);
            o.put("output_held", keepAlive != null);
            o.put("holds", holds);
            o.put("route", describeRoute());
            o.put("volume", audioManager.getStreamVolume(AudioManager.STREAM_MUSIC));
            o.put("volume_max", audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            o.put("cached_clips", countCache());
            o.put("sdk", Build.VERSION.SDK_INT);
        } catch (Exception ignored) {
            // see toJson
        }
        return o.toString();
    }

    // =====================================================================
    // Files
    // =====================================================================

    private static byte[] decodeDataUrl(String dataUrl) throws IOException {
        int comma = dataUrl.indexOf(',');
        if (comma < 0) {
            throw new IOException("malformed data URL");
        }
        return Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
    }

    private static void writeBytes(File file, byte[] bytes) throws IOException {
        File tmp = new File(file.getPath() + ".part");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(bytes);
        }
        if (!tmp.renameTo(file)) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IOException("cannot move clip into place");
        }
    }

    private File tempDir() throws IOException {
        File dir = new File(activity.getCacheDir(), "audio");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("cannot create temp dir");
        }
        return dir;
    }

    private File cacheDir() {
        return new File(activity.getCacheDir(), "audio-clips");
    }

    /** Decode a data: URL into a per-clip file, deleted after playback. */
    private File writeTempClip(int id, String dataUrl) throws IOException {
        File file = new File(tempDir(), "clip-" + id + ".mp3");
        writeBytes(file, decodeDataUrl(dataUrl));
        return file;
    }

    /** Decode a data: URL into the cache under its key; kept for next time. */
    private File writeCachedClip(String key, String dataUrl) throws IOException {
        File dir = cacheDir();
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("cannot create cache dir");
        }
        File file = cacheFile(key);
        writeBytes(file, decodeDataUrl(dataUrl));
        return file;
    }

    /** The key is an R2 path; hash it so it is a safe, fixed-length filename. */
    private File cacheFile(String key) {
        String name;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] hash = digest.digest(key.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            name = sb.toString();
        } catch (Exception e) {
            name = Integer.toHexString(key.hashCode());
        }
        return new File(cacheDir(), name + ".mp3");
    }

    private int countCache() {
        File[] files = cacheDir().listFiles();
        return files == null ? 0 : files.length;
    }

    /** Drop the least recently played clips once the cache outgrows its budget. */
    private void trimCache() {
        File[] files = cacheDir().listFiles();
        if (files == null) {
            return;
        }
        long total = 0;
        for (File f : files) {
            total += f.length();
        }
        if (total <= CACHE_LIMIT_BYTES) {
            return;
        }
        // Not Comparator.comparingLong: that is a Java 8 API, absent below API 24.
        Arrays.sort(files, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        for (File f : files) {
            if (total <= CACHE_LIMIT_BYTES) {
                break;
            }
            long size = f.length();
            if (f.delete()) {
                total -= size;
            }
        }
    }

    private void emit(int id, String event, JSONObject stats) {
        String js = "window.dispatchEvent(new CustomEvent('android-audio',{detail:{id:" + id
                + ",event:" + JSONObject.quote(event)
                + (stats != null ? ",stats:" + stats : "")
                + "}}))";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
