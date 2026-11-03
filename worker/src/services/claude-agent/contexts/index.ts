/**
 * The context registry: kind → provider. Adding a context = one file here + its line below + the
 * contexts its tools allow (tools/registry.ts).
 */
import type { ContextKind, ContextProvider } from '../types';
import { cardContext } from './card';
import { chatMessageContext } from './chat_message';
import { coachContext } from './coach';
import { exerciseContext } from './exercise';
import { generalContext } from './general';
import { readerContext } from './reader';
import { practiceContextProvider } from './practice';

export const CONTEXT_PROVIDERS: { [K in ContextKind]: ContextProvider<K, any> } = {
  general: generalContext,
  card: cardContext,
  coach: coachContext,
  practice: practiceContextProvider,
  chat_message: chatMessageContext,
  reader: readerContext,
  exercise: exerciseContext,
};

export function providerFor<K extends ContextKind>(kind: K): ContextProvider<K, any> {
  return CONTEXT_PROVIDERS[kind];
}
