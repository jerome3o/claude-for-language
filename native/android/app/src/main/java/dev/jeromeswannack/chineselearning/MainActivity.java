package dev.jeromeswannack.chineselearning;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {

    /** Intent extra carrying an in-app route like "/coach?text=..." */
    static final String EXTRA_ROUTE = "route";

    /** Custom scheme used by launcher shortcuts: chineselearning:///study */
    static final String DEEP_LINK_SCHEME = "chineselearning";

    /** Fallback when the Capacitor server URL is unavailable; must match capacitor.config.json */
    static final String APP_URL = "https://chinese-learning-2x9.pages.dev";

    /** Must match --color-primary in frontend/src/index.css (the header red). */
    static final int STATUS_BAR_COLOR = Color.parseColor("#dc2626");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setUpStatusBarBackground();
        setUpKeyboardAwareInsets();
        setUpClipboardBridge();
        handleRouteIntent(getIntent());
        setUpHomeworkNotifications();
    }

    /**
     * The WebView's async clipboard API (navigator.clipboard.write/writeText)
     * can resolve WITHOUT writing anything, so web-side copy buttons show
     * "Copied!" while the clipboard stays empty. Expose the real Android
     * clipboard to the page as window.AndroidClipboard; the frontend prefers
     * it whenever present (see frontend/src/utils/clipboard.ts).
     */
    private void setUpClipboardBridge() {
        bridge.getWebView().addJavascriptInterface(new ClipboardBridge(), "AndroidClipboard");
    }

    private class ClipboardBridge {

        /** Runs on the JS bridge thread; hop to main for ClipboardManager. */
        private boolean setClip(ClipData clip) {
            AtomicBoolean ok = new AtomicBoolean(false);
            CountDownLatch done = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(clip);
                    ok.set(true);
                } catch (Exception e) {
                    Log.e("ClipboardBridge", "setPrimaryClip failed", e);
                } finally {
                    done.countDown();
                }
            });
            try {
                done.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return ok.get();
        }

        @JavascriptInterface
        public boolean writeText(String text) {
            if (text == null) {
                return false;
            }
            return setClip(ClipData.newPlainText("Chinese Learning", text));
        }

        @JavascriptInterface
        public boolean writeImageBase64(String base64Png) {
            if (base64Png == null || base64Png.isEmpty()) {
                return false;
            }
            try {
                byte[] bytes = Base64.decode(base64Png, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "clipboard");
                if (!dir.exists() && !dir.mkdirs()) {
                    return false;
                }
                File file = new File(dir, "clipboard.png");
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                // Reuse the app's existing FileProvider (its cache-path entry
                // in res/xml/file_paths.xml covers getCacheDir()).
                Uri uri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        file);
                return setClip(ClipData.newUri(getContentResolver(), "Chinese Learning", uri));
            } catch (Exception e) {
                Log.e("ClipboardBridge", "writeImageBase64 failed", e);
                return false;
            }
        }
    }

    /**
     * Capacitor's adjustMarginsForEdgeToEdge listener only insets the WebView
     * for system bars — NOT the keyboard — and consumes the insets, so the
     * IME just covers the page (unlike Chrome/PWA, where the browser resizes
     * the viewport). Replace its listener with one that also applies the IME
     * inset, shrinking the WebView so focused inputs stay visible while
     * typing.
     */
    private void setUpKeyboardAwareInsets() {
        WebView webView = bridge.getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            mlp.leftMargin = bars.left;
            mlp.rightMargin = bars.right;
            mlp.topMargin = bars.top;
            mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
            v.setLayoutParams(mlp);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    /** Hourly due-card notifications (see HomeworkWorker). */
    private void setUpHomeworkNotifications() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
        }
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                HomeworkWorker.class, 1, TimeUnit.HOURS)
            .setConstraints(new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build())
            .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            HomeworkWorker.UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /**
     * With edge-to-edge enforced (targetSdk 35) the WebView is inset below the
     * status bar (adjustMarginsForEdgeToEdge in capacitor.config.json), which
     * leaves the window background showing behind the clock/icons. Paint that
     * strip the app's header red and keep the status bar icons white.
     */
    private void setUpStatusBarBackground() {
        ViewGroup content = findViewById(android.R.id.content);
        View strip = new View(this);
        strip.setBackgroundColor(STATUS_BAR_COLOR);
        content.addView(strip, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            int top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            ViewGroup.LayoutParams lp = strip.getLayoutParams();
            if (lp.height != top) {
                lp.height = top;
                strip.setLayoutParams(lp);
            }
            // Don't consume — Capacitor's WebView margin listener still needs these.
            return ViewCompat.onApplyWindowInsets(v, insets);
        });

        // White clock/icons to match the red strip.
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRouteIntent(intent);
    }

    private void handleRouteIntent(Intent intent) {
        String route = extractRoute(intent);
        if (route == null || route.isEmpty()) {
            return;
        }
        if (!route.startsWith("/")) {
            route = "/" + route;
        }
        String base = bridge != null && bridge.getServerUrl() != null ? bridge.getServerUrl() : APP_URL;
        final String url = base + route;
        final String finalRoute = route;
        final WebView webView = bridge.getWebView();
        webView.post(() -> {
            String current = webView.getUrl();
            if (current != null && current.startsWith(base)) {
                // App already loaded — navigate inside the SPA instead of a
                // full reload (which re-boots React and re-runs auth/sync).
                String js = "window.dispatchEvent(new CustomEvent('native-navigate',{detail:"
                    + org.json.JSONObject.quote(finalRoute) + "}))";
                webView.evaluateJavascript(js, null);
            } else {
                webView.loadUrl(url);
            }
        });
    }

    private String extractRoute(Intent intent) {
        if (intent == null) {
            return null;
        }
        String route = intent.getStringExtra(EXTRA_ROUTE);
        if (route != null && !route.isEmpty()) {
            // Consume the extra so rotation/recreation doesn't re-navigate
            intent.removeExtra(EXTRA_ROUTE);
            return route;
        }
        Uri data = intent.getData();
        if (data != null && DEEP_LINK_SCHEME.equals(data.getScheme())) {
            intent.setData(null);
            String path = data.getPath() != null && !data.getPath().isEmpty() ? data.getPath() : "/";
            String query = data.getQuery();
            return query != null ? path + "?" + query : path;
        }
        return null;
    }
}
