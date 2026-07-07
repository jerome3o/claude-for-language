package dev.jeromeswannack.chineselearning;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles the notification's "Show answer" and Again/Good/Easy actions. */
public class HomeworkActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (HomeworkNotifier.ACTION_SHOW_ANSWER.equals(action)) {
            HomeworkNotifier.showCardBack(
                context,
                intent.getStringExtra(HomeworkNotifier.EXTRA_CARD_ID),
                intent.getStringExtra(HomeworkNotifier.EXTRA_HANZI),
                intent.getStringExtra(HomeworkNotifier.EXTRA_PINYIN),
                intent.getStringExtra(HomeworkNotifier.EXTRA_ENGLISH)
            );
            return;
        }

        if (HomeworkNotifier.ACTION_RATE.equals(action)) {
            final String cardId = intent.getStringExtra(HomeworkNotifier.EXTRA_CARD_ID);
            final int rating = intent.getIntExtra(HomeworkNotifier.EXTRA_RATING, 2);
            final Context appContext = context.getApplicationContext();
            // Network isn't allowed on the main thread; goAsync keeps the
            // receiver alive while the review posts in the background.
            final PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    boolean ok = HomeworkApi.postReview(cardId, rating);
                    if (ok) {
                        HomeworkNotifier.dismiss(appContext);
                    } else {
                        HomeworkNotifier.showError(appContext, "Tap to review in the app instead.");
                    }
                } finally {
                    pending.finish();
                }
            }).start();
        }
    }
}
