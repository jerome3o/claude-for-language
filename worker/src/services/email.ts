/**
 * Email service using SendGrid
 */

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

// Use the admin email or a verified sender email
const FROM_EMAIL = 'claude@claude.towerhouse.london';
const FROM_NAME = 'Chinese Learning App';

// Base URL for the app
const APP_BASE_URL = 'https://chinese-learning-2x9.pages.dev';

interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
}

/**
 * Send an email via SendGrid
 */
export async function sendEmail(
  apiKey: string,
  params: SendEmailParams
): Promise<boolean> {
  const { to, toName, subject, textContent, htmlContent } = params;

  const payload = {
    personalizations: [
      {
        to: [{ email: to, name: toName }],
      },
    ],
    from: {
      email: FROM_EMAIL,
      name: FROM_NAME,
    },
    subject,
    content: [
      {
        type: 'text/plain',
        value: textContent,
      },
      ...(htmlContent
        ? [
            {
              type: 'text/html',
              value: htmlContent,
            },
          ]
        : []),
    ],
  };

  try {
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid error:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

/**
 * Send a new message notification to a tutor
 */
export async function sendNewMessageNotification(
  apiKey: string,
  params: {
    recipientEmail: string;
    recipientName: string | null;
    senderName: string | null;
    messagePreview: string;
    conversationId: string;
    relationshipId: string;
  }
): Promise<boolean> {
  const {
    recipientEmail,
    recipientName,
    senderName,
    messagePreview,
    conversationId,
    relationshipId,
  } = params;

  const conversationUrl = `${APP_BASE_URL}/connections/${relationshipId}/chat/${conversationId}`;
  const displayName = senderName || 'Your student';
  const truncatedPreview =
    messagePreview.length > 100
      ? messagePreview.substring(0, 100) + '...'
      : messagePreview;

  const subject = `New message from ${displayName}`;

  const textContent = `Hi ${recipientName || 'there'},

You have a new message from ${displayName}:

"${truncatedPreview}"

View the conversation: ${conversationUrl}

---
Chinese Learning App`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { color: #2563eb; margin-bottom: 20px; }
    .message-box { background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
    .message-text { font-style: italic; color: #4b5563; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h2 class="header">New Message</h2>
    <p>Hi ${recipientName || 'there'},</p>
    <p>You have a new message from <strong>${displayName}</strong>:</p>
    <div class="message-box">
      <p class="message-text">"${truncatedPreview}"</p>
    </div>
    <a href="${conversationUrl}" class="button">View Conversation</a>
    <div class="footer">
      <p>Chinese Learning App</p>
    </div>
  </div>
</body>
</html>`;

  return sendEmail(apiKey, {
    to: recipientEmail,
    toName: recipientName || undefined,
    subject,
    textContent,
    htmlContent,
  });
}
