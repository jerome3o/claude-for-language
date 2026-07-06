package dev.jeromeswannack.chineselearning;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Intent extra carrying an in-app route like "/coach?text=..." */
    static final String EXTRA_ROUTE = "route";

    /** Custom scheme used by launcher shortcuts: chineselearning:///study */
    static final String DEEP_LINK_SCHEME = "chineselearning";

    /** Fallback when the Capacitor server URL is unavailable; must match capacitor.config.json */
    static final String APP_URL = "https://chinese-learning-2x9.pages.dev";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleRouteIntent(getIntent());
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
