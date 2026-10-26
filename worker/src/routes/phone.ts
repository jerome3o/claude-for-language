/**
 * 📱 Phone practice (docs/PHONE_PRACTICE.md). Mounted under /api after the auth middleware;
 * in the cost guard's `ai` group (a model call per message).
 *
 *   POST /phone/persona-reply { scenario_id, persona_id, messages: [{ from: me | them, text }], context? }
 *        → { reply, english, actions: [{ name, params }] }   (a bundled scenario's persona only)
 *        400 bad request · 404 no such persona · 503 { retryable } busy / not configured · 502 declined
 *
 * Everything else about the feature runs on the device (scenarios are bundled, plays are kept
 * in the device's IndexedDB).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { parsePersonaRequest, personaReply, PersonaNotFound } from '../services/phone-persona';
import { StructuredCallError } from '../services/structured-call';

const phone = new Hono<{ Bindings: Env }>();

phone.post('/phone/persona-reply', async (c) => {
  const body = await c.req.json().catch(() => null);
  const req = parsePersonaRequest(body);
  if (typeof req === 'string') return c.json({ error: req }, 400);
  const fake = c.env.E2E_TEST_MODE === 'true';
  if (!fake && !c.env.ANTHROPIC_API_KEY) return c.json({ error: 'Chats in phone practice need Claude, which isn’t set up on this server.', retryable: false }, 503);
  try {
    const reply = await personaReply(req, { apiKey: c.env.ANTHROPIC_API_KEY, fake });
    return c.json(reply);
  } catch (error) {
    if (error instanceof PersonaNotFound) return c.json({ error: error.message }, 404);
    console.error('[phone] persona reply failed:', error instanceof Error ? error.message : error);
    const retryable = !(error instanceof StructuredCallError) || error.retryable;
    return c.json({ error: retryable ? 'No reply right now — try again in a moment.' : 'No reply to that one.', retryable }, retryable ? 503 : 502);
  }
});

export default phone;
