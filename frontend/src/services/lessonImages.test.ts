import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rememberLessonImageKey, rememberedLessonImageKey, ensureLessonImages } from './lessonImages';
import { lessonImagePlaceholder } from '../hooks/useLessonImage';
import { clampFabPosition, hasEditorBottomBar, isStudyLikePath, FAB_TOP_CLEARANCE } from '../components/fabPosition';

describe('lesson picture memory (offline: prompt → key)', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a key by the whitespace-normalised prompt', () => {
    expect(rememberedLessonImageKey('A café counter')).toBeNull();
    rememberLessonImageKey('A  café\ncounter ', 'lesson-images/abc.png');
    expect(rememberedLessonImageKey('A café counter')).toBe('lesson-images/abc.png');
    expect(rememberedLessonImageKey(null)).toBeNull();
  });

  it('keeps the newest 300 prompts', () => {
    for (let i = 0; i < 305; i++) rememberLessonImageKey(`scene ${i}`, `k${i}`);
    expect(rememberedLessonImageKey('scene 0')).toBeNull();
    expect(rememberedLessonImageKey('scene 304')).toBe('k304');
  });
});

describe('ensureLessonImages', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks by prompt, remembers ready pictures and passes queue: false through', async () => {
    localStorage.clear();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      images: [
        { prompt: 'a park', status: 'ready', image_url: 'lesson-images/p.png' },
        { prompt: 'a shop', status: 'pending', image_url: null },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await ensureLessonImages(['a park', 'a shop'], { queue: false });
    expect(res.map(r => r.status)).toEqual(['ready', 'pending']);
    expect(rememberedLessonImageKey('a park')).toBe('lesson-images/p.png');
    expect(rememberedLessonImageKey('a shop')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/lesson-images\/ensure$/);
    expect(JSON.parse(String(init.body))).toEqual({ prompts: ['a park', 'a shop'], queue: false });
  });
});

describe('picture placeholder copy', () => {
  it('says the picture is on its way while it is drawn, and offers the scene otherwise', () => {
    expect(lessonImagePlaceholder('pending')).toMatchObject({ kind: 'drawing', title: 'Drawing the picture…' });
    expect(lessonImagePlaceholder('slow').kind).toBe('drawing');
    expect(lessonImagePlaceholder('offline')).toMatchObject({ kind: 'text' });
    expect(lessonImagePlaceholder('offline').title).toMatch(/next sync/);
    expect(lessonImagePlaceholder('failed').title).toMatch(/could not be drawn/);
    expect(lessonImagePlaceholder('none').title).toBe('Imagine this scene:');
  });
});

describe('feedback button position', () => {
  const phone = { width: 412, height: 915 };

  it('never sits over the top bar (the lesson ✕), wherever it was dropped', () => {
    expect(clampFabPosition({ x: 360, y: 8 }, phone)).toEqual({ x: 360, y: FAB_TOP_CLEARANCE });
    expect(clampFabPosition({ x: 500, y: -20 }, phone)).toEqual({ x: 412 - 48, y: FAB_TOP_CLEARANCE });
  });

  it('leaves other positions alone and keeps it on screen', () => {
    expect(clampFabPosition({ x: 340, y: 800 }, phone)).toEqual({ x: 340, y: 800 });
    expect(clampFabPosition({ x: 10, y: 2000 }, phone)).toEqual({ x: 10, y: 915 - 48 });
  });

  it("lifts its default spot above the editors' bottom bar on phones", () => {
    expect(hasEditorBottomBar('/lessons/abc/edit', 412)).toBe(true);
    expect(hasEditorBottomBar('/library/abc/edit', 412)).toBe(true);
    expect(hasEditorBottomBar('/lessons/abc/edit', 1280)).toBe(false);
    expect(hasEditorBottomBar('/library/catalogue/describe_image', 412)).toBe(false);
  });

  it('treats the catalogue sample trial like study (faint button)', () => {
    expect(isStudyLikePath('/library/catalogue/describe_image')).toBe(true);
    expect(isStudyLikePath('/library/abc/try')).toBe(true);
    expect(isStudyLikePath('/study')).toBe(true);
    expect(isStudyLikePath('/library/catalogue')).toBe(false);
  });
});
