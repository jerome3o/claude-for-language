package dev.jeromeswannack.chineselearning;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * Entry point for the Android text-selection toolbar (ACTION_PROCESS_TEXT).
 * Selecting text anywhere on the device and choosing "Sentence Coach" opens
 * the app on the Sentence Coach page with the selection pre-filled.
 */
public class ProcessTextActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        CharSequence text = getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        String selected = text != null ? text.toString().trim() : "";

        String route = "/coach";
        if (!selected.isEmpty()) {
            try {
                route += "?text=" + URLEncoder.encode(selected, "UTF-8");
            } catch (UnsupportedEncodingException ignored) {
                // UTF-8 is always available; fall back to the bare coach page
            }
        }

        Intent launch = new Intent(this, MainActivity.class);
        launch.putExtra(MainActivity.EXTRA_ROUTE, route);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(launch);
        finish();
    }
}
