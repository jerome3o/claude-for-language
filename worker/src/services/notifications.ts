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

export async function notifyNewChatMessage(topic: string, senderName: string, messagePreview: string): Promise<void> {
  await sendNtfy(
    topic,
    'New Chat Message',
    `${senderName}: ${messagePreview}`,
    'speech_balloon',
  );
}
