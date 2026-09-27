// Screenshot + smoke script for the practice exercise types (deleted before commit).
import { chromium } from 'playwright';
import fs from 'fs';

const API = 'http://localhost:8794';
const WEB = 'http://localhost:5194';
const OUT = process.argv[2] || 'shots';
fs.mkdirSync(OUT, { recursive: true });

async function api(path, { method = 'GET', token, data } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function seedUser(tag, name) {
  const email = `lt-${tag}-${Date.now()}@test.e2e`;
  const r = await api('/api/test/auth', { method: 'POST', data: { email, name } });
  return { id: r.user.id, email, token: r.session_token };
}

// 0.7 s of a soft tone as WAV, so "TTS" really plays in headless Chromium.
function toneWav(freq) {
  const rate = 8000, n = Math.floor(rate * 0.7);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  return buf.toString('base64');
}

const spec = {
  title: '周末和酒店 Weekend & hotel',
  icon: '🏨',
  sections: [
    { title: 'Writing', exercises: [
      { type: 'sentence_making', words: [{ hanzi: '因为', pinyin: 'yīnwèi', english: 'because' }, { hanzi: '所以', pinyin: 'suǒyǐ', english: 'so' }], task: 'Explain why you were late today.', input: 'type', example: { hanzi: '因为路上堵车，所以我迟到了。', pinyin: 'Yīnwèi lùshang dǔchē, suǒyǐ wǒ chídào le.', english: 'Because there was traffic, I was late.' } },
      { type: 'write_typed', prompt: 'Where do you borrow books?', answer: { hanzi: '图书馆', pinyin: 'túshūguǎn', english: 'library' } },
      { type: 'write_handwriting', answer: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' } },
    ] },
    { title: 'Listening', exercises: [
      { type: 'dictation', input: 'type', audio: { hanzi: '他每天早上七点起床。', pinyin: 'Tā měitiān zǎoshang qī diǎn qǐchuáng.', english: 'He gets up at seven every morning.' } },
      { type: 'dictation', input: 'handwrite', audio: { hanzi: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.', english: 'I like drinking tea.' } },
    ] },
    { title: 'Speaking', exercises: [
      { type: 'oral_expression', prompt: 'Talk about what you did last weekend — where you went and who with.', question_audio: { hanzi: '你上个周末做了什么？', pinyin: 'Nǐ shàng ge zhōumò zuòle shénme?', english: 'What did you do last weekend?' }, hints: [{ hanzi: '周末', pinyin: 'zhōumò', english: 'weekend' }, { hanzi: '和朋友', pinyin: 'hé péngyou', english: 'with friends' }, { hanzi: '公园', pinyin: 'gōngyuán', english: 'park' }], example: { hanzi: '上个周末我和朋友去了公园。', pinyin: 'Shàng ge zhōumò wǒ hé péngyou qùle gōngyuán.', english: 'Last weekend I went to the park with friends.' }, target_seconds: 30 },
    ] },
  ],
};

const run = async () => {
  const tutor = await seedUser('tutor', '王老师 Minghui');
  const student = await seedUser('student', 'Jerome');
  const rel = await api('/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  const relId = rel.data.id;
  await api(`/api/relationships/${relId}/accept`, { method: 'POST', token: student.token });

  // Tutor library: the hotel conversation sample + the practice lesson, assigned to the student
  const samples = await import('../../shared/lesson/samples.ts').catch(() => null);
  const hotel = samples?.SAMPLE_LESSONS?.find(s => s.id === 'conversation')?.spec;
  const libConvo = await api('/api/lesson-library', { method: 'POST', token: tutor.token, data: { spec: hotel ?? spec } });
  const libPractice = await api('/api/lesson-library', { method: 'POST', token: tutor.token, data: { spec } });
  await api(`/api/lesson-library/${libPractice.id}/assign`, { method: 'POST', token: tutor.token, data: { relationship_ids: [relId] } });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  let n = 0;
  const shot = async (name, full = false) => {
    n++;
    const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file, fullPage: full });
    console.log('shot', file);
  };
  const voices = new Map();
  await page.route('**/api/practice/tts', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const v = body.voice_id || 'default';
    if (!voices.has(v)) voices.set(v, 330 + voices.size * 110);
    await route.fulfill({ json: { audio_base64: toneWav(voices.get(v)), content_type: 'audio/wav' } });
  });
  // No ANTHROPIC_API_KEY locally: stand in for Claude's sentence check.
  await page.route('**/api/lessons/sentence-feedback', route => route.fulfill({ json: { feedback: {
    verdict: 'minor', uses_all_words: true,
    corrected: { hanzi: '因为路上堵车，所以我迟到了。', pinyin: 'Yīnwèi lùshang dǔchē, suǒyǐ wǒ chídào le.', english: 'Because there was traffic, I was late.' },
    comment: 'Good use of 因为…所以. 堵车 is the natural word for a traffic jam — 很多车 sounds like you are counting cars.',
  } } }));

  // ---------- Student takes the practice lesson ----------
  await page.goto(`${WEB}/?session_token=${student.token}`);
  await page.waitForTimeout(6000);
  await page.goto(`${WEB}/study?autostart=true`);
  await page.waitForTimeout(5000);
  await shot('study-start');
  fs.writeFileSync(`${OUT}/ids.json`, JSON.stringify({ tutor, student, relId, libPractice: libPractice.id, libConvo: libConvo.id }));

  // Walk the lesson
  const clickText = async (re) => { await page.getByRole('button', { name: re }).first().click(); await page.waitForTimeout(500); };
  const pad = async () => {
    const canvas = page.locator('.hw-canvas').first();
    const box = await canvas.boundingBox();
    const strokes = [
      [[0.1, 0.25], [0.2, 0.2], [0.35, 0.3]], [[0.2, 0.3], [0.18, 0.8]], [[0.3, 0.45], [0.42, 0.42]],
      [[0.38, 0.3], [0.38, 0.85]], [[0.6, 0.2], [0.68, 0.5], [0.62, 0.85]], [[0.55, 0.5], [0.9, 0.48]], [[0.75, 0.2], [0.75, 0.85], [0.7, 0.8]],
    ];
    for (const s of strokes) {
      await page.mouse.move(box.x + s[0][0] * box.width, box.y + s[0][1] * box.height);
      await page.mouse.down();
      for (const p of s.slice(1)) await page.mouse.move(box.x + p[0] * box.width, box.y + p[1] * box.height, { steps: 8 });
      await page.mouse.up();
    }
  };

  // sentence making
  await page.locator('textarea.translate-input').fill('因为很多车，所以我迟到了。');
  await shot('sentence-making-question');
  await clickText(/^Check$/);
  await page.waitForTimeout(800);
  await shot('sentence-making-feedback', true);
  await clickText(/Continue/);
  // write typed
  await page.locator('input.write-input').fill('图书官');
  await shot('write-typed-question');
  await clickText(/^Check$/);
  await shot('write-typed-answered');
  await clickText(/Continue/);
  // handwriting
  await pad();
  await shot('write-handwriting-question');
  await clickText(/^Check$/);
  await shot('write-handwriting-answered');
  await clickText(/Got it/);
  // dictation typed
  await page.waitForTimeout(800);
  await page.locator('input.write-input').fill('他每天早上七点气床');
  await shot('dictation-typed-question');
  await clickText(/^Check$/);
  await shot('dictation-typed-answered', true);
  await clickText(/Continue/);
  // dictation handwritten
  await pad();
  await shot('dictation-handwrite-question');
  await clickText(/^Check$/);
  await shot('dictation-handwrite-answered', true);
  await clickText(/Got it/);
  // oral expression
  await page.waitForTimeout(800);
  await shot('oral-question');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForTimeout(3200);
  await shot('oral-recording');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.waitForTimeout(800);
  await shot('oral-recorded');
  await clickText(/^Done$/);
  await shot('oral-answered', true);
  await clickText(/I said it well/);
  await page.waitForTimeout(800);
  await shot('lesson-complete');
  // Rate Good
  await page.getByRole('button', { name: /Good/ }).first().click();
  await page.waitForTimeout(3000);

  // ---------- Conversation lesson ----------
  await shot('next-after-practice');
  await api(`/api/lesson-library/${libConvo.id}/assign`, { method: 'POST', token: tutor.token, data: { relationship_ids: [relId] } });
  await page.goto(`${WEB}/lessons`);
  await page.waitForTimeout(4000);
  await page.goto(`${WEB}/study?autostart=true`);
  await page.waitForTimeout(5000);
  await shot('conversation-note');
  await clickText(/Continue/);
  const convo = page.locator('.convo');
  if (await convo.count()) {
    await page.waitForTimeout(1500);
    await shot('conversation-listening');
    await page.waitForTimeout(9000);
    await shot('conversation-questions', true);
    const q = page.locator('.convo-question');
    // Q1: Three (correct); Q2: 6th (wrong); Q3 free; Q4 key card
    await q.nth(0).getByRole('button', { name: 'Three' }).click();
    await q.nth(1).getByRole('button', { name: 'The 6th' }).click();
    await q.nth(2).locator('textarea').fill('7 to 10');
    await q.nth(2).getByRole('button', { name: 'Show answer' }).click();
    await q.nth(2).getByRole('button', { name: /Got it/ }).click();
    await q.nth(3).getByRole('button', { name: 'On the key card' }).click();
    await clickText(/Show transcript/);
    await shot('conversation-transcript', true);
    await clickText(/Continue/);
    await page.waitForTimeout(600);
    // Your turn: oral expression — skip recording path
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.waitForTimeout(600);
    await clickText(/^Done$/);
    await clickText(/I said it well/);
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Good/ }).first().click();
    await page.waitForTimeout(4000);
  }
  await browser.close();
};

run().catch(e => { console.error(e); process.exit(1); });
