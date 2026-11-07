package dev.jeromeswannack.chineselearning;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import java.util.Locale;

/**
 * The JavaScript bridges (window.AndroidClipboard / AndroidAudio / AndroidDownload)
 * are added with addJavascriptInterface, which exposes them to whatever page the
 * WebView shows — including a Google sign-in page or anything else allowNavigation
 * lets in. Every bridge method asks {@link #allowed()} first and does nothing unless
 * the WebView's current page is on the app's own origin (capacitor.config.json
 * server.url).
 *
 * The page's origin is recorded on the UI thread whenever a page starts / finishes
 * loading (a Capacitor WebViewListener, MainActivity) and read from any thread
 * without waiting, so a bridge call (audio plays often) never blocks on the UI
 * thread. Until the first page starts, nothing is allowed.
 */
final class AppPageGuard {

    private static final String TAG = "AppPageGuard";

    private final String appOrigin;
    private volatile String pageOrigin;

    AppPageGuard(String appUrl) {
        this.appOrigin = originOf(appUrl);
    }

    /** Call on the UI thread when a page starts or finishes loading. */
    void onPage(WebView webView) {
        pageOrigin = originOf(webView.getUrl());
    }

    /** True when the WebView is showing the app's own page. */
    boolean allowed() {
        String origin = pageOrigin;
        boolean ok = appOrigin != null && appOrigin.equals(origin);
        if (!ok) {
            Log.w(TAG, "bridge call refused for page origin " + origin);
        }
        return ok;
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
