import { test, expect, APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * Lesson materials (round 4, docs/VIDEO_CALLS.md "Lesson materials"): the tutor
 * uploads a PDF (pages drawn on the device with pdf.js, uploaded as pictures),
 * presents it in a call; both see the same page, either can turn it, a drawing
 * on a page reaches the other person, and the student can open it afterwards
 * (presenting shares it). Round 6: the PDF's outline becomes its ☰ Contents
 * (either person jumps, both follow), and the tutor's "Show for student" sits
 * in the tile's control row, clear of the Pen / Text tools.
 */

const API = process.env.E2E_API_URL || 'http://localhost:8787';
const LAUNCH = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], ...LAUNCH },
  permissions: ['camera', 'microphone'],
});

async function api<T = unknown>(request: APIRequestContext, path: string, opts: { method?: 'GET' | 'POST'; token?: string; data?: unknown } = {}): Promise<T> {
  const res = await request.fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    data: opts.data === undefined ? undefined : JSON.stringify(opts.data),
  });
  if (!res.ok()) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status()}`);
  return (await res.json()) as T;
}

async function openAs(browser: Browser, token: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`/?session_token=${token}`);
  await page.locator('.header').waitFor({ timeout: 30000 });
  return page;
}

async function joinCall(page: Page, callId: string) {
  await page.goto(`/calls/${callId}`);
  await expect(page.getByTestId('join-call')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('record-toggle').uncheck();
  await page.getByTestId('join-call').click();
  await page.getByTestId('call-live').waitFor({ timeout: 20000 });
}

/** A two-page PDF ("Lesson 5 page one" / "… page two") with an outline ("Part one", "第二部分"), written by hand. */
function twoPagePdf(): Buffer {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  const page = (content: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 7 0 R >> >> /Contents ${content} 0 R >>`;
  const stream = (text: string) => {
    const s = `BT /F1 28 Tf 40 150 Td (${text}) Tj ET`;
    return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  };
  objs.push(page(4));
  objs.push(stream('Lesson 5 page one'));
  objs.push(page(6));
  objs.push(stream('Lesson 5 page two'));
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push('<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>');
  objs.push('<< /Title (Part one) /Parent 8 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>');
  // 第二部分 as a UTF-16BE string.
  objs.push('<< /Title <FEFF7B2C4E8C90E85206> /Parent 8 0 R /Prev 9 0 R /Dest [5 0 R /Fit] >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** How many non-transparent pixels the annotation canvas holds. */
function inkCount(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++;
    return n;
  });
}

async function settledBox(page: Page, testId: string) {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const b = (await page.getByTestId(testId).boundingBox())!;
    const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`;
    if (key === last) return b;
    last = key;
    await page.waitForTimeout(100);
  }
  return (await page.getByTestId(testId).boundingBox())!;
}

test('the tutor uploads a PDF and presents it; page turns and drawings reach both; the student can open it after', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const seed = async (tag: string, name: string) => {
    const email = `callm-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.e2e`;
    const r = await api<{ session_token: string }>(request, '/api/test/auth', { method: 'POST', data: { email, name } });
    return { email, token: r.session_token };
  };
  const tutor = await seed('tutor', '王老师');
  const student = await seed('student', 'Jerome');
  const rel = await api<{ data: { id: string } }>(request, '/api/relationships', { method: 'POST', token: tutor.token, data: { recipient_email: student.email, role: 'tutor' } });
  await api(request, `/api/relationships/${rel.data.id}/accept`, { method: 'POST', token: student.token });

  // ---- Upload on the Materials page: pdf.js draws both pages on the device.
  const tp = await openAs(browser, tutor.token);
  await tp.goto('/materials');
  await tp.getByTestId('materials-file').setInputFiles({ name: 'Lesson 5 – 把字句.pdf', mimeType: 'application/pdf', buffer: twoPagePdf() });
  await tp.getByTestId('material-viewer').waitFor({ timeout: 30000 });
  await expect(tp.getByRole('heading', { name: 'Lesson 5 – 把字句' })).toBeVisible();
  await expect(tp.getByTestId('viewer-page')).toHaveText('1 / 2');
  await expect.poll(() => tp.getByTestId('viewer-image').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15000 }).toBeGreaterThan(500);
  const { materials } = await api<{ materials: { id: string; page_count: number; has_text: boolean }[] }>(request, '/api/materials', { token: tutor.token });
  expect(materials).toHaveLength(1);
  expect(materials[0].page_count).toBe(2);
  const text = await (await request.fetch(`${API}/api/materials/${materials[0].id}/text`, { headers: { Authorization: `Bearer ${tutor.token}` } })).text();
  expect(text).toContain('page two');
  // The outline was read on the device and stored as the Contents.
  const detail = await api<{ material: { toc: { title: string; page: number; level: number }[] | null } }>(request, `/api/materials/${materials[0].id}`, { token: tutor.token });
  expect(detail.material.toc).toEqual([
    { title: 'Part one', page: 0, level: 0 },
    { title: '第二部分', page: 1, level: 0 },
  ]);
  // The viewer's Contents jumps.
  await tp.getByTestId('material-contents').click();
  await expect(tp.getByTestId('material-contents-row')).toHaveText(['Part one1', '第二部分2']);
  await tp.getByTestId('material-contents-row').nth(1).click();
  await expect(tp.getByTestId('viewer-page')).toHaveText('2 / 2');

  // ---- Present it in a call.
  const { call } = await api<{ call: { id: string } }>(request, '/api/calls', { method: 'POST', token: tutor.token, data: { relationship_id: rel.data.id } });
  const sp = await openAs(browser, student.token);
  await joinCall(tp, call.id);
  await joinCall(sp, call.id);
  await tp.getByLabel('More').click();
  await tp.getByTestId('menu-present-material').click();
  await tp.getByTestId('present-material-row').first().click();

  for (const p of [tp, sp]) {
    await expect(p.getByTestId('material-tile')).toBeVisible({ timeout: 15000 });
    await expect(p.getByTestId('call-tiles')).toHaveAttribute('data-stage', /material/);
    await expect(p.getByTestId('material-page')).toHaveText('1 / 2');
    await expect.poll(() => p.getByTestId('material-image').evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 15000 }).toBeGreaterThan(500);
  }

  // The student turns the page — the tutor follows.
  await sp.getByTestId('material-next').click();
  await expect(tp.getByTestId('material-page')).toHaveText('2 / 2', { timeout: 10000 });
  await expect(sp.getByTestId('material-page')).toHaveText('2 / 2');

  // Contents: the student jumps to "Part one" — the tutor follows; she jumps back to 第二部分.
  await sp.getByTestId('material-contents').click();
  await expect(sp.getByTestId('material-contents-row')).toHaveCount(2);
  await expect(sp.getByTestId('material-contents-row').nth(1)).toHaveAttribute('aria-current', 'true');
  await sp.getByTestId('material-contents-row').first().click();
  await expect(sp.getByTestId('material-contents-panel')).toHaveCount(0);
  await expect(tp.getByTestId('material-page')).toHaveText('1 / 2', { timeout: 10000 });
  await tp.getByTestId('material-contents').click();
  await tp.getByTestId('material-contents-row').filter({ hasText: '第二部分' }).click();
  await expect(sp.getByTestId('material-page')).toHaveText('2 / 2', { timeout: 10000 });

  // The tutor circles something on page 2 — the student sees it.
  await tp.getByTestId('material-draw').click();
  // Her "Show for student" is in the tile's control row: it covers none of the material's tools.
  await expect(tp.getByTestId('material-tools')).toBeVisible();
  const showBox = (await tp.getByTestId('show-material').boundingBox())!;
  for (const id of ['material-tools', 'material-stop', 'material-draw', 'material-next', 'material-contents']) {
    const b = (await tp.getByTestId(id).boundingBox())!;
    const overlaps = showBox.x < b.x + b.width && showBox.x + showBox.width > b.x && showBox.y < b.y + b.height && showBox.y + showBox.height > b.y;
    expect(overlaps, `Show for student covers ${id}`).toBe(false);
  }
  const box = await settledBox(tp, 'annot-material');
  await tp.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await tp.mouse.down();
  await tp.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 12 });
  await tp.mouse.up();
  await expect.poll(() => inkCount(sp, 'annot-material'), { timeout: 10000 }).toBeGreaterThan(50);

  // Back to page 1: page 2's drawing isn't on it; forward again: it is (kept per page).
  await tp.getByTestId('material-prev').click();
  await expect(sp.getByTestId('material-page')).toHaveText('1 / 2', { timeout: 10000 });
  await expect.poll(() => inkCount(sp, 'annot-material'), { timeout: 5000 }).toBe(0);
  await tp.getByTestId('material-next').click();
  await expect(sp.getByTestId('material-page')).toHaveText('2 / 2', { timeout: 10000 });
  await expect.poll(() => inkCount(sp, 'annot-material'), { timeout: 10000 }).toBeGreaterThan(50);

  // Stop presenting: the tile goes for both.
  await tp.getByTestId('material-stop').click();
  await expect(sp.getByTestId('material-tile')).toHaveCount(0, { timeout: 10000 });

  // Presenting shared it: the student finds it on their Materials page.
  await sp.goto('/materials');
  await expect(sp.getByText('Lesson 5 – 把字句')).toBeVisible({ timeout: 15000 });
  await expect(sp.getByText(/from 王老师/)).toBeVisible();
});
