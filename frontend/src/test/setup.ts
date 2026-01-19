import 'fake-indexeddb/auto';
import { beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db/database';

// Reset database before each test
beforeEach(async () => {
  // Clear all tables
  await db.decks.clear();
  await db.notes.clear();
  await db.cards.clear();
  await db.syncMeta.clear();
  await db.studySessions.clear();
  await db.cachedAudio.clear();
  await db.reviewEvents.clear();
  await db.cardCheckpoints.clear();
  await db.pendingRecordings.clear();
  await db.eventSyncMeta.clear();
});

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks();
});

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  value: true,
  writable: true,
  configurable: true,
});
