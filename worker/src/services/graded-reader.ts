import Anthropic from '@anthropic-ai/sdk';
import { Env, VocabularyItem, GeneratedStory, DifficultyLevel } from '../types';
import { storeAudio } from './audio';

const STORY_SYSTEM_PROMPT = `You are an expert Chinese language author creating graded reading stories for adult language learners.

Your task is to create an engaging, culturally relevant story that uses ONLY the vocabulary words provided by the user. The story should be appropriate for the specified difficulty level and interesting to adult readers.

CRITICAL RULES:
1. You MUST use ONLY the vocabulary words provided. Do not introduce any new vocabulary.
2. You may use common grammatical particles and conjunctions (的, 了, 吗, 吧, 和, 但是, 因为, 所以, etc.)
3. The story should feel natural despite the vocabulary constraint.
4. Create 4-6 pages, with 2-4 sentences per page depending on difficulty.
5. Use proper pinyin with tone marks (nǐ hǎo), NOT tone numbers (ni3 hao3).
6. First, define all characters and key locations that appear in the story.
7. Each page should have a detailed image_prompt that references the character/location descriptions.

Difficulty level guidelines:
- beginner: Very simple sentences, 1-2 clauses max, basic grammar
- elementary: Simple sentences with some connectors, basic time expressions
- intermediate: More complex sentences, varied grammar patterns
- advanced: Natural flowing prose, idiomatic expressions within vocabulary

CHARACTER & LOCATION DESCRIPTIONS:
- Define each character with: name, age range, appearance (hair, clothing, distinguishing features)
- Define key locations with: setting details, atmosphere, key visual elements
- These descriptions ensure visual consistency across all illustrations

IMAGE PROMPTS:
- Each page's image_prompt should be detailed and specific
- Reference character descriptions by name (the system will substitute the full description)
- Describe the specific scene, action, expressions, and composition
- Include lighting, mood, and camera angle if relevant
- Do NOT include any text or words in the image description
- Style should be: realistic illustration suitable for adult readers

Respond with JSON in this exact format:
{
  "title_chinese": "Chinese title",
  "title_english": "English title",
  "characters": {
    "character_name": "Detailed physical description: age, hair color/style, typical clothing, distinguishing features"
  },
  "locations": {
    "location_name": "Detailed description: setting type, atmosphere, key visual elements, lighting"
  },
  "pages": [
    {
      "content_chinese": "Chinese text for this page",
      "content_pinyin": "Pinyin with tone marks",
      "content_english": "English translation",
      "characters_in_scene": ["character_name"],
      "location": "location_name",
      "image_prompt": "Detailed scene description referencing characters by name, their actions, expressions, composition, mood"
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

  // Ensure characters and locations exist (provide defaults if missing)
  result.characters = result.characters || {};
  result.locations = result.locations || {};

  // Expand image prompts with character and location descriptions
  for (const page of result.pages) {
    page.image_prompt = expandImagePrompt(
      page.image_prompt,
      page.characters_in_scene || [],
      page.location || '',
      result.characters,
      result.locations
    );
  }

  return result;
}

/**
 * Expand an image prompt by substituting character and location descriptions
 */
function expandImagePrompt(
  basePrompt: string,
  charactersInScene: string[],
  locationName: string,
  allCharacters: Record<string, string>,
  allLocations: Record<string, string>
): string {
  const parts: string[] = [];

  // Add location context if available
  if (locationName && allLocations[locationName]) {
    parts.push(`Setting: ${allLocations[locationName]}`);
  }

  // Add character descriptions for characters in this scene
  if (charactersInScene.length > 0) {
    const characterDescriptions = charactersInScene
      .filter(name => allCharacters[name])
      .map(name => `${name}: ${allCharacters[name]}`);

    if (characterDescriptions.length > 0) {
      parts.push(`Characters present: ${characterDescriptions.join('; ')}`);
    }
  }

  // Add the scene-specific prompt
  parts.push(`Scene: ${basePrompt}`);

  return parts.join('\n\n');
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
    // The imagePrompt already contains expanded character/location descriptions
    const fullPrompt = `Create a high-quality illustration for a Chinese language learning book for adults.

${imagePrompt}

Style guidelines:
- Realistic illustration style with warm, inviting colors
- Clear composition focusing on the main subjects
- Expressive characters with visible emotions and body language
- Rich environmental details that support the scene
- No text, words, or writing in the image
- Suitable for adult language learners`;

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
