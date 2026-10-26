/**
 * Feedback from the headset (docs/VR.md "Feedback", docs/FEEDBACK.md): a message + a screenshot of
 * what was in view, through the app's feedback outbox (services/feedback.ts `queueFeedback`) —
 * `POST /api/feedback`, kept on the device and sent later when offline, idempotent by client id.
 * The context is the web's (`feedbackContext`) as platform `vr`, via `vr`; never the page's content.
 */
import { pickFeedbackContext, FEEDBACK_MAX_MESSAGE, type FeedbackKind } from '@shared/feedback';
import { feedbackContext, queueFeedback } from '../services/feedback';

export interface VrFeedback {
  message: string;
  kind: FeedbackKind;
  screenshot: Blob | null;
  /** In the headset (immersive) or the flat preview. */
  immersive: boolean;
}

export async function sendFeedback(fb: VrFeedback): Promise<{ sent: boolean; client_id: string }> {
  const context = pickFeedbackContext({
    ...feedbackContext('vr', '/vr'),
    platform: 'vr',
    device: fb.immersive ? 'VR headset (immersive)' : 'VR flat preview',
  });
  return queueFeedback({ message: fb.message.slice(0, FEEDBACK_MAX_MESSAGE), kind: fb.kind, context, screenshot: fb.screenshot });
}
