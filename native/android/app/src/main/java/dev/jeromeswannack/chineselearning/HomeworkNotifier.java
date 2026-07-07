package dev.jeromeswannack.chineselearning;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Builds the two states of the homework notification:
 * front (hanzi + "Show answer") and back (pinyin/english + Again/Good/Easy).
 */
final class HomeworkNotifier {

    static final String CHANNEL_ID = "homework";
    static final int NOTIFICATION_ID = 2001;

    static final String ACTION_SHOW_ANSWER = "dev.jeromeswannack.chineselearning.SHOW_ANSWER";
    static final String ACTION_RATE = "dev.jeromeswannack.chineselearning.RATE";
    static final String EXTRA_CARD_ID = "card_id";
    static final String EXTRA_HANZI = "hanzi";
    static final String EXTRA_PINYIN = "pinyin";
    static final String EXTRA_ENGLISH = "english";
    static final String EXTRA_RATING = "rating";

    private HomeworkNotifier() {}

    static void ensureChannel(Context ctx) {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Homework reminders", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("A due flashcard you can answer from the notification");
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    static void showCardFront(Context ctx, String cardId, String hanzi, String pinyin, String english) {
        ensureChannel(ctx);

        Intent reveal = new Intent(ctx, HomeworkActionReceiver.class)
            .setAction(ACTION_SHOW_ANSWER)
            .putExtra(EXTRA_CARD_ID, cardId)
            .putExtra(EXTRA_HANZI, hanzi)
            .putExtra(EXTRA_PINYIN, pinyin)
            .putExtra(EXTRA_ENGLISH, english);

        Notification notification = baseBuilder(ctx)
            .setContentTitle(hanzi)
            .setContentText("What does this mean? Think, then reveal.")
            .addAction(0, "Show answer", broadcast(ctx, 1, reveal))
            .build();

        notify(ctx, notification);
    }

    static void showCardBack(Context ctx, String cardId, String hanzi, String pinyin, String english) {
        Notification notification = baseBuilder(ctx)
            .setContentTitle(hanzi + "  ·  " + pinyin)
            .setContentText(english)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(english))
            .addAction(0, "Again", rateIntent(ctx, cardId, 0))
            .addAction(0, "Good", rateIntent(ctx, cardId, 2))
            .addAction(0, "Easy", rateIntent(ctx, cardId, 3))
            .build();

        notify(ctx, notification);
    }

    static void showError(Context ctx, String message) {
        Notification notification = baseBuilder(ctx)
            .setContentTitle("Couldn't record review")
            .setContentText(message)
            .setTimeoutAfter(15000)
            .build();
        notify(ctx, notification);
    }

    static void dismiss(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID);
    }

    private static NotificationCompat.Builder baseBuilder(Context ctx) {
        // Tapping the notification body opens a full study session
        Intent open = new Intent(ctx, MainActivity.class)
            .putExtra(MainActivity.EXTRA_ROUTE, "/study?autostart=true")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            // The launcher foreground (white 汉 on transparent) doubles as a status-bar icon
            .setSmallIcon(R.mipmap.ic_launcher_foreground)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false);
    }

    private static PendingIntent rateIntent(Context ctx, String cardId, int rating) {
        Intent rate = new Intent(ctx, HomeworkActionReceiver.class)
            .setAction(ACTION_RATE)
            .putExtra(EXTRA_CARD_ID, cardId)
            .putExtra(EXTRA_RATING, rating);
        // requestCode must differ per rating or the PendingIntents collapse into one
        return broadcast(ctx, 10 + rating, rate);
    }

    private static PendingIntent broadcast(Context ctx, int requestCode, Intent intent) {
        return PendingIntent.getBroadcast(
            ctx, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void notify(Context ctx, Notification notification) {
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // Notification permission revoked — nothing to do
        }
    }
}
