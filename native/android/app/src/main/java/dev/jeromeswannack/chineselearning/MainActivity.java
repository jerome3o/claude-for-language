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
import android.widget.Toast;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
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
import java.io.OutputStream;
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
        saveFileLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                this::writePendingDownload);
        setUpStatusBarBackground();
        setUpKeyboardAwareInsets();
        setUpClipboardBridge();
        setUpDownloadBridge();
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
     * Blob downloads (<a download> with a blob: URL) silently do nothing in
     * the WebView — there's no download handler — so "Download Backup" in
     * Settings never produced a file. Expose window.AndroidDownload to the
     * page: it opens the system "Save as" dialog (Storage Access Framework)
     * so the user picks where the file goes, then writes the bytes there.
     * The frontend prefers it whenever present (see
     * frontend/src/utils/download.ts).
     */
    private void setUpDownloadBridge() {
        bridge.getWebView().addJavascriptInterface(new DownloadBridge(), "AndroidDownload");
    }

    /** Bytes waiting for the user to pick a save location in the SAF dialog. */
    private byte[] pendingDownloadBytes;
    private ActivityResultLauncher<Intent> saveFileLauncher;

    private void writePendingDownload(ActivityResult result) {
        byte[] bytes = pendingDownloadBytes;
        pendingDownloadBytes = null;
        if (bytes == null
                || result.getResultCode() != RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            return;
        }
        Uri uri = result.getData().getData();
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            out.write(bytes);
            Toast.makeText(this, "File saved", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.e("DownloadBridge", "writing picked file failed", e);
            Toast.makeText(this, "Failed to save file", Toast.LENGTH_SHORT).show();
        }
    }

    private class DownloadBridge {

        /** Returns true when the save dialog was launched (write happens after the pick). */
        @JavascriptInterface
        public boolean saveFile(String filename, String mimeType, String base64Data) {
            if (filename == null || filename.isEmpty()
                    || base64Data == null || base64Data.isEmpty()) {
                return false;
            }
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64Data, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                Log.e("DownloadBridge", "invalid base64 payload", e);
                return false;
            }
            String type = mimeType == null || mimeType.isEmpty()
                    ? "application/octet-stream" : mimeType;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(type)
                    .putExtra(Intent.EXTRA_TITLE, filename);
            runOnUiThread(() -> {
                pendingDownloadBytes = bytes;
                try {
                    saveFileLauncher.launch(intent);
                } catch (Exception e) {
                    Log.e("DownloadBridge", "launching save dialog failed", e);
                    pendingDownloadBytes = null;
                }
            });
            return true;
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
