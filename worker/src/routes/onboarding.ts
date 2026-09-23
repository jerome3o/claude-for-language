import { Hono } from 'hono';
import { Env } from '../types';
import { getOnboardingState } from '../services/onboarding';
import { ensureStarterDeck, STARTER_WORDS } from '../services/starter-deck';

/**
 * New-student onboarding: what the first-open screen shows, and the built-in
 * starter deck a tutor can send with an invite. Mounted at /api after auth.
 */
const onboarding = new Hono<{ Bindings: Env }>();

/** Inviter, decks copied by the invite, welcome message, and whether a first review exists. */
onboarding.get('/me/onboarding', async (c) => {
  const user = c.get('user');
  const state = await getOnboardingState(c.env.DB, user);
  return c.json(state);
});

/**
 * Create (once) the caller's "Starter Chinese" deck and return it. Idempotent:
 * a second call returns the existing deck. Audio is generated after the
 * response, like any note added through the app.
 */
onboarding.post('/decks/starter', async (c) => {
  const user = c.get('user');
  const result = await ensureStarterDeck(c.env, user.id, c.executionCtx);
  return c.json(
    { deck: result.deck, created: result.created, word_count: STARTER_WORDS.length },
    result.created ? 201 : 200
  );
});

export default onboarding;
