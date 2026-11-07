import { User } from '../types';

/*
 * ntfy.sh topics are PUBLIC: anyone who knows (or guesses) the topic name can read every
 * message. So these pings carry no e-mail addresses, names or message text (Nov 2026) —
 * only that something happened; the details are in the app (admin page, chat, feedback).
 */

async function sendNtfy(topic: string, title: string, body: string, tags: string, priority: string = '3'): Promise<void> {
  if (!topic) {
    console.log('[Notifications] No topic configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Title': title, 'Tags': tags, 'Priority': priority },
      body,
    });

    if (!response.ok) {
      console.error('[Notifications] Failed to send notification:', response.status);
    } else {
      console.log('[Notifications] Push notification sent:', title);
    }
  } catch (error) {
    console.error('[Notifications] Error sending notification:', error);
  }
}

export async function notifyNewUser(topic: string, _user: User): Promise<void> {
  await sendNtfy(
    topic,
    'New User - Chinese Learning App',
    `Someone signed up with an invite. Who: the admin page → All users.`,
    'bust_in_silhouette,new',
  );
}

/** One line, sent the first time an uninvited Google account tries to sign in. */
export async function notifyAccessRequest(
  topic: string,
  _person: { email: string; name?: string | null }
): Promise<void> {
  await sendNtfy(
    topic,
    'Access request - Chinese Learning App',
    'Someone without an invite tried to sign in — see the admin page',
    'raised_hand',
  );
}

/** Someone other than an admin sent in-app feedback (docs/FEEDBACK.md). */
export async function notifyFeedback(topic: string, info: { name: string; kind: string; preview: string; screenshot: boolean }): Promise<void> {
  await sendNtfy(
    topic,
    info.kind === 'bug' ? 'Feedback: something is wrong' : 'Feedback',
    `New feedback${info.screenshot ? ' with a screenshot' : ''} — read it in Settings → Feature requests`,
    info.kind === 'bug' ? 'bug' : 'bulb',
  );
}

export async function notifyNewChatMessage(topic: string, _senderName: string, _messagePreview: string): Promise<void> {
  await sendNtfy(
    topic,
    'New Chat Message',
    'A new chat message — open the app to read it',
    'speech_balloon',
  );
}

/** MiniMax stopped speaking for an account reason (no credit, bad key) — sent once when it starts. */
export async function notifyTtsAccountProblem(topic: string, problem: { code: number | string; message: string; provider?: string }): Promise<void> {
  const name = problem.provider ?? 'MiniMax';
  await sendNtfy(
    topic,
    `${name} TTS paused - Chinese Learning App`,
    `Every ${name} call fails: ${problem.code} ${problem.message}\n${name} is paused (retrying every 5–60 min; the next provider in /admin/audio speaks meanwhile); no clip loses its attempts. Check the credit / API key.`,
    'warning,sound',
    '4',
  );
}

/** …and once when a probe call works again. */
export async function notifyTtsAccountCleared(topic: string, info: { code: number | string; minutes: number; reset: number; provider?: string }): Promise<void> {
  const name = info.provider ?? 'MiniMax';
  await sendNtfy(
    topic,
    `${name} TTS working again - Chinese Learning App`,
    `${name} answers again after ${info.minutes} min of ${info.code}. ${info.reset} waiting clips retried now; the backfill pump is running.`,
    'white_check_mark,sound',
  );
}
