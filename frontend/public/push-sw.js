/* Push handling for the PWA's service worker (imported by the Workbox SW —
 * vite.config.ts `workbox.importScripts`). Plain JS: it runs inside the
 * service worker, not the app bundle.
 *
 * A push carries a CallPushPayload (shared/calls/alerts.ts):
 *   { type: 'call' | 'call_missed' | 'test', call_id, title, body, url, tag }
 * Every open tab is told at once (so its banner / ring appear without waiting
 * for the next poll). The notification is skipped only when a tab is in front
 * and can show the call itself (a normal page, not a full-screen one such as a
 * study session — the app's banner doesn't show there).
 *
 * A chat message (docs/CHAT.md §3) carries
 *   { type: 'chat_message', title: sender name, body: preview, url, tag: 'chat-<convId>',
 *     conversation_id, relationship_id, sender_picture_url? }
 * It is skipped only when a focused, visible tab is on that very chat; otherwise one
 * notification per conversation (the tag replaces the previous one, renotify buzzes again).
 */

/* Keep in step with IMMERSIVE in frontend/src/components/nav/tabs.ts. */
var PUSH_IMMERSIVE = [
  /^\/study\/?$/,
  /^\/quests\/[^/]+\/?$/,
  /^\/readers\/(?!generate$)[^/]+(\/(edit|print))?\/?$/,
  /^\/library\/[^/]+\/(edit|print|try)\/?$/,
  /^\/library\/catalogue\/[^/]+\/?$/,
  /^\/decks\/[^/]+\/try\/?$/,
  /^\/lessons\/[^/]+\/(edit|print)\/?$/,
  /^\/connections\/[^/]+\/chat\//,
  /^\/join\//,
  /^\/calls\/[^/]+\/?$/,
  /^\/homework\/[^/]+\/?$/,
];

function pushPathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (e) {
    return '/';
  }
}

/* Keep in step with chatOpenInFront in frontend/src/services/chatNotifications.ts (tested there). */
function pushChatPath(url) {
  try {
    return new URL(url, 'https://app.invalid').pathname.replace(/\/+$/, '') || '/';
  } catch (e) {
    return null;
  }
}

function pushChatOpenInFront(data, list) {
  var target = data && data.url ? pushChatPath(data.url) : null;
  if (!target) return false;
  return list.some(function (c) {
    return !!c.focused && c.visibilityState === 'visible' && pushChatPath(c.url) === target;
  });
}

function pushShowChat(data, list) {
  if (pushChatOpenInFront(data, list)) return undefined;
  var tag = data.tag || (data.conversation_id ? 'chat-' + data.conversation_id : undefined);
  return self.registration.showNotification(data.title || 'New message', {
    body: data.body || '',
    tag: tag,
    renotify: !!tag,
    icon: data.sender_picture_url || '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200],
    data: { url: data.url || '/', conversation_id: data.conversation_id || null, type: 'chat_message' },
  });
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: event.data ? event.data.text() : 'Chinese Learning' };
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      list.forEach(function (c) {
        c.postMessage({ type: 'push', data: data });
      });
      if (data.type === 'chat_message') return pushShowChat(data, list);
      var inFront = list.some(function (c) {
        if (!c.focused || c.visibilityState !== 'visible') return false;
        var path = pushPathOf(c.url);
        // Already on this call's page, or on a normal page that shows the banner and rings.
        if (data.call_id && path === '/calls/' + data.call_id) return true;
        return data.type === 'call' && !PUSH_IMMERSIVE.some(function (re) { return re.test(path); });
      });
      if (inFront) return undefined;
      var isCall = data.type === 'call';
      return self.registration.showNotification(data.title || 'Chinese Learning', {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: isCall,
        requireInteraction: isCall,
        vibrate: isCall ? [400, 200, 400, 200, 400, 1000, 400, 200, 400] : [200],
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: { url: data.url || '/', call_id: data.call_id || null, type: data.type || null },
        actions: isCall ? [{ action: 'join', title: 'Join' }] : [],
      });
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var target = new URL(url, self.location.origin).href;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          // The open app navigates itself (components/calls/CallAlerts.tsx) — no reload, the call keeps its state.
          c.postMessage({ type: 'navigate', url: url });
          return c.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
