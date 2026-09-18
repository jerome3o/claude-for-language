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
