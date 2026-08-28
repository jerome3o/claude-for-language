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

Use the create_story tool to return the story.`;

// Model for story generation. Opus-class writing quality matters here — the
// stories are the product. (Previous models: claude-sonnet-4-20250514 was
// retired by Anthropic, then claude-sonnet-5.)
const STORY_MODEL = 'claude-opus-5';

// Tool definition for structured output
const CREATE_STORY_TOOL: Anthropic.Tool = {
  name: 'create_story',
  description: 'Create a graded reader story with characters, locations, and pages',
  input_schema: {
    type: 'object' as const,
    properties: {
      title_chinese: {
        type: 'string',
        description: 'The story title in Chinese characters'
      },
      title_english: {
        type: 'string',
        description: 'The story title in English'
      },
      characters: {
        type: 'object',
        description: 'Map of character names to their physical descriptions (age, hair, clothing, features)',
        additionalProperties: { type: 'string' }
      },
      locations: {
        type: 'object',
        description: 'Map of location names to their descriptions (setting, atmosphere, visual elements)',
        additionalProperties: { type: 'string' }
      },
      pages: {
        type: 'array',
        description: 'The story pages (4-6 pages)',
        items: {
          type: 'object',
          properties: {
            content_chinese: {
              type: 'string',
              description: 'The Chinese text for this page'
            },
            content_pinyin: {
              type: 'string',
              description: 'Pinyin with tone marks (e.g., nǐ hǎo)'
            },
            content_english: {
              type: 'string',
              description: 'English translation'
            },
            characters_in_scene: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names of characters appearing in this scene'
            },
            location: {
              type: 'string',
              description: 'Name of the location for this scene'
            },
            image_prompt: {
              type: 'string',
              description: 'Detailed scene description for image generation'
            }
          },
          required: ['content_chinese', 'content_pinyin', 'content_english', 'image_prompt']
        }
      }
    },
    required: ['title_chinese', 'title_english', 'characters', 'locations', 'pages']
  }
};

function formatVocabList(vocabulary: VocabularyItem[]): string {
  return vocabulary.map(v => `- ${v.hanzi} (${v.pinyin}): ${v.english}`).join('\n');
}

/**
 * Storytelling "lenses" for the daily reader. Lesson notes only change a few
 * times a week but a story is generated every day, so the TREATMENT rotates
 * daily even when the anchored material is identical — meeting the same
 * patterns across different framings beats one framing repeated.
 */
const STORY_LENSES = [
  'a warm slice-of-life scene from an ordinary day',
  'a light mystery — something small is missing or does not add up, and the explanation lands on the last page',
  'a comedy of errors — a small misunderstanding snowballs, then gets resolved',
  "a first-person diary entry recounting the day's events",
  'a dialogue-driven scene — mostly back-and-forth conversation between two people',
  'everyday phrases in an unexpected setting — familiar language somewhere you would not expect it',
  'a small outing or plan that does not go the way anyone expected',
];

/** Deterministic per-day lens, so retries of the same day agree. */
export function getDailyStoryLens(now = new Date()): string {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return STORY_LENSES[dayNumber % STORY_LENSES.length];
}

/**
 * Generate a graded reader story using Claude with tool use for structured output.
 *
 * options.targetVocabulary switches to best-effort mode ("story from today's
 * due cards"): the story is written from the full allowed vocabulary, and the
 * target words are woven in only where they fit naturally — a realistic story
 * that skips some targets beats a contrived one that forces them all in.
 *
 * options.lessonNotes threads in the tutor's recent lesson material so the
 * story can echo themes and phrasings the learner just covered in class.
 *
 * options.anchorOnLessonNotes (daily reader, when notes exist) inverts the
 * priorities: the lesson material becomes the story's FOUNDATION — scenes,
 * vocabulary and sentence patterns are built around it, and words appearing
 * verbatim in the notes are allowed even when they're outside the learned
 * vocabulary (meeting new lesson material in context is the point). Due-card
 * targets are demoted to secondary weave-ins.
 */
export async function generateStory(
  apiKey: string,
  vocabulary: VocabularyItem[],
  topic?: string,
  difficulty: DifficultyLevel = 'beginner',
  options: {
    targetVocabulary?: VocabularyItem[];
    lessonNotes?: string;
    anchorOnLessonNotes?: boolean;
    /** Today's storytelling treatment (see STORY_LENSES). */
    lens?: string;
    /** One-line summaries of recent stories, to be explicitly NOT repeated. */
    recentStories?: string[];
  } = {}
): Promise<GeneratedStory> {
  const client = new Anthropic({ apiKey });
  const anchored = Boolean(options.anchorOnLessonNotes && options.lessonNotes);

  const topicInstruction = topic
    ? `The story should be about: ${topic}`
    : anchored
      ? 'Choose a topic that grows naturally out of the lesson material below.'
      : 'Choose an appropriate topic based on the available vocabulary.';

  const lensSection = options.lens
    ? `
Today's treatment: write the story as ${options.lens}.
`
    : '';

  const recentStoriesSection = options.recentStories?.length
    ? `
The learner's recent stories are listed below. Do NOT reuse their settings,
characters, or plots — even when working from the same lesson material, find a
noticeably different angle:
${options.recentStories.map(s => `- ${s}`).join('\n')}
`
    : '';

  const lessonNotesSection = options.lessonNotes
    ? anchored
      ? `
STORY FOUNDATION — the learner's most recent lessons with their tutor:

${options.lessonNotes}

Anchor the story on this material: build the scenes around its situations and
themes, and feature its vocabulary and sentence patterns prominently — the
learner needs to meet exactly this lesson material again in context. In
addition to the allowed vocabulary list, you MAY use words and phrasings that
appear verbatim in the lesson material above; introduce them naturally and
repeat them across pages, since repetition is how they stick.
`
      : `
The learner's tutor recently covered the material below in their lessons. Where it
fits naturally, prefer these themes, phrasings, and sentence patterns — a story that
echoes what they just studied reinforces it. Do not force it; the notes are
inspiration, not requirements:

${options.lessonNotes}
`
    : '';

  const targetSection = options.targetVocabulary?.length
    ? anchored
      ? `
Also due for review today (SECONDARY — the lesson material above comes first).
Weave a few of these in where they fit naturally, and skip any that don't:
${formatVocabList(options.targetVocabulary)}
`
      : `
TARGET words (the learner's cards due for review today). Weave in as many as fit NATURALLY:
${formatVocabList(options.targetVocabulary)}

IMPORTANT: Do NOT write a contrived story just to cram target words in. A realistic,
natural story that features fewer of the target words is much better than an awkward
one that forces them all. Let the target words guide the choice of topic and scenes,
then let the story breathe — skip any target word that doesn't fit.
`
    : '';

  const userPrompt = `Create a graded reader story at the "${difficulty}" level.

${topicInstruction}
${lensSection}
Available vocabulary (you MUST only use these words${anchored ? ', plus words appearing in the lesson material' : ''}):
${formatVocabList(vocabulary)}
${lessonNotesSection}${targetSection}${recentStoriesSection}
Remember:
- Use ONLY the vocabulary provided above${anchored ? ' (plus lesson-material words)' : ''}
- Create 4-6 pages with engaging content
- Each page needs an image_prompt for illustration
- Use proper pinyin with tone marks

Use the create_story tool to return your story.`;

  console.log('[Story] Generating story:', JSON.stringify({
    model: STORY_MODEL,
    difficulty,
    topic: topic || null,
    vocabulary_count: vocabulary.length,
    target_count: options.targetVocabulary?.length ?? 0,
    has_lesson_notes: Boolean(options.lessonNotes),
    anchored_on_lesson_notes: anchored,
    lens: options.lens ?? null,
    recent_story_count: options.recentStories?.length ?? 0,
  }));

  const response = await client.messages.create({
    model: STORY_MODEL,
    max_tokens: 8000,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    system: STORY_SYSTEM_PROMPT,
    tools: [CREATE_STORY_TOOL],
    tool_choice: { type: 'tool', name: 'create_story' },
  });

  console.log('[Story] AI response:', JSON.stringify({
    stop_reason: response.stop_reason,
    content_blocks: response.content.map(c => c.type),
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
  }));

  // Opus 5 / Fable-generation models can end with a safety refusal instead of
  // the forced tool call — surface it distinctly so the reader is marked
  // failed with a diagnosable message rather than a generic parse error.
  if (response.stop_reason === 'refusal') {
    throw new Error('Story generation was refused by the model (stop_reason: refusal)');
  }

  // Find the tool use block
  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.error('[Story] No tool_use block in response; stop_reason:', response.stop_reason);
    throw new Error(`No tool use in AI response (stop_reason: ${response.stop_reason})`);
  }

  const result = toolUse.input as GeneratedStory;

  // Validate structure
  if (!result.title_chinese || !result.title_english || !result.pages || !Array.isArray(result.pages)) {
    console.error('[Story] Invalid story structure; keys present:', Object.keys(result || {}).join(', '));
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
