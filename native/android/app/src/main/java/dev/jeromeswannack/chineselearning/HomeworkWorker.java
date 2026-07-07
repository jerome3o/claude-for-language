package dev.jeromeswannack.chineselearning;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * Hourly background check: if a review card is due, post a notification the
 * user can answer without opening the app. Silent when there's no homework,
 * when signed out, or during quiet hours.
 */
public class HomeworkWorker extends Worker {

    static final String UNIQUE_WORK_NAME = "homework-notifications";
    private static final int QUIET_BEFORE_HOUR = 8;   // no homework before 08:00
    private static final int QUIET_FROM_HOUR = 22;    // ...or after 22:00

    public HomeworkWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (hour < QUIET_BEFORE_HOUR || hour >= QUIET_FROM_HOUR) {
            return Result.success();
        }

        try {
            JSONObject card = HomeworkApi.fetchDueHanziCard();
            if (card == null) {
                return Result.success(); // no homework (or signed out) — stay silent
            }
            HomeworkNotifier.showCardFront(
                getApplicationContext(),
                card.getString("id"),
                card.optString("hanzi"),
                card.optString("pinyin"),
                card.optString("english")
            );
            return Result.success();
        } catch (Exception e) {
            // Network hiccup — try again next hour rather than retrying now
            return Result.success();
        }
    }
}
