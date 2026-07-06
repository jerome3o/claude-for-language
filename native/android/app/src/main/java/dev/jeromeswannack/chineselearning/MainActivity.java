package dev.jeromeswannack.chineselearning;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

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
        handleRouteIntent(getIntent());
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
        final WebView webView = bridge.getWebView();
        webView.post(() -> webView.loadUrl(url));
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
