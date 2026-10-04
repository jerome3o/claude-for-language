import { User } from '../types';

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

export async function notifyNewUser(topic: string, user: User): Promise<void> {
  await sendNtfy(
    topic,
    'New User - Chinese Learning App',
    `New user signed up!\n\nEmail: ${user.email || 'Unknown'}\nName: ${user.name || 'No name'}\nTime: ${new Date().toISOString()}`,
    'bust_in_silhouette,new',
  );
}

/** One line, sent the first time an uninvited Google account tries to sign in. */
export async function notifyAccessRequest(
  topic: string,
  person: { email: string; name?: string | null }
): Promise<void> {
  await sendNtfy(
    topic,
    'Access request - Chinese Learning App',
    `${person.name || 'Someone'} (${person.email}) tried to sign in — approve on the admin page`,
    'raised_hand',
  );
}

export async function notifyNewChatMessage(topic: string, senderName: string, messagePreview: string): Promise<void> {
  await sendNtfy(
    topic,
    'New Chat Message',
    `${senderName}: ${messagePreview}`,
    'speech_balloon',
  );
}

/** MiniMax stopped speaking for an account reason (no credit, bad key) — sent once when it starts. */
export async function notifyTtsAccountProblem(topic: string, problem: { code: number | string; message: string }): Promise<void> {
  await sendNtfy(
    topic,
    'MiniMax TTS paused - Chinese Learning App',
    `Every MiniMax call fails: ${problem.code} ${problem.message}\nAudio is paused (retrying every 5–60 min); no clip loses its attempts. Check the credit / API key.`,
    'warning,sound',
    '4',
  );
}

/** …and once when a probe call works again. */
export async function notifyTtsAccountCleared(topic: string, info: { code: number | string; minutes: number; reset: number }): Promise<void> {
  await sendNtfy(
    topic,
    'MiniMax TTS working again - Chinese Learning App',
    `MiniMax answers again after ${info.minutes} min of ${info.code}. ${info.reset} waiting clips retried now; the backfill pump is running.`,
    'white_check_mark,sound',
  );
}
