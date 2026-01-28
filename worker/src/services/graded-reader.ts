import Anthropic from '@anthropic-ai/sdk';
import { Env, VocabularyItem, GeneratedStory, DifficultyLevel } from '../types';
import { storeAudio } from './audio';

const STORY_SYSTEM_PROMPT = `You are an expert Chinese language author creating graded reading stories for language learners.

Your task is to create an engaging, culturally relevant story that uses ONLY the vocabulary words provided by the user. The story should be appropriate for the specified difficulty level.

CRITICAL RULES:
1. You MUST use ONLY the vocabulary words provided. Do not introduce any new vocabulary.
2. You may use common grammatical particles and conjunctions (的, 了, 吗, 吧, 和, 但是, 因为, 所以, etc.)
3. The story should feel natural despite the vocabulary constraint.
4. Create 4-6 pages, with 2-4 sentences per page depending on difficulty.
5. Use proper pinyin with tone marks (nǐ hǎo), NOT tone numbers (ni3 hao3).
6. Each page should have an image_prompt describing a scene from that page for illustration.

Difficulty level guidelines:
- beginner: Very simple sentences, 1-2 clauses max, basic grammar
- elementary: Simple sentences with some connectors, basic time expressions
- intermediate: More complex sentences, varied grammar patterns
- advanced: Natural flowing prose, idiomatic expressions within vocabulary

Image prompts should be:
- Descriptive but concise
- Focus on the main action/scene of the page
- Suitable for illustration (no text in images)
- Style: "Warm, friendly children's book illustration style"

Respond with JSON in this exact format:
{
  "title_chinese": "Chinese title",
  "title_english": "English title",
  "pages": [
    {
      "content_chinese": "Chinese text for this page",
      "content_pinyin": "Pinyin with tone marks",
      "content_english": "English translation",
      "image_prompt": "Description for illustration"
    }
  ]
}`;

/**
 * Generate a graded reader story using Claude
 */
export async function generateStory(
  apiKey: string,
  vocabulary: VocabularyItem[],
  topic?: string,
  difficulty: DifficultyLevel = 'beginner'
): Promise<GeneratedStory> {
  const client = new Anthropic({ apiKey });

  const vocabList = vocabulary.map(v =>
    `- ${v.hanzi} (${v.pinyin}): ${v.english}`
  ).join('\n');

  const topicInstruction = topic
    ? `The story should be about: ${topic}`
    : 'Choose an appropriate topic based on the available vocabulary.';

  const userPrompt = `Create a graded reader story at the "${difficulty}" level.

${topicInstruction}

Available vocabulary (you MUST only use these words):
${vocabList}

Remember:
- Use ONLY the vocabulary provided above
- Create 4-6 pages with engaging content
- Each page needs an image_prompt for illustration
- Use proper pinyin with tone marks

Respond with valid JSON.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: STORY_SYSTEM_PROMPT,
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in AI response');
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in AI response');
  }

  const result = JSON.parse(jsonMatch[0]) as GeneratedStory;

  // Validate structure
  if (!result.title_chinese || !result.title_english || !result.pages || !Array.isArray(result.pages)) {
    throw new Error('Invalid story structure from AI');
  }

  if (result.pages.length < 1) {
    throw new Error('Story must have at least one page');
  }

  return result;
}

/**
 * Generate an illustration for a reader page using Google Nano Banana (Gemini 2.5 Flash Image)
 */
export async function generatePageImage(
  geminiKey: string,
  imagePrompt: string,
  pageId: string,
  bucket: R2Bucket
): Promise<string | null> {
  console.log('[Image] Generating image for page:', pageId);
  console.log('[Image] Prompt:', imagePrompt);

  if (!geminiKey) {
    console.log('[Image] No Gemini API key configured');
    return null;
  }

  try {
    // Use Nano Banana (Gemini 2.5 Flash Image) for image generation
    const fullPrompt = `A warm, friendly children's book illustration in a gentle watercolor style. ${imagePrompt}. Soft warm colors, simple clear composition, friendly and inviting atmosphere, no text or words in the image, suitable for a Chinese language learning book for children.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: fullPrompt }]
          }],
          generationConfig: {
            responseModalities: ['IMAGE'],
          }
        }),
      }
    );

    console.log('[Image] Nano Banana response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[Image] Nano Banana error:', error);
      return null;
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: {
              mimeType?: string;
              data?: string;
            };
          }>;
        };
      }>;
    };

    // Find the image part in the response (note: API uses camelCase)
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      part => part.inlineData?.data
    );
    const imageData = imagePart?.inlineData?.data;

    if (!imageData) {
      console.error('[Image] No image data in response');
      console.log('[Image] Response structure:', JSON.stringify(data).slice(0, 500));
      return null;
    }

    const mimeType = imagePart?.inlineData?.mimeType || 'image/png';
    const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
    console.log('[Image] Got image data, mime type:', mimeType, 'storing in R2...');

    // Decode base64 image
    const imageBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));

    // Store in R2
    const key = `reader-images/${pageId}.${extension}`;
    await bucket.put(key, imageBytes.buffer as ArrayBuffer, {
      httpMetadata: {
        contentType: mimeType,
      },
    });

    console.log('[Image] Stored image with key:', key);
    return key;
  } catch (error) {
    console.error('[Image] Image generation failed:', error);
    return null;
  }
}

/**
 * Get the R2 key for a reader page image
 */
export function getReaderImageKey(pageId: string): string {
  return `reader-images/${pageId}.png`;
}
