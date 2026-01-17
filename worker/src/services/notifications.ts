import { User } from '../types';

export async function notifyNewUser(topic: string, user: User): Promise<void> {
  if (!topic) {
    console.log('[Notifications] No topic configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': 'New User - Chinese Learning App',
        'Tags': 'bust_in_silhouette,new',
        'Priority': '3',
      },
      body: `New user signed up!\n\nEmail: ${user.email || 'Unknown'}\nName: ${user.name || 'No name'}\nTime: ${new Date().toISOString()}`,
    });

    if (!response.ok) {
      console.error('[Notifications] Failed to send notification:', response.status);
    } else {
      console.log('[Notifications] New user notification sent for:', user.email);
    }
  } catch (error) {
    console.error('[Notifications] Error sending notification:', error);
  }
}
