package dev.jeromeswannack.chineselearning;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The JavaScript bridges (window.AndroidClipboard / AndroidAudio / AndroidDownload)
 * are added with addJavascriptInterface, which exposes them to whatever page the
 * WebView shows — including a Google sign-in page or anything else allowNavigation
 * lets in. Every bridge method asks {@link #allowed()} first and does nothing unless
 * the WebView's current page is on the app's own origin (capacitor.config.json
 * server.url).
 *
 * The page URL is read on the UI thread (WebView.getUrl() must be), so a call from
 * the JavaBridge thread waits for one main-thread hop; a hop that doesn't come back
 * within a second counts as "not allowed".
 */
final class AppPageGuard {

    private static final String TAG = "AppPageGuard";

    private final WebView webView;
    private final String appOrigin;
    private final Handler main = new Handler(Looper.getMainLooper());

    AppPageGuard(WebView webView, String appUrl) {
        this.webView = webView;
        this.appOrigin = originOf(appUrl);
    }

    /** True when the WebView is showing the app's own page. */
    boolean allowed() {
        String origin = originOf(currentUrl());
        boolean ok = appOrigin != null && appOrigin.equals(origin);
        if (!ok) {
            Log.w(TAG, "bridge call refused for page origin " + origin);
        }
        return ok;
    }

    private String currentUrl() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return webView.getUrl();
        }
        AtomicReference<String> url = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        main.post(() -> {
            try {
                url.set(webView.getUrl());
            } finally {
                done.countDown();
            }
        });
        try {
            if (!done.await(1, TimeUnit.SECONDS)) {
                return null;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
        return url.get();
    }

    /** "https://host:443" for an http(s) URL, else null. */
    static String originOf(String url) {
        if (url == null || url.isEmpty()) {
            return null;
        }
        Uri u = Uri.parse(url);
        String scheme = u.getScheme();
        String host = u.getHost();
        if (scheme == null || host == null || host.isEmpty()) {
            return null;
        }
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            return null;
        }
        int port = u.getPort();
        if (port == -1) {
            port = scheme.equals("https") ? 443 : 80;
        }
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
    }
}
