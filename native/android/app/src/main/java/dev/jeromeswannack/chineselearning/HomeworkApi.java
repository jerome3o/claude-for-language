package dev.jeromeswannack.chineselearning;

import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Minimal API client for the notification review flow. Authenticates with the
 * session cookie the WebView already holds for the API domain, so reviews
 * recorded from a notification are ordinary server-side review events that
 * every device picks up on its next sync.
 */
final class HomeworkApi {

    static final String API_BASE = "https://chinese-learning-api.jeromeswannack.workers.dev";

    private HomeworkApi() {}

    /** The WebView's cookies for the API domain, or null when signed out. */
    static String cookieHeader() {
        try {
            return CookieManager.getInstance().getCookie(API_BASE);
        } catch (Exception e) {
            return null;
        }
    }

    /** First due hanzi->meaning review card, or null when there's no homework. */
    static JSONObject fetchDueHanziCard() throws Exception {
        String cookies = cookieHeader();
        if (cookies == null || cookies.isEmpty()) {
            return null;
        }
        HttpURLConnection conn = open("/api/cards/due?include_new=false&limit=20", "GET", cookies);
        try {
            if (conn.getResponseCode() != 200) {
                return null;
            }
            JSONArray cards = new JSONArray(readBody(conn));
            for (int i = 0; i < cards.length(); i++) {
                JSONObject card = cards.getJSONObject(i);
                if ("hanzi_to_meaning".equals(card.optString("card_type"))
                        && !card.optString("hanzi").isEmpty()
                        && !card.isNull("next_review_at")) {
                    return card;
                }
            }
            return null;
        } finally {
            conn.disconnect();
        }
    }

    /** Records a review as a normal server-side review event. */
    static boolean postReview(String cardId, int rating) {
        String cookies = cookieHeader();
        if (cookies == null || cookies.isEmpty()) {
            return false;
        }
        try {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));

            JSONObject event = new JSONObject()
                .put("id", UUID.randomUUID().toString())
                .put("card_id", cardId)
                .put("rating", rating)
                .put("reviewed_at", iso.format(new Date()));
            JSONObject body = new JSONObject().put("events", new JSONArray().put(event));

            HttpURLConnection conn = open("/api/reviews", "POST", cookies);
            try {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                return conn.getResponseCode() == 200;
            } finally {
                conn.disconnect();
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static HttpURLConnection open(String path, String method, String cookies) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(API_BASE + path).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Cookie", cookies);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        return conn;
    }

    private static String readBody(HttpURLConnection conn) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
        }
        return sb.toString();
    }
}
