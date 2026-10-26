import { describe, it, expect, vi } from 'vitest';
import phone from '../phone';
import { parsePersonaRequest, personaReply, PERSONA_MODEL } from '../../services/phone-persona';

const post = (body: unknown, env: Record<string, unknown>) =>
  phone.request('/phone/persona-reply', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);

const chat = { scenario_id: 'ride-north-gate', persona_id: 'driver', messages: [{ from: 'them', text: '您好，我到了，您在哪个门呀？' }, { from: 'me', text: '我在北门，穿红色外套。' }] };

describe('POST /phone/persona-reply', () => {
  it('answers with the deterministic stand-in in E2E_TEST_MODE', async () => {
    const res = await post(chat, { E2E_TEST_MODE: 'true' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; actions: unknown[]; fake: boolean };
    expect(body.reply).toContain('北门');
    expect(body.actions).toEqual([{ name: 'found_passenger', params: { where: '北门' } }]);
    expect(body.fake).toBe(true);
  });

  it('refuses bad requests and unknown personas', async () => {
    expect((await post({ scenario_id: 'x' }, { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await post({ ...chat, messages: [{ from: 'them', text: '你好' }] }, { E2E_TEST_MODE: 'true' })).status).toBe(400);
    expect((await post({ ...chat, persona_id: 'nobody' }, { E2E_TEST_MODE: 'true' })).status).toBe(404);
    expect((await post({ ...chat, scenario_id: 'not-a-scenario' }, { E2E_TEST_MODE: 'true' })).status).toBe(404);
  });

  it('says so when Claude is not configured', async () => {
    const res = await post(chat, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ retryable: false });
  });
});

describe('personaReply', () => {
  it('calls the small model once with the persona prompt and keeps only its actions', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      usage: { input_tokens: 900, output_tokens: 80 },
      content: [{ type: 'tool_use', name: 'persona_reply', input: { reply: '好的，我马上到北门。', english: "OK, I'll be at the north gate right away.", actions: [{ name: 'found_passenger', params: { where: '北门' } }, { name: 'give_refund' }] } }],
    });
    const req = parsePersonaRequest(chat);
    if (typeof req === 'string') throw new Error(req);
    const reply = await personaReply(req, { client: { messages: { create } } as never });
    expect(reply.actions).toEqual([{ name: 'found_passenger', params: { where: '北门' } }]);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(PERSONA_MODEL);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.system).toContain('王师傅');
    expect(params.messages[0].content).toContain('Learner: 我在北门');
  });

  it('trims long chats and messages', () => {
    const long = { ...chat, messages: Array.from({ length: 40 }, (_, i) => ({ from: i % 2 ? 'me' : 'them', text: '好'.repeat(500) })) };
    const req = parsePersonaRequest(long);
    if (typeof req === 'string') throw new Error(req);
    expect(req.messages).toHaveLength(24);
    expect(req.messages[0].text).toHaveLength(300);
  });
});
