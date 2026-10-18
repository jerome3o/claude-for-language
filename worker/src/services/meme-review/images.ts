/**
 * 梗 Meme review pictures: OUR OWN illustration per meme (Gemini, GEMINI_IMAGE_MODELS), drawn from
 * the agent's `illustration_prompt` in the meme's spirit — never a real person's likeness, logos
 * or text. Third-party media is linked out, never copied. Stored in R2
 * `meme-review/images/<month>/<item>.<ext>` (public: generated content, docs/AUDIO.md
 * "Private media"; collectable when no issue refers to it).
 */
import { GEMINI_IMAGE_MODELS, geminiGenerateContent, type FetchLike } from '../gemini';

export const MEME_IMAGE_PREFIX = 'meme-review/images';

export function memeImagePrompt(prompt: string): string {
  return `Draw a playful, colourful cartoon illustration for a light-hearted article about a Chinese internet meme.

${prompt}

Rules:
- Our own original art: simple, expressive, flat cartoon or comic style with warm colours
- No real people or anyone's likeness, no celebrities, no logos, no brand names, no app interfaces
- No text, letters, characters or captions anywhere in the picture
- Friendly and safe for all ages`;
}

/** Draw one picture and store it; the R2 key, or null when it couldn't be drawn. */
export async function drawMemePicture(opts: {
  apiKey: string;
  prompt: string;
  month: string;
  itemId: string;
  bucket: R2Bucket;
  fetch?: FetchLike;
}): Promise<string | null> {
  if (!opts.apiKey) return null;
  type Data = { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  let data: Data;
  try {
    const result = await geminiGenerateContent<Data>({
      apiKey: opts.apiKey,
      models: GEMINI_IMAGE_MODELS,
      label: 'meme-review picture',
      fetch: opts.fetch,
      body: () => ({ contents: [{ parts: [{ text: memeImagePrompt(opts.prompt) }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
    });
    data = result.data;
  } catch (err) {
    console.error('[meme-review] picture failed:', opts.itemId, err instanceof Error ? err.message : err);
    return null;
  }
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) return null;
  const mime = part.inlineData.mimeType || 'image/png';
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
  const key = `${MEME_IMAGE_PREFIX}/${opts.month}/${opts.itemId}-${Date.now().toString(36)}.${ext}`;
  await opts.bucket.put(key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' } });
  return key;
}
