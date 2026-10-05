import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Screen sharing with sound, and no mirror for the sharer (shared/calls/share.ts — Jerome's lesson
 * with Minghui, 5 Oct 2026: she played his recordings in a shared tab and "我听不见").
 *
 * The tutor shares a fake "tab" (a canvas picture + an oscillator's sound — headless Chromium has
 * no screen picker): the student's call page gets the screen's sound on its own audio element and
 * its track carries packets; the tutor's own screen tile is the compact "You're sharing your
 * screen" card, not a mirror (👁 Show it here brings the screen back). A share without sound tells
 * the sharer how to share it.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';

test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
});

interface SeededUser { id: string; email: string; token: string }

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function seedUser(request: APIRequestContext, tag: string, name: string): Promise<SeededUser> {
  const email = `sound-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
  const r = await api<{ user: { id: string }; session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

/**
 * getDisplayMedia → a canvas "tab" and, unless `window.__shareNoSound`, an oscillator as the tab's sound.
 * The options the page asked for are kept on `window.__displayOptions`.
 */
function fakeTab() {
  const w = window as unknown as { __shareNoSound?: boolean; __displayOptions?: unknown };
  (navigator.mediaDevices as MediaDevices & { getDisplayMedia: unknown }).getDisplayMedia = async (options: unknown) => {
    w.__displayOptions = options;
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d')!;
    const draw = () => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#111827';
      g.font = '96px sans-serif';
      g.fillText('录音 · 我听不见', 120, 380);
      requestAnimationFrame(draw);
    };
    draw();
    const stream = c.captureStream(10);
    if (!w.__shareNoSound) {
      const ac = new AudioContext();
      void ac.resume();
      const osc = ac.createOscillator();
      osc.frequency.value = 440;
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }
    return stream;
  };
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(fakeTab);
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function join(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

/** The viewer's screen-sound element: how many audio tracks, and is the first one receiving packets (not muted). */
async function screenSound(page: Page): Promise<{ tracks: number; live: boolean }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="remote-screen-audio"]') as HTMLAudioElement | null;
    const tracks = el?.srcObject ? (el.srcObject as MediaStream).getAudioTracks() : [];
    return { tracks: tracks.length, live: !!tracks[0] && tracks[0].readyState === 'live' && !tracks[0].muted };
  });
}

test('a shared tab\'s sound reaches the other person; the sharer sees a card, not their own screen', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const tutor = await seedUser(request, 'tutor', '明慧 Minghui');
  const student = await seedUser(request, 'student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });
  const call = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });

  const tp = await openAs(browser, tutor.token);
  const sp = await openAs(browser, student.token);
  await join(tp, call.call.id);
  await join(sp, call.call.id);
  await expect.poll(() => tp.getByTestId('remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);

  // The tutor shares a tab with sound.
  await tp.getByLabel('Share screen').click();
  await expect(tp.getByTestId('share-bar')).toBeVisible({ timeout: 10000 });
  // She asked for the tab's sound (and kept it playing for herself).
  const asked = await tp.evaluate(() => (window as unknown as { __displayOptions: { audio: unknown; systemAudio?: string } }).__displayOptions);
  expect(asked.audio).toMatchObject({ suppressLocalAudioPlayback: false });
  expect(asked.systemAudio).toBe('include');

  // The sharer: the screen tile is on her stage, as a compact card — no mirror of her own screen.
  await expect(tp.getByTestId('call-tiles')).toHaveAttribute('data-stage', 'screen', { timeout: 10000 });
  await expect(tp.getByTestId('sharing-card')).toBeVisible();
  await expect(tp.getByTestId('sharing-card')).toContainText('You’re sharing your screen');
  await expect(tp.getByTestId('sharing-card')).toContainText('Jerome sees it');
  await expect(tp.getByTestId('sharing-audio')).toContainText('Sound is shared too');
  await expect(tp.getByTestId('my-screen')).toHaveCount(0);
  await expect(tp.getByTestId('share-audio-note')).toHaveCount(0);

  // The viewer: the share on the stage, and its sound on its own element, with packets arriving.
  await expect(sp.getByTestId('call-tiles')).toHaveAttribute('data-stage', 'screen', { timeout: 20000 });
  await expect.poll(() => sp.getByTestId('remote-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => screenSound(sp), { timeout: 30000 }).toEqual({ tracks: 1, live: true });
  await expect(sp.getByTestId('share-sound-badge')).toContainText('Sound from 明慧’s screen');
  // The sound is not the tutor's voice: her camera stream still has its own (mic) audio track.
  const distinct = await sp.evaluate(() => {
    const cam = document.querySelector('[data-testid="remote-video"]') as HTMLVideoElement;
    const snd = document.querySelector('[data-testid="remote-screen-audio"]') as HTMLAudioElement;
    return (cam.srcObject as MediaStream).getAudioTracks()[0]?.id !== (snd.srcObject as MediaStream).getAudioTracks()[0]?.id;
  });
  expect(distinct).toBe(true);
  // The viewer sees no sharing card.
  await expect(sp.getByTestId('sharing-card')).toHaveCount(0);

  // 👁 Show it here: the sharer's own screen comes back; Hide → the card again.
  await tp.getByTestId('sharing-show').click();
  await expect.poll(() => tp.getByTestId('my-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  await tp.getByTestId('sharing-hide').click();
  await expect(tp.getByTestId('sharing-card')).toBeVisible();

  // ✏️ Draw on it from the card: her screen with the pen on (she can't circle what she can't see).
  await tp.getByTestId('sharing-draw').click();
  await expect(tp.getByTestId('annot-self')).toBeVisible();
  await expect(tp.getByTestId('annot-toggle')).toHaveText('✓ Done');
  await tp.getByTestId('annot-toggle').click();
  await expect(tp.getByTestId('sharing-card')).toBeVisible();

  // Stop from the card: the share and its sound end for the viewer.
  await tp.getByTestId('sharing-stop').click();
  await expect(tp.getByTestId('share-bar')).toHaveCount(0);
  await expect(sp.getByTestId('remote-screen-audio')).toHaveCount(0, { timeout: 15000 });
  await expect(sp.getByTestId('share-sound-badge')).toHaveCount(0);

  // A share without sound (a window, Safari, Firefox): the sharer is told how to share it.
  await tp.evaluate(() => { (window as unknown as { __shareNoSound: boolean }).__shareNoSound = true; });
  await tp.getByLabel('Share screen').click();
  await expect(tp.getByTestId('share-audio-note')).toContainText('Also share tab audio', { timeout: 10000 });
  await expect(tp.getByTestId('sharing-audio')).toContainText('Sound isn’t shared');
  await expect.poll(() => sp.getByTestId('remote-screen').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(sp.getByTestId('share-sound-badge')).toHaveCount(0);
});
