/**
 * Feedback from the headset (docs/VR.md "Feedback"): a message + a screenshot of what was in
 * view + a little context (mode, open windows — ids and kinds only).
 *
 * ONE function to swap: today it goes through the feature-request endpoints the web app's
 * feedback button uses (`POST /api/feature-requests/screenshot` + `POST /api/feature-requests`).
 * When the dedicated feedback API (`POST /api/feedback`, multipart: message, screenshot, context
 * JSON) lands, only `sendFeedback` changes.
 */
import { createFeatureRequest, uploadFeatureRequestScreenshot } from '../api/client';

export interface VrFeedback {
  message: string;
  screenshot: Blob | null;
  context: Record<string, string | number | boolean | string[]>;
}

export type FeedbackVia = 'feature_request';

export async function sendFeedback(fb: VrFeedback): Promise<{ via: FeedbackVia; id: string; screenshot: boolean }> {
  let screenshotUrl: string | undefined;
  if (fb.screenshot) {
    try {
      screenshotUrl = (await uploadFeatureRequestScreenshot(fb.screenshot)).url;
    } catch {
      screenshotUrl = undefined; // the message still goes
    }
  }
  const message = fb.message.trim() || '(no message — see the screenshot)';
  const { id } = await createFeatureRequest(`[VR] ${message}`, `/vr ${JSON.stringify(fb.context)}`, undefined, screenshotUrl);
  return { via: 'feature_request', id, screenshot: !!screenshotUrl };
}
