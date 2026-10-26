/**
 * 📱 Phone practice personas (docs/PHONE_PRACTICE.md "Personas"): one fast `structuredCall`
 * (the small model, thinking off, forced `persona_reply` tool) per message the learner sends to
 * a driver / rider / restaurant host / landlord inside a simulated app. The prompt, limits and
 * the reply's cleaning are shared/phone/persona.ts; only bundled scenarios' personas are played
 * (the client names a scenario + persona; it never sends a prompt).
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  bundledScenario,
  fakePersonaReply,
  findPersona,
  normalizePersonaReply,
  PERSONA_LIMITS,
  PERSONA_TOOL,
  personaSystemPrompt,
  personaUserTurn,
  trimPersonaMessages,
  type PersonaMessage,
  type PersonaReply,
} from '@shared/phone';
import { DEFAULT_FALLBACK_MODEL, structuredCall } from './structured-call';

/** The small fast model (a persona reply should come back in a second or two). */
export const PERSONA_MODEL = DEFAULT_FALLBACK_MODEL;

export interface PersonaRequest {
  scenario_id: string;
  persona_id: string;
  messages: PersonaMessage[];
  context?: string;
}

/** Reads a request body; a string error = 400. */
export function parsePersonaRequest(body: unknown): PersonaRequest | string {
  if (!body || typeof body !== 'object') return 'A JSON body is required';
  const b = body as Record<string, unknown>;
  const scenarioId = typeof b.scenario_id === 'string' ? b.scenario_id : '';
  const personaId = typeof b.persona_id === 'string' ? b.persona_id : '';
  if (!scenarioId || !personaId) return 'scenario_id and persona_id are required';
  if (!Array.isArray(b.messages)) return 'messages must be a list';
  const messages = trimPersonaMessages(
    b.messages
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map((m) => ({ from: m.from === 'me' ? 'me' : 'them', text: typeof m.text === 'string' ? m.text : '' }) as PersonaMessage),
  );
  if (!messages.some((m) => m.from === 'me')) return 'Send a message first';
  const context = typeof b.context === 'string' ? b.context.slice(0, PERSONA_LIMITS.context_chars) : undefined;
  return { scenario_id: scenarioId, persona_id: personaId, messages, context };
}

export interface PersonaDeps {
  apiKey?: string;
  /** E2E_TEST_MODE: the deterministic stand-in, whatever key is set. */
  fake?: boolean;
  client?: Pick<Anthropic, 'messages'>;
}

export class PersonaNotFound extends Error {}

export async function personaReply(req: PersonaRequest, deps: PersonaDeps): Promise<PersonaReply & { fake?: boolean }> {
  const spec = bundledScenario(req.scenario_id);
  const persona = spec ? findPersona(spec, req.persona_id) : null;
  if (!spec || !persona) throw new PersonaNotFound(`No persona "${req.persona_id}" in scenario "${req.scenario_id}"`);
  if (deps.fake) return { ...fakePersonaReply(persona, req.messages), fake: true };
  if (!deps.apiKey && !deps.client) throw new Error('AI is not configured');
  return structuredCall({
    apiKey: deps.apiKey ?? 'test',
    model: PERSONA_MODEL,
    fallbackModel: null,
    system: personaSystemPrompt(spec, persona),
    user: personaUserTurn(persona, req.messages, req.context),
    tool: PERSONA_TOOL,
    maxTokens: 500,
    attempts: 2,
    timeoutMs: 20_000,
    maxRetries: 0,
    validate: (raw) => normalizePersonaReply(raw, persona),
    client: deps.client,
  });
}
