package dev.jeromeswannack.chineselearning;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Home-screen widget with shortcuts that deep-link into the app:
 * Study, Sentence Coach, and Decks (home).
 */
public class ShortcutsWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_shortcuts);

            views.setOnClickPendingIntent(R.id.widget_button_study, routeIntent(context, 0, "/study"));
            views.setOnClickPendingIntent(R.id.widget_button_coach, routeIntent(context, 1, "/coach"));
            views.setOnClickPendingIntent(R.id.widget_button_decks, routeIntent(context, 2, "/"));

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }

    private PendingIntent routeIntent(Context context, int requestCode, String route) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.putExtra(MainActivity.EXTRA_ROUTE, route);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
